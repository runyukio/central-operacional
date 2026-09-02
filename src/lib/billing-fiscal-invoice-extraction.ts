import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import { BILLING_FISCAL_INVOICE_NUMBER_MAX_LENGTH, isValidBillingFiscalInvoiceNumber } from "@/lib/billing-fiscal-invoice";
import { getBillingFiscalDocumentCodeException, type BillingFiscalDocumentContext } from "@/lib/billing-fiscal-document-exceptions";

const VALIDATION_TOKEN_VERSION = 1;
const VALIDATION_TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_PDF_PAGES_TO_SCAN = 2;
const PDF_RENDER_SCALE = 2;
const MAX_IMAGE_DIMENSION = 2_400;

export const BILLING_FISCAL_EXPECTED_CUSTOMER_TAX_ID = "58151940000161";
export const BILLING_FISCAL_EXPECTED_TAXATION_CODE = "17.02.01";
export const BILLING_FISCAL_EXPECTED_NBS_CODE = "1.703.99.00";
export const BILLING_FISCAL_ALLOWED_NBS_CODES = [
  BILLING_FISCAL_EXPECTED_NBS_CODE,
  "1.401.13.00",
  "1.1806.59.00"
] as const;

const BILLING_FISCAL_ALLOWED_NBS_CODES_LABEL = BILLING_FISCAL_ALLOWED_NBS_CODES.join(" ou ");

export type BillingFiscalExtractionMethod = "PDF_TEXT" | "OCR" | "XML";

export type BillingFiscalDocumentExtraction = {
  accessKey: string;
  invoiceNumber: string;
  serviceAmount: number;
  serviceDescription: string;
  customerTaxId: string;
  supplierTaxId: string;
  taxationCode: string;
  nbsCode: string;
  documentHash: string;
  extractionMethod: BillingFiscalExtractionMethod;
};

export type BillingFiscalValidationPayload = BillingFiscalDocumentExtraction & {
  version: typeof VALIDATION_TOKEN_VERSION;
  actorEmail: string;
  referenceMonth: string;
  employeeId: string;
  billingGrossAmount: number;
  expiresAt: number;
};

export class BillingFiscalExtractionError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "BillingFiscalExtractionError";
    this.status = status;
  }
}

export async function extractBillingFiscalInvoice(
  file: File,
  options: {
    requireComplianceFields?: boolean;
    documentContext?: Omit<BillingFiscalDocumentContext, "documentHash">;
  } = {}
): Promise<BillingFiscalDocumentExtraction> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const documentHash = hashBillingFiscalFile(buffer);
  const extension = extname(file.name).toLowerCase();
  const mimeType = file.type.toLowerCase();

  if (extension === ".xml" || mimeType.includes("xml")) {
    const xml = buffer.toString("utf8");
    const fields = extractBillingFiscalFieldsFromXml(xml);
    return validateExtractedFields({ ...fields, documentHash, extractionMethod: "XML" as const });
  }

  if (extension === ".pdf" || mimeType === "application/pdf") {
    const codeException = getBillingFiscalDocumentCodeException({ ...options.documentContext, documentHash });
    const result = await extractFromPdf(buffer, Boolean(options.requireComplianceFields), codeException?.taxationCode);
    return validateExtractedFields({ ...result.fields, documentHash, extractionMethod: result.method });
  }

  if ([".png", ".jpg", ".jpeg"].includes(extension) || mimeType.startsWith("image/")) {
    const normalizedImage = await normalizeImageForOcr(buffer);
    const text = await recognizeBillingFiscalText(normalizedImage);
    return validateExtractedFields({
      ...extractBillingFiscalFieldsFromText(text),
      documentHash,
      extractionMethod: "OCR" as const
    });
  }

  throw new BillingFiscalExtractionError("Formato de nota fiscal não suportado para leitura automática.");
}

