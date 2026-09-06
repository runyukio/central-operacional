import { normalizeComparableJobTitle } from "@/lib/job-title-normalization";
import { normalizeRole } from "@/lib/permissions";

export function canAssignSecurityJobTitle(actorRole: string, previousTitle: string | null | undefined, nextTitle: string | null | undefined) {
  if (nextTitle === undefined) return true;
  const previous = normalizeComparableJobTitle(previousTitle);
  const next = normalizeComparableJobTitle(nextTitle);
  if (previous === next) return true;
  return (previous !== "financeiro" && next !== "financeiro") || normalizeRole(actorRole) === "ADMIN";
}
