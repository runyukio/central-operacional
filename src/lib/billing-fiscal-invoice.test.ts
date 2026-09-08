import assert from "node:assert/strict";
import test from "node:test";

import {
  BILLING_FISCAL_INVOICE_NUMBER_MAX_LENGTH,
  calculateBillingFiscalExpectedAmount,
  calculateBillingFiscalGrossAmount,
  isBillingFiscalAmountMismatchExempt,
  isValidBillingFiscalInvoiceNumber,
  normalizeBillingFiscalInvoiceNumber,
  resolveBillingManualClosureWithoutFiscalInvoiceReason
} from "./billing-fiscal-invoice";

test("aceita números de nota fiscal com até 20 dígitos", () => {
  assert.equal(BILLING_FISCAL_INVOICE_NUMBER_MAX_LENGTH, 20);
  assert.equal(isValidBillingFiscalInvoiceNumber("5"), true);
  assert.equal(isValidBillingFiscalInvoiceNumber("0005"), true);
  assert.equal(isValidBillingFiscalInvoiceNumber("12345678901234567890"), true);
});

test("preserva zeros à esquerda e rejeita identificadores acima do limite", () => {
  assert.equal(isValidBillingFiscalInvoiceNumber("0012"), true);
  assert.equal(isValidBillingFiscalInvoiceNumber("123456789012345678901"), false);
});

test("normaliza caracteres não numéricos sem converter o identificador para number", () => {
  assert.equal(normalizeBillingFiscalInvoiceNumber(" 00.12 "), "0012");
  assert.equal(normalizeBillingFiscalInvoiceNumber("12.345"), "12345");
  assert.equal(normalizeBillingFiscalInvoiceNumber("123456789012345678901"), "12345678901234567890");
});

test("libera divergência de valor da NF somente para os WBs autorizados", () => {
  assert.equal(isBillingFiscalAmountMismatchExempt("wb_lucasy"), true);
  assert.equal(isBillingFiscalAmountMismatchExempt(" WB_KEVIN11 "), true);
  assert.equal(isBillingFiscalAmountMismatchExempt("leonardo20"), true);
  assert.equal(isBillingFiscalAmountMismatchExempt("wb_leonardo20"), false);
  assert.equal(isBillingFiscalAmountMismatchExempt("wb_outro"), false);
});

test("permite fechamento manual sem nota para valor não positivo, treinamento e WB autorizado", () => {
  assert.equal(resolveBillingManualClosureWithoutFiscalInvoiceReason({
    referenceMonth: "2026-07",
    wbLogin: "wb_agente",
    employeeStatus: "Ativo",
    finalAmount: 0
  }), "NON_POSITIVE_FINAL_AMOUNT");
  assert.equal(resolveBillingManualClosureWithoutFiscalInvoiceReason({
    referenceMonth: "2026-07",
    wbLogin: "wb_agente",
    employeeStatus: "Ativo",
    finalAmount: -10
  }), "NON_POSITIVE_FINAL_AMOUNT");
  assert.equal(resolveBillingManualClosureWithoutFiscalInvoiceReason({
    referenceMonth: "2026-07",
    wbLogin: "wb_agente",
    employeeStatus: "Em treinamento",
    finalAmount: 100
  }), "EMPLOYEE_IN_TRAINING");
  assert.equal(resolveBillingManualClosureWithoutFiscalInvoiceReason({
    referenceMonth: "2026-07",
    wbLogin: " GUILHEREME.RAMOS ",
    employeeStatus: "Ativo",
    finalAmount: 4_700.16
  }), "WB_EXCEPTION");
  assert.equal(resolveBillingManualClosureWithoutFiscalInvoiceReason({
    referenceMonth: "2026-07",
    wbLogin: "wb_outro",
    employeeStatus: "Ativo",
    finalAmount: 100
  }), null);
});

test("exceção manual pontual de agosto/2026 libera somente os dois WBs autorizados", () => {
  for (const wbLogin of ["wb_diorgenes", " WB_STEPHANIET "]) {
    for (const employeeStatus of ["Ativo", "Desligado"]) {
      const input = { referenceMonth: "2026-08", wbLogin, employeeStatus, finalAmount: 1000 };
      assert.equal(resolveBillingManualClosureWithoutFiscalInvoiceReason(input), "WB_MONTH_EXCEPTION");
      for (const referenceMonth of ["2026-07", "2026-09", "2027-08", "08", "2026-8", ""]) {
        assert.equal(resolveBillingManualClosureWithoutFiscalInvoiceReason({ ...input, referenceMonth }), null);
      }
    }
    // Não altera a regra de aprovação automática/divergência de valor da NF.
    assert.equal(isBillingFiscalAmountMismatchExempt(wbLogin), false);
  }
  for (const wbLogin of ["wb_outro", "wb_diogenes", "wb_diorgenes2", "wb_stephaniet2", null, undefined]) {
    assert.equal(resolveBillingManualClosureWithoutFiscalInvoiceReason({ referenceMonth: "2026-08", wbLogin, employeeStatus: "Ativo", finalAmount: 1000 }), null);
  }
});

test("soma a correção ao valor bruto esperado na nota fiscal", () => {
  assert.equal(calculateBillingFiscalGrossAmount(9_409.76, 100), 9_509.76);
  assert.equal(calculateBillingFiscalGrossAmount(9_409.76, -100), 9_309.76);
  assert.equal(calculateBillingFiscalGrossAmount(0.1, 0.2), 0.3);
});

test("valida a nota pelo valor final com o adiantamento reincorporado", () => {
  assert.equal(calculateBillingFiscalExpectedAmount({
    referenceMonth: "2026-07",
    wbLogin: "wb_pedros",
    grossAmount: 5227.44,
    correctionAmount: 0,
    advanceAmount: 0,
    finalAmount: 5427.44
  }), 5427.44);
  assert.equal(calculateBillingFiscalExpectedAmount({
    referenceMonth: "2026-07",
    wbLogin: "wb_adryan",
    grossAmount: 2540.96,
    correctionAmount: 0,
    advanceAmount: 300,
    finalAmount: 2240.96
  }), 2540.96);
  assert.equal(calculateBillingFiscalExpectedAmount({
    referenceMonth: "2026-07",
    wbLogin: "wb_hernane",
    grossAmount: 572.03,
    correctionAmount: 0,
    advanceAmount: 300,
    finalAmount: 272.03
  }), 572.03);
});
