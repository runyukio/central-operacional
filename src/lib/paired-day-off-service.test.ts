import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prisma } from "./prisma";
import { mockPrismaDelegate } from "./prisma-test-delegate";
import { createPairedSwap, updatePairedSwap, validatePairedDates, listPairedSwapPartners, PAIRED_SWAP_KIND } from "./paired-day-off-service";
import { createOperationalRequest, getOperationalRequest, listOperationalRequests, updateOperationalRequestStatus, type CreateRequestInput } from "./request-service";

const requesterActor = { email: "requester@test.invalid", name: "Ana", role: "COLABORADOR" as const };
const partnerActor = { email: "partner@test.invalid", name: "Bia", role: "COLABORADOR" as const };
const supervisorActor = { email: "supervisor@test.invalid", name: "Supervisor", role: "SUPERVISOR" as const };
const wfmActor = { email: "wfm@test.invalid", name: "WFM", role: "WFM" as const };
const adminActor = { email: "admin@test.invalid", name: "Admin", role: "ADMIN" as const };
const current = "2026-11-10", desired = "2026-11-12";
const input: CreateRequestInput = { type: "Troca Casada", title: "Troca Casada", description: "Compromisso", justification: "Compromisso", priority: "Média" as const,
  dayOffKind: PAIRED_SWAP_KIND, partnerEmployeeId: "partner", acknowledgement: true, currentDayOffDate: current, desiredDayOffDate: desired };

function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-16T12:00:00Z") });
  const profile = (id: string, name: string) => ({ id, fullName: name, wbLogin: id, userId: `${id}-user`, deletedAt: null, terminationDate: null,
    roleTitle: "Agente", operationalStatus: "Ativo", lobId: "ads", shiftId: "night", supervisorId: "supervisor", shift: { name: "Noite" }, lob: { name: "ADS" }, user: { id: `${id}-user`, status: "ACTIVE" } });
  const profiles = [profile("requester", "Ana"), profile("partner", "Bia")];
  const schedule = (id: string, employeeId: string, date: string, off: boolean, startsAt: string) => ({ id, employeeId, date: new Date(`${date}T00:00:00Z`),
    status: off ? "FOLGA" : "ESCALADO", startsAt: off ? null : startsAt, endsAt: off ? null : "08:00", shiftId: "night", lobId: "ads", supervisorId: "supervisor", deletedAt: null, updatedAt: new Date("2099-10-01T00:00:00Z") });
  const state = {
    request: null as any,
    schedules: [schedule("a1", "requester", current, true, ""), schedule("a2", "requester", desired, false, "23:00"), schedule("b1", "partner", current, false, "22:00"), schedule("b2", "partner", desired, true, "")],
    histories: [] as any[], requestHistories: [] as any[], audits: [] as any[], notifications: [] as any[], pending: [] as any[], casFailure: ""
  };
  const withIncludes = (request: any) => ({ ...request, type: { name: "Troca Casada" }, employee: { ...profiles[0], supervisor: { fullName: "Supervisor", userId: "supervisor-user" } },
    requester: { id: "requester-user", name: "Ana", email: requesterActor.email }, assignee: null,
    comments: [], history: [], createdAt: new Date(), updatedAt: new Date(), deletedAt: null });
  const tx = {
    $queryRaw: async (query: any) => (Array.isArray(query) ? query.join("?") : query.sql).includes("nextNumber") ? [{ nextNumber: "10001" }] : [],
    employeeProfile: { findMany: async () => profiles, findUnique: async () => ({ userId: "supervisor-user" }) },
    user: { findMany: async () => [{ id: "wfm-user" }] },
    requestType: { findUnique: async () => ({ id: "swap-type" }) },
    request: {
      findMany: async () => state.pending,
      create: async ({ data }: any) => { state.request = withIncludes({ ...data, id: "swap" }); return structuredClone(state.request); },
      findUniqueOrThrow: async () => structuredClone(state.request),
      update: async ({ data }: any) => { if (data.history?.create) state.requestHistories.push(structuredClone(data.history.create)); state.request = withIncludes({ ...state.request, ...data }); return structuredClone(state.request); }
    },
    schedule: {
      findMany: async () => structuredClone(state.schedules),
      updateMany: async ({ where, data }: any) => {
        if (where.id === state.casFailure) return { count: 0 };
        const row = state.schedules.find(row => row.id === where.id)!;
        Object.assign(row, data); return { count: 1 };
      }
    },
    scheduleChangeHistory: { create: async ({ data }: any) => { state.histories.push(data); return data; } },
    auditLog: { create: async ({ data }: any) => { state.audits.push(data); return data; } },
    notification: { create: async ({ data }: any) => { state.notifications.push(data); return data; } }
  };
  const original = prisma.$transaction;
  prisma.$transaction = (async (callback: any) => {
    const before = structuredClone(state);
    try { return await callback(tx); } catch (error) { Object.assign(state, before); throw error; }
  }) as typeof prisma.$transaction;
  t.after(() => { prisma.$transaction = original; });
  return { state, profiles, tx };
}

