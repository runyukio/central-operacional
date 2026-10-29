import { roleHasCapability } from "@/lib/access-control";
import { isActiveUser, type PermissionUser } from "@/lib/permissions";

export function canManageRealtimeHoursMappings(user?: PermissionUser | null) {
  const actor = user ?? {};
  return isActiveUser(actor) && roleHasCapability(actor.role, "CAPTURE_MAPPINGS");
}

export function canAccessRealtimeHoursCapture(user?: PermissionUser | null) {
  const actor = user ?? {};
  return isActiveUser(actor) && roleHasCapability(actor.role, "CAPTURE");
}

export function canAccessRealtimeHoursActivity(user?: PermissionUser | null) {
  const actor = user ?? {};
  if (!isActiveUser(actor)) return false;
  // This sensitive view has its own explicit role list. Coordinator aliases
  // used elsewhere must not silently expand access to browser activity.
  return ["ADMIN", "ADMINISTRADOR", "ADMINISTRADORA", "ADMIN CENTRAL", "GESTOR", "MANAGEMENT", "GERENTE", "MANAGER", "SUPERVISOR", "WFM"]
    .includes(String(actor.role ?? "").trim().toUpperCase());
}

export function canAccessOwnRealtimeHours(user?: PermissionUser | null) {
  const actor = user ?? {};
  return isActiveUser(actor) && roleHasCapability(actor.role, "PERSONAL");
}
