import assert from "node:assert/strict";
import test from "node:test";

import { realtimeHourlyInputFallbackRows } from "@/lib/performance-hourly-input-source";

test("preserves imported hourly input and only fills missing hours from Real Time", () => {
  const importedBuckets = new Set(["2026-08-26 10:00", "2026-08-26 11:00"]);

  const rows = realtimeHourlyInputFallbackRows(importedBuckets, [
    { key: "2026-08-26 10:00", input: 605 },
    { key: "2026-08-26 11:00", input: 432 },
    { key: "2026-08-26 12:00", input: 462 }
  ]);

  assert.deepEqual(rows, [{ key: "2026-08-26 12:00", input: 462 }]);
});

test("treats an imported zero as authoritative", () => {
  const importedBuckets = new Set(["2026-08-26 12:00"]);

  const rows = realtimeHourlyInputFallbackRows(importedBuckets, [
    { key: "2026-08-26 12:00", input: 462 }
  ]);

  assert.deepEqual(rows, []);
});
