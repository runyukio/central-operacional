import assert from "node:assert/strict";
import test from "node:test";
import { parseRealtimeCycleHeads, readRealtimeCycleHeads, refreshRealtimeCycleHeads, realtimeCycleHeadsKey, type CycleHeadsReadDb } from "./realtime-cycle-heads";

const queues = { cycleDownload: "2026-11-09 16:00", importedAt: "2026-11-09T19:01:00.000Z" };
const agents = { cycleDownload: "2026-11-09 15:00", importedAt: "2026-11-09T18:01:00.000Z" };

test("checkpoint accepts separate feeds and a legitimately absent feed, rejects malformed or incompatible state", () => {
  assert.deepEqual(parseRealtimeCycleHeads({ version: 1, queues, agents: null }), { version: 1, queues, agents: null });
  for (const value of [null, [], {}, { version: 2, queues, agents }, { version: 1, queues },
    { version: 1, queues: { ...queues, importedAt: "not-a-date" }, agents }]) {
    assert.equal(parseRealtimeCycleHeads(value), null);
  }
});

test("monitor reads one stored checkpoint without scanning either summary table", async () => {
  const db = {
    systemConfig: { findUnique: async ({ where }: { where: { key: string } }) => {
      assert.equal(where.key, realtimeCycleHeadsKey);
      return { value: { version: 1, queues, agents } };
    } },
    realTimeQueueCycleSummary: { findFirst: async () => { throw new Error("unexpected queue scan"); } },
    realTimeAgentCycleSummary: { findFirst: async () => { throw new Error("unexpected agent scan"); } }
  } as unknown as CycleHeadsReadDb;
  assert.deepEqual(await readRealtimeCycleHeads(db), { version: 1, queues, agents });
});

test("a missing checkpoint falls back to successful summaries without conflating queue and agent imports or writing", async () => {
  const selections: unknown[] = [];
  const db = {
    systemConfig: { findUnique: async () => null, upsert: async () => { throw new Error("read-only caller wrote state"); } },
    realTimeQueueCycleSummary: { findFirst: async (query: unknown) => {
      selections.push(query);
      return { cycleDownload: queues.cycleDownload, batch: { importedAt: new Date(queues.importedAt) } };
    } },
    realTimeAgentCycleSummary: { findFirst: async (query: unknown) => { selections.push(query); return null; } }
  } as unknown as CycleHeadsReadDb;
  assert.deepEqual(await readRealtimeCycleHeads(db), { version: 1, queues, agents: null });
  assert.equal(selections.length, 2);
  assert.deepEqual(selections[0], {
    where: { batch: { status: "SUCCESS" } },
    orderBy: [{ batch: { importedAt: "desc" } }, { cycleDownload: "desc" }, { createdAt: "desc" }],
    select: { cycleDownload: true, batch: { select: { importedAt: true } } }
  });
});

test("an out-of-order import refresh re-reads both feeds after taking the lock rather than publishing its own older cycle", async () => {
  let locked = false;
  let saved: unknown;
  const db = {
    $executeRaw: async () => { locked = true; },
    systemConfig: { upsert: async ({ update }: { update: { value: unknown } }) => { saved = update.value; } },
    realTimeQueueCycleSummary: { findFirst: async () => {
      assert.equal(locked, true);
      return { cycleDownload: queues.cycleDownload, batch: { importedAt: new Date(queues.importedAt) } };
    } },
    realTimeAgentCycleSummary: { findFirst: async () => {
      assert.equal(locked, true);
      return { cycleDownload: agents.cycleDownload, batch: { importedAt: new Date(agents.importedAt) } };
    } }
  } as unknown as Parameters<typeof refreshRealtimeCycleHeads>[0];
  await refreshRealtimeCycleHeads(db);
  assert.deepEqual(saved, { version: 1, queues, agents });
});
