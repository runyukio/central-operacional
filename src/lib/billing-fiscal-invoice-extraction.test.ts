import assert from "node:assert/strict";
import test from "node:test";
import { getBillingFiscalDocumentCodeException } from "./billing-fiscal-document-exceptions";
import { isBillingFiscalAmountMismatchExempt } from "./billing-fiscal-invoice";

import {
  createBillingFiscalValidationToken,
  currencyEquals,
  extractBillingFiscalInvoice,
  extractBillingFiscalFieldsFromText,
  hashBillingFiscalFile,
  validateBillingFiscalComplianceFields,
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
TOMADOR / ADQUIRENTE
CNPJ / CPF / NIF
58.151.940/0001-61
PRESTADOR / FORNECEDOR
CNPJ / CPF / NIF
62.388.834/0001-73
Código de Tributação Nacional
17.02.01
Código da NBS
1.703.99.00
`;

const saoPauloMunicipalSampleText = `
PREFEITURA DO MUNICÍPIO DE SÃO PAULO
SECRETARIA MUNICIPAL DA FAZENDA
NOTA FISCAL ELETRÔNICA DE SERVIÇOS - NFS-e
Número da Nota
Data e Hora de Emissão
Código de Verificação
20260803u15269932000101
00000029
03/08/2026 18:33:05
4GYD-UWCA
Identificador Nacional: 35503081215269932000101000000000002926086129807140
DISCRIMINAÇÃO DE SERVIÇOS
Serviços de moderação de redes sociais
VALOR TOTAL DO SERVIÇO = R$ 3.000,80
`;

const municipalFiscalSampleText = `${saoPauloMunicipalSampleText}
PRESTADOR DE SERVIÇOS
CPF/CNPJ: Inscrição Municipal:
Nome/Razão Social:
Endereço:
62.388.834/0001-73 4.491.932-8
Empresa prestadora de serviços
TOMADOR DE SERVIÇOS
Nome/Razão Social:
CPF/CNPJ: Inscrição Municipal:
Endereço:
Empresa tomadora de serviços
58.151.940/0001-61 1.637.375-8
INTERMEDIÁRIO DE SERVIÇOS
CPF/CNPJ: Nome/Razão Social: ---- ----
Código do Serviço
03115 - Assessoria ou consultoria
`;

const municipalDocumentContext = {
  wbLogin: "wb_luiza03",
  referenceMonth: "2026-08",
  documentHash: "0204976f20b0f8df862d0d4f4c12e7fbaef57e05599759183660a9d9c0ad52a8"
};

test("extrai os CNPJs das seções municipais e preserva o código de serviço sem inventar NBS", () => {
  const fields = extractBillingFiscalFieldsFromText(municipalFiscalSampleText);
  assert.equal(fields.customerTaxId, "58151940000161");
  assert.equal(fields.supplierTaxId, "62388834000173");
  assert.equal(fields.taxationCode, "03115");
  assert.equal(fields.nbsCode, "");
  assert.equal(fields.serviceAmount, 3000.8);
});

test("não usa o CNPJ do tomador como prestador se o CNPJ do prestador estiver ausente", () => {
  const fields = extractBillingFiscalFieldsFromText(municipalFiscalSampleText.replace("62.388.834/0001-73", "não informado"));
  assert.equal(fields.supplierTaxId, "");
  assert.equal(fields.customerTaxId, "58151940000161");
});

test("permite o código municipal e a ausência de NBS somente para o documento autorizado", () => {
  const fields = extractBillingFiscalFieldsFromText(municipalFiscalSampleText);
  assert.deepEqual(validateBillingFiscalComplianceFields(fields, "62388834000173", municipalDocumentContext), {
    customerTaxId: "58151940000161",
    supplierTaxId: "62388834000173",
    taxationCode: "03115",
    nbsCode: ""
  });
  assert.equal(getBillingFiscalDocumentCodeException(municipalDocumentContext)?.id, "SAO_PAULO_NF30_LUIZA03_2026_08");
  assert.equal(isBillingFiscalAmountMismatchExempt("wb_luiza03"), false);
});

test("não libera o código municipal para outro parceiro, outro PDF, outro ciclo ou sem contexto", () => {
  const fields = extractBillingFiscalFieldsFromText(municipalFiscalSampleText);
  for (const context of [
    undefined,
    { ...municipalDocumentContext, wbLogin: "wb_outro" },
    { ...municipalDocumentContext, wbLogin: undefined },
    { ...municipalDocumentContext, referenceMonth: "2026-09" },
    { ...municipalDocumentContext, documentHash: "outro-documento" },
    { ...municipalDocumentContext, documentHash: undefined }
  ]) {
    assert.equal(getBillingFiscalDocumentCodeException(context), null);
    assert.throws(
      () => validateBillingFiscalComplianceFields(fields, "62388834000173", context),
      /Código de Tributação incorreto/
    );
  }
});

test("a exceção de códigos mantém obrigatória a conferência dos CNPJs", () => {
  const fields = extractBillingFiscalFieldsFromText(municipalFiscalSampleText);
  for (const customerTaxId of ["", "11111111000111"]) {
    assert.throws(
      () => validateBillingFiscalComplianceFields({ ...fields, customerTaxId }, "62388834000173", municipalDocumentContext),
      /CNPJ do tomador/
    );
  }
  for (const supplierTaxId of ["", "11111111000111"]) {
    assert.throws(
      () => validateBillingFiscalComplianceFields({ ...fields, supplierTaxId }, "62388834000173", municipalDocumentContext),
      /CNPJ do prestador/
    );
  }
  assert.throws(
    () => validateBillingFiscalComplianceFields(fields, "", municipalDocumentContext),
    /cadastro não possui um CNPJ válido/
  );
  assert.throws(
    () => validateBillingFiscalComplianceFields(fields, "11111111000111", municipalDocumentContext),
    /CNPJ do prestador incorreto/
  );
});

test("a exceção não aceita campos fiscais diferentes dos autorizados", () => {
  const fields = extractBillingFiscalFieldsFromText(municipalFiscalSampleText);
  for (const overrides of [{ taxationCode: "99999" }, { nbsCode: "1.111.11.11" }, { nbsCode: "inválido" }]) {
    assert.throws(
      () => validateBillingFiscalComplianceFields({ ...fields, ...overrides }, "62388834000173", municipalDocumentContext),
      /Código de Tributação incorreto/
    );
  }
});

test("um token com hash autorizado não libera um arquivo diferente", async () => {
  process.env.NEXTAUTH_SECRET = "billing-fiscal-test-secret";
  const fields = extractBillingFiscalFieldsFromText(municipalFiscalSampleText);
  const expected = {
    actorEmail: "parceiro@example.com",
    referenceMonth: "2026-08",
    employeeId: "employee-municipal",
    billingGrossAmount: 3000.8
  };
  const token = createBillingFiscalValidationToken({
    ...fields,
    ...expected,
    documentHash: municipalDocumentContext.documentHash,
    extractionMethod: "PDF_TEXT"
  });
  await assert.rejects(
    verifyBillingFiscalValidationToken(token, new File(["outro PDF"], "nota.pdf"), {
      ...expected,
      wbLogin: "wb_luiza03",
      enforceCompliance: true,
      supplierTaxId: "62388834000173"
    }),
    /arquivo enviado não é o mesmo/
  );
});

test("extrai chave, número, descrição e valor da NFS-e nacional", () => {
  assert.deepEqual(extractBillingFiscalFieldsFromText(sampleText), {
    accessKey: "35095022262629545000119000000000000526075882824813",
    invoiceNumber: "5",
    serviceAmount: 457.24,
    serviceDescription: "Distrato",
    customerTaxId: "58151940000161",
    supplierTaxId: "62388834000173",
    taxationCode: "17.02.01",
    nbsCode: "1.703.99.00"
  });
});

test("extrai identificador, número e valor da NFS-e municipal de São Paulo", () => {
  assert.deepEqual(extractBillingFiscalFieldsFromText(saoPauloMunicipalSampleText), {
    accessKey: "35503081215269932000101000000000002926086129807140",
    invoiceNumber: "00000029",
    serviceAmount: 3000.8,
    serviceDescription: "Serviços de moderação de redes sociais",
    customerTaxId: "",
    supplierTaxId: "",
    taxationCode: "",
    nbsCode: ""
  });
});

test("valida tomador, prestador, tributação e NBS do fluxo Omie", () => {
  assert.deepEqual(validateBillingFiscalComplianceFields({
    customerTaxId: "58.151.940/0001-61",
    supplierTaxId: "62.388.834/0001-73",
    taxationCode: "170201",
    nbsCode: "17039900"
  }, "62.388.834/0001-73"), {
    customerTaxId: "58151940000161",
    supplierTaxId: "62388834000173",
    taxationCode: "17.02.01",
    nbsCode: "1.703.99.00"
  });
});

test("aceita o Código da NBS alternativo no fluxo Omie", () => {
  assert.deepEqual(validateBillingFiscalComplianceFields({
    customerTaxId: "58.151.940/0001-61",
    supplierTaxId: "62.388.834/0001-73",
    taxationCode: "17.02.01",
    nbsCode: "14011300"
  }, "62.388.834/0001-73"), {
    customerTaxId: "58151940000161",
    supplierTaxId: "62388834000173",
    taxationCode: "17.02.01",
    nbsCode: "1.401.13.00"
  });
});

for (const nbsCode of ["1.1806.59.00", "118065900", "1 1806 59 00", "1-1806-59-00"]) {
  test(`extrai e valida o NBS de nove dígitos sem truncar: ${nbsCode}`, () => {
    const fields = extractBillingFiscalFieldsFromText(sampleText.replace("1.703.99.00", nbsCode));
    assert.equal(fields.nbsCode, "1.1806.59.00");
    assert.equal(
      validateBillingFiscalComplianceFields(fields, "62.388.834/0001-73").nbsCode,
      "1.1806.59.00"
    );
    assert.equal(
      validateBillingFiscalComplianceFields({ ...fields, nbsCode }, "62.388.834/0001-73").nbsCode,
      "1.1806.59.00"
    );
  });
}

test("não extrai um NBS permitido a partir de um código maior", () => {
  for (const nbsCode of ["1180659000", "1.11806.59.00", "1.1806.59.001", "9.1.1806.59.00", "9 1 1806 59 00"]) {
    const fields = extractBillingFiscalFieldsFromText(sampleText.replace("1.703.99.00", nbsCode));
    assert.equal(fields.nbsCode, "", nbsCode);
  }
});

test("continua recusando códigos NBS não autorizados de oito ou nove dígitos", () => {
  const fields = extractBillingFiscalFieldsFromText(sampleText);
  for (const nbsCode of ["1.806.59.00", "1.1806.59.01"]) {
    assert.throws(
      () => validateBillingFiscalComplianceFields({ ...fields, nbsCode }, "62.388.834/0001-73"),
      /Código da NBS incorreto/
    );
  }
});

test("extrai os campos fiscais obrigatórios do XML", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <Nfse>
      <chNFSe>35095022262629545000119000000000000526075882824813</chNFSe>
      <nNFSe>5</nNFSe>
      <vServ>457.24</vServ>
      <Discriminacao>Serviços de moderação</Discriminacao>
      <CnpjTomador>58151940000161</CnpjTomador>
      <CnpjPrestador>62388834000173</CnpjPrestador>
      <cTribNac>170201</cTribNac>
      <cNBS>17039900</cNBS>
    </Nfse>`;
  const result = await extractBillingFiscalInvoice(new File([xml], "nota.xml", { type: "application/xml" }), {
    requireComplianceFields: true
  });
  assert.equal(result.customerTaxId, "58151940000161");
  assert.equal(result.supplierTaxId, "62388834000173");
  assert.equal(result.taxationCode, "17.02.01");
  assert.equal(result.nbsCode, "1.703.99.00");
});

