import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { Prisma } from "@prisma/client";

import {
  createRaffleCampaign,
  deleteRaffleTicket,
  distributeRaffleTickets,
  getCampaignRaffleAccess,
  getCampaignRaffleDashboard
} from "@/lib/campaign-raffle-service";
import type { Actor } from "@/lib/mock-db";
import { prisma } from "@/lib/prisma";

const actor: Actor = { email: "poc@example.test", name: "Test POC", role: "POC" };

function pocUser(lob = "ADS") {
  return {
    id: "poc-user",
    name: actor.name,
    email: actor.email,
    status: "ACTIVE",
    role: { name: "POC" },
    employeeProfile: {
      id: "poc-employee",
      fullName: actor.name,
      wbLogin: "wb_test_poc",
      roleTitle: "Agente",
      operationalStatus: "Ativo",
      deletedAt: null,
      terminationDate: null,
      lob: { name: lob }
    }
  };
}

function mockDatabase(t: TestContext, lob = "ADS") {
  // Prisma delegates are proxies, so replace the methods directly and restore
  // them after each test. No database connection or transaction is used.
  const originalFindUser = prisma.user.findFirst;
  const originalFindTickets = prisma.raffleTicketAssignment.findMany;
  const originalTransaction = prisma.$transaction;
  const userQuery = t.mock.fn(async (_args: Prisma.UserFindFirstArgs) => pocUser(lob));
  const ticketsQuery = t.mock.fn(async (_args: Prisma.RaffleTicketAssignmentFindManyArgs) => []);
  const transaction = t.mock.fn(async () => { throw new Error("Unexpected write"); });
  prisma.user.findFirst = userQuery as unknown as typeof prisma.user.findFirst;
  prisma.raffleTicketAssignment.findMany = ticketsQuery as typeof prisma.raffleTicketAssignment.findMany;
  prisma.$transaction = transaction as typeof prisma.$transaction;
  t.after(() => {
    prisma.user.findFirst = originalFindUser;
    prisma.raffleTicketAssignment.findMany = originalFindTickets;
    prisma.$transaction = originalTransaction;
  });
  return { userQuery, ticketsQuery, transaction };
}

test("Rifa de POC consulta somente os tickets do parceiro autenticado", async (t) => {
  const { userQuery, ticketsQuery } = mockDatabase(t);

  const access = await getCampaignRaffleAccess(actor);
  assert.deepEqual(access, { canViewOwn: true, canManage: false, lob: "ADS", roleTitle: "Agente" });
  const dashboard = await getCampaignRaffleDashboard(actor, "agent", "untrusted-campaign-id");
  assert.equal(dashboard.view, "agent");
  assert.equal(dashboard.access.canManage, false);
  assert.deepEqual(userQuery.mock.calls[0].arguments[0].where, {
    email: { equals: actor.email, mode: "insensitive" }, deletedAt: null
  });
  assert.equal(ticketsQuery.mock.callCount(), 1);
  assert.deepEqual(ticketsQuery.mock.calls[0].arguments[0].where, { employeeId: "poc-employee" });
});

test("POC não pode consultar Staff nem criar, distribuir ou excluir tickets pela API", async (t) => {
  const { transaction } = mockDatabase(t);

  for (const action of [
    () => getCampaignRaffleDashboard(actor, "staff"),
    () => createRaffleCampaign(actor, { name: "Test campaign" }),
    () => distributeRaffleTickets(actor, {
      campaignId: "campaign", employeeIds: ["another-employee"], ticketsPerEmployee: 1,
      idempotencyKey: "test-distribution-key"
    }),
    () => deleteRaffleTicket(actor, { ticketId: "another-ticket" })
  ]) {
    await assert.rejects(action, { name: "CampaignRaffleError", status: 403 });
  }
  assert.equal(transaction.mock.callCount(), 0);
});

test("servidor revalida a LOB de POC e não confia em claims antigos da sessão", async (t) => {
  const { ticketsQuery } = mockDatabase(t, "CEC");
  const staleActor = { ...actor, lob: "ADS", role: "ADMIN" as const };
  assert.equal((await getCampaignRaffleAccess(staleActor)).canViewOwn, false);
  await assert.rejects(() => getCampaignRaffleDashboard(staleActor, "agent"), { status: 403 });
  await assert.rejects(() => getCampaignRaffleDashboard(staleActor, "staff"), { status: 403 });
  assert.equal(ticketsQuery.mock.callCount(), 0);
});
