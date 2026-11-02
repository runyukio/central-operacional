import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prisma } from "./prisma";
import { mockPrismaDelegate } from "./prisma-test-delegate";
import { createOperationalRequest, getOperationalRequest, listOperationalRequests, updateOperationalRequestStatus } from "./request-service";
import type { Actor } from "./mock-db";

function setup(t: TestContext, role: Actor["role"] = "WFM", type = "WFM", status = "ABERTO") {
  const actor: Actor = { email: "reviewer@example.test", name: "Reviewer", role };
  const user = { id: "reviewer", ...actor, status: "ACTIVE", role: { name: role }, employeeProfile: { id: "employee", deletedAt: null, supervisorId: "supervisor" } };
  const request = {
    id: "request", code: "REQ-3144", title: "WFM", description: "Request", type: { name: type }, typeId: "type",
    requesterId: "requester", requester: { id: "requester", name: "Requester", email: "requester@example.test" },
    status, priority: "MEDIA", assignedArea: "WFM", assignee: null, employeeId: "employee",
    employee: { wbLogin: "wb_test", supervisor: { fullName: "Supervisor" }, lob: { name: "ADS" } },
    payload: {}, history: [], comments: [], createdAt: new Date(), updatedAt: new Date()
  };
  const users = mockPrismaDelegate(t, "user", { findUnique: async () => user, findMany: async () => [{ id: "wfm-user" }, { id: "admin-user" }] });
  const requests = mockPrismaDelegate(t, "request", {
    findFirst: async () => request, findMany: async () => [request], count: async () => 1,
    groupBy: async () => [{ status, _count: { _all: 1 } }]
  });
  const profiles = mockPrismaDelegate(t, "employeeProfile", { findMany: async () => [], findUnique: async () => ({ user: { id: "supervisor-user" } }) });
  const notifications = mockPrismaDelegate(t, "notification", { create: async () => ({}) });
  mockPrismaDelegate(t, "requestType", { findUnique: async () => ({ id: "type" }) });
  const tx = {
    $queryRaw: async () => [{ nextNumber: "10001" }],
    request: {
      findUnique: async () => request,
      create: t.mock.fn(async ({ data }: any) => ({ ...request, ...data, code: "REQ-10001", history: [], comments: [] })),
      updateMany: t.mock.fn(async () => ({ count: 1 })),
      update: t.mock.fn(async ({ data }: any) => ({ ...request, status: data.status, history: [{ ...data.history.create, createdAt: new Date(), actor: user }], comments: [] }))
    },
    auditLog: { create: t.mock.fn(async () => ({})) }
  };
  const original = prisma.$transaction;
  prisma.$transaction = (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as unknown as typeof prisma.$transaction;
  t.after(() => { prisma.$transaction = original; });
  return { actor, tx, requests, profiles, users, notifications, request };
}

for (const role of ["WFM", "ADMIN"] as const) {
  for (const status of ["Aprovado", "Recusado"] as const) {
    test(`${role} can decide an open generic WFM request directly: ${status}`, async (t) => {
      const { actor, tx } = setup(t, role);
      const result = await updateOperationalRequestStatus(actor, "REQ-3144", status, "Reviewed");
      assert.ok(result && typeof result === "object" && "data" in result, JSON.stringify(result));
      assert.equal(result.data.status, status);
      assert.equal(result.scheduleUpdated, false);
      assert.equal(tx.request.update.mock.calls[0].arguments[0].data.status, status === "Aprovado" ? "APROVADO" : "RECUSADO");
      assert.equal(tx.request.update.mock.calls[0].arguments[0].data.history.create.action, status === "Aprovado" ? "Aprovação final WFM" : role === "ADMIN" ? "Recusa administrativa" : "Recusa WFM");
    });
  }
}

for (const role of ["SUPERVISOR", "GESTOR", "COLABORADOR"] as const) {
  test(`${role} cannot approve, refuse or forward generic WFM requests`, async (t) => {
    const { actor, tx } = setup(t, role);
    for (const status of ["Aprovado", "Recusado", "Em análise"] as const) {
      assert.equal(await updateOperationalRequestStatus(actor, "REQ-3144", status, "Reviewed"), "FORBIDDEN");
    }
    assert.equal(tx.request.update.mock.callCount(), 0);
  });
}

test("WFM creation routes notifications to WFM/Admin and shows the WFM owner immediately", async (t) => {
  const { actor, tx, profiles, users, notifications } = setup(t, "COLABORADOR");
  const result = await createOperationalRequest(actor, { type: "WFM", title: "WFM", description: "Please review", priority: "Média" });
  assert.ok("data" in result, JSON.stringify(result));
  assert.equal(result.data.status, "Aberto");
  assert.equal(result.data.nextOwner, "WFM");
  assert.equal(result.data.nextStep, "Análise WFM");
  assert.equal(result.data.canSupervisorStep, false);
  assert.equal(tx.request.create.mock.callCount(), 1);
  assert.equal(profiles.findUnique.mock.callCount(), 0);
  assert.deepEqual(users.findMany.mock.calls[0].arguments[0].where.role.name.in, ["ADMIN", "WFM"]);
  assert.deepEqual(notifications.create.mock.calls.map(call => call.arguments[0].data.userId), ["wfm-user", "admin-user", "reviewer"]);
});

test("existing open WFM requests show WFM responsibility and final permissions", async (t) => {
  const { actor } = setup(t);
  const detail = await getOperationalRequest(actor, "REQ-3144");
  assert.equal(detail?.nextOwner, "WFM");
  assert.equal(detail?.nextStep, "Análise WFM");
  assert.equal(detail?.canSupervisorStep, false);
  assert.equal(detail?.canWfmFinal, true);
});

test("WFM cannot decide other open request types before supervisor approval", async (t) => {
  const { actor, tx } = setup(t, "WFM", "Troca de Turno");
  for (const status of ["Aprovado", "Recusado"] as const) {
    const result = await updateOperationalRequestStatus(actor, "REQ-TEST", status, "Reviewed");
    assert.ok(result && typeof result === "object" && "error" in result);
    assert.match(result.error ?? "", /supervisor/);
  }
  assert.equal(tx.request.update.mock.callCount(), 0);
  assert.equal((await getOperationalRequest(actor, "REQ-TEST"))?.nextOwner, "Supervisor");
});

// Evaluate the generated filters against representative rows; no database writes.
function matches(where: any, row: { status: string; type: string }): boolean {
  if (where.AND && !where.AND.every((part: any) => matches(part, row))) return false;
  if (where.OR && !where.OR.some((part: any) => matches(part, row))) return false;
  if (where.NOT && matches(where.NOT, row)) return false;
  if (typeof where.status === "string" && where.status !== row.status) return false;
  if (where.status?.in && !where.status.in.includes(row.status)) return false;
  const name = where.type?.name;
  if (typeof name === "string" && name !== row.type) return false;
  if (name?.equals && name.equals.toLowerCase() !== row.type.toLowerCase()) return false;
  if (name?.not && name.not === row.type) return false;
  return true;
}

for (const filters of [{ pendingAction: true }, { assignedTo: "WFM" }]) {
  test(`WFM queue includes existing open WFM requests: ${JSON.stringify(filters)}`, async (t) => {
    const { actor, requests } = setup(t);
    await listOperationalRequests(actor, filters);
    const where = requests.findMany.mock.calls[0].arguments[0].where;
    assert.equal(matches(where, { type: "WFM", status: "ABERTO" }), true);
    assert.equal(matches(where, { type: "Troca de Turno", status: "ABERTO" }), false);
    assert.equal(matches(where, { type: "Troca de Turno", status: "EM_ANALISE" }), true);
    assert.equal(matches(where, { type: "WFM", status: "APROVADO" }), "pendingAction" in filters);
  });
}

test("supervisor responsibility filter excludes open WFM requests", async (t) => {
  const { actor, requests } = setup(t, "ADMIN");
  await listOperationalRequests(actor, { assignedTo: "Supervisor" });
  const where = requests.findMany.mock.calls[0].arguments[0].where;
  assert.equal(matches(where, { type: "WFM", status: "ABERTO" }), false);
  assert.equal(matches(where, { type: "Troca de Turno", status: "ABERTO" }), true);
});


for (const status of ["APROVADO", "CONCLUIDO", "CANCELADO", "RECUSADO"]) {
  test(`ADMIN cannot refuse a generic WFM request after final approval or closure: ${status}`, async t => {
    const { actor, tx } = setup(t, "ADMIN", "WFM", status);
    const detail = await getOperationalRequest(actor, "REQ-3144");
    assert.equal(detail?.canReject, false);
    const result = await updateOperationalRequestStatus(actor, "REQ-3144", "Recusado", "Motivo");
    assert.ok(result && typeof result === "object" && "error" in result);
    assert.equal(tx.request.update.mock.callCount(), 0);
  });
}

test("ADMIN cannot refuse a pending request with an already applied schedule", async t => {
  const { actor, tx, request } = setup(t, "ADMIN", "WFM", "EM_ANALISE");
  Object.assign(request.payload, { scheduleApplicationStatus: "APPLIED" });
  assert.equal((await getOperationalRequest(actor, request.code))?.canReject, false);
  const result = await updateOperationalRequestStatus(actor, request.code, "Recusado", "Motivo");
  assert.ok(result && typeof result === "object" && "error" in result);
  assert.equal(tx.request.update.mock.callCount(), 0);
});
