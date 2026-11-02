import { isBillingInvoiceFinalizedStatus } from "./billing-payment-status";

export type BillingBulkStatus = "FINALIZADO_CONFERENCIA" | "FECHADO";
export type BillingStatusSelection = { employeeId: string; status: string };

export function billingBulkInvoiceStatus(status: BillingBulkStatus) {
  return status === "FECHADO" ? "FECHADO" : "DISPONIVEL_APROVACAO";
}

export function billingBulkTargets<T extends BillingStatusSelection>(invoices: T[], status: BillingBulkStatus): T[] {
  const nextStatus = billingBulkInvoiceStatus(status);
  return invoices.filter((invoice) => !isBillingInvoiceFinalizedStatus(invoice.status) && invoice.status !== nextStatus);
}

export function parseBillingStatusSelection(value: unknown): BillingStatusSelection[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const seen = new Set<string>();
  for (const row of value) {
    if (!row || typeof row.employeeId !== "string" || !row.employeeId.trim()
      || typeof row.status !== "string" || !row.status.trim() || seen.has(row.employeeId)) return null;
    seen.add(row.employeeId);
  }
  return value.map(({ employeeId, status }) => ({ employeeId, status }));
}
