import assert from "node:assert/strict";
import test from "node:test";

import {
  BILLING_FISCAL_INVOICE_NUMBER_MAX_LENGTH,
  isValidBillingFiscalInvoiceNumber,
  normalizeBillingFiscalInvoiceNumber
} from "./billing-fiscal-invoice";

const fiftyDigitAccessKey = "35503082264104671000185000000000000426072985846691";

test("aceita uma chave de acesso de nota fiscal com 50 dígitos", () => {
  assert.equal(fiftyDigitAccessKey.length, BILLING_FISCAL_INVOICE_NUMBER_MAX_LENGTH);
  assert.equal(isValidBillingFiscalInvoiceNumber(fiftyDigitAccessKey), true);
});

test("preserva zeros à esquerda e rejeita identificadores acima do limite", () => {
  assert.equal(isValidBillingFiscalInvoiceNumber(`0${fiftyDigitAccessKey.slice(1)}`), true);
  assert.equal(isValidBillingFiscalInvoiceNumber(`${fiftyDigitAccessKey}1`), false);
});

test("normaliza caracteres não numéricos sem converter o identificador para number", () => {
  assert.equal(normalizeBillingFiscalInvoiceNumber(" 001.234/56 "), "00123456");
  assert.equal(normalizeBillingFiscalInvoiceNumber(`${fiftyDigitAccessKey}999`), fiftyDigitAccessKey);
});
