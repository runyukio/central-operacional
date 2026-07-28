import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import JSZip from "jszip";

import {
  attachBillingInvoiceDocument,
  buildOmieAttachmentIntegrationCode,
  buildOmieDocumentNumber,
  buildOmieIntegrationCode,
  buildOmiePixTransferData,
  calculateOmieDueDate,
  type OmieConfig,
  OmieIntegrationError,
  upsertBillingAccountPayable
} from "./omie-service";

const config: OmieConfig = {
  appKey: "app-key-test",
  appSecret: "app-secret-test",
  checkingAccountId: 4243124,
  timeoutMs: 5_000
};

const input = {
  employeeInvoiceId: "cm_invoice_123",
  referenceMonth: "2026-07",
  wbLogin: "wb_lucasy",
  employeeName: "Lucas Yukio",
  roleTitle: "Coordenador",
  cnpj: "12.345.678/0001-90",
  pixKey: "lucas@example.com",
  pixKeyType: "E-mail",
  accessKey: "35095022262629545000119000000000000526075882824813",
  invoiceNumber: "12345",
  serviceDescription: "Serviços de moderação de conteúdo",
  grossAmount: 2225.47,
  documentAmount: 1840,
  projectCode: 10011279879,
  documentTypeCode: "ADI",
  categories: [
    { code: "2.10.96", value: 1740 },
    { code: "2.02.04", value: 100 }
  ],
  billingGrossAmount: 2200,
  correctionAmount: 25.47,
  bonusAmount: 100,
  campaignAmount: 50,
  advanceAmount: 500,
  discountAmount: 20,
  otherAdjustmentAmount: 10,
  approvedAt: new Date("2026-07-18T15:00:00.000Z")
};

test("localiza o fornecedor e envia projeto, rateio e transferência por chave PIX", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    if (body.call === "ListarClientes") {
      return Response.json({
        clientes_cadastro: [{ codigo_cliente_omie: 4214850, cnpj_cpf: "12.345.678/0001-90" }]
      });
    }
    return Response.json({
      codigo_lancamento_omie: 987654,
      codigo_lancamento_integracao: buildOmieIntegrationCode(input.referenceMonth, input.wbLogin),
      codigo_status: "0",
      descricao_status: "Conta a pagar incluída"
    });
  };

  const result = await upsertBillingAccountPayable(input, {
    config,
    fetchImpl: fetchImpl as typeof fetch,
    now: new Date("2026-07-27T15:00:00.000Z")
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.call, "ListarClientes");
  assert.deepEqual((requests[0]?.param as Array<Record<string, unknown>>)[0]?.clientesFiltro, { cnpj_cpf: input.cnpj });
  assert.equal(requests[1]?.call, "UpsertContaPagar");
  const payable = (requests[1]?.param as Array<Record<string, unknown>>)[0];
  assert.equal(payable.valor_documento, 1840);
  assert.equal(payable.codigo_cliente_fornecedor, 4214850);
  assert.equal(payable.numero_documento_fiscal, "12345");
  assert.equal(payable.numero_documento, "B202607-wblucasy");
  assert.equal(payable.codigo_projeto, 10011279879);
  assert.equal(payable.codigo_tipo_documento, "ADI");
  assert.deepEqual(payable.cnab_integracao_bancaria, {
    codigo_forma_pagamento: "TRA",
    finalidade_transferencia: "01.3",
    cpf_cnpj_transferencia: "12345678000190",
    nome_transferencia: "Lucas Yukio",
    pix_qrcode: "lucas@example.com"
  });
  assert.equal(payable.numero_parcela, "001/001");
  assert.equal(payable.data_emissao, "18/07/2026");
  assert.equal(payable.data_entrada, "18/07/2026");
  assert.equal(payable.data_vencimento, "07/08/2026");
  assert.equal(payable.data_previsao, "07/08/2026");
  assert.match(String(payable.observacao), /35095022262629545000119000000000000526075882824813/);
  assert.equal(payable.chave_nfe, undefined);
  assert.deepEqual(payable.categorias, [
    { codigo_categoria: "2.10.96", valor: 1740, percentual: 94.57 },
    { codigo_categoria: "2.02.04", valor: 100, percentual: 5.43 }
  ]);
  assert.equal(payable.id_conta_corrente, 4243124);
  assert.match(String(payable.observacao), /WB: wb_lucasy/);
  assert.match(String(payable.observacao), /Cargo: Coordenador/);
  assert.match(String(payable.observacao), /Bruto: R\$ 2\.200,00/);
  assert.match(String(payable.observacao), /Correção: R\$ 25,47/);
  assert.match(String(payable.observacao), /Valor NF: R\$ 2\.225,47/);
  assert.match(String(payable.observacao), /Bônus: R\$ 100,00/);
  assert.match(String(payable.observacao), /Adiantamento: R\$ 500,00/);
  assert.match(String(payable.observacao), /Final: R\$ 1\.840,00/);
  assert.equal(result.launchCode, "987654");
});

