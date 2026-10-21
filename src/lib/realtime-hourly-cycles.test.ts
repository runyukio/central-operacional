import assert from "node:assert/strict";
import test from "node:test";
import { groupRealtimeCycles, selectRealtimeCycle } from "./realtime-hourly-cycles";

const cycle = (value: string, importedAt = `${value.replace(" ", "T")}:00-03:00`) => ({ value, importedAt, rows: 10 });

test("one snapshot per hour preserves the latest cumulative values, without summing", () => {
  const rows = [cycle("2026-10-21 10:00"), cycle("2026-10-21 09:00"), cycle("2026-10-21 09:30")];
  const before = structuredClone(rows);
  const result = groupRealtimeCycles(rows, "hour");
  assert.deepEqual(result.map((row) => row.value), ["2026-10-21 10:00", "2026-10-21 09:30"]);
  assert.equal(result[1], rows[2]);
  assert.equal(result[1].rows, 10);
  assert.deepEqual(rows, before);
});

test("a late reimport of an earlier half-hour cannot hide the later snapshot", () => {
  const rows = [cycle("2026-10-21 09:00", "2026-10-21T14:00:00Z"), cycle("2026-10-21 09:30")];
  assert.equal(groupRealtimeCycles(rows, "hour")[0].value, "2026-10-21 09:30");
});

test("midnight, missing hours and the current incomplete hour remain separate", () => {
  const rows = [cycle("2026-10-21 10:00"), cycle("2026-10-20 23:00"), cycle("2026-10-20 23:30"), cycle("2026-10-21 00:00")];
  assert.deepEqual(groupRealtimeCycles(rows, "hour").map((row) => row.value), ["2026-10-21 10:00", "2026-10-21 00:00", "2026-10-20 23:30"]);
});

test("refresh keeps a selected historical hour as its latest snapshot advances", () => {
  const rows = groupRealtimeCycles([cycle("2026-10-21 10:00"), cycle("2026-10-21 09:30")], "hour");
  assert.equal(selectRealtimeCycle(rows, "2026-10-21 09:00", "hour"), "2026-10-21 09:30");
  assert.equal(selectRealtimeCycle(rows, "2026-10-21 10:00", "hour"), "2026-10-21 10:00");
  assert.equal(selectRealtimeCycle([], undefined, "hour"), "");
});

test("existing API and automation callers keep all original cycles", () => {
  const rows = [cycle("2026-10-21 09:30"), cycle("2026-10-21 09:00")];
  assert.equal(groupRealtimeCycles(rows), rows);
  assert.equal(groupRealtimeCycles(rows, "original"), rows);
  assert.equal(selectRealtimeCycle(rows, "2026-10-21 09:00"), "2026-10-21 09:00");
});