export function createBillingFiscalValidationToken(input: Omit<BillingFiscalValidationPayload, "version" | "expiresAt">) {
  const payload: BillingFiscalValidationPayload = {
    ...input,
    actorEmail: normalizeEmail(input.actorEmail),
    billingGrossAmount: roundCurrency(input.billingGrossAmount),
    serviceAmount: roundCurrency(input.serviceAmount),
    version: VALIDATION_TOKEN_VERSION,
    expiresAt: Date.now() + VALIDATION_TOKEN_TTL_MS
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signTokenPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function verifyBillingFiscalValidationToken(
  token: string,
  file: File,
  expected: {
    actorEmail: string;
    referenceMonth: string;
    employeeId: string;
    billingGrossAmount: number;
    enforceCompliance?: boolean;
    supplierTaxId?: string;
    wbLogin?: string;
  }
) {
  const [encodedPayload, receivedSignature, extraPart] = String(token ?? "").split(".");
  if (!encodedPayload || !receivedSignature || extraPart) {
    throw new BillingFiscalExtractionError("A leitura automática da nota expirou. Selecione o arquivo novamente.");
  }

  const expectedSignature = signTokenPayload(encodedPayload);
  const received = Buffer.from(receivedSignature);
  const signed = Buffer.from(expectedSignature);
  if (received.length !== signed.length || !timingSafeEqual(received, signed)) {
    throw new BillingFiscalExtractionError("A validação automática da nota fiscal é inválida.");
  }

  let payload: BillingFiscalValidationPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as BillingFiscalValidationPayload;
  } catch {
    throw new BillingFiscalExtractionError("A validação automática da nota fiscal é inválida.");
  }

  if (payload.version !== VALIDATION_TOKEN_VERSION || payload.expiresAt < Date.now()) {
    throw new BillingFiscalExtractionError("A leitura automática da nota expirou. Selecione o arquivo novamente.");
  }
  if (
    normalizeEmail(payload.actorEmail) !== normalizeEmail(expected.actorEmail)
    || payload.referenceMonth !== expected.referenceMonth
    || payload.employeeId !== expected.employeeId
  ) {
    throw new BillingFiscalExtractionError("A nota fiscal foi validada para outro invoice ou usuário.");
  }
  if (!currencyEquals(payload.billingGrossAmount, expected.billingGrossAmount)) {
    throw new BillingFiscalExtractionError("O valor esperado da nota fiscal mudou. Leia o arquivo novamente antes de aprovar.");
  }

  const currentHash = hashBillingFiscalFile(Buffer.from(await file.arrayBuffer()));
  if (currentHash !== payload.documentHash) {
    throw new BillingFiscalExtractionError("O arquivo enviado não é o mesmo que foi validado automaticamente.");
  }

  if (expected.enforceCompliance) {
    validateBillingFiscalComplianceFields(payload, expected.supplierTaxId ?? "", {
      wbLogin: expected.wbLogin,
      referenceMonth: expected.referenceMonth,
      documentHash: currentHash
    });
  }

  return validateExtractedFields(payload);
}

export function extractBillingFiscalFieldsFromText(text: string, metadataText = "") {
  const normalizedText = normalizeSearchText(text);
  const normalizedMetadata = normalizeSearchText(metadataText);
  const accessKey = findAccessKey(`${normalizedMetadata}\n${normalizedText}`);
  const invoiceNumber = findInvoiceNumber(normalizedText);
  const serviceAmount = findServiceAmount(normalizedText);
  const serviceDescription = findServiceDescription(text);
  const customerTaxId = findCustomerTaxId(normalizedText);
  const supplierTaxId = findSupplierTaxId(normalizedText);
  const taxationCode = findTaxationCode(normalizedText);
  const nbsCode = findNbsCode(normalizedText);
  return {
    accessKey,
    invoiceNumber,
    serviceAmount,
    serviceDescription,
    customerTaxId,
    supplierTaxId,
    taxationCode,
    nbsCode
  };
}

export function validateBillingFiscalComplianceFields(
  fields: Pick<BillingFiscalDocumentExtraction, "customerTaxId" | "supplierTaxId" | "taxationCode" | "nbsCode">,
  registeredSupplierTaxId: string,
  documentContext?: BillingFiscalDocumentContext
) {
  const customerTaxId = normalizeTaxId(fields.customerTaxId);
  const supplierTaxId = normalizeTaxId(fields.supplierTaxId);
  const expectedSupplierTaxId = normalizeTaxId(registeredSupplierTaxId);
  const taxationCode = normalizeTaxationCode(fields.taxationCode);
  const nbsCode = normalizeNbsCode(fields.nbsCode);

  if (expectedSupplierTaxId.length !== 14) {
    throw new BillingFiscalExtractionError(
      "Seu cadastro não possui um CNPJ válido. Atualize o CNPJ do parceiro antes de enviar a nota fiscal."
    );
  }
  if (!customerTaxId) {
    throw new BillingFiscalExtractionError(
      `Não foi possível identificar o CNPJ do tomador. A NFS-e deve informar ${formatCnpj(BILLING_FISCAL_EXPECTED_CUSTOMER_TAX_ID)} como tomador/adquirente.`
    );
  }
  if (customerTaxId !== BILLING_FISCAL_EXPECTED_CUSTOMER_TAX_ID) {
    throw new BillingFiscalExtractionError(
      `CNPJ do tomador incorreto: a nota informa ${formatCnpj(customerTaxId)}, mas deve informar ${formatCnpj(BILLING_FISCAL_EXPECTED_CUSTOMER_TAX_ID)}. Corrija e emita novamente a NFS-e.`
    );
  }
  if (!supplierTaxId) {
    throw new BillingFiscalExtractionError(
      `Não foi possível identificar o CNPJ do prestador. A NFS-e deve informar o mesmo CNPJ cadastrado para você: ${formatCnpj(expectedSupplierTaxId)}.`
    );
  }
  if (supplierTaxId !== expectedSupplierTaxId) {
    throw new BillingFiscalExtractionError(
      `CNPJ do prestador incorreto: a nota informa ${formatCnpj(supplierTaxId)}, mas seu cadastro informa ${formatCnpj(expectedSupplierTaxId)}. Corrija a nota ou atualize seu cadastro antes de tentar novamente.`
    );
  }

  const codeException = getBillingFiscalDocumentCodeException(documentContext);
  if (codeException && taxationCode === codeException.taxationCode && !String(fields.nbsCode ?? "").trim()) {
    return { customerTaxId, supplierTaxId, taxationCode, nbsCode };
  }
  if (!taxationCode) {
    throw new BillingFiscalExtractionError(
      `Não foi possível identificar o Código de Tributação Nacional/Municipal. A NFS-e deve informar ${BILLING_FISCAL_EXPECTED_TAXATION_CODE}.`
    );
  }
  if (taxationCode !== BILLING_FISCAL_EXPECTED_TAXATION_CODE) {
    throw new BillingFiscalExtractionError(
      `Código de Tributação incorreto: a nota informa ${taxationCode}, mas deve informar ${BILLING_FISCAL_EXPECTED_TAXATION_CODE}. Corrija e emita novamente a NFS-e.`
    );
  }
  if (!nbsCode) {
    throw new BillingFiscalExtractionError(
      `Não foi possível identificar o Código da NBS. A NFS-e deve informar ${BILLING_FISCAL_ALLOWED_NBS_CODES_LABEL}.`
    );
  }
  if (!BILLING_FISCAL_ALLOWED_NBS_CODES.some((allowedCode) => allowedCode === nbsCode)) {
    throw new BillingFiscalExtractionError(
      `Código da NBS incorreto: a nota informa ${nbsCode}, mas deve informar ${BILLING_FISCAL_ALLOWED_NBS_CODES_LABEL}. Corrija e emita novamente a NFS-e.`
    );
  }

  return { customerTaxId, supplierTaxId, taxationCode, nbsCode };
}

export function currencyEquals(left: number, right: number) {
  return Math.round(Number(left) * 100) === Math.round(Number(right) * 100);
}

export function hashBillingFiscalFile(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function extractFromPdf(buffer: Buffer, requireComplianceFields: boolean, exemptMunicipalCode?: string) {
  const [{ getDocument }, { createCanvas }] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("@napi-rs/canvas")
  ]);
  const document = await getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true
  }).promise;

  try {
    const metadata = await document.getMetadata().catch(() => null);
    const metadataText = String(metadata?.info && "Title" in metadata.info ? metadata.info.Title ?? "" : "");
    const pageLimit = Math.min(document.numPages, MAX_PDF_PAGES_TO_SCAN);
    let nativeText = "";

    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      nativeText += `\n${content.items.map((item) => ("str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "")).join("")}`;
    }

    const nativeFields = extractBillingFiscalFieldsFromText(nativeText, metadataText);
    if (hasAllRequiredFields(nativeFields, requireComplianceFields, exemptMunicipalCode)) {
      return { fields: nativeFields, method: "PDF_TEXT" as const };
    }

    let ocrText = "";
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport
      }).promise;
      ocrText += `\n${await recognizeBillingFiscalText(canvas.toBuffer("image/png"))}`;
      const fields = extractBillingFiscalFieldsFromText(`${nativeText}\n${ocrText}`, metadataText);
      if (hasAllRequiredFields(fields, requireComplianceFields, exemptMunicipalCode)) {
        return { fields, method: "OCR" as const };
      }
    }

    return {
      fields: extractBillingFiscalFieldsFromText(`${nativeText}\n${ocrText}`, metadataText),
      method: "OCR" as const
    };
  } finally {
    await document.destroy();
  }
}

