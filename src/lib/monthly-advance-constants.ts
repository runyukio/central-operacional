export const MONTHLY_ADVANCE_FIXED_AMOUNT = 300;

export function monthlyAdvanceAmountForOptIn(optIn: boolean) {
  return optIn ? MONTHLY_ADVANCE_FIXED_AMOUNT : 0;
}
