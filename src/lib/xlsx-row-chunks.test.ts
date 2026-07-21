import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";

import { processFirstWorksheetInChunks } from "./xlsx-row-chunks";

test("processa a primeira planilha em lotes sem perder linhas", async () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    audit_name: `wb_${index + 1}`,
    final_result: index % 2 ? "Correct" : "Incorrect"
  }));
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Qualidade");
  const file = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const chunks: Array<{ size: number; offset: number; first: string }> = [];

  const result = await processFirstWorksheetInChunks(file, {
    chunkRows: 5,
    maxRows: 20,
    onChunk: async ({ rows: chunkRows, rowNumberOffset }) => {
      chunks.push({
        size: chunkRows.length,
        offset: rowNumberOffset,
        first: String(chunkRows[0]?.audit_name ?? "")
      });
    }
  });

  assert.equal(result.totalRows, 12);
  assert.equal(result.processedRows, 12);
  assert.deepEqual(chunks, [
    { size: 5, offset: 0, first: "wb_1" },
    { size: 5, offset: 5, first: "wb_6" },
    { size: 2, offset: 10, first: "wb_11" }
  ]);
});

test("interrompe antes do processamento quando excede o limite", async () => {
  const worksheet = XLSX.utils.json_to_sheet(Array.from({ length: 11 }, (_, index) => ({ id: index })));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Qualidade");
  const file = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  await assert.rejects(
    processFirstWorksheetInChunks(file, { chunkRows: 5, maxRows: 10, onChunk: async () => undefined }),
    /limite de 10 linhas/
  );
});
