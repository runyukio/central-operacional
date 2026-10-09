import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prisma } from "./prisma";
import { mockPrismaDelegate } from "./prisma-test-delegate";
import { createPairedSwap, updatePairedSwap, validatePairedDates, listPairedSwapPartners, PAIRED_SWAP_KIND } from "./paired-day-off-service";
import { createOperationalRequest, getOperationalRequest, listOperationalRequests, type CreateRequestInput } from "./request-service";

const requesterActor = { email: "requester@test.invalid", name: "Ana", role: "COLABORADOR" as const };
const partnerActor = { email: "partner@test.invalid", name: "Bia", role: "COLABORADOR" as const };
const supervisorActor = { email: "supervisor@test.invalid", name: "Supervisor", role: "SUPERVISOR" as const };
const wfmActor = { email: "wfm@test.invalid", name: "WFM", role: "WFM" as const };
const current = "2099-10-10", desired = "2099-10-12";
const input: CreateRequestInput = { type: "Troca Casada", title: "Troca Casada", description: "Compromisso", justification: "Compromisso", priority: "Média" as const,
  dayOffKind: PAIRED_SWAP_KIND, partnerEmployeeId: "partner", acknowledgement: true, currentDayOffDate: current, desiredDayOffDate: desired };

function fixture(t: TestContext) {
  const profile = (id: string, name: string) => ({ id, fullName: name, wbLogin: id, userId: `${id}-user`, deletedAt: null, terminationDate: null,
    roleTitle: "Agente", operationalStatus: "Ativo", lobId: "ads", shiftId: "night", supervisorId: "supervisor", shift: { name: "Noite" }, lob: { name: "ADS" }, user: { id: `${id}-user`, status: "ACTIVE" } });
  const profiles = [profile("requester", "Ana"), profile("partner", "Bia")];
  const schedule = (id: string, employeeId: string, date: string, off: boolean, startsAt: string) => ({ id, employeeId, date: new Date(`${date}T00:00:00Z`),
    status: off ? "FOLGA" : "ESCALADO", startsAt: off ? null : startsAt, endsAt: off ? null : "08:00", shiftId: "night", lobId: "ads", supervisorId: "supervisor", deletedAt: null, updatedAt: new Date("2099-10-01T00:00:00Z") });
  const state = {
    request: null as any,
    schedules: [schedule("a1", "requester", current, true, ""), schedule("a2", "requester", desired, false, "23:00"), schedule("b1", "partner", current, false, "22:00"), schedule("b2", "partner", desired, true, "")],
    histories: [] as any[], audits: [] as any[], notifications: [] as any[], pending: [] as any[], casFailure: ""
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
      update: async ({ data }: any) => { state.request = withIncludes({ ...state.request, ...data }); return structuredClone(state.request); }
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
  for (const date of ["bad", "2099-99-10", "2099-02-30", "2099-10-01", "2099-09-30"]) {
    assert.throws(() => validatePairedDates(date, desired, "2099-10-01"));
  }
  assert.throws(() => validatePairedDates(current, current, "2099-10-01"), /diferentes/);
  assert.doesNotThrow(() => validatePairedDates(current, desired, "2099-10-01"));
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
