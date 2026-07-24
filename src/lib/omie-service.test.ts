import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOmieIntegrationCode,
  type OmieConfig,
  OmieIntegrationError,
  upsertBillingAccountPayable
} from "./omie-service";

const config: OmieConfig = {
  appKey: "app-key-test",
  appSecret: "app-secret-test",
  categoryCode: "2.04.01",
  checkingAccountId: 4243124,
  dueDays: 0,
  timeoutMs: 5_000
};

const input = {
  employeeInvoiceId: "cm_invoice_123",
  referenceMonth: "2026-07",
  cnpj: "12.345.678/0001-90",
  accessKey: "35095022262629545000119000000000000526075882824813",
  invoiceNumber: "12345",
  serviceDescription: "Serviços de moderação de conteúdo",
  grossAmount: 2225.47,
  approvedAt: new Date("2026-07-18T15:00:00.000Z")
};

test("localiza o fornecedor por CNPJ e envia o valor bruto ao Contas a Pagar", async () => {
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
      codigo_lancamento_integracao: buildOmieIntegrationCode(input.referenceMonth, input.employeeInvoiceId),
      codigo_status: "0",
      descricao_status: "Conta a pagar incluída"
    });
  };

  const result = await upsertBillingAccountPayable(input, { config, fetchImpl: fetchImpl as typeof fetch });

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.call, "ListarClientes");
  assert.deepEqual((requests[0]?.param as Array<Record<string, unknown>>)[0]?.clientesFiltro, { cnpj_cpf: input.cnpj });
  assert.equal(requests[1]?.call, "UpsertContaPagar");
  const payable = (requests[1]?.param as Array<Record<string, unknown>>)[0];
  assert.equal(payable.valor_documento, 2225.47);
  assert.equal(payable.codigo_cliente_fornecedor, 4214850);
  assert.equal(payable.numero_documento_fiscal, "12345");
  assert.match(String(payable.observacao), /35095022262629545000119000000000000526075882824813/);
  assert.equal(payable.chave_nfe, undefined);
  assert.equal(payable.codigo_categoria, "2.04.01");
  assert.equal(payable.id_conta_corrente, 4243124);
  assert.equal(result.launchCode, "987654");
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
