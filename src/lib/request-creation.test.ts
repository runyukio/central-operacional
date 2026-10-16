import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Prisma } from "@prisma/client";

import { prisma } from "./prisma";
import { mockPrismaDelegate } from "./prisma-test-delegate";
import { createOperationalRequest, type CreateRequestInput } from "./request-service";

const actor = { email: "agent@example.test", name: "Test agent", role: "COLABORADOR" as const };
const inputs: CreateRequestInput[] = [
  {
    type: "Troca de Folga", title: "Troca de Folga", priority: "Média",
    description: "Test request", justification: "Test request", dayOffKind: "DAY_OFF_SWAP",
    currentDayOffDate: "2026-10-20", desiredDayOffDate: "2026-10-21"
  },
  {
    type: "Solicitação de Dia de Folga", title: "Solicitação de Dia de Folga", priority: "Média",
    description: "Test request", justification: "Test request", dayOffKind: "DAY_OFF_REQUEST",
    desiredDayOffRequestDate: "2026-10-21", dayOffReason: "Pessoal"
  },
  {
    type: "Venda de Folga", title: "Venda de Folga", priority: "Média",
    description: "Test request", justification: "Test request", dayOffKind: "DAY_OFF_SELL",
    dayOffToSellDate: "2026-11-10", availabilityShift: "Manhã", acknowledgement: true
  }
];

