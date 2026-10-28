import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { getPerformanceSupervisorAgentsDashboard, getPerformanceSupervisorsDashboard, getPerformanceSupervisorsWorkMetrics } from "./performance-service";
import { mockPrismaDelegate } from "./prisma-test-delegate";
import { prisma } from "./prisma";
import { teamWorkData } from "./team-work-metrics-service";

const day = new Date("2026-10-01"), query = { startDate: "2026-10-01", endDate: "2026-10-01" };
const actor = { email: "test@example.test", name: "Test", role: "ADMIN" as const };
function fixture(t: TestContext, role = "ADMIN", supervisorPatch: Record<string, unknown> = {}) {
  const employees = ["a", "b"].map((id) => ({ id, fullName: `Agente ${id}`, wbLogin: `wb_${id}`, roleTitle: "Agente", skill: "Material Queues",
    operationalStatus: "Ativo", admissionDate: new Date("2025-01-01"), terminationDate: null, supervisorId: "sup", supervisor: { id: "sup", fullName: "Supervisor de teste", operationalStatus: "Ativo", deletedAt: null, user: { status: "ACTIVE", deletedAt: null }, ...supervisorPatch }, lob: { name: "ADS" } }));
  const schedules = employees.map((employee) => ({ id: `slot-${employee.id}`, employeeId: employee.id, date: day, status: "PRESENTE", startsAt: "08:00", endsAt: "17:00", shift: { name: "Manhã", startsAt: "08:00", endsAt: "17:00" } }));
  const profile = mockPrismaDelegate(t, "employeeProfile", { findMany: async (args: any) => {
    assert.equal(args.where.deletedAt, null);
    return typeof args.where.supervisorId === "string" && args.where.supervisorId !== "sup" ? [] : employees;
  } });
  mockPrismaDelegate(t, "user", { findUnique: async () => ({ id: "user", role: { name: role }, status: "ACTIVE", deletedAt: null, employeeProfile: null }) });
  mockPrismaDelegate(t, "productionRecord", { aggregate: async () => ({ _min: { bzDay: day }, _max: { bzDay: day } }) });
  mockPrismaDelegate(t, "schedule", { findMany: async () => schedules,
    groupBy: async () => schedules.map((row) => ({ employeeId: row.employeeId, date: day, status: row.status, _count: { _all: 1 }, _max: { updatedAt: day } })) });
  mockPrismaDelegate(t, "workHourRecord", { findMany: async () => schedules.map((row, index) => ({ employeeId: row.employeeId, date: day, scheduleId: row.id, effectiveHours: index ? 10 : 4, plannedHours: 8 })) });
  mockPrismaDelegate(t, "employeeMoodRecord", { findMany: async () => [{ employeeId: "a", moodScore: 4 }],
    groupBy: async (args: any) => { assert.deepEqual(args.where.employeeId.in, ["a", "b"]); return [{ employeeId: "a", _sum: { moodScore: 4 }, _count: { _all: 1 } }]; } });
  const captureRead = t.mock.method(teamWorkData, "punctualityRange", async (args: any) => {
    assert.deepEqual(args.eligibleEmployeeIds, ["a", "b"]);
    return { warnings: [], rows: schedules.map((row, index) => ({ employeeId: row.employeeId, slotId: row.id, data: "2026-10-01", entryAt: index ? "2026-10-01T11:00:00Z" : "2026-10-01T11:01:00Z", exitAt: "2026-10-01T20:00:00Z" })) } as any;
  });
  t.mock.method(prisma, "$queryRaw", async (sql: any) => {
    assert.ok(!sql.values.includes("another-team"));
    if (sql.text.includes('FROM "ProductionRecord"')) return sql.text.includes('AS output')
      ? employees.map((row) => ({ employeeId: row.id, day, output: 100, ahtSubmit: 100, duration: 5000, active: true, updatedAt: day }))
      : [{ supervisorId: "sup", submit: 200, moderationSeconds: 10000 }];
    if (sql.text.includes('FROM "QualityRecord"')) return sql.text.includes('AS "qualityDay"')
      ? [{ employeeId: "a", supervisorId: "", qualityDay: day, correct: 19, total: 20, updatedAt: day }]
      : [{ supervisorId: "sup", correct: 19, total: 20 }];
    return [];
  });
  return { profile, captureRead, employees };
}

