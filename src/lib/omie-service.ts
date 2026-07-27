import { createHash } from "node:crypto";
import { basename, extname } from "node:path";

import JSZip from "jszip";

const OMIE_CLIENTS_ENDPOINT = "https://app.omie.com.br/api/v1/geral/clientes/";
const OMIE_ACCOUNTS_PAYABLE_ENDPOINT = "https://app.omie.com.br/api/v1/financas/contapagar/";
const OMIE_ATTACHMENTS_ENDPOINT = "https://app.omie.com.br/api/v1/geral/anexo/";
const OMIE_ACCOUNTS_PAYABLE_ATTACHMENT_TABLE = "conta-pagar";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_DUE_DAYS = 0;

export type OmieConfig = {
  appKey: string;
  appSecret: string;
  categoryCode: string;
  checkingAccountId: number | null;
  dueDays: number;
  timeoutMs: number;
};

export type OmieAccountPayableInput = {
  employeeInvoiceId: string;
  referenceMonth: string;
  cnpj: string;
  accessKey: string;
  invoiceNumber: string;
  serviceDescription: string;
  grossAmount: number;
  approvedAt: Date;
  integrationCode?: string | null;
};

export type OmieAccountPayableResult = {
  integrationCode: string;
  launchCode: string;
  supplierCode: string;
  statusCode: string;
  statusDescription: string;
};

export type OmieDocumentAttachmentInput = {
  employeeInvoiceId: string;
  documentHash?: string | null;
  launchCode: string;
  fileName: string;
  file: Uint8Array;
};

export type OmieDocumentAttachmentResult = {
  integrationCode: string;
  attachmentId: string;
  fileName: string;
  alreadyAttached: boolean;
  statusDescription: string;
};

type FetchLike = typeof fetch;

type OmieSupplier = {
  codigo_cliente_omie?: number | string;
  codigo_cliente_integracao?: string;
  cnpj_cpf?: string;
};

type OmieSupplierListResponse = {
  clientes_cadastro?: OmieSupplier[];
};

type OmiePayableResponse = {
  codigo_lancamento_omie?: number | string;
  codigo_lancamento_integracao?: string;
  codigo_status?: string;
  descricao_status?: string;
};

type OmieAttachment = {
  cCodIntAnexo?: string;
  nIdAnexo?: number | string;
  cNomeArquivo?: string;
};

type OmieAttachmentListResponse = {
  listaAnexos?: OmieAttachment[];
};

type OmieAttachmentResponse = OmieAttachment & {
  cCodStatus?: string;
  cDesStatus?: string;
};

export class OmieIntegrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OmieIntegrationError";
  }
}

export function loadOmieConfig(env: NodeJS.ProcessEnv = process.env): OmieConfig {
  const appKey = String(env.OMIE_APP_KEY ?? "").trim();
  const appSecret = String(env.OMIE_APP_SECRET ?? "").trim();
  const categoryCode = String(env.OMIE_ACCOUNT_PAYABLE_CATEGORY_CODE ?? "").trim();
  if (!appKey || !appSecret || !categoryCode) {
    throw new OmieIntegrationError("Integração Omie não configurada. Informe App Key, App Secret e categoria de Contas a Pagar.");
  }

  const checkingAccountRaw = String(env.OMIE_CHECKING_ACCOUNT_ID ?? "").trim();
  const checkingAccountId = checkingAccountRaw ? Number(checkingAccountRaw) : null;
  if (checkingAccountRaw && (checkingAccountId === null || !Number.isSafeInteger(checkingAccountId) || checkingAccountId <= 0)) {
    throw new OmieIntegrationError("OMIE_CHECKING_ACCOUNT_ID inválido.");
  }

  return {
    appKey,
    appSecret,
    categoryCode,
    checkingAccountId,
    dueDays: parseBoundedInteger(env.OMIE_PAYMENT_DUE_DAYS, DEFAULT_DUE_DAYS, 0, 365),
    timeoutMs: parseBoundedInteger(env.OMIE_API_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1_000, 60_000)
  };
}

export function normalizeBrazilianTaxId(value: string) {
  return String(value ?? "").replace(/\D/g, "");
}

