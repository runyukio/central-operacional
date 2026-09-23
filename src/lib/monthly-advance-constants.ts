export const MONTHLY_ADVANCE_FIXED_AMOUNT = 300;
export const MONTHLY_ADVANCE_LAST_REFERENCE_MONTH = "2026-10";
export const MONTHLY_ADVANCE_ENDED_MESSAGE = "O adiantamento mensal está disponível somente até outubro/2026.";

export function monthlyAdvanceAmountForOptIn(optIn: boolean) {
  return optIn ? MONTHLY_ADVANCE_FIXED_AMOUNT : 0;
}

export function isMonthlyAdvanceReferenceMonthAvailable(referenceMonth?: string | null) {
  const normalized = String(referenceMonth ?? "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(normalized) && normalized <= MONTHLY_ADVANCE_LAST_REFERENCE_MONTH;
}

export function isMonthlyAdvanceRequestPeriodOpen(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return Boolean(year && month && `${year}-${month}` <= MONTHLY_ADVANCE_LAST_REFERENCE_MONTH);
}
