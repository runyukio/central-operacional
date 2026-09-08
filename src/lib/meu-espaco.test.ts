import assert from "node:assert/strict";
import test, { beforeEach, type TestContext } from "node:test";
import { canAccessMeuEspaco, canRespondMeuEspaco, resolveMeuEspacoSupervisor } from "./meu-espaco-access";
import { decodeSpaceCursor, encodeSpaceCursor, pendingFingerprint, spaceDate, spacePendingFilters, spacePeriod, spaceToday } from "./meu-espaco-filters";
import { emptySpaceMetric, finishSpaceMetric, spaceLobFamily } from "./meu-espaco-metrics";
import { canAccessPathForRole, getNavSections } from "./navigation";
import { getMeuEspacoScope } from "./meu-espaco-scope";
import { prisma } from "./prisma";
import { getSpacePendingItem, getSpaceSummary, listSpacePending, respondSpacePending, spacePendingSource } from "./meu-espaco-pending-service";
import { getSpaceResults } from "./meu-espaco-results-service";
import { listOperationalWorkHours, workHourReadData } from "./work-hours-service";
import type { MeuEspacoScope } from "./meu-espaco-scope";
import { isActiveSpaceSupervisor } from "./meu-espaco-supervisors";
import { spaceLatencyQueueKind } from "./meu-espaco-metrics";
import { spaceHoursDefaultPeriod, summarizeSpaceHours } from "./meu-espaco-hours";
import { getSpaceHoursSummary, spaceHoursPeriod } from "./meu-espaco-hours-service";

// Prisma model delegates are proxies without method descriptors. Replace only
// this process's delegates, keeping all test IO in memory and failing closed.
beforeEach((t) => {
  for (const model of ["user", "employeeProfile", "attendanceRecord", "schedule", "workHourRecord", "workHourAdjustmentRequest", "workHourAdherenceJustification", "auditLog", "notification", "attendanceHistory", "scheduleChangeHistory"] as const) {
    const original = prisma[model];
    (prisma as any)[model] = Object.fromEntries(["findUnique", "findFirst", "findMany", "groupBy", "aggregate", "count", "update", "updateMany", "create"].map((method) => [method, async () => { throw new Error(`Unmocked ${model}.${method}`); }]));
    (t as TestContext).after(() => { (prisma as any)[model] = original; });
  }
});

