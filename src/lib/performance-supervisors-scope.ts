type Supervisor = { operationalStatus: string; deletedAt: Date | null; user: { status: string; deletedAt: Date | null } | null };

export function isActivePerformanceSupervisor(supervisor: Supervisor | null) {
  return Boolean(supervisor && !supervisor.deletedAt && supervisor.user && !supervisor.user.deletedAt
    && supervisor.user.status === "ACTIVE" && ["ATIVO", "ACTIVE"].includes(supervisor.operationalStatus.trim().toUpperCase()));
}

export function isVisiblePerformanceAgent(agent: { operationalStatus: string; user?: { status: string; deletedAt: Date | null } | null }) {
  return ["ATIVO", "ACTIVE"].includes(agent.operationalStatus.trim().toUpperCase())
    && !agent.user?.deletedAt && (!agent.user || agent.user.status === "ACTIVE");
}
