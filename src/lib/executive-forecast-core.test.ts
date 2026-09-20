import assert from "node:assert/strict";
import test from "node:test";
import { createVolumeForecastEngine, evaluateVolumeForecast, forecastDates, operationalForecastToday } from "./volume-forecast-core";
const H=3600000;
const data=Array.from({length:24*35},(_,hour)=>({at:new Date(Date.UTC(2026,7,1,hour)),input:100+hour%24*3}));
test("one target/cutoff yields the same forecast irrespective of range or call order",()=>{
 const engine=createVolumeForecastEngine(data);
 const single=engine.predictDay("2026-09-10","2026-09-05");
 engine.predictDay("2026-09-11","2026-09-05");
 assert.deepEqual(engine.predictDay("2026-09-10","2026-09-05"),single);
 assert.deepEqual(createVolumeForecastEngine(data).predictDay("2026-09-10","2026-09-05"),single);
});
test("later observations cannot alter earlier fitting or calibration",()=>{
 const before=createVolumeForecastEngine(data).predictDay("2026-08-28","2026-08-28");
 const altered=data.map(r=>r.at.getTime()>=Date.parse("2026-08-28")?{...r,input:r.input*1000}:r);
 assert.deepEqual(createVolumeForecastEngine(altered).predictDay("2026-08-28","2026-08-28"),before);
});
test("history is hourly, additive, zero-aware, and invalid/absent data never turns into observations",()=>{
 const zero=Array.from({length:72},(_,hour)=>({at:new Date(Date.UTC(2026,8,1,hour)),input:0}));
 assert.equal(createVolumeForecastEngine(zero).predictDay("2026-09-04","2026-09-04").every(r=>r.input===0),true);
 assert.deepEqual(createVolumeForecastEngine(zero.slice(0,47)).predictDay("2026-09-04","2026-09-04"),[]);
 const engine=createVolumeForecastEngine([{at:zero[0].at,input:2},{at:zero[0].at,input:3},{at:"bad",input:5},{at:zero[1].at,input:-1}]);
 assert.equal(engine.actuals.length,1);assert.equal(engine.actuals[0].input,5);
});
test("daily cutoffs reject look-ahead and honor São Paulo boundaries",()=>{
 assert.equal(operationalForecastToday(new Date("2026-09-20T02:59:00Z")),"2026-09-19");
 assert.equal(operationalForecastToday(new Date("2026-09-20T03:00:00Z")),"2026-09-20");
 assert.throws(()=>createVolumeForecastEngine(data).predictDay("2026-09-04","2026-09-05"));
});
test("backtest reconciles exact absolute errors and evaluates only complete observed days",()=>{
 const engine=createVolumeForecastEngine(data.filter(r=>r.at.getTime()!==Date.parse("2026-09-02")+8*H));
 const score=evaluateVolumeForecast(engine,forecastDates("2026-09-01","2026-09-03"));
 assert.equal(score.days,2);assert.equal(score.hours,48);
 assert.equal(score.rows.some(r=>r.date==="2026-09-02"),false);
 const actual=score.rows.reduce((s,r)=>s+r.actual,0),error=score.rows.reduce((s,r)=>s+Math.abs(r.actual-r.forecast),0);
 assert.equal(score.actual,actual);assert.equal(score.absoluteError,error);assert.equal(score.wape,error/actual);
 assert.equal(score.accuracy,Math.max(0,1-error/actual));
});
test("zero denominator has unavailable accuracy rather than 100 percent",()=>{
 const zeros=data.map(r=>({...r,input:0}));
 const score=evaluateVolumeForecast(createVolumeForecastEngine(zeros),["2026-09-01"]);
 assert.equal(score.hours,24);assert.equal(score.wape,null);assert.equal(score.accuracy,null);
});
