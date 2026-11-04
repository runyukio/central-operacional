import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { billingFiscalUploadIsReady, EMPTY_BILLING_FISCAL_UPLOAD } from "../components/billing-fiscal-invoice-upload";
import { isBillingFiscalAmountMismatchExempt } from "./billing-fiscal-invoice";
import { BillingFiscalExtractionError } from "./billing-fiscal-invoice-extraction";
import { isBillingFiscalCodeExceptionAllowed } from "./billing-fiscal-document-exceptions";

function sourceFile(file: string) {
  return ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true,
    file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function compileFunction(name: string) {
  const source = sourceFile("./billing-service.ts");
  const node = source.statements.find((item): item is ts.FunctionDeclaration => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node);
  return ts.transpileModule(`(${node.getText(source).replace(/^export\s+/, "")});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
}

test("as cinco consultas da exceção usam o ciclo da nota no servidor e nas duas telas", () => {
  const expected = new Map([
    ["./billing-service.ts", ["employee.wbLogin,referenceMonth", "user.employeeProfile.wbLogin,referenceMonth", "employee.wbLogin,referenceMonth"]],
    ["../components/billing-page.tsx", ["invoice.wbLogin,referenceMonth"]],
    ["../components/my-invoice-page.tsx", ["data?.invoice.wbLogin,data?.referenceMonth"]]
  ]);
  for (const [file, calls] of expected) {
    const source = sourceFile(file), actual: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === "isBillingFiscalAmountMismatchExempt") {
        actual.push(node.arguments.map((arg) => arg.getText(source)).join(","));
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    assert.deepEqual(actual, calls, file);
  }
});

// Execute the actual submission guard with isolated validation doubles.
// These tests cannot reach storage, the database, or Omie.
const submission = compileFunction("resolveBillingFiscalSubmission");
const reusableExtraction = vm.runInNewContext(compileFunction("hasReusableBillingFiscalExtraction"), {
  Boolean, Number, isBillingFiscalCodeExceptionAllowed
}) as (row: unknown, compliance: boolean, context: unknown) => boolean;

test("a nota municipal salva da Luiza pode ser reutilizada em ciclos futuros sem inventar NBS", () => {
  const row = {
    accessKey: "test-key", documentHash: "novo-hash", extractionMethod: "PDF_TEXT", invoiceNumber: "32",
    grossAmount: 3136.36, customerTaxId: "58151940000161", supplierTaxId: "15269932000101",
    taxationCode: "03115", nbsCode: null
  };
  const context = { wbLogin: "wb_luiza03", referenceMonth: "2026-10" };
  assert.equal(reusableExtraction(row, true, context), true);
  assert.equal(reusableExtraction(row, true, { ...context, referenceMonth: "2027-01" }), true);
  assert.equal(reusableExtraction(row, true, { ...context, wbLogin: "wb_outro" }), false);
  assert.equal(reusableExtraction({ ...row, supplierTaxId: "11111111000111" }, true, context), false);
  assert.equal(reusableExtraction({ ...row, customerTaxId: null }, true, context), false);
});
const document = {
  accessKey: "test-key", invoiceNumber: "123", serviceAmount: 900,
  serviceDescription: "Serviços", customerTaxId: "test-customer", supplierTaxId: "test-supplier",
  taxationCode: "17.02.01", nbsCode: "1.703.99.00", documentHash: "test-hash", extractionMethod: "PDF_TEXT"
};

function scenario(wbLogin: string, referenceMonth: string, options: { saved?: boolean; token?: string; complianceError?: boolean; duplicate?: boolean } = {}) {
  const calls: string[] = [];
  const invoke = vm.runInNewContext(submission, {
    BillingFiscalExtractionError, Number,
    verifyBillingFiscalValidationToken: async (token: string, _file: unknown, context: Record<string, unknown>) => {
      calls.push("token");
      assert.equal(context.referenceMonth, referenceMonth);
      assert.equal(context.wbLogin, wbLogin);
      if (token !== "valid-token") throw new BillingFiscalExtractionError("Token inválido");
      return document;
    },
    hasReusableBillingFiscalExtraction: (value: unknown) => Boolean(value),
    normalizeBillingFiscalExtractionMethod: (method: string) => method,
    currencyEquals: (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100),
    formatBillingCurrency: (value: number) => String(value),
    validateBillingFiscalComplianceFields: () => {
      calls.push("compliance");
      if (options.complianceError) throw new BillingFiscalExtractionError("CNPJ incorreto");
    },
    ensureBillingFiscalDocumentAvailable: async () => {
      calls.push("duplicate");
      if (options.duplicate) throw new BillingFiscalExtractionError("Nota já utilizada");
    }
  }) as (input: unknown) => Promise<typeof document>;
  return {
    calls,
    run: () => invoke({
      actorEmail: "test@example.com", employeeId: "employee-from-server", wbLogin, referenceMonth,
      billingGrossAmount: 1000, allowAmountMismatch: isBillingFiscalAmountMismatchExempt(wbLogin, referenceMonth),
      file: options.saved ? null : { name: "nota.pdf" }, validationToken: options.token ?? "valid-token",
      existing: options.saved ? { ...document, grossAmount: document.serviceAmount } : null,
      enforceCompliance: true, supplierTaxId: document.supplierTaxId
    })
  };
}

test("a submissão aceita NF nova ou anexada com diferença somente no ciclo autorizado", async () => {
  for (const wbLogin of ["wb_tiagop", "wb_andersons"]) {
    for (const saved of [false, true]) {
      const allowed = scenario(wbLogin, "2026-09", { saved });
      assert.equal((await allowed.run()).serviceAmount, 900, "preserva o valor real da nota");
      assert.deepEqual(allowed.calls, saved ? ["compliance", "duplicate"] : ["token", "compliance", "duplicate"]);
      for (const month of ["2026-08", "2026-10", "2027-09"]) {
        await assert.rejects(scenario(wbLogin, month, { saved }).run, /diferente do valor esperado/);
      }
    }
  }
  await assert.rejects(scenario("wb_outro", "2026-09").run, /diferente do valor esperado/);
});

test("a exceção mantém token válido, validação fiscal e bloqueio de NF duplicada", async () => {
  for (const wbLogin of ["wb_tiagop", "wb_andersons"]) {
    await assert.rejects(scenario(wbLogin, "2026-09", { token: "" }).run, /Aguarde a leitura automática/);
    await assert.rejects(scenario(wbLogin, "2026-09", { token: "invalid" }).run, /Token inválido/);
    for (const saved of [false, true]) {
      await assert.rejects(scenario(wbLogin, "2026-09", { saved, complianceError: true }).run, /CNPJ incorreto/);
      await assert.rejects(scenario(wbLogin, "2026-09", { saved, duplicate: true }).run, /Nota já utilizada/);
    }
  }
});

test("a autorização de códigos da Luiza não ignora o valor esperado nem a duplicidade", async () => {
  await assert.rejects(scenario("wb_luiza03", "2026-10").run, /diferente do valor esperado/);
  const calls: string[] = [];
  const invoke = vm.runInNewContext(submission, {
    BillingFiscalExtractionError, Number,
    verifyBillingFiscalValidationToken: async () => document,
    currencyEquals: () => true,
    validateBillingFiscalComplianceFields: () => calls.push("compliance"),
    ensureBillingFiscalDocumentAvailable: async () => { calls.push("duplicate"); throw new BillingFiscalExtractionError("Nota já utilizada"); }
  });
  await assert.rejects(invoke({
    file: {}, validationToken: "valid-token", wbLogin: "wb_luiza03", referenceMonth: "2026-10",
    actorEmail: "luiza@example.com", employeeId: "luiza", billingGrossAmount: 900,
    allowAmountMismatch: false, enforceCompliance: true, supplierTaxId: "15269932000101"
  }), /Nota já utilizada/);
  assert.deepEqual(calls, ["compliance", "duplicate"]);
});

test("a tela libera o anexo divergente apenas para a combinação WB e referência", () => {
  const existing = { ...document, grossAmount: document.serviceAmount, fileName: "nota.pdf" };
  for (const wbLogin of ["wb_tiagop", "wb_andersons", "wb_outro"]) {
    for (const month of ["2026-08", "2026-09", "2026-10"]) {
      assert.equal(billingFiscalUploadIsReady(EMPTY_BILLING_FISCAL_UPLOAD, existing, 1000,
        isBillingFiscalAmountMismatchExempt(wbLogin, month)), wbLogin !== "wb_outro" && month === "2026-09");
    }
  }
  assert.equal(billingFiscalUploadIsReady(EMPTY_BILLING_FISCAL_UPLOAD, null, 1000, true), false);
});