test("monta identificadores legíveis e estáveis por mês e WB", () => {
  assert.equal(buildOmieIntegrationCode("2026-07", "wb_lucasy"), "billing-2026-07-wb_lucasy");
  assert.equal(buildOmieDocumentNumber("2026-07", "wb_lucasy"), "B202607-wblucasy");
});

test("calcula o quinto dia útil do mês seguinte sem contar fins de semana", () => {
  assert.equal(
    calculateOmieDueDate("2026-07", new Date("2026-07-27T15:00:00.000Z")).toISOString(),
    "2026-08-07T12:00:00.000Z"
  );
});

test("considera Sexta-feira Santa e Corpus Christi no calendário de São Paulo", () => {
  assert.equal(
    calculateOmieDueDate("2026-03", new Date("2026-03-01T15:00:00.000Z")).toISOString(),
    "2026-04-08T12:00:00.000Z"
  );
  assert.equal(
    calculateOmieDueDate("2026-05", new Date("2026-05-01T15:00:00.000Z")).toISOString(),
    "2026-06-08T12:00:00.000Z"
  );
});

test("normaliza chaves PIX de CPF, telefone e e-mail para transferência bancária", () => {
  assert.equal(buildOmiePixTransferData({
    employeeName: "Pedro",
    cnpj: "65.747.341/0001-70",
    pixKey: "506.392.658-47",
    pixKeyType: "CPF"
  }).pix_qrcode, "50639265847");
  assert.equal(buildOmiePixTransferData({
    employeeName: "Pessoa",
    cnpj: "12.345.678/0001-90",
    pixKey: "(11) 99999-9999",
    pixKeyType: "Telefone"
  }).pix_qrcode, "+5511999999999");
  assert.equal(buildOmiePixTransferData({
    employeeName: "Pessoa",
    cnpj: "12.345.678/0001-90",
    pixKey: "PESSOA@EXAMPLE.COM",
    pixKeyType: "E-mail"
  }).pix_qrcode, "pessoa@example.com");
});

test("envia chave_nfe somente quando a chave possui os 44 dígitos aceitos pelo Omie", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    return body.call === "ListarClientes"
      ? Response.json({ clientes_cadastro: [{ codigo_cliente_omie: 123, cnpj_cpf: input.cnpj }] })
      : Response.json({ codigo_lancamento_omie: 456, codigo_lancamento_integracao: "billing-nfe-key" });
  };

  const accessKey = "35260758151940000161550010000000011000000011";
  await upsertBillingAccountPayable(
    { ...input, accessKey },
    { config, fetchImpl: fetchImpl as typeof fetch }
  );

  const payable = (requests[1]?.param as Array<Record<string, unknown>>)[0];
  assert.equal(payable.chave_nfe, accessKey);
});

