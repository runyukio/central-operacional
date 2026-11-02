import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prisma } from "./prisma";
import { mockPrismaDelegate } from "./prisma-test-delegate";
import { getOperationalRequest, listOperationalRequests, updateOperationalRequestStatus } from "./request-service";

const actor = { email: "admin@test.invalid", name: "Admin", role: "ADMIN" as const };
const receivedAt = new Date("2026-10-26T15:00:00-03:00");
function row(i = 0) {
  return {
    id: `id-${i}`, code: `REQ-${1000 + i}`, title: "Revisão", description: "Revisar escala", status: "APROVADO",
    priority: "MEDIA", type: { name: "Troca Casada" }, requesterId: "requester", requester: { name: "João", email: "joao@test.invalid" },
    assignedArea: "WFM", assignee: null, employee: { wbLogin: `wb_${i}`, lob: { name: "ADS" }, supervisor: { fullName: "Jéssica" } },
    payload: { stage: "DONE", scheduleApplicationStatus: "APPLIED" },
    history: [{ createdAt: receivedAt, from: "ABERTO", to: "EM_ANALISE", actor: { name: "Jéssica" }, action: "Aprovação do supervisor" }],
    comments: [], createdAt: new Date(+receivedAt - (i + 1) * 60_000), updatedAt: new Date()
  };
}
function setup(t: TestContext, rows: Array<Omit<ReturnType<typeof row>, "payload"> & { payload: Record<string, unknown> }> = [row()]) {
  const user = { id: "admin", ...actor, role: { name: "ADMIN" }, status: "ACTIVE", employeeProfile: null };
  mockPrismaDelegate(t, "user", { findUnique: async () => user });
  mockPrismaDelegate(t, "employeeProfile", { findMany: async () => [] });
  const requests = mockPrismaDelegate(t, "request", {
    findMany: async ({ where }) => where.id?.in ? rows.filter(r => where.id.in.includes(r.id)) : rows,
    findFirst: async () => rows[0]
  });
  return { user, requests };
}

test("service derives global SLA indicators before pagination and hydrates only the 50 displayed rows", async t => {
  const { requests } = setup(t, Array.from({ length: 125 }, (_, i) => row(i)));
  const result = await listOperationalRequests(actor, { status: "Aprovado", deadline: "OVERDUE", limit: 50, page: 2 });
  assert.equal(result.total, 125);
  assert.equal(result.data.length, 50);
  assert.equal(result.summary.awaitingCompletion, 125);
  assert.equal(result.summary.overdue, 125);
  assert.equal(result.summary.oldestPending?.id, "REQ-1124");
  assert.equal(result.data[0].sla?.receivedAt, receivedAt.toISOString());
  assert.equal(result.data[0].nextOwner, "WFM/Admin");
  const projection = requests.findMany.mock.calls[0].arguments[0].select;
  assert.equal(projection.history.take, undefined);
  assert.deepEqual(projection.requester.select, { name: true, email: true });
  assert.equal(requests.findMany.mock.calls[1].arguments[0].where.id.in.length, 50);
});

test("service unified search finds next-owner labels, while legacy filters and access scope remain in both reads", async t => {
  const { requests } = setup(t);
  const result = await listOperationalRequests(actor, { search: "wfm/admin", scope: "mine", lob: "ADS", supervisorId: "supervisor", requester: "João", wbLogin: "wb_0" });
  assert.equal(result.total, 1);
  for (const call of requests.findMany.mock.calls) {
    const where = call.arguments[0].where;
    assert.equal(where.AND[0].OR[0].requesterId, "admin");
    assert.ok(where.AND.some((part: any) => part.employee?.wbLogin?.contains === "wb_0"));
    assert.ok(where.AND.some((part: any) => part.employee?.lob?.name?.equals === "ADS"));
    assert.ok(where.AND.some((part: any) => part.OR?.some((choice: any) => choice.employee?.supervisorId === "supervisor")));
  }
});

test("detail and list use the same complete timing history", async t => {
  const record = row();
  record.history.push(...Array.from({ length: 40 }, (_, i) => ({ ...record.history[0], createdAt: new Date(+receivedAt + (i + 1) * 60_000), from: "EM_ANALISE" })));
  setup(t, [record]);
  const list = await listOperationalRequests(actor);
  const detail = await getOperationalRequest(actor, record.code);
  assert.equal(detail?.sla?.receivedAt, list.data[0].sla?.receivedAt);
  assert.equal(detail?.sla?.dueAt, list.data[0].sla?.dueAt);
  assert.equal(detail?.nextStep, "Aguardando conclusão");
});

for (const failHistory of [false, true]) {
  test(`supervisor forwarding records status and timing in one transaction; history failure=${failHistory}`, async t => {
    const record = { ...row(), type: { name: "Troca de Turno" }, status: "ABERTO", payload: {}, history: [] as any[] };
    const { user } = setup(t, [record]);
    mockPrismaDelegate(t, "request", { findFirst: async () => structuredClone(record), findUniqueOrThrow: async () => record });
    mockPrismaDelegate(t, "auditLog", { create: async () => ({}) });
    mockPrismaDelegate(t, "notification", { create: async () => ({}) });
    const outsideHistory = mockPrismaDelegate(t, "requestHistory", { create: async () => { throw new Error("Must be transactional"); } });
    const events: string[] = [];
    const tx = {
      request: { updateMany: async ({ data }: any) => { events.push("status"); record.status = data.status; return { count: 1 }; } },
      requestHistory: { create: async ({ data }: any) => {
        events.push("history");
        if (failHistory) throw new Error("Timing history unavailable");
        record.history.push({ ...data, actor: user });
      } }
    };
    const original = prisma.$transaction;
    prisma.$transaction = (async (callback: any) => {
      events.push("begin");
      try { const result = await callback(tx); events.push("commit"); return result; }
      catch (error) { record.status = "ABERTO"; record.history = []; events.push("rollback"); throw error; }
    }) as typeof prisma.$transaction;
    t.after(() => { prisma.$transaction = original; });
    const result = await updateOperationalRequestStatus({ ...actor, role: "SUPERVISOR" }, record.code, "Aprovado", "Encaminhado");
    assert.equal(outsideHistory.create.mock.callCount(), 0);
    assert.deepEqual(events, ["begin", "status", "history", failHistory ? "rollback" : "commit"]);
    if (failHistory) {
      assert.equal(record.status, "ABERTO");
      assert.ok(result && typeof result === "object" && "error" in result);
    } else {
      assert.equal(record.status, "EM_ANALISE");
      assert.ok(result && typeof result === "object" && "data" in result);
      assert.ok(result.data.sla?.receivedAt);
    }
  });
}
