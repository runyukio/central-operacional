import assert from "node:assert/strict";
import test from "node:test";
import { createSpacePendingFeed, type SpaceFeedState, type SpacePendingPage } from "./meu-espaco-feed";
import type { SpacePending } from "./meu-espaco-contract";
const row = (id: string, pending = true) => ({ id, kind: "hours", pending }) as SpacePending;
const page = (ids: string[], more = false) => ({ data: ids.map((id) => row(id)), hasMore: more, nextCursor: more ? "next" : null });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
test("late requests cannot replace new filters; old requests are aborted", async () => {
  const requests: Array<{ signal: AbortSignal; value: ReturnType<typeof deferred<SpacePendingPage>> }> = [];
  let state!: SpaceFeedState;
  const feed = createSpacePendingFeed(async (_, __, signal) => { const value = deferred<SpacePendingPage>(); requests.push({ signal, value }); return value.promise; }, (value) => { state = value; });
  const old = feed.reset("search=old"), fresh = feed.reset("search=new");
  assert.equal(requests[0].signal.aborted, true);
  requests[1].value.resolve(page(["new"])); await fresh;
  requests[0].value.resolve(page(["old"])); await old;
  assert.deepEqual(state.rows.map((row) => row.id), ["new"]);
});
test("one load-more at a time, deduplication and item-only answer survive in-flight page", async () => {
  let calls = 0, state!: SpaceFeedState; const next = deferred<SpacePendingPage>();
  const feed = createSpacePendingFeed(async () => ++calls === 1 ? page(["1", "2"], true) : next.promise, (value) => { state = value; });
  await feed.reset("state=pending"); const more = feed.more(); await feed.more(); assert.equal(calls, 2);
  feed.answer(row("2", false)); assert.deepEqual(state.rows.map((row) => row.id), ["1"]);
  next.resolve(page(["2", "3"])); await more;
  assert.deepEqual(state.rows.map((row) => row.id), ["1", "3"]); assert.equal(calls, 2);
});
test("network failure preserves loaded rows/cursor and retry appends without a reset", async () => {
  let calls = 0, state!: SpaceFeedState;
  const feed = createSpacePendingFeed(async () => { calls++; if (calls === 1) return page(["1"], true); if (calls === 2) throw new Error("rede"); return page(["1", "2"]); }, (value) => { state = value; });
  await feed.reset("state=pending"); await feed.more();
  assert.equal(state.error, "rede"); assert.equal(state.nextCursor, "next"); assert.equal(state.rows.length, 1);
  await feed.retry(); assert.equal(state.error, ""); assert.deepEqual(state.rows.map((row) => row.id), ["1", "2"]);
});
