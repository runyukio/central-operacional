import * as XLSX from "xlsx";

import type { RealtimeCecImportInput, RealtimeCecTicketInput } from "@/lib/realtime-cec-service";

const defaultFreshdeskReportUrl =
  "https://kuaishousupport.freshdesk.com/reports/schedule/download_file.json?uuid=333f3cd9-ec65-4aae-9817-b6fcee4efa4d";
const saoPauloTimeZone = "America/Sao_Paulo";
const maxReportBytes = 10 * 1024 * 1024;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findValue(row: UnknownRecord, aliases: string[]) {
  const normalizedAliases = new Set(aliases.map(normalizeHeader));
  const match = Object.entries(row).find(([key]) => normalizedAliases.has(normalizeHeader(key)));
  return match?.[1] ?? "";
}

function sanitizeApiKey(value: string | undefined) {
  return String(value ?? "").replace(/[\r\n]/g, "").trim();
}

function getFreshdeskConfig() {
  const apiKey = sanitizeApiKey(process.env.CEC_FRESHDESK_API_KEY);
  if (!apiKey) {
    throw new Error("Configure CEC_FRESHDESK_API_KEY na Vercel com a API Key do usuário que criou o Data Export CEC.");
  }

  const reportUrl = new URL(process.env.CEC_FRESHDESK_REPORT_URL?.trim() || defaultFreshdeskReportUrl);
  if (reportUrl.protocol !== "https:" || !reportUrl.hostname.endsWith(".freshdesk.com")) {
    throw new Error("CEC_FRESHDESK_REPORT_URL deve usar um endereço HTTPS oficial do Freshdesk.");
  }

  return {
    reportUrl,
    authorization: `Basic ${Buffer.from(`${apiKey}:X`).toString("base64")}`
  };
}

function retryDelayMs(response: Response, attempt: number) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1_000, 30_000);
  return Math.min(1_000 * 2 ** attempt, 8_000);
}

async function sleep(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchScheduledReportMetadata() {
  const config = getFreshdeskConfig();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(config.reportUrl, {
      headers: {
        Accept: "application/json",
        Authorization: config.authorization
      },
      cache: "no-store",
      signal: AbortSignal.timeout(45_000)
    });

    if (response.ok) {
      const payload = await response.json() as unknown;
      if (isRecord(payload) && payload.require_login === true) {
        throw new Error(
          "A API Key configurada não tem acesso ao Data Export CEC. Use a chave do usuário Freshdesk que criou esse agendamento."
        );
      }
      return payload;
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < 2) {
      await sleep(retryDelayMs(response, attempt));
      continue;
    }
    if (response.status === 401) {
      throw new Error("A API Key do Freshdesk é inválida ou foi revogada. Atualize CEC_FRESHDESK_API_KEY na Vercel.");
    }
    if (response.status === 403) {
      throw new Error("A API Key do Freshdesk não possui permissão para baixar o Data Export CEC.");
    }
    if (response.status === 429) {
      throw new Error("O limite de chamadas do Freshdesk foi atingido. O último snapshot CEC válido foi mantido.");
    }
    throw new Error(`O Data Export CEC respondeu HTTP ${response.status}.`);
  }

  throw new Error("O Data Export CEC não respondeu após três tentativas.");
}

function findExportUrl(value: unknown, depth = 0): string | null {
  if (depth > 8 || value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.toString() : null;
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findExportUrl(item, depth + 1);
      if (match) return match;
    }
    return null;
  }
  if (!isRecord(value)) return null;

  for (const key of ["url", "download_url", "downloadUrl", "file_url", "fileUrl"]) {
    if (key in value) {
      const match = findExportUrl(value[key], depth + 1);
      if (match) return match;
    }
  }
  for (const child of Object.values(value)) {
    const match = findExportUrl(child, depth + 1);
    if (match) return match;
  }
  return null;
}

function validateExportUrl(value: string) {
  const url = new URL(value);
  const allowedHost =
    url.hostname === "s3.amazonaws.com" ||
    url.hostname.endsWith(".amazonaws.com") ||
    url.hostname.endsWith(".freshreports.com") ||
    url.hostname.endsWith(".freshworks.com");
  if (url.protocol !== "https:" || !allowedHost) {
    throw new Error("O Freshdesk retornou um endereço de exportação não reconhecido.");
  }
  return url;
}

