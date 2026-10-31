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
  const schedules = employees.map((employee) => ({ id: `slot-${employee.id}`, employeeId: employee.id, date: day, status: "PRESENTE", startsAt: "08:00", endsAt: "17:00", supervisorId: employee.supervisorId, employee,
    shift: { name: "Manhã", startsAt: "08:00", endsAt: "17:00" } }));
  const profile = mockPrismaDelegate(t, "employeeProfile", { findMany: async (args: any) => {
    if (args.select?.fullName && !args.select?.roleTitle) return [{ id: "sup", fullName: "Supervisor de teste" }, { id: "sup-2", fullName: "Outro supervisor" }];
    assert.equal(args.where.deletedAt, null);
    return typeof args.where.supervisorId === "string" && args.where.supervisorId !== "sup" ? [] : employees;
  } });
  mockPrismaDelegate(t, "auditLog", { findMany: async () => [] });
  mockPrismaDelegate(t, "user", { findUnique: async () => ({ id: "user", role: { name: role }, status: "ACTIVE", deletedAt: null, employeeProfile: null }), findMany: async () => [] });
  mockPrismaDelegate(t, "productionRecord", { aggregate: async () => ({ _min: { bzDay: day }, _max: { bzDay: day } }) });
  mockPrismaDelegate(t, "schedule", { findMany: async () => schedules,
    groupBy: async (args: any) => schedules.filter((row) => args.where.employeeId.in.includes(row.employeeId)).map((row) => ({ employeeId: row.employeeId, date: day, status: row.status, _count: { _all: 1 }, _max: { updatedAt: day } })) });
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
  return { profile, captureRead, employees, schedules };
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

test("ADS latency weights supervisors by valid submits and preserves missing values", async (t) => {
  const { employees } = fixture(t);
  employees[1].supervisorId = "sup-2";
  t.mock.method(prisma, "$queryRaw", async (sql: any) => {
    if (!sql.text.includes('AS "latencySubmits"')) return [];
    assert.ok(sql.text.includes('p."latencyMinutesSum" IS NOT NULL'));
    assert.ok(sql.text.includes('p."latencyMinutesSum" >= 0 AND p."submitNum" > 0'));
    assert.ok(sql.values.some((value: unknown) => value instanceof Date && value.toISOString() === "2026-10-02T00:00:00.000Z"));
    return [
      { supervisorId: "sup", latencyMinutesSum: 1000, latencySubmits: 10 },
      { supervisorId: "sup-2", latencyMinutesSum: 900, latencySubmits: 90 }
    ];
  });
  const result = await getPerformanceSupervisorsDashboard(actor, { ...query, includePunctuality: false });
  assert.equal(result.supervisors.find((row) => row.supervisorId === "sup")!.sla.ads.minutes, 100);
  assert.equal(result.supervisors.find((row) => row.supervisorId === "sup-2")!.sla.ads.minutes, 10);
  assert.equal(result.summary.sla.ads.minutes, 19);
  assert.equal(result.summary.sla.ads.submits, 100);
  assert.equal(result.summary.sla.tns.minutes, null);
  assert.equal(result.summary.sla.cec.normalSla, null);
});

test("TNS latency accepts only VIDEO queues with a 15 minute SLA, as Meu Espaço", async (t) => {
  const { employees } = fixture(t);
  employees.forEach((employee) => { employee.lob.name = "VIDEO"; });
  const { allPerformanceQueueIds, getPerformanceQueueMetadataById } = await import("./performance-service");
  const eligible = allPerformanceQueueIds().filter((id) => {
    const queue = getPerformanceQueueMetadataById(id);
    return queue.lob === "VIDEO" && queue.slaTargetMinutes === 15;
  });
  assert.ok(eligible.length > 0);
  t.mock.method(prisma, "$queryRaw", async (sql: any) => {
    if (!sql.text.includes('AS "latencySubmits"')) return [];
    const queueValues = sql.values.filter((value: unknown) => typeof value === "string" && allPerformanceQueueIds().includes(value as string));
    assert.deepEqual(queueValues.sort(), eligible.sort());
    return [{ supervisorId: "sup", latencyMinutesSum: 1530, latencySubmits: 100 }];
  });
  const result = await getPerformanceSupervisorsDashboard(actor, { ...query, includePunctuality: false });
  assert.equal(result.supervisors[0].sla.tns.minutes, 15.3);
  assert.equal(result.summary.sla.tns.minutes, 15.3);
  assert.equal(result.supervisors[0].sla.ads.minutes, null);
  assert.deepEqual(result.supervisors[0].sla.lobs, ["TNS"]);
});

