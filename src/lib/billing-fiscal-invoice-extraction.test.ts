import assert from "node:assert/strict";
import test from "node:test";

import {
  createBillingFiscalValidationToken,
  currencyEquals,
  extractBillingFiscalFieldsFromText,
  hashBillingFiscalFile,
  verifyBillingFiscalValidationToken
} from "./billing-fiscal-invoice-extraction";

const sampleText = `
Chave de Acesso da NFS-e
350950222626295450001 19000000000000526075882824813
Número da NFS-e Competência da NFS-e
5 23/07/2026
Descrição do Serviço
Distrato
TRIBUTAÇÃO MUNICIPAL
Valor do Serviço Desconto Incondicionado
R$ 457,24 -
`;

test("extrai chave, número, descrição e valor da NFS-e nacional", () => {
  assert.deepEqual(extractBillingFiscalFieldsFromText(sampleText), {
    accessKey: "35095022262629545000119000000000000526075882824813",
    invoiceNumber: "5",
    serviceAmount: 457.24,
    serviceDescription: "Distrato"
  });
});

test("compara valores monetários por centavos", () => {
  assert.equal(currencyEquals(457.24, 457.24), true);
  assert.equal(currencyEquals(457.24, 457.25), false);
  assert.equal(currencyEquals(0.1 + 0.2, 0.3), true);
});

test("assina a leitura e rejeita arquivo diferente", async () => {
  process.env.NEXTAUTH_SECRET = "billing-fiscal-test-secret";
  const validatedContent = Buffer.from("nota-validada");
  const validatedFile = new File([validatedContent], "nota.pdf", { type: "application/pdf" });
  const token = createBillingFiscalValidationToken({
    accessKey: "35095022262629545000119000000000000526075882824813",
    invoiceNumber: "5",
    serviceAmount: 457.24,
    serviceDescription: "Distrato",
    documentHash: hashBillingFiscalFile(validatedContent),
    extractionMethod: "OCR",
    actorEmail: "agente@example.com",
    referenceMonth: "2026-07",
    employeeId: "employee-1",
    billingGrossAmount: 457.24
  });

  const validated = await verifyBillingFiscalValidationToken(token, validatedFile, {
    actorEmail: "agente@example.com",
    referenceMonth: "2026-07",
    employeeId: "employee-1",
    billingGrossAmount: 457.24
  });
  assert.equal(validated.serviceAmount, 457.24);

  const differentFile = new File([Buffer.from("nota-diferente")], "nota.pdf", { type: "application/pdf" });
  await assert.rejects(
    verifyBillingFiscalValidationToken(token, differentFile, {
      actorEmail: "agente@example.com",
      referenceMonth: "2026-07",
      employeeId: "employee-1",
      billingGrossAmount: 457.24
    }),
    /arquivo enviado não é o mesmo/i
  );

  await assert.rejects(
    verifyBillingFiscalValidationToken(token, validatedFile, {
      actorEmail: "agente@example.com",
      referenceMonth: "2026-07",
      employeeId: "employee-1",
      billingGrossAmount: 457.25
    }),
    /valor esperado da nota fiscal mudou/i
  );
});
