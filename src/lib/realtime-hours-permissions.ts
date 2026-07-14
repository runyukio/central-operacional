import { isActiveUser, normalizeRole, type PermissionUser } from "@/lib/permissions";
import { normalizeComparableJobTitle } from "@/lib/job-title-normalization";

const realtimeHoursMappingAllowedEmails = new Set(["runyukio@gmail.com"]);
const realtimeHoursCaptureRoles = new Set(["ADMIN", "GESTOR", "SUPERVISOR", "WFM", "COORDENADOR", "GERENTE", "TI"]);
const realtimeHoursItJobTitles = new Set(["it", "ti", "tecnologia da informacao", "information technology"]);
const realtimeHoursAdjustmentRoles = new Set(["ADMIN", "GESTOR", "SUPERVISOR", "WFM"]);
const realtimeHoursAdjustmentApprovalRoles = new Set(["ADMIN", "GESTOR", "WFM"]);

export function canManageRealtimeHoursMappings(email?: string | null) {
  return realtimeHoursMappingAllowedEmails.has(String(email ?? "").trim().toLowerCase());
}

export function canAccessRealtimeHoursCapture(user?: PermissionUser | null) {
  const actor = user ?? {};
  if (!isActiveUser(actor)) return false;
  if (realtimeHoursCaptureRoles.has(normalizeRole(actor.role))) return true;
  return [actor.roleTitle, actor.jobTitle]
    .some((title) => realtimeHoursItJobTitles.has(normalizeComparableJobTitle(title)));
}

export function canRequestRealtimeHoursCaptureAdjustment(user?: PermissionUser | null) {
  const actor = user ?? {};
  return isActiveUser(actor) && realtimeHoursAdjustmentRoles.has(normalizeRole(actor.role));
}

export function canApproveRealtimeHoursCaptureAdjustment(user?: PermissionUser | null) {
  const actor = user ?? {};
  return isActiveUser(actor) && realtimeHoursAdjustmentApprovalRoles.has(normalizeRole(actor.role));
}

export function canAccessOwnRealtimeHours(user?: PermissionUser | null) {
  const actor = user ?? {};
  return isActiveUser(actor) && normalizeRole(actor.role) !== "CLIENT";
}