async function normalizeImageForOcr(buffer: Buffer) {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const image = await loadImage(buffer);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toBuffer("image/png");
}

async function recognizeBillingFiscalText(image: Buffer) {
  const { createWorker, OEM, PSM } = await import("tesseract.js");
  const langPath = join(
    process.cwd(),
    "node_modules",
    "@tesseract.js-data",
    "por",
    "4.0.0_best_int"
  );
  const worker = await createWorker("por", OEM.LSTM_ONLY, {
    cachePath: join(tmpdir(), "billing-tesseract-cache"),
    langPath
  });

  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    const result = await worker.recognize(image);
    return result.data.text;
  } finally {
    await worker.terminate();
  }
}

function extractBillingFiscalFieldsFromXml(xml: string) {
  const accessKey = findXmlValue(xml, ["chNFSe", "chNFe", "ChaveAcesso"])
    || findAccessKey(normalizeSearchText(xml));
  const invoiceNumber = findXmlValue(xml, ["nNFSe", "nNF", "NumeroNfse", "Numero"]);
  const amountRaw = findXmlValue(xml, ["vServ", "ValorServicos", "ValorServico", "vLiq", "vNF"]);
  const serviceAmount = amountRaw ? parseCurrency(amountRaw) : 0;
  const serviceDescription = decodeXmlEntities(
    findXmlValue(xml, ["Discriminacao", "xDescServ", "DescricaoServico", "xServ"]) || ""
  ).trim();
  const customerTaxId = findXmlPartyTaxId(xml, "CUSTOMER");
  const supplierTaxId = findXmlPartyTaxId(xml, "SUPPLIER");
  const taxationCode = normalizeTaxationCode(findXmlValue(xml, [
    "cTribNac",
    "CodigoTributacaoNacional",
    "CodigoTributacaoMunicipal",
    "CodigoTributacaoMunicipio",
    "ItemListaServico"
  ]));
  const nbsCode = normalizeNbsCode(findXmlValue(xml, ["cNBS", "CodigoNBS", "CodigoNbs", "NBS"]));
  return {
    accessKey: String(accessKey ?? "").replace(/\D/g, ""),
    invoiceNumber: String(invoiceNumber ?? "").replace(/\D/g, ""),
    serviceAmount,
    serviceDescription,
    customerTaxId,
    supplierTaxId,
    taxationCode,
    nbsCode
  };
}