test("mantém a chave de integração informada para tornar o reenvio idempotente", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    return body.call === "ListarClientes"
      ? Response.json({ clientes_cadastro: [{ codigo_cliente_omie: 123, cnpj_cpf: input.cnpj }] })
      : Response.json({ codigo_lancamento_omie: 456, codigo_lancamento_integracao: "billing-stable-key" });
  };

  await upsertBillingAccountPayable(
    { ...input, integrationCode: "billing-stable-key" },
    { config, fetchImpl: fetchImpl as typeof fetch }
  );

  const payable = (requests[1]?.param as Array<Record<string, unknown>>)[0];
  assert.equal(payable.codigo_lancamento_integracao, "billing-stable-key");
});

test("compacta a nota fiscal e a anexa ao lançamento de Contas a Pagar", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const invoiceFile = Buffer.from("%PDF-1.7 nota fiscal de teste");
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    return body.call === "ListarAnexo"
      ? Response.json({ listaAnexos: [] })
      : Response.json({
        cCodIntAnexo: buildOmieAttachmentIntegrationCode(input.employeeInvoiceId, "document-hash"),
        nIdAnexo: 7654321,
        cNomeArquivo: "NF-05-distrato-EVA.pdf",
        cCodStatus: "0",
        cDesStatus: "Anexo incluído"
      });
  };

  const result = await attachBillingInvoiceDocument({
    employeeInvoiceId: input.employeeInvoiceId,
    documentHash: "document-hash",
    launchCode: "987654",
    fileName: "NF.05 distrato ÉVA.pdf",
    file: invoiceFile
  }, { config, fetchImpl: fetchImpl as typeof fetch });

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.call, "ListarAnexo");
  assert.deepEqual((requests[0]?.param as Array<Record<string, unknown>>)[0], {
    nPagina: 1,
    nRegPorPagina: 100,
    nId: 987654,
    cTabela: "conta-pagar"
  });
  assert.equal(requests[1]?.call, "IncluirAnexo");
  const attachment = (requests[1]?.param as Array<Record<string, unknown>>)[0];
  assert.equal(attachment.cTabela, "conta-pagar");
  assert.equal(attachment.nId, 987654);
  assert.equal(attachment.cNomeArquivo, "NF-05-distrato-EVA.pdf");
  assert.equal(attachment.cTipoArquivo, "PDF");
  assert.equal(String(attachment.cCodIntAnexo).length, 20);

  const zippedFile = Buffer.from(String(attachment.cArquivo), "base64");
  assert.equal(attachment.cMd5, createHash("md5").update(String(attachment.cArquivo)).digest("hex"));
  const zip = await JSZip.loadAsync(zippedFile);
  assert.deepEqual(await zip.file("NF-05-distrato-EVA.pdf")?.async("nodebuffer"), invoiceFile);
  assert.equal(result.attachmentId, "7654321");
  assert.equal(result.alreadyAttached, false);
});

test("não duplica a nota fiscal quando o anexo já existe no lançamento", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const integrationCode = buildOmieAttachmentIntegrationCode(input.employeeInvoiceId, "document-hash");
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    return Response.json({
      listaAnexos: [{
        cCodIntAnexo: integrationCode,
        nIdAnexo: 7654321,
        cNomeArquivo: "nota-fiscal.pdf"
      }]
    });
  };

  const result = await attachBillingInvoiceDocument({
    employeeInvoiceId: input.employeeInvoiceId,
    documentHash: "document-hash",
    launchCode: "987654",
    fileName: "nota-fiscal.pdf",
    file: Buffer.from("arquivo")
  }, { config, fetchImpl: fetchImpl as typeof fetch });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.call, "ListarAnexo");
  assert.equal(result.attachmentId, "7654321");
  assert.equal(result.alreadyAttached, true);
});

test("não expõe o segredo quando o Omie devolve uma falha", async () => {
  const fetchImpl = async () => new Response(
    JSON.stringify({ faultstring: "Falha de autenticação app_secret=segredo-total" }),
    { status: 500, headers: { "Content-Type": "application/json" } }
  );

  await assert.rejects(
    () => upsertBillingAccountPayable(input, { config, fetchImpl: fetchImpl as typeof fetch }),
    (error: unknown) => {
      assert.ok(error instanceof OmieIntegrationError);
      assert.equal(error.message.includes("segredo-total"), false);
      return true;
    }
  );
});
