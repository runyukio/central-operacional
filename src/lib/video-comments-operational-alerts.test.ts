import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {unstable_doesMiddlewareMatch} from "next/experimental/testing/server";
import {evaluateAdsProductivityHour,type AlertReading} from "./ads-productivity-alert-core";
import {adsAlertPlans,adsPendingReport,adsWeekDays,type AdsAlertPlan,type AdsOperationalReport} from "./ads-operational-alerts-core";
import {volumeOperationalReport} from "./ads-operational-alerts-report";
import {deliverOperationalReport,type AdsOperationalDeliveryStore} from "./ads-operational-alerts-service";
import {scopeVideoCommentsReport,videoCommentsJourneyReport,videoCommentsQueueHour,videoCommentsShiftSchedules,type VideoCommentsSchedule} from "./video-comments-operational-alerts-core";
import {runVideoCommentsOperationalAlerts,videoCommentsCronRequestMode} from "./video-comments-operational-alerts-service";

const instant=(wall:string)=>new Date(wall+"-03:00");
const plan:AdsAlertPlan={kind:"productivity",referenceDate:"2026-11-05",start:"2026-11-05 14:00",end:"2026-11-05 15:00",periodKey:"productivity:2026-11-05 15:00"};
const environment={enabled:"true",vercel:"production",webhook:"https://kim-robot.kwaitalk.com/api/robot/send?key=test"};
function readings(lob:"ADS"|"VIDEO"|"COMMENTS"):AlertReading[]{return Array.from({length:13},(_,i)=>({cycle:new Date(Date.parse("2026-11-05T14:00:00Z")+i*300_000).toISOString().slice(0,16).replace("T"," "),employeeId:"one",name:"Agent",wbLogin:"wb_one",lob,personType:"Agente",employeeStatus:"Ativo",crossingStatus:"Encontrado",submit:100+i*2,moderationMs:3_600_000+i*120_000,sourceValid:true,observedPresence:true,supervisorId:"s",supervisorName:"Supervisor",supervisorWb:"wb_supervisor"}));}
const interval={start:plan.start,middle:"2026-11-05 14:30",end:plan.end};

