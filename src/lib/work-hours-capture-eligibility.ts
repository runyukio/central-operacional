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

export function isCaptureImportEligible(profile: CaptureEligibilityProfile, shiftDate: string) {
  if (profile.deletedAt || !isAgentJobTitle(profile.roleTitle)) return false;
  if (!["ATIVO", "ACTIVE", "ONLINE"].includes(normalizeOperationalToken(profile.operationalStatus))) return false;
  const structuredValues = [profile.roleTitle, profile.lob.name, profile.team?.name, profile.user?.role?.name,
    profile.skill, ...(profile.skillAssignments ?? []).map((item) => item.skill.name)];
  if (structuredValues.some((value) => {
    const token = normalizeOperationalToken(value);
    return [...excludedClassifications].some((excluded) => (`_${token}_`).includes(`_${excluded}_`));
  })) return false;
  // A current active status does not turn a pre-Go-Live historical slot into production.
  const goLiveDate = profile.goLiveDate ? new Date(profile.goLiveDate) : null;
  if (!goLiveDate || !Number.isFinite(goLiveDate.getTime())) return false;
  const goLive = goLiveDate.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(shiftDate) && goLive <= shiftDate;
}
