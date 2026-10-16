import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildForecastDisplay, forecastCycleLabel, type ForecastPayload } from "./volume-forecast-display";
import { buildAdsExecutiveReportSnapshot } from "./ads-executive-report-core";
import { VOLUME_FORECAST_POLICIES } from "./volume-forecast-policies";
const day = "2026-09-20", H = 3600000;
function series(value: number): ForecastPayload["series"][number] {
  const points=Array.from({length:24}, (_,hour) => ({dateKey:day,hour,input:value,model:VOLUME_FORECAST_POLICIES.ADS.id,cutoff:day}));
  return { lob: "ADS", points, baselinePoints:points, adaptive:null, actuals: [], latestVolumeAt:null, updatedAt:null, version:"test",modelVersion:"test",modelLabel:VOLUME_FORECAST_POLICIES.ADS.label,cutoff:day,evaluation:null,warnings:[] };
}
function payload(rows = [series(10)]): ForecastPayload { return { today:day,horizon:1,canImport:false,lobs:["ADS"],warnings:[],series:rows }; }
test("Real Time cycle labels preserve Brasil operational time in any browser timezone", () => {
  const timezone=process.env.TZ;
  try {
    process.env.TZ="America/Sao_Paulo";
    assert.equal(forecastCycleLabel("2026-10-16 12:00"),"16/10 · 12:00");
    assert.equal(forecastCycleLabel("2026-10-16_12-30"),"16/10 · 12:30");
    assert.equal(forecastCycleLabel("2026-10-16T12:30:00.000Z"),"16/10 · 12:30");
    assert.equal(forecastCycleLabel("2026-02-31 12:00"),"Sem dados");
    assert.equal(forecastCycleLabel(null),"Sem dados");
  } finally { if (timezone===undefined) delete process.env.TZ; else process.env.TZ=timezone; }
});
test("Performance hours, daily totals and executive exports use identical server points, including zero", () => {
  const source=series(10); source.points[0].input=0;
  const hourly=buildForecastDisplay(payload([source]),1,"hour"),daily=buildForecastDisplay(payload([source]),1,"day");
  const report=buildAdsExecutiveReportSnapshot({selectedCycle:`${day} 12:00`,queueRows:[],agentRows:[],forecast:source.points});
  assert.deepEqual(hourly.chartRows.map(r=>r.forecast),report.buckets.map(r=>r.forecast));
  assert.equal(daily.chartRows[0].forecast,230); assert.equal(daily.next24h,230); assert.equal(hourly.horizonTotal,230);
});
test("ALL is the sum of LOB forecasts, not an independently fitted model", () => {
  const result=buildForecastDisplay(payload([series(10),{...series(20),lob:"VIDEO"}]),1,"day");
  assert.equal(result.horizonTotal,720);assert.equal(result.chartRows[0].forecast,720);
});
test("incomplete source coverage is unavailable, never a full total or observed zero", () => {
  const source=series(0);source.points.pop();
  const result=buildForecastDisplay(payload([source]),1,"day");
  assert.equal(result.next24h,null);assert.equal(result.chartRows[0].forecast,null);assert.equal(result.chartRows[0].real,null);
  assert.equal(buildForecastDisplay(payload([series(0)]),1,"day").next24h,0);
  assert.equal(buildForecastDisplay(null,1,"day").next24h,null);
});
test("partial actual days cannot be compared with full-day forecasts", () => {
  const source=series(10);source.actuals=Array.from({length:12},(_,hour)=>({at:new Date(Date.parse(day)+hour*H).toISOString(),input:5,complete:true,source:"Performance" as const}));
  const result=buildForecastDisplay(payload([source]),1,"day");
  assert.equal(result.chartRows[0].real,60);assert.equal(result.chartRows[0].realComplete,false);assert.equal(result.chartRows[0].forecast,240);
});
test("a partial Real Time bucket never becomes a complete actual hour or day", () => {
  const source=Object.assign(series(10), {actuals:Array.from({length:24},(_,hour)=>({at:new Date(Date.parse(day)+hour*H).toISOString(),input:5,complete:hour!==23,source:"Real Time" as const}))});
  const hourly=buildForecastDisplay(payload([source]),1,"hour"),daily=buildForecastDisplay(payload([source]),1,"day");
  assert.equal(hourly.chartRows[22].realComplete,true);
  assert.equal(hourly.chartRows[23].real,5);assert.equal(hourly.chartRows[23].realComplete,false);
  assert.equal(daily.chartRows[0].real,120);assert.equal(daily.chartRows[0].realComplete,false);
});
test("intraday metadata and historical baseline remain separate from server-issued operational points", () => {
  const source=Object.assign(series(10), {
    baselinePoints:series(20).points,
    adaptive:{status:"active" as const,cycle:`${day} 11:30`,importedAt:`${day}T14:35:00.000Z`,info:{active:true,referenceToday:480,actualToday:100,expectedToCycle:230,remainingToday:140,baseRemainingToday:250,updatedDayEstimate:240,observedUntil:Date.parse(day)+11.5*H}}
  });
  const result=buildForecastDisplay(payload([source]),1,"day");
  assert.equal(result.chartRows[0].forecast,240);assert.equal(result.chartRows[0].baseline,480);
  assert.equal(result.next24h,240);assert.equal(result.adaptive?.referenceToday,480);
  assert.equal(result.adaptive?.actualToday,100);assert.equal(result.adaptive?.remainingToday,140);assert.equal(result.adaptive?.updatedDayEstimate,240);
  assert.equal(result.hasBaseline,true);
  const all=buildForecastDisplay(payload([source,{...series(5),lob:"VIDEO"}]),1,"day");
  assert.equal(all.adaptive,null);assert.equal(all.chartRows[0].forecast,360);assert.equal(all.chartRows[0].baseline,600);
});
test("unavailable or stale intraday sources never display adaptive summaries", () => {
  for (const status of ["stale","unavailable"] as const) {
    const source=Object.assign(series(10),{adaptive:{status,cycle:`${day} 11:30`,importedAt:null,info:{active:true,actualToday:500}}});
    const result=buildForecastDisplay(payload([source]),1,"day");
    assert.equal(result.adaptive,null);assert.equal(result.hasBaseline,true);assert.equal(result.baselineToday,240);
    assert.equal(result.next24h,240);assert.ok(result.warnings.some(w => /base histórica/.test(w)));
    assert.ok(result.warnings.some(w => status === "stale" ? /desatualizada/.test(w) : /não está disponível/.test(w)));
  }
  const inactive=Object.assign(series(10),{adaptive:{status:"active" as const,cycle:null,importedAt:null,info:{active:false}}});
  assert.equal(buildForecastDisplay(payload([inactive]),1,"day").adaptive,null);
  const suspended=Object.assign(series(10),{points:[],adaptive:{status:"unavailable" as const,cycle:null,importedAt:null,info:null}});
  const result=buildForecastDisplay(payload([suspended]),1,"day");
  assert.equal(result.next24h,null);assert.equal(result.baselineToday,240);assert.equal(result.hasBaseline,true);assert.equal(result.chartRows[0].forecast,null);assert.equal(result.chartRows[0].baseline,240);
  assert.equal(result.projectedUntil,null);assert.equal(result.hasForecast,false);
  assert.ok(result.warnings.some(w => /previsão operacional de hoje está suspensa/.test(w)));
});
test("LOB policies are distinct and centrally controlled", () => {
  assert.equal(new Set(Object.values(VOLUME_FORECAST_POLICIES).map(p=>p.id)).size,3);
  assert.equal(VOLUME_FORECAST_POLICIES.ADS.id,"ads-robust-prior");
  assert.equal(VOLUME_FORECAST_POLICIES.VIDEO.id,"daily-3-h0-profile-120-all");
  assert.equal(VOLUME_FORECAST_POLICIES.COMMENTS.id,"weekday-28d-h7");
});
test("daily accuracy does not conceal hourly timing error and labels come from the canonical source", () => {
  const source = series(100);
  source.evaluation = { hours:24,days:1,actual:2400,predicted:2400,absoluteError:200,dailyAbsoluteError:0,wape:200/2400,accuracy:1-200/2400,dailyAccuracy:1,bias:0,
    rows:Array.from({length:24},(_,hour)=>({date:day,hour,actual:100,forecast:hour===0?0:hour===1?200:100,model:VOLUME_FORECAST_POLICIES.ADS.id})) };
  const result = buildForecastDisplay(payload([source]),1,"hour");
  assert.equal(result.dailyAccuracy,1);assert.equal(result.accuracy,1-200/2400);assert.equal(result.evaluatedHours,24);
  assert.deepEqual(result.modelLabels,[VOLUME_FORECAST_POLICIES.ADS.label]);
});
test("active consumers cannot reintroduce independent volume models or workbook forecasts", () => {
  const source=(file:string)=>readFileSync(new URL(file,import.meta.url),"utf8");
  for(const file of ["../components/realtime-page.tsx","../components/performance-automation-page.tsx"]) {
    assert.match(source(file),/\/api\/performance\/forecast/);
    assert.doesNotMatch(source(file),/function (?:predictForecastHour|calculateForecastModelWeights|buildForecastModel|buildExecutivePerformanceForecastHistory)\(/);
  }
  for(const file of ["executive-forecast-service.ts","ads-requirement-planning-service.ts"]) {
    assert.match(source(file),/loadVolumeForecastRange/);assert.doesNotMatch(source(file),/predictForecastHour|calculateForecastModelWeights/);
  }
  assert.match(source("ads-backlog-hourly-report-core.ts"),/input\.forecast\.map/);
  assert.doesNotMatch(source("ads-backlog-hourly-report-core.ts"),/PLAN_VALUES|forecastVolume: \d/);
});
