import type { getWorkstationSites } from "@/lib/workstation-sites-service";
import { siteClassificationLabels } from "@/lib/workstation-site-classification";
import { buildXlsxResponse, xlsxDurationFormat } from "@/lib/xlsx-export";

type SiteReport = Extract<Awaited<ReturnType<typeof getWorkstationSites>>, { success: true }>;

export function buildWorkstationSitesReport(data: SiteReport) {
  return buildXlsxResponse({
    fileName: `atividades_sites_${data.startDate}_${data.endDate}.xlsx`, sheetName: "Resumo",
    headers: ["Campo", "Valor"], rows: [
      ["Início", data.startDate], ["Fim (inclusive)", data.endDate], ["Fuso horário", "America/Sao_Paulo"],
      ["LOB", data.filters.lob || "Todas"], ["Turno", data.filters.shift || "Todos"],
      ["Agente/estação", data.filters.agentKey || "Todos os permitidos"], ["Busca de domínio", data.filters.search],
      ["Classificação", data.filters.classification ? siteClassificationLabels[data.filters.classification] : "Todas"],
      ["Domínios", data.summary.domains], ["Tempo em sites (segundos)", data.summary.totalSeconds],
      ["Produtivo (segundos)", data.summary.productiveSeconds], ["Improdutivo (segundos)", data.summary.unproductiveSeconds],
      ["Sem classificação (segundos)", data.summary.unclassifiedSeconds],
      ["Critério", "Classificação atual do domínio aplicada ao período consultado"],
      ["Disponibilidade", "Somente registros ainda disponíveis conforme a retenção da captura"],
      ["Registros", "Intervalos capturados; não representam quantidade de visitas"],
      ["Equipe", "LOB, turno e supervisor do cadastro atual"]
    ], sheets: [
      { sheetName: "Sites", headers: ["Domínio", "Classificação", "Tempo", "Segundos", "Agentes/estações", "Registros"],
        rows: data.sites.map((site) => [site.domain, siteClassificationLabels[site.classification], site.seconds / 86400, site.seconds, site.agents, site.segments]),
        columnFormats: { 2: xlsxDurationFormat }, autoFilter: true },
      { sheetName: "Sites por agente", headers: ["Agente", "WB", "Identificador", "LOB", "Turno", "Supervisor", "Domínio", "Classificação", "Tempo", "Segundos", "Registros"],
        rows: data.byAgent.map((row) => [row.employeeName, row.wbLogin, row.agentKey, row.lob, row.shift, row.supervisor, row.domain, siteClassificationLabels[row.classification], row.seconds / 86400, row.seconds, row.segments]),
        columnFormats: { 8: xlsxDurationFormat }, autoFilter: true }
    ]
  });
}