test("two acceptances, responsible supervisor and WFM precede atomic schedule transfer", async t => {
  const { state } = fixture(t);
  state.schedules[0].shiftId = "off"; state.schedules[0].lobId = "old-lob";
  state.schedules[3].shiftId = "off"; state.schedules[3].lobId = "old-lob";
  const original = structuredClone(state.schedules);
  await createPairedSwap("requester-user", input);
  assert.deepEqual(state.schedules, original);
  assert.equal(state.request.payload.stage, "PARTNER");
  assert.ok(state.request.payload.requesterAcceptedAt);
  assert.equal(state.request.payload.partnerAcceptedAt, null);
  state.request.payload.snapshots = state.request.payload.snapshots.map((row: any) => Object.fromEntries(Object.entries(row).reverse()));
  assert.deepEqual(state.notifications.map(row => row.userId), ["requester-user", "partner-user"]);
  for (const [actor, id] of [[requesterActor, "requester-user"], [supervisorActor, "supervisor-user"], [wfmActor, "wfm-user"]] as const) {
    await assert.rejects(updatePairedSwap(actor, id, "swap", "Aprovado"), /Sem permissão/);
  }
  await updatePairedSwap(partnerActor, "partner-user", "swap", "Aprovado");
  assert.ok(state.request.payload.partnerAcceptedAt);
  assert.equal(state.request.payload.stage, "SUPERVISOR");
  assert.deepEqual(state.schedules, original);
  await assert.rejects(updatePairedSwap(supervisorActor, "unrelated-supervisor", "swap", "Aprovado"), /Sem permissão/);
  await assert.rejects(updatePairedSwap(wfmActor, "wfm-user", "swap", "Aprovado"), /Sem permissão/);
  await updatePairedSwap(supervisorActor, "supervisor-user", "swap", "Aprovado");
  assert.equal(state.request.status, "EM_ANALISE");
  assert.equal(state.request.payload.stage, "WFM");
  assert.deepEqual(state.schedules, original);
  const result = await updatePairedSwap(wfmActor, "wfm-user", "swap", "Aprovado");
  assert.equal(result.scheduleUpdated, true);
  assert.equal(state.request.status, "APROVADO");
  assert.deepEqual(state.schedules.map(row => [row.status, row.startsAt, row.endsAt]), [
    ["TROCA_APROVADA", "22:00", "08:00"], ["FOLGA_APROVADA", null, null], ["FOLGA_APROVADA", null, null], ["TROCA_APROVADA", "23:00", "08:00"]
  ]);
  assert.deepEqual([state.schedules[0], state.schedules[3]].map(row => [row.shiftId, row.lobId]), [["night", "ads"], ["night", "ads"]]);
  assert.equal(state.histories.length, 4);
  assert.equal(state.audits.filter(row => row.entity === "Schedule").length, 4);
  await assert.rejects(updatePairedSwap(wfmActor, "wfm-user", "swap", "Aprovado"), /encerrada/);
});

