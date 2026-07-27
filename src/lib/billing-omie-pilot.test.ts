import assert from "node:assert/strict";
import test from "node:test";

import { buildBillingOmiePilot } from "./billing-omie-pilot";
import { OmieIntegrationError } from "./omie-service";

test("monta o rateio do piloto de Pedro entre WFM e bônus", () => {
  assert.deepEqual(buildBillingOmiePilot({
    referenceMonth: "2026-07",
    wbLogin: "wb_pedros",
    finalAmount: 5427.44,
    bonusAmount: 200,
    campaignAmount: 0,
    advanceAmount: 0,
    discountAmount: 0,
    otherAdjustmentAmount: 0
  }), {
    documentAmount: 5427.44,
    categories: [
      { code: "2.10.96", value: 5227.44 },
      { code: "2.02.04", value: 200 }
    ]
  });
});

test("bloqueia colaboradores fora do piloto", () => {
  assert.throws(
    () => buildBillingOmiePilot({
      referenceMonth: "2026-07",
      wbLogin: "wb_outra_pessoa",
      finalAmount: 1000,
      bonusAmount: 0,
      campaignAmount: 0,
      advanceAmount: 0,
      discountAmount: 0,
      otherAdjustmentAmount: 0
    }),
    (error: unknown) => error instanceof OmieIntegrationError
      && error.message.includes("piloto restrito")
  );
});

test("bloqueia ajustes sem de/para durante o piloto", () => {
  assert.throws(
    () => buildBillingOmiePilot({
      referenceMonth: "2026-07",
      wbLogin: "wb_pedros",
      finalAmount: 5227.44,
      bonusAmount: 0,
      campaignAmount: 0,
      advanceAmount: 500,
      discountAmount: 0,
      otherAdjustmentAmount: 0
    }),
    (error: unknown) => error instanceof OmieIntegrationError
      && error.message.includes("demais de/para")
  );
});
