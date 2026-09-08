export const BILLING_FISCAL_INVOICE_NUMBER_MAX_LENGTH = 20;

const BILLING_FISCAL_AMOUNT_MISMATCH_EXEMPT_WB_LOGINS = new Set([
  "wb_lucasy",
  "wb_kevin11",
  "leonardo20"
]);

const BILLING_MANUAL_CLOSURE_WITHOUT_FISCAL_INVOICE_WB_LOGINS = new Set([
  "guilhereme.ramos"
]);

// Exceção pontual autorizada para o fechamento manual de agosto/2026.
// Não libera o fluxo automático nem os demais ciclos destes parceiros.
const BILLING_MANUAL_CLOSURE_MONTH_EXCEPTIONS = new Map<string, ReadonlySet<string>>([
  ["2026-08", new Set(["wb_diorgenes", "wb_stephaniet"])]
]);

export type BillingManualClosureWithoutFiscalInvoiceReason =
  | "EMPLOYEE_IN_TRAINING"
  | "NON_POSITIVE_FINAL_AMOUNT"
  | "WB_EXCEPTION"
  | "WB_MONTH_EXCEPTION";

const BILLING_FISCAL_INVOICE_NUMBER_PATTERN = /^\d{1,20}$/;

export const BILLING_FISCAL_INVOICE_NUMBER_ERROR =
  `Número da nota fiscal inválido. Informe somente números, com até ${BILLING_FISCAL_INVOICE_NUMBER_MAX_LENGTH} dígitos.`;

export function isValidBillingFiscalInvoiceNumber(value: string) {
  return BILLING_FISCAL_INVOICE_NUMBER_PATTERN.test(value.trim());
}

export function normalizeBillingFiscalInvoiceNumber(value: string) {
  return value.replace(/\D/g, "").slice(0, BILLING_FISCAL_INVOICE_NUMBER_MAX_LENGTH);
}

export function isBillingFiscalAmountMismatchExempt(wbLogin: string | null | undefined) {
  return BILLING_FISCAL_AMOUNT_MISMATCH_EXEMPT_WB_LOGINS.has(String(wbLogin ?? "").trim().toLowerCase());
}

export function resolveBillingManualClosureWithoutFiscalInvoiceReason(input: {
  referenceMonth: string;
  wbLogin: string | null | undefined;
  employeeStatus: string | null | undefined;
  finalAmount: number;
}): BillingManualClosureWithoutFiscalInvoiceReason | null {
  const employeeStatus = normalizeComparableBillingValue(input.employeeStatus);
  if (employeeStatus === "emtreinamento") return "EMPLOYEE_IN_TRAINING";
  if (Number(input.finalAmount) <= 0) return "NON_POSITIVE_FINAL_AMOUNT";
  const wbLogin = String(input.wbLogin ?? "").trim().toLowerCase();
  if (BILLING_MANUAL_CLOSURE_WITHOUT_FISCAL_INVOICE_WB_LOGINS.has(wbLogin)) return "WB_EXCEPTION";
  if (BILLING_MANUAL_CLOSURE_MONTH_EXCEPTIONS.get(input.referenceMonth)?.has(wbLogin)) return "WB_MONTH_EXCEPTION";
  return null;
}

export function calculateBillingFiscalGrossAmount(grossAmount: number, correctionAmount: number) {
  return Math.round((Number(grossAmount) + Number(correctionAmount) + Number.EPSILON) * 100) / 100;
}

export function calculateBillingFiscalExpectedAmount(input: {
  referenceMonth: string;
  wbLogin: string;
  grossAmount: number;
  correctionAmount: number;
  advanceAmount: number;
  finalAmount: number;
}) {
  return roundCurrency(input.finalAmount + input.advanceAmount);
}

function roundCurrency(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeComparableBillingValue(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
