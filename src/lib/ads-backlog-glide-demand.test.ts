import assert from "node:assert/strict";
import test from "node:test";
import { buildGlideDemandContext, type GlideDemandHistoryPoint } from "./ads-backlog-glide-demand";
import type { ExecutiveForecastPoint } from "./executive-forecast-core";

const H = 3_600_000;
const start = Date.parse("2026-10-16T00:00:00Z");
const at = (hours: number) => start + hours * H;
const cycle = (hours: number) => new Date(at(hours)).toISOString().slice(0, 16).replace("T", " ");
const forecast = (dateKey = "2026-10-16", value = 100): ExecutiveForecastPoint[] => Array.from({ length: 24 }, (_, hour) => ({ dateKey, hour, input: value }));
const history = (end: number, perHalfHour = 30, baseline = 1000): GlideDemandHistoryPoint[] => Array.from({ length: end * 2 + 1 }, (_, index) => ({ cycleDownload: cycle(index / 2), input: baseline + perHalfHour * index }));
const run = (queueHistories: GlideDemandHistoryPoint[][], points = forecast(), snapshotTimestamp = at(11.5)) => buildGlideDemandContext({ snapshotTimestamp, queueHistories, forecast: points });

test("daily context integrates the partial current hour and preserves full precision", () => {
  const result = run([history(11.5)], forecast("2026-10-16", 101.25));
  assert.deepEqual(result, {
    referenceToday: 2430, actualToday: 690, expectedToCycle: 1164.375,
    remainingToday: 1265.625, updatedDayEstimate: 1955.625, observedUntil: at(11.5),
    actualRecent3h: 180, expectedRecent3h: 303.75,
  });
});

test("per-queue counter deltas include resets without adding cumulative snapshots", () => {
  const first = history(13.5), second = history(13.5, 10, 9000);
  first[26].input = 5; second[26].input = 2; // 13:00 Brazil: both upstream day counters reset.
  for (let index = 27; index < first.length; index++) {
    first[index].input = first[index - 1].input + 30;
    second[index].input = second[index - 1].input + 10;
  }
  const result = run([first, second], forecast(), at(13.5));
  assert.equal(result.actualToday, 25 * 30 + 5 + 30 + 25 * 10 + 2 + 10);
  assert.equal(result.actualRecent3h, 4 * 30 + 5 + 30 + 4 * 10 + 2 + 10);
});

test("13:00 is a known daily reset even when the new small-queue count exceeds the old count", () => {
  const rows = history(13.5, 0, 1);
  rows[26].input = 2; rows[27].input = 5;
  const result = run([rows], forecast(), at(13.5));
  assert.equal(result.actualToday, 5, "two arrivals in the reset counter plus three afterward, not four");
  assert.equal(result.actualRecent3h, 5);
});

test("a counter decrease outside the established reset makes only the intersecting observed window unavailable", () => {
  const recentDrop = history(11.5); recentDrop[20].input = 1;
  assert.equal(run([recentDrop]).actualToday, null);
  assert.equal(run([recentDrop]).actualRecent3h, null);
  const olderDrop = history(11.5); olderDrop[8].input = 1;
  assert.equal(run([olderDrop]).actualToday, null);
  assert.equal(run([olderDrop]).actualRecent3h, 180);
});

test("civil midnight remains a baseline boundary, never an upstream counter reset", () => {
  const rows = [
    { cycleDownload: cycle(-0.5), input: 9 },
    { cycleDownload: cycle(0), input: 11 },
    { cycleDownload: cycle(0.5), input: 13 }
  ];
  assert.equal(run([rows], forecast(), at(0.5)).actualToday, 2);
});

test("daily completeness is required for every queue; recent coverage can remain available", () => {
  const missingMidnight = history(11.5).slice(1);
  const result = run([missingMidnight, history(11.5)]);
  assert.equal(result.actualToday, null);
  assert.equal(result.updatedDayEstimate, null);
  assert.equal(result.actualRecent3h, 360);
  assert.equal(run([]).actualToday, null);
  assert.equal(run([history(11.5), []]).actualRecent3h, null);
});

