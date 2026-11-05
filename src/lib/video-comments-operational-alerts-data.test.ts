import assert from "node:assert/strict";
import test from "node:test";
import {prisma} from "./prisma";
import {mockPrismaDelegate} from "./prisma-test-delegate";
import {readVideoCommentsOperationalReport} from "./video-comments-operational-alerts-data";
import {videoCommentsQueueHour} from "./video-comments-operational-alerts-core";
import type {AdsAlertPlan} from "./ads-operational-alerts-core";

const night:AdsAlertPlan={kind:"hours",referenceDate:"2026-11-04",start:"2026-11-04 23:00",end:"2026-11-05 08:00",periodKey:"hours-test"};
const row={scheduleId:"s",employeeId:"agent",day:"2026-11-04",status:"PRESENTE",startsAt:"23:00",endsAt:"08:00",profileStart:"23:00",profileEnd:"08:00",wbLogin:"wb_one",name:"Agent",supervisor:"S",shift:"Noite",profiles:1};
test("hours classify only post-end consolidated records and keep open adjustments pending",async t=>{
  t.mock.method(prisma,"$queryRaw",async()=>[row,{...row,scheduleId:"pending",name:"Pending"},{...row,scheduleId:"adjustment",name:"Adjustment"}]);
  const base={plannedStart:"23:00",plannedEnd:"08:00",plannedHours:8,effectiveHours:7,differenceMinutes:-60,status:"IMPORTED",adjustments:[]};
  mockPrismaDelegate(t,"workHourRecord",{findMany:async()=>[
    {...base,scheduleId:"s",updatedAt:new Date("2026-11-05T11:30:00Z")},
    {...base,scheduleId:"pending",updatedAt:new Date("2026-11-05T10:59:59Z")},
    {...base,scheduleId:"adjustment",updatedAt:new Date("2026-11-05T11:30:00Z"),adjustments:[{id:"a"}]}
  ]});
  mockPrismaDelegate(t,"workHourAdherenceJustification",{findMany:async()=>[]});
  const report=await readVideoCommentsOperationalReport("VIDEO",night,new Date("2026-11-05T12:00:00Z"));
  assert.equal(report.metrics[0].value,"1 agentes");assert.equal(report.metrics[1].value,"1 casos");assert.match(report.summary,/2 pendências/);
  assert.equal(report.groups[0].rows[0].cells[1].value,"-60 min");
  assert.match(report.groups[1].rows[0].detail,/Fechamento pendente/);assert.match(report.groups[1].rows[1].detail,/Ajuste em análise/);
});
test("legacy heartbeat query has employee and unique-WB binding without a missing-session filter",async t=>{
  let captures=0;
  t.mock.method(prisma,"$queryRaw",async(query:unknown)=>{const q=query as {strings:string[];values:unknown[]};if(q.strings.join("").includes('FROM "Schedule"'))return [{...row,day:"2026-11-05",startsAt:"14:00",endsAt:"23:00",profileStart:"14:00",profileEnd:"23:00",shift:"Tarde"}];captures++;assert.ok(q.values.includes("wb_one"));assert.ok(q.values.includes("agent"));assert.ok(!q.strings.join("").includes("SESSION_START"));return [{at:new Date("2026-11-05T17:10:00Z")}];});
  const report=await readVideoCommentsOperationalReport("VIDEO",{...night,kind:"lateness",referenceDate:"2026-11-05",start:"2026-11-05 14:00",end:"2026-11-05 15:00"},new Date("2026-11-05T18:00:00Z"));
  assert.equal(captures,1);assert.match(report.summary,/1 a conferir/);assert.equal(report.groups[0].rows[0].cells[1].value,"14:10:00");
});
test("missing required is pending and absent afternoon planning becomes a dash",async t=>{
  const rows=Array.from({length:12},(_,i)=>({day:`2026-11-${String(5+Math.floor(i/3)).padStart(2,"0")}`,shift:["Manhã","Tarde","Noite"][i%3],startsAt:["08:00","14:00","23:00"][i%3],endsAt:["17:00","23:00","08:00"][i%3],required:null,planned:i%3===1?0:2,scheduleRows:i%3===1?0:2}));
  t.mock.method(prisma,"$queryRaw",async(query:unknown)=>{assert.ok((query as {values:unknown[]}).values.includes("COMMENTS"));return rows;});
  const report=await readVideoCommentsOperationalReport("COMMENTS",{...night,kind:"required",referenceDate:"2026-11-05"},new Date());
  assert.equal(report.metrics[1].value,"Não cadastrado");assert.equal(report.groups[0].rows[0].cells[0].value,"—");assert.equal(report.groups[0].rows[1].cells[1].value,"—");assert.equal(report.groups[0].rows[1].cells[2].value,"Pendente");
});
test("midnight counter correction cannot masquerade as a daily reset",()=>{
  const rows=Array.from({length:13},(_,i)=>({cycle:new Date(Date.parse("2026-11-05T23:00:00Z")+i*300_000).toISOString().slice(0,16).replace("T"," "),queueId:"q",input:i===12?0:100+i,backlog:5,sourceRows:1}));
  assert.equal(videoCommentsQueueHour({...night,start:"2026-11-05 23:00",end:"2026-11-06 00:00"},rows),null);
});