test("CEC FRT reuses ticket creation, successful imports, Normal and P0 + HM denominators", async (t) => {
  const { employees } = fixture(t);
  employees.forEach((employee) => { employee.lob.name = "CEC"; });
  employees[1].supervisorId = "sup-2";
  let frtReads = 0;
  t.mock.method(prisma, "$queryRaw", async (sql: any) => {
    if (!sql.text.includes('FROM "PerformanceCecFrtRecord"')) return [];
    frtReads++;
    assert.ok(sql.text.includes('b.status=\'SUCCESS\''));
    assert.ok(sql.text.includes('f."ticketCreatedDay">='));
    assert.ok(sql.text.includes("f.priority IN ('P0','HM')"));
    assert.ok(sql.text.includes('SUM(f."over1440")'));
    assert.ok(sql.text.includes('SUM(f."over240")'));
    assert.ok(sql.values.includes("a") && sql.values.includes("b"));
    return [
      { employeeId: "a", normalTotal: 10, normalOver: 10, urgentTotal: 10, urgentOver: 2 },
      { employeeId: "b", normalTotal: 90, normalOver: 0, urgentTotal: 30, urgentOver: 2 }
    ];
  });
  const result = await getPerformanceSupervisorsDashboard(actor, { ...query, includePunctuality: false });
  assert.equal(frtReads, 1);
  assert.equal(result.summary.sla.cec.normalSla, 90);
  assert.equal(result.summary.sla.cec.urgentSla, 90);
  assert.equal(result.supervisors.find((row) => row.supervisorId === "sup")!.sla.cec.normalSla, 0);
  assert.equal(result.supervisors.find((row) => row.supervisorId === "sup-2")!.sla.cec.normalSla, 100);
  assert.equal(result.summary.sla.ads.minutes, null);
});

test("ABS reconciles with the Central's schedule and justification owner, retaining former partners", async (t) => {
  const { employees, schedules } = fixture(t);
  employees[1].operationalStatus = "Desligado";
  const original = schedules[0];
  schedules.splice(0, schedules.length,
    { ...original, id: "present", status: "PRESENTE", supervisorId: "sup-2" },
    { ...original, id: "former-absence", employeeId: "b", employee: employees[1], status: "FALTA", supervisorId: "sup" },
    { ...original, id: "justified", status: "FALTA_JUSTIFICADA", supervisorId: "sup-2" },
    { ...original, id: "archived", employeeId: "archived", status: "FALTA", supervisorId: "sup", employee: { ...employees[1], id: "archived", supervisorId: "another-team" } },
    { ...original, id: "staff", employeeId: "staff", status: "FALTA", supervisorId: "sup", employee: { ...employees[1], id: "staff", roleTitle: "Supervisor" } }
  );
  t.mock.method(prisma.user, "findMany", async () => [
    { id: "justifier-1", name: "Supervisor de teste", employeeProfile: { fullName: "Supervisor de teste", roleTitle: "Supervisor" } },
    { id: "justifier-2", name: "Outro supervisor", employeeProfile: { fullName: "Outro supervisor", roleTitle: "Supervisor" } }
  ]);
  const read = prisma.$queryRaw.bind(prisma);
  t.mock.method(prisma, "$queryRaw", async (sql: any) => sql.text.includes('FROM "AttendanceRecord"') ? [
    { scheduleId: "former-absence", status: "FALTA_JUSTIFICADA", isJustified: true, absenceReason: "Problema de saúde", justifiedById: "justifier-2" },
    { scheduleId: "justified", status: "FALTA_JUSTIFICADA", isJustified: true, absenceReason: "Problema de saúde", justifiedById: "justifier-1" }
  ] : read(sql));
  const { loadCentralSupervisorAbs } = await import("./schedule-service");
  const central = await loadCentralSupervisorAbs({ start: day, end: day });
  const result = await getPerformanceSupervisorsDashboard(actor, { ...query, includePunctuality: false });
  const row = result.supervisors[0], expected = central.bySupervisor[row.supervisor];
  assert.equal(row.planned, expected.planned); assert.equal(row.absences, expected.absent); assert.equal(row.absRate, expected.absRate);
  assert.equal(row.planned, 2); assert.equal(row.absences, 2); assert.equal(row.absRate, 100);
  assert.equal(central.bySupervisor["Outro supervisor"].absent, 1);
  assert.equal(result.summary.planned, 4); assert.equal(result.summary.absences, 3); assert.equal(result.summary.absRate, 75);
  assert.equal((await getPerformanceSupervisorAgentsDashboard(actor, "sup", { ...query, includePunctuality: false })).agents.some((agent) => agent.id === "b"), false);
});
