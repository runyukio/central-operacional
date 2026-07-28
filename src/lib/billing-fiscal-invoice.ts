export const BILLING_FISCAL_INVOICE_NUMBER_MAX_LENGTH = 4;

const BILLING_FISCAL_INVOICE_NUMBER_PATTERN = /^\d{1,4}$/;

export const BILLING_FISCAL_INVOICE_NUMBER_ERROR =
  `Número da nota fiscal inválido. Informe somente números, com até ${BILLING_FISCAL_INVOICE_NUMBER_MAX_LENGTH} dígitos.`;

export function isValidBillingFiscalInvoiceNumber(value: string) {
  return BILLING_FISCAL_INVOICE_NUMBER_PATTERN.test(value.trim());
}

export function normalizeBillingFiscalInvoiceNumber(value: string) {
  return value.replace(/\D/g, "").slice(0, BILLING_FISCAL_INVOICE_NUMBER_MAX_LENGTH);
}

export function calculateBillingFiscalGrossAmount(grossAmount: number, correctionAmount: number) {
  return Math.round((Number(grossAmount) + Number(correctionAmount) + Number.EPSILON) * 100) / 100;
}

export function calculateBillingFiscalExpectedAmount(input: {
  referenceMonth: string;
  wbLogin: string;
  grossAmount: number;
  correctionAmount: number;
  finalAmount: number;
}) {
  return roundCurrency(input.finalAmount);
}

function roundCurrency(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
