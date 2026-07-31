import type { OmieCategoryAllocation } from "@/lib/omie-service";
import { OmieIntegrationError } from "@/lib/omie-service";

export const BILLING_OMIE_PROJECT_CODE = 10011279879;
export const BILLING_OMIE_DEPARTMENT_CODES = {
  OPERATIONS: "10171307486",
  ADS: "10171308942",
  CEC: "10171308292",
  TNS: "10171308836",
  WFM: "10171310973",
  RTA: "10177586351",
  FINANCE: "10171307888",
  PEOPLE: "10171308037",
  TECHNOLOGY: "10171308090"
} as const;
export const BILLING_OMIE_BONUS_CATEGORY_CODE = "2.02.04";
export const BILLING_OMIE_CAMPAIGN_CATEGORY_CODE = "2.02.99";
export const BILLING_OMIE_ADVANCE_DOCUMENT_TYPE = "ADI";
export const BILLING_OMIE_FISCAL_DOCUMENT_TYPE = "NF";

const MAIN_CATEGORY_BY_ROLE: Record<string, string> = {
  agent: "2.10.89",
  agente: "2.10.89",
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
  it: "2.10.90",
  ti: "2.10.90",
  logisticati: "2.10.90",
  logisticsit: "2.10.90",
  wfm: "2.10.96"
};

const MAIN_CATEGORY_BY_SKILL: Record<string, string> = {
  treinador: "2.10.95",
  treinadora: "2.10.95",
  treinadores: "2.10.95",
  trainer: "2.10.95",
  trainers: "2.10.95",
  training: "2.10.95",
  treinamento: "2.10.95",
  rta: "2.10.88",
  financeiro: "2.10.93",
  financial: "2.10.93",
  it: "2.10.90",
  ti: "2.10.90",
  logisticati: "2.10.90",
  logisticsit: "2.10.90"
};

const DEPARTMENT_BY_LOB: Record<string, keyof typeof BILLING_OMIE_DEPARTMENT_CODES> = {
  ads: "ADS",
  cec: "CEC",
  tns: "TNS",
  video: "OPERATIONS",
  videos: "OPERATIONS",
  comments: "OPERATIONS",
  comentarios: "OPERATIONS",
  project: "OPERATIONS",
  projetos: "OPERATIONS",
  operacao: "OPERATIONS",
  operacoes: "OPERATIONS"
};

const DEPARTMENT_BY_ROLE: Record<string, keyof typeof BILLING_OMIE_DEPARTMENT_CODES> = {
  wfm: "WFM",
  rta: "RTA",
  financeiro: "FINANCE",
  financial: "FINANCE",
  rh: "PEOPLE",
  recursoshumanos: "PEOPLE",
  humanresources: "PEOPLE",
  it: "TECHNOLOGY",
  ti: "TECHNOLOGY",
  logisticati: "TECHNOLOGY",
  logisticsit: "TECHNOLOGY",
  agente: "OPERATIONS",
  agent: "OPERATIONS",
  coordenador: "OPERATIONS",
  coordenadora: "OPERATIONS",
  qualidade: "OPERATIONS",
  quality: "OPERATIONS",
  supervisor: "OPERATIONS",
  supervisora: "OPERATIONS",
  supervisao: "OPERATIONS",
  supervision: "OPERATIONS"
};

const DEPARTMENT_BY_SKILL: Record<string, keyof typeof BILLING_OMIE_DEPARTMENT_CODES> = {
  rta: "RTA",
  financeiro: "FINANCE",
  financial: "FINANCE",
  rh: "PEOPLE",
  recursoshumanos: "PEOPLE",
  humanresources: "PEOPLE",
  it: "TECHNOLOGY",
  ti: "TECHNOLOGY",
  logisticati: "TECHNOLOGY",
  logisticsit: "TECHNOLOGY"
};

type BillingOmieAllocationInput = {
  lob?: string | null;
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
  departmentCode: string;
  departmentName: string;
  documentTypeCode: string | null;
  mainCategoryCode: string;
  categories: OmieCategoryAllocation[];
};

export function buildBillingOmieAllocation(input: BillingOmieAllocationInput): BillingOmieAllocation {
  const mainCategoryCode = resolveBillingOmieMainCategory(input.roleTitle, input.skill);
  const department = resolveBillingOmieDepartment(input.lob, input.roleTitle, input.skill);
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
    departmentCode: department.code,
    departmentName: department.name,
    // This allocation represents the fiscal invoice submitted by the employee.
    // An advance is a deduction in this invoice, not a replacement for its NF type.
    documentTypeCode: BILLING_OMIE_FISCAL_DOCUMENT_TYPE,
    mainCategoryCode,
    categories
  };
}

export function resolveBillingOmieDepartment(lob?: string | null, roleTitle?: string | null, skill?: string | null) {
  const normalizedLob = normalizeLookupKey(lob ?? "");
  const normalizedRole = normalizeRoleTitle(roleTitle ?? "");
  const normalizedSkill = normalizeRoleTitle(skill ?? "");
  const departmentKey = normalizedLob === "all"
    ? DEPARTMENT_BY_SKILL[normalizedSkill] || DEPARTMENT_BY_ROLE[normalizedRole]
    : DEPARTMENT_BY_LOB[normalizedLob];

  if (!departmentKey) {
    const source = normalizedLob === "all"
      ? `cargo/função ${String(roleTitle ?? "").trim() || "não informado"}`
      : `LOB ${String(lob ?? "").trim() || "não informada"}`;
    throw new OmieIntegrationError(`Departamento Omie não configurado para ${source}. O lançamento não foi enviado para evitar um departamento incorreto.`);
  }

  return {
    key: departmentKey,
    code: BILLING_OMIE_DEPARTMENT_CODES[departmentKey],
    name: departmentName(departmentKey)
  };
}

export function resolveBillingOmieMainCategory(roleTitle: string, skill?: string | null) {
  const normalizedRole = normalizeRoleTitle(roleTitle);
  const normalizedSkill = normalizeRoleTitle(skill ?? "");
  const categoryCode = categoryForSkill(normalizedSkill) || MAIN_CATEGORY_BY_ROLE[normalizedRole];
  if (!categoryCode) {
    throw new OmieIntegrationError(
      `Cargo/função sem categoria configurada para o Omie: ${String(roleTitle ?? "").trim() || "não informado"}.`
    );
  }
  return categoryCode;
}

function categoryForSkill(normalizedSkill: string) {
  if (normalizedSkill.startsWith("treinad") || normalizedSkill.startsWith("train")) return "2.10.95";
  return MAIN_CATEGORY_BY_SKILL[normalizedSkill];
}

function normalizeRoleTitle(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeLookupKey(value: string) {
  return normalizeRoleTitle(value).replace(/lob$/, "");
}

function departmentName(key: keyof typeof BILLING_OMIE_DEPARTMENT_CODES) {
  const labels: Record<keyof typeof BILLING_OMIE_DEPARTMENT_CODES, string> = {
    OPERATIONS: "OPERAÇÕES",
    ADS: "ADS",
    CEC: "CEC",
    TNS: "TNS",
    WFM: "WFM",
    RTA: "RTA",
    FINANCE: "Financeiro",
    PEOPLE: "Gestão de Pessoas",
    TECHNOLOGY: "Tecnologia"
  };
  return labels[key];
}

function roundCurrency(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
