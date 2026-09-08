type SupervisorProfile = {
  roleTitle: string; operationalStatus: string; deletedAt: Date | null;
  user: { status: string; deletedAt: Date | null; role: { name: string } } | null;
};
const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();

export function isActiveSpaceSupervisor(profile: SupervisorProfile) {
  return !profile.deletedAt && !profile.user?.deletedAt && profile.user?.status === "ACTIVE"
    && ["ATIVO", "ACTIVE"].includes(normalized(profile.operationalStatus))
    && (["SUPERVISOR", "SUPERVISAO"].includes(normalized(profile.roleTitle)) || normalized(profile.user.role.name) === "SUPERVISOR");
}
