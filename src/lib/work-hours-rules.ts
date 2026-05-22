export const DEFAULT_PRODUCTIVE_HOURS = 8;
export const PRODUCTIVE_DAY_MINUTES = DEFAULT_PRODUCTIVE_HOURS * 60;
export const WORK_HOUR_TOLERANCE_MINUTES = 5;

const productiveStatusKeys = new Set([
  "ESCALADO",
  "PRESENTE",
  "FALTA",
  "ATRASO",
  "SAIDA_ANTECIPADA",
  "TROCA_APROVADA",
  "VENDA_FOLGA_APROVADA",
  "VENDA_DE_FOLGA_APROVADA",
  "FOLGA_APROVADA",
  "TREINAMENTO",
  "NESTING"
]);

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
  return isProductiveScheduleStatus(status) ? DEFAULT_PRODUCTIVE_HOURS : null;
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
