import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import * as XLSX from "xlsx";
import { performanceManualBases, validateManualFileManifest } from "./performance-manual-bases";

// Execute the real route with only its authenticated data services replaced by fixtures.
const localRequire = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/api/performance/import/manual/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const uploadId = "00000000-0000-4000-8000-000000000001";
function workbook() {
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ test: "fixture" }]), "Data");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
function harness(selected: string[], options: { incomplete?: boolean; invalidFrt?: boolean } = {}) {
  const writes: any[] = [], cleanups: any[] = [], previews: string[] = [];
  class PerformanceError extends Error { constructor(message: string, public status: number) { super(message); } }
  const data = workbook();
  const services = {
    PerformanceError, authorizePerformanceImport: async () => ({ email: "qa@example.test" }),
    previewProductionImport: async () => { previews.push("production"); return { rows: [{ fixture: true }] }; },
    previewCecCpdImport: async () => { previews.push("cecCpd"); return { rows: [{ fixture: true }] }; }
  };
  const chunks = selected.map((fileType) => ({ fileType, fileName: `${fileType}.xlsx`, chunkIndex: 0, totalChunks: options.incomplete ? 2 : 1, data }));
  const imports: Record<string, unknown> = {
    "@/lib/api-actor": { getApiActor: async () => ({ email: "qa@example.test" }) },
    "@/lib/prisma": { prisma: { performanceManualUploadChunk: {
      findMany: async ({ where }: any) => { assert.deepEqual(where, { uploadId, uploadedByEmail: "qa@example.test" }); return chunks; },
      deleteMany: async (args: unknown) => { cleanups.push(args); }
    } } },
    "@/lib/performance-service": services,
    "@/lib/xlsx-row-chunks": { XlsxChunkError: class extends Error {} },
    "@/lib/cec-frt-service": { prepareCecFrtSnapshot: async () => { previews.push("cecFrt"); if (options.invalidFrt) throw new PerformanceError("FRT inválido", 400); return { rows: [{}], summary: {} }; } },
    "@/lib/performance-ur-service": { prepareUrSnapshot: async () => { previews.push("ur"); return { rows: [{}], summary: { urRows: 1 } }; } },
    "@/lib/performance-manual-bases": { performanceManualBases, validateManualFileManifest },
    "@/lib/performance-manual-snapshot": { replaceSelectedManualSnapshots: async (_actor: unknown, files: object) => {
      if (!Object.keys(files).length) throw new PerformanceError("Selecione pelo menos uma base", 400);
      writes.push(files); return { selectedBases: Object.keys(files), rowsError: 0 };
    } }
  };
  const compiledModule = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  new Function("require", "exports", "module", compiled)((name: string) => imports[name] ?? localRequire(name), compiledModule.exports, compiledModule);
  return { ...compiledModule.exports, writes, cleanups, previews };
}
for (const selected of [["production"], ["volume"], ["cecCpd"], ["cecFrt"], ["ur"], ["production", "cecFrt"], ["production", "volume", "cecCpd", "cecFrt", "ur"]]) {
  test(`manual HTTP chunk finalization accepts selected bases only: ${selected.join("+")}`, async () => {
    const route = harness(selected);
    const response = await route.POST(new Request(`https://example.test/api/performance/import/manual?action=finalize&uploadId=${uploadId}&fileTypes=${selected.join(",")}`, { method: "POST" }));
    assert.equal(response.status, 200); assert.deepEqual((await response.json()).selectedBases, selected);
    assert.equal(route.writes.length, 1); assert.deepEqual(Object.keys(route.writes[0]), selected);
    assert.equal(route.cleanups.length, 1);
  });
}
test("manual HTTP rejects an incomplete file, absent selected file, or invalid FRT before all snapshot writes", async () => {
  for (const [selected, manifest, options] of [
    [["volume"], "volume", { incomplete: true }], [["volume"], "volume,production", {}],
    [["production", "cecFrt"], "production,cecFrt", { invalidFrt: true }],
    [["volume", "quality"], "volume,quality", {}]
  ] as Array<[string[], string, Parameters<typeof harness>[1]]>) {
    const route = harness(selected, options);
    const response = await route.POST(new Request(`https://example.test/api/performance/import/manual?action=finalize&uploadId=${uploadId}&fileTypes=${manifest}`, { method: "POST" }));
    assert.equal(response.status, 400); assert.equal(route.writes.length, 0); assert.equal(route.cleanups.length, 1);
  }
});
test("manual multipart accepts a single base, but no selection and empty selected files fail", async () => {
  for (const key of ["production", "volume", "cecCpd", "cecFrt", "ur"]) {
    const route = harness([]), body = new FormData(); body.set(`${key}File`, new File([new Uint8Array(workbook())], "test.xlsx"));
    const response = await route.POST(new Request("https://example.test/api/performance/import/manual", { method: "POST", body }));
    assert.equal(response.status, 200); assert.deepEqual((await response.json()).selectedBases, [key]);
  }
  for (const emptyFile of [false, true]) {
    const route = harness([]), body = new FormData(); if (emptyFile) body.set("productionFile", new File([], "empty.xlsx"));
    const response = await route.POST(new Request("https://example.test/api/performance/import/manual", { method: "POST", body }));
    assert.equal(response.status, 400); assert.equal(route.writes.length, 0);
  }
});
test("manual HTTP returns a readable validation error for an invalid chunk type", async () => {
  const route = harness([]);
  const response = await route.POST(new Request(`https://example.test/api/performance/import/manual?action=chunk&uploadId=${uploadId}&fileType=invalid`, { method: "POST" }));
  assert.equal(response.status, 400); assert.match((await response.json()).error, /Tipo de arquivo inválido/);
});
