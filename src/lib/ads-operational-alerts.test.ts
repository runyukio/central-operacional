import assert from "node:assert/strict";
import test from "node:test";
import { adsAlertPlans, adsAhtComparison, adsEligibleForHour, adsPendingReport, adsPreviewDispatchTime, adsScheduleConflict,
  adsWeekDays, type AdsAlertPlan, type AdsSchedule } from "./ads-operational-alerts-core";
import { hoursOperationalReport, requiredOperationalReport, volumeOperationalReport } from "./ads-operational-alerts-report";
import { operationalReportPages, ADS_OPERATIONAL_IMAGE_MAX_HEIGHT } from "./ads-operational-alerts-image";
import { deliverOperationalReport, operationalCronAuthorized, runOperationalAlerts, type AdsOperationalDeliveryStore } from "./ads-operational-alerts-service";

const instant=(local:string)=>new Date(`${local}-03:00`);
const plan=(kind:AdsAlertPlan["kind"]="productivity"):AdsAlertPlan=>({kind,referenceDate:"2026-10-28",start:"2026-10-28 15:00",end:"2026-10-28 16:00",periodKey:`${kind}:2026-10-28 16:00`});
const schedule:AdsSchedule={employeeId:"one",day:"2026-10-28",status:"ESCALADO",startsAt:"14:00",endsAt:"23:00",profileStart:"14:00",profileEnd:"23:00",wbLogin:"agent",name:"Agent",supervisor:"Supervisor"};
const env={enabled:"true",vercel:"production",webhook:"https://kim-robot.kwaitalk.com/api/robot/send?key=test-key"};

