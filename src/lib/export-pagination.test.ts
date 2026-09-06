import assert from "node:assert/strict";
import test from "node:test";
import { collectExportBatches } from "./export-pagination";

test("exports more than 100/10000 rows in bounded batches without skipping records", async () => {
  const rows = Array.from({ length: 10_251 }, (_, index) => ({ id: String(index), comment: `Feedback ${index}` }));
  let calls = 0;
  const result = await collectExportBatches({ total: rows.length, fetchPage: async (cursor, limit) => {
    calls++; assert.equal(limit, 500);
    const start = cursor === undefined ? 0 : Number(cursor) + 1;
    return rows.slice(start, start + limit);
  } });
  assert.equal(result.length, rows.length);
  assert.equal(new Set(result.map((item) => item.id)).size, rows.length);
  assert.equal(calls, 21);
});

test("empty export is valid; incomplete and stalled cursors fail visibly", async () => {
  assert.deepEqual(await collectExportBatches({ total: 0, fetchPage: async () => { throw new Error("should not read"); } }), []);
  await assert.rejects(collectExportBatches({ total: 2, fetchPage: async () => [] }), /incompleta/);
  await assert.rejects(collectExportBatches({ total: 2, fetchPage: async () => [{ id: "same" }] }), /avançar/);
});
