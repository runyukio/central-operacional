import assert from "node:assert/strict";
import test from "node:test";
import { emptyCecFrt, type CecFrtDashboard } from "./cec-frt";
import { cecOperationalPoints } from "./cec-operational-chart";

function trend(period: string, patch: Partial<CecFrtDashboard["trend"][number]> = {}) {
  return { period, ...emptyCecFrt(), urgentSla: null, normalSla: null, output: null, cpd: null, ...patch };
}
test("CEC charts retain every selected day, preserve measured zero, and leave missing dates as gaps", () => {
  const rows = [trend("2026-08-01", { urgentSla: 0, normalSla: 100, cpd: 12.34 }), trend("2026-08-31", { urgentSla: 92.31, normalSla: null, cpd: 20 })];
  const original = structuredClone(rows);
  const points = cecOperationalPoints({ period: { startDate: "2026-08-01", endDate: "2026-08-31" }, view: "daily", trend: rows });
  assert.equal(points.length, 31);
  assert.equal(points[0].urgentSla, 0); assert.equal(points[0].cpd, 12.34);
  assert.equal(points[1].urgentSla, null); assert.equal(points[1].cpd, null);
  assert.equal(points[30].urgentSla, 92.31); assert.equal(points[30].label, "31/08");
  assert.equal(points[30].periodLabel, "31/08/2026");
  assert.deepEqual(rows, original);
});
test("CEC weekly display uses server Monday buckets and clips labels to selected dates", () => {
  const points = cecOperationalPoints({ period: { startDate: "2026-09-01", endDate: "2026-09-08" }, view: "weekly", trend: [trend("2026-08-31", { urgentSla: 93.75, normalSla: 80, cpd: 32.14 })] });
  assert.equal(points.length, 2);
  assert.equal(points[0].period, "2026-08-31");
  assert.equal(points[0].periodLabel, "01/09/2026 – 06/09/2026");
  assert.equal(points[0].urgentSla, 93.75); assert.equal(points[0].cpd, 32.14);
  assert.equal(points[1].periodLabel, "07/09/2026 – 08/09/2026");
});
test("CEC monthly chart preserves aggregated CPD and SLA, handles year and leap-day boundaries", () => {
  const points = cecOperationalPoints({ period: { startDate: "2023-12-20", endDate: "2024-02-29" }, view: "monthly", trend: [trend("2024-01-01", { cpd: 42.86, normalSla: 95.12 })] });
  assert.equal(points.length, 3); assert.equal(points[0].label, "12/2023");
  assert.equal(points[1].cpd, 42.86); assert.equal(points[1].normalSla, 95.12);
  assert.equal(points[2].periodLabel, "01/02/2024 – 29/02/2024");
  assert.equal(cecOperationalPoints({ period: { startDate: "2024-02-01", endDate: "2024-02-29" }, view: "daily", trend: [] }).length, 29);
});
test("CEC invalid date ranges cannot produce chart points", () => {
  for (const period of [{ startDate: "", endDate: "2026-09-01" }, { startDate: "2026-02-30", endDate: "2026-03-01" }, { startDate: "2026-09-02", endDate: "2026-09-01" }]) {
    assert.deepEqual(cecOperationalPoints({ period, view: "daily", trend: [] }), []);
  }
});
