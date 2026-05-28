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
  FOLGA_APROVADA: "Folga aprovada",
  DESLIGADO: "Desligado"
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

export function parseWorkHoursToMinutes(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const minutes = value.getUTCHours() * 60 + value.getUTCMinutes() + Math.round(value.getUTCSeconds() / 60);
    return minutes >= 0 && minutes <= 24 * 60 ? minutes : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value < 0 || value > 24) return null;
    return Math.round(value * 60);
  }

  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const time = raw.match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
  if (time) {
    const hours = Number(time[1]);
    const minutes = Number(time[2]);
    const seconds = Number(time[3] ?? 0);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
    if (hours > 24 || minutes > 59 || seconds > 59) return null;
    const total = hours * 60 + minutes + Math.round(seconds / 60);
    return total <= 24 * 60 ? total : null;
  }

  const decimal = Number(raw.replace(",", "."));
  if (!Number.isFinite(decimal) || decimal < 0 || decimal > 24) return null;
  return Math.round(decimal * 60);
}

export function workHoursFromMinutes(minutes: number) {
  return Math.round(minutes) / 60;
}

export function formatMinutesToHHMM(minutes: number, options: { showPositiveSign?: boolean } = {}) {
  if (!Number.isFinite(minutes)) return "0:00";
  const rounded = Math.round(minutes);
  const sign = rounded < 0 ? "-" : options.showPositiveSign && rounded > 0 ? "+" : "";
  const absolute = Math.abs(rounded);
  const hours = Math.floor(absolute / 60);
  const remainingMinutes = absolute % 60;
  return `${sign}${hours}:${String(remainingMinutes).padStart(2, "0")}`;
}

export function formatSignedMinutesToHHMM(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) return "";
  return formatMinutesToHHMM(minutes, { showPositiveSign: true });
}

export function formatWorkHours(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return formatMinutesToHHMM(Math.round(value * 60));
  }
  const minutes = parseWorkHoursToMinutes(value);
  return minutes === null ? "" : formatMinutesToHHMM(minutes);
}

export function normalizeWorkHoursInput(value: unknown) {
  return formatWorkHours(value);
}