function findXmlPartyTaxId(xml: string, party: "CUSTOMER" | "SUPPLIER") {
  const directTags = party === "CUSTOMER"
    ? ["CnpjTomador", "CNPJTomador", "CpfCnpjTomador", "NifTomador"]
    : ["CnpjPrestador", "CNPJPrestador", "CpfCnpjPrestador", "NifPrestador"];
  const direct = normalizeTaxId(findXmlValue(xml, directTags));
  if (direct) return direct;

  const sectionTags = party === "CUSTOMER"
    ? ["TomadorServico", "Tomador", "toma"]
    : ["PrestadorServico", "Prestador", "prest", "emit"];
  for (const tag of sectionTags) {
    const section = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] ?? "";
    if (!section) continue;
    const taxId = normalizeTaxId(findXmlValue(section, ["Cnpj", "CNPJ", "CpfCnpj", "CnpjCpf", "Nif", "NIF"]));
    if (taxId) return taxId;
  }
  return "";
}

function findXmlValue(xml: string, tags: string[]) {
  for (const tag of tags) {
    const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?\\s*([^<\\]]+?)\\s*(?:\\]\\]>)?<\\/${tag}>`, "i"));
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function findAccessKey(text: string) {
  const labeledSections = [
    text.match(/chave de acesso (?:da |de )?nfs-?e([\s\S]{0,180})/i)?.[1] ?? "",
    text.match(/identificador nacional\s*:?([\s\S]{0,100})/i)?.[1] ?? ""
  ];
  for (const labeled of labeledSections) {
    const labeledCandidate = findLongDigitSequence(labeled);
    if (labeledCandidate) return labeledCandidate;
  }
  return findLongDigitSequence(text);
}

function findLongDigitSequence(text: string) {
  const matches = text.match(/(?:\d[\s.\-]?){44,60}/g) ?? [];
  for (const match of matches) {
    const digits = match.replace(/\D/g, "");
    if (digits.length >= 44 && digits.length <= 60) return digits;
  }
  return "";
}

function findInvoiceNumber(text: string) {
  const saoPauloMunicipal = text.match(
    /numero da nota[\s\S]{0,260}?\n\s*(\d{1,20})\s*\n\s*\d{2}\/\d{2}\/\d{4}\b/i
  )?.[1];
  if (saoPauloMunicipal) return saoPauloMunicipal;

  const genericNoteInline = text.match(
    /numero da nota(?: fiscal)?[ \t]*[:#-]?[ \t]*(\d{1,20})\b/i
  )?.[1];
  if (genericNoteInline) return genericNoteInline;

  const nextLine = text.match(/numero da nfs-?e[^\n]*\n\s*(\d{1,20})\b/i)?.[1];
  if (nextLine) return nextLine;
  const inline = text.match(/(?:numero|n[ºo])\s*(?:da\s*)?nfs-?e\s*[:#-]?\s*(\d{1,20})\b/i)?.[1];
  return inline ?? "";
}

function findServiceAmount(text: string) {
  const labeled = text.match(/valor (?:total )?d(?:o|os) servicos?[\s\S]{0,260}?r?\s*\$\s*([\d.]+,\d{2})/i)?.[1];
  if (labeled) return parseCurrency(labeled);
  const fallback = text.match(/valor (?:total )?(?:da )?nfs-?e[\s\S]{0,260}?r?\s*\$\s*([\d.]+,\d{2})/i)?.[1];
  return fallback ? parseCurrency(fallback) : 0;
}

function findServiceDescription(text: string) {
  const originalLines = text.split(/\r?\n/).map((line) => line.trim());
  const normalizedLines = originalLines.map(normalizeSearchText);
  const index = normalizedLines.findIndex((line) => (
    line.includes("descricao do servico") || line.includes("discriminacao de servicos")
  ));
  if (index < 0) return "";

  for (let cursor = index + 1; cursor < originalLines.length; cursor += 1) {
    const original = originalLines[cursor];
    const normalized = normalizedLines[cursor];
    if (!original) continue;
    if (isLikelySectionHeader(normalized)) break;
    return original.slice(0, 1_000);
  }
  return "";
}

function findCustomerTaxId(text: string) {
  return findPartyTaxId(text, [
    /tomador\s*\/\s*adquirente/i,
    /tomador do servico/i,
    /tomador/i,
    /adquirente/i
  ], ["prestador", "fornecedor", "intermediario", "servico prestado", "descricao do servico"]);
}

function findSupplierTaxId(text: string) {
  return findPartyTaxId(text, [
    /prestador\s*\/\s*fornecedor/i,
    /prestador do servico/i,
    /prestador/i,
    /fornecedor/i
  ], ["tomador", "adquirente", "intermediario", "servico prestado", "descricao do servico"]);
}

function findPartyTaxId(text: string, sectionPatterns: RegExp[], endMarkers: string[]) {
  for (const pattern of sectionPatterns) {
    const match = pattern.exec(text);
    if (!match || match.index === undefined) continue;
    const start = match.index + match[0].length;
    const remainder = text.slice(start, start + 1_200);
    const endIndexes = endMarkers
      .map((marker) => remainder.indexOf(marker))
      .filter((index) => index >= 0);
    const section = remainder.slice(0, endIndexes.length ? Math.min(...endIndexes) : remainder.length);
    const labeled = section.match(
      /(?:cnpj\s*\/\s*cpf\s*\/\s*nif|cnpj\s*\/\s*cpf|cpf\s*\/\s*cnpj|cnpj)\s*:?[ \t\n]*((?:\d[\s./-]?){14,24})/i
    )?.[1] ?? "";
    const taxId = normalizeTaxId(labeled);
    if (taxId.length === 14) return taxId;
    // Municipal PDFs may put the field labels before the values in reading order.
    // Keep the fallback inside the same party section to avoid swapping the CNPJs.
    const formattedTaxId = section.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/)?.[0] ?? "";
    if (formattedTaxId) return normalizeTaxId(formattedTaxId);
  }
  return "";
}

function findTaxationCode(text: string) {
  const labels = [
    /codigo de tributacao nacional\s*\/\s*municipal/i,
    /codigo de tributacao nacional/i,
    /codigo de tributacao municipal/i,
    /codigo de tributacao do municipio/i
  ];
  for (const label of labels) {
    const match = label.exec(text);
    if (!match || match.index === undefined) continue;
    const nearby = text.slice(match.index + match[0].length, match.index + match[0].length + 180);
    const code = nearby.match(/\b(\d{2}[.\s-]?\d{2}[.\s-]?\d{2})\b/)?.[1] ?? "";
    const normalized = normalizeTaxationCode(code);
    if (normalized) return normalized;
  }
  const municipalCode = text.match(/codigo do servico\s*:?\s*(\d{5})\b/)?.[1] ?? "";
  return normalizeTaxationCode(municipalCode);
}

function findNbsCode(text: string) {
  const match = /(?:codigo da nbs|codigo nbs|\bnbs\b)/i.exec(text);
  if (!match || match.index === undefined) return "";
  const nearby = text.slice(match.index + match[0].length, match.index + match[0].length + 180);
  const code = nearby.match(/(?<![\d.-])(?<!\d\s)\b(\d[.\s-]?\d{3,4}[.\s-]?\d{2}[.\s-]?\d{2})\b(?![.-]\d)/)?.[1] ?? "";
  return normalizeNbsCode(code);
}

function isLikelySectionHeader(value: string) {
  return [
    "tributacao municipal",
    "tributacao federal",
    "valor total da nfs-e",
    "valor total do servico",
    "tomador do servico",
    "emitente da nfs-e",
    "servico prestado"
  ].some((header) => value.startsWith(header));
}

function validateExtractedFields<T extends {
  accessKey: string;
  invoiceNumber: string;
  serviceAmount: number;
  serviceDescription: string;
  customerTaxId: string;
  supplierTaxId: string;
  taxationCode: string;
  nbsCode: string;
}>(fields: T): T {
  const accessKey = String(fields.accessKey ?? "").replace(/\D/g, "");
  const invoiceNumber = String(fields.invoiceNumber ?? "").replace(/\D/g, "");
  const serviceAmount = roundCurrency(fields.serviceAmount);

  if (accessKey.length < 44 || accessKey.length > 60) {
    throw new BillingFiscalExtractionError("Não foi possível identificar a chave de acesso da NFS-e no arquivo.");
  }
  if (!isValidBillingFiscalInvoiceNumber(invoiceNumber)) {
    throw new BillingFiscalExtractionError(
      `Não foi possível identificar um número de NFS-e válido com até ${BILLING_FISCAL_INVOICE_NUMBER_MAX_LENGTH} dígitos.`
    );
  }
  if (!Number.isFinite(serviceAmount) || serviceAmount <= 0) {
    throw new BillingFiscalExtractionError("Não foi possível identificar o valor do serviço na NFS-e.");
  }

  return {
    ...fields,
    accessKey,
    invoiceNumber,
    serviceAmount,
    serviceDescription: String(fields.serviceDescription ?? "").trim().slice(0, 1_000),
    customerTaxId: normalizeTaxId(fields.customerTaxId),
    supplierTaxId: normalizeTaxId(fields.supplierTaxId),
    taxationCode: normalizeTaxationCode(fields.taxationCode),
    nbsCode: normalizeNbsCode(fields.nbsCode)
  };
}

function hasAllRequiredFields(
  fields: {
    accessKey: string;
    invoiceNumber: string;
    serviceAmount: number;
    customerTaxId: string;
    supplierTaxId: string;
    taxationCode: string;
    nbsCode: string;
  },
  requireComplianceFields: boolean,
  exemptMunicipalCode?: string
) {
  const hasBaseFields = fields.accessKey.length >= 44
    && fields.accessKey.length <= 60
    && isValidBillingFiscalInvoiceNumber(fields.invoiceNumber)
    && Number.isFinite(fields.serviceAmount)
    && fields.serviceAmount > 0;
  return hasBaseFields && (!requireComplianceFields || Boolean(
    fields.customerTaxId
    && fields.supplierTaxId
    && fields.taxationCode
    && (fields.nbsCode || (exemptMunicipalCode && fields.taxationCode === exemptMunicipalCode))
  ));
}

function signTokenPayload(encodedPayload: string) {
  const secret = String(process.env.NEXTAUTH_SECRET ?? "").trim();
  if (!secret) {
    throw new BillingFiscalExtractionError("A validação segura de notas fiscais não está configurada.");
  }
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function normalizeSearchText(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .toLowerCase();
}

function normalizeEmail(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeTaxId(value: string) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 14 ? digits : "";
}

function normalizeTaxationCode(value: string) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 5) return digits;
  return digits.length === 6 ? `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}` : "";
}

function normalizeNbsCode(value: string) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length !== 8 && digits.length !== 9) return "";
  const categoryEnd = digits.length - 4;
  return `${digits.slice(0, 1)}.${digits.slice(1, categoryEnd)}.${digits.slice(categoryEnd, categoryEnd + 2)}.${digits.slice(categoryEnd + 2)}`;
}

function formatCnpj(value: string) {
  const digits = String(value ?? "").replace(/\D/g, "").padEnd(14, "?").slice(0, 14);
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

function parseCurrency(value: string) {
  const normalized = String(value ?? "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  return roundCurrency(Number(normalized));
}

function roundCurrency(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
