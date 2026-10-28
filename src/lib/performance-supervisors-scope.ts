type Supervisor = { operationalStatus: string; deletedAt: Date | null; user: { status: string; deletedAt: Date | null } | null };

export function isActivePerformanceSupervisor(supervisor: Supervisor | null) {
  return Boolean(supervisor && !supervisor.deletedAt && supervisor.user && !supervisor.user.deletedAt
    && supervisor.user.status === "ACTIVE" && ["ATIVO", "ACTIVE"].includes(supervisor.operationalStatus.trim().toUpperCase()));
}
