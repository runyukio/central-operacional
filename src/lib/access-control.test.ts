import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAccessRole, roleHasCapability } from "@/lib/access-control";

test("somente ADMIN e WFM alteram cronogramas", () => {
  const allowed = ["ADMIN", "WFM"];
  const denied = ["GESTOR", "SUPERVISOR", "QUALIDADE", "RH", "FINANCEIRO", "TI", "RTA", "POC", "COLABORADOR", "CLIENT"];

  for (const role of allowed) assert.equal(roleHasCapability(role, "SCHEDULE_EDIT"), true, role);
  for (const role of denied) assert.equal(roleHasCapability(role, "SCHEDULE_EDIT"), false, role);
});

test("WFM acessa Performance", () => {
  assert.equal(roleHasCapability("WFM", "PERFORMANCE"), true);
});

test("Supervisor e Qualidade visualizam todos os cronogramas sem poder editar", () => {
  for (const role of ["SUPERVISOR", "QUALIDADE"]) {
    assert.equal(roleHasCapability(role, "SCHEDULE_VIEW"), true, role);
    assert.equal(roleHasCapability(role, "SCHEDULE_EDIT"), false, role);
  }
});

test("RTA e POC recebem somente o pacote operacional definido", () => {
  for (const role of ["RTA", "POC"]) {
    assert.equal(roleHasCapability(role, "REALTIME_FULL"), true, role);
    assert.equal(roleHasCapability(role, "CAPTURE"), true, role);
    assert.equal(roleHasCapability(role, "STAFF_COVERAGE"), true, role);
    assert.equal(roleHasCapability(role, "BILLING_VIEW"), false, role);
    assert.equal(roleHasCapability(role, "EMPLOYEE_EDIT"), false, role);
  }
});

test("RH e Financeiro apenas visualizam Billing e Financeiro", () => {
  for (const role of ["RH", "FINANCEIRO"]) {
    assert.equal(roleHasCapability(role, "BILLING_VIEW"), true, role);
    assert.equal(roleHasCapability(role, "BILLING_MANAGE"), false, role);
    assert.equal(roleHasCapability(role, "FINANCE_VIEW"), true, role);
    assert.equal(roleHasCapability(role, "FINANCE_MANAGE"), false, role);
    assert.equal(roleHasCapability(role, "EMPLOYEE_ROLE_EDIT"), false, role);
    assert.equal(roleHasCapability(role, "SCHEDULE_EDIT"), false, role);
    assert.equal(roleHasCapability(role, "ADVANCE_MANAGE"), false, role);
  }
});

test("somente ADMIN altera Billing, Financeiro, Adiantamento e roles", () => {
  const restrictedCapabilities = ["BILLING_MANAGE", "FINANCE_MANAGE", "ADVANCE_MANAGE", "EMPLOYEE_ROLE_EDIT"] as const;
  const nonAdminRoles = ["GESTOR", "SUPERVISOR", "WFM", "QUALIDADE", "RH", "FINANCEIRO", "TI", "RTA", "POC", "COLABORADOR", "CLIENT"];

  for (const capability of restrictedCapabilities) {
    assert.equal(roleHasCapability("ADMIN", capability), true, capability);
    for (const role of nonAdminRoles) assert.equal(roleHasCapability(role, capability), false, `${role}:${capability}`);
  }
});

test("CLIENT permanece limitado a Filas, Necessidade e Performance", () => {
  for (const capability of ["REALTIME_QUEUES", "STAFF_COVERAGE", "PERFORMANCE"] as const) {
    assert.equal(roleHasCapability("CLIENT", capability), true, capability);
  }
  for (const capability of ["REALTIME_FULL", "CENTRAL", "PIPELINES", "FEEDBACK_SUBMIT", "SCHEDULE_VIEW"] as const) {
    assert.equal(roleHasCapability("CLIENT", capability), false, capability);
  }
});

test("Coordenador e Gerente usam a matriz de GESTOR", () => {
  assert.equal(normalizeAccessRole("COORDENADOR"), "GESTOR");
  assert.equal(normalizeAccessRole("GERENTE"), "GESTOR");
  assert.equal(roleHasCapability("COORDENADOR", "CENTRAL"), true);
  assert.equal(roleHasCapability("GESTOR", "STAFF_COVERAGE_MANAGE"), true);
  assert.equal(roleHasCapability("GESTOR", "WORK_HOURS_EDIT"), true);
  assert.equal(roleHasCapability("GESTOR", "EMPLOYEE_EDIT"), true);
  assert.equal(roleHasCapability("GESTOR", "EMPLOYEE_SENSITIVE"), false);
  assert.equal(roleHasCapability("GERENTE", "FINANCE_VIEW"), false);
});