test("admin sees and executes final approval through the request service after both acceptances and supervisor approval", async t => {
  const { state } = fixture(t);
  await createPairedSwap("requester-user", input);
  const original = structuredClone(state.schedules);
  mockPrismaDelegate(t, "user", { findUnique: async () => ({ id: "admin-user", name: "Admin", email: adminActor.email, role: { name: "ADMIN" }, status: "ACTIVE", employeeProfile: null }) });
  mockPrismaDelegate(t, "request", { findFirst: async () => state.request, findMany: async () => [state.request], count: async () => 1, groupBy: async () => [] });
  mockPrismaDelegate(t, "employeeProfile", { findMany: async () => [] });
  for (const stage of ["PARTNER", "SUPERVISOR"]) {
    assert.equal(state.request.payload.stage, stage);
    const detail = await getOperationalRequest(adminActor, "swap");
    assert.ok(detail);
    assert.equal(detail.canPartnerAccept, false);
    assert.equal(detail.canSupervisorStep, false);
    assert.equal(detail.canWfmFinal, false);
    await assert.rejects(updatePairedSwap(adminActor, "admin-user", "swap", "Aprovado"), /Sem permissão/);
    assert.deepEqual(state.schedules, original);
    if (stage === "PARTNER") await updatePairedSwap(partnerActor, "partner-user", "swap", "Aprovado");
  }
  await updatePairedSwap(supervisorActor, "supervisor-user", "swap", "Aprovado");
  const detail = await getOperationalRequest(adminActor, "swap");
  assert.ok(detail);
  assert.equal(detail.status, "Em análise");
  assert.equal(detail.canWfmFinal, true);
  assert.equal((await listOperationalRequests(adminActor)).data[0].canWfmFinal, true);
  const result = await updateOperationalRequestStatus(adminActor, "swap", "Aprovado");
  assert.ok(result && result !== "FORBIDDEN" && "data" in result, JSON.stringify(result));
  assert.equal(result.scheduleUpdated, true);
  assert.equal(result.persisted, true);
  assert.equal(result.data.canWfmFinal, false);
  assert.equal(state.request.status, "APROVADO");
  assert.equal(state.request.payload.stage, "DONE");
  assert.equal(state.request.payload.scheduleApplicationStatus, "APPLIED");
  assert.equal(state.request.payload.wfmApprovedById, "admin-user");
  assert.ok(state.request.payload.wfmApprovedAt);
  assert.ok(state.audits.some(row => row.entity === "Request" && row.action === "APROVACAO" && row.actorId === "admin-user"));
  assert.deepEqual(state.schedules.map(row => [row.status, row.startsAt, row.endsAt]), [
    ["TROCA_APROVADA", "22:00", "08:00"], ["FOLGA_APROVADA", null, null], ["FOLGA_APROVADA", null, null], ["TROCA_APROVADA", "23:00", "08:00"]
  ]);
  assert.equal(state.histories.length, 4);
  assert.ok(state.histories.every(row => row.changedById === "admin-user"));
  await assert.rejects(updatePairedSwap(adminActor, "admin-user", "swap", "Aprovado"), /encerrada/);
});

test("admin can reject at the final stage with a reason and without changing schedules", async t => {
  const { state } = fixture(t);
  await createPairedSwap("requester-user", input);
  await updatePairedSwap(partnerActor, "partner-user", "swap", "Aprovado");
  await updatePairedSwap(supervisorActor, "supervisor-user", "swap", "Aprovado");
  const original = structuredClone(state.schedules);
  await assert.rejects(updatePairedSwap(adminActor, "admin-user", "swap", "Recusado"), /motivo/);
  const result = await updatePairedSwap(adminActor, "admin-user", "swap", "Recusado", "Datas indisponíveis");
  assert.equal(result.scheduleUpdated, false);
  assert.equal(state.request.status, "RECUSADO");
  assert.equal(state.request.payload.scheduleApplicationStatus, "NOT_APPLIED");
  assert.deepEqual(state.schedules, original);
  assert.equal(state.histories.length, 0);
});

