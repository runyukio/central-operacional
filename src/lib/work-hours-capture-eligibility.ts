import { isAgentJobTitle } from "@/lib/job-title-normalization";
import { normalizeOperationalToken } from "@/lib/work-hours-capture-integration-core";

export type CaptureEligibilityProfile = {
  roleTitle: string;
  operationalStatus: string;
  goLiveDate?: Date | string | null;
  deletedAt?: Date | null;
  skill?: string | null;
  lob: { name: string };
  team?: { name: string } | null;
  user?: { role?: { name: string } | null } | null;
  skillAssignments?: Array<{ skill: { name: string } }>;
};

const excludedClassifications = new Set([
  "STAFF", "TI", "IT", "LOGISTICA_TI", "TECNOLOGIA_DA_INFORMACAO", "TECNOLOGIA", "INFORMATION_TECHNOLOGY",
  "TRAINER", "TREINADOR", "TREINADORA", "TRAINEE", "TRAINEES", "TRAINING", "TREINAMENTO", "EM_TREINAMENTO",
  "NESTING", "ONBOARDING", "PRE_OPERACIONAL", "PRE_OPERACAO", "PRE_OPERATIONAL"
]);

function isCaptureProductionProfile(profile: CaptureEligibilityProfile) {
  if (profile.deletedAt || !isAgentJobTitle(profile.roleTitle)) return false;
  if (!["ATIVO", "ACTIVE", "ONLINE"].includes(normalizeOperationalToken(profile.operationalStatus))) return false;
  // Onboarding is also an operational skill with a fixed-hours rule. It must not
  // be confused with a pre-operational status/team; all other eligibility gates remain.
  const skills = [profile.skill, ...(profile.skillAssignments ?? []).map((item) => item.skill.name)]
    .filter((value) => normalizeOperationalToken(value) !== "ONBOARDING");
  const structuredValues = [profile.roleTitle, profile.lob.name, profile.team?.name, profile.user?.role?.name, ...skills];
  if (structuredValues.some((value) => {
    const token = normalizeOperationalToken(value);
    return [...excludedClassifications].some((excluded) => (`_${token}_`).includes(`_${excluded}_`));
  })) return false;
  return true;
}

// Expected exclusions (Staff, training, Nesting, inactive) are not registration errors.
export function getCaptureRegistrationIssue(profile: CaptureEligibilityProfile) {
  if (!isCaptureProductionProfile(profile)) return null;
  if (!profile.goLiveDate) return "MISSING_GO_LIVE" as const;
  if (!Number.isFinite(new Date(profile.goLiveDate).getTime())) return "INVALID_GO_LIVE" as const;
  return null;
}

export function isCaptureImportEligible(profile: CaptureEligibilityProfile, shiftDate: string) {
  if (!isCaptureProductionProfile(profile)) return false;
  // A current active status does not turn a pre-Go-Live historical slot into production.
  const goLiveDate = profile.goLiveDate ? new Date(profile.goLiveDate) : null;
  if (!goLiveDate || !Number.isFinite(goLiveDate.getTime())) return false;
  const goLive = goLiveDate.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(shiftDate) && goLive <= shiftDate;
}
