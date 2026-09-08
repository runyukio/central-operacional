import assert from "node:assert/strict";
import test, { beforeEach, type TestContext } from "node:test";
import { Prisma } from "@prisma/client";
import { cecFrtDay, cecFrtLogin, cecFrtMetrics, cecFrtPriority, emptyCecFrt, parseCecFrtRows } from "./cec-frt";
import { buildCecFrtDashboard, cecFrtPeriod, getCecFrtDashboard, importCecFrtSnapshot, loadCecFrtDays, type CecFrtDayRow } from "./cec-frt-service";
import { prisma } from "./prisma";

function raw(patch: Record<string, unknown> = {}) { return { "ticket_base_created_at(年月日)": "2026-09-07", ticket_agent_email: "WB_KAUAN06@kuaishou.com", merge_group_name_group_priority: "Normal",
  "first_reply_time_over_240_count(求和)": 20, "first_reply_time_over_0_count(求和)": 100, "first_reply_time_over_1440_count(求和)": 10, ...patch }; }
test("CEC reads actual Chinese-suffixed headers and crosses email by normalized WB", () => {
  assert.deepEqual(parseCecFrtRows([raw()]), { rows: [{ day: "2026-09-07", wbLogin: "wb_kauan06", priority: "NORMAL", total: 100, over240: 20, over1440: 10 }], errors: [], errorCount: 0 });
  assert.equal(cecFrtLogin(" wb_kauan06@kuaishou.com "), "wb_kauan06");
  assert.equal(cecFrtLogin("wb_mateus05@kuashou.com"), "wb_mateus05");
  assert.equal(cecFrtPriority("PO"), "P0"); assert.equal(cecFrtPriority("p0"), "P0"); assert.equal(cecFrtPriority(" HM "), "HM"); assert.equal(cecFrtPriority("Unknown"), null);
});
test("CEC validates dates without timezone movement or invalid calendar rollover", () => {
  assert.equal(cecFrtDay("2026-02-30"), null); assert.equal(cecFrtDay("2024-02-29"), "2024-02-29");
  assert.equal(cecFrtDay(new Date("2026-09-07T00:00:00Z")), "2026-09-07"); assert.equal(cecFrtDay(46272), "2026-09-07");
  assert.equal(cecFrtDay("2026-09-07 14:00"), null);
  assert.equal(cecFrtDay(Number.MAX_VALUE), null);
});
test("CEC rejects missing columns, unknown priorities, malformed identities, invalid and inconsistent counts", () => {
  assert.throws(() => parseCecFrtRows([]), /vazia/); assert.throws(() => parseCecFrtRows([{ unexpected: 1 }]), /Colunas ausentes/);
  assert.throws(() => parseCecFrtRows([raw({first_reply_time_over_0_count: 100})]), /Colunas repetidas/);
  for (const value of [null, "", -1, 2.5, true, 2147483648, "NaN"]) assert.equal(parseCecFrtRows([raw({ "first_reply_time_over_0_count(求和)": value })]).errorCount, 1);
  assert.equal(parseCecFrtRows([raw({ "first_reply_time_over_1440_count(求和)": 21 })]).errorCount, 1);
  assert.equal(parseCecFrtRows([raw({ ticket_agent_email: "wb_test@@other.com" })]).errorCount, 1);
  assert.equal(parseCecFrtRows([raw({ merge_group_name_group_priority: "other" })]).errorCount, 1);
  assert.equal(parseCecFrtRows([raw(),raw()]).errorCount, 1);
  assert.equal(parseCecFrtRows([raw({merge_group_name_group_priority:"PO"}),raw({merge_group_name_group_priority:"P0"})]).errorCount,1);
});
test("CEC zero denominator remains unavailable, measured perfect SLA remains 100 and all late remains 0", () => {
  assert.deepEqual(cecFrtMetrics(emptyCecFrt()), { ...emptyCecFrt(), normalSla: null, urgentSla: null });
  assert.equal(cecFrtMetrics({ ...emptyCecFrt(), normalTotal: 10 }).normalSla, 100);
  assert.equal(cecFrtMetrics({ ...emptyCecFrt(), urgentTotal: 10, urgentOver: 10 }).urgentSla, 0);
});
const period = { startDate: "2026-09-01", endDate: "2026-09-07", view: "daily" as const };
function dayRow(id: string, day: string, patch: Partial<CecFrtDayRow> = {}): CecFrtDayRow { return {
  ...emptyCecFrt(), employeeId: id, wbLogin: `wb_${id}`, day: new Date(day), name: id, skill: "CEC", supervisorId: "sup", supervisor: "Supervisor", records: 1, updatedAt: new Date("2026-09-08"), ...patch
}; }
test("CEC weighted SLA separates priorities and reconciles day, agent, supervisor; CPD has its own denominator", () => {
  const rows = [dayRow("a","2026-09-01",{normalTotal:10,normalOver:10,urgentTotal:10,urgentOver:2}), dayRow("b","2026-09-02",{normalTotal:90,normalOver:0,urgentTotal:30,urgentOver:2})];
  const cpd = [{...rows[0],tickets:100},{...rows[0],tickets:50},{...rows[1],tickets:50}];
  const data = buildCecFrtDashboard(period, rows, cpd);
  assert.equal(data.summary.normalSla,90); assert.equal(data.summary.urgentSla,90); // not the 50% / 86.67% simple means
  assert.equal(data.output,200); assert.equal(data.cpd,100); assert.equal(data.agentDays,2);
  assert.equal(data.supervisors[0].normalSla,90); assert.equal(data.agents[0].normalSla,0); assert.equal(data.trend[0].normalSla,0);
  assert.equal(data.trend.reduce((n,r)=>n+r.normalTotal,0),data.summary.normalTotal);
  for (const view of ["weekly","monthly"] as const) {
    const grouped=buildCecFrtDashboard({...period,view},rows,cpd);
    assert.equal(grouped.trend.length,1);assert.equal(grouped.trend[0].normalSla,90);assert.equal(grouped.trend[0].cpd,100);
  }
});
test("CEC preserves unlinked queue totals and distinguishes absent CPD from actual zero", () => {
  const row=dayRow("external","2026-09-01",{employeeId:null,supervisorId:null,normalTotal:20});
  const a=buildCecFrtDashboard(period,[row],[]);
  assert.equal(a.coverage.unmatchedRows,1);assert.equal(a.summary.normalSla,100);assert.equal(a.output,null);assert.equal(a.agents[0].linked,false);
  const b=buildCecFrtDashboard(period,[],[{...row,tickets:0}]);assert.equal(b.output,0);assert.equal(b.cpd,null);assert.equal(b.summary.normalSla,null);
});
test("CEC limits query periods, explicitly rejects fabricated hourly FRT", () => {
  assert.deepEqual(cecFrtPeriod(new URLSearchParams(),"2026-09-07"),period);
  for(const q of ["view=hourly","startDate=2026-02-30","startDate=2026-09-08&endDate=2026-09-07","startDate=2020-01-01&endDate=2026-09-07"]) assert.throws(()=>cecFrtPeriod(new URLSearchParams(q),"2026-09-07"));
});

