import assert from "node:assert/strict";
import test from "node:test";
import { assessSpaceTarget, isSpaceMaterialSkill, spaceTargets } from "./meu-espaco-targets";
import { emptySpaceMetric, finishSpaceMetric } from "./meu-espaco-metrics";
import { coverageSlotEnd, coverageSlotState, coverageSupervisorMatches } from "./meu-espaco-coverage";
import { compareSpaceValues, spaceAge } from "./meu-espaco-order";
import { decodeSpaceCursor, encodeSpaceCursor, pendingFingerprint, spacePendingFilters } from "./meu-espaco-filters";

const target = (id: string, lob = "ADS") => spaceTargets(lob).find((row) => row.id === id)!;

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
