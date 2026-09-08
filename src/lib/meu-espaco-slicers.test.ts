import assert from "node:assert/strict";
import test from "node:test";
import { spacePeriodPreset, spacePeriodSelection, spaceSearchMatches } from "./meu-espaco-slicers";

test("slicer seven-day shortcut is inclusive and crosses the month/year safely", () => {
  assert.deepEqual(spacePeriodPreset("week", "2026-09-03"), { startDate: "2026-08-28", endDate: "2026-09-03" });
  assert.deepEqual(spacePeriodPreset("week", "2026-01-02"), { startDate: "2025-12-27", endDate: "2026-01-02" });
  assert.deepEqual(spacePeriodPreset("week", "2024-03-03"), { startDate: "2024-02-26", endDate: "2024-03-03" });
});
test("period shortcuts preserve existing month-to-date default and custom ranges", () => {
  assert.deepEqual(spacePeriodPreset("month", "2026-09-08"), { startDate: "2026-09-01", endDate: "2026-09-08" });
  assert.deepEqual(spacePeriodPreset("today", "2026-09-08"), { startDate: "2026-09-08", endDate: "2026-09-08" });
  assert.equal(spacePeriodSelection({ startDate: "2026-08-01", endDate: "2026-08-31" }, "2026-09-08"), "custom");
  assert.equal(spacePeriodSelection(spacePeriodPreset("week", "2026-09-08"), "2026-09-08"), "week");
  assert.equal(spacePeriodSelection(spacePeriodPreset("month", "2026-09-08"), "2026-09-08"), "month");
});
test("supervisor search ignores accents, case and surrounding spaces", () => {
  assert.equal(spaceSearchMatches("Diógenes Lobo Martins", "  diogenes "), true);
  assert.equal(spaceSearchMatches("Supervisora Jéssica", "JESSICA"), true);
  assert.equal(spaceSearchMatches("Supervisora Ana", "bruno"), false);
  assert.equal(spaceSearchMatches("Supervisora Ana", ""), true);
});
