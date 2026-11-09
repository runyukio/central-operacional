import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { Prisma } from "@prisma/client";
import { activityTimelineCursorScope, activityTimelinePageSql, decodeActivityTimelineCursor, encodeActivityTimelineCursor } from "./workstation-activity-pagination";
import { getWorkstationActivityQuery } from "./workstation-activity-query";
import { prisma } from "./prisma";
import { mockPrismaDelegate } from "./prisma-test-delegate";

type PageRow = { id: string; hostname: string; sourceStartedAt: string; endedAt: string; capturedAt: string; sourceType: string };
const scope = activityTimelineCursorScope({ agent: "employee:test", date: "2026-11-01" });

async function fixture(t: TestContext) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`CREATE TABLE activity (
    id text, "agentKey" text DEFAULT 'employee:test', "sourceType" text DEFAULT 'WEB',
    "applicationName" text DEFAULT 'chrome', domain text DEFAULT 'example.test', hostname text DEFAULT 'PC',
    "sourceStartedAt" timestamp, "startedAt" timestamp, "endedAt" timestamp, "capturedAt" timestamp
  )`);
  return {
    db,
    async insert(id: string, start: number, end: number, type = "WEB", hostname = "PC") {
      const at = (seconds: number) => new Date(Date.UTC(2026, 10, 1, 12, 0, seconds)).toISOString();
      await db.query(`INSERT INTO activity (id,"sourceStartedAt","startedAt","endedAt","capturedAt","sourceType",hostname)
        VALUES ($1,$2::timestamp,$2::timestamp,$3::timestamp,$3::timestamp,$4,$5)`, [id, at(start), at(end), type, hostname]);
    },
    async page(size: number, after: PageRow | null = null) {
      const cursor = after ? { at: `${after.sourceStartedAt}Z`, hostname: after.hostname, id: after.id, scope } : null;
      const sql = Prisma.sql`WITH filtered_activity AS (SELECT * FROM activity) ${activityTimelinePageSql(size, cursor)}
        SELECT payload FROM timeline ORDER BY "sourceStartedAt", "hostname", "id"`;
      const result = await db.query<{ payload: PageRow }>(sql.text, sql.values);
      return result.rows.map((row) => row.payload);
    }
  };
}

test("cursor pages preserve 15-second merging, nested intervals and context changes", async (t) => {
  const data = await fixture(t);
  await data.insert("first", 0, 60);
  await data.insert("nested", 10, 20);
  await data.insert("extension", 70, 80);
  await data.insert("exact-15", 95, 100);
  await data.insert("gap-16", 116, 120);
  await data.insert("app", 121, 130, "APP");
  await data.insert("web-again", 131, 140);
  const first = await data.page(1);
  assert.equal(first.length, 2, "only one complete group and a one-group lookahead cross the database boundary");
  assert.equal(first[0].id, "first");
  assert.equal(new Date(`${first[0].endedAt}Z`).getUTCSeconds(), 40, "the first group ends at second 100, including the exact-15 boundary");
  assert.equal(first[1].id, "gap-16");
  const second = await data.page(1, first[0]);
  assert.deepEqual(second.map((row) => row.id), ["gap-16", "app"]);
  const third = await data.page(1, second[0]);
  assert.deepEqual(third.map((row) => row.id), ["app", "web-again"]);
  const fourth = await data.page(1, third[0]);
  assert.deepEqual(fourth.map((row) => row.id), ["web-again"]);
});

test("the complete activity query pages groups while totals and rankings retain the full day", async (t) => {
  const data = await fixture(t);
  await data.db.exec(`CREATE SCHEMA agent_activity;
    CREATE TABLE "EmployeeProfile" (id text, "fullName" text, "lobId" text, "shiftId" text, "supervisorId" text);
    CREATE TABLE "Lob" (id text, name text);
    CREATE TABLE "Shift" (id text, name text);
    INSERT INTO "EmployeeProfile" (id,"fullName") VALUES ('agent','Example agent');
    CREATE VIEW agent_activity."WorkstationActivitySegment" AS SELECT id,id AS "eventId",'fixture'::text AS source,
      "capturedAt",hostname,'user'::text AS "windowsUser",'wb'::text AS "wbLogin",'agent'::text AS "employeeId",
      "sourceType","applicationName",domain,"startedAt","endedAt",'1'::text AS "agentVersion" FROM activity;
  `);
  await data.insert("one", 0, 60);
  await data.insert("two", 70, 80);
  await data.insert("three", 120, 125);
  await data.insert("four", 180, 185, "APP");
  const actor = { email: "pagination@example.test", name: "Pagination", role: "ADMIN" as const };
  mockPrismaDelegate(t, "user", { findUnique: async () => ({ ...actor, role: { name: "ADMIN" }, status: "ACTIVE", deletedAt: null }) });
  t.mock.method(prisma, "$queryRaw", async (sql: Prisma.Sql) => (await data.db.query(sql.text, sql.values)).rows as any);
  const first = await getWorkstationActivityQuery(actor, { view: "agent", agentKey: "employee:agent", date: "2026-11-01", pageSize: 1 });
  assert.ok(first.success && "pagination" in first && first.pagination);
  assert.equal(first.summary.totalSeconds, 80);
  assert.equal(first.rows.length, 1);
  assert.equal(first.rows[0].durationSeconds, 80, "the complete merged group crosses the original two raw events");
  assert.equal(first.sourceRecordsReturned, 2);
  assert.equal(first.pagination.totalGroups, 3);
  assert.equal(first.pagination.hasMore, true);
  const second = await getWorkstationActivityQuery(actor, { view: "agent", agentKey: "employee:agent", date: "2026-11-01", pageSize: 1, cursor: first.pagination.nextCursor });
  assert.ok(second.success && "rows" in second);
  assert.deepEqual(second.rows.map((row) => row.id), ["three"]);
  assert.deepEqual(second.summary, first.summary);
  assert.deepEqual(second.topDomains, first.topDomains);
  assert.deepEqual(second.topApplications, first.topApplications);
});

test("a merged interval larger than a page is never split and equal timestamps have a stable key", async (t) => {
  const data = await fixture(t);
  for (let i = 0; i < 80; i++) await data.insert(`event-${String(i).padStart(3, "0")}`, i * 2, i * 2 + 1);
  await data.insert("next-a", 200, 201, "APP", "A");
  await data.insert("next-b", 200, 201, "WEB", "B");
  const first = await data.page(1);
  assert.equal(first[0].id, "event-000");
  assert.equal(new Date(`${first[0].endedAt}Z`).toISOString(), "2026-11-01T12:02:39.000Z");
  const second = await data.page(1, first[0]);
  assert.deepEqual(second.map((row) => row.id), ["next-a", "next-b"]);
  const third = await data.page(1, second[0]);
  assert.deepEqual(third.map((row) => row.id), ["next-b"]);
});

test("cursors cannot be reused with another agent, date or filter scope", () => {
  const encoded = encodeActivityTimelineCursor({ at: "2026-11-01T12:00:00Z", hostname: "PC", id: "event", scope });
  assert.equal(decodeActivityTimelineCursor(encoded, scope)?.id, "event");
  assert.throws(() => decodeActivityTimelineCursor(encoded, activityTimelineCursorScope({ agent: "employee:other" })));
  assert.throws(() => decodeActivityTimelineCursor("not valid", scope));
});