test("explica cada divergência fiscal para o parceiro corrigir", () => {
  const valid = {
    customerTaxId: "58151940000161",
    supplierTaxId: "62388834000173",
    taxationCode: "17.02.01",
    nbsCode: "1.703.99.00"
  };
  assert.throws(
    () => validateBillingFiscalComplianceFields({ ...valid, customerTaxId: "11111111000111" }, valid.supplierTaxId),
    /CNPJ do tomador incorreto.*Corrija e emita novamente/i
  );
  assert.throws(
    () => validateBillingFiscalComplianceFields({ ...valid, supplierTaxId: "22222222000122" }, valid.supplierTaxId),
    /CNPJ do prestador incorreto.*atualize seu cadastro/i
  );
  assert.throws(
    () => validateBillingFiscalComplianceFields({ ...valid, taxationCode: "01.01.01" }, valid.supplierTaxId),
    /Código de Tributação incorreto.*17\.02\.01/i
  );
  assert.throws(
    () => validateBillingFiscalComplianceFields({ ...valid, nbsCode: "1.111.11.11" }, valid.supplierTaxId),
    /Código da NBS incorreto.*1\.703\.99\.00 ou 1\.401\.13\.00 ou 1\.1806\.59\.00/i
  );
  assert.throws(
    () => validateBillingFiscalComplianceFields({ ...valid, customerTaxId: "" }, valid.supplierTaxId),
    /Não foi possível identificar o CNPJ do tomador.*58\.151\.940\/0001-61/i
  );
  assert.throws(
    () => validateBillingFiscalComplianceFields({ ...valid, supplierTaxId: "" }, valid.supplierTaxId),
    /Não foi possível identificar o CNPJ do prestador.*62\.388\.834\/0001-73/i
  );
  assert.throws(
    () => validateBillingFiscalComplianceFields({ ...valid, taxationCode: "" }, valid.supplierTaxId),
    /Não foi possível identificar o Código de Tributação.*17\.02\.01/i
  );
  assert.throws(
    () => validateBillingFiscalComplianceFields({ ...valid, nbsCode: "" }, valid.supplierTaxId),
    /Não foi possível identificar o Código da NBS.*1\.703\.99\.00 ou 1\.401\.13\.00 ou 1\.1806\.59\.00/i
  );
});

