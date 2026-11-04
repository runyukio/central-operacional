import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { prisma } from "./prisma";
import { mockPrismaDelegate } from "./prisma-test-delegate";
import { formatModerationDuration, moderationAssignmentWindows, type ModerationSchedule } from "./performance-moderation-duration";
import { getPerformanceModerationDurations, moderationDurationQuery, type ModerationDurationScope } from "./performance-moderation-duration-service";
import { commitProductionImport, exportPerformanceAgentsXlsxData, getPerformanceAgentsDashboard, type PerformancePreviewRow } from "./performance-service";
import { buildRealtimeHoursPlannedShifts, buildRealtimeHoursSlotAssignmentWindows, matchRealtimeHoursPlannedShift } from "./realtime-hours-timeline";

const day = "2026-10-26";
const next = "2026-10-27";
const scope: ModerationDurationScope = {
  employees: [{ employeeId: "a", wbLogin: "wb_a" }],
  startDate: day, endDate: day, queueIds: ["9596", "9693"]
};
function slot(date = day, startsAt = "08:00", endsAt = "17:00", employeeId = "a"): ModerationSchedule {
  return { id: employeeId + ":" + date, employeeId, date: new Date(date + "T00:00:00Z"), startsAt, endsAt,
    status: "PRESENTE", shiftId: startsAt === "23:00" ? "night" : "morning", supervisorId: "sup",
    shift: { name: startsAt === "23:00" ? "Noite" : "Manhã", startsAt, endsAt } };
}

