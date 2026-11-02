/** Only the generic WFM request bypasses the supervisor approval stage. */
export function isDirectWfmRequest(type: string) {
  return type.trim().toUpperCase() === "WFM";
}

/** Administrative refusal is available before final approval and before any application. */
export function canAdminRejectRequest(role: string, status: string, payload: Record<string, unknown> | null = null) {
  if (role !== "ADMIN" || !["ABERTO", "EM_ANALISE", "AGUARDANDO_APROVACAO", "AJUSTE_SOLICITADO", "Aberto", "Em análise"].includes(status)) return false;
  return payload?.stage !== "DONE" && payload?.scheduleApplicationStatus !== "APPLIED" && !payload?.scheduleAppliedAt
    && payload?.shiftChangeApplicationStatus !== "APPLIED" && !payload?.shiftChangeAppliedAt
    && payload?.monthlyAdvanceApplicationStatus !== "APPLIED";
}