const user = (role: string) => ({ role, status: "ACTIVE" });
for (const role of ["ADMIN", "WFM", "SUPERVISOR", "GESTOR", "COORDENADOR"]) {
  test(`${role}: menu and every own API path accessible; reply differs from read`, () => {
    assert.equal(canAccessMeuEspaco(user(role)), true);
    assert.equal(canRespondMeuEspaco(user(role)), !["GESTOR", "COORDENADOR"].includes(role));
    assert.equal(canAccessPathForRole("/api/meu-espaco/pendencias/hours/id", user(role)), true);
    assert.equal(getNavSections(user(role)).find((section) => section.label === "Rotina")?.items.some((item) => item.href === "/meu-espaco"), true);
  });
}
for (const role of ["COLABORADOR", "POC", "RTA", "CLIENT", "GLOBAL", "RH", "FINANCEIRO", "TI", "UNKNOWN"]) {
  test(`${role}: denied on UI, nested API and reply`, () => {
    assert.equal(canAccessMeuEspaco(user(role)), false);
    assert.equal(canRespondMeuEspaco(user(role)), false);
    assert.equal(canAccessPathForRole("/meu-espaco", user(role)), false);
    assert.equal(canAccessPathForRole("/api/meu-espaco/resumo", user(role)), false);
  });
}
test("inactive users and missing/changed supervisor scope fail closed", () => {
  assert.equal(canAccessMeuEspaco({ role: "ADMIN", status: "INACTIVE" }), false);
  assert.throws(() => resolveMeuEspacoSupervisor(user("SUPERVISOR"), null));
  assert.throws(() => resolveMeuEspacoSupervisor(user("SUPERVISOR"), "mine", "other"));
  assert.equal(resolveMeuEspacoSupervisor(user("SUPERVISOR"), "mine"), "mine");
  assert.equal(resolveMeuEspacoSupervisor(user("WFM"), null), null);
  assert.equal(resolveMeuEspacoSupervisor(user("GESTOR"), null, "other"), "other");
});
test("operational date, old pending defaults, independent metric period and invalid ranges", () => {
  assert.equal(spaceToday(new Date("2026-09-07T01:00:00Z")), "2026-09-06");
  assert.deepEqual(spacePeriod(new URLSearchParams(), true, "2026-09-07"), { startDate: "1900-01-01", endDate: "2026-09-07" });
  assert.deepEqual(spacePeriod(new URLSearchParams(), false, "2026-09-07"), { startDate: "2026-09-01", endDate: "2026-09-07" });
  assert.throws(() => spaceDate("2026-02-30"));
  assert.throws(() => spacePeriod(new URLSearchParams("startDate=2026-09-08&endDate=2026-09-07"), false, "2026-09-07"));
  assert.throws(() => spacePeriod(new URLSearchParams("endDate=2026-09-08"), true, "2026-09-07"));
});
test("cursor is bound to role scope and every applied filter", () => {
  const filters = spacePendingFilters(new URLSearchParams("kind=hours&lob=ADS&search=test"));
  const fingerprint = pendingFingerprint("user:own", filters);
  const row = { date: "2026-08-01", kind: "hours" as const, id: "last", fingerprint };
  assert.deepEqual(decodeSpaceCursor(encodeSpaceCursor(row), fingerprint), row);
  assert.throws(() => decodeSpaceCursor(encodeSpaceCursor(row), pendingFingerprint("user:other", filters)));
  assert.throws(() => decodeSpaceCursor(encodeSpaceCursor(row), pendingFingerprint("user:own", { ...filters, search: "changed" })));
  assert.throws(() => decodeSpaceCursor("invalid", fingerprint));
});
test("metrics use sums / true denominators; unknown is not zero and CEC is separate", () => {
  const metric = emptySpaceMetric();
  assert.equal(finishSpaceMetric(metric, "ADS").quality, null);
  assert.equal(finishSpaceMetric(metric, "ADS").production, null);
  metric.days.add("2026-09-01"); metric.days.add("2026-09-02");
  for (const id of ["a:1", "b:1", "a:2"]) metric.agentDays.add(id);
  Object.assign(metric, { output: 300, ahtSubmit: 300, duration: 15000, correct: 95, samples: 100, planned: 10, absences: 1 });
  const result = finishSpaceMetric(metric, "ADS");
  assert.equal(result.production, 300); assert.equal(result.dailyTeam, 150); assert.equal(result.dailyIndividual, 100);
  assert.equal(result.ahtSeconds, 50); assert.equal(result.quality, 95); assert.equal(result.abs, 10);
  assert.equal(finishSpaceMetric(metric, "CEC").cpd, 100); assert.equal(finishSpaceMetric(metric, "CEC").ahtSeconds, null);
  assert.equal(spaceLobFamily("PROJECT"), "ADS"); assert.equal(spaceLobFamily("COMMENTS"), "TNS");
});

