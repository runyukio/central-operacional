import assert from "node:assert/strict";
import test from "node:test";
import { decodeAdherenceCursor, encodeAdherenceCursor, scanAdherencePage } from "./work-hour-adherence-pagination";

const source = Array.from({ length: 237 }, (_, index) => ({ id: String(9999 - index), date: new Date(index < 119 ? "2026-09-03" : "2026-09-02"), eligible: index % 7 !== 0 }));
test("stable date/id pages include every eligible row exactly once, without OFFSET or refetching returned records", async () => {
  const ids: string[] = [];
  const consumed = new Set<string>();
  let cursor: ReturnType<typeof decodeAdherenceCursor> | undefined;
  for (let page = 0; page < 20; page += 1) {
    const result = await scanAdherencePage({ cursor, limit: 17,
      read: async (after, take) => {
        assert.equal(take, 50);
        const rows = source.filter((r) => !after || +r.date < +new Date(after.date) || (+r.date === +new Date(after.date) && r.id < after.id)).slice(0, take);
        assert.ok(rows.every((r) => !consumed.has(r.id)));
        return rows;
      }, visible: async (rows) => rows.filter((r) => r.eligible)
    });
    assert.ok(result.data.length <= 17);
    result.data.forEach((r) => consumed.add(r.id));
    ids.push(...result.data.map((r) => r.id));
    if (!result.pagination.hasMore) break;
    cursor = decodeAdherenceCursor(result.pagination.nextCursor!);
  }
  assert.deepEqual(ids, source.filter((r) => r.eligible).map((r) => r.id));
  assert.equal(new Set(ids).size, ids.length);
});

test("answering or deleting the cursor row cannot shift/skip the next page", async () => {
  let rows = source.slice(0, 60).map((r) => ({ ...r, status: "PENDING" }));
  const read = async (after: ReturnType<typeof decodeAdherenceCursor> | undefined, take: number) => rows.filter((r) =>
    r.status === "PENDING" && (!after || +r.date < +new Date(after.date) || (+r.date === +new Date(after.date) && r.id < after.id))).slice(0, take);
  const first = await scanAdherencePage({ limit: 10, read, visible: async (r) => r });
  rows[0].status = "JUSTIFIED";
  rows = rows.filter((r) => r.id !== first.data.at(-1)!.id);
  const second = await scanAdherencePage({ limit: 10, cursor: decodeAdherenceCursor(first.pagination.nextCursor!), read, visible: async (r) => r });
  assert.deepEqual(second.data.map((r) => r.id), source.slice(10, 20).map((r) => r.id));
});

test("sparse eligibility scans are bounded and retain a continuation, not a false end", async () => {
  const rows = Array.from({ length: 510 }, (_, i) => ({ id: String(9999 - i), date: new Date("2026-09-03") }));
  let reads = 0;
  const result = await scanAdherencePage({ limit: 50, read: async (after, take) => {
    reads += 1; return rows.filter((r) => !after || r.id < after.id).slice(0, take);
  }, visible: async () => [] });
  assert.equal(reads, 5);
  assert.equal(result.data.length, 0);
  assert.equal(result.pagination.hasMore, true);
  assert.equal(decodeAdherenceCursor(result.pagination.nextCursor!).id, rows[499].id);
});

test("cursor validates exact dates/ids and round trips without depending on a live record", () => {
  assert.deepEqual(decodeAdherenceCursor(encodeAdherenceCursor(source[0])), { id: source[0].id, date: source[0].date.toISOString() });
  for (const value of ["not-json", "x".repeat(1025), Buffer.from(JSON.stringify({ date: "2026-02-30", id: "a" })).toString("base64url"), Buffer.from('{}').toString("base64url")]) {
    assert.throws(() => decodeAdherenceCursor(value));
  }
});
