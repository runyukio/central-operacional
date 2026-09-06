import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "./prisma";
import { archiveRealtimeHoursDate, getRealtimeHoursTimeline, maintainRealtimeHoursArchives, upsertRealtimeHoursIdentityMapping } from "./realtime-hours-service";
import { mockPrismaDelegate } from "./prisma-test-delegate";

const legacyDay = (dateKey: string, sourceRecords: number) => ({
  dateKey, sourceRecords, sourceFingerprint: "old", rows: [],
  windowStart: new Date(`${dateKey}T03:00:00Z`), windowEnd: new Date(`${dateKey}T23:00:00Z`),
  calculationEnd: new Date(`${dateKey}T23:00:00Z`), generatedAt: new Date("2026-09-01"), updatedAt: new Date("2026-09-01")
});

test("archive-only maintenance reports zero deletions even when there is nothing to archive", async (t) => {
  const raw = mockPrismaDelegate(t, "realTimeHoursRecord", {
    findFirst: async () => null,
    deleteMany: async () => { throw new Error("raw deletion forbidden"); }
  });
  const batches = mockPrismaDelegate(t, "realTimeHoursImportBatch", { deleteMany: async () => { throw new Error("batch deletion forbidden"); } });
  const result = await maintainRealtimeHoursArchives();
  assert.equal(result.mode, "ARCHIVE_ONLY");
  assert.equal(result.rawHistoryPreserved, true);
  assert.equal(result.recordsDeleted, 0);
  assert.equal(result.batchesDeleted, 0);
  assert.equal(raw.deleteMany.mock.callCount(), 0);
  assert.equal(batches.deleteMany.mock.callCount(), 0);
});

test("legacy archive with more source records is preserved instead of overwritten", async (t) => {
  const dateKey = "2026-07-15";
  t.mock.method(prisma, "$queryRaw", async () => [{ dateKey, fingerprint: "new", sourceRecords: 0 }]);
  const archive = mockPrismaDelegate(t, "realTimeHoursArchiveDay", {
    findUnique: async () => legacyDay(dateKey, 100), update: async (args: any) => args
  });
  const writes = t.mock.method(prisma, "$transaction", async () => { throw new Error("must preserve archive"); });
  assert.equal(await archiveRealtimeHoursDate(dateKey), false);
  assert.equal(writes.mock.callCount(), 0);
  assert.deepEqual(Object.keys(archive.update.mock.calls[0].arguments[0].data), ["updatedAt"]);
  const result = await getRealtimeHoursTimeline({ date: dateKey });
  assert.equal(result.archived, true);
  assert.match(result.archiveWarning ?? "", /bruta legada está incompleta/);
});

test("late arrivals cannot conceal a legacy raw gap or replace its archived history", async (t) => {
  const dateKey = "2026-07-18";
  t.mock.method(prisma, "$queryRaw", async () => [{ dateKey, fingerprint: "after-late-event", sourceRecords: 200, preservedSourceRecords: 50 }]);
  mockPrismaDelegate(t, "realTimeHoursArchiveDay", {
    findUnique: async () => legacyDay(dateKey, 100), update: async () => ({})
  });
  const writes = t.mock.method(prisma, "$transaction", async () => { throw new Error("must preserve archive"); });
  assert.equal(await archiveRealtimeHoursDate(dateKey), false);
  assert.equal(writes.mock.callCount(), 0);
  const result = await getRealtimeHoursTimeline({ date: dateKey });
  assert.equal(result.archived, true);
  assert.match(result.archiveWarning ?? "", /bruta legada está incompleta/);
});

test("late events and corrected references bypass an obsolete archive and read full raw input", async (t) => {
  const dateKey = "2026-07-16";
  t.mock.method(prisma, "$queryRaw", async () => [{ dateKey, fingerprint: "after-late-event", sourceRecords: 2 }]);
  mockPrismaDelegate(t, "realTimeHoursArchiveDay", { findUnique: async () => legacyDay(dateKey, 1) });
  const raw = mockPrismaDelegate(t, "realTimeHoursRecord", { findMany: async () => [] }).findMany;
  const result = await getRealtimeHoursTimeline({ date: dateKey });
  assert.notEqual(result.archived, true);
  assert.equal(raw.mock.callCount(), 1);
  const where = raw.mock.calls[0].arguments[0].where;
  assert.ok(where.capturedAt.gte instanceof Date);
  assert.equal(where.employeeId, undefined);
});

