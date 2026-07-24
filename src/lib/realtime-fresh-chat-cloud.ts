import type { RealtimeFreshChatImportInput } from "@/lib/realtime-fresh-chat-service";
import { importRealtimeFreshChatSnapshot } from "@/lib/realtime-fresh-chat-service";

const filePattern = /^total_chat_conversations_(\d+)\.csv$/i;
const maxExportBytes = 20 * 1024 * 1024;
const saoPauloTimeZone = "America/Sao_Paulo";

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type FetchFreshChatExportOptions = {
  reportUrl?: string;
  apiToken?: string;
  fetchImplementation?: FetchImplementation;
  timeoutMs?: number;
};

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function assertReportApiUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("FRESHCHAT_REPORT_API_URL inválida.");
  }
  const isLegacyFreshreports = url.hostname.endsWith(".freshreports.com");
  const isFreshchatAnalyticsExport = url.hostname.endsWith(".freshchat.com")
    && url.pathname === "/v2/analytics/export"
    && Boolean(url.searchParams.get("id"));
  if (url.protocol !== "https:" || (!isLegacyFreshreports && !isFreshchatAnalyticsExport)) {
    throw new Error("FRESHCHAT_REPORT_API_URL precisa ser uma URL HTTPS oficial do Freshchat/Freshreports.");
  }
  return url;
}

function assertExportUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("O Freshreports retornou uma URL de export inválida.");
  }
  const isFreshreports = url.hostname.endsWith(".freshreports.com");
  const isFreshreportsS3 = (
    url.hostname === "s3.ap-southeast-2.amazonaws.com"
    && url.pathname.startsWith("/freshreports-production-au-encrypt/")
  ) || (
    url.hostname.endsWith(".amazonaws.com")
    && url.hostname.startsWith("freshreports-production-au-encrypt.")
  );
  if (url.protocol !== "https:" || (!isFreshreports && !isFreshreportsS3)) {
    throw new Error("O Freshreports retornou um host de export não permitido.");
  }
  return url;
}

function collectUrls(value: unknown, urls: string[], visited = new Set<unknown>()) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^https:\/\//i.test(trimmed)) urls.push(trimmed);
    return;
  }
  if (!value || typeof value !== "object" || visited.has(value)) return;
  visited.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => collectUrls(item, urls, visited));
    return;
  }
  Object.values(value as Record<string, unknown>).forEach((item) => collectUrls(item, urls, visited));
}

