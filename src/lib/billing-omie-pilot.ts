import type { OmieCategoryAllocation } from "@/lib/omie-service";
import { OmieIntegrationError } from "@/lib/omie-service";
import {
  BILLING_OMIE_BONUS_CATEGORY_CODE,
  BILLING_OMIE_PILOT_MAIN_CATEGORY_CODE,
  isBillingOmiePilotTarget
} from "@/lib/billing-omie-pilot-constants";

type BillingOmiePilotInput = {
  referenceMonth: string;
  wbLogin: string;
  finalAmount: number;
  bonusAmount: number;
  campaignAmount: number;
  advanceAmount: number;
  discountAmount: number;
  otherAdjustmentAmount: number;
};

export function buildBillingOmiePilot(input: BillingOmiePilotInput): {
  documentAmount: number;
  categories: OmieCategoryAllocation[];
} {
  if (!isBillingOmiePilotTarget(input.referenceMonth, input.wbLogin)) {
    throw new OmieIntegrationError(
      "O envio ao Omie está em piloto restrito ao Pedro/WFM no Billing de julho."
    );
  }

  const unsupportedAmounts = [
    input.campaignAmount,
    input.advanceAmount,
    input.discountAmount,
    input.otherAdjustmentAmount
  ].map(roundCurrency);
  if (unsupportedAmounts.some((amount) => amount !== 0)) {
    throw new OmieIntegrationError(
      "O piloto do Omie aceita apenas o rateio principal e bônus. Os demais de/para ainda precisam ser configurados."
    );
  }

  const documentAmount = roundCurrency(input.finalAmount);
  const bonusAmount = roundCurrency(input.bonusAmount);
  const mainAmount = roundCurrency(documentAmount - bonusAmount);
  if (documentAmount <= 0 || bonusAmount < 0 || mainAmount < 0) {
    throw new OmieIntegrationError("Os valores do piloto não formam um rateio válido para o Omie.");
  }

  const categories: OmieCategoryAllocation[] = [
    { code: BILLING_OMIE_PILOT_MAIN_CATEGORY_CODE, value: mainAmount }
  ];
  if (bonusAmount > 0) categories.push({ code: BILLING_OMIE_BONUS_CATEGORY_CODE, value: bonusAmount });
  return { documentAmount, categories };
}

function roundCurrency(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
