import type { OmieCategoryAllocation } from "@/lib/omie-service";
import { OmieIntegrationError } from "@/lib/omie-service";

export const BILLING_OMIE_PROJECT_CODE = 10011279879;
export const BILLING_OMIE_BONUS_CATEGORY_CODE = "2.02.04";
export const BILLING_OMIE_CAMPAIGN_CATEGORY_CODE = "2.02.99";
export const BILLING_OMIE_ADVANCE_DOCUMENT_TYPE = "ADI";

const MAIN_CATEGORY_BY_ROLE: Record<string, string> = {
  agent: "2.10.99",
  agente: "2.10.99",
  coordinator: "2.10.89",
  coordenador: "2.10.89",
  coordenadora: "2.10.89",
  qualidade: "2.10.98",
  quality: "2.10.98",
  supervisor: "2.10.97",
  supervisora: "2.10.97",
  supervisao: "2.10.97",
  supervision: "2.10.97",
  rh: "2.10.94",
  recursoshumanos: "2.10.94",
  humanresources: "2.10.94",
  rta: "2.10.88",
  financeiro: "2.10.93",
  financial: "2.10.93",
  it: "2.10.93",
  ti: "2.10.93",
  logisticati: "2.10.93",
  logisticsit: "2.10.93",
  wfm: "2.10.96"
};

const MAIN_CATEGORY_BY_SKILL: Record<string, string> = {
  rta: "2.10.88",
  financeiro: "2.10.93",
  financial: "2.10.93",
  it: "2.10.93",
  ti: "2.10.93",
  logisticati: "2.10.93",
  logisticsit: "2.10.93"
};

type BillingOmieAllocationInput = {
  roleTitle: string;
  skill?: string | null;
  finalAmount: number;
  bonusAmount: number;
  campaignAmount: number;
  advanceAmount: number;
};

export type BillingOmieAllocation = {
  documentAmount: number;
  projectCode: number;
  documentTypeCode: string | null;
  mainCategoryCode: string;
  categories: OmieCategoryAllocation[];
};

export function buildBillingOmieAllocation(input: BillingOmieAllocationInput): BillingOmieAllocation {
  const mainCategoryCode = resolveBillingOmieMainCategory(input.roleTitle, input.skill);
  const documentAmount = roundCurrency(input.finalAmount);
  const bonusAmount = roundCurrency(input.bonusAmount);
  const campaignAmount = roundCurrency(input.campaignAmount);
  const advanceAmount = roundCurrency(input.advanceAmount);
  const mainAmount = roundCurrency(documentAmount - bonusAmount - campaignAmount);

  if (![documentAmount, bonusAmount, campaignAmount, advanceAmount, mainAmount].every(Number.isFinite)) {
    throw new OmieIntegrationError("Os valores do Billing não são válidos para o lançamento no Omie.");
  }
  if (documentAmount <= 0) {
    throw new OmieIntegrationError("O valor final do invoice precisa ser maior que zero.");
  }
  if (bonusAmount < 0 || campaignAmount < 0 || advanceAmount < 0 || mainAmount < 0) {
    throw new OmieIntegrationError("Os valores do Billing não formam um rateio válido para o Omie.");
  }

  const categories: OmieCategoryAllocation[] = [];
  if (mainAmount > 0) categories.push({ code: mainCategoryCode, value: mainAmount });
  if (bonusAmount > 0) categories.push({ code: BILLING_OMIE_BONUS_CATEGORY_CODE, value: bonusAmount });
  if (campaignAmount > 0) categories.push({ code: BILLING_OMIE_CAMPAIGN_CATEGORY_CODE, value: campaignAmount });

  return {
    documentAmount,
    projectCode: BILLING_OMIE_PROJECT_CODE,
    documentTypeCode: advanceAmount > 0 ? BILLING_OMIE_ADVANCE_DOCUMENT_TYPE : null,
    mainCategoryCode,
    categories
  };
}

export function resolveBillingOmieMainCategory(roleTitle: string, skill?: string | null) {
  const normalizedRole = normalizeRoleTitle(roleTitle);
  const normalizedSkill = normalizeRoleTitle(skill ?? "");
  const categoryCode = MAIN_CATEGORY_BY_SKILL[normalizedSkill] || MAIN_CATEGORY_BY_ROLE[normalizedRole];
  if (!categoryCode) {
    throw new OmieIntegrationError(
      `Cargo/função sem categoria configurada para o Omie: ${String(roleTitle ?? "").trim() || "não informado"}.`
    );
  }
  return categoryCode;
}

function normalizeRoleTitle(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function roundCurrency(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