test("compara valores monetários por centavos", () => {
  assert.equal(currencyEquals(457.24, 457.24), true);
  assert.equal(currencyEquals(457.24, 457.25), false);
  assert.equal(currencyEquals(0.1 + 0.2, 0.3), true);
});

test("preserva o NBS de nove dígitos ao confirmar a nota validada", async () => {
  process.env.NEXTAUTH_SECRET = "billing-fiscal-test-secret";
  const content = Buffer.from("nota-nbs-118065900");
  const file = new File([content], "nota.pdf", { type: "application/pdf" });
  const fields = extractBillingFiscalFieldsFromText(sampleText.replace("1.703.99.00", "1.1806.59.00"));
  const expected = {
    actorEmail: "agente@example.com",
    referenceMonth: "2026-08",
    employeeId: "employee-1",
    billingGrossAmount: 457.24
  };
  const token = createBillingFiscalValidationToken({
    ...fields,
    ...expected,
    documentHash: hashBillingFiscalFile(content),
    extractionMethod: "OCR"
  });
  const validated = await verifyBillingFiscalValidationToken(token, file, {
    ...expected,
    enforceCompliance: true,
    supplierTaxId: "62.388.834/0001-73"
  });
  assert.equal(validated.nbsCode, "1.1806.59.00");
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
    customerTaxId: "58151940000161",
    supplierTaxId: "62388834000173",
    taxationCode: "17.02.01",
    nbsCode: "1.703.99.00",
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
    billingGrossAmount: 457.24,
    enforceCompliance: true,
    supplierTaxId: "62.388.834/0001-73"
  });
  assert.equal(validated.serviceAmount, 457.24);

  await assert.rejects(
    verifyBillingFiscalValidationToken(token, validatedFile, {
      actorEmail: "agente@example.com",
      referenceMonth: "2026-07",
      employeeId: "employee-1",
      billingGrossAmount: 457.24,
      enforceCompliance: true,
      supplierTaxId: "11.111.111/0001-11"
    }),
    /CNPJ do prestador incorreto/i
  );

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
