import assert from "node:assert/strict";
import test from "node:test";

import {
  BILLING_OMIE_PROJECT_CODE,
  buildBillingOmieAllocation,
  resolveBillingOmieMainCategory
} from "./billing-omie-allocation";
import { OmieIntegrationError } from "./omie-service";

test("resolve as categorias principais por cargo/função", () => {
  assert.equal(resolveBillingOmieMainCategory("Agente"), "2.10.99");
  assert.equal(resolveBillingOmieMainCategory("Coordenador"), "2.10.89");
  assert.equal(resolveBillingOmieMainCategory("Qualidade"), "2.10.98");
  assert.equal(resolveBillingOmieMainCategory("WFM"), "2.10.96");
});

test("mantém correção, desconto e outros no saldo da categoria principal", () => {
  assert.deepEqual(buildBillingOmieAllocation({
    roleTitle: "Agente",
    finalAmount: 980.38,
    bonusAmount: 0,
    campaignAmount: 0,
    advanceAmount: 0
  }), {
    documentAmount: 980.38,
    projectCode: BILLING_OMIE_PROJECT_CODE,
    documentTypeCode: null,
    mainCategoryCode: "2.10.99",
    categories: [{ code: "2.10.99", value: 980.38 }]
  });
});

test("rateia bônus e campanha e usa ADI como tipo documental quando há adiantamento", () => {
  assert.deepEqual(buildBillingOmieAllocation({
    roleTitle: "WFM",
    finalAmount: 5_527.44,
    bonusAmount: 200,
    campaignAmount: 100,
    advanceAmount: 300
  }), {
    documentAmount: 5_527.44,
    projectCode: BILLING_OMIE_PROJECT_CODE,
    documentTypeCode: "ADI",
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
    () => resolveBillingOmieMainCategory("Supervisor"),
    (error: unknown) => error instanceof OmieIntegrationError
      && error.message.includes("sem categoria")
  );
  assert.throws(
    () => buildBillingOmieAllocation({
      roleTitle: "Agente",
      finalAmount: 0,
      bonusAmount: 0,
      campaignAmount: 0,
      advanceAmount: 0
    }),
    (error: unknown) => error instanceof OmieIntegrationError
      && error.message.includes("maior que zero")
  );
});