beforeEach((t) => {
  for(const model of ["user","employeeProfile","performanceImportBatch","performanceCecFrtRecord"] as const) {
    const original=prisma[model]; (prisma as any)[model]=Object.fromEntries(["findUnique","findFirst","findMany","create","createMany","update","deleteMany"].map((name)=>[name,async()=>{throw new Error(`Unmocked ${model}.${name}`);} ]));
    (t as TestContext).after(()=>{(prisma as any)[model]=original;});
  }
});
const actor={email:"test@example.test",name:"Test",role:"ADMIN" as const};
const user=(role:string)=>({id:"u",email:actor.email,name:actor.name,status:"ACTIVE",deletedAt:null,role:{name:role},employeeProfile:null});
test("CEC import authorization is database-driven and deny happens before writes",async(t)=>{
  for(const role of ["SUPERVISOR","GESTOR","COLABORADOR","POC"]) {
    t.mock.method(prisma.user,"findUnique",async()=>user(role));await assert.rejects(()=>importCecFrtSnapshot(actor,[raw()],"frt.xlsx"),/Apenas ADMIN ou WFM/i);
  }
});
test("CEC validates entire upload before creating a snapshot; all previous datasets stay untouched on validation error",async(t)=>{
  t.mock.method(prisma.user,"findUnique",async()=>user("WFM"));
  await assert.rejects(()=>importCecFrtSnapshot(actor,[raw(),raw()],"frt.xlsx"),/base anterior foi preservada/i);
});
test("CEC snapshot staging links WB, publishes atomically and deletes ONLY completed CEC FRT batches",async(t)=>{
  t.mock.method(prisma.user,"findUnique",async()=>user("ADMIN"));
  t.mock.method(prisma,"$queryRaw",async(sql:Prisma.Sql)=>{assert.match(sql.text,/lower\(trim/);assert.ok(sql.values.includes("wb_kauan06"));return [{id:"agent",wbLogin:"wb_kauan06"}];});
  t.mock.method(prisma.performanceImportBatch,"create",async(args:any)=>{assert.equal(args.data.status,"PROCESSING");assert.equal(args.data.type,"CEC_FRT");return{id:"new"};});
  t.mock.method(prisma.performanceCecFrtRecord,"createMany",async(args:any)=>{assert.equal(args.data[0].employeeId,"agent");assert.equal(args.data[0].total,100);return{count:1};});
  let published=false,pruned=false;
  t.mock.method(prisma,"$transaction",async(fn:any)=>fn({$queryRaw:async()=>[],performanceImportBatch:{
    update:async(args:any)=>{assert.equal(args.data.status,"SUCCESS");published=true;},
    deleteMany:async(args:any)=>{assert.equal(published,true);assert.deepEqual(args.where,{type:"CEC_FRT",status:{not:"PROCESSING"},id:{not:"new"}});pruned=true;}
  }}));
  const result=await importCecFrtSnapshot(actor,[raw()],"frt.xlsx");assert.equal(result.cecFrtRows,1);assert.equal(pruned,true);
});
test("CEC database failure removes only its unfinished staging batch",async(t)=>{
  t.mock.method(prisma.user,"findUnique",async()=>user("ADMIN"));t.mock.method(prisma,"$queryRaw",async()=>[]);
  t.mock.method(prisma.performanceImportBatch,"create",async()=>({id:"failed"}));
  t.mock.method(prisma.performanceCecFrtRecord,"createMany",async()=>{throw new Error("write failed");});
  t.mock.method(prisma.performanceImportBatch,"deleteMany",async(args:any)=>{assert.deepEqual(args.where,{id:"failed",status:"PROCESSING"});return{count:1};});
  await assert.rejects(()=>importCecFrtSnapshot(actor,[raw()],"frt.xlsx"),/write failed/);
});
test("CEC metrics filter successful batches and trusted employee IDs before aggregate",async(t)=>{
  t.mock.method(prisma,"$queryRaw",async(sql:Prisma.Sql)=>{assert.match(sql.text,/b.status='SUCCESS'/);assert.match(sql.text,/f\."employeeId" IN/);assert.ok(sql.values.includes("mine"));assert.match(sql.text,/f\.priority='NORMAL'/);assert.match(sql.text,/f\.priority IN \('P0','HM'\)/);return[];});
  assert.deepEqual(await loadCecFrtDays(new Date(period.startDate),new Date(period.endDate),["mine"]),[]);
  assert.deepEqual(await loadCecFrtDays(new Date(period.startDate),new Date(period.endDate),[]),[]);
});
test("CEC read rejects inactive/deleted and unauthorized personal profiles before data access",async(t)=>{
  for(const u of [{...user("ADMIN"),status:"INACTIVE"},{...user("ADMIN"),deletedAt:new Date()},user("COLABORADOR"),user("POC")]) {
    t.mock.method(prisma.user,"findUnique",async()=>u); await assert.rejects(()=>getCecFrtDashboard(actor,new URLSearchParams()));
  }
});
