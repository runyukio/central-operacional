import assert from "node:assert/strict";
import test from "node:test";
import { projectSpaceGlide, spaceMonthEnd } from "./meu-espaco-glide";
import { assessSpaceTarget, isSpaceMaterialSkill, spaceTargets } from "./meu-espaco-targets";
import { emptySpaceMetric, finishSpaceMetric } from "./meu-espaco-metrics";
import { coverageSlotEnd, coverageSlotState, coverageSupervisorMatches } from "./meu-espaco-coverage";
import { compareSpaceValues, spaceAge } from "./meu-espaco-order";
import { decodeSpaceCursor, encodeSpaceCursor, pendingFingerprint, spacePendingFilters } from "./meu-espaco-filters";

const target = (id: string, lob = "ADS") => spaceTargets(lob).find((row) => row.id === id)!;
const base = { month: "2026-09", today: "2026-09-09", scheduled: new Map([["2026-09-07", 1], ["2026-09-08", 1], ["2026-09-09", 1], ["2026-09-10", 1]]) };

test("all operational targets, units and bounds are explicit", () => {
  assert.deepEqual(spaceTargets("ADS").map((row) => [row.id, row.target]), [["quality", 95], ["aht", 60], ["abs", 7.5], ["latency", 2], ["materialDaily", 300]]);
  assert.equal(target("quality", "TNS").target, 98);
  assert.equal(target("aht", "TNS").target, 50);
  assert.equal(target("latency", "TNS").target, 15);
  assert.equal(target("commentsLatency", "TNS").target, 24);
  assert.equal(target("quality", "CEC").target, 95);
  assert.equal(target("cpd", "CEC").target, 100);
  assert.equal(target("normalFrt", "CEC").target, 97);
  assert.equal(target("urgentFrt", "CEC").target, 97);
  assert.deepEqual(spaceTargets("OTHER"), []);
});
test("targets compare raw ratios, not rounded displays; missing is never met", () => {
  assert.equal(assessSpaceTarget(target("quality"), { numerator: 949999, denominator: 1000000 }).met, false);
  assert.equal(assessSpaceTarget(target("aht"), { numerator: 600001, denominator: 10000 }).met, false);
  assert.equal(assessSpaceTarget(target("quality"), { numerator: 95, denominator: 100 }).met, true);
  assert.equal(assessSpaceTarget(target("quality"), { numerator: 0, denominator: 0 }).met, null);
  assert.equal(assessSpaceTarget(target("latency"), { numerator: 12000, denominator: 100 }).value, 2);
});
test("Material is a primary-skill subset, not the overall ADS average", () => {
  const metric = emptySpaceMetric();
  metric.output = 1000; metric.agentDays = new Set(["a", "b", "c"]);
  metric.materialOutput = 600; metric.materialDays = new Set(["a", "b"]);
  const result = finishSpaceMetric(metric, "ADS");
  assert.equal(result.targets?.find((kpi) => kpi.id === "materialDaily")?.value, 300);
  assert.notEqual(result.dailyIndividual, 300);
  assert.equal(isSpaceMaterialSkill(" Material Queues "), true);
  for (const skill of [null, "Account", "Material Queues + Account"]) assert.equal(isSpaceMaterialSkill(skill), false);
});
test("quality projects weighted overall and the minimum remaining correct cases", () => {
  const result = projectSpaceGlide({ ...base, target: target("quality"), daily: [{ date: "2026-09-07", weight: { numerator: 9, denominator: 10 } }, { date: "2026-09-08", weight: { numerator: 90, denominator: 90 } }] });
  assert.equal(result.overall, 99); assert.equal(result.automaticWeight, 100);
  assert.equal(result.requiredNumerator, 91); assert.equal(result.requiredValue, 91);
  assert.equal(result.forecast, 99); assert.equal(result.points.at(-1)?.path, 95);
});
test("AHT and latency expose the maximum allowed future weighted average", () => {
  const result = projectSpaceGlide({ ...base, target: target("aht"), override: 100, daily: [{ date: "2026-09-08", weight: { numerator: 8000, denominator: 100 } }] });
  assert.equal(result.requiredValue, 40); assert.equal(result.forecast, 80); assert.equal(result.points.at(-1)?.path, 60);
  const latency = projectSpaceGlide({ ...base, target: target("latency"), override: 100, daily: [{ date: "2026-09-08", weight: { numerator: 18000, denominator: 100 } }] });
  assert.equal(latency.requiredValue, 1); assert.equal(latency.overall, 3);
});
test("impossible quality/ABS/time recovery is labeled rather than offering impossible values", () => {
  for (const [id, numerator, denominator] of [["quality", 0, 100], ["abs", 100, 100], ["aht", 100000, 100]] as const) {
    const result = projectSpaceGlide({ ...base, target: target(id), override: 1, daily: [{ date: "2026-09-08", weight: { numerator, denominator } }] });
    assert.equal(result.impossible, true); assert.equal(result.requiredValue, null);
  }
});
test("CEC normal and urgent FRT keep separate weights and a 97 percent goal", () => {
  for (const id of ["normalFrt", "urgentFrt"]) {
    const result = projectSpaceGlide({ ...base, target: target(id, "CEC"), override: 100, daily: [{ date: "2026-09-08", weight: { numerator: 95, denominator: 100 } }] });
    assert.equal(result.requiredValue, 99); assert.equal(result.requiredNumerator, 99);
  }
});
test("current day is excluded, gaps are null and the recent window is seven calendar days", () => {
  const result = projectSpaceGlide({ ...base, target: target("quality"), daily: [{ date: "2026-09-01", weight: { numerator: 0, denominator: 100 } }, { date: "2026-09-08", weight: { numerator: 100, denominator: 100 } }, { date: "2026-09-09", weight: { numerator: 1000, denominator: 1000 } }] });
  assert.equal(result.cutoff, "2026-09-08"); assert.equal(result.recentDays, 1); assert.equal(result.recentStart, "2026-09-02");
  assert.equal(result.overall, 50); assert.equal(result.points[1].daily, null); assert.equal(result.points[1].overall, null);
});
test("manual simulation works without future schedules, zero volume is not division by zero", () => {
  const input = { ...base, target: target("quality"), scheduled: new Map<string, number>(), daily: [{ date: "2026-09-08", weight: { numerator: 95, denominator: 100 } }] };
  assert.equal(projectSpaceGlide(input).remainingWeight, null);
  assert.equal(projectSpaceGlide({ ...input, override: 100 }).requiredValue, 95);
  const zero = projectSpaceGlide({ ...input, override: 0 });
  assert.equal(zero.requiredValue, null); assert.equal(zero.forecast, null); assert.match(zero.warning!, /Não há volume/);
});
test("seven-day rhythm crosses the month boundary without adding old output to the monthly total", () => {
  const result = projectSpaceGlide({ ...base, today: "2026-09-03", target: target("quality"), scheduled: new Map([["2026-08-31", 1], ["2026-09-02", 1], ["2026-09-03", 1]]),
    daily: [{ date: "2026-08-31", weight: { numerator: 90, denominator: 100 } }, { date: "2026-09-02", weight: { numerator: 10, denominator: 10 } }] });
  assert.equal(result.overall, 100); assert.equal(result.recentDays, 2); assert.equal(result.automaticWeight, 55);
});
test("closed months have no future effort; no source has no invented zeros", () => {
  const result = projectSpaceGlide({ ...base, today: "2026-10-02", target: target("quality"), override: 100, daily: [{ date: "2026-09-08", weight: { numerator: 95, denominator: 100 } }] });
  assert.equal(result.closed, true); assert.equal(result.requiredValue, null); assert.equal(result.simulated, false);
  const missing = projectSpaceGlide({ ...base, target: target("quality"), daily: [] });
  assert.equal(missing.overall, null); assert.equal(missing.cutoff, null);
  assert.equal(spaceMonthEnd("2028-02"), "2028-02-29");
});
test("coverage joins LOB IDs plus shift category, including the TNS family", () => {
  assert.equal(coverageSupervisorMatches({ lobId: "ads", lob: "ADS", shift: "Noite" }, { lobId: "ads", lob: "ADS", shift: "Noite (23:00)" }), true);
  assert.equal(coverageSupervisorMatches({ lobId: "ads", lob: "ADS", shift: "Noite" }, { lobId: "cec", lob: "CEC", shift: "Noite" }), false);
  assert.equal(coverageSupervisorMatches({ lobId: "tns", lob: "TNS", shift: "Manhã" }, { lobId: "video", lob: "VIDEO", shift: "Manhã" }), true);
});
test("coverage closes on availability or shift end, independent of any justification", () => {
  const end = coverageSlotEnd("2026-09-08", "23:00", "08:00")!;
  assert.equal(end.toISOString(), "2026-09-09T11:00:00.000Z");
  assert.equal(coverageSlotState(10, 8, end, new Date("2026-09-09T10:59:59Z")), "pending");
  assert.equal(coverageSlotState(10, 8, end, new Date("2026-09-09T11:00:00Z")), "ended_deficit");
  assert.equal(coverageSlotState(10, 10, end, new Date("2026-09-09T10:00:00Z")), "covered");
  assert.equal(coverageSlotEnd("2026-09-08", "invalid", "08:00"), null);
});
test("sorting is numeric, nulls stay last both ways and aging is not an SLA", () => {
  for (const direction of ["asc", "desc"] as const) assert.equal(compareSpaceValues(null, 0, direction), 1);
  assert.ok(compareSpaceValues(9, 100, "asc") < 0);
  assert.equal(spaceAge("2026-09-09", "2026-09-09"), "Hoje");
  assert.equal(spaceAge("2026-09-08", "2026-09-09"), "há 1 dia");
  assert.equal(spaceAge("2026-09-11", "2026-09-09"), "em 2 dias");
  const asc = spacePendingFilters(new URLSearchParams("order=asc")), desc = spacePendingFilters(new URLSearchParams("order=desc"));
  const cursor = encodeSpaceCursor({ date: "2026-09-01", kind: "hours", id: "row", fingerprint: pendingFingerprint("owner", asc) });
  assert.throws(() => decodeSpaceCursor(cursor, pendingFingerprint("owner", desc)));
});
