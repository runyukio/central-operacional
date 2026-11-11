import assert from "node:assert/strict";
import test from "node:test";
import { groupRealtimeCycles, realtimeClosedHourStart, selectRealtimeCycle } from "./realtime-hourly-cycles";

const cycle = (value: string, importedAt = `${value.replace(" ", "T")}:00-03:00`) => ({ value, importedAt, rows: 10 });

test("the 15:00 reading closes the reference hour that starts at 14:00", () => {
  assert.equal(realtimeClosedHourStart("2026-11-09 15:00"), "2026-11-09 14:00");
  assert.equal(realtimeClosedHourStart("2026-11-09 15:30"), null);
});

test("midnight closes the last hour of the previous date", () => {
  assert.equal(realtimeClosedHourStart("2026-11-10 00:00"), "2026-11-09 23:00");
  assert.equal(realtimeClosedHourStart("2026-01-01 00:00"), "2025-12-31 23:00");
});

test("the full-hour snapshot wins over the half-hour and keeps its actual values", () => {
  const rows = [cycle("2026-10-21 10:00"), cycle("2026-10-21 09:00"), cycle("2026-10-21 09:30")];
  const before = structuredClone(rows);
  const result = groupRealtimeCycles(rows, "hour");
  assert.deepEqual(result.map((row) => row.value), ["2026-10-21 10:00", "2026-10-21 09:00"]);
  assert.equal(result[1], rows[1]);
  assert.equal(result[1].rows, 10);
  assert.deepEqual(rows, before);
});

test("the latest import of the full-hour snapshot wins even when a half-hour was imported later", () => {
  const rows = [cycle("2026-10-21 09:30", "2026-10-21T15:00:00Z"),
    cycle("2026-10-21 09:00", "2026-10-21T14:00:00Z"), cycle("2026-10-21 09:00")];
  assert.equal(groupRealtimeCycles(rows, "hour")[0], rows[1]);
});

test("when the full hour is missing, preserve the available snapshot's timestamp", () => {
  const rows = [cycle("2026-10-21 10:00"), cycle("2026-10-20 23:30"), cycle("2026-10-21 00:00"), cycle("2026-10-21 00:30")];
  assert.deepEqual(groupRealtimeCycles(rows, "hour").map((row) => row.value), ["2026-10-21 10:00", "2026-10-21 00:00", "2026-10-20 23:30"]);
});

test("a selection saved at :30 resolves to the full-hour snapshot when it exists", () => {
  const rows = groupRealtimeCycles([cycle("2026-10-21 10:00"), cycle("2026-10-21 09:30"), cycle("2026-10-21 09:00")], "hour");
  assert.equal(selectRealtimeCycle(rows, "2026-10-21 09:30", "hour"), "2026-10-21 09:00");
  assert.equal(selectRealtimeCycle(rows, "2026-10-21 10:00", "hour"), "2026-10-21 10:00");
  assert.equal(selectRealtimeCycle([], undefined, "hour"), "");
});

test("existing API and automation callers keep all original cycles", () => {
  const rows = [cycle("2026-10-21 09:30"), cycle("2026-10-21 09:00")];
  assert.equal(groupRealtimeCycles(rows), rows);
  assert.equal(groupRealtimeCycles(rows, "original"), rows);
  assert.equal(selectRealtimeCycle(rows, "2026-10-21 09:00"), "2026-10-21 09:00");
});