export function formatBrazilianCnpj(value: string) {
  const digits = normalizeBrazilianTaxId(value);
  if (digits.length !== 14) throw new OmieIntegrationError("O colaborador não possui um CNPJ válido para localizar o fornecedor no Omie.");
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

export function buildOmieIntegrationCode(referenceMonth: string, employeeInvoiceId: string) {
  const normalizedMonth = String(referenceMonth).replace(/[^0-9-]/g, "").slice(0, 7);
  const normalizedId = String(employeeInvoiceId).replace(/[^a-zA-Z0-9_-]/g, "");
  return `billing-${normalizedMonth}-${normalizedId}`.slice(0, 60);
}

export function buildOmieAttachmentIntegrationCode(employeeInvoiceId: string, documentHash?: string | null) {
  const digest = createHash("sha256")
    .update(`${employeeInvoiceId}:${String(documentHash ?? "")}`)
    .digest("hex");
  return `bnf-${digest.slice(0, 16)}`;
}

export async function upsertBillingAccountPayable(
  input: OmieAccountPayableInput,
  options: { config?: OmieConfig; fetchImpl?: FetchLike } = {}
): Promise<OmieAccountPayableResult> {
  const config = options.config ?? loadOmieConfig();
  const fetchImpl = options.fetchImpl ?? fetch;
  const cnpj = formatBrazilianCnpj(input.cnpj);
  const supplier = await findSupplierByCnpj(cnpj, config, fetchImpl);
  const supplierCode = String(supplier.codigo_cliente_omie ?? "").trim();
  if (!supplierCode) throw new OmieIntegrationError(`Fornecedor do CNPJ ${maskCnpj(cnpj)} não possui código válido no Omie.`);

  const integrationCode = input.integrationCode || buildOmieIntegrationCode(input.referenceMonth, input.employeeInvoiceId);
  const issueDate = formatOmieDate(input.approvedAt);
  const dueDate = formatOmieDate(addDays(input.approvedAt, config.dueDays));
  const grossAmount = roundCurrency(input.grossAmount);
  if (!Number.isFinite(grossAmount) || grossAmount <= 0) throw new OmieIntegrationError("O valor bruto do invoice precisa ser maior que zero.");

  const payable = {
    codigo_lancamento_integracao: integrationCode,
    codigo_cliente_fornecedor: Number(supplierCode),
    data_vencimento: dueDate,
    valor_documento: grossAmount,
    codigo_categoria: config.categoryCode,
    data_previsao: dueDate,
    numero_documento_fiscal: input.invoiceNumber,
    numero_documento: input.invoiceNumber,
    data_emissao: issueDate,
    observacao: buildObservation(input),
    ...(normalizeAccessKey(input.accessKey).length === 44 ? { chave_nfe: normalizeAccessKey(input.accessKey) } : {}),
    ...(config.checkingAccountId ? { id_conta_corrente: config.checkingAccountId } : {})
  };

  const response = await callOmie<OmiePayableResponse>(
    OMIE_ACCOUNTS_PAYABLE_ENDPOINT,
    "UpsertContaPagar",
    [payable],
    config,
    fetchImpl
  );
  const launchCode = String(response.codigo_lancamento_omie ?? "").trim();
  if (!launchCode) throw new OmieIntegrationError("O Omie não retornou o código do lançamento de Contas a Pagar.");

  return {
    integrationCode: String(response.codigo_lancamento_integracao ?? integrationCode),
    launchCode,
    supplierCode,
    statusCode: String(response.codigo_status ?? ""),
    statusDescription: String(response.descricao_status ?? "Lançamento enviado ao Omie")
  };
}

export async function attachBillingInvoiceDocument(
  input: OmieDocumentAttachmentInput,
  options: { config?: OmieConfig; fetchImpl?: FetchLike } = {}
): Promise<OmieDocumentAttachmentResult> {
  const config = options.config ?? loadOmieConfig();
  const fetchImpl = options.fetchImpl ?? fetch;
  const launchId = Number(input.launchCode);
  if (!Number.isSafeInteger(launchId) || launchId <= 0) {
    throw new OmieIntegrationError("O código do lançamento retornado pelo Omie é inválido para anexar a nota fiscal.");
  }
  if (!input.file.byteLength) throw new OmieIntegrationError("A nota fiscal armazenada está vazia e não pode ser anexada ao Omie.");

  const integrationCode = buildOmieAttachmentIntegrationCode(input.employeeInvoiceId, input.documentHash);
  const fileName = normalizeAttachmentFileName(input.fileName);
  const existing = await findExistingAttachment(launchId, integrationCode, config, fetchImpl);
  if (existing) {
    return {
      integrationCode,
      attachmentId: String(existing.nIdAnexo ?? ""),
      fileName: String(existing.cNomeArquivo ?? fileName),
      alreadyAttached: true,
      statusDescription: "Nota fiscal já anexada ao lançamento no Omie."
    };
  }

  const zip = new JSZip();
  zip.file(fileName, input.file);
  const zippedFile = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
  const response = await callOmie<OmieAttachmentResponse>(
    OMIE_ATTACHMENTS_ENDPOINT,
    "IncluirAnexo",
    [{
      cCodIntAnexo: integrationCode,
      cTabela: OMIE_ACCOUNTS_PAYABLE_ATTACHMENT_TABLE,
      nId: launchId,
      cNomeArquivo: fileName,
      cTipoArquivo: attachmentFileType(fileName),
      cArquivo: zippedFile.toString("base64"),
      cMd5: createHash("md5").update(zippedFile).digest("hex")
    }],
    config,
    fetchImpl
  );
  const statusCode = String(response.cCodStatus ?? "0");
  const statusDescription = sanitizeOmieMessage(response.cDesStatus ?? "");
  if (statusCode !== "0") {
    throw new OmieIntegrationError(statusDescription || "O Omie recusou o anexo da nota fiscal.");
  }

  return {
    integrationCode,
    attachmentId: String(response.nIdAnexo ?? ""),
    fileName: String(response.cNomeArquivo ?? fileName),
    alreadyAttached: false,
    statusDescription: statusDescription || "Nota fiscal anexada ao lançamento no Omie."
  };
}

async function findSupplierByCnpj(cnpj: string, config: OmieConfig, fetchImpl: FetchLike) {
  const response = await callOmie<OmieSupplierListResponse>(
    OMIE_CLIENTS_ENDPOINT,
    "ListarClientes",
    [{
      pagina: 1,
      registros_por_pagina: 50,
      apenas_importado_api: "N",
      clientesFiltro: { cnpj_cpf: cnpj }
    }],
    config,
    fetchImpl
  );
  const expected = normalizeBrazilianTaxId(cnpj);
  const supplier = (response.clientes_cadastro ?? []).find((item) => normalizeBrazilianTaxId(item.cnpj_cpf ?? "") === expected);
  if (!supplier) throw new OmieIntegrationError(`Fornecedor com CNPJ ${maskCnpj(cnpj)} não encontrado no Omie.`);
  return supplier;
}

async function findExistingAttachment(
  launchId: number,
  integrationCode: string,
  config: OmieConfig,
  fetchImpl: FetchLike
) {
  const response = await callOmie<OmieAttachmentListResponse>(
    OMIE_ATTACHMENTS_ENDPOINT,
    "ListarAnexo",
    [{
      nPagina: 1,
      nRegPorPagina: 100,
      nId: launchId,
      cTabela: OMIE_ACCOUNTS_PAYABLE_ATTACHMENT_TABLE
    }],
    config,
    fetchImpl
  );
  return (response.listaAnexos ?? []).find((attachment) => attachment.cCodIntAnexo === integrationCode) ?? null;
}

async function callOmie<T>(endpoint: string, call: string, param: unknown[], config: OmieConfig, fetchImpl: FetchLike): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call, app_key: config.appKey, app_secret: config.appSecret, param }),
      cache: "no-store",
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    const fault = sanitizeOmieMessage(payload.faultstring ?? payload.message ?? payload.error);
    if (!response.ok || fault) {
      throw new OmieIntegrationError(fault || `O Omie recusou a operação ${call} (HTTP ${response.status}).`);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof OmieIntegrationError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new OmieIntegrationError("O Omie não respondeu dentro do tempo esperado.");
    throw new OmieIntegrationError("Não foi possível se comunicar com o Omie.");
  } finally {
    clearTimeout(timeout);
  }
}