function mockCreation(t: TestContext, input: CreateRequestInput, duplicate = false) {
  const user = {
    id: "test-user", email: actor.email, name: actor.name, status: "ACTIVE",
    role: { name: "COLABORADOR" },
    employeeProfile: { id: "test-employee", deletedAt: null, supervisorId: null }
  };
  mockPrismaDelegate(t, "user", { findUnique: async () => user, findMany: async () => [] });
  mockPrismaDelegate(t, "requestType", { findUnique: async () => ({ id: "test-type" }) });
  mockPrismaDelegate(t, "schedule", {
    count: async () => 2,
    findUnique: async ({ where }) => ({
      status: where.employeeId_date.date.toISOString().startsWith(input.currentDayOffDate ?? input.dayOffToSellDate ?? "2026-11-10") ? "FOLGA" : "PRESENTE"
    })
  });
  mockPrismaDelegate(t, "request", { findMany: async () => duplicate ? [{ payload: input }] : [] });
  // Coverage enrichment is outside this regression; no live reads or writes.
  mockPrismaDelegate(t, "employeeProfile", { findUnique: async () => null });
  const notification = mockPrismaDelegate(t, "notification", { create: async () => ({}) });
  const events: string[] = [];
  const tx = {
    $queryRaw: async (query: Prisma.Sql | TemplateStringsArray) => {
      const sql = Array.isArray(query) ? query.join("?") : (query as Prisma.Sql).sql;
      if (sql.includes("pg_advisory_xact_lock")) {
        events.push("lock");
        // Prisma 5 rejects PostgreSQL's void return type. Model the real failure
        // at the driver boundary instead of accepting every mocked raw query.
        if (!/pg_advisory_xact_lock\(726391, 1\)::text/.test(sql)) {
          throw new Prisma.PrismaClientKnownRequestError("Failed to deserialize column of type 'void'", {
            code: "P2010", clientVersion: "5.22.0"
          });
        }
        return [{ lock: "" }];
      }
      events.push("allocate");
      return [{ nextNumber: "10001" }];
    },
    request: { create: t.mock.fn(async ({ data }: Prisma.RequestCreateArgs) => {
      events.push("create");
      return {
        ...data, id: "test-request", type: { name: input.type }, requester: user,
        employee: { wbLogin: "wb_test", lob: { name: "ADS" } }, assignee: null,
        comments: [], history: [], createdAt: new Date("2026-09-07T12:00:00Z"), updatedAt: new Date("2026-09-07T12:00:00Z")
      };
    }) },
    auditLog: { create: t.mock.fn(async () => { events.push("audit"); return {}; }) }
  };
  const original = prisma.$transaction;
  prisma.$transaction = (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as unknown as typeof prisma.$transaction;
  t.after(() => { prisma.$transaction = original; });
  return { tx, events, notification };
}

for (const input of inputs) {
  test(`${input.type}: creates request with code, history and audit without changing schedules`, async (t) => {
    const { tx, events, notification } = mockCreation(t, input);
    const result = await createOperationalRequest(actor, input);
    assert.ok("data" in result, JSON.stringify(result));
    if (!("data" in result)) throw new Error("Expected a saved request");
    assert.equal(result.persisted, true);
    assert.equal(result.data.id, "REQ-10001");
    assert.equal(result.data.status, "Aberto");
    assert.equal(result.data.payload.dayOffKind, input.dayOffKind);
    assert.deepEqual(events, ["lock", "allocate", "create", "audit"]);
    const data = tx.request.create.mock.calls[0].arguments[0].data;
    assert.equal(data.requesterId, "test-user");
    assert.equal(data.employeeId, "test-employee");
    assert.deepEqual(data.history, { create: {
      actorId: "test-user", action: "Criação", to: "ABERTO", reason: "Solicitação criada"
    } });
    assert.equal(notification.create.mock.callCount(), 1);
  });

  test(`${input.type}: still rejects a pending duplicate before allocating or writing`, async (t) => {
    const { tx, events, notification } = mockCreation(t, input, true);
    const result = await createOperationalRequest(actor, input);
    assert.ok("error" in result);
    assert.match(result.error ?? "", /Já existe uma solicitação/);
    assert.deepEqual(events, []);
    assert.equal(tx.request.create.mock.callCount(), 0);
    assert.equal(tx.auditLog.create.mock.callCount(), 0);
    assert.equal(notification.create.mock.callCount(), 0);
  });
}

test("não permite solicitação de adiantamento para novembro/2026", async () => {
  const result = await createOperationalRequest(actor, {
    type: "Alteração de Adiantamento",
    title: "Alteração de Adiantamento",
    priority: "Média",
    description: "Alteração solicitada para novembro",
    monthlyAdvanceReferenceMonth: "2026-11",
    requestedAdvanceOptIn: true
  });

  assert.ok("error" in result);
  assert.match(result.error ?? "", /somente até outubro\/2026/);
});

for (const blocked of [
  { type: "Troca de Folga", dayOffKind: "DAY_OFF_SWAP" as const },
  { type: "Solicitação de Dia de Folga", dayOffKind: "DAY_OFF_REQUEST" as const },
  { type: "Suporte geral", dayOffKind: "DAY_OFF_SWAP" as const },
  { type: "Venda de Folga", dayOffKind: "DAY_OFF_SWAP" as const }
]) {
  test(`${blocked.type}/${blocked.dayOffKind}: blocks new requests before any database access`, async () => {
    const result = await createOperationalRequest(actor, { ...inputs[2], ...blocked, currentDayOffDate: "2026-11-10", desiredDayOffDate: "2026-11-11", desiredDayOffRequestDate: "2026-11-11" });
    assert.ok("error" in result);
    assert.match(result.error ?? "", /apenas para datas de outubro|não corresponde/);
  });
}

for (const date of ["2026-09-30", "2026-12-01", "2027-11-10", "2026-11-31", "2026-11-1", ""]) {
  test(`Venda de Folga: rejects target ${date} before any database access`, async () => {
    const result = await createOperationalRequest(actor, { ...inputs[2], dayOffToSellDate: date });
    assert.ok("error" in result);
    assert.match(result.error ?? "", /novembro de 2026/);
  });
}

for (const date of ["2026-10-01", "2026-10-31", "2026-11-01", "2026-11-30"]) {
  test(`Venda de Folga: accepts the October/November boundary ${date}`, async (t) => {
    const input = { ...inputs[2], dayOffToSellDate: date };
    mockCreation(t, input);
    const result = await createOperationalRequest(actor, input);
    assert.ok("data" in result, JSON.stringify(result));
  });
}
