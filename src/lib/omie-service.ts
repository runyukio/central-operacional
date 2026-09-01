import { createHash } from "node:crypto";
import { basename, extname } from "node:path";

import JSZip from "jszip";

const OMIE_CLIENTS_ENDPOINT = "https://app.omie.com.br/api/v1/geral/clientes/";
const OMIE_ACCOUNTS_PAYABLE_ENDPOINT = "https://app.omie.com.br/api/v1/financas/contapagar/";
const OMIE_ATTACHMENTS_ENDPOINT = "https://app.omie.com.br/api/v1/geral/anexo/";
const OMIE_ACCOUNTS_PAYABLE_ATTACHMENT_TABLE = "conta-pagar";
const DEFAULT_TIMEOUT_MS = 15_000;

export type OmieConfig = {
  appKey: string;
  appSecret: string;
  checkingAccountId: number;
  timeoutMs: number;
};

export type OmieCategoryAllocation = {
  code: string;
  value: number;
};

export type OmieAccountPayableInput = {
  employeeInvoiceId: string;
  referenceMonth: string;
  wbLogin: string;
  employeeName: string;
  roleTitle: string;
  cnpj: string;
  pixKey: string;
  pixKeyType: string;
  accessKey: string;
  invoiceNumber: string;
  serviceDescription: string;
  grossAmount: number;
  documentAmount: number;
  projectCode: number;
  departmentCode: string;
  documentTypeCode?: string | null;
  categories: OmieCategoryAllocation[];
  billingGrossAmount: number;
  correctionAmount: number;
  bonusAmount: number;
  campaignAmount: number;
  advanceAmount: number;
  discountAmount: number;
  otherAdjustmentAmount: number;
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
  if (!appKey || !appSecret) {
    throw new OmieIntegrationError("Integração Omie não configurada. Informe App Key e App Secret.");
  }

  const checkingAccountRaw = String(env.OMIE_CHECKING_ACCOUNT_ID ?? "").trim();
  const checkingAccountId = Number(checkingAccountRaw);
  if (!checkingAccountRaw || !Number.isSafeInteger(checkingAccountId) || checkingAccountId <= 0) {
    throw new OmieIntegrationError("Integração Omie não configurada. Informe uma Conta Corrente válida.");
  }

  return {
    appKey,
    appSecret,
    checkingAccountId,
    timeoutMs: parseBoundedInteger(env.OMIE_API_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1_000, 60_000)
  };
}

export function normalizeBrazilianTaxId(value: string) {
  return String(value ?? "").replace(/\D/g, "");
}

export function formatBrazilianCnpj(value: string) {
  const digits = normalizeBrazilianTaxId(value);
  if (digits.length !== 14) throw new OmieIntegrationError("O parceiro não possui um CNPJ válido para localizar o fornecedor no Omie.");
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

export function buildOmieIntegrationCode(referenceMonth: string, employeeKey: string) {
  const normalizedMonth = String(referenceMonth).replace(/[^0-9-]/g, "").slice(0, 7);
  const normalizedEmployeeKey = String(employeeKey).trim().replace(/[^a-zA-Z0-9_-]/g, "");
  return `billing-${normalizedMonth}-${normalizedEmployeeKey}`.slice(0, 60);
}

export function buildOmieDocumentNumber(referenceMonth: string, wbLogin: string) {
  const normalizedMonth = String(referenceMonth).replace(/\D/g, "").slice(0, 6);
  const normalizedLogin = String(wbLogin).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return `B${normalizedMonth}-${normalizedLogin}`.slice(0, 20);
}

export function calculateOmieDueDate(referenceMonth: string, now = new Date()) {
  const [year, month] = String(referenceMonth).split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new OmieIntegrationError("Mês de referência inválido para calcular o vencimento no Omie.");
  }

  const targetMonth = month === 12 ? 1 : month + 1;
  const targetYear = month === 12 ? year + 1 : year;
  const holidays = brazilianAndSaoPauloHolidays(targetYear);
  let businessDays = 0;
  let dueDate = new Date(Date.UTC(targetYear, targetMonth - 1, 1, 12));
  while (businessDays < 5) {
    const day = dueDate.getUTCDay();
    const key = isoDateUtc(dueDate);
    if (day !== 0 && day !== 6 && !holidays.has(key)) businessDays += 1;
    if (businessDays < 5) dueDate = addUtcDays(dueDate, 1);
  }

  const today = startOfSaoPauloDay(now);
  return dueDate < today ? today : dueDate;
}

export function calculateOmieIssueDate(referenceMonth: string) {
  const [year, month] = String(referenceMonth).split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new OmieIntegrationError("Mês de referência inválido para calcular a data de emissão no Omie.");
  }
  return new Date(Date.UTC(year, month, 0, 12));
}

export function buildOmieAttachmentIntegrationCode(employeeInvoiceId: string, documentHash?: string | null) {
  const digest = createHash("sha256")
    .update(`${employeeInvoiceId}:${String(documentHash ?? "")}`)
    .digest("hex");
  return `bnf-${digest.slice(0, 16)}`;
}