test("source changes during archive calculation prevent publishing a stale consolidated day", async (t) => {
  const dateKey = "2026-07-17";
  let calls = 0;
  t.mock.method(prisma, "$queryRaw", async () => [{ dateKey, fingerprint: ++calls === 1 ? "before" : "after", sourceRecords: 0 }]);
  mockPrismaDelegate(t, "realTimeHoursArchiveDay", { findUnique: async () => null });
  mockPrismaDelegate(t, "realTimeHoursRecord", { findMany: async () => [] });
  const writes = t.mock.method(prisma, "$transaction", async () => { throw new Error("must not publish stale data"); });
  assert.equal(await archiveRealtimeHoursDate(dateKey), false);
  assert.equal(writes.mock.callCount(), 0);
});

test("archive payload exactly matches complete raw calculation and never mutates capture history", async (t) => {
  const dateKey = "2026-07-19";
  const records = ["10:00", "10:02"].map((hour) => ({
    capturedAt: new Date(`${dateKey}T${hour}:00Z`), eventType: "HEARTBEAT", hostname: "machine", windowsUser: "local",
    wbLogin: null, employeeId: null, ipAddress: null, isSessionActive: true, sessionState: "ACTIVE", idleSeconds: 0, lastActivityAt: null
  }));
  const raw = mockPrismaDelegate(t, "realTimeHoursRecord", { findMany: async () => records });
  mockPrismaDelegate(t, "realTimeHoursIdentityMapping", { findMany: async () => [] });
  mockPrismaDelegate(t, "realTimeHoursArchiveDay", { findUnique: async () => null });
  t.mock.method(prisma, "$queryRaw", async () => [{ dateKey, fingerprint: "stable", sourceRecords: 2, preservedSourceRecords: 2 }]);
  const expected = await getRealtimeHoursTimeline({ date: dateKey });
  assert.equal(expected.rows.length, 1);
  const saved: any = {};
  t.mock.method(prisma, "$transaction", async (run: any) => run({
    realTimeHoursArchiveDay: { upsert: async (args: any) => { saved.day = args.create; } },
    realTimeHoursArchiveRow: {
      deleteMany: async (args: any) => { assert.deepEqual(args.where, { dateKey }); },
      createMany: async (args: any) => { saved.rows = args.data; }
    }
  }));
  assert.equal(await archiveRealtimeHoursDate(dateKey), true);
  assert.deepEqual(saved.rows.map((row: any) => row.payload), expected.rows);
  assert.equal(saved.day.sourceRecords, 2);
  assert.equal(saved.day.sourceFingerprint, "stable");
  assert.equal(raw.findMany.mock.callCount(), 2);
  assert.deepEqual(Object.keys(raw.findMany.mock.calls[1].arguments[0].where), ["capturedAt"]);
});

test("mapping correction no longer rewrites original capture identities", async (t) => {
  const employee = { id: "new-owner", wbLogin: "new-login", fullName: "New owner" };
  mockPrismaDelegate(t, "employeeProfile", { findFirst: async () => employee });
  const raw = mockPrismaDelegate(t, "realTimeHoursRecord", { updateMany: async () => { throw new Error("original audit immutable"); } });
  t.mock.method(prisma, "$transaction", async (run: any) => run({
    realTimeHoursIdentityMapping: { upsert: async (args: any) => ({ id: "mapping", ...args.create, employee }) }
  }));
  const result = await upsertRealtimeHoursIdentityMapping({ hostname: "machine", windowsUser: "local", wbLogin: "new-login" }, "admin@example.test");
  assert.equal(result.success, true);
  assert.equal(raw.updateMany.mock.callCount(), 0);
});
