import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAccessRole, roleHasCapability } from "@/lib/access-control";
import { canAccessBilling, canManageBilling, canManageBillingPaymentStatus } from "@/lib/billing-permissions";
import { canAccessFinanceiro } from "@/lib/financeiro-permissions";
import { canAccessPathForRole, getNavItems } from "@/lib/navigation";
import {
  canAccessCampaignAgent,
  canManageCampaignStaff,
  canAccessPerformance,
  canAccessRealTime,
  canAccessWorkSessionMonitoring,
  canAdminOverrideWorkflowScheduleStatus,
  canAutoUpdateAdsRequirement,
  canEditSchedule,
  canImportPerformance
} from "@/lib/permissions";

test("Campanha separa a visão do agente ADS da gestão Staff", () => {
  const adsAgent = { role: "COLABORADOR", roleTitle: "Agente", lob: "ADS", status: "ACTIVE" };
  const videoAgent = { role: "COLABORADOR", roleTitle: "Agente", lob: "VIDEO", status: "ACTIVE" };

  assert.equal(canAccessCampaignAgent(adsAgent), true);
  assert.equal(canAccessCampaignAgent(videoAgent), false);
  assert.equal(canAccessCampaignAgent({ ...adsAgent, roleTitle: "Supervisor" }), false);
  assert.equal(canManageCampaignStaff({ role: "WFM", status: "ACTIVE" }), true);
  assert.equal(canManageCampaignStaff({ role: "ADMIN", status: "ACTIVE" }), true);
  assert.equal(canManageCampaignStaff(adsAgent), false);
  assert.equal(getNavItems(adsAgent).some((item) => item.href === "/campanha/agente"), true);
  assert.equal(getNavItems(videoAgent).some((item) => item.href.startsWith("/campanha")), false);
});

test("somente ADMIN e WFM alteram cronogramas", () => {
  const allowed = ["ADMIN", "WFM"];
  const denied = ["GESTOR", "SUPERVISOR", "QUALIDADE", "RH", "FINANCEIRO", "TI", "RTA", "POC", "COLABORADOR", "CLIENT", "GLOBAL"];

  for (const role of allowed) assert.equal(roleHasCapability(role, "SCHEDULE_EDIT"), true, role);
  for (const role of denied) assert.equal(roleHasCapability(role, "SCHEDULE_EDIT"), false, role);
});

test("somente ADMIN pode corrigir slots com status aprovado pela Esteira", () => {
  for (const status of [
    "Troca aprovada",
    "Venda de folga aprovada",
    "Folga aprovada",
    "TROCA_APROVADA",
    "VENDA_FOLGA_APROVADA",
    "FOLGA_APROVADA"
  ]) {
    assert.equal(canAdminOverrideWorkflowScheduleStatus({ role: "ADMIN", status: "ACTIVE" }, status), true, status);
    assert.equal(canAdminOverrideWorkflowScheduleStatus({ role: "WFM", status: "ACTIVE" }, status), false, status);
  }
  assert.equal(canAdminOverrideWorkflowScheduleStatus({ role: "ADMIN", status: "INACTIVE" }, "Troca aprovada"), false);
  assert.equal(canAdminOverrideWorkflowScheduleStatus({ role: "ADMIN", status: "ACTIVE" }, "Escalado"), false);
  assert.equal(canAdminOverrideWorkflowScheduleStatus({ role: "ADMIN", status: "ACTIVE" }, "Falta Justificada"), false);
});

test("Supervisor e Qualidade visualizam todos os cronogramas sem poder editar", () => {
  for (const role of ["SUPERVISOR", "QUALIDADE"]) {
    assert.equal(roleHasCapability(role, "SCHEDULE_VIEW"), true, role);
    assert.equal(roleHasCapability(role, "SCHEDULE_EDIT"), false, role);
  }
});

test("RTA visualiza Cronogramas sem poder editar", () => {
  const rta = { role: "RTA", status: "ACTIVE" };
  assert.equal(roleHasCapability("RTA", "SCHEDULE_VIEW"), true);
  assert.equal(roleHasCapability("RTA", "SCHEDULE_EDIT"), false);
  assert.equal(getNavItems(rta).some((item) => item.href === "/escalas"), true);
  assert.equal(canAccessPathForRole("/escalas", rta), true);
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

test("Financeiro altera apenas o status de pagamento do Billing", () => {
  assert.equal(canManageBillingPaymentStatus({ role: "FINANCEIRO" }), true);
  assert.equal(canManageBilling({ role: "FINANCEIRO" }), false);
  assert.equal(canManageBillingPaymentStatus({ role: "RH" }), false);
  assert.equal(canManageBillingPaymentStatus({ role: "ADMIN" }), true);
});

test("cargo/função Financeiro pode alterar o pagamento sem receber administração ampla", () => {
  const financeByJobTitle = { role: "COLABORADOR", roleTitle: "Financeiro" };
  assert.equal(canAccessBilling(financeByJobTitle), true);
  assert.equal(canManageBillingPaymentStatus(financeByJobTitle), true);
  assert.equal(canManageBilling(financeByJobTitle), false);
});

test("Parceiro acessa o próprio invoice pelo pacote pessoal, sem abrir o Billing consolidado", () => {
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

test("ADMIN e WFM atualizam automaticamente a necessidade ADS", () => {
  assert.equal(canAutoUpdateAdsRequirement({ role: "ADMIN", status: "ACTIVE" }), true);
  assert.equal(canAutoUpdateAdsRequirement({ role: "WFM", status: "ACTIVE" }), true);
  for (const role of ["GESTOR", "RTA", "POC", "CLIENT", "COLABORADOR"]) {
    assert.equal(canAutoUpdateAdsRequirement({ role, status: "ACTIVE" }), false, role);
  }
});

test("Qualidade, Supervisor e WFM acessam Performance", () => {
  for (const role of ["QUALIDADE", "SUPERVISOR", "WFM"]) {
    assert.equal(roleHasCapability(role, "PERFORMANCE"), true, role);
    assert.equal(canAccessPerformance({ role, status: "ACTIVE" }), true, role);
  }
});

test("WFM acompanha o Report de Turno sem permissão para enviar", () => {
  assert.equal(roleHasCapability("WFM", "SHIFT_REPORT_VIEW"), true);
  assert.equal(roleHasCapability("WFM", "SHIFT_REPORT_SUBMIT"), false);
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
