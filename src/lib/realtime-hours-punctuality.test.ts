import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "./prisma";
import { mockPrismaDelegate } from "./prisma-test-delegate";
import { getRealtimeHoursPunctualityRange } from "./realtime-hours-service";

for (const legacy of [false, true]) {
  test(`compact punctuality preserves ${legacy ? "legacy archive history" : "fresh archive values"} and employee scope`, async (t) => {
    const dateKey = legacy ? "2026-06-12" : "2026-06-11";
    mockPrismaDelegate(t, "realTimeHoursArchiveDay", { findMany: async (args: any) => {
      assert.deepEqual(args.select, { dateKey: true, sourceFingerprint: true, sourceRecords: true });
      assert.equal(args.include, undefined);
      return [{ dateKey, sourceFingerprint: "stable", sourceRecords: 10 }];
    } });
    const row = { employeeId: "a", data: dateKey, slotId: "slot-a", entryAt: `${dateKey}T11:01:00Z`, exitAt: `${dateKey}T20:00:00Z` };
    const sql = t.mock.method(prisma, "$queryRaw", async (query: any) => {
      if (query.text.includes("WITH references_digest")) return [{ dateKey, fingerprint: legacy ? "changed" : "stable", sourceRecords: 10, preservedSourceRecords: legacy ? 0 : 10 }];
      assert.match(query.text, /payload->>'entryAt'/);
      assert.match(query.text, /"employeeId" IN/);
      assert.ok(query.values.includes("a")); assert.ok(query.values.includes("wb_a"));
      assert.ok(!query.text.includes("SELECT r.payload FROM"));
      return [row, { ...row, employeeId: "outside-scope" }];
    });
    const options = { dates: [dateKey], eligibleEmployeeIds: ["a"], eligibleWbLogins: ["WB_A"] };
    const [result, duplicate] = await Promise.all([getRealtimeHoursPunctualityRange(options), getRealtimeHoursPunctualityRange(options)]);
    assert.deepEqual(result.rows, [row]); assert.deepEqual(duplicate, result);
    assert.equal(sql.mock.callCount(), 2);
    assert.equal(result.warnings.length, legacy ? 1 : 0);
    if (legacy) assert.match(result.warnings[0], /base bruta legada está incompleta/);
  });
}

test("changed archive with complete raw history rebuilds from raw instead of serving stale punctuality", async (t) => {
  const dateKey = "2026-06-13";
  mockPrismaDelegate(t, "realTimeHoursArchiveDay", { findMany: async () => [{ dateKey, sourceFingerprint: "old", sourceRecords: 10 }] });
  t.mock.method(prisma, "$queryRaw", async (query: any) => {
    assert.match(query.text, /WITH references_digest/);
    return [{ dateKey, fingerprint: "changed", sourceRecords: 11, preservedSourceRecords: 11 }];
  });
  mockPrismaDelegate(t, "realTimeHoursIdentityMapping", { findMany: async () => [] });
  const raw = mockPrismaDelegate(t, "realTimeHoursRecord", { findMany: async () => [] }).findMany;
  const result = await getRealtimeHoursPunctualityRange({ dates: [dateKey], eligibleEmployeeIds: ["a"], eligibleWbLogins: [] });
  assert.deepEqual(result.rows, []); assert.equal(raw.mock.callCount(), 1);
  assert.deepEqual(raw.mock.calls[0].arguments[0].where.OR, [{ employeeId: { in: ["a"] } }, { wbLogin: { in: [], mode: "insensitive" } }]);
});

test("empty scope cannot read punctuality for other employees", async (t) => {
  const archive = mockPrismaDelegate(t, "realTimeHoursArchiveDay", { findMany: async () => { throw new Error("scope missing"); } }).findMany;
  assert.deepEqual(await getRealtimeHoursPunctualityRange({ dates: ["2026-06-14"], eligibleEmployeeIds: [], eligibleWbLogins: ["wb_a"] }), { rows: [], warnings: [] });
  assert.equal(archive.mock.callCount(), 0);
});
