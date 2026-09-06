import assert from "node:assert/strict";
import test from "node:test";

import { needsRealtimeHourlyInputFallback, realtimeHourlyInputFallbackRows } from "@/lib/performance-hourly-input-source";

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

test("skips Real Time entirely when the imported period covers all hours", () => {
  const day = new Date("2026-08-26T00:00:00Z");
  const buckets = new Set(Array.from({ length: 24 }, (_, hour) => `2026-08-26 ${String(hour).padStart(2, "0")}:00`));
  assert.equal(needsRealtimeHourlyInputFallback(buckets, day, day), false);
  buckets.delete("2026-08-26 12:00");
  assert.equal(needsRealtimeHourlyInputFallback(buckets, day, day), true);
});