export function buildOmiePixTransferData(input: {
  employeeName: string;
  cnpj: string;
  pixKey: string;
  pixKeyType: string;
}) {
  const pixKey = normalizePixTransferKey(input.pixKey, input.pixKeyType);
  const beneficiaryTaxId = normalizeBrazilianTaxId(input.cnpj);
  if (beneficiaryTaxId.length !== 14) {
    throw new OmieIntegrationError("O CNPJ do favorecido é inválido para a transferência por chave PIX.");
  }
  const beneficiaryName = String(input.employeeName ?? "").trim().slice(0, 60);
  if (!beneficiaryName) {
    throw new OmieIntegrationError("O nome do favorecido é obrigatório para a transferência por chave PIX.");
  }

  return {
    codigo_forma_pagamento: "TRA",
    finalidade_transferencia: "01.3",
    cpf_cnpj_transferencia: beneficiaryTaxId,
    nome_transferencia: beneficiaryName,
    // With TRA + 01.3, Omie uses this field for the beneficiary's PIX key, not a QR Code payment payload.
    pix_qrcode: pixKey
  };
}

export async function upsertBillingAccountPayable(
  input: OmieAccountPayableInput,
  options: { config?: OmieConfig; fetchImpl?: FetchLike; now?: Date } = {}
): Promise<OmieAccountPayableResult> {
  const config = options.config ?? loadOmieConfig();
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const cnpj = formatBrazilianCnpj(input.cnpj);
  const supplier = await findSupplierByCnpj(cnpj, config, fetchImpl);
  const supplierCode = String(supplier.codigo_cliente_omie ?? "").trim();
  if (!supplierCode) throw new OmieIntegrationError(`Fornecedor do CNPJ ${maskCnpj(cnpj)} não possui código válido no Omie.`);

  const integrationCode = input.integrationCode || buildOmieIntegrationCode(input.referenceMonth, input.wbLogin || input.employeeInvoiceId);
  const issueDate = formatOmieDate(calculateOmieIssueDate(input.referenceMonth));
  const entryDate = formatOmieDate(input.approvedAt);
  const dueDate = formatOmieDate(calculateOmieDueDate(input.referenceMonth, now));
  const documentAmount = roundCurrency(input.documentAmount);
  if (!Number.isFinite(documentAmount) || documentAmount <= 0) {
    throw new OmieIntegrationError("O valor final do invoice precisa ser maior que zero.");
  }
  const categoryPayload = buildCategoryPayload(input.categories, documentAmount);
  if (!Number.isSafeInteger(input.projectCode) || input.projectCode <= 0) {
    throw new OmieIntegrationError("O projeto PJ não possui um código válido no Omie.");
  }
  const departmentCode = String(input.departmentCode ?? "").trim();
  if (!departmentCode) {
    throw new OmieIntegrationError("O departamento do parceiro não possui um código válido no Omie.");
  }
  const invoiceNumber = String(input.invoiceNumber ?? "").trim();
  if (!/^\d{1,20}$/.test(invoiceNumber)) {
    throw new OmieIntegrationError("O número da NFS-e precisa conter somente números, com até 20 dígitos.");
  }
  const accessKey = normalizeAccessKey(input.accessKey);
  if (accessKey.length < 44 || accessKey.length > 60) {
    throw new OmieIntegrationError("A chave de acesso da NFS-e precisa conter entre 44 e 60 dígitos.");
  }
  const documentTypeCode = String(input.documentTypeCode ?? "").trim().toUpperCase();
  const pixTransfer = buildOmiePixTransferData(input);

  const payable = {
    codigo_lancamento_integracao: integrationCode,
    codigo_cliente_fornecedor: Number(supplierCode),
    data_vencimento: dueDate,
    valor_documento: documentAmount,
    ...categoryPayload,
    data_previsao: dueDate,
    numero_documento_fiscal: invoiceNumber,
    numero_documento: buildOmieDocumentNumber(input.referenceMonth, input.wbLogin),
    codigo_projeto: input.projectCode,
    distribuicao: [{
      cCodDep: departmentCode,
      nValDep: documentAmount,
      nPerDep: 100
    }],
    data_emissao: issueDate,
    data_entrada: entryDate,
    numero_parcela: "001/001",
    ...(documentTypeCode ? { codigo_tipo_documento: documentTypeCode } : {}),
    cnab_integracao_bancaria: pixTransfer,
    observacao: buildObservation(input),
    ...(accessKey.length === 44 ? { chave_nfe: accessKey } : {}),
    id_conta_corrente: config.checkingAccountId
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
  const encodedFile = zippedFile.toString("base64");
  const response = await callOmie<OmieAttachmentResponse>(
    OMIE_ATTACHMENTS_ENDPOINT,
    "IncluirAnexo",
    [{
      cCodIntAnexo: integrationCode,
      cTabela: OMIE_ACCOUNTS_PAYABLE_ATTACHMENT_TABLE,
      nId: launchId,
      cNomeArquivo: fileName,
      cTipoArquivo: attachmentFileType(fileName),
      cArquivo: encodedFile,
      cMd5: createHash("md5").update(encodedFile).digest("hex")
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
    `NFS-e: ${input.invoiceNumber}`,
    `Chave NFS-e: ${normalizeAccessKey(input.accessKey)}`,
    `Billing ${input.referenceMonth}`,
    `WB: ${input.wbLogin}`,
    `Cargo: ${input.roleTitle}`,
    `Bruto: ${formatCurrency(input.billingGrossAmount)}`,
    `Correção: ${formatCurrency(input.correctionAmount)}`,
    `Valor NF: ${formatCurrency(input.grossAmount)}`,
    `Bônus: ${formatCurrency(input.bonusAmount)}`,
    `Campanha: ${formatCurrency(input.campaignAmount)}`,
    `Adiantamento: ${formatCurrency(input.advanceAmount)}`,
    `Desconto: ${formatCurrency(input.discountAmount)}`,
    `Outros ajustes: ${formatCurrency(input.otherAdjustmentAmount)}`,
    `Final: ${formatCurrency(input.documentAmount)}`,
    input.serviceDescription.trim() ? `Serviço: ${input.serviceDescription.trim()}` : ""
  ].filter(Boolean).join(" | ").slice(0, 500);
}

function buildCategoryPayload(categories: OmieCategoryAllocation[], documentAmount: number) {
  const normalized = categories.map((category) => ({
    codigo_categoria: String(category.code ?? "").trim(),
    valor: roundCurrency(category.value)
  }));
  if (!normalized.length || normalized.some((category) => !category.codigo_categoria || category.valor < 0)) {
    throw new OmieIntegrationError("O rateio de categorias do lançamento no Omie está incompleto.");
  }
  const allocatedAmount = roundCurrency(normalized.reduce((sum, category) => sum + category.valor, 0));
  if (allocatedAmount !== documentAmount) {
    throw new OmieIntegrationError("O rateio de categorias precisa somar exatamente o valor final do invoice.");
  }
  if (normalized.length === 1) return { codigo_categoria: normalized[0].codigo_categoria };

  let allocatedPercentage = 0;
  const categorias = normalized.map((category, index) => {
    const percentual = index === normalized.length - 1
      ? roundCurrency(100 - allocatedPercentage)
      : roundCurrency((category.valor / documentAmount) * 100);
    allocatedPercentage = roundCurrency(allocatedPercentage + percentual);
    return { ...category, percentual };
  });
  return { categorias };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(roundCurrency(value)).replace(/\u00a0/g, " ");
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

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isoDateUtc(date: Date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function startOfSaoPauloDay(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return new Date(Date.UTC(read("year"), read("month") - 1, read("day"), 12));
}

function brazilianAndSaoPauloHolidays(year: number) {
  const easter = easterSundayUtc(year);
  const goodFriday = isoDateUtc(addUtcDays(easter, -2));
  const corpusChristi = isoDateUtc(addUtcDays(easter, 60));
  return new Set([
    `${year}-01-01`,
    `${year}-01-25`,
    goodFriday,
    `${year}-04-21`,
    `${year}-05-01`,
    corpusChristi,
    `${year}-07-09`,
    `${year}-09-07`,
    `${year}-10-12`,
    `${year}-11-02`,
    `${year}-11-15`,
    `${year}-11-20`,
    `${year}-12-25`
  ]);
}

function easterSundayUtc(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function normalizePixTransferKey(value: string, type: string) {
  const pixKey = String(value ?? "").trim();
  const normalizedType = String(type ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (!pixKey) throw new OmieIntegrationError("O parceiro não possui chave PIX cadastrada.");

  if (normalizedType === "cpf") {
    const digits = pixKey.replace(/\D/g, "");
    if (digits.length !== 11) throw new OmieIntegrationError("A chave PIX do tipo CPF precisa ter 11 dígitos.");
    return digits;
  }
  if (normalizedType === "cnpj") {
    const digits = pixKey.replace(/\D/g, "");
    if (digits.length !== 14) throw new OmieIntegrationError("A chave PIX do tipo CNPJ precisa ter 14 dígitos.");
    return digits;
  }
  if (normalizedType === "telefone" || normalizedType === "celular" || normalizedType === "phone") {
    const digits = pixKey.replace(/\D/g, "");
    const brazilianNumber = digits.startsWith("55") ? digits : `55${digits}`;
    if (brazilianNumber.length < 12 || brazilianNumber.length > 13) {
      throw new OmieIntegrationError("A chave PIX do tipo telefone precisa conter DDD e número válidos.");
    }
    return `+${brazilianNumber}`;
  }
  if (normalizedType === "email" || normalizedType === "emailpix") {
    const email = pixKey.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new OmieIntegrationError("A chave PIX do tipo e-mail é inválida.");
    }
    return email;
  }
  if (pixKey.length > 300) throw new OmieIntegrationError("A chave PIX excede o limite aceito pelo Omie.");
  return pixKey;
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
