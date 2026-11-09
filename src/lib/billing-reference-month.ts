// Operational cycle selected by the business; shared by server and client views.
// Previous months remain available when explicitly selected.
export const DEFAULT_BILLING_REFERENCE_MONTH = "2026-11";
export const BILLING_START_MONTH = "2026-06";
export const BILLING_REFERENCE_MONTH_CONFIG_KEY = "settings.billingReferenceMonth";

export function isValidBillingReferenceMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value >= BILLING_START_MONTH;
}
