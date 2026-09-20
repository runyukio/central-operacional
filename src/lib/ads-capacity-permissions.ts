import { canAccessAdsStaffCoverage, canAccessPerformance, type PermissionUser } from "@/lib/permissions";

export function canAccessAdsCapacity(user: PermissionUser) {
  return canAccessAdsStaffCoverage(user) && canAccessPerformance(user);
}
