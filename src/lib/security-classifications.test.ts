import assert from "node:assert/strict";
import test from "node:test";
import { canAssignSecurityJobTitle } from "./security-classifications";
import { canAccessBilling, canManageBillingPaymentStatus } from "./billing-permissions";

test("only ADMIN grants or removes security-bearing Financeiro title", () => {
  for (const role of ["WFM", "GESTOR", "RH", "FINANCEIRO", "COLABORADOR"]) {
    assert.equal(canAssignSecurityJobTitle(role, "Agente", " Financeiro "), false, role);
    assert.equal(canAssignSecurityJobTitle(role, null, "financeiro"), false, `${role}:new`);
    assert.equal(canAssignSecurityJobTitle(role, "Financeiro", "Agente"), false, `${role}:remove`);
    assert.equal(canAssignSecurityJobTitle(role, "Financeiro", "Financeiro"), true, `${role}:unchanged`);
    assert.equal(canAssignSecurityJobTitle(role, "Agente", "Supervisor"), true, `${role}:operational`);
  }
  assert.equal(canAssignSecurityJobTitle("ADMIN", null, "Financeiro"), true);
  const existingFinance = { role: "COLABORADOR", roleTitle: "Financeiro" };
  assert.equal(canAccessBilling(existingFinance), true);
  assert.equal(canManageBillingPaymentStatus(existingFinance), true);
});