test("supervisors return weighted adherence, capture rates and official overtime together", async (t) => {
  fixture(t);
  const result = await getPerformanceSupervisorsDashboard(actor, query);
  assert.equal(result.supervisors[0].adherenceRate, 75); assert.equal(result.summary.adherenceRate, 75);
  assert.equal(result.supervisors[0].lateRate, 50); assert.equal(result.supervisors[0].earlyRate, 0);
  assert.equal(result.supervisors[0].officialOvertimeHours, 2); assert.equal(result.summary.officialOvertimeHours, 2);
  assert.equal(result.supervisors[0].quality, 95); assert.equal(result.supervisors[0].moodAverage, 4);
});

test("click detail uses exactly the selected team and period, with null mood/quality for missing data", async (t) => {
  const { profile } = fixture(t);
  const result = await getPerformanceSupervisorAgentsDashboard(actor, "sup", query);
  assert.deepEqual(result.period, query); assert.equal(result.agents.length, 2);
  assert.equal(profile.findMany.mock.calls[0].arguments[0].where.supervisorId, "sup");
  const a = result.agents.find((row) => row.id === "a")!, b = result.agents.find((row) => row.id === "b")!;
  assert.equal(a.metric.abs, 0); assert.equal(a.metric.ahtSeconds, 50); assert.equal(a.metric.quality, 95); assert.equal(a.moodAverage, 4);
  assert.equal(a.work.adherenceRate, 50); assert.equal(b.work.adherenceRate, 100); assert.equal(b.work.officialOvertimeHours, 2);
  assert.equal(b.moodAverage, null); assert.equal(b.metric.quality, null);
  await assert.rejects(() => getPerformanceSupervisorAgentsDashboard(actor, "another-team", query), { status: 404 });
});

test("a role forged in the client cannot open supervisor detail", async (t) => {
  const { profile } = fixture(t, "COLABORADOR");
  await assert.rejects(() => getPerformanceSupervisorAgentsDashboard(actor, "sup", query), { status: 403 });
  assert.equal(profile.findMany.mock.callCount(), 0);
});

for (const [name, patch] of [
  ["desligado", { operationalStatus: "Desligado" }],
  ["inativo", { operationalStatus: "Inativo" }],
  ["excluído", { deletedAt: day }],
  ["conta inativa", { user: { status: "INACTIVE", deletedAt: null } }],
  ["conta excluída", { user: { status: "ACTIVE", deletedAt: day } }],
  ["sem conta ativa", { user: null }]
] as const) {
  test(`supervisor ${name} não entra no consolidado nem no detalhe por ID direto`, async (t) => {
    const { captureRead } = fixture(t, "ADMIN", patch);
    const result = await getPerformanceSupervisorsDashboard(actor, query);
    assert.equal(result.supervisors.length, 0); assert.equal(result.summary.supervisors, 0);
    assert.equal(result.summary.adherenceRate, null);
    await assert.rejects(() => getPerformanceSupervisorAgentsDashboard(actor, "sup", query), { status: 404 });
    assert.equal(captureRead.mock.callCount(), 0);
  });
}

for (const status of ["Desligado", "Inativo"]) {
  test(`agente ${status} fica fora da lista, mantendo sua contribuição nos totais`, async (t) => {
    const { employees } = fixture(t);
    employees[1].operationalStatus = status;
    const total = await getPerformanceSupervisorsDashboard(actor, query);
    const detail = await getPerformanceSupervisorAgentsDashboard(actor, "sup", query);
    const work = await getPerformanceSupervisorsWorkMetrics(actor, query, "sup");
    assert.deepEqual(detail.agents.map((row) => row.id), ["a"]);
    assert.deepEqual(work.agents.map((row) => row.id), ["a"]);
    assert.equal(total.supervisors[0].adherenceRate, 75);
    assert.equal(total.summary.officialOvertimeHours, 2);
    assert.equal(total.supervisors[0].lateRate, 50);
    assert.equal(work.supervisors[0].lateRate, 50);
  });
}

test("base dashboard and agent detail return official indicators without waiting for capture", async (t) => {
  const { captureRead } = fixture(t);
  const baseQuery = { ...query, includePunctuality: false };
  const total = await getPerformanceSupervisorsDashboard(actor, baseQuery);
  const detail = await getPerformanceSupervisorAgentsDashboard(actor, "sup", baseQuery);
  assert.equal(total.summary.adherenceRate, 75);
  assert.equal(total.summary.officialOvertimeHours, 2);
  assert.equal(detail.agents.length, 2);
  assert.equal(total.supervisors[0].lateRate, null);
  assert.equal(captureRead.mock.callCount(), 0);
});