test("hourly dispatch covers only the closed hour and all three hourly reports",()=>{
  const plans=adsAlertPlans(instant("2026-10-28T16:03:00"),"hourly");
  assert.deepEqual(plans.map(p=>p.kind),["volume","productivity","aht"]);
  assert.ok(plans.every(p=>p.start==="2026-10-28 15:00"&&p.end==="2026-10-28 16:00"));
  assert.equal(adsAlertPlans(instant("2026-10-28T16:02:00"),"hourly").length,0);
  assert.equal(adsAlertPlans(instant("2026-10-28T16:13:00"),"hourly").length,0);
});
test("midnight separates previous afternoon hours from the new overnight shift",()=>{
  const plans=adsAlertPlans(instant("2026-10-29T00:00:00"),"shift");
  assert.equal(plans.find(p=>p.kind==="lateness")!.start,"2026-10-28 23:00");
  assert.equal(plans.find(p=>p.kind==="hours")!.start,"2026-10-28 14:00");
  assert.equal(plans.find(p=>p.kind==="hours")!.end,"2026-10-28 23:00");
  assert.ok(plans.every(p=>p.referenceDate==="2026-10-28"));
});
test("Monday midnight retains Sunday; the new week starts Monday at 09h",()=>{
  const midnight=adsAlertPlans(instant("2026-11-02T00:00:00"),"shift").find(p=>p.kind==="required")!;
  assert.deepEqual(adsWeekDays(midnight.referenceDate),["2026-11-01"]);
  const morning=adsAlertPlans(instant("2026-11-02T09:00:00"),"shift").find(p=>p.kind==="required")!;
  assert.deepEqual(adsWeekDays(morning.referenceDate),["2026-11-02","2026-11-03","2026-11-04","2026-11-05","2026-11-06","2026-11-07","2026-11-08"]);
});
test("shift schedule uses 09/15/00 for lateness/staffing and 09/18/00 for hours",()=>{
  assert.deepEqual(adsAlertPlans(instant("2026-10-28T09:00:00"),"shift").map(p=>p.kind),["lateness","hours","required"]);
  assert.deepEqual(adsAlertPlans(instant("2026-10-28T15:00:00"),"shift").map(p=>p.kind),["lateness","required"]);
  assert.deepEqual(adsAlertPlans(instant("2026-10-28T18:00:00"),"shift").map(p=>p.kind),["hours"]);
  assert.equal(adsAlertPlans(instant("2026-10-28T09:11:00"),"shift").length,0);
  const night=adsAlertPlans(instant("2026-10-28T09:00:00"),"shift").find(p=>p.kind==="hours")!;
  assert.equal(night.start,"2026-10-27 23:00");assert.equal(night.end,"2026-10-28 08:00");
});
test("weekly cut keys differ at 09h,15h and midnight",()=>{
  const keys=["2026-10-28T09:00:00","2026-10-28T15:00:00","2026-10-29T00:00:00"].map(t=>adsAlertPlans(instant(t),"shift").find(p=>p.kind==="required")!.periodKey);
  assert.equal(new Set(keys).size,3);
});
test("preview uses a valid dispatch without making arbitrary-date endpoints",()=>{
  const now=instant("2026-11-02T00:40:00");
  assert.equal(adsAlertPlans(adsPreviewDispatchTime(now,"shift"),"shift").find(p=>p.kind==="required")!.referenceDate,"2026-11-01");
  assert.equal(adsAlertPlans(adsPreviewDispatchTime(now,"hourly"),"hourly")[0].start,"2026-11-01 23:00");
});
test("no performance judgment before shift, in partial hours, or in known conflicting registration",()=>{
  assert.equal(adsEligibleForHour(schedule,{...plan(),start:"2026-10-28 13:00",end:"2026-10-28 14:00"},new Set()),false);
  assert.equal(adsEligibleForHour({...schedule,startsAt:"15:30"},plan(),new Set()),false);
  assert.equal(adsEligibleForHour({...schedule,wbLogin:"agent-known-conflict"},plan(),new Set(["agent-known-conflict"])),false);
  assert.equal(adsEligibleForHour(schedule,plan(),new Set()),true);
  assert.equal(adsScheduleConflict({...schedule,profileStart:"08:00"},new Set()),true);
});
test("overnight eligibility crosses midnight using the operational shift date",()=>{
  const row={...schedule,day:"2026-10-27",startsAt:"23:00",endsAt:"08:00",profileStart:"23:00",profileEnd:"08:00"};
  assert.equal(adsEligibleForHour(row,{...plan(),start:"2026-10-28 00:00",end:"2026-10-28 01:00"},new Set()),true);
});
test("AHT compares weighted totals in both directions and requires a real sample",()=>{
  const historical={submits:100,seconds:4000,days:3};
  assert.deepEqual(adsAhtComparison({submit:10,moderationMs:800000},historical),{baseline:40,actual:80,deviation:100,alert:true});
  assert.deepEqual(adsAhtComparison({submit:10,moderationMs:200000},historical),{baseline:40,actual:20,deviation:-50,alert:true});
  assert.equal(adsAhtComparison({submit:9,moderationMs:900000},historical),null);
  assert.equal(adsAhtComparison({submit:10,moderationMs:900000},{...historical,days:2}),null);
});
test("hours keep registration/adjustment pending apart from measured deficits",()=>{
  const report=hoursOperationalReport(plan("hours"),[
    {name:"Measured",wb:"one",supervisor:"A",planned:8,effective:7.7,deficit:18,pending:null},
    {name:"Conflict",wb:"two",supervisor:"A",planned:8,effective:4,deficit:240,pending:"Jornada divergente"}]);
  assert.match(report.summary,/1 déficit/);assert.equal(report.groups[0].rows.length,1);
  assert.match(report.groups[1].rows[0].cells[1].value,/validar/i);
});
test("volume zero forecast is not an infinite percentage; missing staffing remains missing",()=>{
  assert.equal(volumeOperationalReport(plan("volume"),{backlog:5,forecast:0,input:4}).groups[0].rows[0].cells[2].value,"Sem base");
  const report=requiredOperationalReport(plan("required"),[{day:"2026-10-28",shift:"Manhã",startsAt:"08:00",endsAt:"17:00",required:10,planned:null}]);
  assert.equal(report.groups[0].rows[0].cells[2].value,"Pendente");
});
test("pagination preserves every row and enforces image height",()=>{
  const report=adsPendingReport(plan());
  report.groups=[{title:"Supervisor",rows:Array.from({length:100},(_,i)=>({name:`Agent ${i}`,detail:`wb_${i}`,cells:[{value:"1"},{value:"1m"}]}))}];
  const pages=operationalReportPages(report);
  assert.ok(pages.length>1);assert.ok(pages.every(p=>p.height<=ADS_OPERATIONAL_IMAGE_MAX_HEIGHT));
  assert.equal(pages.flatMap(p=>p.groups.flatMap(g=>g.rows)).length,100);
});
test("cron authorization fails closed",()=>{
  assert.equal(operationalCronAuthorized(new Request("https://example.test"),undefined),false);
  assert.equal(operationalCronAuthorized(new Request("https://example.test",{headers:{authorization:"Bearer wrong"}}),"secret"),false);
  assert.equal(operationalCronAuthorized(new Request("https://example.test",{headers:{authorization:"Bearer secret"}}),"secret"),true);
});
test("preview deployments cannot send even when enabled; dry-run never invokes delivery",async()=>{
  let sent=0;
  const deps={environment:{...env,vercel:"preview"},read:async(p:AdsAlertPlan)=>adsPendingReport(p),deliver:async()=>{sent++;return{status:"sent" as const,sent:1};}};
  assert.equal((await runOperationalAlerts("hourly",{now:instant("2026-10-28T16:03:00")},deps)).status,"skipped");
  const preview=await runOperationalAlerts("hourly",{now:instant("2026-10-28T16:40:00"),dryRun:true},deps);
  assert.equal(preview.reports.length,3);assert.equal(sent,0);
});
function deliveryStore(){
  const claims=new Set<string>();const finishes:Array<{status:string;keys:string[]}>=[];
  const value:AdsOperationalDeliveryStore={claim:async key=>{if(claims.has(key))return false;claims.add(key);return true;},finish:async(_key,status,keys)=>{finishes.push({status,keys:[...keys]});}};
  return {value,finishes};
}
test("duplicate report claims do not upload or send again",async()=>{
  const receipt=deliveryStore();let calls=0,uploads=0;
  const deps={store:receipt.value,prepare:async()=>{uploads++;return["ks://image-one"];},fetcher:async()=>{calls++;return Response.json({status:200,data:{messageKey:'["confirmed"]'}});}};
  const report=adsPendingReport(plan());
  await deliverOperationalReport(report,env.webhook,deps);
  assert.equal((await deliverOperationalReport(report,env.webhook,deps)).status,"already_claimed");
  assert.equal(uploads,1);assert.equal(calls,1);assert.equal(receipt.finishes.at(-1)!.status,"sent");
});
test("partial delivery retains confirmed keys and blocks automatic resend",async()=>{
  const receipt=deliveryStore();let calls=0;
  const deps={store:receipt.value,prepare:async()=>["ks://one","ks://two"],fetcher:async()=>{calls++;if(calls===2)throw new Error("timeout");return Response.json({status:200,data:{messageKey:'["first"]'}});}};
  const report=adsPendingReport(plan());
  await assert.rejects(deliverOperationalReport(report,env.webhook,deps),/uncertain/);
  assert.equal(receipt.finishes.at(-1)!.status,"uncertain");assert.equal(receipt.finishes.at(-1)!.keys.length,1);
  assert.equal((await deliverOperationalReport(report,env.webhook,deps)).status,"already_claimed");assert.equal(calls,2);
});
