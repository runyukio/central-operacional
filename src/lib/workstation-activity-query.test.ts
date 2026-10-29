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

function fixture(t: TestContext, role = "ADMIN", patch: Record<string, unknown> = {}) {
  const calls: Prisma.Sql[] = [];
  const descriptors = new Map(["user", "employeeProfile", "$queryRaw"].map((name) => [name, Object.getOwnPropertyDescriptor(prisma, name)]));
  const viewer = { email: actor.email, role: { name: role }, status: "ACTIVE", deletedAt: null, employeeProfile: { id: "supervisor-id" }, ...patch };
  Object.defineProperty(prisma, "user", { configurable: true, value: { findUnique: async () => viewer } });
  Object.defineProperty(prisma, "employeeProfile", { configurable: true, value: { findMany: async (args: unknown) => {
    assert.deepEqual(args, { where: { deletedAt: null, supervisorId: "supervisor-id" }, select: { id: true } });
    return [{ id: "team-agent" }];
  } } });
  Object.defineProperty(prisma, "$queryRaw", { configurable: true, value: async (sql: Prisma.Sql) => { calls.push(sql); return []; } });
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
  assert.equal(calls.length, 2);
  assert.ok(calls.every((sql) => sql.text.includes("WITH clipped_activity")));
  const summary = calls.find((sql) => sql.text.includes('AS "rowCount"'))!;
  const agents = calls.find((sql) => sql.text.includes('AS "agentsFound"'))!;
  assert.ok(!summary.text.includes("LIMIT"));
  assert.ok(!summary.values.some((value) => String(value).includes("Ana")), "agent search must not narrow the overall summary");
  assert.ok(agents.text.indexOf('GROUP BY "agentKey"') < agents.text.indexOf("LIMIT 1000"));
  assert.ok(agents.values.includes("%Ana' OR TRUE --%"));
  assert.ok(!agents.text.includes("Ana'"), "search must remain parameterized");
  assert.ok(agents.text.includes('LOWER(activity."hostname")'), "unlinked shared Windows users remain distinct by machine");
  assert.ok(agents.values.some((value) => value instanceof Date && value.toISOString() === "2026-10-29T03:00:00.000Z"));
});

test("agent selection cannot bypass supervisor team scope in any query", async (t) => {
  const { calls } = fixture(t, "SUPERVISOR");
  const result = await getWorkstationActivityQuery(actor, { view: "agent", agentKey: "employee:outside-team", date: "2026-10-29" });
  assert.equal(result.success, true);
  assert.equal(calls.length, 3);
  for (const sql of calls) {
    assert.ok(sql.text.includes('activity."employeeId" IN ('), "every query must enforce the scope");
    assert.ok(sql.values.includes("team-agent"));
    assert.ok(sql.values.includes("employee:outside-team"));
    assert.ok(sql.text.includes(" AND "));
  }
  const ranking = calls.find((sql) => sql.text.includes("ROW_NUMBER()"))!;
  assert.ok(!ranking.text.includes("LIMIT"), "full-day ranks must be independent of timeline row limit");
});

test("supervisor without an employee profile sees no records", async (t) => {
  const { calls } = fixture(t, "SUPERVISOR", { employeeProfile: null });
  await getWorkstationActivityQuery(actor, { view: "overview" });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((sql) => sql.text.includes(" AND FALSE")));
});

test("agent detail requires selection before reading records", async (t) => {
  const { calls } = fixture(t);
  const result = await getWorkstationActivityQuery(actor, { view: "agent" });
  assert.equal(result.success, false);
  assert.equal("status" in result && result.status, 400);
  assert.equal(calls.length, 0);
});
