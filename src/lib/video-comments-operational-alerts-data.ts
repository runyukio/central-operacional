import {Prisma} from "@prisma/client";
import {prisma} from "./prisma";
import {readAdsProductivityAlert} from "./ads-productivity-alert-service";
import {loadVolumeForecastRange} from "./volume-forecast-service";
import {moderationMinutesLabel} from "./ads-productivity-alert-core";
import {ADS_PLANNED_SCHEDULE_STATUSES,addAdsDays,adsAhtComparison,adsEligibleForHour,adsScheduleConflict,adsScheduleWindow,adsWallInstant,adsWeekDays,type AdsAlertPlan,type AdsOperationalReport,type AdsAlertGroup,type AdsAlertCell} from "./ads-operational-alerts-core";
import {productivityOperationalReport,ahtOperationalReport,requiredOperationalReport,volumeOperationalReport,type AdsAhtCase} from "./ads-operational-alerts-report";
import {scopeVideoCommentsReport,videoCommentsPendingReport,videoCommentsShiftSchedules,videoCommentsJourneyReport,videoCommentsQueueHour,type VideoCommentsAlertLob,type VideoCommentsSchedule,type VideoCommentsJourneyRow,type VideoCommentsQueueReading} from "./video-comments-operational-alerts-core";

const wbKey=(value:string)=>value.trim().toLowerCase().replace(/\s+/g,"");
const cell=(value:string,color:AdsAlertCell["color"]="text")=>({value,color});
function bySupervisor(rows:Array<{name:string;detail:string;cells:AdsAlertCell[];supervisor:string|null}>):AdsAlertGroup[]{const groups=new Map<string,typeof rows>();for(const row of rows){const title=row.supervisor||"Sem supervisor cadastrado";groups.set(title,[...(groups.get(title)??[]),row]);}return [...groups].map(([title,rows])=>({title,rows}));}
async function schedules(lob:VideoCommentsAlertLob,from:string,through:string){
  return prisma.$queryRaw<VideoCommentsSchedule[]>(Prisma.sql`
    SELECT s.id AS "scheduleId",s."employeeId",to_char(s.date,'YYYY-MM-DD') AS day,s.status::text AS status,s."startsAt",s."endsAt",sh.name AS shift,
      e."workStartTime" AS "profileStart",e."workEndTime" AS "profileEnd",e."fullName" AS name,COALESCE(e."wbLogin",'') AS "wbLogin",su."fullName" AS supervisor,
      (SELECT count(*)::int FROM "EmployeeProfile" ep WHERE ep."deletedAt" IS NULL AND regexp_replace(lower(trim(ep."wbLogin")),'[[:space:]]+','','g')=regexp_replace(lower(trim(e."wbLogin")),'[[:space:]]+','','g')) AS profiles
    FROM "Schedule" s JOIN "EmployeeProfile" e ON e.id=s."employeeId" JOIN "Lob" l ON l.id=s."lobId" AND e."lobId"=l.id JOIN "Shift" sh ON sh.id=s."shiftId"
    LEFT JOIN "EmployeeProfile" su ON su.id=e."supervisorId" AND su."deletedAt" IS NULL
    WHERE s."deletedAt" IS NULL AND e."deletedAt" IS NULL AND upper(trim(l.name))=${lob} AND e."roleTitle"='Agente'
      AND lower(trim(e."operationalStatus")) IN ('ativo','active','nesting') AND s.date>=${from}::date AND s.date<=${through}::date ORDER BY s.date,e."fullName",s.id
  `);
}
async function loadHourly(lob:VideoCommentsAlertLob,plan:AdsAlertPlan){
  const [source,daily]=await Promise.all([readAdsProductivityAlert(new Date(adsWallInstant(plan.end).getTime()+180_000),true,lob),schedules(lob,addAdsDays(plan.referenceDate,-1),plan.end.slice(0,10))]);
  if(source.status!=="ready")return null;
  const allowed=new Set(daily.filter(row=>row.profiles===1&&adsEligibleForHour(row,plan,new Set())).map(row=>row.employeeId));
  const evaluated=source.result.evaluated.filter(row=>row.employeeId&&allowed.has(row.employeeId));
  return {evaluated,excluded:source.result.evaluated.length-evaluated.length+source.result.issues.length};
}
export function createVideoCommentsDataContext(){const cache=new Map<string,ReturnType<typeof loadHourly>>();return {hourly(lob:VideoCommentsAlertLob,plan:AdsAlertPlan){const key=lob+"|"+plan.end;let promise=cache.get(key);if(!promise){promise=loadHourly(lob,plan);cache.set(key,promise);}return promise;}};}
async function loadVolume(lob:VideoCommentsAlertLob,plan:AdsAlertPlan,now:Date){
  const slots=Array.from({length:13},(_,i)=>{const at=new Date(adsWallInstant(plan.start).getTime()+i*300_000),cycle=new Date(at.getTime()-3*3_600_000).toISOString().slice(0,16).replace("T"," ");return {at,cycle,sourceCycle:cycle.slice(0,14)+(Number(cycle.slice(14))<30?"00":"30")};});
  const rows=await prisma.$queryRaw<VideoCommentsQueueReading[]>(Prisma.sql`
    WITH slots(cycle,"sourceCycle",at) AS (VALUES ${Prisma.join(slots.map(s=>Prisma.sql`(${s.cycle},${s.sourceCycle},${s.at}::timestamp)`))}),picked AS (
      SELECT slots.*,b.id AS "batchId" FROM slots JOIN LATERAL (
        SELECT b.id FROM "RealTimeImportBatch" b WHERE b.status='SUCCESS' AND b."queueRows">0
          AND b."importedAt" BETWEEN slots.at-interval '90 seconds' AND slots.at+interval '90 seconds'
          AND EXISTS(SELECT 1 FROM "RealTimeQueueCycleSummary" q WHERE q."batchId"=b.id AND q."cycleDownload"=slots."sourceCycle")
        ORDER BY abs(extract(epoch FROM b."importedAt"-slots.at)),b."importedAt" DESC,b.id DESC LIMIT 1
      ) b ON true
    ) SELECT p.cycle,q."queueId",q.input,q.backlog,q."sourceRows" FROM picked p JOIN "RealTimeQueueCycleSummary" q ON q."batchId"=p."batchId" AND q."cycleDownload"=p."sourceCycle"
    WHERE upper(trim(q.lob))=${lob} ORDER BY p.cycle,q."queueId",q.id
  `);
  const values=videoCommentsQueueHour(plan,rows);
  if(!values)return videoCommentsPendingReport(lob,plan,"As 13 coletas de filas ainda não formam uma hora completa e comparável.");
  const forecast=(await loadVolumeForecastRange(lob,[plan.referenceDate],now)).points.find(p=>p.dateKey===plan.referenceDate&&p.hour===Number(plan.start.slice(11,13)))?.input;
  if(forecast===undefined||!Number.isFinite(forecast)||forecast<0)return videoCommentsPendingReport(lob,plan,"Forecast oficial ainda indisponível para a mesma hora.");
  const report=scopeVideoCommentsReport(volumeOperationalReport(plan,{...values,forecast}),lob);
  report.title="Volume da hora · "+lob;report.summary=values.queues+" filas "+lob+" recebidas · hora fechada";
  report.notes=[`Entradas validadas nas 13 coletas de 5 minutos.${values.resets?" Reinício diário de contadores considerado na fronteira das 13h.":" Não houve reinício de contadores nesta hora."}`,
    `Forecast da mesma fonte oficial de Performance / Executive para ${lob}. Backlog é o estoque final das filas recebidas; não soma saldos. A variação é informativa; filas ausentes não são inferidas como zero.`];return report;
}
async function loadAht(lob:VideoCommentsAlertLob,plan:AdsAlertPlan,hourly:NonNullable<Awaited<ReturnType<typeof loadHourly>>>){
  const wbs=[...new Set(hourly.evaluated.map(row=>wbKey(row.wbLogin)))];
  const history=wbs.length?await prisma.$queryRaw<Array<{wb:string;submits:number;seconds:number;days:number}>>(Prisma.sql`
    SELECT regexp_replace(lower(trim(p."wbLogin")),'[[:space:]]+','','g') AS wb,sum(p."submitNum")::double precision AS submits,sum(p."moderationSeconds")::double precision AS seconds,count(DISTINCT p."bzDay"::date)::int AS days
    FROM "ProductionRecord" p JOIN "Lob" l ON l.id=p."lobId" WHERE upper(trim(l.name))=${lob}
      AND p."bzDay">=${addAdsDays(plan.referenceDate,-14)}::date AND p."bzDay"<${plan.referenceDate}::date AND p."submitNum">0 AND p."moderationSeconds">=0
      AND regexp_replace(lower(trim(p."wbLogin")),'[[:space:]]+','','g') IN (${Prisma.join(wbs)}) GROUP BY 1
  `):[];
  const historical=new Map(history.map(row=>[row.wb,row])),sample:AdsAhtCase[]=[];
  for(const agent of hourly.evaluated){const comparison=adsAhtComparison(agent,historical.get(wbKey(agent.wbLogin)));if(comparison)sample.push({agent,...comparison});}
  const report=scopeVideoCommentsReport(ahtOperationalReport(plan,sample),lob);
  if(!sample.length){report.summary="Sem amostra suficiente para comparar AHT neste corte";report.groups=[{title:"Amostra deste corte",rows:[{name:lob,detail:"A comparação exige 10 submits no corte, 3 dias e 100 submits históricos",cells:[cell("—","muted"),cell("—","muted"),cell("Sem amostra","muted")]}]}];}
  return report;
}
async function loadLateness(lob:VideoCommentsAlertLob,plan:AdsAlertPlan){
  const daily=videoCommentsShiftSchedules(await schedules(lob,plan.referenceDate,plan.referenceDate),plan,"lateness"),entries:VideoCommentsJourneyRow[]=[];
  for(const row of daily){
    const pending=row.profiles!==1?"WB ambíguo":adsScheduleConflict(row,new Set())?"Jornada divergente":null;
    let first:Date|null=null;
    if(!pending&&row.wbLogin){const [found]=await prisma.$queryRaw<Array<{at:Date|null}>>(Prisma.sql`
      SELECT min(c."capturedAt") AS at FROM "RealTimeHoursRecord" c WHERE c."isSessionActive"=true
        AND (c."employeeId" IS NULL OR c."employeeId"=${row.employeeId})
        AND regexp_replace(lower(trim(c."wbLogin")),'[[:space:]]+','','g')=${wbKey(row.wbLogin)}
        AND c."capturedAt">=${new Date(adsWallInstant(`${row.day} ${row.startsAt}`).getTime()-3_600_000)}
        AND c."capturedAt"<=${adsWallInstant(plan.end)}
    `);first=found?.at??null;}
    entries.push({name:row.name,wb:row.wbLogin,startsAt:row.startsAt!,profileStart:row.profileStart,pending,first:first?new Date(first.getTime()-3*3_600_000).toISOString().slice(0,19):null,
      delay:first?(first.getTime()-adsWallInstant(`${row.day} ${row.startsAt}`).getTime())/1000:null});
  }return videoCommentsJourneyReport(lob,plan,entries);
}
async function loadHours(lob:VideoCommentsAlertLob,plan:AdsAlertPlan){
  const daily=videoCommentsShiftSchedules(await schedules(lob,plan.referenceDate,plan.referenceDate),plan,"hours");
  const ids=daily.map(row=>row.scheduleId),date=new Date(plan.referenceDate+"T00:00:00Z");
  const [records,justifications]=ids.length?await Promise.all([
    prisma.workHourRecord.findMany({where:{scheduleId:{in:ids},date},select:{scheduleId:true,plannedStart:true,plannedEnd:true,plannedHours:true,effectiveHours:true,differenceMinutes:true,updatedAt:true,status:true,adjustments:{where:{status:{in:["ABERTO","EM_ANALISE"]}},select:{id:true}}}}),
    prisma.workHourAdherenceJustification.findMany({where:{scheduleId:{in:ids},date},select:{scheduleId:true,status:true,plannedStart:true,plannedEnd:true}})
  ]):[[],[]];
  const bySchedule=new Map(records.map(r=>[r.scheduleId,r]));
  const rows=daily.map(row=>{
    const r=bySchedule.get(row.scheduleId),window=adsScheduleWindow(row.day,row.startsAt,row.endsAt)!;
    let pending:string|null=null;
    if(row.profiles!==1||adsScheduleConflict(row,new Set()))pending="Jornada divergente";
    else if(!r||r.plannedStart!==row.startsAt||r.plannedEnd!==row.endsAt||r.updatedAt.getTime()<window.to)pending="Fechamento pendente";
    else if(r.adjustments.length)pending="Ajuste em análise";
    else if(justifications.some(j=>j.scheduleId===row.scheduleId&&j.plannedStart===row.startsAt&&j.plannedEnd===row.endsAt&&j.status!=="PENDING"))pending="Justificativa registrada";
    else if(["MISSING_WORK_HOURS","NO_SCHEDULE"].includes(r.status)||r.plannedHours===null||!Number.isFinite(r.plannedHours)||r.plannedHours<=0||!Number.isFinite(r.effectiveHours)||r.effectiveHours<0||r.differenceMinutes===null)pending="Horas não consolidadas";
    return {name:row.name,wb:row.wbLogin,startsAt:row.startsAt,endsAt:row.endsAt,supervisor:row.supervisor,planned:r?.plannedHours??null,effective:r?.effectiveHours??null,deficit:r?.differenceMinutes===null||r?.differenceMinutes===undefined?null:-r.differenceMinutes,pending};
  });
  const valid=rows.filter(r=>!r.pending&&r.deficit!==null),deficits=valid.filter(r=>r.deficit!>5),pending=rows.filter(r=>r.pending);
  const time=(value:number)=>{const minutes=Math.round(value*60);return Math.floor(minutes/60)+"h"+String(minutes%60).padStart(2,"0");};
  const groups=bySupervisor([...deficits,...valid.filter(r=>r.deficit!<=5)].map(r=>({name:r.name,detail:`${r.wb} · ${r.startsAt} a ${r.endsAt}`,supervisor:r.supervisor,
    cells:[cell(`${time(r.planned!)} / ${time(r.effective!)}`,r.deficit!>5?"orange":"green"),cell(r.deficit!>5?`-${r.deficit} min`:"Cumprido",r.deficit!>5?"orange":"green")]})));
  if(pending.length)groups.push({title:"Fechamento ou cadastro pendente",rows:pending.map(r=>({name:r.name,detail:`${r.wb} · ${r.pending}`,cells:[cell("—","muted"),cell("A conferir","muted")]}))});
  if(!groups.length)groups.push({title:"Turno encerrado",rows:[{name:lob,detail:"Nenhuma jornada produtiva cadastrada neste turno",cells:[cell("—","muted"),cell("Sem escalados","muted")]}]});
  return {lob,kind:"hours",periodKey:plan.periodKey,title:"Horas cumpridas · turno encerrado",subtitle:`${plan.referenceDate.split("-").reverse().join("/")} · ${plan.start.slice(11)} a ${plan.end.slice(11)}${plan.start.slice(0,10)!==plan.end.slice(0,10)?" (dia seguinte)":""} · Brasília`,
    metrics:[{label:"JORNADAS CONSOLIDADAS",value:valid.length+" agentes"},{label:"DÉFICIT DE HORAS",value:deficits.length?deficits.length+" casos":"Nenhum neste corte"}],summary:`${valid.length-deficits.length} registros sem déficit · ${deficits.length} com déficit · ${pending.length} pendências`,
    headings:["AGENTE / WB","PREVISTAS / CUMPRIDAS","RESULTADO"],groups,notes:["Horas previstas e efetivas do site para o turno já encerrado, com consolidação após o fim de cada jornada.","Tolerância de 5 minutos. Cadastro divergente, ajustes, justificativas respondidas e fechamentos pendentes ficam fora da classificação."]} satisfies AdsOperationalReport;
}
async function loadRequired(lob:VideoCommentsAlertLob,plan:AdsAlertPlan){
  const days=adsWeekDays(plan.referenceDate);
  const rows=await prisma.$queryRaw<Array<{day:string;shift:string;startsAt:string;endsAt:string;required:number|null;planned:number;scheduleRows:number}>>(Prisma.sql`
    WITH days AS (SELECT generate_series(${days[0]}::date,${days.at(-1)}::date,interval '1 day')::date AS day),shifts AS (SELECT id,name,"startsAt","endsAt" FROM "Shift" WHERE name IN ('Manhã','Tarde','Noite'))
    SELECT to_char(d.day,'YYYY-MM-DD') AS day,sh.name AS shift,sh."startsAt",sh."endsAt",c."requiredStaff" AS required,
      count(DISTINCT s."employeeId") FILTER(WHERE s.status::text IN (${Prisma.join(ADS_PLANNED_SCHEDULE_STATUSES)}) AND (s.status::text<>'TROCA_APROVADA' OR (nullif(trim(s."startsAt"),'') IS NOT NULL AND nullif(trim(s."endsAt"),'') IS NOT NULL)))::int AS planned,count(s.id)::int AS "scheduleRows"
    FROM days d CROSS JOIN shifts sh JOIN "Lob" l ON upper(trim(l.name))=${lob}
    LEFT JOIN "StaffCoverage" c ON c.date=d.day AND c."shiftId"=sh.id AND c."lobId"=l.id
    LEFT JOIN "Schedule" s ON s.date=d.day AND s."shiftId"=sh.id AND s."lobId"=l.id AND s."deletedAt" IS NULL
      AND EXISTS(SELECT 1 FROM "EmployeeProfile" e WHERE e.id=s."employeeId" AND e."lobId"=l.id AND e."deletedAt" IS NULL AND e."roleTitle"='Agente' AND lower(trim(e."operationalStatus")) IN ('ativo','active','nesting'))
    GROUP BY d.day,sh.id,sh.name,sh."startsAt",sh."endsAt",c."requiredStaff" ORDER BY d.day,sh."startsAt"
  `);
  if(rows.length!==days.length*3)return videoCommentsPendingReport(lob,plan,"Cadastro dos três turnos ainda incompleto.");
  const report=scopeVideoCommentsReport(requiredOperationalReport(plan,rows.map(row=>({...row,planned:row.scheduleRows?row.planned:null}))),lob),missing=rows.filter(row=>row.required===null).length;
  for(const group of report.groups)for(const row of group.rows)row.detail=row.cells[1].value==="—"?"Escala não cadastrada":"Agentes escalados no dia";
  if(missing){report.metrics[1]={label:"REQUERIDO DE "+lob,value:missing===rows.length?"Não cadastrado":missing+" turnos pendentes"};report.summary="Escala disponível · comparação pendente nos turnos sem requerido";}
  return report;
}
export async function readVideoCommentsOperationalReport(lob:VideoCommentsAlertLob,plan:AdsAlertPlan,now:Date,context=createVideoCommentsDataContext()):Promise<AdsOperationalReport>{
  if(plan.kind==="volume")return loadVolume(lob,plan,now);
  if(plan.kind==="lateness")return loadLateness(lob,plan);
  if(plan.kind==="hours")return loadHours(lob,plan);
  if(plan.kind==="required")return loadRequired(lob,plan);
  const hourly=await context.hourly(lob,plan);if(!hourly)return videoCommentsPendingReport(lob,plan,"As 13 coletas ainda não formam uma hora válida.");
  if(plan.kind==="aht")return loadAht(lob,plan,hourly);
  const report=scopeVideoCommentsReport(productivityOperationalReport(plan,hourly.evaluated,hourly.excluded),lob);
  if(!hourly.evaluated.length){report.summary="Sem agente com leitura e jornada comparável para a hora inteira";report.groups=[{title:"Avaliação deste corte",rows:[{name:lob,detail:"Conferir jornada e consolidação antes de avaliar desempenho",cells:[cell("—","muted"),cell("Sem avaliação","muted")]}]}];}
  if(!hourly.evaluated.some(a=>a.submit>0&&a.submit<35&&a.moderationMs<2_700_000)&&hourly.evaluated.length){report.summary="Nenhum caso abaixo dos dois limites · leituras reais da hora";report.groups=bySupervisor(hourly.evaluated.map(a=>({name:a.name,detail:a.wbLogin,supervisor:a.supervisorName,cells:[cell(String(a.submit),"blue"),cell(moderationMinutesLabel(a.moderationMs),"blue")]})));}
  return report;
}
