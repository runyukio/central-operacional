import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";

import { allAppRoles, roleHasCapability } from "./access-control";
import { errorStatus } from "./api-errors";
import { resetEmployeeUserPassword } from "./employee-service";
import { canAccessPathForRole } from "./navigation";
import { passwordCredentialProviders } from "./password-credentials";
import { canManageRoles, canManageUsers, canResetEmployeePassword } from "./permissions";
import { prisma } from "./prisma";
import { mockPrismaDelegate } from "./prisma-test-delegate";

const actor = { email: "wfm@example.test", name: "Test WFM", role: "WFM" as const };
const input = { employeeId: "partner", password: "Temporary-test-123", confirmPassword: "Temporary-test-123" };

function mockReset(t: TestContext, role = "WFM", targetRole = "COLABORADOR") {
  const requester = { id: "requester", email: actor.email, role: { name: role }, status: "ACTIVE", deletedAt: null as Date | null };
  const targetUser = {
    id: "partner-user", email: "partner@example.test", role: { name: targetRole }, status: "ACTIVE",
    deletedAt: null as Date | null, mustChangePassword: false, temporaryPassword: false
  };
  const partner = { id: "partner", fullName: "Test Partner", userId: targetUser.id as string | null, user: targetUser };
  mockPrismaDelegate(t, "user", { findUnique: async () => requester });
  const employee = mockPrismaDelegate(t, "employeeProfile", { findFirst: async () => partner });
  const deniedAudit = mockPrismaDelegate(t, "auditLog", { create: async () => ({}) });
  const tx = {
    user: { update: t.mock.fn(async (_args: Prisma.UserUpdateArgs) => ({})) },
    auditLog: { create: t.mock.fn(async (_args: Prisma.AuditLogCreateArgs) => ({})) }
  };
  const originalTransaction = prisma.$transaction;
  prisma.$transaction = (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as unknown as typeof prisma.$transaction;
  t.after(() => { prisma.$transaction = originalTransaction; });
  t.mock.method(passwordCredentialProviders, "isExternalConfigured", () => false);
  t.mock.method(passwordCredentialProviders, "isExternalAdminConfigured", () => true);
  const external = t.mock.method(passwordCredentialProviders, "updateExternal", async () => "UPDATED" as const);
  return { requester, partner, targetUser, employee, deniedAudit, tx, external };
}

test("password reset is a separate ADMIN/WFM capability, without role/user administration", () => {
  for (const role of allAppRoles) {
    const allowed = ["ADMIN", "WFM"].includes(role);
    assert.equal(roleHasCapability(role, "EMPLOYEE_PASSWORD_RESET"), allowed, role);
    assert.equal(canResetEmployeePassword({ role, status: "ACTIVE" }), allowed, role);
    assert.equal(canAccessPathForRole("/api/employees/reset-password", { role }), allowed, role);
    assert.equal(canResetEmployeePassword({ role, status: "BLOCKED" }), false, role);
    assert.equal(canResetEmployeePassword({ role, status: "INACTIVE" }), false, role);
  }
  assert.equal(canManageRoles({ role: "WFM" }), false);
  assert.equal(canManageUsers({ role: "WFM" }), false);
  assert.equal(canResetEmployeePassword({ role: "COLABORADOR", roleTitle: "WFM", skill: "WFM" }), false);
});

test("WFM cannot reset admin accounts or targets without a known system role", () => {
  for (const role of ["ADMIN", "ADMINISTRADOR", "admin central", "ADMINISTRADORA"]) {
    assert.equal(canResetEmployeePassword(actor, { role, roleTitle: "Agente" }), false, role);
    assert.equal(canResetEmployeePassword({ role: "ADMIN" }, { role }), true, role);
  }
  assert.equal(canResetEmployeePassword(actor, null), false);
  assert.equal(canResetEmployeePassword(actor, { roleTitle: "Agente" }), false);
  for (const role of ["COLABORADOR", "POC", "SUPERVISOR", "GESTOR", "WFM"]) {
    assert.equal(canResetEmployeePassword(actor, { role }), true, role);
  }
});

for (const role of ["WFM", "ADMIN"]) {
  test(`${role} resets using the real service, with hashing, audit and mandatory change`, async (t) => {
    const { tx, external } = mockReset(t, role);
    const result = await resetEmployeeUserPassword(actor, input);
    assert.ok("success" in result && result.success, JSON.stringify(result));
    assert.equal(tx.user.update.mock.callCount(), 1);
    const saved = tx.user.update.mock.calls[0].arguments[0];
    assert.equal(saved.where.id, "partner-user");
    assert.equal(await bcrypt.compare(input.password, saved.data.passwordHash as string), true);
    assert.equal(saved.data.mustChangePassword, true);
    assert.equal(saved.data.temporaryPassword, true);
    assert.ok(saved.data.lastPasswordResetAt instanceof Date);
    assert.equal(saved.data.passwordResetById, "requester");
    assert.equal(saved.data.roleId, undefined);
    assert.equal(saved.data.status, role === "ADMIN" ? "ACTIVE" : undefined);
    assert.equal(tx.auditLog.create.mock.callCount(), 1);
    const audit = tx.auditLog.create.mock.calls[0].arguments[0].data;
    assert.equal(audit.actorId, "requester");
    assert.equal(audit.entityId, "partner-user");
    assert.ok(!JSON.stringify(audit).includes(input.password));
    assert.ok(!JSON.stringify(audit).includes(saved.data.passwordHash as string));
    assert.equal(external.mock.callCount(), 1);
  });
}

test("a stale WFM session cannot bypass the current database role", async (t) => {
  const { tx, external, employee, deniedAudit } = mockReset(t, "SUPERVISOR");
  const result = await resetEmployeeUserPassword(actor, input);
  assert.ok("type" in result && result.type === "PERMISSION_ERROR");
  assert.equal(errorStatus(result), 403);
  assert.equal(employee.findFirst.mock.callCount(), 0);
  assert.equal(tx.user.update.mock.callCount(), 0);
  assert.equal(external.mock.callCount(), 0);
  assert.equal(deniedAudit.create.mock.calls[0].arguments[0].data.newValue.role, "SUPERVISOR");
});

for (const role of ["ADMIN", "ADMINISTRADOR"]) {
  test(`WFM direct service call cannot reset ${role}`, async (t) => {
    const { tx, external } = mockReset(t, "WFM", role);
    const result = await resetEmployeeUserPassword(actor, input);
    assert.ok("type" in result && result.type === "PERMISSION_ERROR");
    assert.equal(errorStatus(result), 403);
    assert.equal(tx.user.update.mock.callCount(), 0);
    assert.equal(external.mock.callCount(), 0);
  });
}

for (const status of ["BLOCKED", "INACTIVE", "DELETED"]) {
  test(`inactive requester is rejected (${status})`, async (t) => {
    const { requester, tx, external } = mockReset(t);
    if (status === "DELETED") requester.deletedAt = new Date();
    else requester.status = status;
    const result = await resetEmployeeUserPassword(actor, input);
    assert.ok("type" in result && result.type === "AUTH_ERROR");
    assert.equal(errorStatus(result), 401);
    assert.equal(tx.user.update.mock.callCount(), 0);
    assert.equal(external.mock.callCount(), 0);
  });
}

for (const invalid of [
  { password: "short", confirmPassword: "short" },
  { password: "x".repeat(129), confirmPassword: "x".repeat(129) },
  { password: input.password, confirmPassword: "different" }
]) {
  test(`password validation remains enforced (${invalid.password.length} characters)`, async (t) => {
    const { tx, external } = mockReset(t);
    const result = await resetEmployeeUserPassword(actor, { ...input, ...invalid });
    assert.ok("error" in result);
    assert.equal(tx.user.update.mock.callCount(), 0);
    assert.equal(external.mock.callCount(), 0);
  });
}

test("WFM reset does not reactivate a blocked account", async (t) => {
  const { targetUser, tx } = mockReset(t);
  targetUser.status = "BLOCKED";
  const result = await resetEmployeeUserPassword(actor, input);
  assert.ok("success" in result && result.success);
  assert.equal(tx.user.update.mock.calls[0].arguments[0].data.status, undefined);
});

for (const missing of ["deleted", "unlinked"]) {
  test(`reset rejects a ${missing} user without changing credentials`, async (t) => {
    const { partner, targetUser, tx, external } = mockReset(t);
    if (missing === "deleted") targetUser.deletedAt = new Date();
    else partner.userId = null;
    const result = await resetEmployeeUserPassword(actor, input);
    assert.ok("error" in result);
    assert.equal(tx.user.update.mock.callCount(), 0);
    assert.equal(external.mock.callCount(), 0);
  });
}

test("both reset buttons, dialog and submit handler use the dedicated target permission", () => {
  const source = readFileSync(new URL("../components/modules/employee-map-page.tsx", import.meta.url), "utf8");
  assert.match(source, /canResetEmployeePassword\(employeePermissionUser, \{ role: selected\?\.systemRole \}\)/);
  assert.equal((source.match(/\{canResetSelectedPassword \? \(\s*<button onClick=\{\(\) => setShowResetPassword\(true\)\}/g) ?? []).length, 2);
  assert.match(source, /if \(!selected \|\| resettingPassword \|\| !canResetSelectedPassword\) return;/);
  assert.match(source, /showResetPassword && selected && canResetSelectedPassword/);
  assert.doesNotMatch(source, /Solicitar troca no próximo login \(preparado para fase futura\)/);
});
