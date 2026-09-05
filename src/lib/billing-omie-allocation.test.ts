import assert from "node:assert/strict";
import test from "node:test";

import {
  BILLING_OMIE_DEPARTMENT_CODES,
  BILLING_OMIE_PROJECT_CODE,
  buildBillingOmieAllocation,
  resolveBillingOmieDepartment,
  resolveBillingOmieMainCategory
} from "./billing-omie-allocation";
import { OmieIntegrationError } from "./omie-service";

test("resolve as categorias principais por cargo/função", () => {
  assert.equal(resolveBillingOmieMainCategory("Agente"), "2.10.99");
  assert.equal(resolveBillingOmieMainCategory("Agent"), "2.10.99");
  assert.equal(resolveBillingOmieMainCategory("Coordenador"), "2.10.89");
  assert.equal(resolveBillingOmieMainCategory("Qualidade"), "2.10.98");
  assert.equal(resolveBillingOmieMainCategory("WFM"), "2.10.96");
  assert.equal(resolveBillingOmieMainCategory("Supervisão"), "2.10.97");
  assert.equal(resolveBillingOmieMainCategory("RH"), "2.10.94");
  assert.equal(resolveBillingOmieMainCategory("RTA"), "2.10.88");
  assert.equal(resolveBillingOmieMainCategory("Financeiro"), "2.10.93");
  assert.equal(resolveBillingOmieMainCategory("TI"), "2.10.90");
  assert.equal(resolveBillingOmieMainCategory("Logística/TI"), "2.10.90");
  assert.equal(resolveBillingOmieMainCategory("Agente", "Treinadores"), "2.10.95");
  assert.equal(resolveBillingOmieMainCategory("Agente", "Treinador II"), "2.10.95");
  assert.equal(resolveBillingOmieMainCategory("WFM", "RTA"), "2.10.88");
});

test("rateia IT/TI como Analista de Dados por cargo ou skill, mantendo bônus e campanha separados", () => {
  for (const alias of ["IT", "TI", "Logística/TI", "Logistics IT"]) {
    for (const assignment of [{ roleTitle: alias }, { roleTitle: "WFM", skill: alias }]) {
      const allocation = buildBillingOmieAllocation({
        lob: "ALL",
        ...assignment,
        finalAmount: 1_950,
        bonusAmount: 150,
        campaignAmount: 100,
        advanceAmount: 300
      });
      assert.equal(allocation.mainCategoryCode, "2.10.90");
      assert.equal(allocation.departmentCode, BILLING_OMIE_DEPARTMENT_CODES.TECHNOLOGY);
      assert.equal(allocation.documentAmount, 1_950);
      assert.equal(allocation.documentTypeCode, "NF");
      assert.deepEqual(allocation.categories, [
        { code: "2.10.90", value: 1_700 },
        { code: "2.02.04", value: 150 },
        { code: "2.02.99", value: 100 }
      ]);
    }
  }
  assert.equal(resolveBillingOmieMainCategory("WFM", "Financeiro"), "2.10.93");
});

test("resolve o departamento pela LOB e usa cargo/função somente para ALL", () => {
  assert.deepEqual(resolveBillingOmieDepartment("ADS", "WFM"), {
    key: "ADS",
    code: BILLING_OMIE_DEPARTMENT_CODES.ADS,
    name: "ADS"
  });
  assert.deepEqual(resolveBillingOmieDepartment("CEC", "Agente"), {
    key: "CEC",
    code: BILLING_OMIE_DEPARTMENT_CODES.CEC,
    name: "CEC"
  });
  assert.deepEqual(resolveBillingOmieDepartment("ALL", "WFM"), {
    key: "WFM",
    code: BILLING_OMIE_DEPARTMENT_CODES.WFM,
    name: "WFM"
  });
  assert.deepEqual(resolveBillingOmieDepartment("ALL", "RTA"), {
    key: "RTA",
    code: BILLING_OMIE_DEPARTMENT_CODES.RTA,
    name: "RTA"
  });
});

test("mantém correção, desconto e outros no saldo da categoria principal", () => {
  assert.deepEqual(buildBillingOmieAllocation({
    lob: "ADS",
    roleTitle: "Agente",
    finalAmount: 980.38,
    bonusAmount: 0,
    campaignAmount: 0,
    advanceAmount: 0
  }), {
    documentAmount: 980.38,
    projectCode: BILLING_OMIE_PROJECT_CODE,
    departmentCode: BILLING_OMIE_DEPARTMENT_CODES.ADS,
    departmentName: "ADS",
    documentTypeCode: "NF",
    mainCategoryCode: "2.10.99",
    categories: [{ code: "2.10.99", value: 980.38 }]
  });
});

test("rateia bônus e campanha e mantém NF no invoice mesmo quando há adiantamento", () => {
  assert.deepEqual(buildBillingOmieAllocation({
    lob: "ALL",
    roleTitle: "WFM",
    finalAmount: 5_527.44,
    bonusAmount: 200,
    campaignAmount: 100,
    advanceAmount: 300
  }), {
    documentAmount: 5_527.44,
    projectCode: BILLING_OMIE_PROJECT_CODE,
    departmentCode: BILLING_OMIE_DEPARTMENT_CODES.WFM,
    departmentName: "WFM",
    documentTypeCode: "NF",
    mainCategoryCode: "2.10.96",
    categories: [
      { code: "2.10.96", value: 5_227.44 },
      { code: "2.02.04", value: 200 },
      { code: "2.02.99", value: 100 }
    ]
  });
});

test("bloqueia cargo sem de/para e invoice com valor não positivo", () => {
  assert.throws(
    () => resolveBillingOmieMainCategory("Diretor"),
    (error: unknown) => error instanceof OmieIntegrationError
      && error.message.includes("sem categoria")
  );
  assert.throws(
    () => buildBillingOmieAllocation({
      lob: "ADS",
      roleTitle: "Agente",
      finalAmount: 0,
      bonusAmount: 0,
      campaignAmount: 0,
      advanceAmount: 0
    }),
    (error: unknown) => error instanceof OmieIntegrationError
      && error.message.includes("maior que zero")
  );
  assert.throws(
    () => resolveBillingOmieDepartment("LOB_NOVA", "Agente"),
    (error: unknown) => error instanceof OmieIntegrationError
      && error.message.includes("Departamento Omie não configurado")
  );
  assert.throws(
    () => resolveBillingOmieDepartment(null, "Agente"),
    (error: unknown) => error instanceof OmieIntegrationError
      && error.message.includes("LOB não informada")
  );
});
