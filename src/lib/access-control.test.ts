import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAccessRole, roleHasCapability } from "@/lib/access-control";
import { canAccessFinanceiro } from "@/lib/financeiro-permissions";
import {
  canAccessPerformance,
  canAccessRealTime,
  canAccessWorkSessionMonitoring,
  canAutoUpdateAdsRequirement,
  canEditSchedule,
  canImportPerformance
} from "@/lib/permissions";

test("somente ADMIN e WFM alteram cronogramas", () => {
  const allowed = ["ADMIN", "WFM"];
  const denied = ["GESTOR", "SUPERVISOR", "QUALIDADE", "RH", "FINANCEIRO", "TI", "RTA", "POC", "COLABORADOR", "CLIENT", "GLOBAL"];

  for (const role of allowed) assert.equal(roleHasCapability(role, "SCHEDULE_EDIT"), true, role);
  for (const role of denied) assert.equal(roleHasCapability(role, "SCHEDULE_EDIT"), false, role);
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

test("Colaborador acessa o próprio invoice pelo pacote pessoal, sem abrir o Billing consolidado", () => {
  assert.equal(roleHasCapability("COLABORADOR", "PERSONAL"), true);
  assert.equal(roleHasCapability("COLABORADOR", "BILLING_VIEW"), false);
  assert.equal(roleHasCapability("COLABORADOR", "BILLING_MANAGE"), false);
});

test("somente ADMIN altera Billing, Financeiro, Adiantamento e roles", () => {
  const restrictedCapabilities = ["BILLING_MANAGE", "FINANCE_MANAGE", "ADVANCE_MANAGE", "EMPLOYEE_ROLE_EDIT"] as const;
  const nonAdminRoles = ["GESTOR", "SUPERVISOR", "WFM", "QUALIDADE", "RH", "FINANCEIRO", "TI", "RTA", "POC", "COLABORADOR", "CLIENT", "GLOBAL"];

  for (const capability of restrictedCapabilities) {
    assert.equal(roleHasCapability("ADMIN", capability), true, capability);
    for (const role of nonAdminRoles) assert.equal(roleHasCapability(role, capability), false, `${role}:${capability}`);
  }
});

test("somente ADMIN atualiza automaticamente a necessidade ADS", () => {
  assert.equal(canAutoUpdateAdsRequirement({ role: "ADMIN", status: "ACTIVE" }), true);
  for (const role of ["GESTOR", "WFM", "RTA", "POC", "CLIENT", "COLABORADOR"]) {
    assert.equal(canAutoUpdateAdsRequirement({ role, status: "ACTIVE" }), false, role);
  }
});

test("Qualidade, Supervisor e WFM acessam Performance", () => {
  for (const role of ["QUALIDADE", "SUPERVISOR", "WFM"]) {
    assert.equal(roleHasCapability(role, "PERFORMANCE"), true, role);
    assert.equal(canAccessPerformance({ role, status: "ACTIVE" }), true, role);
  }
});

test("somente ADMIN e WFM importam bases de Performance", () => {
  for (const role of ["ADMIN", "WFM"]) {
    assert.equal(canImportPerformance({ role, status: "ACTIVE" }), true, role);
  }

  for (const role of ["GESTOR", "SUPERVISOR", "QUALIDADE", "RH", "FINANCEIRO", "CLIENT", "COLABORADOR"]) {
    assert.equal(canImportPerformance({ role, status: "ACTIVE" }), false, role);
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

test("GLOBAL visualiza a operação sem alterar dados", () => {
  for (const capability of ["CENTRAL", "REALTIME_FULL", "CAPTURE", "STAFF_COVERAGE", "PERFORMANCE", "EMPLOYEE_MAP", "EMPLOYEE_SENSITIVE", "SCHEDULE_VIEW", "WORK_HOURS_VIEW", "BILLING_VIEW", "FINANCE_VIEW", "ADVANCE_VIEW", "EQUIPMENT_VIEW"] as const) {
    assert.equal(roleHasCapability("GLOBAL", capability), true, capability);
  }
  for (const capability of ["STAFF_COVERAGE_MANAGE", "EMPLOYEE_EDIT", "EMPLOYEE_ROLE_EDIT", "SCHEDULE_EDIT", "WORK_HOURS_EDIT", "BILLING_MANAGE", "FINANCE_MANAGE", "ADVANCE_MANAGE", "EQUIPMENT_MANAGE", "SETTINGS", "USERS_MANAGE"] as const) {
    assert.equal(roleHasCapability("GLOBAL", capability), false, capability);
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

test("skill, cargo e e-mail não concedem permissões fora da role", () => {
  const collaborator = {
    role: "COLABORADOR",
    email: "runyukio@gmail.com",
    roleTitle: "WFM",
    jobTitle: "Administrador",
    skill: "RTA POC",
    status: "ACTIVE"
  };

  assert.equal(canAccessRealTime(collaborator), false);
  assert.equal(canAccessWorkSessionMonitoring(collaborator), false);
  assert.equal(canAccessFinanceiro(collaborator), false);
  assert.equal(canEditSchedule(collaborator), false);
});