for (const actor of [adminActor, wfmActor]) {
  test(`${actor.role} can conclude an applied swap through the request service without reapplying schedules`, async t => {
    const { state, tx } = fixture(t);
    await createPairedSwap("requester-user", input);
    await updatePairedSwap(partnerActor, "partner-user", "swap", "Aprovado");
    await updatePairedSwap(supervisorActor, "supervisor-user", "swap", "Aprovado");
    await updatePairedSwap(actor, "final-user", "swap", "Aprovado");
    mockPrismaDelegate(t, "user", { findUnique: async () => ({ id: "final-user", name: actor.name, email: actor.email, role: { name: actor.role }, status: "ACTIVE", employeeProfile: null }) });
    mockPrismaDelegate(t, "request", { findFirst: async () => state.request, findMany: async () => [state.request], count: async () => 1, groupBy: async () => [] });
    mockPrismaDelegate(t, "employeeProfile", { findMany: async () => [] });
    const detail = await getOperationalRequest(actor, "swap");
    assert.ok(detail);
    assert.equal(detail.canWfmFinal, false);
    assert.equal(detail.canConclude, true);
    assert.equal((await listOperationalRequests(actor)).data[0].canConclude, true);
    const appliedSchedules = structuredClone(state.schedules);
    const appliedPayload = structuredClone(state.request.payload);
    const scheduleHistoryCount = state.histories.length;
    const scheduleAuditCount = state.audits.filter(row => row.entity === "Schedule").length;
    // Administrative closure must also work after the exchanged dates have passed.
    t.mock.timers.tick(40 * 24 * 60 * 60 * 1000);
    tx.schedule.findMany = async () => { throw new Error("Closure must not reload schedules"); };
    tx.employeeProfile.findUnique = async () => { throw new Error("Closure must not resolve today's supervisor"); };
    const result = await updateOperationalRequestStatus(actor, "swap", "Concluído", "Conferido");
    assert.ok(result && result !== "FORBIDDEN" && "data" in result, JSON.stringify(result));
    assert.equal(result.data.status, "Concluído");
    assert.equal(result.data.canConclude, false);
    assert.equal(result.scheduleUpdated, false);
    assert.equal(result.persisted, true);
    assert.equal(state.request.status, "CONCLUIDO");
    assert.deepEqual(state.request.payload, appliedPayload);
    assert.deepEqual(state.schedules, appliedSchedules);
    assert.equal(state.histories.length, scheduleHistoryCount);
    assert.equal(state.audits.filter(row => row.entity === "Schedule").length, scheduleAuditCount);
    assert.equal(state.requestHistories.at(-1).actorId, "final-user");
    assert.equal(state.requestHistories.at(-1).from, "APROVADO");
    assert.equal(state.requestHistories.at(-1).to, "CONCLUIDO");
    assert.equal(state.requestHistories.at(-1).reason, "Conferido");
    assert.ok(state.audits.some(row => row.entity === "Request" && row.action === "EDICAO" && row.actorId === "final-user" && row.newValue.status === "CONCLUIDO"));
    await assert.rejects(updatePairedSwap(actor, "final-user", "swap", "Concluído"), /encerrada/);
    assert.deepEqual(state.schedules, appliedSchedules);
  });
}

test("closure requires an approved and applied swap and cannot bypass earlier stages or actor permissions", async t => {
  const { state } = fixture(t);
  await createPairedSwap("requester-user", input);
  for (const stage of ["PARTNER", "SUPERVISOR", "WFM"]) {
    state.request.payload.stage = stage;
    await assert.rejects(updatePairedSwap(adminActor, "admin-user", "swap", "Concluído"));
  }
  state.request.status = "APROVADO";
  state.request.payload.stage = "DONE";
  for (const application of ["PENDING", "NOT_APPLIED", undefined]) {
    state.request.payload.scheduleApplicationStatus = application;
    await assert.rejects(updatePairedSwap(adminActor, "admin-user", "swap", "Concluído"));
    assert.equal(state.request.status, "APROVADO");
  }
  state.request.payload.scheduleApplicationStatus = "APPLIED";
  const original = structuredClone(state.schedules);
  for (const actor of [requesterActor, partnerActor, supervisorActor, { ...adminActor, role: "GESTOR" as const }]) {
    await assert.rejects(updatePairedSwap(actor, actor.email, "swap", "Concluído"));
    mockPrismaDelegate(t, "user", { findUnique: async () => ({ id: actor === partnerActor ? "partner-user" : "requester-user", name: actor.name, email: actor.email, role: { name: actor.role }, status: "ACTIVE", employeeProfile: null }) });
    mockPrismaDelegate(t, "request", { findFirst: async () => state.request });
    assert.equal((await getOperationalRequest(actor, "swap"))?.canConclude, false);
  }
  assert.equal(state.request.status, "APROVADO");
  assert.deepEqual(state.schedules, original);
  assert.equal(state.histories.length, 0);
});

test("admin final approval preserves required acceptances, responsible supervisor and schedule validation", async t => {
  const { state } = fixture(t);
  await createPairedSwap("requester-user", input);
  await updatePairedSwap(partnerActor, "partner-user", "swap", "Aprovado");
  await updatePairedSwap(supervisorActor, "supervisor-user", "swap", "Aprovado");
  const payload = structuredClone(state.request.payload);
  const original = structuredClone(state.schedules);
  for (const patch of [{ requesterAcceptedAt: null }, { partnerAcceptedAt: null }, { supervisorApprovedAt: null }, { supervisorApprovedById: "unrelated-supervisor" }]) {
    state.request.payload = { ...payload, ...patch };
    await assert.rejects(updatePairedSwap(adminActor, "admin-user", "swap", "Aprovado"), /dois aceites/);
    assert.deepEqual(state.schedules, original);
  }
  state.request.payload = payload;
  state.schedules[1].startsAt = "23:30";
  await assert.rejects(updatePairedSwap(adminActor, "admin-user", "swap", "Aprovado"), /cronograma mudou/);
  assert.equal(state.request.status, "EM_ANALISE");
  assert.equal(state.histories.length, 0);
});

