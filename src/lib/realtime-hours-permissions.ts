import { isActiveUser, normalizeRole, type PermissionUser } from "@/lib/permissions";

const realtimeHoursMappingAllowedEmails = new Set(["runyukio@gmail.com"]);
const realtimeHoursCaptureRoles = new Set(["ADMIN", "GESTOR", "SUPERVISOR", "WFM", "COORDENADOR", "GERENTE"]);

export function canManageRealtimeHoursMappings(email?: string | null) {
  return realtimeHoursMappingAllowedEmails.has(String(email ?? "").trim().toLowerCase());
}

export function canAccessRealtimeHoursCapture(user?: PermissionUser | null) {
  const actor = user ?? {};
  return isActiveUser(actor) && realtimeHoursCaptureRoles.has(normalizeRole(actor.role));
}

export function canRequestRealtimeHoursCaptureAdjustment(user?: PermissionUser | null) {
  return canAccessRealtimeHoursCapture(user);
}

export function canAccessOwnRealtimeHours(user?: PermissionUser | null) {
  const actor = user ?? {};
  return isActiveUser(actor) && normalizeRole(actor.role) !== "CLIENT";
}
