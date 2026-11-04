import assert from "node:assert/strict";
import test from "node:test";
import { applyRealtimeHoursEntryCorrections, parseRealtimeHoursEntryCorrection } from "./realtime-hours-entry-corrections";

test("confirmed entry changes arrival only and never manufactures captured working time", () => {
  const timeline = { date: "2026-11-04", rows: [{ employeeId: "agent", data: "2026-11-04",
    entryAt: "2026-11-04T18:00:00Z", confirmedEntryAt: null, arrivalDelayMs: 3600000,
    activeMs: 60000, segments: [{ type: "ACTIVE", start: "2026-11-04T18:00:00Z" }],
    plannedShifts: [{ start: "2026-11-04T17:00:00Z", end: "2026-11-05T02:00:00Z" }] }] };
  const corrected = applyRealtimeHoursEntryCorrections(timeline, [{ date: "2026-11-04", employeeId: "agent", entryAt: "2026-11-04T17:06:00Z" }]);
  assert.equal(corrected.rows[0].entryAt, "2026-11-04T17:06:00Z");
  assert.equal(corrected.rows[0].arrivalDelayMs, 360000);
  assert.equal(corrected.rows[0].activeMs, 60000);
  assert.deepEqual(corrected.rows[0].segments, timeline.rows[0].segments);
  assert.equal(timeline.rows[0].entryAt, "2026-11-04T18:00:00Z");
  for (const override of [
    { date: "2026-11-03", employeeId: "agent", entryAt: "2026-11-04T17:06:00Z" },
    { date: "2026-11-04", employeeId: "other", entryAt: "2026-11-04T17:06:00Z" },
    { date: "2026-11-04", employeeId: "agent", entryAt: "2026-11-04T12:00:00Z" }
  ]) assert.deepEqual(applyRealtimeHoursEntryCorrections(timeline, [override]), timeline);
});

test("ignores malformed entry corrections", () => {
  for (const value of [null, {}, { date: "2026-11-04", employeeId: "agent", entryAt: "invalid" }]) {
    assert.equal(parseRealtimeHoursEntryCorrection(value), null);
  }
});