export function extractFreshChatExportUrl(value: unknown) {
  const urls: string[] = [];
  collectUrls(value, urls);
  const uniqueUrls = [...new Set(urls)];
  return uniqueUrls.find((url) => filePattern.test(fileNameFromUrl(url)))
    ?? uniqueUrls.find((url) => /\.csv(?:[?#]|$)/i.test(url))
    ?? uniqueUrls[0]
    ?? "";
}

function fileNameFromUrl(value: string) {
  try {
    return decodeURIComponent(new URL(value).pathname.split("/").filter(Boolean).pop() ?? "");
  } catch {
    return "";
  }
}

function fileNameFromContentDisposition(value: string | null) {
  if (!value) return "";
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.replace(/^["']|["']$/g, ""));
    } catch {
      return encoded;
    }
  }
  return value.match(/filename=["']?([^;"']+)/i)?.[1]?.trim() ?? "";
}

function getGeneratedTimestamp(fileName: string) {
  const timestamp = Number(fileName.match(filePattern)?.[1] ?? "");
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new Error("O export Freshchat não possui o timestamp esperado no nome do arquivo.");
  }
  return timestamp;
}

export function freshChatCycleFromTimestamp(timestampMs: number) {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: saoPauloTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(timestampMs)).map((part) => [part.type, part.value]));
  const minute = Number(parts.minute) >= 30 ? "30" : "00";
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${minute}`;
}

function isCsvResponse(response: Response, requestedUrl: string) {
  const contentType = response.headers.get("content-type") ?? "";
  const disposition = response.headers.get("content-disposition") ?? "";
  const responseUrl = response.url || requestedUrl;
  return /(?:text\/csv|application\/csv)/i.test(contentType)
    || /\.csv(?:["';]|$)/i.test(disposition)
    || filePattern.test(fileNameFromUrl(responseUrl));
}

async function responseBody(response: Response) {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxExportBytes) {
    throw new Error("O export Freshchat excede o limite de 20 MB.");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxExportBytes) {
    throw new Error("O export Freshchat excede o limite de 20 MB.");
  }
  return text;
}

async function resolveFreshChatCsv(
  initialUrl: URL,
  fetchImplementation: FetchImplementation,
  timeoutMs: number,
  apiToken: string
) {
  let currentUrl = initialUrl;
  for (let hop = 0; hop < 3; hop += 1) {
    const shouldAuthorize = Boolean(apiToken) && currentUrl.origin === initialUrl.origin;
    const response = await fetchImplementation(currentUrl, {
      method: "GET",
      headers: {
        accept: "application/json, text/csv, application/octet-stream, */*",
        ...(shouldAuthorize ? { authorization: `Bearer ${apiToken}` } : {})
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store"
    });
    if (!response.ok) {
      if (response.status === 401 && !apiToken && initialUrl.hostname.endsWith(".freshchat.com")) {
        throw new Error("Freshchat respondeu HTTP 401; configure FRESHCHAT_REPORT_API_TOKEN.");
      }
      throw new Error(`Freshreports respondeu HTTP ${response.status}.`);
    }

    const requestedUrl = currentUrl.toString();
    if (isCsvResponse(response, requestedUrl)) {
      const rawText = await responseBody(response);
      const responseUrl = response.url || requestedUrl;
      const fileName = fileNameFromContentDisposition(response.headers.get("content-disposition"))
        || fileNameFromUrl(responseUrl)
        || fileNameFromUrl(requestedUrl);
      return { rawText, fileName };
    }

    const text = await responseBody(response);
    let payload: unknown = text;
    try {
      payload = JSON.parse(text);
    } catch {
      // O endpoint também pode retornar somente a URL em texto.
    }
    const nextUrl = extractFreshChatExportUrl(payload);
    if (!nextUrl) {
      throw new Error("A API URL do Freshreports não retornou o link do export Freshchat.");
    }
    currentUrl = assertExportUrl(nextUrl);
  }
  throw new Error("A API URL do Freshreports excedeu o limite de redirecionamentos.");
}

export async function fetchFreshChatExportFromFreshreports(
  options: FetchFreshChatExportOptions = {}
): Promise<RealtimeFreshChatImportInput> {
  const reportUrl = String(options.reportUrl ?? process.env.FRESHCHAT_REPORT_API_URL ?? "").trim();
  if (!reportUrl) throw new Error("FRESHCHAT_REPORT_API_URL não configurada.");
  const initialUrl = assertReportApiUrl(reportUrl);
  const apiToken = String(options.apiToken ?? process.env.FRESHCHAT_REPORT_API_TOKEN ?? "").trim();
  const timeoutMs = positiveInteger(options.timeoutMs ?? process.env.FRESHCHAT_REPORT_TIMEOUT_MS, 30_000);
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const { rawText, fileName } = await resolveFreshChatCsv(initialUrl, fetchImplementation, timeoutMs, apiToken);
  const generatedAtMs = getGeneratedTimestamp(fileName);

  return {
    cycleDownload: freshChatCycleFromTimestamp(generatedAtMs),
    fileName,
    source: "fresh-chat-freshreports-cloud",
    generatedDate: new Date(generatedAtMs).toISOString(),
    rawText
  };
}

export async function refreshRealtimeFreshChatFromFreshreports(
  options: FetchFreshChatExportOptions = {}
) {
  const input = await fetchFreshChatExportFromFreshreports(options);
  const imported = await importRealtimeFreshChatSnapshot(input);
  if ("error" in imported) throw new Error(imported.error);
  return { ...imported, refreshed: true };
}
