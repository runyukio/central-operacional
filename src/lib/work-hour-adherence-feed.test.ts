import assert from "node:assert/strict";
import test from "node:test";
import { createAdherenceFeed, emptyAdherenceFeed, type AdherencePage, type WorkHourAdherenceRow } from "./work-hour-adherence-feed";
import { initialAdherenceFilters } from "./work-hour-adherence-filters";

const filters = initialAdherenceFilters({ startDate: "2026-09-01", endDate: "2026-09-07" });
const row = (id: string): WorkHourAdherenceRow => ({ id, employeeId: id, employeeName: `Agente ${id}`, wbLogin: `wb_${id}`,
  date: "2026-09-03", lob: "ADS", classification: "ADS", supervisor: "Supervisor", supervisorId: "sup", shift: "Noite",
  plannedSlot: "23:00 - 08:00", capturedDuration: "6:00", durationSource: "Captura de Horas", status: "Pendente", justification: "", answeredBy: "", answeredAt: "" });
const page = (ids: string[], cursor: string | null = null): AdherencePage => ({ data: ids.map(row), pagination: { hasMore: cursor !== null, nextCursor: cursor } });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((a,b) => { resolve=a;reject=b; }); return { promise, resolve, reject }; }

test("filter change aborts and ignores stale results, including their finalizers", async () => {
  const a = deferred<AdherencePage>(); const b = deferred<AdherencePage>();
  const signals: AbortSignal[] = [];
  let state = emptyAdherenceFeed();
  const feed = createAdherenceFeed(async (f, _, signal) => { signals.push(signal); return f.lob === "ADS" ? a.promise : b.promise; }, s => { state=s; });
  const first = feed.reset({ ...filters, lob: "ADS" });
  const second = feed.reset({ ...filters, lob: "CEC" });
  assert.equal(signals[0].aborted, true);
  a.resolve(page(["stale"])); await first;
  assert.equal(state.loading, true); assert.equal(state.rows.length, 0);
  b.resolve({ ...page(["new"]), data: [{ ...row("new"), lob: "CEC" }] }); await second;
  assert.deepEqual(state.rows.map(r=>r.id), ["new"]);
});

test("infinite loading allows only one request and merges page ids without duplicates", async () => {
  const more = deferred<AdherencePage>(); let reads = 0; let state = emptyAdherenceFeed();
  const feed = createAdherenceFeed(async (_, cursor) => { reads++; return cursor ? more.promise : page(["a", "b"], "next"); }, s=>{state=s;});
  await feed.reset(filters);
  const loading = feed.loadMore(); await feed.loadMore(); await feed.loadMore();
  assert.equal(reads, 2); assert.equal(state.loadingMore, true); assert.equal(state.rows.length, 2);
  more.resolve(page(["b", "c"])); await loading;
  assert.deepEqual(state.rows.map(r=>r.id), ["a", "b", "c"]);
  await feed.loadMore(); assert.equal(reads, 2);
});

test("answer updates only the matching row and cannot be overwritten by an in-flight page", async () => {
  const more = deferred<AdherencePage>(); let reads = 0; let state = emptyAdherenceFeed();
  const feed = createAdherenceFeed(async (_, cursor) => { reads++; return cursor ? more.promise : page(["a", "b"], "next"); }, s=>{state=s;});
  await feed.reset(filters); const loading=feed.loadMore();
  feed.update({ ...row("a"), status:"Justificado", justification:"Motivo enviado", answeredBy:"Supervisor", answeredAt:"07/09/2026, 17:00" });
  assert.equal(reads, 2); assert.equal(state.rows[0].status,"Justificado");
  more.resolve(page(["a", "c"])); await loading;
  assert.equal(state.rows[0].justification,"Motivo enviado"); assert.deepEqual(state.rows.map(r=>r.id),["a","b","c"]);
});

test("pending-only answer removes the row, keeps cursor, and does not reappear from stale reads", async () => {
  let state = emptyAdherenceFeed();
  const feed = createAdherenceFeed(async (_, cursor) => cursor ? page(["a", "c"]) : page(["a", "b"], "next"),s=>{state=s;});
  await feed.reset({ ...filters, justificationStatus:"Pendentes" });
  feed.update({ ...row("a"), status:"Justificado" });
  assert.equal(state.nextCursor,"next"); assert.deepEqual(state.rows.map(r=>r.id),["b"]);
  await feed.loadMore(); assert.deepEqual(state.rows.map(r=>r.id),["b","c"]);
});

test("initial and next-page failures are retryable without losing loaded records or cursor", async () => {
  let fails = true; let state=emptyAdherenceFeed(); const cursors: Array<string|null>=[];
  const feed=createAdherenceFeed(async (_,cursor)=>{cursors.push(cursor);if(fails)throw new Error("Falha de teste");return cursor?page(["b"]):page(["a"],"next");},s=>{state=s;});
  await feed.reset(filters); assert.match(state.error,/Falha/); assert.equal(state.loading,false);
  fails=false;await feed.loadMore();fails=true;await feed.loadMore();
  assert.equal(state.rows[0].id,"a");assert.equal(state.nextCursor,"next");assert.equal(state.loadingMore,false);
  fails=false;await feed.loadMore();assert.deepEqual(state.rows.map(r=>r.id),["a","b"]);
  assert.deepEqual(cursors,[null,null,"next","next"]);
});

test("typing invalidates immediately, even before the debounced search is sent", async () => {
  const pending=deferred<AdherencePage>(); let state=emptyAdherenceFeed();
  const feed=createAdherenceFeed(async()=>pending.promise,s=>{state=s;});
  const loading=feed.reset(filters);feed.invalidate();pending.resolve(page(["old"]));await loading;
  assert.deepEqual(state,emptyAdherenceFeed());
});
