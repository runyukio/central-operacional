import assert from "node:assert/strict";
import test from "node:test";

import {
  billingFiscalUploadIsReady,
  EMPTY_BILLING_FISCAL_UPLOAD
} from "./billing-fiscal-invoice-upload";

const existingInvoice = {
  accessKey: "35503082264034345000149000000000000726083768383083",
  invoiceNumber: "7",
  grossAmount: 8_700,
  fileName: "nota.pdf"
};

test("mantém a divergência bloqueada para parceiros sem exceção", () => {
  assert.equal(
    billingFiscalUploadIsReady(EMPTY_BILLING_FISCAL_UPLOAD, existingInvoice, 11_000.64),
    false
  );
});

test("libera uma nota já anexada com valor divergente para parceiros autorizados", () => {
  assert.equal(
    billingFiscalUploadIsReady(EMPTY_BILLING_FISCAL_UPLOAD, existingInvoice, 11_000.64, true),
    true
  );
});
