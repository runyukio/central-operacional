import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getWorkstationActivityQuery } from "./workstation-activity-query";
import { canAccessRealtimeHoursActivity } from "./realtime-hours-permissions";
import { canAccessPathForRole, getNavItems } from "./navigation";

const actor = { email: "activity-test@example.test", name: "Activity test", role: "ADMIN" as const };
const allowed = ["ADMIN", "GESTOR", "GERENTE", "SUPERVISOR", "WFM"];
const denied = ["COLABORADOR", "QUALIDADE", "RH", "FINANCEIRO", "TI", "RTA", "POC", "COORDENADOR", "COORDINATOR", "CLIENT", "GLOBAL", "", "unknown"];

test("only the five requested profiles can see the menu, page and API", () => {
  for (const role of [...allowed, ...denied]) {
    const expected = allowed.includes(role);
    const viewer = { role, status: "ACTIVE" };
    assert.equal(canAccessRealtimeHoursActivity(viewer), expected, role);
    assert.equal(getNavItems(viewer).some((item) => item.href === "/captura-horas/atividade"), expected, role);
    for (const path of ["/captura-horas/atividade", "/captura-horas/atividade/detail", "/api/realtime-hours/activity", "/api/realtime-hours/activity/detail"]) {
      assert.equal(canAccessPathForRole(path, viewer), expected, `${role}: ${path}`);
    }
  }
  for (const role of allowed) assert.equal(canAccessRealtimeHoursActivity({ role, status: "INACTIVE" }), false);
  for (const role of ["Administrador", "Administradora", "Admin Central", "Management", "Manager", " supervisor "]) {
    assert.equal(canAccessRealtimeHoursActivity({ role, status: "ACTIVE" }), true, role);
  }
});

function fixture(t: TestContext, role = "ADMIN", patch: Record<string, unknown> = {}, resultRows: unknown[] = []) {
  const calls: Prisma.Sql[] = [];
  const descriptors = new Map(["user", "employeeProfile", "$queryRaw"].map((name) => [name, Object.getOwnPropertyDescriptor(prisma, name)]));
  const viewer = { email: actor.email, role: { name: role }, status: "ACTIVE", deletedAt: null, employeeProfile: { id: "supervisor-id" }, ...patch };
  Object.defineProperty(prisma, "user", { configurable: true, value: { findUnique: async () => viewer } });
  Object.defineProperty(prisma, "employeeProfile", { configurable: true, value: { findMany: async (args: unknown) => {
    assert.deepEqual(args, { where: { deletedAt: null, supervisorId: "supervisor-id" }, select: { id: true } });
    return [{ id: "team-agent" }];
  } } });
  Object.defineProperty(prisma, "$queryRaw", { configurable: true, value: async (sql: Prisma.Sql) => { calls.push(sql); return resultRows; } });
  t.after(() => {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(prisma, name, descriptor);
      else Reflect.deleteProperty(prisma, name);
    }
  });
  return { calls };
}

test("database role, active status and deletion override stale session permission", async (t) => {
  for (const patch of [{ role: { name: "COORDENADOR" } }, { role: { name: "RH" } }, { status: "INACTIVE" }, { deletedAt: new Date() }]) {
    await t.test(JSON.stringify(patch), async (child) => {
      const { calls } = fixture(child, "ADMIN", patch);
      const result = await getWorkstationActivityQuery(actor, { view: "overview" });
      assert.equal(result.success, false);
      assert.equal("status" in result && result.status, 403);
      assert.equal(calls.length, 0);
    });
  }
});

test("overview aggregates before limiting and does not load a global timeline", async (t) => {
  const { calls } = fixture(t);
  const result = await getWorkstationActivityQuery(actor, { view: "overview", date: "2026-10-29", agentSearch: "Ana' OR TRUE --" });
  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.ok(calls.every((sql) => sql.text.includes("WITH clipped_activity")));
  const query = calls[0];
  const summary = query.text.slice(query.text.indexOf("summary AS ("), query.text.indexOf(", agent_totals AS ("));
  const agents = query;
  assert.ok(!summary.includes("LIMIT"));
  assert.ok(!summary.includes("ILIKE"), "agent search must not narrow the overall summary");
  assert.equal(query.text.match(/FROM "agent_activity"\."WorkstationActivitySegment"/g)?.length, 1, "the raw day is read once");
  assert.ok(query.text.includes("clipped_activity AS MATERIALIZED"));
  assert.ok(!query.text.includes("timeline AS"), "overview must not materialize or transfer raw timeline rows");
  assert.ok(agents.text.indexOf('GROUP BY "agentKey"') < agents.text.indexOf("LIMIT 1000"));
  assert.ok(agents.text.indexOf('GROUP BY "agentKey"') < agents.text.indexOf("HAVING BOOL_OR"), "searching one machine must retain the agent's full-day totals across machines");
  assert.ok(agents.values.includes("%Ana' OR TRUE --%"));
  assert.ok(!agents.text.includes("Ana'"), "search must remain parameterized");
  assert.ok(agents.text.includes('LOWER(activity."hostname")'), "unlinked shared Windows users remain distinct by machine");
  assert.ok(agents.values.some((value) => value instanceof Date && value.toISOString() === "2026-10-29T03:00:00.000Z"));
});

