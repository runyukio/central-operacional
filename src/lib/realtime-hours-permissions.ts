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

export function canAccessOwnRealtimeHours(user?: PermissionUser | null) {
  const actor = user ?? {};
  return isActiveUser(actor) && roleHasCapability(actor.role, "PERSONAL");
}
