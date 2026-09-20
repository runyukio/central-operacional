import assert from "node:assert/strict";
import test from "node:test";
import { buildExecutiveForecastPoints } from "./executive-forecast-core";
import { calculateForecastModelWeights, predictForecastHour } from "./performance-forecast-core";

test("shared forecast reproduces legacy executive formula exactly for ADS/VIDEO", () => {
  const rows = Array.from({ length: 24 * 21 }, (_, i) => ({ at: new Date(Date.UTC(2026, 8, 1, i)), input: i % 37 === 0 ? 0 : 100 + (i % 24) * 7 + Math.floor(i / 24) }));
  const actuals = rows.filter((r) => r.input > 0).map((r) => ({ ...r, timestamp: r.at.getTime() }));
  const reference = actuals.at(-1)!;
  const weights = calculateForecastModelWeights(actuals, reference.at);
  const dates = ["2026-09-22", "2026-09-23", "2026-10-01"];
  for (const dateKey of dates) {
    const legacy = Array.from({ length: 24 }, (_, hour) => ({ dateKey, hour, input: Math.max(0, Math.round(predictForecastHour(actuals, new Date(`${dateKey}T${String(hour).padStart(2, "0")}:00:00Z`), reference.at, weights).forecast)) }));
    assert.deepEqual(buildExecutiveForecastPoints(rows, dates).points.filter((p) => p.dateKey === dateKey), legacy);
    // Later days never use previous predictions as observations.
    assert.deepEqual(buildExecutiveForecastPoints(rows, [dateKey]).points, legacy);
  }
});
test("same 48 positive-hour minimum and deterministic no-data semantics", () => {
  const rows = Array.from({ length: 47 }, (_, hour) => ({ at: new Date(Date.UTC(2026, 8, 1, hour)), input: 100 }));
  assert.deepEqual(buildExecutiveForecastPoints(rows, ["2026-09-03"]).points, []);
  assert.deepEqual(buildExecutiveForecastPoints([], ["2026-09-03"]), { points: [], latestVolumeAt: null });
});