test("no selected-cycle observation, missing 30-minute intervals or invalid counts are unknown", () => {
  assert.equal(run([history(11)]).actualToday, null);
  assert.equal(run([history(11.5).filter((_, index) => index !== 5)]).actualToday, null);
  assert.equal(run([history(11.5).filter((_, index) => index !== 20)]).actualRecent3h, null);
  for (const value of [-1, NaN, Infinity]) {
    const rows = history(11.5); rows[20].input = value;
    assert.equal(run([rows]).actualToday, null);
    assert.equal(run([rows]).actualRecent3h, null);
  }
});

test("duplicates are collapsed only when the same cycle has the same count", () => {
  const rows = history(11.5);
  assert.equal(run([[...rows, rows[20]]]).actualToday, 690);
  assert.equal(run([[...rows, { ...rows[20], input: rows[20].input + 1 }]]).actualToday, null);
});

test("future counter rows never supply a missing selected cycle or alter observed demand", () => {
  assert.equal(run([history(12)]).actualToday, 690);
  assert.equal(run([history(12).filter(row => row.cycleDownload !== cycle(11.5))]).actualToday, null);
  const rows = history(12); rows.at(-1)!.input = NaN;
  assert.equal(run([rows]).actualToday, 690);
});

test("daily forecast requires exactly 24 valid unique hours", () => {
  for (const points of [forecast().slice(1), [...forecast(), forecast()[0]], forecast().map(point => point.hour === 5 ? { ...point, input: NaN } : point), forecast().map(point => point.hour === 5 ? { ...point, hour: 24 } : point)]) {
    const result = run([history(11.5)], points);
    assert.equal(result.referenceToday, null);
    assert.equal(result.expectedToCycle, null);
    assert.equal(result.remainingToday, null);
    assert.equal(result.updatedDayEstimate, null);
    assert.equal(result.actualToday, 690);
  }
});

test("recent comparison requires only the forecast hours intersecting that exact window", () => {
  const result = run([history(11.5)], forecast().filter(point => point.hour >= 8 && point.hour <= 11));
  assert.equal(result.referenceToday, null);
  assert.equal(result.expectedRecent3h, 300);
  assert.equal(run([history(11.5)], [...forecast(), forecast()[9]]).expectedRecent3h, null);
});

test("the recent three-hour window can cross midnight without borrowing a missing daily baseline", () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({ cycleDownload: cycle(-1 + index / 2), input: 900 + index * 20 }));
  const result = run([rows], [...forecast("2026-10-15", 200), ...forecast()], at(2));
  assert.equal(result.actualRecent3h, 120);
  assert.equal(result.expectedRecent3h, 400);
  assert.equal(result.actualToday, 80);
  assert.equal(result.expectedToCycle, 200);
});

test("midnight zero is known only when every queue has the baseline snapshot", () => {
  const result = run([history(0)], forecast(), at(0));
  assert.equal(result.actualToday, 0);
  assert.equal(result.expectedToCycle, 0);
  assert.equal(result.remainingToday, 2400);
  assert.equal(result.actualRecent3h, null);
  assert.equal(run([[]], forecast(), at(0)).actualToday, null);
});

test("Brasil wall-clock cycles are independent of the browser or process timezone", () => {
  const timezone = process.env.TZ;
  try {
    process.env.TZ = "America/Sao_Paulo";
    assert.equal(run([history(11.5)]).actualToday, 690);
    const rows = history(11.5); rows[0].cycleDownload = "2026-02-31 00:00";
    assert.equal(run([rows]).actualToday, null);
  } finally { if (timezone === undefined) delete process.env.TZ; else process.env.TZ = timezone; }
});
