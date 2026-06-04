import type { ScheduleStatus } from "@prisma/client";

export type AbsenceReasonClassification = "JUSTIFIED" | "UNJUSTIFIED";

export const justifiedAbsenceReasons = [
  "Problema de saúde",
  "Erro de programação de escala",
  "Problema técnico corporativo",
  "Emergência familiar"
] as const;

export const unjustifiedAbsenceReasons = [
  "Não informado",
  "Problema técnico pessoal",
  "Problema de transporte",
  "Problema pessoal",
  "Erro de visualização de escala",
  "Outros"
] as const;

export const officialAbsenceReasons = [
  ...justifiedAbsenceReasons,
  ...unjustifiedAbsenceReasons
] as const;

const officialReasonByKey = new Map(officialAbsenceReasons.map((reason) => [reasonKey(reason), reason]));
const justifiedReasonKeys = new Set(justifiedAbsenceReasons.map(reasonKey));
const unjustifiedReasonKeys = new Set(unjustifiedAbsenceReasons.map(reasonKey));

const legacyReasonMap = new Map<string, string>([
  ["AUSENTE", "Não informado"],
  ["ATRASO", "Outros"],
  ["ATRASADO", "Outros"],
  ["ATRASADA", "Outros"],
  ["LATE", "Outros"],
  ["FALTA_INJUSTIFICADA", "Problema pessoal"],
  ["PROBLEMA_TECNICO", "Problema técnico pessoal"],
  ["ERRO_DE_CRONOGRAMA", "Erro de visualização de escala"],
  ["ERRO_CRONOGRAMA", "Erro de visualização de escala"],
  ["ERRO_DE_ESCALA", "Erro de visualização de escala"],
  ["ERRO_ESCALA", "Erro de visualização de escala"],
  ["FALTA_DE_EQUIPAMENTO", "Problema técnico corporativo"],
  ["PROBLEMA_DE_INTERNET", "Problema técnico pessoal"],
  ["SAIDA_ANTECIPADA", "Outros"],
  ["AFASTAMENTO", "Outros"]
]);

const historicalReasonMap = new Map<string, string>([
  ["FALTA_INJUSTIFICADA", "Problema pessoal"],
  ["OUTROS", "Outros"],
  ["EMERGENCIA_FAMILIAR", "Problema pessoal"],
  ["NAO_INFORMADO", "Não informado"],
  ["PROBLEMA_DE_SAUDE", "Problema de saúde"],
  ["PROBLEMA_TECNICO", "Problema técnico pessoal"],
  ["ERRO_DE_CRONOGRAMA", "Erro de visualização de escala"],
  ["ERRO_CRONOGRAMA", "Erro de visualização de escala"],
  ["AUSENTE", "Não informado"],
  ["ATRASO", "Outros"],
  ["LATE", "Outros"]
]);

export function reasonKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeAbsenceReasonForInput(value?: string | null) {
  const key = reasonKey(value);
  if (!key) return undefined;
  return officialReasonByKey.get(key) ?? legacyReasonMap.get(key);
}

export function normalizeHistoricalAbsenceReason(value?: string | null) {
  const key = reasonKey(value);
  if (!key) return undefined;
  return historicalReasonMap.get(key) ?? officialReasonByKey.get(key);
}

export function getAbsenceReasonClassification(reason?: string | null): AbsenceReasonClassification | null {
  const normalized = normalizeAbsenceReasonForInput(reason);
  if (!normalized) return null;
  const key = reasonKey(normalized);
  if (justifiedReasonKeys.has(key)) return "JUSTIFIED";
  if (unjustifiedReasonKeys.has(key)) return "UNJUSTIFIED";
  return null;
}

export function absenceReasonClassificationLabel(classification?: string | null) {
  return classification === "JUSTIFIED" ? "Justificado" : classification === "UNJUSTIFIED" ? "Injustificado" : "";
}

export function scheduleStatusForAbsenceClassification(classification: AbsenceReasonClassification): ScheduleStatus {
  return classification === "JUSTIFIED" ? "FALTA_JUSTIFICADA" : "FALTA_INJUSTIFICADA";
}

export function isOfficialAbsenceReason(reason?: string | null) {
  return Boolean(normalizeAbsenceReasonForInput(reason));
}
