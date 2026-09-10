import { normalizeRole } from "./permissions";

// Owner-authorized exception: Hellida may justify absences of her direct team.
// Match the immutable profile ID, never a request-supplied name or WB/login.
const ownTeamAbsenceManagers = new Set(["cmpbf948w000n39oj3c3p6m0o"]);

export function hasOwnTeamAbsenceDelegation(user: {
  role: { name: string };
  status: string;
  deletedAt?: Date | null;
  employeeProfile?: { id: string; deletedAt?: Date | null } | null;
} | null) {
  return Boolean(user && user.status === "ACTIVE" && !user.deletedAt
    && normalizeRole(user.role.name) === "GESTOR" && user.employeeProfile
    && !user.employeeProfile.deletedAt && ownTeamAbsenceManagers.has(user.employeeProfile.id));
}

export function isDelegatedAbsenceStatus(status: string) {
  return ["FALTA", "FALTA_JUSTIFICADA", "FALTA_INJUSTIFICADA"].includes(status);
}
