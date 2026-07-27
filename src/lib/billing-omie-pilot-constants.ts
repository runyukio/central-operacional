export const BILLING_OMIE_PILOT_REFERENCE_MONTH = "2026-07";
export const BILLING_OMIE_PILOT_WB_LOGIN = "wb_pedros";
export const BILLING_OMIE_PILOT_MAIN_CATEGORY_CODE = "2.10.96";
export const BILLING_OMIE_BONUS_CATEGORY_CODE = "2.02.04";

export function isBillingOmiePilotTarget(referenceMonth: string, wbLogin: string) {
  return referenceMonth === BILLING_OMIE_PILOT_REFERENCE_MONTH
    && wbLogin.trim().toLowerCase() === BILLING_OMIE_PILOT_WB_LOGIN;
}
