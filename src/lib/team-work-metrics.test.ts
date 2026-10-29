import assert from "node:assert/strict";
import test from "node:test";
import { calculateTeamWorkMetrics, combineTeamWorkMetrics } from "./team-work-metrics";
import type { WorkMetricCapture, WorkMetricRecord } from "./team-work-metrics";
import type { RealtimeHoursScheduleSlot } from "./realtime-hours-timeline";

const now = new Date("2026-10-28T18:00:00Z");
const date = (day: string) => new Date(`${day}T00:00:00Z`);
const slot = (employeeId = "a", day = "2026-10-26", startsAt = "08:00", endsAt = "17:00", status = "PRESENTE"): RealtimeHoursScheduleSlot => ({
  id: `${employeeId}:${day}`, employeeId, date: date(day), startsAt, endsAt, status, shift: { name: "Manhã", startsAt, endsAt }
});
const record = (hours: number, employeeId = "a", day = "2026-10-26"): WorkMetricRecord => ({ employeeId, date: date(day), scheduleId: `${employeeId}:${day}`, effectiveHours: hours, plannedHours: 8 });
const capture = (entry = "2026-10-26T11:00:00Z", exit = "2026-10-26T20:00:00Z", employeeId = "a", day = "2026-10-26"): WorkMetricCapture => ({
  employeeId, data: day, slotId: `${employeeId}:${day}`, entryAt: entry, exitAt: exit
});

test("adherence caps every day at 8h, preserves zero and missing days, and uses official overtime", () => {
  const rows = calculateTeamWorkMetrics(["a", "b", "c"], [slot(), slot("a", "2026-10-27"), slot("a", "2026-10-25"), slot("b"), slot("c")],
    [record(16), record(6, "a", "2026-10-27"), record(0, "b")], [], now);
  assert.equal(rows.get("a")!.adherenceRate, 87.5);
  assert.equal(rows.get("a")!.officialOvertimeHours, 8);
  assert.equal(rows.get("a")!.recordedDays, 2); assert.equal(rows.get("a")!.expectedDays, 3);
  assert.equal(rows.get("b")!.adherenceRate, 0); assert.equal(rows.get("b")!.officialOvertimeHours, 0);
  assert.equal(rows.get("c")!.adherenceRate, null); assert.equal(rows.get("c")!.officialOvertimeHours, null);
  assert.equal(rows.get("a")!.lateRate, null); assert.equal(rows.get("a")!.earlyRate, null);
});

test("team rates sum source numerators and denominators rather than averaging agent percentages", () => {
  const slots = [slot(), ...Array.from({ length: 9 }, (_, i) => slot("b", `2026-10-${String(i + 10).padStart(2, "0")}`))];
  const captures = [capture("2026-10-26T11:00:01Z", "2026-10-26T19:59:59Z"), ...slots.slice(1).map((s) => {
    const day = s.date.toISOString().slice(0, 10); return capture(`${day}T11:00:00Z`, `${day}T20:00:00Z`, "b", day);
  })];
  const byEmployee = calculateTeamWorkMetrics(["a", "b"], slots, [record(4), ...slots.slice(1).map((s) => record(8, "b", s.date.toISOString().slice(0, 10)))], captures, now);
  const team = combineTeamWorkMetrics([...byEmployee.values()]);
  assert.equal(team.lateRate, 10); assert.equal(team.earlyRate, 10); assert.equal(team.adherenceRate, 95);
  assert.equal(team.observedEntries, 10);
});

test("night shifts belong to their start date; ongoing shifts and days off do not enter rates", () => {
  const slots = [slot("a", "2026-10-27", "23:00", "08:00"), slot("a", "2026-10-28", "23:00", "08:00"), slot("b", "2026-10-26", "08:00", "17:00", "FOLGA")];
  const rows = calculateTeamWorkMetrics(["a", "b"], slots, [record(8, "a", "2026-10-27"), record(2, "a", "2026-10-28"), record(8, "b")],
    [capture("2026-10-28T02:10:00Z", "2026-10-28T10:30:00Z", "a", "2026-10-27")], now);
  assert.equal(rows.get("a")!.expectedDays, 1); assert.equal(rows.get("a")!.adherenceRate, 100);
  assert.equal(rows.get("a")!.lateRate, 100); assert.equal(rows.get("a")!.earlyRate, 100);
  assert.equal(rows.get("b")!.expectedDays, 0); assert.equal(rows.get("b")!.adherenceRate, null);
});

test("captures from another person, slot or date cannot fill a missing observation; duplicates count once", () => {
  const rows = calculateTeamWorkMetrics(["a"], [slot(), slot()], [record(8)], [capture(), capture(), capture(undefined, undefined, "other"),
    { ...capture(), slotId: "another-slot" }, { ...capture(), data: "2026-10-25" }], now);
  assert.equal(rows.get("a")!.recordedDays, 1); assert.equal(rows.get("a")!.observedEntries, 1);
  assert.equal(rows.get("a")!.lateRate, 0); assert.equal(rows.get("a")!.earlyRate, 0);
  const wrong = calculateTeamWorkMetrics(["a"], [slot()], [{ ...record(8), scheduleId: "deleted-slot" }], [{ ...capture(), slotId: "wrong" }], now).get("a")!;
  assert.equal(wrong.adherenceRate, null); assert.equal(wrong.lateRate, null);
});
