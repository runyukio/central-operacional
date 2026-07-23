import assert from "node:assert/strict";
import test from "node:test";

import {
  BILLING_FISCAL_INVOICE_NUMBER_MAX_LENGTH,
  isValidBillingFiscalInvoiceNumber,
  normalizeBillingFiscalInvoiceNumber
} from "./billing-fiscal-invoice";

test("aceita números de nota fiscal com até 4 dígitos", () => {
  assert.equal(BILLING_FISCAL_INVOICE_NUMBER_MAX_LENGTH, 4);
  assert.equal(isValidBillingFiscalInvoiceNumber("5"), true);
  assert.equal(isValidBillingFiscalInvoiceNumber("0005"), true);
});

test("preserva zeros à esquerda e rejeita identificadores acima do limite", () => {
  assert.equal(isValidBillingFiscalInvoiceNumber("0012"), true);
  assert.equal(isValidBillingFiscalInvoiceNumber("00123"), false);
});

test("normaliza caracteres não numéricos sem converter o identificador para number", () => {
  assert.equal(normalizeBillingFiscalInvoiceNumber(" 00.12 "), "0012");
  assert.equal(normalizeBillingFiscalInvoiceNumber("12345"), "1234");
});
