import assert from "node:assert/strict";
import test from "node:test";

import { createBoundedSnapshotCache } from "./bounded-snapshot-cache";

test("slow queries share in-flight work and remain fresh for a full TTL after completion", async (t) => {
  let now = 0;
  t.mock.method(Date, "now", () => now);
  const cache = createBoundedSnapshotCache<number>(15_000, 2);
  let complete!: (value: number) => void;
  let calls = 0;
  const load = () => {
    calls += 1;
    return new Promise<number>((resolve) => { complete = resolve; });
  };
  const first = cache.get("monthly", load);
  await Promise.resolve();
  now = 56_000;
  assert.equal(cache.get("monthly", load), first);
  assert.equal(calls, 1);
  complete(30);
  assert.equal(await first, 30);
  now = 70_999;
  assert.equal(await cache.get("monthly", load), 30);
  now = 71_000;
  assert.equal(await cache.get("monthly", async () => 31), 31);
});

test("cleared in-flight work cannot replace a new snapshot or remove it on failure", async () => {
  const cache = createBoundedSnapshotCache<number>(15_000, 2);
  let rejectOld!: (reason: Error) => void;
  const old = cache.get("monthly", () => new Promise<number>((_, reject) => { rejectOld = reject; }));
  await Promise.resolve();
  cache.clear();
  assert.equal(await cache.get("monthly", async () => 2), 2);
  rejectOld(new Error("old query failed"));
  await assert.rejects(old, /old query failed/);
  assert.equal(await cache.get("monthly", async () => 3), 2);
});

test("pending and settled snapshots stay bounded by capacity and isolate request scopes", async () => {
  const cache = createBoundedSnapshotCache<number>(15_000, 2);
  let finish!: (value: number) => void;
  const pending = cache.get("team-a", () => new Promise<number>((resolve) => { finish = resolve; }));
  await Promise.resolve();
  assert.equal(await cache.get("team-b", async () => 2), 2);
  assert.equal(await cache.get("team-c", async () => 3), 3);
  assert.equal(await cache.get("team-a", async () => 4), 4);
  finish(1);
  await pending;
  assert.equal(await cache.get("team-a", async () => 5), 4);
});
