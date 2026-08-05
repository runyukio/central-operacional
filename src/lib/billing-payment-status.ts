export const BILLING_INVOICE_CLOSED_STATUS = "FECHADO";
export const BILLING_INVOICE_PAID_STATUS = "PAGO";

export type BillingPaymentSummary = {
  pendingCount: number;
  pendingAmount: number;
  paidCount: number;
  paidAmount: number;
};

export function isBillingInvoiceFinalizedStatus(status?: string | null) {
  return status === BILLING_INVOICE_CLOSED_STATUS || status === BILLING_INVOICE_PAID_STATUS;
}

export function buildBillingPaymentSummary(
  invoices: Array<{ status: string; finalAmount: number }>
): BillingPaymentSummary {
  return invoices.reduce<BillingPaymentSummary>((summary, invoice) => {
    const amount = roundMoney(invoice.finalAmount);
    if (invoice.status === BILLING_INVOICE_PAID_STATUS) {
      summary.paidCount += 1;
      summary.paidAmount = roundMoney(summary.paidAmount + amount);
    } else if (invoice.status === BILLING_INVOICE_CLOSED_STATUS) {
      summary.pendingCount += 1;
      summary.pendingAmount = roundMoney(summary.pendingAmount + amount);
    }
    return summary;
  }, {
    pendingCount: 0,
    pendingAmount: 0,
    paidCount: 0,
    paidAmount: 0
  });
}

function roundMoney(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}
