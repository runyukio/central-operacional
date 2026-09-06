import assert from "node:assert/strict";
import test from "node:test";
import { isRealtimeHoursArchiveFresh, selectRealtimeHoursArchiveDates } from "./realtime-hours-archive-policy";
import { createBoundedSnapshotCache } from "./bounded-snapshot-cache";

test("legacy, late-event and changed-reference fingerprints cannot be treated as current", () => {
  assert.equal(isRealtimeHoursArchiveFresh(null, "current"), false);
  assert.equal(isRealtimeHoursArchiveFresh("before-late-upload", "after-late-upload"), false);
  assert.equal(isRealtimeHoursArchiveFresh("old-mapping", "new-mapping"), false);
  assert.equal(isRealtimeHoursArchiveFresh("same", "same"), true);
  assert.equal(isRealtimeHoursArchiveFresh(undefined, undefined), false);
});

test("maintenance backfills missing dates before fairly rechecking old archives", () => {
  const dates = ["2026-07-01", "2026-07-02", "2026-07-03"];
  const existing = [
    { dateKey: dates[0], updatedAt: new Date("2026-09-01") },
    { dateKey: dates[1], updatedAt: new Date("2026-08-01") }
  ];
  assert.deepEqual(selectRealtimeHoursArchiveDates(dates, existing, 2), [dates[2], dates[1]]);
});

test("snapshot cache shares in-flight work, isolates scopes and evicts failures", async () => {
  const cache = createBoundedSnapshotCache<number>(15_000, 2);
  let calls = 0;
  const load = async () => ++calls;
  assert.deepEqual(await Promise.all([cache.get("employee-a", load), cache.get("employee-a", load)]), [1, 1]);
  assert.equal(await cache.get("employee-b", load), 2);
  await assert.rejects(cache.get("failed", async () => { throw new Error("retry"); }));
  assert.equal(await cache.get("failed", load), 3);
  cache.clear();
  assert.equal(await cache.get("failed", load), 4);
});
