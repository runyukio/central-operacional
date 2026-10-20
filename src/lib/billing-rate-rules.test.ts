import assert from "node:assert/strict";
import test from "node:test";

import {
  BILLING_STAFF_RATE_DEFAULTS,
  resolveBillingStaffRateRule,
  resolveEmployeeBillingStaffRateKey,
  resolveEmployeeBillingStaffRateRule
} from "./billing-rate-rules";

test("tarifa de Gerente preserva oito casas decimais em todos os turnos", () => {
  assert.deepEqual(BILLING_STAFF_RATE_DEFAULTS.MANAGER, { day: 102.27272727, night: 102.27272727 });
  for (const roleTitle of ["Gerente", " GERENTE ", "Manager"]) {
    for (const skill of ["Manager", "", "RTA", "Bilingual"]) {
      const resolved = resolveEmployeeBillingStaffRateRule({ roleTitle, skill });
      assert.equal(resolved?.rule.skillKey, "manager");
      assert.equal(resolved?.source, "Cargo/Função");
      for (const shift of ["MANHA", "TARDE", "NOITE"] as const) {
        assert.equal(resolveEmployeeBillingStaffRateKey({ roleTitle, skill }, shift)?.rateKey, shift === "NOITE" ? "STAFF_MANAGER_NIGHT_RATE" : "STAFF_MANAGER_DAY_RATE");
      }
    }
  }
});

test("a tarifa de Gerente exige o cargo e não se aplica somente pela skill Manager", () => {
  for (const roleTitle of ["Outro", "Agente", "Supervisor"]) {
    assert.equal(resolveEmployeeBillingStaffRateRule({ roleTitle, skill: "Manager" }), null);
  }
});

test("mantém as tarifas de RH com oito casas decimais", () => {
  assert.deepEqual(BILLING_STAFF_RATE_DEFAULTS.HR, {
    day: 25.56818182,
    night: 29.40340909
  });
});

test("mantém as tarifas de Financeiro com oito casas decimais", () => {
  assert.deepEqual(BILLING_STAFF_RATE_DEFAULTS.FINANCE, {
    day: 34.09090909,
    night: 39.20454545
  });
});

test("resolve RH e Financeiro pelo cargo/função", () => {
  assert.deepEqual(resolveEmployeeBillingStaffRateRule({ roleTitle: "Recursos Humanos", skill: "" }), {
    rule: resolveBillingStaffRateRule("RH"),
    source: "Cargo/Função"
  });
  assert.deepEqual(resolveEmployeeBillingStaffRateRule({ roleTitle: "Financeiro", skill: null }), {
    rule: resolveBillingStaffRateRule("finance"),
    source: "Cargo/Função"
  });
});

test("seleciona a tarifa diurna para manhã/tarde e a noturna para noite", () => {
  assert.equal(resolveEmployeeBillingStaffRateKey({ roleTitle: "RH" }, "MANHA")?.rateKey, "STAFF_HR_DAY_RATE");
  assert.equal(resolveEmployeeBillingStaffRateKey({ roleTitle: "RH" }, "TARDE")?.rateKey, "STAFF_HR_DAY_RATE");
  assert.equal(resolveEmployeeBillingStaffRateKey({ roleTitle: "RH" }, "NOITE")?.rateKey, "STAFF_HR_NIGHT_RATE");
  assert.equal(resolveEmployeeBillingStaffRateKey({ roleTitle: "Financeiro" }, "MANHA")?.rateKey, "STAFF_FINANCE_DAY_RATE");
  assert.equal(resolveEmployeeBillingStaffRateKey({ roleTitle: "Financeiro" }, "NOITE")?.rateKey, "STAFF_FINANCE_NIGHT_RATE");
});

test("preserva a prioridade da Skill staff sobre o cargo/função", () => {
  const resolved = resolveEmployeeBillingStaffRateRule({ roleTitle: "WFM II", skill: "RTA" });
  assert.equal(resolved?.rule.skillKey, "rta");
  assert.equal(resolved?.source, "Skill");
});

test("não amplia o fallback por cargo para regras staff antigas", () => {
  assert.equal(resolveEmployeeBillingStaffRateRule({ roleTitle: "WFM II", skill: "" }), null);
  assert.equal(resolveEmployeeBillingStaffRateRule({ roleTitle: "Supervisor", skill: null }), null);
});
