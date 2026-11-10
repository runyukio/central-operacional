import { filterQualityAgents, QUALITY_CATEGORY_LABELS, QUALITY_EXTRA_INDICATORS, type QualityCategory, type QualityIndicators } from "@/lib/performance-quality";
import type { XlsxExportPayload } from "@/lib/xlsx-export";

type QualityMetrics = { correct: number; total: number; errors: number; quality: number; indicators?: QualityIndicators };
type QualityExportDashboard = {
  period: { startDate: string; endDate: string };
  selectedLob: string;
  selectedCategory: QualityCategory | null;
  granularity: "daily" | "weekly" | "monthly";
  unclassifiedTotal: number;
  summary: QualityMetrics;
  trend: Array<QualityMetrics & { key: string; label: string }>;
  agents: Array<QualityMetrics & { employeeName: string; wbLogin: string; lob: string; supervisor: string; lastAuditAt: string }>;
};

export function buildPerformanceQualityExportPayload(dashboard: QualityExportDashboard, search = ""): XlsxExportPayload {
  const category = dashboard.selectedCategory ? QUALITY_CATEGORY_LABELS[dashboard.selectedCategory] : "Todas";
  const extra = dashboard.selectedLob === "CEC" ? [] : QUALITY_EXTRA_INDICATORS;
  const metrics = (row: QualityMetrics) => [row.correct, row.total, row.errors, (row.indicators?.accuracy ?? row.quality) / 100,
    ...extra.map((metric) => { const value = row.indicators?.[metric.key]; return value == null ? null : metric.percent ? value / 100 : value; })];
  const formats = (offset: number) => Object.fromEntries([[offset + 3, "0.00%"], ...extra.flatMap((metric, index) => metric.percent ? [[offset + 4 + index, "0.00%"]] : [])]);
  const headers = dashboard.selectedLob === "CEC"
    ? ["Pass Quantity", "Total auditado", "Fail Quantity", "Qualidade"]
    : ["Corretos", "Auditados", "Divergências", "Accuracy", ...extra.map((metric) => metric.label)];
  const agents = filterQualityAgents(dashboard.agents, search);
  return {
    fileName: `qualidade_${dashboard.selectedLob.toLowerCase()}_${dashboard.selectedCategory?.toLowerCase() ?? "todas"}_${dashboard.period.startDate}_${dashboard.period.endDate}.xlsx`,
    sheetName: "Resumo",
    autoFilter: true,
    headers: ["Início", "Fim", "LOB", "Categoria", "Visão", ...headers, "Casos sem categoria", "Busca na aba Agentes"],
    rows: [[dashboard.period.startDate, dashboard.period.endDate, dashboard.selectedLob, category,
      { daily: "Diária", weekly: "Semanal", monthly: "Mensal" }[dashboard.granularity], ...metrics(dashboard.summary), dashboard.unclassifiedTotal, search]],
    columnFormats: formats(5),
    sheets: [
      { sheetName: "Evolução", autoFilter: true, headers: ["Início do período", "Período", ...headers],
        rows: dashboard.trend.map((row) => [row.key, row.label, ...metrics(row)]), columnFormats: formats(2) },
      { sheetName: "Agentes", autoFilter: true, headers: ["Agente", "WB/Login", "LOB", "Supervisor", ...headers, "Última auditoria (UTC)"],
        rows: agents.map((agent) => [agent.employeeName, agent.wbLogin, agent.lob, agent.supervisor, ...metrics(agent), agent.lastAuditAt]),
        columnFormats: formats(4) }
    ]
  };
}
