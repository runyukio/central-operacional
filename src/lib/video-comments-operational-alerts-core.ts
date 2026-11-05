import { adsPendingReport, adsProductiveSchedule, adsScheduleWindow, adsWallInstant, type AdsAlertPlan, type AdsAlertCell, type AdsAlertGroup, type AdsOperationalReport, type AdsSchedule } from "./ads-operational-alerts-core";

export const VIDEO_COMMENTS_ALERT_LOBS = ["VIDEO", "COMMENTS"] as const;
export type VideoCommentsAlertLob = typeof VIDEO_COMMENTS_ALERT_LOBS[number];
export type VideoCommentsSchedule = AdsSchedule & { scheduleId: string; shift: string; profiles: number };
export function scopeVideoCommentsReport(report: AdsOperationalReport, lob: VideoCommentsAlertLob): AdsOperationalReport {
  // Only fixed report copy is adapted; imported agent names and WBs are preserved.
  return { ...report, lob, title: report.title.replace(/\bADS\b/g,lob), summary: report.summary.replace(/\bADS\b/g,lob),
    groups: report.groups.map(group=>({ ...group,title:report.kind==="volume"?group.title.replace(/^ADS\b/,lob):group.title,
      rows:group.rows.map(row=>({...row,name:report.kind==="volume"?row.name.replace(/^ADS\b/,lob):report.pending&&row.name==="ADS"?lob:row.name})) })) };
}
export const videoCommentsPendingReport=(lob: VideoCommentsAlertLob,plan: AdsAlertPlan,reason: string)=>scopeVideoCommentsReport(adsPendingReport(plan,reason),lob);
const shiftForPlan=(plan: AdsAlertPlan)=>plan.start.slice(11)==="23:00"?"Noite":plan.start.slice(11)==="08:00"?"Manhã":"Tarde";
export function videoCommentsShiftSchedules(rows: VideoCommentsSchedule[],plan: AdsAlertPlan,kind: "lateness" | "hours") {
  return rows.filter(row=>{
    if(row.day!==plan.referenceDate||row.shift!==shiftForPlan(plan)||!adsProductiveSchedule(row))return false;
    const window=adsScheduleWindow(row.day,row.startsAt,row.endsAt);if(!window)return false;
    const from=adsWallInstant(plan.start).getTime(),through=adsWallInstant(plan.end).getTime();
    return kind==="hours"?window.to<=through:window.from>=from-3_600_000&&window.from<=from;
  });
}
const cell=(value:string,color:AdsAlertCell["color"]="text")=>({value,color});
const duration=(seconds:number)=>`${Math.floor(Math.abs(seconds)/60)}m${String(Math.floor(Math.abs(seconds)%60)).padStart(2,"0")}s`;
export type VideoCommentsJourneyRow = { name:string; wb:string; startsAt:string; profileStart:string|null; first:string|null; delay:number|null; pending:string|null };
export function videoCommentsJourneyReport(lob: VideoCommentsAlertLob,plan: AdsAlertPlan,entries: VideoCommentsJourneyRow[]): AdsOperationalReport {
  const signals=entries.filter(r=>!r.pending&&r.first&&r.delay!==null&&r.delay>300).sort((a,b)=>b.delay!-a.delay!);
  const ontime=entries.filter(r=>!r.pending&&r.first&&r.delay!==null&&r.delay<=300),missing=entries.filter(r=>!r.pending&&!r.first),pending=entries.filter(r=>r.pending);
  const observed=(r:VideoCommentsJourneyRow,flag:boolean)=>({name:r.name,detail:r.wb,cells:[cell(r.startsAt),cell(r.first!.slice(11)),cell(flag?"+"+duration(r.delay!):"Até +5 min",flag?"orange":"green")]});
  const groups:AdsAlertGroup[]=[];
  if(signals.length)groups.push({title:"Primeiro sinal após a tolerância · conferir",rows:signals.map(r=>observed(r,true))});
  if(ontime.length)groups.push({title:"Captura dentro da tolerância",rows:ontime.map(r=>observed(r,false))});
  if(missing.length)groups.push({title:`Sem captura até ${plan.end.slice(11)} · verificar monitor`,rows:missing.map(r=>({name:r.name,detail:r.wb,cells:[cell(r.startsAt),cell("—","muted"),cell("Sem captura","muted")]}))});
  if(pending.length)groups.push({title:"Cadastro divergente · conferir",rows:pending.map(r=>({name:r.name,detail:`${r.wb} · ${r.pending}`,cells:[cell(r.startsAt),cell(r.first?.slice(11)??"—","muted"),cell("A conferir","orange")]}))});
  if(!groups.length)groups.push({title:"Escala deste corte",rows:[{name:lob,detail:"Nenhum agente com início de jornada previsto para este corte",cells:[cell("—","muted"),cell("—","muted"),cell("Sem escalados","muted")]}]});
  return {lob,kind:"lateness",periodKey:plan.periodKey,title:"Início da jornada · sinais a conferir",subtitle:`${plan.referenceDate.split("-").reverse().join("/")} · ${shiftForPlan(plan).toLowerCase()} · corte ${plan.end.slice(11)} · Brasília`,
    metrics:[{label:"ESCALADOS PARA O CORTE",value:entries.length+" agentes"},{label:"PRIMEIRO SINAL APÓS 5 MIN",value:signals.length+" a conferir"}],
    summary:entries.length?`${ontime.length} dentro da tolerância · ${signals.length} a conferir · ${missing.length} sem captura · ${pending.length} pendências`:"Nenhum agente com início previsto neste corte",
    headings:["AGENTE / WB","ESCALA","PRIMEIRO SINAL","LEITURA"],groups,notes:[
      "Primeiro sinal da captura periódica de atividade, vinculado pelo WB único do cadastro. Este horário não comprova chegada.",
      "Sem captura pede verificação do monitor; não confirma falta ou atraso. Divergências de cadastro ficam separadas.",
      "Horários individuais seguem a escala do agente. Quem inicia depois da faixa deste turno não entra na avaliação."
    ]};
}
export type VideoCommentsQueueReading = {cycle:string;queueId:string;input:number;backlog:number;sourceRows:number};
export function videoCommentsQueueHour(plan:AdsAlertPlan,rows:VideoCommentsQueueReading[]) {
  const from=adsWallInstant(plan.start).getTime(),through=adsWallInstant(plan.end).getTime();
  if(through-from!==3_600_000||!rows.length)return null;
  const cycles=Array.from({length:13},(_,i)=>new Date(from+i*300_000-3*3_600_000).toISOString().slice(0,16).replace("T"," "));
  const ids=[...new Set(rows.map(r=>r.queueId))];let input=0,resets=0;
  for(const id of ids){
    const points=cycles.map(cycle=>rows.filter(r=>r.queueId===id&&r.cycle===cycle));
    if(points.some(items=>items.length!==1||!items[0].queueId||!Number.isSafeInteger(items[0].input)||items[0].input<0||items[0].sourceRows<1))return null;
    for(let i=1;i<points.length;i++){
      const before=points[i-1][0],after=points[i][0],delta=after.input-before.input;
      // Same daily reset boundary as the shared ADS counter calculation; midnight never resets.
      if(delta<0){if(!["13:00","13:05"].includes(after.cycle.slice(11)))return null;input+=after.input;resets++;}else input+=delta;
    }
  }
  const closing=rows.filter(r=>r.cycle===plan.end);
  if(closing.length!==ids.length||closing.some(r=>!Number.isSafeInteger(r.backlog)||r.backlog<0))return null;
  return {input,backlog:closing.reduce((sum,r)=>sum+r.backlog,0),queues:ids.length,resets};
}
