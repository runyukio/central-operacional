import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBillingPaymentSummary,
  isBillingInvoiceFinalizedStatus
} from "./billing-payment-status";

test("resume invoices pagos e pendentes por quantidade e valor", () => {
  assert.deepEqual(buildBillingPaymentSummary([
    { status: "FECHADO", finalAmount: 1200.1 },
    { status: "APROVADO_COLABORADOR", finalAmount: 300 },
    { status: "PAGO", finalAmount: 450.55 },
    { status: "PAGO", finalAmount: 99.45 }
  ]), {
    pendingCount: 1,
    pendingAmount: 1200.1,
    paidCount: 2,
    paidAmount: 550
  });
});

test("considera fechado e pago como snapshots finalizados", () => {
  assert.equal(isBillingInvoiceFinalizedStatus("FECHADO"), true);
  assert.equal(isBillingInvoiceFinalizedStatus("PAGO"), true);
  assert.equal(isBillingInvoiceFinalizedStatus("DISPONIVEL_APROVACAO"), false);
});
