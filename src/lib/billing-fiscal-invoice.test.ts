import assert from "node:assert/strict";
import test from "node:test";

import {
  BILLING_FISCAL_INVOICE_NUMBER_MAX_LENGTH,
  calculateBillingFiscalExpectedAmount,
  calculateBillingFiscalGrossAmount,
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

test("soma a correção ao valor bruto esperado na nota fiscal", () => {
  assert.equal(calculateBillingFiscalGrossAmount(9_409.76, 100), 9_509.76);
  assert.equal(calculateBillingFiscalGrossAmount(9_409.76, -100), 9_309.76);
  assert.equal(calculateBillingFiscalGrossAmount(0.1, 0.2), 0.3);
});

test("valida a nota de todos os colaboradores pelo valor final líquido", () => {
  assert.equal(calculateBillingFiscalExpectedAmount({
    referenceMonth: "2026-07",
    wbLogin: "wb_pedros",
    grossAmount: 5227.44,
    correctionAmount: 0,
    finalAmount: 5427.44
  }), 5427.44);
  assert.equal(calculateBillingFiscalExpectedAmount({
    referenceMonth: "2026-07",
    wbLogin: "wb_adryan",
    grossAmount: 2540.96,
    correctionAmount: 0,
    finalAmount: 2240.96
  }), 2240.96);
});
