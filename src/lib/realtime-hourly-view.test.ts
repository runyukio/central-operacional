import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Run the public read/export services with an uncached Next boundary and an
// in-memory read-only database. Any unplanned database operation fails the test.
function fixture(rawFallback = false) {
  const nativeRequire = createRequire(import.meta.url);
  const batches = ["2026-10-21 10:00", "2026-10-21 09:30", "2026-10-21 09:00", "2026-10-20 23:30"].map((value, index) => ({
    id: `batch-${index}`, fileName: "fixture.xlsx", importedAt: new Date(`${value.replace(" ", "T")}:00-03:00`),
    cycleDownload: value, cycleDownloads: [value], agentSummaries: [], queueSummaries: [], status: "SUCCESS", queueRows: 1, agentRows: 1, rowsTotal: 2
  }));
  const rows = batches.map((batch, index) => ({
    batch, batchId: batch.id, cycleDownload: batch.cycleDownload, sourceRows: 1,
    queueKey: "q", queueId: "test-unmapped", queueName: "Fixture", lob: "ADS", slaTargetMinutes: 120, status: "OK",
    input: 400 - index * 100, output: 360 - index * 100, backlog: 40, ahtMs: 1000, latencyMs: 2000, maxLatencyMs: 3000, maxLatencyRowNumber: 1,
    wbLoginNormalized: "wb_test", rawWbLogin: "wb_test", wbLogin: "wb_test", employeeId: null, displayName: "Test",
    crossingStatus: "Encontrado", personType: "Agente", employeeStatus: "Ativo", supervisor: "Supervisor", shift: "Manhã", skill: "Fixture", roleTitle: "Agente",
    submit: 400 - index * 100, moderationMs: 100000, timeout: 0, refresh: 0, queueCount: 1, queueBreakdown: []
  }));
  const summary = { findMany: async (args: any) => rawFallback ? [] : rows.filter((row) => args.where.batchId.in.includes(row.batchId)) };
  const database = {
    realTimeImportBatch: { findFirst: async () => batches[0], findMany: async () => batches },
    realTimeQueueCycleSummary: summary, realTimeAgentCycleSummary: summary,
    employeeProfile: { findMany: async () => [] },
    realTimeRecord: { findMany: async (args: any) => rows.filter((row) => args.where.batchId.in.includes(row.batchId)).map((row) => ({
      ...row, id: row.batchId, rowNumber: 1,
      rawData: { ciclo_download: row.cycleDownload, wb_login: row.wbLogin, submit: row.submit, "Fila ID": row.queueId, "Fila": row.queueName, input: row.input, output: row.output, "审核量": row.submit, "Backlog": row.backlog }
    })) }
  };
  const source = readFileSync(new URL("./realtime-service.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const loadedModule = { exports: {} };
  const requireMock = (name: string) => {
    if (name === "next/cache") return { unstable_cache: (callback: unknown) => callback };
    if (name === "@/lib/prisma") return { prisma: database };
    if (name === "@/lib/realtime-hours-service") return { getRealtimeHoursOperationalPresence: async () => ({ rows: [] }) };
    return nativeRequire(name.startsWith("@/") ? `../${name.slice(2)}` : name);
  };
  vm.runInThisContext(`(function(require, module, exports) { ${compiled}\n})`)(requireMock, loadedModule, loadedModule.exports);
  return { service: loadedModule.exports as typeof import("./realtime-service"), batches };
}

const actor = { role: "ADMIN" as const, email: "admin@example.invalid", name: "Admin" };

for (const rawFallback of [false, true]) {
  test(`hourly agents and queues use the previous hour and one history point per hour (${rawFallback ? "raw fallback" : "summaries"})`, async () => {
    const { service } = fixture(rawFallback);
    const result = await service.getRealtimeSnapshot(actor, { cycleGrouping: "hour" });
    assert.ok("data" in result && result.data);
    for (const view of [result.data.queueView, result.data.agents]) {
      assert.deepEqual(view.cycles.map((row) => row.value), ["2026-10-21 10:00", "2026-10-21 09:30", "2026-10-20 23:30"]);
      assert.equal(view.selectedCycle, "2026-10-21 10:00");
      assert.equal(view.previousCycle, "2026-10-21 09:30");
      assert.equal(view.rows.length, 1);
      assert.equal(view.rows[0].history.length, 3);
    }
    assert.equal(result.data.queueView.rows[0].current.input, 400);
    assert.equal(result.data.queueView.rows[0].deltas.input, 100);
    assert.equal(result.data.agents.rows[0].current.submit, 400);
    assert.equal(result.data.agents.rows[0].deltas.submit, 100);
  });
}

test("historical hourly selection follows the representative cycle and exports its hourly comparison", async () => {
  const { service } = fixture();
  const result = await service.getRealtimeSnapshot(actor, { cycleGrouping: "hour", cycleDownload: "2026-10-21 09:00", view: "queues" });
  assert.ok("data" in result && result.data);
  assert.equal(result.data.queueView.selectedCycle, "2026-10-21 09:30");
  assert.equal(result.data.queueView.previousCycle, "2026-10-20 23:30");
  assert.equal(result.data.queueView.rows[0].current.input, 300);
  assert.equal(result.data.queueView.rows[0].previous?.input, 100);
  const exported = await service.exportRealtimeAgents(actor, { cycleGrouping: "hour", cycleDownload: "2026-10-21 09:00", view: "queues" });
  assert.ok(!("error" in exported));
  assert.equal(exported.rows[0][0], "2026-10-21 09:30");
  assert.equal(exported.rows[0][1], "2026-10-20 23:30");
  assert.equal(exported.rows[0][3], 300);
  const history = exported.sheets?.find((sheet) => sheet.sheetName === "Detalhe por Fila");
  assert.ok(history);
  assert.doesNotMatch(JSON.stringify(history.rows), /2026-10-21 09:00/);
});

test("unmodified API calls keep the half-hour comparison and history", async () => {
  const { service } = fixture();
  const result = await service.getRealtimeSnapshot(actor, { cycleDownload: "2026-10-21 09:30" });
  assert.ok("data" in result && result.data);
  assert.equal(result.data.queueView.cycles.length, 4);
  assert.equal(result.data.queueView.previousCycle, "2026-10-21 09:00");
  assert.equal(result.data.agents.previousCycle, "2026-10-21 09:00");
});
