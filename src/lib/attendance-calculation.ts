export type OperationalStatusKey =
  | "ESCALADO"
  | "PRESENTE"
  | "AUSENTE"
  | "FALTA"
  | "ATRASO"
  | "SAIDA_ANTECIPADA"
  | "TROCA_APROVADA"
  | "VENDA_FOLGA_APROVADA"
  | "FOLGA_APROVADA"
  | "FOLGA"
  | "FERIAS"
  | "TREINAMENTO"
  | "NESTING"
  | "SEM_ESCALA"
  | "AFASTADO"
  | "ERRO_ESCALA"
  | "FERIADO"
  | "CONFLITO"
  | "DESCOBERTO";

const STATUS_ALIASES: Record<string, OperationalStatusKey> = {
  ESCALADO: "ESCALADO",
  PRESENTE: "PRESENTE",
  AUSENTE: "AUSENTE",
  FALTA: "FALTA",
  ATRASO: "ATRASO",
  SAIDA_ANTECIPADA: "SAIDA_ANTECIPADA",
  TROCA_APROVADA: "TROCA_APROVADA",
  VENDA_FOLGA_APROVADA: "VENDA_FOLGA_APROVADA",
  VENDA_DE_FOLGA_APROVADA: "VENDA_FOLGA_APROVADA",
  FOLGA_APROVADA: "FOLGA_APROVADA",
  FOLGA: "FOLGA",
  FERIAS: "FERIAS",
  TREINAMENTO: "TREINAMENTO",
  NESTING: "NESTING",
  SEM_ESCALA: "SEM_ESCALA",
  AFASTADO: "AFASTADO",
  ERRO_ESCALA: "ERRO_ESCALA",
  ERRO_DE_ESCALA: "ERRO_ESCALA",
  FERIADO: "FERIADO",
  CONFLITO: "CONFLITO",
  DESCOBERTO: "DESCOBERTO"
};

const SCHEDULED_STATUS_KEYS = new Set<OperationalStatusKey>([
  "ESCALADO",
  "PRESENTE",
  "AUSENTE",
  "FALTA",
  "ATRASO",
  "SAIDA_ANTECIPADA",
  "TROCA_APROVADA",
  "VENDA_FOLGA_APROVADA",
  "FOLGA_APROVADA"
]);

const PRESENT_STATUS_KEYS = new Set<OperationalStatusKey>([
  "PRESENTE",
  "ATRASO",
  "SAIDA_ANTECIPADA",
  "TROCA_APROVADA",
  "VENDA_FOLGA_APROVADA",
  "FOLGA_APROVADA"
]);

const ABSENCE_STATUS_KEYS = new Set<OperationalStatusKey>(["AUSENTE", "FALTA"]);

function statusLookupKey(status: unknown) {
  return String(status ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeOperationalStatus(status: unknown): OperationalStatusKey | null {
  const key = statusLookupKey(status);
  if (!key) return null;
  return STATUS_ALIASES[key] ?? null;
}

export function getScheduledStatuses() {
  return Array.from(SCHEDULED_STATUS_KEYS);
}

export function getPresentStatuses() {
  return Array.from(PRESENT_STATUS_KEYS);
}

export function getAbsenceStatuses() {
  return Array.from(ABSENCE_STATUS_KEYS);
}

export function isScheduledStatus(status: unknown) {
  const normalized = normalizeOperationalStatus(status);
  return normalized ? SCHEDULED_STATUS_KEYS.has(normalized) : false;
}

export function isPresentStatus(status: unknown) {
  const normalized = normalizeOperationalStatus(status);
  return normalized ? PRESENT_STATUS_KEYS.has(normalized) : false;
}

export function isAbsenceStatus(status: unknown) {
  const normalized = normalizeOperationalStatus(status);
  return normalized ? ABSENCE_STATUS_KEYS.has(normalized) : false;
}

export function calculateAbsenceRate(scheduled: number, absences: number) {
  if (scheduled <= 0) return 0;
  return Math.round((absences / scheduled) * 1000) / 10;
}

export function calculateCoverageRate(scheduled: number, present: number) {
  if (scheduled <= 0) return 0;
  return Math.round((present / scheduled) * 1000) / 10;
}