function employee(id = "agent", supervisorId = "sup", patch: Record<string, unknown> = {}) {
  return { id, fullName: id, wbLogin: `wb_${id}`, supervisorId, roleTitle: "Agente", operationalStatus: "Ativo", deletedAt: null,
    goLiveDate: new Date("2026-08-01"), skill: "Material Queues", lob: { name: "ADS" }, team: { name: "ADS" }, user: patch.roleTitle === "Supervisor" ? { status: "ACTIVE" as const, deletedAt: null, role: { name: "SUPERVISOR" } } : null, skillAssignments: [], supervisor: { id: supervisorId, fullName: supervisorId }, ...patch };
}
function scope(patch: Partial<MeuEspacoScope> = {}): MeuEspacoScope {
  return { user: { id: "u", email: "test@example.test", name: "Test", status: "ACTIVE" }, actor: { email: "test@example.test", name: "Test", role: "SUPERVISOR" }, role: "SUPERVISOR", broad: false,
    canRespond: true, supervisorId: "sup", activeSupervisorIds: ["sup"], employees: [employee()], employeeIds: ["agent"], profiles: [employee()], ...patch } as MeuEspacoScope;
}
test("database role is authoritative over actor/JWT and scope is applied before employee reads", async (t) => {
  t.mock.method(prisma.user, "findUnique", async () => ({ id: "u", email: "test@example.test", status: "ACTIVE", deletedAt: null, role: { name: "SUPERVISOR" }, employeeProfile: { id: "sup", deletedAt: null } }));
  let reads = 0;
  t.mock.method(prisma.employeeProfile, "findMany", async (args: any) => { reads++; assert.ok(JSON.stringify(args.where).includes('"supervisorId":"sup"')); return [employee("sup", "manager", { roleTitle: "Supervisor" }), employee()]; });
  const actor = { email: "test@example.test", name: "Test", role: "ADMIN" as const };
  await assert.rejects(() => getMeuEspacoScope(actor, "other")); assert.equal(reads, 0);
  const result = await getMeuEspacoScope(actor); assert.equal(result.role, "SUPERVISOR"); assert.deepEqual(result.employeeIds, ["agent"]);
});
test("consolidation includes only active supervisors; direct inactive ids cannot bypass the filter", async (t) => {
  t.mock.method(prisma.user, "findUnique", async () => ({ id: "u", email: "test@example.test", status: "ACTIVE", deletedAt: null, role: { name: "WFM" }, employeeProfile: null }));
  t.mock.method(prisma.employeeProfile, "findMany", async () => [employee("sup", "manager", { roleTitle: "Supervisor" }), employee("inactive", "manager", { roleTitle: "Supervisor", operationalStatus: "Desligado" }), employee(), employee("other-agent", "inactive"), employee("unassigned", "", { supervisorId: null })]);
  const actor = { email: "test@example.test", name: "Test", role: "WFM" as const };
  assert.deepEqual((await getMeuEspacoScope(actor)).employeeIds, ["agent"]);
  await assert.rejects(() => getMeuEspacoScope(actor, "inactive"), /Supervisor ativo/);
  await assert.rejects(() => getMeuEspacoScope(actor, "archived-owner"), /Supervisor ativo/);
});
test("pending SQL keeps original hour owner and excludes canceled, deleted, protected and pre-Go-Live data", async (t) => {
  t.mock.method(prisma.attendanceRecord, "groupBy", async () => [{ absenceReason: "Não informado" }, { absenceReason: "garbage" }]);
  const data = await spacePendingSource(scope({ profiles: [employee(), employee("transferred", "other"), employee("training", "sup", { operationalStatus: "Em treinamento" })] }));
  assert.match(data.text, /j\."supervisorId"=\$/);
  assert.match(data.text, /EXISTS \(SELECT 1 FROM "WorkHourRecord"/);
  assert.match(data.text, /j\.date >= e\."goLiveDate"/);
  assert.match(data.text, /s\."deletedAt" IS NULL/);
  assert.match(data.text, /'FALTA_JUSTIFICADA', 'FALTA_INJUSTIFICADA'/);
  assert.ok(data.values.includes("transferred")); assert.ok(!data.values.includes("training"));
  assert.ok(data.values.includes("Não informado")); assert.ok(!data.values.includes("garbage"));
});
test("50-item keyset pagination has no offset and id-scoped histories fail closed", async (t) => {
  t.mock.method(prisma.attendanceRecord, "groupBy", async () => []);
  t.mock.method(prisma, "$queryRaw", async (sql: any) => {
    assert.ok(!sql.text.includes("OFFSET"));
    return sql.text.includes("LIMIT 51") ? Array.from({ length: 51 }, (_, index) => ({ id: String(index), kind: "hours", date: new Date("2026-08-01"), answeredAt: null })) : [];
  });
  const result = await listSpacePending(scope(), new URLSearchParams());
  assert.equal(result.data.length, 50); assert.equal(result.hasMore, true); assert.ok(result.nextCursor);
  await assert.rejects(() => getSpacePendingItem(scope(), "hours", "outside"));
});
test("manager cannot mutate even when an item id and fabricated reply are supplied", async () => {
  await assert.rejects(() => respondSpacePending(scope({ role: "GESTOR", canRespond: false }), "hours", "id", { justification: "texto" }), /somente à consulta/);
});
test("summary aggregates without a metric-month cutoff on open items, using local answer days", async (t) => {
  t.mock.method(prisma.attendanceRecord, "groupBy", async () => []);
  t.mock.method(prisma, "$queryRaw", async (sql: any) => {
    assert.match(sql.text, /AT TIME ZONE 'America\/Sao_Paulo'/);
    assert.match(sql.text, /COUNT\(\*\) FILTER/);
    return [{ supervisorId: "sup", supervisor: "Supervisor", absences: 2, hours: 3, answered: 4, oldest: "2026-07-01" }];
  });
  const result = await getSpaceSummary(scope(), new URLSearchParams("startDate=2026-09-01&endDate=2026-09-06"));
  assert.deepEqual(result.management, { absences: 2, hours: 3, answered: 4, oldest: "2026-07-01" });
});
test("results reconcile daily sums, weighted quality, current membership and partners without data", async (t) => {
  t.mock.method(prisma, "$queryRaw", async (sql: any) => {
    assert.ok(sql.values.includes("agent"));
    const date = new Date("2026-09-01");
    if (sql.text.includes('FROM "ProductionRecord"')) {
      assert.match(sql.text, /"latencyMinutesSum" IS NOT NULL/);
      return [{ employeeId: "agent", day: date, output: 100, ahtSubmit: 100, duration: 5000, active: true, updatedAt: date, latencyMinutesSum: 1250, latencySubmits: 100 }];
    }
    if (sql.text.includes('FROM "QualityRecord"')) return [{ employeeId: "agent", supervisorId: "", qualityDay: date, correct: 9, total: 10, updatedAt: date }];
    return [];
  });
  t.mock.method(prisma.schedule, "groupBy", async () => [{ employeeId: "agent", date: new Date("2026-09-01"), status: "PRESENTE", _count: { _all: 1 }, _max: { updatedAt: new Date("2026-09-01") } }]);
  const result = await getSpaceResults(scope({ employees: [employee(), employee("no-data")] }), new URLSearchParams("startDate=2026-09-01&endDate=2026-09-06"));
  assert.equal(result.groups[0].metric.production, 100); assert.equal(result.groups[0].metric.ahtSeconds, 50);
  assert.equal(result.groups[0].daily[0].metric.production, 100); assert.equal(result.groups[0].metric.quality, 90);
  assert.equal(result.groups[0].coverage.productionPartners, 1); assert.equal(result.groups[0].teamSize, 2);
  assert.equal(result.partners.find((row) => row.id === "no-data")?.metric.production, null);
  assert.equal(result.groups[0].metric.latencyMinutes, 12.5);
  assert.equal(result.groups[0].daily[0].metric.latencyMinutes, 12.5);
  assert.equal(result.supervisors[0].groups[0].metric.latencyMinutes, 12.5);
  assert.equal(result.partners.find((row) => row.id === "no-data")?.metric.latencyMinutes, null);
});

test("active directory checks operational and account statuses, deletion and supervisor role", () => {
  const active = { roleTitle: "Supervisão", operationalStatus: "Ativo", deletedAt: null, user: { status: "ACTIVE", deletedAt: null, role: { name: "SUPERVISOR" } } };
  assert.equal(isActiveSpaceSupervisor(active), true);
  for (const operationalStatus of ["Desligado", "Inativo", "Desativado", ""]) assert.equal(isActiveSpaceSupervisor({ ...active, operationalStatus }), false);
  assert.equal(isActiveSpaceSupervisor({ ...active, user: { ...active.user, status: "INACTIVE" } }), false);
  assert.equal(isActiveSpaceSupervisor({ ...active, deletedAt: new Date() }), false);
  assert.equal(isActiveSpaceSupervisor({ ...active, user: null }), false);
});

test("latency uses sum/submits, separates Comments, excludes other video SLAs, preserves no data", () => {
  const value = emptySpaceMetric();
  Object.assign(value, { latencyMinutesSum: 900 * 10 + 100 * 100, latencySubmits: 1000, commentsLatencyMinutesSum: 80000, commentsLatencySubmits: 200 });
  assert.equal(finishSpaceMetric(value, "TNS").latencyMinutes, 19);
  assert.equal(finishSpaceMetric(value, "TNS").commentsLatencyMinutes, 400);
  assert.equal(finishSpaceMetric(value, "CEC").latencyMinutes, null);
  assert.equal(finishSpaceMetric(emptySpaceMetric(), "ADS").latencyMinutes, null);
  assert.equal(finishSpaceMetric({ ...emptySpaceMetric(), latencySubmits: 100 }, "ADS").latencyMinutes, 0);
  assert.equal(spaceLatencyQueueKind({ lob: "ADS", slaTargetMinutes: 120 }), "primary");
  assert.equal(spaceLatencyQueueKind({ lob: "VIDEO", slaTargetMinutes: 15 }), "primary");
  assert.equal(spaceLatencyQueueKind({ lob: "VIDEO", slaTargetMinutes: 120 }), null);
  assert.equal(spaceLatencyQueueKind({ lob: "COMMENTS", slaTargetMinutes: 15 }), "comments");
});

test("hours projection sums realized once, future productive slots only, with missing history warning", () => {
  const period = { startDate: "2026-09-01", endDate: "2026-09-30" };
  const row = { status: "ESCALADO", startsAt: "23:00", endsAt: "08:00", shiftName: "Noite", future: true, slots: 3 };
  const result = summarizeSpaceHours(period, "2026-09-07", { hours: 16.5, records: 2 }, [row,
    { ...row, status: "FOLGA", slots: 4 }, { ...row, status: "NESTING", slots: 4 }, { ...row, status: "TREINAMENTO", slots: 4 },
    { ...row, status: "TROCA_APROVADA", shiftName: "Folga", slots: 2 }, { ...row, status: "TROCA_APROVADA", slots: 1 },
    { ...row, status: "FALTA", slots: 2 }, { ...row, future: false, slots: 2 }]);
  assert.equal(result.realizedHours, 16.5); assert.equal(result.futureHours, 32); assert.equal(result.projectedHours, 48.5);
  assert.equal(result.futureSlots, 4); assert.equal(result.missingPastSlots, 2);
  assert.equal(result.projectionFrom, "2026-09-08");
  assert.equal(summarizeSpaceHours(period, "2026-09-07", { hours: null, records: 0 }, []).projectedHours, null);
  assert.equal(summarizeSpaceHours(period, "2026-09-07", { hours: 0, records: 1 }, []).projectedHours, 0);
  assert.deepEqual(spaceHoursDefaultPeriod({ ...period, endDate: "2026-09-07" }, "2026-09-07"), period);
  assert.deepEqual(spaceHoursDefaultPeriod({ startDate: "2026-08-01", endDate: "2026-08-31" }, "2026-09-07"), { startDate: "2026-08-01", endDate: "2026-08-31" });
  assert.deepEqual(spaceHoursPeriod(new URLSearchParams(period), "2026-09-07"), period);
  assert.throws(() => spaceHoursPeriod(new URLSearchParams("startDate=2026-02-30&endDate=2026-09-30")));
  assert.throws(() => spaceHoursPeriod(new URLSearchParams("startDate=2025-01-01&endDate=2026-09-30")));
});

test("hours summary queries the whole authorized period, not the detail page, and excludes deleted future schedules", async (t) => {
  t.mock.method(prisma.workHourRecord, "aggregate", async (args: any) => {
    assert.deepEqual(args.where.employeeId.in, ["agent"]); assert.equal(args.where.date.lte.toISOString().slice(0, 10), "2026-09-07");
    assert.equal(args.take, undefined); return { _sum: { effectiveHours: 37 }, _count: { _all: 5 } };
  });
  t.mock.method(prisma, "$queryRaw", async (sql: any) => {
    assert.match(sql.text, /s\."deletedAt" IS NULL/); assert.match(sql.text, /NOT EXISTS/); assert.match(sql.text, /GROUP BY 1, 2, 3, 4, 5/);
    assert.ok(sql.values.includes("agent")); assert.ok(!sql.values.includes("other"));
    return [{ status: "ESCALADO", future: true, slots: 2 }];
  });
  const period = { startDate: "2026-09-01", endDate: "2026-09-30" };
  const result = await getSpaceHoursSummary(scope(), new URLSearchParams("page=3&search=agent"), period, "2026-09-07");
  assert.equal(result.projectedHours, 53);
  assert.equal((await getSpaceHoursSummary(scope(), new URLSearchParams("employeeId=other"), period)).projectedHours, null);
});
test("hours read scope only narrows existing filters, including employeeId and free search", async (t) => {
  t.mock.method(prisma.user, "findUnique", async () => ({ id: "u", role: { name: "SUPERVISOR" }, employeeProfile: { id: "sup" } }));
  let checked = false;
  t.mock.method(prisma.workHourRecord, "findMany", async (args: any) => { assert.deepEqual(args.where.AND[1], { employeeId: { in: ["agent"] } }); assert.equal(args.where.AND[0].employeeId, "outside"); checked = true; return []; });
  t.mock.method(prisma.workHourRecord, "count", async () => 0);
  t.mock.method(prisma.workHourRecord, "groupBy", async () => []);
  t.mock.method(prisma.workHourAdjustmentRequest, "groupBy", async () => []);
  t.mock.method(prisma, "$transaction", async (queries: Promise<unknown>[]) => Promise.all(queries));
  t.mock.method(workHourReadData, "capturedHours", async () => new Map());
  const result = await listOperationalWorkHours(scope().actor, { startDate: "2026-09-01", endDate: "2026-09-06", employeeId: "outside", collaborator: "x" }, ["agent"]);
  assert.ok(!("error" in result));
  assert.equal(checked, true);
});

test("answering transferred hours writes the original record and exactly one original audit; retry cannot duplicate", async (t) => {
  const date = new Date("2026-09-01"), audits: any[] = [];
  const record: any = { id: "hour", employeeId: "agent", supervisorId: "sup", date, status: "PENDING", justification: null,
    employee: employee("agent", "new-supervisor"), schedule: { status: "PRESENTE" }, answeredAt: null };
  t.mock.method(prisma.user, "findFirst", async () => ({ id: "u", name: "Test", status: "ACTIVE", role: { name: "SUPERVISOR" }, employeeProfile: { id: "sup" } }));
  t.mock.method(prisma.attendanceRecord, "groupBy", async () => []);
  t.mock.method(prisma, "$queryRaw", async () => [{ ...record, kind: "hours", pending: record.status === "PENDING" }]);
  t.mock.method(prisma.workHourAdherenceJustification, "findUnique", async () => record);
  t.mock.method(prisma.workHourAdherenceJustification, "update", async ({ data }: any) => Object.assign(record, data));
  t.mock.method(prisma.workHourRecord, "findUnique", async () => ({ id: "original-hours" }));
  t.mock.method(prisma.notification, "updateMany", async () => ({ count: 1 }));
  t.mock.method(prisma.auditLog, "create", async ({ data }: any) => { audits.push(data); return data; });
  t.mock.method(prisma, "$transaction", (async (fn: any) => fn(prisma)) as any);
  const result = await respondSpacePending(scope({ employees: [], employeeIds: [], profiles: [record.employee] }), "hours", "hour", { justification: "Ocorrência resolvida" });
  assert.equal(result.data.pending, false); assert.equal(record.justification, "Ocorrência resolvida");
  assert.equal(record.supervisorId, "sup"); assert.equal(audits.length, 1); assert.equal(audits[0].entity, "WorkHourAdherenceJustification");
  await assert.rejects(() => respondSpacePending(scope(), "hours", "hour", { justification: "Repetida" }), /já foi respondida/);
  assert.equal(audits.length, 1);
});

test("absence answer reuses attendance classification and its original histories, without touching recorded hours", async (t) => {
  const date = new Date("2026-09-01"), audits: any[] = [], history: any[] = [], scheduleHistory: any[] = [];
  const shift = { id: "morning", name: "Manhã" };
  const partner = { ...employee(), shift };
  const schedule: any = { id: "absence", employeeId: "agent", date, status: "FALTA", deletedAt: null, shift, employee: partner };
  const record: any = { id: "attendance", employeeId: "agent", scheduleId: "absence", date, status: "FALTA", isJustified: false, absenceReason: null,
    updatedAt: date, registeredAt: date, justifiedAt: null };
  t.mock.method(prisma.user, "findUnique", async () => ({ id: "u", name: "Test", status: "ACTIVE", role: { name: "SUPERVISOR" }, employeeProfile: { id: "sup", wbLogin: "test" } }));
  t.mock.method(prisma.user, "findMany", async () => []);
  t.mock.method(prisma.employeeProfile, "findFirst", async () => partner);
  t.mock.method(prisma.schedule, "findFirst", async () => schedule);
  t.mock.method(prisma.schedule, "update", async ({ data }: any) => Object.assign(schedule, data));
  t.mock.method(prisma.attendanceRecord, "groupBy", async () => []);
  t.mock.method(prisma.attendanceRecord, "findFirst", async () => record);
  t.mock.method(prisma.attendanceRecord, "findUnique", async () => record);
  t.mock.method(prisma.attendanceRecord, "update", async ({ data }: any) => Object.assign(record, data));
  t.mock.method(prisma.attendanceHistory, "create", async ({ data }: any) => { history.push(data); return data; });
  t.mock.method(prisma.scheduleChangeHistory, "create", async ({ data }: any) => { scheduleHistory.push(data); return data; });
  t.mock.method(prisma.auditLog, "create", async ({ data }: any) => { audits.push(data); return data; });
  t.mock.method(prisma, "$transaction", (async (fn: any) => fn(prisma)) as any);
  t.mock.method(prisma, "$queryRaw", async () => [{ ...record, id: schedule.id, status: schedule.status, kind: "absence", pending: !record.isJustified, answeredAt: record.justifiedAt }]);
  const result = await respondSpacePending(scope(), "absence", "absence", { justification: "Motivo informado pelo parceiro", reason: "Não informado", reasonCategory: "Operacional" });
  assert.equal(result.data.pending, false); assert.equal(schedule.status, "FALTA_INJUSTIFICADA");
  assert.equal(record.isJustified, true); assert.equal(history.length, 1); assert.equal(scheduleHistory.length, 1); assert.equal(audits.length, 1);
  assert.equal(history[0].attendanceRecordId, "attendance"); assert.equal(audits[0].entity, "AttendanceRecord");
});
