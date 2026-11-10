import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import * as XLSX from "xlsx";
import { Prisma } from "@prisma/client";
import { QUALITY_CATEGORY_QUEUE_IDS, normalizeQualityQueueId, readPerformanceQualityParams } from "./performance-quality";
import { buildPerformanceQualityExportPayload } from "./performance-quality-export";
import { buildXlsxResponse } from "./xlsx-export";
import { serializeQualityIndicators } from "./performance-quality-metrics";

const localRequire = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("./performance-service.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText;
const actor = { email: "qa@example.test" } as Parameters<typeof import("./performance-service").getPerformanceQualityDashboard>[0];
const at = new Date("2026-11-01T00:00:00Z");

function harness(role = "ADMIN") {
  const queries: Prisma.Sql[] = [];
  const writes: Array<{ queueId: string | null; negativeSign?: string | null; allowAmount?: number | null; labeledAmount?: number | null }> = [];
  const db = {
    user: { findUnique: async () => ({ id: "admin", name: "QA", email: actor.email, status: "ACTIVE", role: { name: role } }) },
    employeeProfile: { findMany: async () => [{ id: "agent", fullName: "Ana", wbLogin: "wb_ana", lobId: "video", lob: { name: "VIDEO" } }] },
    performanceImportBatch: {
      findFirst: async () => null,
      findUnique: async () => ({ id: "batch", type: "QUALITY_TNS_KAP", status: "PROCESSING" }),
      update: async () => ({ id: "batch" })
    },
    qualityRecord: { createMany: async ({ data }: { data: typeof writes }) => { writes.push(...data); return { count: data.length }; } },
    $queryRaw: async (query: Prisma.Sql) => {
      queries.push(query);
      if (query.sql.includes("MIN(")) return [{ startDate: at, endDate: at }];
      if (query.sql.includes('AS "periodStart"')) return [{ periodStart: at, total: 10, correct: 1, pass: 13, fail: 1 }];
      if (query.sql.includes('AS "employeeId"')) return [{ employeeId: "agent", employeeName: "Ana", wbLogin: "wb_ana", supervisor: "Bruna", total: 10, correct: 1, pass: 13, fail: 1, lastAuditAt: at }];
      return [{ total: 10, correct: 1, unclassifiedTotal: 2, pass: 13, fail: 1 }];
    }
  };
  const mod = { exports: {} as typeof import("./performance-service") };
  new Function("require", "exports", "module", compiled)((name: string) => name === "@/lib/prisma" ? { prisma: db } : localRequire(name), mod.exports, mod);
  return { service: mod.exports, queries, writes };
}

test("TNS uses VIDEO and COMMENTS together, distinct counts, and the same category in all aggregates", async () => {
  for (const category of ["PUSH", "USER", "COMMENTS", "VIDEO"] as const) {
    const { service, queries } = harness();
    const result = await service.getPerformanceQualityDashboard(actor, { lob: "TNS", category, view: "weekly" });
    assert.equal(result.selectedLob, "TNS");
    assert.equal(result.selectedCategory, category);
    assert.equal(result.summary.quality, 10); // 1 correct / 10 audited, rather than a mean of LOB scores.
    assert.equal(result.trend[0].quality, 10);
    assert.equal(result.agents[0].quality, 10);
    assert.equal(queries.length, 4);
    for (const query of queries) {
      assert.match(query.sql, /IN \('VIDEO', 'COMMENTS'\)/);
      assert.match(query.sql, /visible_batch\."status" <> 'PROCESSING'/);
    }
    for (const query of queries.slice(1)) {
      assert.match(query.sql, /AND q\."queueId" IN \(/);
      for (const id of QUALITY_CATEGORY_QUEUE_IDS[category]) assert.ok(query.values.includes(id), id);
      assert.match(query.sql, /COUNT\(DISTINCT/);
      assert.doesNotMatch(query.sql, /LIMIT 500|AVG\(/);
    }
    assert.ok(!queries[0].sql.includes('q."queueId"')); // Stable base date window across categories.
  }
});

test("unfiltered TNS preserves legacy totals, while ADS and CEC ignore category filters", async () => {
  for (const lob of ["TNS", "ADS", "VIDEO", "COMMENTS", "CEC"] as const) {
    const { service, queries } = harness();
    const result = await service.getPerformanceQualityDashboard(actor, { lob, category: lob === "ADS" || lob === "CEC" ? "PUSH" : undefined });
    assert.equal(result.selectedCategory, null);
    assert.ok(!queries.some((query) => query.sql.includes('AND q."queueId" IN')));
    assert.equal(result.summary.quality, lob === "CEC" ? 92.86 : 10);
    if (lob === "TNS") assert.equal(result.unclassifiedTotal, 2);
    if (lob === "ADS") assert.match(queries[0].sql, /IN \('ADS', 'PROJECT'\)/);
    if (lob === "VIDEO" || lob === "COMMENTS") assert.ok(queries[0].values.includes(lob));
    if (lob === "CEC") assert.ok(queries.every((query) => query.sql.includes('"CecQualityRecord"')));
  }
});

test("HTTP parameter parsing keeps the same TNS category, date window, view and order for display/export", () => {
  assert.deepEqual(readPerformanceQualityParams(new URLSearchParams("lob=TNS&category=push&view=weekly&sortDirection=asc&startDate=2026-11-01&endDate=2026-11-07")), {
    lob: "TNS", category: "PUSH", view: "weekly", sortDirection: "asc", startDate: "2026-11-01", endDate: "2026-11-07"
  });
  assert.equal(readPerformanceQualityParams(new URLSearchParams("lob=invalid&category=invalid")).lob, "ADS");
  assert.equal(readPerformanceQualityParams(new URLSearchParams("category=invalid")).category, undefined);
});

test("quality snapshot imports retain the audited queue, including numeric Excel IDs and older files", async () => {
  const { service, writes } = harness();
  const rows = [
    { audit_queue_id: 600001300 }, { queue_id: " 5486.0 " }, { "queue id": "11364" }, {}, { audit_queue_id: "invalid" }
  ].map((queue, index) => ({ audit_name: "wb_ana", audit_time: "2026-11-01", final_result: "Correct", case_order_id: `case-${index}`, audit_case_order_id: `audit-${index}`, ...queue }));
  const result = await service.importQualitySnapshotChunk(actor, rows, "quality.xlsx", "batch", 0, "TNS");
  assert.equal(result.imported.importedRows, 5);
  assert.deepEqual(writes.map((row) => row.queueId), ["600001300", "5486", "11364", null, null]);
  assert.equal(normalizeQualityQueueId("5486 or 1=1"), null);
});

test("the supplied KAP layout imports decision flags and skips its summary row", async () => {
  const { service, writes } = harness();
  const rows = [{ "audit_time(年月日)": "汇总", "通过量_Allow_Amount": 200 },
    { "audit_time(年月日)": "2026-11-08", audit_name: "wb_ana", final_result: "Correct", "质检case_order_id": "qa", audit_case_order_id: "audit",
      audit_queue_id: 9553, "通过量_Allow_Amount": 0, "打标量_Labeled_Amount": 1, "正确率_Accuracy_Rate": 0 }];
  const result = await service.importQualitySnapshotChunk(actor, rows, "quality.xlsx", "batch", 0, "TNS");
  assert.equal(result.imported.importedRows, 1); assert.equal(result.preview.errorRows, 0);
  assert.equal(writes[0].allowAmount, 0); assert.equal(writes[0].labeledAmount, 1);
  assert.equal(writes[0].negativeSign, null); assert.equal(writes[0].queueId, "9553");
});

test("quality Excel round trip includes summary, trend and all matching agents, with numeric percentages", async () => {
  const { service } = harness();
  const dashboard = await service.getPerformanceQualityDashboard(actor, { lob: "TNS", category: "PUSH" });
  dashboard.agents = Array.from({ length: 601 }, (_, index) => ({ ...dashboard.agents[0], employeeId: String(index), employeeName: `Ana ${index}` }));
  const payload = buildPerformanceQualityExportPayload(dashboard, "bruna");
  assert.equal(payload.sheets![1].rows.length, 601);
  const response = buildXlsxResponse(payload);
  const book = XLSX.read(await response.arrayBuffer(), { type: "array" });
  assert.deepEqual(book.SheetNames, ["Resumo", "Evolução", "Agentes"]);
  assert.equal(book.Sheets.Resumo.D2.v, "Push");
  assert.equal(book.Sheets.Resumo.I2.v, 0.1);
  assert.equal(book.Sheets.Resumo.I2.w, "10.00%");
  assert.equal(book.Sheets.Agentes.A602.v, "Ana 600");
  assert.equal(book.Sheets.Agentes.H2.v, 0.1);
  assert.equal(buildPerformanceQualityExportPayload(dashboard, "absent").sheets![1].rows.length, 0);
});

test("quality export enforces access before reading metrics and rejects inverted dates", async () => {
  const denied = harness("COLABORADOR");
  await assert.rejects(denied.service.exportPerformanceQualityXlsxData(actor, { lob: "TNS" }), (error: any) => error.status === 403);
  assert.equal(denied.queries.length, 0);
  const allowed = harness();
  await assert.rejects(allowed.service.getPerformanceQualityDashboard(actor, { lob: "TNS", startDate: "2026-11-07", endDate: "2026-11-01" }), (error: any) => error.status === 400);
  const payload = await allowed.service.exportPerformanceQualityXlsxData(actor, { lob: "TNS", category: "USER" });
  assert.match(payload.fileName, /qualidade_tns_user/);
});

test("Excel exports the exact rates as numeric percentages and leaves zero denominators blank", async () => {
  const indicators = serializeQualityIndicators({ total: 10, correct: 8, allow: 6, labeled: 4, leakage: 1, falsePositive: 1, mislabeled: 1, casesWithDecision: 10 });
  const row = { correct: 8, total: 10, errors: 2, quality: 80, indicators };
  const payload = buildPerformanceQualityExportPayload({ selectedLob: "TNS", selectedCategory: null, granularity: "daily", unclassifiedTotal: 0,
    period: { startDate: "2026-11-01", endDate: "2026-11-01" }, summary: row, agents: [], trend: [{ key: "2026-11-01", label: "01/11", ...row }] });
  const book = XLSX.read(await buildXlsxResponse(payload).arrayBuffer(), { type: "array" });
  const cells = XLSX.utils.sheet_to_json<any[]>(book.Sheets.Resumo, { header: 1 });
  const byHeader = (name: string) => cells[1][cells[0].indexOf(name)];
  assert.equal(byHeader("Accuracy"), 0.8); assert.equal(byHeader("Allow Amount"), 6);
  assert.ok(Math.abs(byHeader("Leakage Rate") - 1 / 6) < 1e-12);
  assert.equal(byHeader("False Positive Rate"), 0.25); assert.equal(byHeader("Mislabeled Rate"), 0.1);
  row.indicators = serializeQualityIndicators({ total: 10, correct: 8, allow: 0, labeled: 10, casesWithDecision: 10 });
  const noAllow = buildPerformanceQualityExportPayload({ selectedLob: "TNS", selectedCategory: null, granularity: "daily", unclassifiedTotal: 0,
    period: { startDate: "2026-11-01", endDate: "2026-11-01" }, summary: row, agents: [], trend: [] });
  assert.equal(noAllow.rows[0][noAllow.headers.indexOf("Leakage Rate")], null);
});