test("agent selection cannot bypass supervisor team scope in any query", async (t) => {
  const { calls } = fixture(t, "SUPERVISOR");
  const result = await getWorkstationActivityQuery(actor, { view: "agent", agentKey: "employee:outside-team", date: "2026-10-29" });
  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  for (const sql of calls) {
    assert.ok(sql.text.includes('activity."employeeId" IN ('), "every query must enforce the scope");
    assert.ok(sql.values.includes("team-agent"));
    assert.ok(sql.values.includes("outside-team"));
    assert.ok(sql.text.includes('activity."employeeId" = '), "agent selection must use the indexed employee column");
    assert.ok(sql.text.includes(" AND "));
  }
  const ranking = calls.find((sql) => sql.text.includes("ROW_NUMBER()"))!;
  const ranks = ranking.text.slice(ranking.text.indexOf(", ranking_totals AS ("), ranking.text.indexOf(", timeline AS ("));
  assert.ok(!ranks.includes("LIMIT"), "full-day ranks must be independent of timeline row limit");
});

test("supervisor without an employee profile sees no records", async (t) => {
  const { calls } = fixture(t, "SUPERVISOR", { employeeProfile: null });
  await getWorkstationActivityQuery(actor, { view: "overview" });
  assert.equal(calls.length, 1);
  assert.ok(calls.every((sql) => sql.text.includes(" AND FALSE")));
});

test("agent detail requires selection before reading records", async (t) => {
  const { calls } = fixture(t);
  const result = await getWorkstationActivityQuery(actor, { view: "agent" });
  assert.equal(result.success, false);
  assert.equal("status" in result && result.status, 400);
  assert.equal(calls.length, 0);
});


test("agent rankings can omit timeline reads without limiting daily totals", async (t) => {
  const { calls } = fixture(t);
  const result = await getWorkstationActivityQuery(actor, { view: "agent", agentKey: "employee:agent", timeline: "false", limit: 5000 });
  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].text.includes("timeline AS"));
  assert.ok(calls[0].text.includes("ranking_totals AS"));
  assert.ok(!calls[0].text.includes("LIMIT"), "totals and rankings read the complete day");
  assert.ok("timelineIncluded" in result && !result.timelineIncluded);
  assert.ok("truncated" in result && !result.truncated);
});

test("a consolidated response keeps complete totals, bounded rows, UTC timestamps and interval merging", async (t) => {
  const summary = { rowCount: 6000, employees: 1, totalSeconds: 43200, webSeconds: 36000, appSeconds: 6000,
    idleSeconds: 1200, lockedSeconds: 0, privateSeconds: 0, unknownSeconds: 0, uniqueDomains: 200 };
  const row = { id: "first", agentKey: "employee:agent", eventId: "event-first", source: "test", capturedAt: "2026-10-29T12:02:00.000",
    hostname: "PC-01", windowsUser: "agent", wbLogin: "agent", employeeId: "agent", sourceType: "WEB", applicationName: "chrome",
    domain: "example.test", startedAt: "2026-10-29T12:00:00.000", endedAt: "2026-10-29T12:01:00.000", agentVersion: "1", employeeName: "Ana", lob: "ADS", supervisor: "Supervisor" };
  fixture(t, "ADMIN", {}, [{ summary, agents: [], rankings: [{ rankKind: "WEB", label: "example.test", seconds: 30000 }, { rankKind: "APP", label: "excel", seconds: 6000 }],
    rows: [row, { ...row, id: "second", eventId: "event-second", startedAt: "2026-10-29T12:01:10.000", endedAt: "2026-10-29T12:02:00.000" }] }]);
  const result = await getWorkstationActivityQuery(actor, { view: "agent", agentKey: "employee:agent", date: "2026-10-29", limit: 100 });
  assert.ok(result.success && "rows" in result);
  assert.deepEqual(result.summary, summary);
  assert.equal(result.sourceRecordsReturned, 2);
  assert.equal(result.recordsReturned, 1);
  assert.equal(result.rows[0].startedAt, "2026-10-29T12:00:00.000Z");
  assert.equal(result.rows[0].endedAt, "2026-10-29T12:02:00.000Z");
  assert.equal(result.rows[0].durationSeconds, 120);
  assert.equal(result.rows[0].employeeName, "Ana");
  assert.deepEqual(result.topDomains, [{ label: "example.test", seconds: 30000 }]);
  assert.deepEqual(result.topApplications, [{ label: "excel", seconds: 6000 }]);
  assert.equal(result.truncated, true);
  assert.equal(result.timelineIncluded, true);
});

test("device selection preserves the complete device key and legacy long intervals remain visible", async (t) => {
  const { calls } = fixture(t);
  await getWorkstationActivityQuery(actor, { view: "agent", agentKey: "device:pc-01|agent", date: "2026-10-29" });
  assert.ok(calls[0].values.includes("device:pc-01|agent"));
  const dates = calls[0].values.filter((value): value is Date => value instanceof Date);
  assert.ok(dates.every((value) => ["2026-10-29T03:00:00.000Z", "2026-10-30T03:00:00.000Z"].includes(value.toISOString())), "do not assume stored events last less than 24h");
});
