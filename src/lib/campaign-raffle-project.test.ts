import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { Prisma } from "@prisma/client";

import { distributeRaffleTickets, getCampaignRaffleDashboard } from "./campaign-raffle-service";
import { prisma } from "./prisma";
import { mockPrismaDelegate } from "./prisma-test-delegate";

const manager = { email: "manager@example.test", name: "Test manager", role: "WFM" as const };
const eligibleLobQuery = { name: { in: ["ADS", "PROJECT"], mode: "insensitive" } };

function employee(id: string, lob: string, roleTitle = "Agente", operationalStatus = "Ativo") {
  return { id, fullName: id, wbLogin: `wb_${id}`, roleTitle, operationalStatus, lob: { name: lob }, shift: { name: "Manhã" } };
}

function mockManager(t: TestContext) {
  mockPrismaDelegate(t, "user", {
    findFirst: async () => ({
      id: "manager", email: manager.email, name: manager.name, status: "ACTIVE",
      role: { name: "WFM" }, employeeProfile: null
    })
  });
}

test("Staff lists both ADS and PROJECT agents while retaining active-account and agent restrictions", async (t) => {
  mockManager(t);
  mockPrismaDelegate(t, "raffleCampaign", { findMany: async () => [] });
  const employees = mockPrismaDelegate(t, "employeeProfile", { findMany: async () => [
    employee("ads", "ADS"), employee("project", "PROJECT"),
    employee("cec", "CEC"), employee("supervisor", "PROJECT", "Supervisor"),
    employee("terminated", "PROJECT", "Agente", "Desligado")
  ] });
  const dashboard = await getCampaignRaffleDashboard(manager, "staff");
  assert.equal(dashboard.view, "staff");
  if (dashboard.view !== "staff") throw new Error("Expected staff view");
  assert.deepEqual(dashboard.agents.map((row) => row.id), ["ads", "project"]);
  assert.deepEqual(employees.findMany.mock.calls[0].arguments[0].where, {
    deletedAt: null, terminationDate: null, lob: eligibleLobQuery,
    user: { is: { status: "ACTIVE", deletedAt: null } }
  });
});

function mockDistribution(t: TestContext, rows: ReturnType<typeof employee>[]) {
  mockManager(t);
  // This transaction and every database delegate are in-memory only. No live
  // tickets, campaign, audit event or database connection are created.
  const tx = {
    $queryRaw: t.mock.fn(async () => [{ id: "shared-campaign" }]),
    raffleCampaign: { findUnique: t.mock.fn(async () => ({
      id: "shared-campaign", name: "ADS campaign", status: "ACTIVE", minNumber: 1, maxNumber: 10_000
    })) },
    employeeProfile: { findMany: t.mock.fn(async (_query: Prisma.EmployeeProfileFindManyArgs) => rows) },
    raffleDistribution: {
      findUnique: t.mock.fn(async () => null),
      create: t.mock.fn(async () => ({ id: "distribution" }))
    },
    raffleTicketAssignment: {
      findMany: t.mock.fn(async (_query: Prisma.RaffleTicketAssignmentFindManyArgs) => [{ number: 1 }, { number: 2 }]),
      createMany: t.mock.fn(async (_query: Prisma.RaffleTicketAssignmentCreateManyArgs) => ({ count: 4 }))
    },
    auditLog: { create: t.mock.fn(async () => ({})) }
  };
  const original = prisma.$transaction;
  prisma.$transaction = (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as unknown as typeof prisma.$transaction;
  t.after(() => { prisma.$transaction = original; });
  return tx;
}

test("ADS and PROJECT share the same existing campaign and unique ticket pool", async (t) => {
  const tx = mockDistribution(t, [employee("ads", "ADS"), employee("project", "PROJECT")]);
  const result = await distributeRaffleTickets(manager, {
    campaignId: "shared-campaign", employeeIds: ["ads", "project"], ticketsPerEmployee: 2,
    idempotencyKey: "shared-campaign-project-test"
  });
  assert.equal(result.totalTickets, 4);
  assert.equal(result.idempotent, false);
  assert.deepEqual(result.allocations.map((row) => row.employeeId).sort(), ["ads", "project"]);
  assert.ok(result.allocations.every((row) => row.numbers.length === 2));
  const numbers = result.allocations.flatMap((row) => row.numbers);
  assert.equal(new Set(numbers).size, 4);
  assert.ok(numbers.every((number) => number > 2 && number <= 10_000));
  assert.deepEqual(tx.employeeProfile.findMany.mock.calls[0].arguments[0].where, {
    id: { in: ["ads", "project"] }, deletedAt: null, terminationDate: null, lob: eligibleLobQuery,
    user: { is: { status: "ACTIVE", deletedAt: null } }
  });
  assert.deepEqual(tx.raffleTicketAssignment.findMany.mock.calls[0].arguments[0].where, { campaignId: "shared-campaign" });
  assert.equal(tx.$queryRaw.mock.callCount(), 1);
  assert.equal(tx.auditLog.create.mock.callCount(), 1);
  assert.equal(tx.raffleTicketAssignment.createMany.mock.callCount(), 1);
});

test("ineligible recipients reject the whole distribution before any ticket or audit write", async (t) => {
  for (const invalid of [
    employee("other", "CEC"), employee("supervisor", "PROJECT", "Supervisor"),
    employee("terminated", "PROJECT", "Agente", "Desligado")
  ]) {
    await t.test(invalid.id, async (subtest) => {
      const tx = mockDistribution(subtest, [employee("project", "PROJECT"), invalid]);
      await assert.rejects(() => distributeRaffleTickets(manager, {
        campaignId: "shared-campaign", employeeIds: ["project", invalid.id], ticketsPerEmployee: 2,
        idempotencyKey: "invalid-recipient-project-test"
      }), { status: 409 });
      assert.equal(tx.raffleDistribution.create.mock.callCount(), 0);
      assert.equal(tx.raffleTicketAssignment.createMany.mock.callCount(), 0);
      assert.equal(tx.auditLog.create.mock.callCount(), 0);
    });
  }
});
