import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { activityRetentionBatch, activityRetentionDays, maintainWorkstationActivity } from "./workstation-activity-maintenance";
import { importWorkstationActivity } from "./workstation-activity-service";
import { mockPrismaDelegate } from "./prisma-test-delegate";
import { GET } from "../app/api/cron/workstation-activity-maintenance/route";

test("retention keeps the existing configured-day clamping", () => {
  assert.equal(activityRetentionDays("14"), 14);
  assert.equal(activityRetentionDays("invalid"), 7);
  assert.equal(activityRetentionDays("0"), 1);
  assert.equal(activityRetentionDays("120"), 90);
});

test("SQL cleanup is bounded and never removes an interval at or inside the retention cutoff", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec('CREATE SCHEMA agent_activity; CREATE TABLE agent_activity."WorkstationActivitySegment" ("id" text PRIMARY KEY, "endedAt" timestamptz NOT NULL);');
  await db.exec(`INSERT INTO agent_activity."WorkstationActivitySegment" VALUES
    ('old-1','2026-11-01T00:00Z'),('old-2','2026-11-01T01:00Z'),('old-3','2026-11-01T02:00Z'),
    ('boundary','2026-11-02T00:00Z'),('fresh','2026-11-03T00:00Z');`);
  const sql = activityRetentionBatch(new Date("2026-11-02T00:00:00Z"), 2);
  const result = await db.query<{ deleted: number }>(sql.text, [...sql.values]);
  assert.equal(result.rows[0].deleted, 2);
  const remaining = await db.query<{ id: string }>('SELECT id FROM agent_activity."WorkstationActivitySegment" ORDER BY id');
  assert.deepEqual(remaining.rows.map(r => r.id), ["boundary", "fresh", "old-3"]);
});

test("one upload writes its activity without running an unrelated retention delete", async t => {
  mockPrismaDelegate(t, "realTimeHoursIdentityMapping", { findMany: async () => [] });
  const writes: Prisma.Sql[] = [];
  t.mock.method(prisma, "$executeRaw", async (sql: Prisma.Sql) => { writes.push(sql); return 1; });
  const now = new Date();
  const result = await importWorkstationActivity({ capturedAt: now.toISOString(), records: [{
    eventId: "cost-upload-test", hostname: "TEST-PC", sourceType: "APP", applicationName: "test",
    startedAt: new Date(now.getTime()-60_000).toISOString(), endedAt: now.toISOString(), durationSeconds: 60
  }] });
  assert.equal(result.success, true);
  assert.equal(writes.length, 1);
  assert.ok(writes[0].text.includes("INSERT INTO"));
  assert.ok(!writes[0].text.includes("DELETE FROM"));
});

test("background retention stops after its batch budget and does not turn a full batch into an unbounded loop", async t => {
  let runs = 0;
  t.mock.method(prisma, "$transaction", (async (work: (tx: unknown) => Promise<unknown>) => work({
    $executeRaw: async () => undefined,
    $queryRaw: async () => { runs++; return [{ deleted: 5_000 }]; }
  })) as any);
  const result = await maintainWorkstationActivity({ maxBatches: 2 });
  assert.equal(runs, 2);
  assert.equal(result.deleted, 10_000);
});

test("maintenance route requires the cron secret before reading or modifying the database", async () => {
  const previous = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET;
    assert.equal((await GET(new Request("https://example.test/api/cron/workstation-activity-maintenance"))).status, 503);
    process.env.CRON_SECRET = "test-only";
    assert.equal((await GET(new Request("https://example.test/api/cron/workstation-activity-maintenance"))).status, 401);
    assert.equal((await GET(new Request("https://example.test/api/cron/workstation-activity-maintenance", { headers: { authorization: "Bearer different" } }))).status, 401);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});
