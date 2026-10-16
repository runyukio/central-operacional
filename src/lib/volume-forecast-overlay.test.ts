import assert from "node:assert/strict";
import test from "node:test";
import { applyAdsForecastOverlay, type ForecastActual } from "./volume-forecast-overlay";
import type { AdsForecastRealtimeSource } from "./ads-forecast-realtime-source";

const dateKey = "2026-10-16", start = Date.parse(dateKey);
const points = (input = 100) => [dateKey, "2026-10-17"].flatMap(date => Array.from({ length: 24 }, (_, hour) => ({ dateKey: date, hour, input, model: "ads-robust-prior", cutoff: dateKey })));
const source = (count = 50): AdsForecastRealtimeSource => ({
  status: "active", snapshotIntegrity: "verified", snapshotWarnings: [], snapshotTimestamp: start + 11.5 * 3_600_000, cycle: `${dateKey} 11:30`, importedAt: "2026-10-16T14:35:00Z", fingerprint: String(count), warnings: [],
  intervals: Array.from({ length: 23 }, (_, index) => ({ start: start + index * 1_800_000, end: start + (index + 1) * 1_800_000, input: count })),
});

test("new RT reads revise the same cached prior without recursively adjusting it or future dates", () => {
  const baselinePoints = points(), original = JSON.stringify(baselinePoints);
  const first = applyAdsForecastOverlay({ dateKey, baselinePoints, actuals: [], source: source() });
  const second = applyAdsForecastOverlay({ dateKey, baselinePoints, actuals: [], source: source(100) });
  assert.equal(first.adaptive.status, "active"); assert.equal(second.adaptive.status, "active");
  assert.equal(first.adaptive.info!.updatedDayEstimate, 2400);
  assert.ok(second.adaptive.info!.updatedDayEstimate! > first.adaptive.info!.updatedDayEstimate!);
  assert.equal(second.baselinePoints, baselinePoints);
  assert.deepEqual(first.points.slice(24), second.points.slice(24));
  assert.equal(JSON.stringify(baselinePoints), original);
});

test("official actuals keep precedence and RT adds missing hours with a partial current hour", () => {
  const official: ForecastActual = { at: new Date(start).toISOString(), input: 123, complete: true, source: "Performance" };
  const result = applyAdsForecastOverlay({ dateKey, baselinePoints: points(), actuals: [official], source: source() });
  assert.equal(result.actuals[0], official); assert.equal(result.actuals.length, 12);
  assert.deepEqual(result.actuals.at(-1), { at: new Date(start + 11 * 3_600_000).toISOString(), input: 50, complete: false, source: "Real Time" });
});

test("stale and incomplete live data preserve the historical prior with an explicit unavailable revision", () => {
  const baselinePoints = points();
  const stale = applyAdsForecastOverlay({ dateKey, baselinePoints, actuals: [], source: { ...source(), status: "stale", intervals: [], warnings: ["Fonte atrasada"] } });
  assert.equal(stale.points, baselinePoints); assert.equal(stale.adaptive.status, "stale"); assert.deepEqual(stale.warnings, ["Fonte atrasada"]);
  const incomplete = applyAdsForecastOverlay({ dateKey, baselinePoints, actuals: [], source: { ...source(), intervals: source().intervals.slice(1) } });
  assert.equal(incomplete.points, baselinePoints); assert.equal(incomplete.adaptive.status, "unavailable");
  assert.match(incomplete.warnings[0], /não cobrem/);
});

test("a positive restart against zero history suspends operational demand instead of returning a zero-arrival ETA", () => {
  const baselinePoints = points(0);
  const result = applyAdsForecastOverlay({ dateKey, baselinePoints, actuals: [], source: source(1) });
  assert.equal(result.adaptive.status, "unavailable"); assert.equal(result.adaptive.info!.reason, "unsupported-positive-restart");
  assert.deepEqual(result.points, []); assert.equal(result.baselinePoints, baselinePoints);
  assert.match(result.warnings[0], /limpeza ficam suspensas/);
});

test("an incomplete final snapshot stays explicit for backlog consumers while the historical prior is retained", () => {
  const baselinePoints = points();
  const result = applyAdsForecastOverlay({ dateKey, baselinePoints, actuals: [], source: {
    ...source(), status: "unavailable", snapshotIntegrity: "incomplete", intervals: [], snapshotWarnings: ["Ciclo com filas ausentes"],
  } });
  assert.equal(result.points, baselinePoints); assert.equal(result.adaptive.snapshotIntegrity, "incomplete");
  assert.equal(result.adaptive.cycle, `${dateKey} 11:30`); assert.deepEqual(result.warnings, ["Ciclo com filas ausentes"]);
});
