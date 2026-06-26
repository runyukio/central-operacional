export const MONTHLY_ADVANCE_FIXED_AMOUNT = 300;
export const MONTHLY_ADVANCE_LAST_REFERENCE_MONTH = "2026-07";
export const MONTHLY_ADVANCE_ENDED_MESSAGE = "Adiantamento mensal encerrado em Julho/2026. Não há novos ciclos a partir de Agosto/2026.";

export function monthlyAdvanceAmountForOptIn(optIn: boolean) {
  return optIn ? MONTHLY_ADVANCE_FIXED_AMOUNT : 0;
}

export function isMonthlyAdvanceReferenceMonthAvailable(referenceMonth?: string | null) {
  const normalized = String(referenceMonth ?? "").trim();
  return /^\d{4}-\d{2}$/.test(normalized) && normalized <= MONTHLY_ADVANCE_LAST_REFERENCE_MONTH;
}
