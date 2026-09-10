import assert from "node:assert/strict";
import test, { beforeEach, type TestContext } from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { performanceManualBases, validateManualFileManifest, type PerformanceManualBase, type OperationalManualBase } from "./performance-manual-bases";
import { replaceSelectedManualSnapshots, type ManualSnapshotFiles } from "./performance-manual-snapshot";
import { prepareManualOperationalRows, type PerformancePreviewRow } from "./performance-service";

const actor = { email: "qa@example.test", name: "QA", role: "ADMIN" as const };
const user = (role: string) => ({ id: "u", email: actor.email, name: actor.name, status: "ACTIVE", deletedAt: null, role: { name: role }, employeeProfile: null });
beforeEach((t) => {
  const original = prisma.user;
  (prisma as any).user = { findUnique: async () => user("ADMIN") };
  (t as TestContext).after(() => { (prisma as any).user = original; });
});
function row(key: OperationalManualBase, patch: Partial<PerformancePreviewRow> = {}): PerformancePreviewRow {
  return { type: key === "production" ? "PRODUCTION" : key === "volume" ? "PRODUCTION_VOLUME" : "CEC_CPD",
    rowNumber: 2, wbLogin: "wb_test", date: "2026-09-08", uniqueKey: "same-key", action: "create", errors: [], warnings: [],
    payload: { bzTime: "2026-09-08T10:00:00Z", bzDay: "2026-09-08", submitNum: 70, moderationSeconds: 3500, ahtSeconds: 50,
      queueId: "6000", productionKey: "same-key", volumeKey: "same-key", inputCount: 90,
      performanceTime: "2026-09-08T10:00:00Z", performanceDay: "2026-09-08", cpdKey: "same-key", ticketCount: 100 }, ...patch };
}
function files(keys: PerformanceManualBase[]): ManualSnapshotFiles {
  return Object.fromEntries(keys.map((key) => [key, key === "cecFrt" ? {
    fileName: "frt.xlsx", rows: [{ ticketCreatedDay: new Date("2026-09-08"), wbLogin: "wb_test", employeeId: null,
      priority: "NORMAL", total: 100, over240: 20, over1440: 10 }],
    summary: { cecFrtRows: 1, unmatchedRows: 1, unmatchedLogins: 1, startDate: "2026-09-08", endDate: "2026-09-08" }
  } : { fileName: `${key}.xlsx`, rows: [row(key)] }]));
}

test("manual manifest permits any subset but rejects missing, duplicate, unknown or unexpected bases", () => {
  for (const { key } of performanceManualBases) assert.doesNotThrow(() => validateManualFileManifest(key, [key]));
  assert.doesNotThrow(() => validateManualFileManifest("production,cecFrt", ["cecFrt", "production"]));
  assert.doesNotThrow(() => validateManualFileManifest(null, ["quality"]));
  for (const [manifest, received] of [["", []], ["production,volume", ["production"]], ["cecFrt", ["cecFrt", "volume"]], ["volume,volume", ["volume"]], ["unknown", ["unknown"]]] as Array<[string, string[]]>) {
    assert.throws(() => validateManualFileManifest(manifest, received));
  }
});

test("manual operational preparation guards file slots and retains existing summing/ignored-row rules", () => {
  for (const key of ["production", "volume", "cecCpd"] as const) {
    const prepared = prepareManualOperationalRows(key, [row(key), row(key), row(key, { errors: ["WB/Login não encontrado no cadastro."] })]);
    assert.equal(prepared.rows.length, 1); assert.equal(prepared.validCount, 2); assert.equal(prepared.errorCount, 1);
    assert.equal(prepared.rows[0].payload[key === "production" ? "submitNum" : key === "volume" ? "inputCount" : "ticketCount"], key === "production" ? 140 : key === "volume" ? 180 : 200);
    assert.throws(() => prepareManualOperationalRows(key, []), /não contém linhas válidas/);
  }
  assert.throws(() => prepareManualOperationalRows("production", [row("volume")]), /não corresponde/);
});

