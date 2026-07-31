import { normalizeComparableJobTitle } from "@/lib/job-title-normalization";

export const BILLING_STAFF_RATE_DEFAULTS = {
  HR: {
    day: 25.56818182,
    night: 29.40340909
  },
  FINANCE: {
    day: 34.09090909,
    night: 39.20454545
  }
} as const;

export const BILLING_STAFF_RATE_RULES = [
  { skillKey: "coordinator", displayName: "Coordinator", dayKey: "STAFF_COORDINATOR_DAY_RATE", nightKey: "STAFF_COORDINATOR_NIGHT_RATE", aliases: ["coordinator", "coordenador", "coordenadora"] },
  { skillKey: "it_team", displayName: "TI", dayKey: "STAFF_IT_TEAM_DAY_RATE", nightKey: "STAFF_IT_TEAM_NIGHT_RATE", aliases: ["it team", "it", "ti", "logistica/ti", "logistica ti"] },
  { skillKey: "quality_analyst", displayName: "Quality Analyst", dayKey: "STAFF_QUALITY_ANALYST_DAY_RATE", nightKey: "STAFF_QUALITY_ANALYST_NIGHT_RATE", aliases: ["quality analyst", "quality", "qa", "analista de qualidade", "qualidade"] },
  { skillKey: "rta", displayName: "RTA", dayKey: "STAFF_RTA_DAY_RATE", nightKey: "STAFF_RTA_NIGHT_RATE", aliases: ["rta"] },
  { skillKey: "supervisor", displayName: "Supervisor", dayKey: "STAFF_SUPERVISOR_DAY_RATE", nightKey: "STAFF_SUPERVISOR_NIGHT_RATE", aliases: ["supervisor", "supervisora"] },
  { skillKey: "trainer", displayName: "Trainer", dayKey: "STAFF_TRAINER_DAY_RATE", nightKey: "STAFF_TRAINER_NIGHT_RATE", aliases: ["trainer", "treinador", "treinadora"] },
  { skillKey: "wfm_i", displayName: "WFM I", dayKey: "STAFF_WFM_I_DAY_RATE", nightKey: "STAFF_WFM_I_NIGHT_RATE", aliases: ["wfm i", "wfmi", "wfm 1"] },
  { skillKey: "wfm_ii", displayName: "WFM II", dayKey: "STAFF_WFM_II_DAY_RATE", nightKey: "STAFF_WFM_II_NIGHT_RATE", aliases: ["wfm ii", "wfmii", "wfm 2"] },
  { skillKey: "wfm_iii", displayName: "WFM III", dayKey: "STAFF_WFM_III_DAY_RATE", nightKey: "STAFF_WFM_III_NIGHT_RATE", aliases: ["wfm iii", "wfmiii", "wfm 3"] },
  { skillKey: "hr", displayName: "RH", dayKey: "STAFF_HR_DAY_RATE", nightKey: "STAFF_HR_NIGHT_RATE", aliases: ["rh", "recursos humanos", "human resources"] },
  { skillKey: "finance", displayName: "Financeiro", dayKey: "STAFF_FINANCE_DAY_RATE", nightKey: "STAFF_FINANCE_NIGHT_RATE", aliases: ["financeiro", "finance", "financial"] }
] as const;

export type BillingStaffRateRule = (typeof BILLING_STAFF_RATE_RULES)[number];
export type BillingStaffRateSource = "Skill" | "Cargo/Função";
export type BillingShiftBucket = "MANHA" | "TARDE" | "NOITE";

const STAFF_ROLE_TITLE_FALLBACK_KEYS = new Set<BillingStaffRateRule["skillKey"]>(["hr", "finance"]);

export function resolveBillingStaffRateRule(value?: string | null): BillingStaffRateRule | null {
  const normalizedValue = normalizeComparableJobTitle(value);
  if (!normalizedValue) return null;
  return BILLING_STAFF_RATE_RULES.find((rule) => rule.aliases.some((alias) => normalizeComparableJobTitle(alias) === normalizedValue)) ?? null;
}

export function resolveEmployeeBillingStaffRateRule(employee: { skill?: string | null; roleTitle?: string | null }): {
  rule: BillingStaffRateRule;
  source: BillingStaffRateSource;
} | null {
  const skillRule = resolveBillingStaffRateRule(employee.skill);
  if (skillRule) return { rule: skillRule, source: "Skill" };

  const roleTitleRule = resolveBillingStaffRateRule(employee.roleTitle);
  if (roleTitleRule && STAFF_ROLE_TITLE_FALLBACK_KEYS.has(roleTitleRule.skillKey)) {
    return { rule: roleTitleRule, source: "Cargo/Função" };
  }

  return null;
}

export function resolveEmployeeBillingStaffRateKey(
  employee: { skill?: string | null; roleTitle?: string | null },
  shiftBucket: BillingShiftBucket
): {
  rule: BillingStaffRateRule;
  source: BillingStaffRateSource;
  rateKey: BillingStaffRateRule["dayKey"] | BillingStaffRateRule["nightKey"];
} | null {
  const resolved = resolveEmployeeBillingStaffRateRule(employee);
  if (!resolved) return null;
  return {
    ...resolved,
    rateKey: shiftBucket === "NOITE" ? resolved.rule.nightKey : resolved.rule.dayKey
  };
}