async function downloadScheduledReport(exportUrl: URL) {
  const response = await fetch(exportUrl, {
    headers: { Accept: "text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, */*" },
    cache: "no-store",
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) throw new Error(`O arquivo do Data Export CEC respondeu HTTP ${response.status}.`);

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxReportBytes) {
    throw new Error("O arquivo do Data Export CEC excedeu o limite seguro de 10 MB.");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error("O arquivo do Data Export CEC veio vazio.");
  if (buffer.length > maxReportBytes) throw new Error("O arquivo do Data Export CEC excedeu o limite seguro de 10 MB.");

  const disposition = response.headers.get("content-disposition") ?? "";
  const dispositionFileName = disposition.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i)?.[1];
  const pathFileName = decodeURIComponent(exportUrl.pathname.split("/").pop() || "");
  return {
    buffer,
    fileName: dispositionFileName ? decodeURIComponent(dispositionFileName.trim()) : pathFileName || "cec_cpd_hourly.csv"
  };
}

export function parseCecScheduledReport(buffer: Buffer): RealtimeCecTicketInput[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, raw: false });
  } catch {
    throw new Error("O arquivo do Data Export CEC não está em um formato CSV/XLSX válido.");
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) throw new Error("O arquivo do Data Export CEC não possui uma planilha legível.");

  const rows = XLSX.utils.sheet_to_json<UnknownRecord>(sheet, { defval: "", raw: false });
  if (!rows.length) throw new Error("O Data Export CEC não retornou tickets.");

  const headers = [
    { label: "Ticket ID", aliases: ["ticket", "ticket id", "ticket number", "id"] },
    { label: "Agent name", aliases: ["agent name", "agent", "agente", "nome do agente"] },
    { label: "Status", aliases: ["status", "ticket status", "estado"] }
  ];
  const availableHeaders = new Set(Object.keys(rows[0]).map(normalizeHeader));
  const missingHeaders = headers
    .filter((header) => !header.aliases.some((alias) => availableHeaders.has(normalizeHeader(alias))))
    .map((header) => header.label);
  if (missingHeaders.length) {
    throw new Error(`O Data Export CEC não contém a(s) coluna(s): ${missingHeaders.join(", ")}.`);
  }

  const tickets = rows.flatMap((row) => {
    const ticket = String(findValue(row, headers[0].aliases) ?? "").trim();
    if (!ticket) return [];
    return [{
      ticket,
      agentName: String(findValue(row, headers[1].aliases) ?? "").trim() || "Sem agente",
      status: String(findValue(row, headers[2].aliases) ?? "").trim() || "Sem status"
    }];
  });
  if (!tickets.length) throw new Error("O Data Export CEC não possui Ticket IDs válidos.");
  return tickets;
}

export function getCecCycleForDate(value: Date) {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: saoPauloTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:00`;
}

export function getCecScheduledReportGeneratedAt(fileName: string) {
  const match = fileName.match(/(?:^|[_-])(\d{13})(?=\D|$)/);
  if (!match?.[1]) return null;
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp)) return null;
  const generatedAt = new Date(timestamp);
  return Number.isNaN(generatedAt.getTime()) ? null : generatedAt;
}

function currentHourlyCycle() {
  return getCecCycleForDate(new Date());
}

export async function fetchRealtimeCecFromFreshdesk(): Promise<RealtimeCecImportInput> {
  const metadata = await fetchScheduledReportMetadata();
  const exportUrl = findExportUrl(isRecord(metadata) && "export" in metadata ? metadata.export : metadata);
  if (!exportUrl) throw new Error("O Freshdesk não retornou o link do arquivo do Data Export CEC.");

  const downloaded = await downloadScheduledReport(validateExportUrl(exportUrl));
  const reportGeneratedAt = getCecScheduledReportGeneratedAt(downloaded.fileName) ?? new Date();
  return {
    cycleDownload: getCecCycleForDate(reportGeneratedAt),
    fileName: downloaded.fileName,
    source: "freshdesk-cec-cpd-hourly",
    generatedDate: reportGeneratedAt.toISOString(),
    tickets: parseCecScheduledReport(downloaded.buffer)
  };
}

export function getCurrentCecCycle() {
  return currentHourlyCycle();
}
