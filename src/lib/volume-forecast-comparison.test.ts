import assert from "node:assert/strict";
import test from "node:test";
import { forecastComparisonPoints } from "./volume-forecast-comparison";
import { applyAdsForecastOverlay } from "./volume-forecast-overlay";
import { buildAdsExecutiveReportSnapshot } from "./ads-executive-report-core";
import type { AdsForecastRealtimeSource } from "./ads-forecast-realtime-source";

test("Input x Forecast retains prediction versus actual even when the operational nowcast copies completed hours", () => {
  const dateKey = "2026-10-19", start = Date.parse(dateKey), H = 3_600_000;
  const baselinePoints = Array.from({ length: 24 }, (_, hour) => ({ dateKey, hour, input: 100, model: "ads-robust-prior", cutoff: dateKey }));
  const source: AdsForecastRealtimeSource = {
    status: "active", snapshotIntegrity: "verified", snapshotWarnings: [], warnings: [], fingerprint: "test",
    snapshotTimestamp: start + 11.5 * H, cycle: `${dateKey} 11:30`, importedAt: "2026-10-19T14:35:00Z",
    intervals: Array.from({ length: 23 }, (_, index) => ({ start: start + index * H / 2, end: start + (index + 1) * H / 2, input: 100 })),
  };
  const revised = applyAdsForecastOverlay({ dateKey, baselinePoints, actuals: [], source });
  assert.equal(revised.adaptive.status, "active");
  assert.equal(revised.points[10].input, 200, "operational curve includes received volume");
  const report = buildAdsExecutiveReportSnapshot({
    selectedCycle: source.cycle!, forecast: forecastComparisonPoints(revised), agentRows: [],
    queueRows: [{ lob: "ADS", history: [
      { cycleDownload: `${dateKey} 09:30`, input: 1000, output: 0, backlog: 0, ahtMs: null, latencyMs: null, maxLatencyMs: null },
      { cycleDownload: `${dateKey} 10:30`, input: 1200, output: 0, backlog: 0, ahtMs: null, latencyMs: null, maxLatencyMs: null },
    ] }],
  });
  assert.equal(report.buckets[10].input, 200);
  assert.equal(report.buckets[10].forecast, 100);
  assert.equal(report.buckets[10].input! - report.buckets[10].forecast!, 100);
  assert.deepEqual(report.buckets.map(bucket => bucket.forecast), baselinePoints.map(point => point.input));
  const changed = applyAdsForecastOverlay({ dateKey, baselinePoints, actuals: [], source: {
    ...source, intervals: source.intervals.map(row => ({ ...row, input: row.input * 3 })),
  } });
  assert.deepEqual(forecastComparisonPoints(changed), forecastComparisonPoints(revised));
});

test("missing references remain empty and explicit zeros survive comparison selection", () => {
  const operational = [{ input: 123 }];
  assert.deepEqual(forecastComparisonPoints({ baselinePoints: [], points: operational }), []);
  assert.deepEqual(forecastComparisonPoints({ baselinePoints: [{ input: 0 }], points: operational }), [{ input: 0 }]);
  assert.equal(forecastComparisonPoints({ points: operational }), operational);
  assert.deepEqual(forecastComparisonPoints(null), []);
});
