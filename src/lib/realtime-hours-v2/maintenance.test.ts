import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { Prisma } from "@prisma/client";
import {
  cleanupRealtimeHoursV2Nonces, dayFingerprintsQuery, maintainRealtimeHoursV2History,
  maintenanceConfigPrefix, nonceCleanupBatchQuery, type MaintenanceClient
} from "./maintenance";

async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE "WorkstationMaintenanceStateV2" (key text PRIMARY KEY, value jsonb, "updatedAt" timestamp DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE "WorkstationRequestNonceV2" ("deviceId" text, "nonceHash" text, "expiresAt" timestamp, "createdAt" timestamp DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("deviceId", "nonceHash"));
    CREATE INDEX ON "WorkstationRequestNonceV2" ("expiresAt");
    CREATE TABLE "WorkstationActivitySegmentV2" (id text PRIMARY KEY, "deviceId" text, "employeeId" text, "wbLogin" text, "sourceType" text, "applicationName" text, domain text, "startedAt" timestamp, "endedAt" timestamp, "updatedAt" timestamp DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE "WorkstationDailySummaryV2" (id text PRIMARY KEY, "dateKey" date, "deviceId" text, "employeeId" text, "wbLogin" text, "sourceType" text, "applicationName" text, domain text, "durationSeconds" integer, "segmentCount" integer, "createdAt" timestamp, "updatedAt" timestamp);
  `);
  const statements: string[] = [];
  const query = async <T>(sql: Prisma.Sql) => {
    statements.push(sql.text);
    return db.query<T>(sql.text, sql.values.map(v => v instanceof Date ? v.toISOString() : v));
  };
  const client: MaintenanceClient = {
    $queryRaw: async <T>(sql: Prisma.Sql) => (await query<unknown>(sql)).rows as T,
    $executeRaw: async (sql: Prisma.Sql) => (await query<unknown>(sql)).affectedRows ?? 0,
    $transaction: async (run) => {
      await db.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
      try { const result = await run(client); await db.exec("COMMIT"); return result; }
      catch (error) { await db.exec("ROLLBACK"); throw error; }
    }
  };
  return { db, client, statements };
}

test("nonce task requires its execution record before deleting anything", async () => {
  let transactions = 0;
  const client = {
    $executeRaw: async () => { throw new Error("permission denied for WorkstationMaintenanceStateV2"); },
    $queryRaw: async () => [], $transaction: async () => { transactions++; return 0; }
  } as unknown as MaintenanceClient;
  await assert.rejects(cleanupRealtimeHoursV2Nonces(new Date(), { client }), /permission denied/);
  assert.equal(transactions, 0);
});

test("nonce SQL preserves valid/recently expired tokens, applies a strict margin and bounded batches", async () => {
  const { db, client } = await database();
  try {
    await db.exec(`BEGIN;
      INSERT INTO "WorkstationRequestNonceV2" ("deviceId","nonceHash","expiresAt") VALUES
        ('test','old',CURRENT_TIMESTAMP-INTERVAL '11 minutes'),
        ('test','boundary',CURRENT_TIMESTAMP-INTERVAL '10 minutes'),
        ('test','recent',CURRENT_TIMESTAMP-INTERVAL '9 minutes'),
        ('test','valid',CURRENT_TIMESTAMP+INTERVAL '10 minutes');`);
    assert.equal(await client.$executeRaw(nonceCleanupBatchQuery(1)), 1);
    const rows = await db.query<{ nonceHash: string }>('SELECT "nonceHash" FROM "WorkstationRequestNonceV2" ORDER BY "nonceHash"');
    assert.deepEqual(rows.rows.map(row => row.nonceHash), ["boundary", "recent", "valid"]);
    await db.exec("COMMIT");
  } finally { await db.close(); }
});

test("nonce task commits small batches and never runs history aggregation", async () => {
  const { db, client, statements } = await database();
  try {
    await db.exec(`INSERT INTO "WorkstationRequestNonceV2" ("deviceId","nonceHash","expiresAt")
      SELECT 'test', n::text, CURRENT_TIMESTAMP-INTERVAL '1 day' FROM generate_series(1,10001) n`);
    const result = await cleanupRealtimeHoursV2Nonces(new Date(), { client, maxBatches: 2 });
    assert.equal(result.expiredNonces, 10000);
    assert.equal(result.batches, 2);
    assert.equal(result.moreMayRemain, true);
    assert.ok(statements.every(sql => !sql.includes('"WorkstationActivitySegmentV2"') && !sql.includes('"WorkstationDailySummaryV2"')));
    const record = await db.query<{ value: { status: string; expiredNonces: number } }>('SELECT value FROM "WorkstationMaintenanceStateV2" WHERE key=$1', [`${maintenanceConfigPrefix}last:nonces`]);
    assert.equal(record.rows[0].value.status, "complete");
    assert.equal(record.rows[0].value.expiredNonces, 10000);
    assert.equal((await cleanupRealtimeHoursV2Nonces(new Date(), { client })).expiredNonces, 1);
  } finally { await db.close(); }
});

test("history backfills old days, splits Sao Paulo midnight, skips semantic retries and detects late changes", async () => {
  const { db, client } = await database();
  try {
    await db.exec(`INSERT INTO "WorkstationActivitySegmentV2" (id,"deviceId","sourceType","applicationName","startedAt","endedAt") VALUES
      ('cross','test','APP','editor','2026-11-09 02:59:30','2026-11-09 03:00:30'),
      ('old1','test','APP','editor','2026-10-29 12:00:00','2026-10-29 12:01:00'),
      ('old2','test','APP','editor','2026-10-29 12:02:00','2026-10-29 12:03:00');`);
    const first = await maintainRealtimeHoursV2History(new Date("2026-11-09T20:00:00Z"), { client });
    assert.deepEqual(first.rebuiltDays.slice().sort(), ["2026-10-29", "2026-11-08", "2026-11-09"]);
    const summary = await db.query<{ date: string; seconds: number }>('SELECT "dateKey"::text AS date,"durationSeconds" AS seconds FROM "WorkstationDailySummaryV2" ORDER BY "dateKey"');
    assert.deepEqual(summary.rows, [{ date: "2026-10-29", seconds: 120 }, { date: "2026-11-08", seconds: 30 }, { date: "2026-11-09", seconds: 30 }]);
    await db.exec('UPDATE "WorkstationActivitySegmentV2" SET "updatedAt"=CURRENT_TIMESTAMP');
    const retry = await maintainRealtimeHoursV2History(new Date("2026-11-09T20:00:00Z"), { client });
    assert.equal(retry.rebuiltDays.length, 0);
    assert.equal(retry.unchangedDays, 3);
    await db.exec(`UPDATE "WorkstationActivitySegmentV2" SET "endedAt"='2026-11-09 03:00:45' WHERE id='cross';
      INSERT INTO "WorkstationActivitySegmentV2" (id,"deviceId","sourceType","startedAt","endedAt")
      VALUES ('late','test','IDLE','2026-10-30 12:00:00','2026-10-30 12:01:00');`);
    const changed = await maintainRealtimeHoursV2History(new Date("2026-11-09T20:00:00Z"), { client });
    assert.deepEqual(changed.rebuiltDays.slice().sort(), ["2026-10-30", "2026-11-09"]);
    assert.equal(changed.detailedRowsDeleted, 0);
    assert.equal((await db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM "WorkstationActivitySegmentV2"')).rows[0].count, 4);
    await db.exec(`DELETE FROM "WorkstationActivitySegmentV2" WHERE id='old1'`);
    const incomplete = await maintainRealtimeHoursV2History(new Date("2026-11-09T20:00:00Z"), { client });
    assert.deepEqual(incomplete.preservedDaysWithIncompleteSource, ["2026-10-29"]);
    assert.equal((await db.query<{ seconds: number }>(`SELECT "durationSeconds" AS seconds FROM "WorkstationDailySummaryV2" WHERE "dateKey"='2026-10-29'`)).rows[0].seconds, 120);
  } finally { await db.close(); }
});

test("fingerprints detect identity/context corrections even when count and timestamps stay fixed", async () => {
  const { db, client } = await database();
  try {
    await db.exec(`INSERT INTO "WorkstationActivitySegmentV2" (id,"deviceId","sourceType","startedAt","endedAt") VALUES
      ('test','test','APP','2026-11-09 12:00:00','2026-11-09 12:01:00')`);
    const before = await client.$queryRaw<Array<{ fingerprint: string }>>(dayFingerprintsQuery());
    await db.exec(`UPDATE "WorkstationActivitySegmentV2" SET "employeeId"='corrected'`);
    const after = await client.$queryRaw<Array<{ fingerprint: string }>>(dayFingerprintsQuery());
    assert.notEqual(before[0].fingerprint, after[0].fingerprint);
  } finally { await db.close(); }
});


test("versioned maintenance DDL scopes state to the runtime and scheduled SQL touches only expired nonces", async () => {
  const { db } = await database();
  try {
    await db.exec(`DROP TABLE "WorkstationMaintenanceStateV2";
      CREATE ROLE realtime_hours_v2_hml NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE "SystemConfig" (key text, value jsonb);
      INSERT INTO "SystemConfig" VALUES ('private-setting','{"synthetic":true}');`);
    const migration = readFileSync(new URL("../../../prisma/migrations/20261109210000_realtime_hours_v2_nonce_maintenance/migration.sql", import.meta.url), "utf8");
    assert.doesNotMatch(migration, /GRANT\s+ALL(?:\s+PRIVILEGES)?\s+ON\s+ALL\s+TABLES/i);
    assert.doesNotMatch(migration, /GRANT[\s\S]*?ON\s+(?:SCHEMA\s+)?cron\b[\s\S]*?TO\s+postgres/i);
    const ddl = migration.split("CREATE EXTENSION IF NOT EXISTS pg_cron")[0];
    await db.exec(ddl);
    await db.exec(ddl); // Idempotent replay must preserve state and policy scope.
    await db.exec(`SET ROLE realtime_hours_v2_hml;
      INSERT INTO "WorkstationMaintenanceStateV2" (key,value) VALUES ('realtime-hours-v2-maintenance:test','{"ok":true}');`);
    assert.equal((await db.query('SELECT key,value FROM "WorkstationMaintenanceStateV2"')).rows.length, 1);
    await assert.rejects(db.exec(`INSERT INTO "WorkstationMaintenanceStateV2" (key,value) VALUES ('private-setting','{}')`), /row-level security|check constraint/);
    await assert.rejects(db.exec('SELECT * FROM "SystemConfig"'), /permission denied/);
    await assert.rejects(db.exec('DELETE FROM "WorkstationMaintenanceStateV2"'), /permission denied/);
    await db.exec(`RESET ROLE;
      CREATE SCHEMA cron;
      CREATE TABLE cron.job (jobid bigint,jobname text);
      CREATE TABLE cron.job_run_details (runid bigint,jobid bigint,end_time timestamptz);
      INSERT INTO cron.job VALUES (1,'realtime-hours-v2-nonce-cleanup'),(2,'another-job');
      INSERT INTO cron.job_run_details VALUES (1,1,CURRENT_TIMESTAMP-INTERVAL '8 days'),(2,2,CURRENT_TIMESTAMP-INTERVAL '8 days');
      INSERT INTO "WorkstationRequestNonceV2" ("deviceId","nonceHash","expiresAt") VALUES
        ('test','old',CURRENT_TIMESTAMP-INTERVAL '1 day'),('test','recent',CURRENT_TIMESTAMP-INTERVAL '9 minutes');`);
    const command = migration.split("$job$")[1];
    await db.exec(command);
    const count = await db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM "WorkstationRequestNonceV2"');
    assert.equal(count.rows[0].count, 1);
    const state = await db.query<{ value: { expiredNonces: number } }>(`SELECT value FROM "WorkstationMaintenanceStateV2" WHERE key='realtime-hours-v2-maintenance:last:nonces-sql'`);
    assert.equal(state.rows[0].value.expiredNonces, 1);
    assert.deepEqual((await db.query('SELECT runid::int FROM cron.job_run_details')).rows, [{ runid: 2 }]);
  } finally { await db.close(); }
});