type RecordRow = { importBatchId: string | null; [key: string]: unknown };
const models = { production: "ProductionRecord", volume: "PerformanceQueueVolumeRecord", cecCpd: "PerformanceCecCpdRecord", cecFrt: "PerformanceCecFrtRecord" };
const relationKeys = ["productionRecords", "queueVolumeRecords", "cecCpdRecords", "cecFrtRecords", "qualityRecords", "tnsQualityRecords", "cecQualityRecords"];
function database(t: TestContext, failBase?: PerformanceManualBase) {
  let state = {
    records: Object.fromEntries(performanceManualBases.map(({ key }) => [key, [
      { importBatchId: key === "cecFrt" ? "old-frt" : "legacy-mixed", key: "same-key", previous: 1 },
      { importBatchId: null, key: "old-date", previous: 2 }
    ]])) as unknown as Record<PerformanceManualBase, RecordRow[]>,
    batches: [{ id: "legacy-mixed", type: "PRODUCTION", status: "SUCCESS" }, { id: "old-frt", type: "CEC_FRT", status: "SUCCESS" }, { id: "in-progress", type: "PRODUCTION", status: "PROCESSING" }],
    audits: [] as unknown[]
  };
  const initial = structuredClone(state), calls: string[] = [];
  t.mock.method(prisma, "$executeRaw", async () => { throw new Error("write escaped transaction"); });
  t.mock.method(prisma, "$transaction", async (callback: any) => {
    const previous = structuredClone(state);
    const tx = {
      $queryRaw: async () => { calls.push("lock"); return []; },
      $executeRaw: async (sql: Prisma.Sql) => {
        const key = (Object.entries(models) as Array<[PerformanceManualBase, string]>).find(([, model]) => sql.text.includes(`INSERT INTO "${model}"`))?.[0];
        assert.ok(key); calls.push(key);
        if (key === failBase) throw new Error("simulated write failure");
        const incoming = JSON.parse(sql.values[0] as string);
        state.records[key] = [...state.records[key].filter((item) => item.key !== "same-key"), ...incoming];
        return incoming.length;
      },
      performanceImportBatch: {
        findMany: async () => state.batches.filter((batch) => batch.type === "PRODUCTION" && batch.status !== "PROCESSING"),
        create: async ({ data }: any) => { const batch = { ...data, id: `new-${state.batches.length}` }; state.batches.push(batch); return batch; },
        deleteMany: async ({ where }: any) => {
          if (where.type === "PRODUCTION") {
            for (const relation of relationKeys) assert.deepEqual(where[relation], { none: {} });
            state.batches = state.batches.filter((batch) => !where.id.in.includes(batch.id) || Object.values(state.records).some((records) => records.some((item) => item.importBatchId === batch.id)));
          } else {
            assert.equal(where.status.not, "PROCESSING");
            const deleted = state.batches.filter((batch) => batch.type === "CEC_FRT" && batch.id !== where.id.not && batch.status !== "PROCESSING");
            state.batches = state.batches.filter((batch) => !deleted.includes(batch));
            state.records.cecFrt = state.records.cecFrt.filter((record) => !deleted.some((batch) => batch.id === record.importBatchId));
          }
          return { count: 1 };
        }
      },
      performanceCecFrtRecord: { createMany: async ({ data }: any) => { calls.push("cecFrt"); if (failBase === "cecFrt") throw new Error("simulated write failure"); state.records.cecFrt.push(...data); return { count: data.length }; } },
      auditLog: { create: async ({ data }: any) => { state.audits.push(data); return data; } }
    };
    for (const key of ["production", "volume", "cecCpd"] as const) {
      (tx as any)[models[key][0].toLowerCase() + models[key].slice(1)] = { deleteMany: async ({ where }: any) => {
        assert.equal(where.OR[0].importBatchId, null);
        const kept = where.OR[1].importBatchId.not;
        state.records[key] = state.records[key].filter((record) => record.importBatchId === kept); return { count: 1 };
      } };
    }
    try { return await callback(tx); } catch (error) { state = previous; throw error; }
  });
  return { state: () => state, initial, calls };
}

for (let mask = 1; mask < 16; mask++) {
  const selected = performanceManualBases.filter((_, index) => mask & (1 << index)).map((base) => base.key);
  test(`manual replacement preserves every unselected base and legacy batch: ${selected.join(" + ")}`, async (t) => {
    const db = database(t);
    const result = await replaceSelectedManualSnapshots(actor, files(selected));
    assert.deepEqual(result.selectedBases, selected);
    for (const definition of performanceManualBases) {
      if (!selected.includes(definition.key)) {
        assert.deepEqual(db.state().records[definition.key], db.initial.records[definition.key]);
        assert.equal(result[definition.resultKey], undefined);
      } else {
        assert.equal(result[definition.resultKey], 1);
        if (definition.key !== "cecFrt") assert.equal(db.state().records[definition.key].length, 1);
      }
    }
    if (["production", "volume", "cecCpd"].some((key) => !selected.includes(key as PerformanceManualBase))) assert.ok(db.state().batches.some((batch) => batch.id === "legacy-mixed"));
    assert.ok(db.state().batches.some((batch) => batch.id === "in-progress"));
    assert.equal(db.state().audits.length, 1);
  });
}

test("manual mixed import rollback includes prior selected writes, deletion, batch metadata and audit", async (t) => {
  const db = database(t, "cecFrt");
  await assert.rejects(() => replaceSelectedManualSnapshots(actor, files(["production", "volume", "cecCpd", "cecFrt"])), /simulated write failure/);
  assert.ok(db.calls.includes("production")); assert.ok(db.calls.includes("cecFrt"));
  assert.deepEqual(db.state(), db.initial);
});

test("manual empty or invalid selected file fails before starting a write transaction", async (t) => {
  const transaction = t.mock.method(prisma, "$transaction", async () => { throw new Error("must not write"); });
  await assert.rejects(() => replaceSelectedManualSnapshots(actor, {}), /pelo menos uma/);
  const selection = files(["production", "volume"]); selection.volume!.rows = [row("production")];
  await assert.rejects(() => replaceSelectedManualSnapshots(actor, selection), /não corresponde/);
  assert.equal(transaction.mock.callCount(), 0);
});

test("manual import is restricted to database-authorized ADMIN/WFM regardless of actor claims", async (t) => {
  const transaction = t.mock.method(prisma, "$transaction", async () => { throw new Error("must not write"); });
  for (const role of ["SUPERVISOR", "GESTOR", "COLABORADOR", "POC"]) {
    t.mock.method(prisma.user, "findUnique", async () => user(role));
    await assert.rejects(() => replaceSelectedManualSnapshots(actor, files(["volume"])), /Apenas ADMIN ou WFM/i);
  }
  assert.equal(transaction.mock.callCount(), 0);
});
