type SupervisorProfile = {
  roleTitle: string; operationalStatus: string; deletedAt: Date | null;
  wbLogin?: string; skill?: string | null;
  user: { status: string; deletedAt: Date | null; role: { name: string } } | null;
};
const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();

export function isActiveSpaceSupervisor(profile: SupervisorProfile) {
  // Meu Espaço follows operational supervision, not Quality supervision.
  if (normalized(profile.wbLogin || "") === "WB_HAILENE" || /QUALIDADE|QUALITY|\bQA\b/.test(normalized(`${profile.roleTitle} ${profile.skill || ""}`))) return false;
  return !profile.deletedAt && !profile.user?.deletedAt && profile.user?.status === "ACTIVE"
    && ["ATIVO", "ACTIVE"].includes(normalized(profile.operationalStatus))
    && (["SUPERVISOR", "SUPERVISAO"].includes(normalized(profile.roleTitle)) || normalized(profile.user.role.name) === "SUPERVISOR");
}

export function isCurrentSpacePartner(profile: Pick<SupervisorProfile, "operationalStatus" | "deletedAt" | "user">) {
  return !profile.deletedAt && !profile.user?.deletedAt && profile.user?.status !== "INACTIVE"
    && !["DESLIGADO", "DESLIGADA", "INATIVO", "INATIVA", "INACTIVE", "TERMINATED", "DESATIVADO"].includes(normalized(profile.operationalStatus));
}
