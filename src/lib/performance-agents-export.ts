import type { XlsxExportPayload } from "@/lib/xlsx-export";

export type PerformanceAgentExportRow = {
  periodStart: string;
  periodEnd: string;
  employeeName: string;
  wbLogin: string;
  lob: string;
  supervisor: string;
  shift: string;
  submit: number;
  outputAveragePerDay: number;
  daysWithData: number;
  moderationSeconds: number;
  ahtSeconds: number;
  cpdAverage?: number;
  cpdTickets?: number;
  cpdDays?: number;
  quality: number;
  qualityCorrect: number;
  qualityTotal: number;
  qualityErrors: number;
};

export function buildPerformanceAgentsExportPayload(input: {
  period: { startDate: string; endDate: string };
  view: "monthly" | "weekly" | "daily";
  selectedLob: string;
  agents: PerformanceAgentExportRow[];
  generatedAt?: Date;
}): XlsxExportPayload {
  const generatedAt = input.generatedAt ?? new Date();
  const lobToken = input.selectedLob.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_") || "todas";

  return {
    fileName: `performance_agentes_${lobToken}_${input.period.startDate}_${input.period.endDate}_${generatedAt.toISOString().slice(0, 10)}.xlsx`,
    sheetName: "Agentes",
    autoFilter: true,
    headers: [
      "periodo_inicio",
      "periodo_fim",
      "visao",
      "agente",
      "wb_login",
      "lob",
      "supervisor",
      "turno",
      "output_total",
      "output_medio_dia",
      "dias_com_dados",
      "moderacao_segundos",
      "aht_segundos",
      "cpd_medio",
      "cpd_tickets",
      "cpd_dias",
      "qualidade_percentual",
      "qualidade_corretos",
      "qualidade_total",
      "qualidade_erros"
    ],
    rows: input.agents.map((agent) => [
      agent.periodStart,
      agent.periodEnd,
      performanceExportViewLabel(input.view),
      agent.employeeName,
      agent.wbLogin,
      agent.lob,
      agent.supervisor,
      agent.shift,
      agent.submit,
      agent.outputAveragePerDay,
      agent.daysWithData,
      agent.moderationSeconds,
      agent.ahtSeconds,
      agent.cpdAverage ?? 0,
      agent.cpdTickets ?? 0,
      agent.cpdDays ?? 0,
      agent.quality,
      agent.qualityCorrect,
      agent.qualityTotal,
      agent.qualityErrors
    ])
  };
}

function performanceExportViewLabel(view: "monthly" | "weekly" | "daily") {
  if (view === "daily") return "Diária";
  if (view === "weekly") return "Semanal";
  return "Mensal";
}
