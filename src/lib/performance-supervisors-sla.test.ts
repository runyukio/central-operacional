import assert from "node:assert/strict";
import test from "node:test";
import { emptySupervisorSlaTotals, finishSupervisorSla, formatSupervisorLatency } from "./performance-supervisors-sla";

test("hh:mm rounds minutes, carries hours and keeps multi-day durations", () => {
  for (const [value, expected] of [[0, "00:00"], [15, "00:15"], [119.6, "02:00"], [120, "02:00"], [1561, "26:01"], [null, "Sem dados"], [NaN, "Sem dados"]] as const) {
    assert.equal(formatSupervisorLatency(value), expected);
  }
});
test("no denominator is missing, while genuine zero latency and zero SLA remain zero", () => {
  const totals = emptySupervisorSlaTotals();
  assert.equal(finishSupervisorSla(totals).ads.minutes, null);
  assert.equal(finishSupervisorSla(totals).cec.normalSla, null);
  totals.adsSubmits = 10;
  totals.cec.normalTotal = 10; totals.cec.normalOver = 10;
  assert.equal(finishSupervisorSla(totals).ads.minutes, 0);
  assert.equal(finishSupervisorSla(totals).cec.normalSla, 0);
});
