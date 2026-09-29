import assert from "node:assert/strict";
import test from "node:test";
import { loadWorkHourExportCapture, workHourExportCaptureBatchSize } from "./work-hours-export-capture";

test("capture export limits each sequential lookup to one Shift Date and 20 requests without dropping values", async () => {
  const requests = Array.from({ length: 127 }, (_, i) => ({
    key: String(i), employeeId: `agent-${i % 42}`, wbLogin: `wb_${i % 42}`,
    shiftDate: new Date(`2026-09-${i % 3 === 0 ? '27' : i % 3 === 1 ? '28' : '29'}T00:00:00Z`)
  }));
  let active = 0, calls = 0;
  const visited: string[] = [];
  const values = await loadWorkHourExportCapture(requests, async batch => {
    assert.equal(++active, 1);
    assert.ok(batch.length <= workHourExportCaptureBatchSize);
    assert.equal(new Set(batch.map(r => r.shiftDate.toISOString())).size, 1);
    visited.push(...batch.map(r => r.key));
    calls++;
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return new Map(batch.map(r => [r.key, Number(r.key) % 2 ? 7.75 : 0]));
  });
  assert.equal(calls, 9);
  assert.equal(new Set(visited).size, requests.length);
  assert.equal(values.size, requests.length);
  for (const r of requests) assert.equal(values.get(r.key), Number(r.key) % 2 ? 7.75 : 0);
});

test("capture lookup failures abort the export rather than invent zero hours", async () => {
  await assert.rejects(loadWorkHourExportCapture([{ key: "1", employeeId: "1", wbLogin: "wb", shiftDate: new Date("2026-09-28") }], async () => { throw new Error("capture unavailable"); }), /capture unavailable/);
});

test("empty capture export performs no lookup", async () => {
  const result = await loadWorkHourExportCapture([], async () => { throw new Error("unexpected lookup"); });
  assert.equal(result.size, 0);
});
