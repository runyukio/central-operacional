import { filterQualityAgents, QUALITY_CATEGORY_LABELS, type QualityCategory } from "@/lib/performance-quality";
import type { XlsxExportPayload } from "@/lib/xlsx-export";

type QualityMetrics = { correct: number; total: number; errors: number; quality: number };
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
  const metrics = (row: QualityMetrics) => [row.correct, row.total, row.errors, row.quality / 100];
  const headers = dashboard.selectedLob === "CEC"
    ? ["Pass Quantity", "Total auditado", "Fail Quantity", "Qualidade"]
    : ["Corretos", "Auditados", "Divergências", "Qualidade"];
  const agents = filterQualityAgents(dashboard.agents, search);
  return {
    fileName: `qualidade_${dashboard.selectedLob.toLowerCase()}_${dashboard.selectedCategory?.toLowerCase() ?? "todas"}_${dashboard.period.startDate}_${dashboard.period.endDate}.xlsx`,
    sheetName: "Resumo",
    autoFilter: true,
    headers: ["Início", "Fim", "LOB", "Categoria", "Visão", ...headers, "Casos sem categoria", "Busca na aba Agentes"],
    rows: [[dashboard.period.startDate, dashboard.period.endDate, dashboard.selectedLob, category,
      { daily: "Diária", weekly: "Semanal", monthly: "Mensal" }[dashboard.granularity], ...metrics(dashboard.summary), dashboard.unclassifiedTotal, search]],
    columnFormats: { 8: "0.00%" },
    sheets: [
      { sheetName: "Evolução", autoFilter: true, headers: ["Início do período", "Período", ...headers],
        rows: dashboard.trend.map((row) => [row.key, row.label, ...metrics(row)]), columnFormats: { 5: "0.00%" } },
      { sheetName: "Agentes", autoFilter: true, headers: ["Agente", "WB/Login", "LOB", "Supervisor", ...headers, "Última auditoria (UTC)"],
        rows: agents.map((agent) => [agent.employeeName, agent.wbLogin, agent.lob, agent.supervisor, ...metrics(agent), agent.lastAuditAt]),
        columnFormats: { 7: "0.00%" } }
    ]
  };
}