function buildObservation(input: OmieAccountPayableInput) {
  return [
    `Billing ${input.referenceMonth}`,
    `NF ${input.invoiceNumber}`,
    input.accessKey ? `Chave NFS-e ${normalizeAccessKey(input.accessKey)}` : "",
    input.serviceDescription.trim()
  ].filter(Boolean).join(" | ").slice(0, 500);
}

function normalizeAccessKey(value: string) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeAttachmentFileName(value: string) {
  const original = basename(String(value ?? "").trim()) || "nota-fiscal.pdf";
  const extension = extname(original).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 11);
  const rawStem = extension ? original.slice(0, -extname(original).length) : original;
  const stem = rawStem
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\./g, "-")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "nota-fiscal";
  return `${stem.slice(0, Math.max(1, 100 - extension.length))}${extension}`;
}

function attachmentFileType(fileName: string) {
  return extname(fileName).replace(/^\./, "").toUpperCase().slice(0, 10) || "BIN";
}

function formatOmieDate(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86_400_000);
}

function roundCurrency(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function maskCnpj(value: string) {
  const digits = normalizeBrazilianTaxId(value);
  return digits.length === 14 ? `**.***.***/${digits.slice(8, 12)}-${digits.slice(12)}` : "não informado";
}

function sanitizeOmieMessage(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/app[_ -]?secret\s*[:=]\s*\S+/gi, "credencial protegida").trim().slice(0, 500);
}

function parseBoundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
