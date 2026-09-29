import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import * as XLSX from "xlsx";
import { buildXlsxResponse } from "./xlsx-export";

const localRequire = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/api/work-hours/export/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function harness(load: (actor: unknown, query: any) => Promise<unknown>) {
  const imports: Record<string, unknown> = {
    "@/lib/api-actor": { getApiActor: async () => ({ email: "test@example.test" }) },
    "@/lib/api-errors": { errorStatus: () => 403 },
    "@/lib/work-hours-service": { exportOperationalWorkHoursXlsxData: load },
    "@/lib/xlsx-export": { buildXlsxResponse }
  };
  const compiledModule = { exports: {} as { GET: (request: Request) => Promise<Response> } };
  new Function("require", "exports", "module", compiled)((name: string) => imports[name] ?? localRequire(name), compiledModule.exports, compiledModule);
  return compiledModule.exports;
}

test("hours export HTTP preserves filters and generates a readable XLSX attachment", async () => {
  const route = harness(async (actor, query) => {
    assert.deepEqual(actor, { email: "test@example.test" });
    assert.equal(query.startDate, "2026-09-01");
    assert.equal(query.endDate, "2026-09-29");
    assert.equal(query.lob, "ADS");
    assert.equal(query.supervisor, "lead");
    assert.equal(query.overtimeOnly, true);
    assert.equal(query.pendingOnly, false);
    return { fileName: "horas.xlsx", sheetName: "Horas", headers: ["nome", "horas_captura"], rows: [["Agent", "7:45"]] };
  });
  const response = await route.GET(new Request("https://example.test/api/work-hours/export?startDate=2026-09-01&endDate=2026-09-29&lob=ADS&supervisor=lead&overtimeOnly=true"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Disposition")!, /attachment; filename="horas.xlsx"/);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const book = XLSX.read(await response.arrayBuffer(), { type: "array" });
  assert.deepEqual(XLSX.utils.sheet_to_json(book.Sheets.Horas, { header: 1 }), [["nome", "horas_captura"], ["Agent", "7:45"]]);
});

test("hours export HTTP preserves permission, changed-data and oversized errors", async () => {
  for (const status of [403, 409, 413]) {
    const route = harness(async () => ({ error: "Exportação recusada", status }));
    const response = await route.GET(new Request("https://example.test/api/work-hours/export"));
    assert.equal(response.status, status);
    assert.equal((await response.json()).error, "Exportação recusada");
  }
});

test("hours export HTTP returns a readable error without exposing internal details", async () => {
  const route = harness(async () => { throw new Error("private database details"); });
  const response = await route.GET(new Request("https://example.test/api/work-hours/export"));
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.match(body.error, /Não foi possível exportar/);
  assert.doesNotMatch(body.error, /private/);
});