for (const role of ["COLABORADOR", "SUPERVISOR", "GESTOR"] as const) {
  test(`${role} cannot perform WFM final approval or rejection`, async t => {
    const { state } = fixture(t);
    await createPairedSwap("requester-user", input);
    await updatePairedSwap(partnerActor, "partner-user", "swap", "Aprovado");
    await updatePairedSwap(supervisorActor, "supervisor-user", "swap", "Aprovado");
    const actor = { ...requesterActor, role };
    mockPrismaDelegate(t, "user", { findUnique: async () => ({ id: "requester-user", name: "Ana", email: actor.email, role: { name: role }, status: "ACTIVE", employeeProfile: null }) });
    mockPrismaDelegate(t, "request", { findFirst: async () => state.request });
    const detail = await getOperationalRequest(actor, "swap");
    assert.ok(detail);
    assert.equal(detail.canWfmFinal, false);
    for (const status of ["Aprovado", "Recusado"] as const) {
      await assert.rejects(updatePairedSwap(actor, "requester-user", "swap", status, "Motivo"), /Sem permissão/);
    }
    assert.equal(state.request.status, "EM_ANALISE");
    assert.equal(state.histories.length, 0);
  });
}

test("cross-LOB, cross-shift, self, inactive and reversed days are rejected without creating a request", async t => {
  const { state, profiles } = fixture(t);
  for (const patch of [{ lobId: "cec" }, { shiftId: "morning" }, { operationalStatus: "Desligado" }]) {
    const previous = { ...profiles[1] };
    Object.assign(profiles[1], patch);
    await assert.rejects(createPairedSwap("requester-user", input));
    Object.assign(profiles[1], previous);
    assert.equal(state.request, null);
  }
  await assert.rejects(createPairedSwap("requester-user", { ...input, partnerEmployeeId: "requester" }), /outro parceiro/);
  await assert.rejects(createPairedSwap("requester-user", { ...input, currentDayOffDate: desired, desiredDayOffDate: current }), /Na sua folga/);
  await assert.rejects(createPairedSwap("requester-user", { ...input, acknowledgement: false }), /aceite/);
  assert.equal(state.request, null);
});

test("pending invitation involving either employee prevents a second request on the same dates", async t => {
  const { state } = fixture(t);
  state.pending = [{ payload: { partnerEmployeeId: "requester", currentDayOffDate: current } }];
  await assert.rejects(createPairedSwap("requester-user", input), /solicitação pendente/);
  assert.equal(state.request, null);
});

test("rejection and requester cancellation leave all schedules untouched", async t => {
  const { state } = fixture(t);
  await createPairedSwap("requester-user", input);
  const original = structuredClone(state.schedules);
  await assert.rejects(updatePairedSwap(partnerActor, "partner-user", "swap", "Recusado"), /motivo/);
  await updatePairedSwap(partnerActor, "partner-user", "swap", "Recusado", "Não posso");
  assert.equal(state.request.status, "RECUSADO");
  assert.deepEqual(state.schedules, original);
  await createPairedSwap("requester-user", input);
  await updatePairedSwap(partnerActor, "partner-user", "swap", "Aprovado");
  await updatePairedSwap(supervisorActor, "supervisor-user", "swap", "Aprovado");
  await updatePairedSwap(requesterActor, "requester-user", "swap", "Cancelado");
  assert.equal(state.request.status, "CANCELADO");
  assert.deepEqual(state.schedules, original);
});

test("changed schedule blocks final approval; concurrent write rolls back all four changes and audit", async t => {
  const { state } = fixture(t);
  await createPairedSwap("requester-user", input);
  await updatePairedSwap(partnerActor, "partner-user", "swap", "Aprovado");
  await updatePairedSwap(supervisorActor, "supervisor-user", "swap", "Aprovado");
  state.schedules[1].startsAt = "23:30";
  await assert.rejects(updatePairedSwap(wfmActor, "wfm-user", "swap", "Aprovado"), /cronograma mudou/);
  state.schedules[1].startsAt = "23:00";
  state.casFailure = "b2";
  const before = structuredClone(state);
  await assert.rejects(updatePairedSwap(wfmActor, "wfm-user", "swap", "Aprovado"), /alterado por outra ação/);
  assert.deepEqual(state, before);
});

