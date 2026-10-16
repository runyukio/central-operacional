import assert from "node:assert/strict";
import test from "node:test";
import { buildAdsVolumeNowcast, type AdsVolumeNowcastInterval } from "./ads-volume-nowcast-core";
import { forecastRemainingInInterval } from "./executive-forecast-core";
import type { VolumeForecastPoint } from "./volume-forecast-core";
import { completeForecastDays, predictCandidate, VOLUME_CANDIDATES } from "./volume-forecast-models";

const H = 3_600_000, D = 24 * H;
const day = "2026-10-16", start = Date.parse(`${day}T00:00:00Z`);
const at = (hours: number) => start + hours * H;
const base = (dateKey = day): VolumeForecastPoint[] => Array.from({ length: 24 }, (_, hour) => ({ dateKey, hour, input: 100, model: "ads-robust-prior", cutoff: day }));
const intervals = (end = 11.5, value = 50): AdsVolumeNowcastInterval[] => Array.from({ length: end * 2 }, (_, index) => ({ start: at(index / 2), end: at((index + 1) / 2), input: value }));
const run = (options: Partial<Parameters<typeof buildAdsVolumeNowcast>[0]> = {}) => buildAdsVolumeNowcast({ basePoints: base(), dateKey: day, snapshotTimestamp: at(11.5), intervals: intervals(), ...options });
const close = (actual: number | null | undefined, expected: number, message?: string) => { assert.ok(actual != null && Math.abs(actual - expected) < 1e-9, message ?? `Expected ${expected}, got ${actual}`); };

test("steady observed arrivals preserve the prior and split observed from future input in a partial hour", () => {
  const result = run();
  assert.equal(result.info.active, true);
  close(result.info.referenceToday, 2400); close(result.info.actualToday, 1150); close(result.info.expectedToCycle, 1150);
  close(result.info.baseRemainingToday, 1250); close(result.info.remainingToday, 1250); close(result.info.updatedDayEstimate, 2400);
  assert.equal(result.info.observedUntil, at(11.5));
  assert.equal(result.info.intervalCount, 23); assert.equal(result.info.observedHours, 11.5);
  assert.deepEqual(result.points[10], { ...base()[10], input: 100, remainingInput: 0, observedUntil: at(11) });
  assert.deepEqual(result.points[11], { ...base()[11], input: 100, remainingInput: 50, observedUntil: at(11.5) });
  assert.deepEqual(result.points[12], base()[12]);
  assert.deepEqual(result.observedPoints.at(-1), { at: new Date(at(11)).toISOString(), input: 50, complete: false });
  assert.ok(result.observedPoints.slice(0, -1).every(point => point.complete));
});

test("future-demand integration never re-adds the arrivals already contained in the current backlog", () => {
  const result = run({ intervals: intervals(11.5, 25) });
  assert.equal(result.info.active, true);
  close(result.info.actualToday, 575);
  const future = result.points.reduce((sum, point) => sum + forecastRemainingInInterval(point, at(11.5), at(24))!, 0);
  close(future, result.info.remainingToday!);
  close(result.points.reduce((sum, point) => sum + point.input, 0), result.info.updatedDayEstimate!);
  close(result.points[11].input - result.points[11].remainingInput!, 25);
  assert.ok(result.info.updatedDayEstimate! < 2400 && result.info.updatedDayEstimate! > 575);
});

test("recent arrivals change nearby hours while their extra effect fades after six hours", () => {
  const observed = intervals().map(interval => ({ ...interval, input: interval.start >= at(8.5) ? 100 : 25 }));
  const result = run({ intervals: observed });
  assert.ok(result.info.nearRatio! > result.info.cumulativeRatio!);
  assert.ok(result.points[12].input / 100 > result.points[18].input / 100);
  close(result.points[18].input / 100, result.info.cumulativeRatio!);
});

test("only the selected current day is updated and input arrays are not mutated", () => {
  const today = base(), tomorrow = base("2026-10-17"), points = [...today, ...tomorrow];
  const before = JSON.stringify(points), observations = intervals(11.5, 100), originalObserved = JSON.stringify(observations);
  const result = run({ basePoints: points, intervals: [...observations].reverse() });
  assert.equal(result.points.length, 48);
  assert.deepEqual(result.points.slice(24), tomorrow);
  assert.equal(result.points[24], tomorrow[0]);
  assert.equal(JSON.stringify(points), before); assert.equal(JSON.stringify(observations), originalObserved);
});

test("as the day closes every forecast hour becomes observed and the estimate converges exactly to real input", () => {
  const result = run({ snapshotTimestamp: at(24), intervals: intervals(24, 25) });
  assert.equal(result.info.active, true);
  close(result.info.actualToday, 1200); close(result.info.remainingToday, 0); close(result.info.updatedDayEstimate, 1200);
  assert.ok(result.points.every(point => point.input === 50 && point.remainingInput === 0));
  assert.equal(result.observedPoints.length, 24); assert.ok(result.observedPoints.every(point => point.complete));
});