test("Moderation Duration: production SQL in isolated PostgreSQL", async t => {
  const db = await PGlite.create();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE "EmployeeProfile" (id text primary key, "fullName" text, "wbLogin" text, "supervisorId" text, "shiftId" text);
    CREATE TABLE "Shift" (id text primary key, name text);
    CREATE TABLE "PerformanceImportBatch" (id text primary key, status text);
    CREATE TABLE "ProductionRecord" (
      id text primary key, "productionKey" text unique, "wbLogin" text, "employeeId" text,
      "bzTime" timestamp, "bzDay" timestamp, "queueId" text, "moderationSeconds" double precision,
      "submitNum" integer default 1, "ahtSeconds" double precision, "latencyMinutesSum" double precision,
      "lobId" text, "importBatchId" text, "createdAt" timestamp default now(), "updatedAt" timestamp default now()
    );
  `);
  const sqlValues = (values: unknown[]) => values.map(value => value instanceof Date ? value.toISOString() : value);

  async function fixture(c: TestContext, schedules: ModerationSchedule[] = [slot()]) {
    await db.exec(`TRUNCATE "ProductionRecord", "PerformanceImportBatch", "EmployeeProfile", "Shift";
      INSERT INTO "Shift" VALUES ('morning','Manhã'),('afternoon','Tarde'),('night','Noite');
      INSERT INTO "EmployeeProfile" VALUES ('a','Agente','wb_a','sup','morning'),('sup','Supervisor','sup',null,null);`);
    mockPrismaDelegate(c, "schedule", { findMany: async (args: any) => schedules.filter(s =>
      args.where.employeeId.in.includes(s.employeeId)
      && s.date >= args.where.date.gte && s.date <= args.where.date.lte
    ) });
    c.mock.method(prisma, "$queryRaw", async (query: any) => (await db.query(query.text, sqlValues(query.values))).rows as any);
    return async (time: string, seconds: number, queue = "9596", login = "wb_a", id = crypto.randomUUID(), batch: string | null = null) => {
      await db.query(`INSERT INTO "ProductionRecord"
        (id, "productionKey", "wbLogin", "employeeId", "bzTime", "bzDay", "queueId", "moderationSeconds", "importBatchId")
        VALUES ($1,$1,$2,'a',$3,$4,$5,$6,$7)`,
      [id, login, time, time.slice(0, 10), queue, seconds, batch]);
    };
  }
  async function duration(input = scope) { return (await getPerformanceModerationDurations(input)).get("a")!; }

  await t.test("sums different queues in the same hour without rounding the inputs", async c => {
    const insert = await fixture(c);
    await insert(day + " 08:00:00", 0.4);
    await insert(day + " 08:00:00", 0.4, "9693");
    assert.equal((await duration()).duration, "00:00:01");
  });

  await t.test("adds different hours in one shift and preserves imported values", async c => {
    const insert = await fixture(c);
    await insert(day + " 08:00:00", 1359.82);
    await insert(day + " 09:00:00", 3600);
    assert.equal((await duration()).duration, "01:22:40");
    const raw = await db.query('SELECT "moderationSeconds", "submitNum" FROM "ProductionRecord" ORDER BY "bzTime"');
    assert.deepEqual(raw.rows, [{ moderationSeconds: 1359.82, submitNum: 1 }, { moderationSeconds: 3600, submitNum: 1 }]);
  });

  await t.test("associates pre- and post-midnight records to the night slot start", async c => {
    const insert = await fixture(c, [slot(day, "23:00", "08:00"), slot(next, "23:00", "08:00")]);
    await insert(day + " 23:00:00", 3600);
    await insert(next + " 00:00:00", 3600);
    await insert(next + " 07:00:00", 3600, "9693");
    assert.deepEqual((await duration()).byShiftDate, [{ employeeId: "a", shiftDate: day, seconds: 10800, duration: "03:00:00" }]);
    assert.equal((await duration({ ...scope, startDate: next, endDate: next })).duration, "Sem dados");
  });

  await t.test("formats decimal examples and durations above 24 hours", async c => {
    const insert = await fixture(c);
    for (const [seconds, display] of [[1359.82,"00:22:40"],[3600,"01:00:00"],[7200,"02:00:00"],[27000,"07:30:00"],[90000,"25:00:00"]] as const) {
      assert.equal(formatModerationDuration(seconds), display);
    }
    await insert(day + " 08:00:00", 60000);
    await insert(day + " 09:00:00", 30000, "9693");
    assert.equal((await duration()).duration, "25:00:00");
  });

  await t.test("distinguishes recorded zero from no source record", async c => {
    const insert = await fixture(c);
    assert.equal((await duration()).seconds, null);
    assert.equal((await duration()).byShiftDate[0].duration, "Sem dados");
    await insert(day + " 08:00:00", 0);
    assert.equal((await duration()).seconds, 0);
    assert.equal((await duration()).duration, "00:00:00");
  });

  await t.test("normalizes whitespace and case before associating the imported WB", async c => {
    const insert = await fixture(c);
    await insert(day + " 08:00:00", 1359.82, "9596", " W B_A ");
    assert.equal((await duration()).duration, "00:22:40");
  });

  await t.test("filters by assigned Shift Date after matching against adjacent slots", async c => {
    const insert = await fixture(c, [slot(day, "23:00", "08:00"), slot(next, "23:00", "08:00")]);
    await insert(next + " 03:00:00", 1359.82);
    await insert(next + " 23:00:00", 3600);
    assert.equal((await duration()).duration, "00:22:40");
    assert.equal((await duration({ ...scope, startDate: next, endDate: next })).duration, "01:00:00");
  });

  await t.test("respects agent, LOB queue set, shift and supervisor filters", async c => {
    const insert = await fixture(c, [slot(), slot(day, "08:00", "17:00", "b")]);
    await insert(day + " 08:00:00", 3600);
    await insert(day + " 08:00:00", 7200, "9693");
    await insert(day + " 08:00:00", 90000, "5860");
    await insert(day + " 08:00:00", 90000, "9596", "wb_b");
    assert.equal((await duration({ ...scope, queueIds: ["9596"] })).duration, "01:00:00");
    assert.equal((await duration({ ...scope, queueIds: ["9693"] })).duration, "02:00:00");
    assert.equal((await duration({ ...scope, supervisorId: "other" })).duration, "Sem dados");
    assert.equal((await duration({ ...scope, shiftId: "night" })).duration, "Sem dados");
    assert.equal((await duration({ ...scope, supervisorId: "sup", shiftId: "morning" })).duration, "03:00:00");
  });

  await t.test("matches Capture's assignment windows including early/late work and adjacent slot ties", async c => {
    const schedules = [slot(day, "23:00", "08:00"), slot(next, "23:00", "08:00")];
    const insert = await fixture(c, schedules);
    const capture = buildRealtimeHoursSlotAssignmentWindows(buildRealtimeHoursPlannedShifts(schedules));
    const times = [day + " 15:00:00", day + " 23:00:00", next + " 07:00:00", next + " 08:00:00", next + " 15:30:00", next + " 23:00:00"];
    const expected = new Map<string, number>();
    for (const time of times) {
      await insert(time, 1);
      const matched = matchRealtimeHoursPlannedShift(new Date(time.replace(" ", "T") + "-03:00"), capture);
      if (matched) expected.set(matched.sourceDate, (expected.get(matched.sourceDate) ?? 0) + 1);
    }
    for (const date of [day, next]) assert.equal((await duration({ ...scope, startDate: date, endDate: date })).seconds, expected.get(date) ?? null);
  });

  await t.test("does not duplicate rows when schedule slots overlap", async c => {
    const first = slot(), second = { ...slot(), id: "overlap", startsAt: "09:00", endsAt: "18:00" };
    const insert = await fixture(c, [first, second]);
    await insert(day + " 10:00:00", 3600);
    assert.equal((await duration()).duration, "01:00:00");
  });

  await t.test("does not publish processing/failed batches and refreshes after success", async c => {
    const insert = await fixture(c);
    await db.query('INSERT INTO "PerformanceImportBatch" VALUES ($1,$2)', ["batch", "PROCESSING"]);
    await insert(day + " 08:00:00", 3600, "9596", "wb_a", "pending", "batch");
    assert.equal((await duration()).duration, "Sem dados");
    await db.query('UPDATE "PerformanceImportBatch" SET status=$1', ["FAILED"]);
    assert.equal((await duration()).duration, "Sem dados");
    await db.query('UPDATE "PerformanceImportBatch" SET status=$1', ["SUCCESS"]);
    assert.equal((await duration()).duration, "01:00:00");
    await db.query('UPDATE "PerformanceImportBatch" SET status=$1', ["PARTIAL"]);
    assert.equal((await duration()).duration, "01:00:00");
  });

  await t.test("the unchanged production upload upserts the same base instead of accumulating it", async c => {
    await fixture(c);
    mockPrismaDelegate(c, "user", { findUnique: async () => ({
      id: "admin", email: "admin@example.test", status: "ACTIVE", deletedAt: null, role: { name: "ADMIN" }
    }) });
    let batch = 0;
    mockPrismaDelegate(c, "performanceImportBatch", { create: async ({ data }: any) => {
      const id = "import-" + (++batch);
      await db.query('INSERT INTO "PerformanceImportBatch" VALUES ($1,$2)', [id, data.status]);
      return { id, ...data };
    } });
    mockPrismaDelegate(c, "auditLog", { create: async () => ({}) });
    c.mock.method(prisma, "$executeRaw", async (query: any) => (await db.query(query.text, sqlValues(query.values))).affectedRows as any);
    const actor = { role: "ADMIN" as const, name: "Admin", email: "admin@example.test" };
    const row: PerformancePreviewRow = {
      rowNumber: 1, type: "PRODUCTION", wbLogin: "wb_a", employeeId: "a", employeeName: "Agent",
      lob: "ADS", lobId: "ads", date: day, uniqueKey: day + " 08:00|9596|wb_a",
      action: "create", errors: [], warnings: [],
      payload: { bzTime: day + "T08:00:00Z", bzDay: day, submitNum: 10, moderationSeconds: 1359.82,
        ahtSeconds: 135.982, latencyMinutesSum: 45, queueId: "9596", productionKey: day + " 08:00|9596|wb_a" }
    };
    await commitProductionImport(actor, [row]);
    await commitProductionImport(actor, [row]);
    assert.equal((await duration()).duration, "00:22:40");
    const raw = await db.query('SELECT "moderationSeconds", "submitNum", "latencyMinutesSum" FROM "ProductionRecord"');
    assert.deepEqual(raw.rows, [{ moderationSeconds: 1359.82, submitNum: 10, latencyMinutesSum: 45 }]);
    await commitProductionImport(actor, [{ ...row, payload: { ...row.payload, moderationSeconds: 7200 } }]);
    assert.equal((await duration()).duration, "02:00:00");
    assert.equal((await db.query('SELECT * FROM "ProductionRecord"')).rows.length, 1);
  });

  await t.test("Agents API adds Shift Date totals by normalized WB while preserving existing metrics", async c => {
    const schedules = [slot()];
    const insert = await fixture(c, schedules);
    await insert(day + " 08:00:00", 1359.82, "9596", " W B_A ");
    const date = new Date(day + "T00:00:00Z");
    mockPrismaDelegate(c, "user", { findUnique: async () => ({
      id: "admin", email: "admin@example.test", status: "ACTIVE", deletedAt: null, role: { name: "ADMIN" }
    }) });
    mockPrismaDelegate(c, "productionRecord", { aggregate: async () => ({ _min: { bzDay: date }, _max: { bzDay: date } }) });
    mockPrismaDelegate(c, "performanceCecCpdRecord", { aggregate: async () => ({ _min: { performanceDay: null }, _max: { performanceDay: null } }) });
    mockPrismaDelegate(c, "employeeProfile", { findMany: async () => [{
      id: "a", wbLogin: "wb_a", fullName: "Agente", lob: { name: "ADS" },
      shift: { id: "morning", name: "Manhã" }, supervisor: { id: "sup", fullName: "Supervisor" }
    }] });
    c.mock.method(prisma, "$queryRaw", async (query: any) => {
      if (query.text.includes('FROM "QualityRecord"')) return [{ periodStart: date, employeeId: null, wbLogin: "WB_A", correct: 9, total: 10 }] as any;
      if (query.text.includes("WITH identities AS") || query.text.includes('FROM "ProductionRecord"')) return (await db.query(query.text, sqlValues(query.values))).rows as any;
      return [];
    });
    const actor = { role: "ADMIN" as const, name: "Admin", email: "admin@example.test" };
    const input = { lob: "ADS", startDate: day, endDate: day, shiftId: "morning", supervisorId: "sup", search: "wb_a" };
    const result = await getPerformanceAgentsDashboard(actor, input);
    assert.equal(result.agents.length, 1);
    const agent = result.agents[0];
    assert.equal(agent.moderationDuration.duration, "00:22:40");
    assert.equal(agent.moderationDuration.byShiftDate[0].employeeId, "a");
    assert.equal(agent.moderationDuration.byShiftDate[0].shiftDate, day);
    assert.equal(agent.submit, 1);
    assert.equal(agent.ahtSeconds, 1359.82);
    assert.equal(agent.moderationSeconds, 1359.82);
    assert.equal(agent.quality, 90);
    assert.equal(result.summary.moderationSeconds, 1359.82);
    assert.equal(result.summary.ahtSeconds, 1359.82);
    assert.equal((await getPerformanceAgentsDashboard(actor, { ...input, supervisorId: "other" })).agents.length, 0);
    assert.equal((await getPerformanceAgentsDashboard(actor, { ...input, shiftId: "night" })).agents.length, 0);
    assert.equal((await getPerformanceAgentsDashboard(actor, { ...input, search: "other" })).agents.length, 0);
    await db.exec('TRUNCATE "ProductionRecord"');
    assert.equal((await getPerformanceAgentsDashboard(actor, input)).agents[0].moderationDuration.duration, "Sem dados");
    const missing = await getPerformanceAgentsDashboard(actor, input);
    assert.equal(missing.agents[0].moderationDuration.duration, "Sem dados");
    assert.equal(missing.agents[0].legacyMetricsAvailable, false);
    assert.equal(missing.summary.submit, 0);
    schedules[0] = slot(day, "23:00", "08:00");
    await insert(next + " 03:00:00", 3600);
    const overnight = await getPerformanceAgentsDashboard(actor, { ...input, shiftId: undefined, search: undefined });
    assert.equal(overnight.agents[0].moderationDuration.duration, "01:00:00");
    assert.equal(overnight.agents[0].moderationDuration.byShiftDate[0].shiftDate, day);
    assert.equal(overnight.agents[0].legacyMetricsAvailable, false);
    assert.equal(overnight.agents[0].submit, 0);
    assert.equal(overnight.summary.submit, 0);
    assert.equal(overnight.dataRange?.startDate, "2026-10-25");
    mockPrismaDelegate(c, "auditLog", { create: async () => ({}) });
    const exported = await exportPerformanceAgentsXlsxData(actor, { ...input, view: "daily", shiftId: undefined });
    assert.equal(exported.headers[20], "Moderation Duration");
    assert.equal(exported.rows[0][0], day);
    assert.equal(exported.rows[0][8], "Sem dados");
    assert.equal(exported.rows[0][11], "Sem dados");
    assert.equal(exported.rows[0][20], "01:00:00");
  });

  await t.test("SLA, afternoon and night rows retain the original production even without a schedule", async c => {
    await fixture(c);
    await db.exec(`INSERT INTO "EmployeeProfile" VALUES
      ('b','Agente Tarde','wb_b','sup','afternoon'),('c','Agente Noite','wb_c','sup','night');
      INSERT INTO "ProductionRecord" (id,"wbLogin","employeeId","bzTime","bzDay","queueId","submitNum","moderationSeconds") VALUES
      ('m','wb_a','a','2026-10-26 09:00','2026-10-26','5860',10,600),
      ('t','wb_b','b','2026-10-26 15:00','2026-10-26','5860',20,1200),
      ('t30','wb_b','b','2026-10-26 16:00','2026-10-26','5857',40,2400),
      ('n','wb_c','c','2026-10-26 23:00','2026-10-26','5860',30,1800),
      ('unknown','wb_external',null,'2026-10-26 21:00','2026-10-26','5860',5,300),
      ('na','wb_b','b','2026-10-26 20:00','2026-10-26','unknown_queue',7,420);`);
    const date = new Date(day + "T00:00:00Z");
    const profiles = [
      { id: "a", fullName: "Agente", wbLogin: "wb_a", shift: { id: "morning", name: "Manhã" } },
      { id: "b", fullName: "Agente Tarde", wbLogin: "wb_b", shift: { id: "afternoon", name: "Tarde" } },
      { id: "c", fullName: "Agente Noite", wbLogin: "wb_c", shift: { id: "night", name: "Noite" } }
    ].map(profile => ({ ...profile, lob: { name: "VIDEO" }, supervisor: { id: "sup", fullName: "Supervisor" } }));
    mockPrismaDelegate(c, "user", { findUnique: async () => ({ id: "admin", status: "ACTIVE", deletedAt: null, role: { name: "ADMIN" } }) });
    mockPrismaDelegate(c, "productionRecord", { aggregate: async () => ({ _min: { bzDay: date }, _max: { bzDay: date } }) });
    mockPrismaDelegate(c, "performanceCecCpdRecord", { aggregate: async () => ({ _min: {}, _max: {} }) });
    mockPrismaDelegate(c, "employeeProfile", { findMany: async () => profiles });
    mockPrismaDelegate(c, "auditLog", { create: async () => ({}) });
    c.mock.method(prisma, "$queryRaw", async (query: any) => {
      if (/FROM "(QualityRecord|TnsQualityRecord|CecQualityRecord)"/.test(query.text)) return [];
      return (await db.query(query.text, sqlValues(query.values))).rows as any;
    });
    const actor = { role: "ADMIN" as const, name: "Admin", email: "admin@example.test" };
    const input = { lob: "VIDEO", startDate: day, endDate: day, view: "daily" as const };
    const all = await getPerformanceAgentsDashboard(actor, input);
    assert.deepEqual(all.filters.slaTargets, [15, 30, 300, 1440]);
    assert.equal(all.summary.submit, 105);
    assert.equal(all.summary.ahtSeconds, 60);
    assert.equal(all.summary.agents, 4);
    assert.equal(all.agents.find(row => row.employeeId === "b")?.moderationDuration.duration, "Sem dados");
    assert.equal(all.agents.find(row => row.employeeId === "c")?.legacyMetricsAvailable, true);
    assert.equal(all.agents.find(row => row.wbLogin === "wb_external")?.submit, 5);
    assert.equal((await getPerformanceAgentsDashboard(actor, { ...input, slaTargetMinutes: 2180 })).summary.submit, all.summary.submit);
    const fifteen = await getPerformanceAgentsDashboard(actor, { ...input, slaTargetMinutes: 15 });
    assert.equal(fifteen.summary.submit, 65);
    assert.equal(fifteen.agents.find(row => row.employeeId === "a")?.moderationDuration.duration, "00:10:00");
    const thirty = await getPerformanceAgentsDashboard(actor, { ...input, slaTargetMinutes: 30 });
    assert.equal(thirty.summary.submit, 40);
    assert.deepEqual(thirty.agents.map(row => row.wbLogin), ["wb_b"]);
    assert.equal((await getPerformanceAgentsDashboard(actor, { ...input, slaTargetMinutes: 1440 })).agents.length, 0);
    const unmapped = await getPerformanceAgentsDashboard(actor, { ...input, lob: "N/A" });
    assert.equal(unmapped.summary.submit, 7);
    assert.equal(unmapped.agents[0].wbLogin, "wb_b");
    assert.equal((await getPerformanceAgentsDashboard(actor, { ...input, slaTargetMinutes: 15, shiftId: "afternoon", supervisorId: "sup" })).summary.submit, 20);
    assert.equal((await getPerformanceAgentsDashboard(actor, { ...input, slaTargetMinutes: 15, shiftId: "night", search: "WB_C" })).summary.submit, 30);
    const exported = await exportPerformanceAgentsXlsxData(actor, { ...input, slaTargetMinutes: 15, shiftId: "afternoon", supervisorId: "sup" });
    assert.equal(exported.rows.length, 1);
    assert.equal(exported.rows[0][4], "wb_b");
    assert.equal(exported.rows[0][8], 20);
    assert.equal(exported.rows[0][12], 60);
    assert.equal(exported.rows[0][20], "Sem dados");

    profiles.push({ id: "d", fullName: "Tarde sem base", wbLogin: "wb_d", shift: { id: "afternoon", name: "Tarde" },
      lob: { name: "VIDEO" }, supervisor: { id: "sup", fullName: "Supervisor" },
      roleTitle: "Agente", operationalStatus: "Ativo", admissionDate: new Date("2026-10-01"), terminationDate: null,
      user: { status: "ACTIVE", deletedAt: null }
    } as any);
    profiles.push({ ...profiles.at(-1)!, id: "inactive", wbLogin: "wb_inactive", user: { status: "INACTIVE", deletedAt: null } } as any);
    profiles.push({ ...profiles.at(-2)!, id: "future", wbLogin: "wb_future", admissionDate: new Date("2026-11-01") } as any);
    profiles.push({ ...profiles.at(-3)!, id: "supervisor", wbLogin: "wb_supervisor", roleTitle: "Supervisor" } as any);
    const withRoster = await getPerformanceAgentsDashboard(actor, { ...input, shiftId: "afternoon", supervisorId: "sup", slaTargetMinutes: 15 });
    assert.deepEqual(withRoster.agents.map(row => row.wbLogin), ["wb_b", "wb_d"]);
    assert.equal(withRoster.summary.submit, 20);
    assert.equal(withRoster.summary.agents, 1);
    assert.equal(withRoster.summary.agentsWithoutProduction, 1);
    assert.equal(withRoster.agents[1].legacyMetricsAvailable, false);
    assert.equal(withRoster.agents[1].moderationDuration.duration, "Sem dados");
    assert.equal((await getPerformanceAgentsDashboard(actor, { ...input, search: "WB_D" })).agents[0].wbLogin, "wb_d");
    assert.equal((await getPerformanceAgentsDashboard(actor, { ...input, supervisorId: "other" })).agents.length, 0);
    const rosterExport = await exportPerformanceAgentsXlsxData(actor, { ...input, shiftId: "afternoon", slaTargetMinutes: 15 });
    assert.deepEqual(rosterExport.rows.map(row => row[4]), ["wb_b", "wb_d"]);
    assert.equal(rosterExport.rows[1][8], "Sem dados");
    assert.equal(rosterExport.rows[1][20], "Sem dados");
    await db.exec(`DELETE FROM "ProductionRecord" WHERE "employeeId" = 'b'`);
    const missingAfternoon = await getPerformanceAgentsDashboard(actor, { ...input, shiftId: "afternoon" });
    assert.deepEqual(missingAfternoon.agents.map(row => row.wbLogin), ["wb_d"]);
    assert.equal(missingAfternoon.summary.submit, 0);
    assert.equal(missingAfternoon.summary.agentsWithoutProduction, 1);
  });
});
