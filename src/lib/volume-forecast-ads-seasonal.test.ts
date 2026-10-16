import assert from "node:assert/strict";
import test from "node:test";
import { completeForecastDays, predictCandidate, VOLUME_CANDIDATES, type ForecastDay } from "./volume-forecast-models";

const D = 86_400_000, H = 3_600_000;
const start = Date.parse("2026-07-01T00:00:00Z");
const candidate = VOLUME_CANDIDATES.find(row => row.id === "ads-seasonal-damped")!;
const incumbent = VOLUME_CANDIDATES.find(row => row.id === "report-ensemble")!;
const observations = Array.from({ length: 106 * 24 }, (_, index) => {
  const at = new Date(start + index * H), weekday = at.getUTCDay();
  return { at, input: weekday === 6 ? 70 : weekday === 0 ? 60 : 100 };
});
const days = completeForecastDays(observations);
const sum = (values: number[] | null) => values?.reduce((total, value) => total + value, 0) ?? null;
const forecast = (history: ForecastDay[], date = "2026-10-17", cutoff = "2026-10-16") => predictCandidate(history, date, cutoff, candidate);

test("ADS calendar candidate is explicit, deterministic and emits 24 nonnegative integer hours", () => {
  assert.equal(candidate.kind, "adsSeasonal");
  const values = forecast(days)!;
  assert.equal(values.length, 24);
  assert.ok(values.every(value => Number.isInteger(value) && value >= 0));
  assert.deepEqual(forecast(days), values);
});

test("an isolated Wednesday spike influences Saturday much less than the incumbent, without a volume ceiling", () => {
  const modified = days.map(day => day.date === "2026-10-14" ? { ...day, total: day.total * 3, values: day.values.map(value => value * 3) } : day);
  const baseline = sum(forecast(days))!, shocked = sum(forecast(modified))!;
  const oldBaseline = sum(predictCandidate(days, "2026-10-17", "2026-10-16", incumbent))!;
  const oldShocked = sum(predictCandidate(modified, "2026-10-17", "2026-10-16", incumbent))!;
  assert.ok(shocked > baseline, "the remaining ensemble contribution is not claimed to be immune to a spike");
  assert.ok(shocked / baseline < oldShocked / oldBaseline);
  assert.ok(shocked > Math.max(...days.filter(day => day.weekday === 6).map(day => day.total)), "the observed Saturday maximum is not a cap");
});

test("seven days of sustained growth raise the forecast and are not discarded as an isolated outlier", () => {
  const last = days.at(-1)!.at;
  const growth = days.map(day => day.at >= last - 6 * D ? { ...day, total: day.total * 2, values: day.values.map(value => value * 2) } : day);
  const ratio = sum(forecast(growth))! / sum(forecast(days))!;
  assert.ok(ratio > 1.8 && ratio < 2.2, `sustained doubling should remain visible; got ${ratio}`);
});

test("weekend hourly shapes preserve the weekend peak rather than merely lowering a weekday curve", () => {
  const shaped = completeForecastDays(observations.map(row => {
    const weekday = row.at.getUTCDay(), hour = row.at.getUTCHours();
    return { ...row, input: weekday === 6 ? hour === 22 ? 800 : 70 : weekday === 0 ? hour === 22 ? 600 : 60 : hour === 14 ? 1000 : 100 };
  }));
  const saturday = forecast(shaped)!, sunday = forecast(shaped, "2026-10-18")!;
  assert.equal(saturday.indexOf(Math.max(...saturday)), 22);
  assert.equal(sunday.indexOf(Math.max(...sunday)), 22);
  assert.ok(sum(saturday)! > sum(sunday)!);
});

test("observed zeros remain zero; insufficient history and a zero baseline with a positive restart remain unavailable", () => {
  const zeros = days.map(day => ({ ...day, total: 0, values: Array<number>(24).fill(0) }));
  assert.deepEqual(forecast(zeros), Array<number>(24).fill(0));
  assert.equal(forecast([]), null);
  assert.equal(forecast(days.slice(-1)), null);
  const last = days.at(-1)!.at;
  const restart = days.map(day => day.at >= last - 6 * D ? day : { ...day, total: 0, values: Array<number>(24).fill(0) });
  assert.equal(forecast(restart), null);
});

test("target/future observations and a partial October 15 cannot leak into the October 17 prediction", () => {
  const modified = completeForecastDays([...observations,
    ...Array.from({ length: 13 }, (_, hour) => ({ at: new Date(`2026-10-15T${String(hour).padStart(2, "0")}:00:00Z`), input: 999999 })),
    ...Array.from({ length: 48 }, (_, hour) => ({ at: new Date(Date.parse("2026-10-16T00:00:00Z") + hour * H), input: 999999 })),
  ]);
  assert.deepEqual(forecast(modified), forecast(days));
  assert.equal(modified.filter(day => day.date === "2026-10-15").length, 0);
});

test("missing recent days are excluded, never filled with observed zero or an invented weekend fallback", () => {
  const gap = days.filter(day => day.date !== "2026-10-10");
  assert.equal(forecast(gap), null);
  assert.equal(gap.some(day => day.date === "2026-10-10"), false);
});

test("the 142-day snapshot budget and long-horizon predictions do not create extra training data", () => {
  const cutoff = "2026-10-16", cut = Date.parse(cutoff);
  const longHistory = completeForecastDays(Array.from({ length: 230 * 24 }, (_, hour) => ({ at: new Date(cut - 230 * D + hour * H), input: 100 + hour % 24 })));
  const outsideBudget = longHistory.map(day => day.at < cut - 142 * D ? { ...day, total: day.total * 1000, values: day.values.map(value => value * 1000) } : day);
  assert.deepEqual(forecast(longHistory), forecast(outsideBudget));
  const before = JSON.stringify(days);
  assert.deepEqual(forecast(days, "2026-10-24"), forecast(days, "2026-10-17"));
  assert.equal(JSON.stringify(days), before);
});
