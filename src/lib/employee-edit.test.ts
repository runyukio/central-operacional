import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Prisma } from "@prisma/client";

import { updateOperationalEmployee, type EmployeeAdminUpdateInput } from "./employee-service";
import { prisma } from "./prisma";
import { mockPrismaDelegate } from "./prisma-test-delegate";

const actor = { email: "wfm@example.test", name: "Test WFM", role: "WFM" as const };

function mockEmployeeEdit(t: TestContext, databaseRole = "WFM", linkedUser = true) {
  const events: string[] = [];
  const partnerUser = {
    id: "partner-user", name: "Original name", email: "partner@example.test", status: "ACTIVE",
    roleId: "partner-role", role: { name: "COLABORADOR" }, deletedAt: null
  };
  const partner = {
    id: "partner", fullName: "Original name", wbLogin: "wb_test", roleTitle: "Agente",
    operationalStatus: "Ativo", deletedAt: null, userId: linkedUser ? partnerUser.id : null,
    user: linkedUser ? partnerUser : null, lobId: "ads", lob: { name: "ADS" }, teamId: "team", team: { name: "Test team" },
    shiftId: "morning", shift: { name: "Manhã" }, supervisor: null, supervisorId: null,
    _count: { supervisees: 0 }, skillAssignments: [], equipments: [], admissionDate: new Date("2026-01-01T00:00:00Z")
  };
  mockPrismaDelegate(t, "user", { findUnique: async () => ({
    id: "wfm-user", email: actor.email, name: actor.name, status: "ACTIVE", deletedAt: null, role: { name: databaseRole }
  }) });
  mockPrismaDelegate(t, "employeeProfile", { findFirst: async () => partner });
  mockPrismaDelegate(t, "employeeSensitiveData", { findUnique: async () => null });
  mockPrismaDelegate(t, "auditLog", { create: async () => ({}) });
  const tx = {
    $queryRaw: async (query: TemplateStringsArray) => {
      events.push("lock");
      // Reproduce Prisma's real void-result failure; only a supported result
      // type may reach the user/profile writes. All delegates stay in memory.
      if (!/pg_advisory_xact_lock\(732104, 1\)::text/.test(query.join(""))) {
        throw new Prisma.PrismaClientKnownRequestError("Failed to deserialize column of type 'void'", {
          code: "P2010", clientVersion: "5.22.0"
        });
      }
      return [{ lock: "" }];
    },
    user: {
      findUnique: async () => partnerUser,
      update: t.mock.fn(async ({ data }: Prisma.UserUpdateArgs) => {
        events.push("user");
        return { ...partnerUser, ...data };
      }),
      count: async () => { throw new Error("An agent edit must not count administrators"); }
    },
    employeeProfile: { update: t.mock.fn(async ({ data }: Prisma.EmployeeProfileUpdateArgs) => {
      events.push("profile");
      return { ...partner, ...data };
    }) },
    auditLog: { create: t.mock.fn(async () => { events.push("audit"); return {}; }) }
  };
  const original = prisma.$transaction;
  prisma.$transaction = (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as unknown as typeof prisma.$transaction;
  t.after(() => { prisma.$transaction = original; });
  return { tx, events };
}

for (const input of [
  { id: "partner", fullName: "Corrected name", email: "partner@example.test", userStatus: "ACTIVE" },
  { id: "partner", fullName: "Corrected name" }
] satisfies EmployeeAdminUpdateInput[]) {
  test(`WFM saves a partner name in profile and account (${"email" in input ? "form payload" : "name only"})`, async (t) => {
    const { tx, events } = mockEmployeeEdit(t);
    const result = await updateOperationalEmployee(actor, input);
    assert.ok("data" in result, JSON.stringify(result));
    if (!("data" in result)) throw new Error("Expected saved partner");
    assert.equal(result.data.name, "Corrected name");
    assert.deepEqual(events, ["lock", "user", "profile", "audit"]);
    assert.equal(tx.user.update.mock.calls[0].arguments[0].where.id, "partner-user");
    assert.equal(tx.user.update.mock.calls[0].arguments[0].data.name, "Corrected name");
    assert.equal(tx.user.update.mock.calls[0].arguments[0].data.roleId, undefined);
    assert.equal(tx.employeeProfile.update.mock.calls[0].arguments[0].data.fullName, "Corrected name");
    assert.equal(tx.auditLog.create.mock.callCount(), 1);
  });
}

for (const [label, input, role] of [
  ["system role change", { id: "partner", roleName: "ADMIN" }, "WFM"],
  ["payment-privileged job title", { id: "partner", roleTitle: "Financeiro" }, "WFM"],
  ["stale WFM session for a supervisor", { id: "partner", fullName: "Corrected name" }, "SUPERVISOR"],
  ["empty name", { id: "partner", fullName: "   " }, "WFM"]
] satisfies Array<[string, EmployeeAdminUpdateInput, string]>) {
  test(`employee edit still rejects ${label}`, async (t) => {
    const { tx, events } = mockEmployeeEdit(t, role);
    const result = await updateOperationalEmployee(actor, input);
    assert.ok("error" in result);
    assert.deepEqual(events, []);
    assert.equal(tx.user.update.mock.callCount(), 0);
    assert.equal(tx.employeeProfile.update.mock.callCount(), 0);
  });
}

test("WFM can rename an unlinked profile without creating an account", async (t) => {
  const { tx, events } = mockEmployeeEdit(t, "WFM", false);
  const result = await updateOperationalEmployee(actor, { id: "partner", fullName: "Corrected name" });
  assert.ok("data" in result, JSON.stringify(result));
  assert.deepEqual(events, ["profile", "audit"]);
  assert.equal(tx.user.update.mock.callCount(), 0);
});