test("explicit LOB reuses raw counter rules without allowing cross-LOB agents or changing default ADS",()=>{
  assert.equal(evaluateAdsProductivityHour(readings("ADS"),interval,true,5).offenders.length,1);
  for(const lob of ["VIDEO","COMMENTS"] as const){assert.equal(evaluateAdsProductivityHour(readings(lob),interval,true,5).evaluated.length,0);assert.equal(evaluateAdsProductivityHour(readings(lob),interval,true,5,lob).offenders.length,1);assert.equal(evaluateAdsProductivityHour(readings("ADS"),interval,true,5,lob).evaluated.length,0);}
});
test("missing/raw-invalid checkpoints are not classified as production",()=>{
  const source=readings("COMMENTS");source[5].sourceValid=false;
  assert.equal(evaluateAdsProductivityHour(source,interval,true,5,"COMMENTS").evaluated.length,0);
});
const schedule:VideoCommentsSchedule={scheduleId:"s",employeeId:"a",day:"2026-11-05",status:"ESCALADO",startsAt:"13:00",endsAt:"22:00",profileStart:"13:00",profileEnd:"22:00",wbLogin:"wb_one",name:"Agent",supervisor:"S",shift:"Tarde",profiles:1};
test("shift cuts use each individual VIDEO start, exclude folgas and future starts, and require completion",()=>{
  const late={...plan,kind:"lateness" as const};
  assert.equal(videoCommentsShiftSchedules([schedule],late,"lateness").length,1);
  assert.equal(videoCommentsShiftSchedules([{...schedule,startsAt:"15:00"}],late,"lateness").length,0);
  assert.equal(videoCommentsShiftSchedules([{...schedule,status:"FOLGA"}],late,"lateness").length,0);
  const hours={...plan,kind:"hours" as const,start:"2026-11-05 14:00",end:"2026-11-05 23:00"};
  assert.equal(videoCommentsShiftSchedules([schedule],hours,"hours").length,1);
  assert.equal(videoCommentsShiftSchedules([{...schedule,endsAt:"00:30"}],hours,"hours").length,0);
});
test("periodic captures are triage and missing captures/registration conflicts remain separate",()=>{
  const base={name:"Agent",wb:"wb",startsAt:"14:00",profileStart:"14:00",first:null,delay:null,pending:null};
  const report=videoCommentsJourneyReport("VIDEO",{...plan,kind:"lateness"},[
    {...base,name:"Signal",first:"2026-11-05T14:10:00",delay:600},
    {...base,name:"Missing"},
    {...base,name:"Conflict",pending:"Jornada divergente"}
  ]);
  assert.match(report.summary,/1 a conferir · 1 sem captura · 1 pendências/);
  assert.deepEqual(report.groups.map(g=>g.rows[0].name),["Signal","Missing","Conflict"]);
  assert.match(report.notes.join(" "),/não comprova chegada/);
  const empty=videoCommentsJourneyReport("COMMENTS",plan,[]);assert.equal(empty.metrics[0].value,"0 agentes");assert.equal(empty.groups[0].rows[0].name,"COMMENTS");
});
function queueRows(start="2026-11-05 14:00"){return Array.from({length:13},(_,i)=>({cycle:new Date(Date.parse(start.replace(" ","T")+":00Z")+i*300_000).toISOString().slice(0,16).replace("T"," "),queueId:"one",input:100+i*2,backlog:30-i,sourceRows:1}));}
test("volume uses interval increments and final stock; rejects missing/duplicate queues and unexpected drops",()=>{
  const rows=queueRows();assert.deepEqual(videoCommentsQueueHour(plan,rows),{input:24,backlog:18,queues:1,resets:0});
  assert.equal(videoCommentsQueueHour(plan,rows.slice(1)),null);
  assert.equal(videoCommentsQueueHour(plan,[...rows,rows[4]]),null);
  rows[4].input=1;assert.equal(videoCommentsQueueHour(plan,rows),null);
});
test("known daily reset is supported and midnight is not reset",()=>{
  const rows=queueRows("2026-11-05 13:00");for(let i=1;i<rows.length;i++)rows[i].input=i*2;
  assert.deepEqual(videoCommentsQueueHour({...plan,start:"2026-11-05 13:00",end:"2026-11-05 14:00"},rows),{input:24,backlog:18,queues:1,resets:1});
});
test("LOB labels change only fixed report copy, never supervisor or employee names",()=>{
  const volume=scopeVideoCommentsReport(volumeOperationalReport({...plan,kind:"volume"},{input:5,forecast:10,backlog:3}),"COMMENTS");
  assert.equal(volume.lob,"COMMENTS");assert.equal(volume.groups[0].rows[0].name,"COMMENTS · 14H");assert.match(volume.groups[0].title,/^COMMENTS/);
  const report=adsPendingReport(plan);report.pending=false;report.groups[0].title="Supervisor ADS";report.groups[0].rows[0].name="Agent ADS";
  const scoped=scopeVideoCommentsReport(report,"VIDEO");assert.equal(scoped.groups[0].title,"Supervisor ADS");assert.equal(scoped.groups[0].rows[0].name,"Agent ADS");
});
test("both LOBs inherit ADS schedule including prior-day Monday midnight and distinct staffing cuts",async()=>{
  const reads:Array<{lob:string;plan:AdsAlertPlan}>=[];
  const deps={environment,read:async(lob:"VIDEO"|"COMMENTS",p:AdsAlertPlan)=>{reads.push({lob,plan:p});return adsPendingReport(p);},deliver:async()=>({status:"sent" as const,sent:1})};
  const midnight=await runVideoCommentsOperationalAlerts("shift",{now:instant("2026-11-09T00:00:00"),dryRun:true},deps);
  assert.equal(midnight.reports.length,6);assert.ok(reads.every(r=>r.plan.referenceDate==="2026-11-08"));assert.deepEqual(adsWeekDays(reads[0].plan.referenceDate),["2026-11-08"]);
  reads.length=0;await runVideoCommentsOperationalAlerts("shift",{now:instant("2026-11-09T09:00:00"),dryRun:true},deps);assert.ok(reads.filter(r=>r.plan.kind!=="hours").every(r=>r.plan.referenceDate==="2026-11-09"));assert.ok(reads.filter(r=>r.plan.kind==="hours").every(r=>r.plan.referenceDate==="2026-11-08"));
  assert.equal(new Set(midnight.reports.map(r=>r.periodKey)).size,6);
  for(const [at,count] of [["09:00",6],["15:00",4],["18:00",2],["00:00",6]] as const){assert.equal((await runVideoCommentsOperationalAlerts("shift",{now:instant(`2026-11-05T${at}:00`),dryRun:true},deps)).reports.length,count);}
});
test("disabled/preview cannot send; protected preview cannot claim receipts or deliver",async()=>{
  let reads=0,sends=0;const deps={environment:{...environment,vercel:"preview"},read:async(_lob:"VIDEO"|"COMMENTS",p:AdsAlertPlan)=>{reads++;return adsPendingReport(p);},deliver:async()=>{sends++;return {status:"sent" as const,sent:1};}};
  assert.equal((await runVideoCommentsOperationalAlerts("hourly",{now:instant("2026-11-05T15:03:00")},deps)).status,"skipped");assert.equal(reads,0);
  const result=await runVideoCommentsOperationalAlerts("hourly",{now:instant("2026-11-05T15:40:00"),dryRun:true},deps);assert.equal(result.reports.length,6);assert.equal(sends,0);
  const disabled=await runVideoCommentsOperationalAlerts("hourly",{now:instant("2026-11-05T15:03:00")},{...deps,environment:{...environment,enabled:"false"}});assert.equal(disabled.status,"skipped");
});
test("reader failure becomes a correctly scoped pending card and does not stop the other LOB",async()=>{
  const sent:AdsOperationalReport[]=[];const result=await runVideoCommentsOperationalAlerts("hourly",{now:instant("2026-11-05T15:03:00")},{environment,read:async()=>{throw Error("Source unavailable");},deliver:async(report)=>{sent.push(report);return {status:"sent" as const,sent:1};}});
  assert.equal(result.status,"processed");assert.equal(sent.length,6);assert.ok(sent.every(r=>r.pending&&r.groups[0].rows[0].name===r.lob));
});
test("separate delivery namespaces prevent ADS/VIDEO/COMMENTS collisions and retain duplicate protection",async()=>{
  const keys=new Set<string>();let messages=0;
  const store:AdsOperationalDeliveryStore={claim:async key=>{if(keys.has(key))return false;keys.add(key);return true;},finish:async()=>{}};
  const deps={store,prepare:async()=>["ks://image"],fetcher:async()=>{messages++;return Response.json({status:200,data:{messageKey:["confirmed"]}});}};
  for(const lob of ["ADS","VIDEO","COMMENTS"] as const){const report={...adsPendingReport(plan),lob};await deliverOperationalReport(report,environment.webhook,deps);assert.equal((await deliverOperationalReport(report,environment.webhook,deps)).status,"already_claimed");}
  assert.equal(keys.size,3);assert.equal(messages,3);
});
test("verification token is limited to dry-run; real execution requires cron authorization",()=>{
  const req=(suffix:string,token:string)=>new Request("https://test/api/cron/video-comments-operational-alerts"+suffix,{headers:{authorization:"Bearer "+token}});
  assert.equal(videoCommentsCronRequestMode(req("","verify"),"cron","verify"),null);
  assert.equal(videoCommentsCronRequestMode(req("?dryRun=true","verify"),"cron","verify"),"preview");
  assert.equal(videoCommentsCronRequestMode(req("","cron"),"cron","verify"),"run");
  assert.equal(videoCommentsCronRequestMode(req("?dryRun=true","wrong"),"cron","verify"),null);
});
test("cron routes bypass browser sessions, keep API protection elsewhere, and trace both fonts",()=>{
  const middleware=readFileSync("src/middleware.ts","utf8"),matcher=JSON.parse(middleware.match(/matcher: (\[[^\n]+\])/u)![1]),crons=JSON.parse(readFileSync("vercel.json","utf8")).crons;
  for(const suffix of ["operational-alerts","shift-alerts"]){const route="/api/cron/video-comments-"+suffix;assert.equal(unstable_doesMiddlewareMatch({config:{matcher},url:"https://test"+route}),false);assert.ok(crons.some((c:{path:string})=>c.path===route));assert.ok(readFileSync("next.config.mjs","utf8").includes(route));}
  assert.equal(unstable_doesMiddlewareMatch({config:{matcher},url:"https://test/api/performance"}),true);
});
