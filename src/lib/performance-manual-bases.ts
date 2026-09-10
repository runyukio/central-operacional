export const performanceManualBases = [
  { key: "production", label: "Produção / Output", helper: "Base com agentname, submit e moderation duration.", resultKey: "productionRows" },
  { key: "volume", label: "Filas / Input", helper: "Base com queue_id e enqueue.", resultKey: "volumeRows" },
  { key: "cecCpd", label: "CEC CPD / Output", helper: "Base com perform_time(hour), agent_name e ticket_id(去重计数).", resultKey: "cecCpdRows" },
  { key: "cecFrt", label: "CEC SLA / FRT", helper: "Planilha PO FRT: e-mail do parceiro, data, prioridade e contadores de primeira resposta.", resultKey: "cecFrtRows" },
  { key: "ur", label: "UR / Utilização", helper: "Moderation Status Detail: moderação real ÷ 8h por parceiro/Shift Date. Meta: 60%. XLSX até 10 MB.", resultKey: "urRows" }
] as const;

export type PerformanceManualBase = typeof performanceManualBases[number]["key"];
export type OperationalManualBase = Exclude<PerformanceManualBase, "cecFrt" | "ur">;
export type ManualImportResult = Partial<Record<typeof performanceManualBases[number]["resultKey"], number>> & {
  selectedBases: PerformanceManualBase[];
  rowsError: number;
  urWarnings?: string[];
  urStartDate?: string;
  urEndDate?: string;
  unmatchedRows?: number;
  unmatchedLogins?: number;
  startDate?: string;
  endDate?: string;
};

// The manifest protects a multi-file selection from silently becoming a partial upload.
export function validateManualFileManifest(manifest: string | null, received: string[]) {
  if (manifest === null) return; // Previously published clients did not send a manifest.
  const expected = manifest.split(",");
  const allowed = [...performanceManualBases.map((base) => base.key), "quality"];
  if (!expected.length || new Set(expected).size !== expected.length || expected.some((key) => !allowed.includes(key))) {
    throw new Error("Seleção de bases inválida. Selecione os arquivos novamente.");
  }
  if (expected.length !== received.length || expected.some((key) => !received.includes(key))) {
    throw new Error("O envio está incompleto: nem todas as bases selecionadas foram recebidas. Envie novamente; as bases anteriores foram preservadas.");
  }
}