test("invalid, same, current and past dates fail; future dates preserve the operational date", () => {
  for (const date of ["bad", "2099-99-10", "2099-02-30", "2026-10-16", "2026-10-15"]) {
    assert.throws(() => validatePairedDates(date, desired, "2026-10-16"));
  }
  assert.throws(() => validatePairedDates(current, current, "2026-10-16"), /diferentes/);
  assert.doesNotThrow(() => validatePairedDates(current, desired, "2026-10-16"));
});

test("only same-LOB same-shift active agents appear in the partner selector", async t => {
  const { profiles } = fixture(t);
  mockPrismaDelegate(t, "employeeProfile", { findUnique: async () => profiles[0], findMany: async () => [profiles[1], { ...profiles[1], id: "inactive", operationalStatus: "Inativo" }, { ...profiles[1], id: "staff", roleTitle: "WFM" }] });
  assert.deepEqual((await listPairedSwapPartners("requester-user")).map(row => row.id), ["partner"]);
});

test("request integration exposes invitations to the invited user and disables early approvals", async t => {
  const { state, profiles } = fixture(t);
  await createPairedSwap("requester-user", input);
  const user = { id: "partner-user", name: "Bia", email: partnerActor.email, role: { name: "COLABORADOR" }, status: "ACTIVE", employeeProfile: profiles[1] };
  mockPrismaDelegate(t, "user", { findUnique: async () => user });
  mockPrismaDelegate(t, "request", { findFirst: async () => state.request, count: async () => 1, groupBy: async () => [], findMany: async ({ where }: any) => {
    assert.equal(where.AND[0].OR[1].payload.equals, "partner-user");
    return [state.request];
  } });
  mockPrismaDelegate(t, "employeeProfile", { findMany: async () => [] });
  const detail = await getOperationalRequest(partnerActor, "swap");
  assert.ok(detail);
  assert.equal(detail.canPartnerAccept, true);
  assert.equal(detail.canSupervisorStep, false);
  assert.equal(detail.canWfmFinal, false);
  assert.equal(detail.canCancelPairedSwap, false);
  assert.equal(detail.nextStep, "Aceite do parceiro");
  assert.equal((await listOperationalRequests(partnerActor, { scope: "mine" })).data.length, 1);
});

test("creation API service routes paired requests through the two-person workflow", async t => {
  const { profiles } = fixture(t);
  mockPrismaDelegate(t, "user", { findUnique: async () => ({ id: "requester-user", name: "Ana", email: requesterActor.email, status: "ACTIVE", role: { name: "COLABORADOR" }, employeeProfile: profiles[0] }) });
  const result = await createOperationalRequest(requesterActor, input);
  assert.ok("data" in result, JSON.stringify(result));
  if (!("data" in result)) return;
  assert.equal(result.persisted, true);
  assert.equal(result.data.nextStep, "Aceite do parceiro");
  assert.equal(result.data.canCancelPairedSwap, true);
});

for (const date of ["2026-12-32", "2027-02-29", "bad", ""]) {
  test(`paired swap still rejects invalid dates: ${date}`, async () => {
    await assert.rejects(createPairedSwap("requester-user", { ...input, desiredDayOffDate: date }), /datas válidas/);
    const result = await createOperationalRequest(requesterActor, { ...input, desiredDayOffDate: date });
    assert.ok("error" in result);
    assert.match(result.error ?? "", /datas válidas/);
  });
}

for (const [currentDate, desiredDate] of [["2026-12-10", "2026-12-12"], ["2026-12-31", "2027-01-02"], ["2027-02-10", "2027-02-12"]]) {
  test(`paired swap can be created outside October/November: ${currentDate} to ${desiredDate}`, async t => {
    const { state, profiles } = fixture(t);
    state.schedules.forEach(row => { row.date = new Date(`${row.date.toISOString().slice(0, 10) === current ? currentDate : desiredDate}T00:00:00Z`); });
    mockPrismaDelegate(t, "user", { findUnique: async () => ({ id: "requester-user", name: "Ana", email: requesterActor.email, status: "ACTIVE", role: { name: "COLABORADOR" }, employeeProfile: profiles[0] }) });
    const result = await createOperationalRequest(requesterActor, { ...input, currentDayOffDate: currentDate, desiredDayOffDate: desiredDate });
    assert.ok("data" in result, JSON.stringify(result));
    assert.equal(state.request.payload.currentDayOffDate, currentDate);
    assert.equal(state.request.payload.desiredDayOffDate, desiredDate);
    assert.equal(state.request.payload.stage, "PARTNER");
  });
}