test("at midnight no early-hour rate is extrapolated to the rest of the month", () => {
  const result = run({ snapshotTimestamp: at(0), intervals: [] });
  assert.equal(result.info.active, true);
  close(result.info.actualToday, 0); close(result.info.updatedDayEstimate, 2400);
  assert.deepEqual(result.points, base()); assert.deepEqual(result.observedPoints, []);
});

test("missing, overlapping, future, negative and boundary-ambiguous observations retain the base inactive", () => {
  const points = base();
  const invalid = [
    intervals().slice(1), intervals().filter((_, index) => index !== 10), [...intervals(), intervals()[0]],
    intervals(12), intervals().map((row, index) => index === 0 ? { ...row, input: -1 } : row),
    intervals().map((row, index) => index === 0 ? { ...row, input: NaN } : row),
    // This exact cumulative coverage cannot allocate actual cases across each hourly boundary.
    [{ start: at(0), end: at(11.5), input: 1000 }],
  ];
  for (const observed of invalid) {
    const result = run({ basePoints: points, intervals: observed });
    assert.equal(result.info.active, false); assert.equal(result.info.reason, "invalid-observations");
    assert.equal(result.points, points); assert.deepEqual(result.observedPoints, []);
    assert.equal(result.info.updatedDayEstimate, null);
  }
});

test("a complete valid 24-hour base is mandatory and already adjusted input is never adjusted twice", () => {
  for (const points of [base().slice(1), [...base(), base()[0]], base().map(point => point.hour === 5 ? { ...point, input: Infinity } : point)]) {
    const result = run({ basePoints: points });
    assert.equal(result.info.active, false); assert.equal(result.info.reason, "missing-reference"); assert.equal(result.points, points);
  }
  const first = run(), repeated = run({ basePoints: first.points });
  assert.equal(repeated.info.active, false); assert.equal(repeated.info.reason, "already-adjusted"); assert.equal(repeated.points, first.points);
});

test("observed zero remains zero while positive arrivals against an all-zero prior do not invent a fallback", () => {
  const points = base().map(point => ({ ...point, input: 0 }));
  const zero = run({ basePoints: points, intervals: intervals(11.5, 0) });
  assert.equal(zero.info.active, true); close(zero.info.updatedDayEstimate, 0);
  assert.ok(zero.points.every(point => point.input === 0));
  const restart = run({ basePoints: points });
  assert.equal(restart.info.active, false); assert.equal(restart.info.reason, "unsupported-positive-restart");
  assert.equal(restart.info.updatedDayEstimate, null); assert.equal(restart.points, points);
});

test("invalid dates and timestamps do not publish NaN or shift operational Brasil wall-clock time", () => {
  assert.equal(run({ dateKey: "2026-02-31" }).info.reason, "invalid-date");
  for (const snapshotTimestamp of [NaN, Infinity, at(-1), at(25)]) assert.equal(run({ snapshotTimestamp }).info.reason, "invalid-snapshot");
  const timezone = process.env.TZ;
  try { process.env.TZ = "America/Sao_Paulo"; assert.deepEqual(run().points[11], { ...base()[11], remainingInput: 50, observedUntil: at(11.5) }); }
  finally { if (timezone === undefined) delete process.env.TZ; else process.env.TZ = timezone; }
});

test("robust prior applies the weekday pattern to weekdays too and responds to sustained rather than isolated growth", () => {
  const prior = VOLUME_CANDIDATES.find(candidate => candidate.id === "ads-robust-prior")!;
  assert.equal(prior.kind, "adsRobustPrior");
  const observations = Array.from({ length: 106 * 24 }, (_, index) => { const at = new Date(Date.parse("2026-07-01T00:00:00Z") + index * H); return { at, input: at.getUTCDay() === 6 ? 70 : at.getUTCDay() === 0 ? 60 : 100 }; });
  const days = completeForecastDays(observations);
  const predict = (history = days, target = day) => predictCandidate(history, target, day, prior);
  close(predict()!.reduce((sum, value) => sum + value, 0), 2400);
  close(predict(days, "2026-10-17")!.reduce((sum, value) => sum + value, 0), 1680);
  const isolated = days.map(row => row.date === "2026-10-14" ? { ...row, total: row.total * 3, values: row.values.map(value => value * 3) } : row);
  assert.deepEqual(predict(isolated), predict());
  const sustained = days.map(row => row.at >= days.at(-1)!.at - 6 * D ? { ...row, total: row.total * 2, values: row.values.map(value => value * 2) } : row);
  close(predict(sustained)!.reduce((sum, value) => sum + value, 0), 4800);
  assert.equal(predict([]), null);
  assert.equal(predict(days.filter(row => row.date !== "2026-10-10")), null);
  const zeros = days.map(row => ({ ...row, total: 0, values: Array<number>(24).fill(0) }));
  assert.deepEqual(predict(zeros), Array<number>(24).fill(0));
});
