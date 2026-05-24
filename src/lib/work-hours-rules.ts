export const DEFAULT_PRODUCTIVE_HOURS = 8;
export const PRODUCTIVE_DAY_MINUTES = DEFAULT_PRODUCTIVE_HOURS * 60;
export const WORK_HOUR_TOLERANCE_MINUTES = 5;

const productiveStatusKeys = new Set([
  "ESCALADO",
  "PRESENTE",
  "ATRASO",
  "SAIDA_ANTECIPADA",
  "VENDA_FOLGA_APROVADA",
  "VENDA_DE_FOLGA_APROVADA"
]);

const blockedStatusLabels: Record<string, string> = {
  FALTA: "Falta",
  FOLGA: "Folga",
  FERIAS: "Férias",
  AFASTADO: "Afastado",
  TREINAMENTO: "Treinamento",
  NESTING: "Nesting",
  SEM_ESCALA: "Sem escala",
  SEM_CRONOGRAMA: "Sem cronograma",
  ERRO_ESCALA: "Erro de cronograma",
  ERRO_DE_ESCALA: "Erro de cronograma",
  ERRO_CRONOGRAMA: "Erro de cronograma",
  ERRO_DE_CRONOGRAMA: "Erro de cronograma",
  FOLGA_APROVADA: "Folga aprovada"
};

type WorkHoursScheduleLike = {
  status?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  shift?: { name?: string | null } | null;
  shiftName?: string | null;
};

function normalizeStatusKey(status?: string | null) {
  return String(status ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function isProductiveScheduleStatus(status?: string | null) {
  return productiveStatusKeys.has(normalizeStatusKey(status));
}

export function plannedProductiveHoursForStatus(status?: string | null) {
  return canScheduleStatusReceiveWorkHours(status) ? DEFAULT_PRODUCTIVE_HOURS : null;
}

export function canScheduleStatusReceiveWorkHours(status?: string | null, schedule?: WorkHoursScheduleLike | null) {
  const normalizedStatus = normalizeStatusKey(status ?? schedule?.status);
  if (productiveStatusKeys.has(normalizedStatus)) return true;
  if (normalizedStatus !== "TROCA_APROVADA") return false;

  const startsAt = schedule?.startsAt?.trim();
  const endsAt = schedule?.endsAt?.trim();
  const shiftName = normalizeStatusKey(schedule?.shiftName ?? schedule?.shift?.name);
  return Boolean(startsAt && endsAt && shiftName !== "FOLGA");
}

export function isWorkHoursAllowedForSchedule(schedule?: WorkHoursScheduleLike | null) {
  return Boolean(schedule && canScheduleStatusReceiveWorkHours(schedule.status, schedule));
}

export function plannedProductiveHoursForSchedule(schedule?: WorkHoursScheduleLike | null) {
  return isWorkHoursAllowedForSchedule(schedule) ? DEFAULT_PRODUCTIVE_HOURS : null;
}

export function workHoursBlockedReasonForSchedule(schedule?: WorkHoursScheduleLike | null) {
  if (!schedule) return "Não existe cronograma para este colaborador nesta data.";
  if (isWorkHoursAllowedForSchedule(schedule)) return "";
  const normalizedStatus = normalizeStatusKey(schedule.status);
  if (normalizedStatus === "TROCA_APROVADA") {
    return "Troca aprovada precisa indicar se o dia é trabalhado ou folga para permitir lançamento de horas.";
  }
  const label = blockedStatusLabels[normalizedStatus] ?? String(schedule.status ?? "este status");
  return `Não é possível lançar horas para ${label}.`;
}

export function normalizeProductivePlannedHours(plannedHours?: number | null) {
  return plannedHours === null || plannedHours === undefined ? null : DEFAULT_PRODUCTIVE_HOURS;
}

export function calculateProductiveDifferenceMinutes(actualHours: number, plannedHours = DEFAULT_PRODUCTIVE_HOURS) {
  return Math.round((actualHours - plannedHours) * 60);
}

export function isProductiveDifferenceWithinTolerance(differenceMinutes: number, toleranceMinutes = WORK_HOUR_TOLERANCE_MINUTES) {
  return Math.abs(differenceMinutes) <= toleranceMinutes;
}
