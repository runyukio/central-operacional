import { normalizeRole } from "@/lib/permissions";

export class QualityWeeklyError extends Error {
  constructor(message: string, public status = 400, public details?: unknown) { super(message); }
}

export type QualityIdentity = { id: string; email: string; name: string; role: string; status: string; deletedAt?: Date | null; wbLogin?: string | null };

// The owner explicitly authorized all active ADM/WFM users on 2026-09-08.
export function hasQualityWeeklyAccess(user: QualityIdentity) {
  return user.status === "ACTIVE" && !user.deletedAt
    && ["ADMIN", "WFM"].includes(normalizeRole(user.role));
}
