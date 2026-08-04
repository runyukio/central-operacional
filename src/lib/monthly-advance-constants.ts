export const MONTHLY_ADVANCE_FIXED_AMOUNT = 300;
export const MONTHLY_ADVANCE_ENDED_MESSAGE = "Mês de referência do adiantamento mensal inválido.";

export function monthlyAdvanceAmountForOptIn(optIn: boolean) {
  return optIn ? MONTHLY_ADVANCE_FIXED_AMOUNT : 0;
}

export function isMonthlyAdvanceReferenceMonthAvailable(referenceMonth?: string | null) {
  const normalized = String(referenceMonth ?? "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(normalized);
}
