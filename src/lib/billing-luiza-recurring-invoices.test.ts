import assert from "node:assert/strict";
import test from "node:test";
import { getBillingFiscalCodeExceptionId, isBillingFiscalCodeExceptionAllowed } from "./billing-fiscal-document-exceptions";
import { isBillingFiscalAmountMismatchExempt } from "./billing-fiscal-invoice";
import {
  createBillingFiscalValidationToken,
  extractBillingFiscalFieldsFromText,
  hashBillingFiscalFile,
  validateBillingFiscalComplianceFields,
  verifyBillingFiscalValidationToken
} from "./billing-fiscal-invoice-extraction";

const supplierTaxId = "15269932000101";
const fields = {
  accessKey: "3".repeat(50),
  invoiceNumber: "1", serviceAmount: 3136.36,
  customerTaxId: "58151940000161", supplierTaxId,
  taxationCode: "17.06.01", nbsCode: "1.2101.30.00"
};

test("lê CNPJs com espaços entre a pontuação e os dígitos no DANFSe v2", () => {
  const text = `EMITENTE DA NFS-e\nPrestador\nSITUAÇÃO DA NFS-e\nNFS-e Gerada
PRESTADOR   /   FORNECEDOR   CNPJ   /   CPF   /   NIF
15.269.932/0001- 01
Indicador Municipal (Inscrição)\n000000044919328
TOMADOR   /   ADQUIRENTE   CNPJ   /   CPF   /   NIF
58.151.940/0001- 61
Indicador Municipal (Inscrição)\n-
SERVIÇO PRESTADO
Código de Tributação Nacional/Municipal\n17.06.01 / 001
Código da NBS\n1.2101.30.00`;
  const result = extractBillingFiscalFieldsFromText(text);
  assert.equal(result.supplierTaxId, supplierTaxId);
  assert.equal(result.customerTaxId, fields.customerTaxId);
  assert.equal(result.taxationCode, fields.taxationCode);
  assert.equal(result.nbsCode, fields.nbsCode);
  assert.equal(extractBillingFiscalFieldsFromText(text.replace("15.269.932/0001- 01", "não informado")).supplierTaxId, "");
  assert.equal(extractBillingFiscalFieldsFromText(text.replace("58.151.940/0001- 61", "não informado")).customerTaxId, "");
});

for (const referenceMonth of ["2026-10", "2026-11", "2027-01"]) {
  test(`aceita os formatos nacional e municipal da Luiza em ${referenceMonth}, independentemente do arquivo`, () => {
    const context = { wbLogin: " WB_LUIZA03 ", referenceMonth, documentHash: `outro-arquivo-${referenceMonth}` };
    for (const source of [fields, { ...fields, taxationCode: "03115", nbsCode: "" }]) {
      assert.equal(isBillingFiscalCodeExceptionAllowed(context, source), true);
      assert.equal(getBillingFiscalCodeExceptionId(context, source), "LUIZA03_RECURRING_CODES");
      assert.equal(validateBillingFiscalComplianceFields(source, supplierTaxId, context).supplierTaxId, supplierTaxId);
    }
    assert.equal(isBillingFiscalAmountMismatchExempt("wb_luiza03", referenceMonth), false);
  });
}

test("a autorização recorrente não libera outro parceiro, prestador ou combinação de códigos", () => {
  for (const context of [undefined, { wbLogin: "wb_gene" }, { wbLogin: "wb_luiza030" }]) {
    assert.equal(isBillingFiscalCodeExceptionAllowed(context, fields), false);
    assert.throws(() => validateBillingFiscalComplianceFields(fields, supplierTaxId, context), /Código de Tributação incorreto/);
  }
  const context = { wbLogin: "wb_luiza03" };
  for (const source of [
    { ...fields, supplierTaxId: "62388834000173" },
    { ...fields, taxationCode: "17.06.02" },
    { ...fields, nbsCode: "" },
    { ...fields, nbsCode: "1.1703.99.00" },
    { ...fields, taxationCode: "03115", nbsCode: "1.2101.30.00" }
  ]) assert.equal(isBillingFiscalCodeExceptionAllowed(context, source), false);
  for (const source of [
    { ...fields, customerTaxId: "" },
    { ...fields, customerTaxId: "11111111000111" },
    { ...fields, supplierTaxId: "" },
    { ...fields, supplierTaxId: "11111111000111" }
  ]) assert.throws(() => validateBillingFiscalComplianceFields(source, supplierTaxId, context), /CNPJ do (tomador|prestador)/);
  assert.throws(() => validateBillingFiscalComplianceFields(fields, "11111111000111", context), /CNPJ do prestador/);
});

test("a confirmação da nota da Luiza mantém a assinatura, o arquivo, o usuário, o ciclo e o valor vinculados", async () => {
  process.env.NEXTAUTH_SECRET = "luiza-recurring-invoice-test-secret";
  const file = new File(["nota de teste"], "nota.pdf", { type: "application/pdf" });
  const expected = {
    actorEmail: "luiza@example.com", referenceMonth: "2026-10", employeeId: "luiza-test",
    billingGrossAmount: fields.serviceAmount, wbLogin: "wb_luiza03", supplierTaxId, enforceCompliance: true
  };
  const token = createBillingFiscalValidationToken({ ...fields, ...expected,
    documentHash: hashBillingFiscalFile(Buffer.from(await file.arrayBuffer())),
    extractionMethod: "PDF_TEXT", serviceDescription: "Serviços de moderação"
  });
  assert.equal((await verifyBillingFiscalValidationToken(token, file, expected)).invoiceNumber, "1");
  await assert.rejects(verifyBillingFiscalValidationToken(token, new File(["trocado"], "nota.pdf"), expected), /não é o mesmo/);
  for (const change of [{ actorEmail: "outro@example.com" }, { employeeId: "outro" }, { referenceMonth: "2026-11" }]) {
    await assert.rejects(verifyBillingFiscalValidationToken(token, file, { ...expected, ...change }), /outro invoice ou usuário/);
  }
  await assert.rejects(verifyBillingFiscalValidationToken(token, file, { ...expected, billingGrossAmount: 3136.37 }), /valor esperado.*mudou/);
  await assert.rejects(verifyBillingFiscalValidationToken(token + "x", file, expected), /inválida/);
});
