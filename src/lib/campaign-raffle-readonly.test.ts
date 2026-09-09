import assert from "node:assert/strict";
import test from "node:test";
import { canViewCampaignStaff, canManageCampaignStaff } from "./permissions";
import { canAccessPathForRole, getNavItems } from "./navigation";
import { getCampaignRaffleAccess, getCampaignRaffleDashboard, createRaffleCampaign, distributeRaffleTickets, deleteRaffleTicket } from "./campaign-raffle-service";
import { mockPrismaDelegate } from "./prisma-test-delegate";

test("ADS supervisors and managers may read tickets without receiving mutation permissions", () => {
  for (const role of ["SUPERVISOR", "GESTOR", "COORDENADOR", "GERENTE"]) {
    const user = { role, lob: "ADS", status: "ACTIVE" };
    assert.equal(canViewCampaignStaff(user), true);
    assert.equal(canManageCampaignStaff(user), false);
    assert.ok(getNavItems(user).some((item) => item.href === "/campanha"));
    for (const path of ["/campanha", "/campanha/staff", "/api/campaigns/raffle"]) assert.equal(canAccessPathForRole(path, user), true);
    assert.equal(canViewCampaignStaff({ ...user, status: "INACTIVE" }), false);
  }
  for (const lob of ["CEC", "VIDEO", "COMMENTS", "PROJECT", ""]) {
    assert.equal(canViewCampaignStaff({ role: "SUPERVISOR", lob }), false);
    assert.equal(canAccessPathForRole("/campanha/staff", { role: "SUPERVISOR", lob }), false);
  }
  for (const role of ["COLABORADOR", "POC", "RTA", "QUALIDADE", "CLIENT"]) assert.equal(canViewCampaignStaff({ role, lob: "ADS" }), false);
  for (const role of ["ADMIN", "WFM"]) {
    assert.equal(canViewCampaignStaff({ role }), true);
    assert.equal(canManageCampaignStaff({ role }), true);
  }
});

for (const role of ["SUPERVISOR", "GESTOR"]) test(`${role}: server returns all campaign tickets and denies all mutations`, async (t) => {
  const actor = { email: "reader@example.test", name: "Reader", role: "ADMIN" as const }; // Stale claim must not grant writes.
  mockPrismaDelegate(t, "user", { findFirst: async () => ({
    id: "reader", ...actor, status: "ACTIVE", role: { name: role }, employeeProfile: {
      id: "supervisor", roleTitle: "Supervisor", operationalStatus: "Ativo", deletedAt: null, terminationDate: null, lob: { name: "ADS" }
    }
  }) });
  mockPrismaDelegate(t, "raffleCampaign", { findMany: async () => [{
    id: "campaign", name: "Rifa", status: "ACTIVE", minNumber: 1, maxNumber: 10000, createdAt: new Date("2026-09-01"), _count: { tickets: 2, distributions: 1 }
  }] });
  mockPrismaDelegate(t, "employeeProfile", { findMany: async () => [] });
  mockPrismaDelegate(t, "raffleDistribution", { findMany: async () => [] });
  const assignments = mockPrismaDelegate(t, "raffleTicketAssignment", {
    groupBy: async () => [{ employeeId: "one", _count: { _all: 1 } }, { employeeId: "other-team", _count: { _all: 1 } }],
    findMany: async () => ["one", "other-team"].map((id, i) => ({ id: `ticket-${id}`, number: i + 1, createdAt: new Date("2026-09-01"), employee: { id, fullName: id, wbLogin: `wb_${id}`, operationalStatus: "Ativo" } }))
  });
  const access = await getCampaignRaffleAccess(actor);
  assert.equal(access.canViewAll, true);
  assert.equal(access.canManage, false);
  const dashboard = await getCampaignRaffleDashboard(actor, "staff", "campaign");
  assert.equal(dashboard.view, "staff");
  if (dashboard.view !== "staff") throw new Error("Wrong view");
  assert.equal(dashboard.summary.usedTickets, 2);
  assert.equal(dashboard.ticketHolders.length, 2);
  assert.equal(dashboard.access.canManage, false);
  assert.deepEqual(assignments.findMany.mock.calls[0].arguments[0].where, { campaignId: "campaign" });
  for (const action of [
    () => createRaffleCampaign(actor, { name: "New campaign" }),
    () => distributeRaffleTickets(actor, { campaignId: "campaign", employeeIds: ["one"], ticketsPerEmployee: 1, idempotencyKey: "blocked-distribution" }),
    () => deleteRaffleTicket(actor, { ticketId: "ticket-one" })
  ]) await assert.rejects(action, { status: 403 });
});

test("server revalidates a supervisor's current LOB and termination", async (t) => {
  const actor = { email: "reader@example.test", name: "Reader", role: "ADMIN" as const };
  for (const variant of [{ lob: "CEC", terminationDate: null }, { lob: "ADS", terminationDate: new Date() }]) {
    await t.test(variant.lob, async (sub) => {
      mockPrismaDelegate(sub, "user", { findFirst: async () => ({ id: "reader", status: "ACTIVE", role: { name: "SUPERVISOR" }, employeeProfile: {
        roleTitle: "Supervisor", operationalStatus: "Ativo", deletedAt: null, terminationDate: variant.terminationDate, lob: { name: variant.lob }
      } }) });
      assert.equal((await getCampaignRaffleAccess(actor)).canViewAll, false);
      await assert.rejects(() => getCampaignRaffleDashboard(actor, "staff"), { status: 403 });
    });
  }
});
