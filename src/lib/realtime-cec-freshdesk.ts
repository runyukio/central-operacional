import * as XLSX from "xlsx";

import type { RealtimeCecImportInput, RealtimeCecTicketInput } from "@/lib/realtime-cec-service";

const defaultReportUrl = "https://kuaishousupport.freshdesk.com/reports/schedule/download_file.json?uuid=333f3cd9-ec65-4aae-9817-b6fcee4efa4d";
const saoPauloTimeZone = "America/Sao_Paulo";

type UnknownRecord = Record<string, unknown>;

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function findValue(row: UnknownRecord, aliases: string[]) {
  for (const [key, value] of Object.entries(row)) {
    if (aliases.includes(normalizeHeader(key)) && String(value ?? "").trim()) return value;
  }
  return "";
}

function scoreRows(rows: unknown[]): number {
  const aliases = new Set(["ticket", "ticket id", "ticket number", "id", "agent name", "agent", "agente", "nome do agente", "status", "ticket status", "estado"]);
  return rows.reduce<number>((score, row) => {
    if (!isRecord(row)) return score;
    return score + Object.keys(row).filter((key) => aliases.has(normalizeHeader(key))).length;
  }, 0);
}

function findBestRowsInJson(value: unknown, depth = 0): UnknownRecord[] {
  if (depth > 8 || value === null || value === undefined) return [];
  const candidates: UnknownRecord[][] = [];

  if (Array.isArray(value)) {
    const records = value.filter(isRecord);
    if (records.length) candidates.push(records);
    for (const item of value) {
      const nested = findBestRowsInJson(item, depth + 1);
      if (nested.length) candidates.push(nested);
    }
  } else if (isRecord(value)) {
    for (const child of Object.values(value)) {
      const nested = findBestRowsInJson(child, depth + 1);
      if (nested.length) candidates.push(nested);
    }
  }

  return candidates.sort((left, right) => scoreRows(right) - scoreRows(left) || right.length - left.length)[0] ?? [];
}

function findDownloadUrl(value: unknown, propertyName = "", depth = 0): string | null {
  if (depth > 8 || value === null || value === undefined) return null;
  if (typeof value === "string") {
    return /^https?:\/\//i.test(value) && /(download|file|url|path)/i.test(propertyName) ? value : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDownloadUrl(item, propertyName, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    const found = findDownloadUrl(child, key, depth + 1);
    if (found) return found;
  }
  return null;
}

function normalizeStatus(value: unknown) {
  const normalized = normalizeHeader(value);
  if (["on hold", "onhold", "pending", "pendente", "3"].includes(normalized)) return "On Hold";
  if (["open", "aberto", "aberta", "2"].includes(normalized)) return "Open";
  if (["new", "novo", "nova"].includes(normalized)) return "New";
  return String(value ?? "").trim() || "Sem status";
}

function parseRows(buffer: Buffer, contentType: string): UnknownRecord[] {
  const text = buffer.toString("utf8").trimStart();
  if (contentType.includes("json") || text.startsWith("{") || text.startsWith("[")) {
    const parsed = JSON.parse(text) as unknown;
    const rows = findBestRowsInJson(parsed);
    if (rows.length) return rows;
  }

  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json<UnknownRecord>(workbook.Sheets[sheetName], { defval: "", raw: false });
}

function normalizeTickets(rows: UnknownRecord[]): RealtimeCecTicketInput[] {
  const ticketAliases = ["ticket", "ticket id", "ticket number", "id"];
  const agentAliases = ["agent name", "agent", "agente", "nome do agente"];
  const statusAliases = ["status", "ticket status", "estado"];
  const seen = new Set<string>();
  const tickets: RealtimeCecTicketInput[] = [];

  rows.forEach((row, index) => {
    const ticket = String(findValue(row, ticketAliases) ?? "").trim();
    const agentName = String(findValue(row, agentAliases) ?? "").trim() || "Sem agente";
    const status = normalizeStatus(findValue(row, statusAliases));
    if (!ticket && agentName === "Sem agente" && status === "Sem status") return;
    const key = ticket ? `ticket:${ticket.toLowerCase()}` : `row:${index}:${agentName.toLowerCase()}:${status.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    tickets.push({ ticket: ticket || `linha-${index + 2}`, agentName, status });
  });

  return tickets;
}

function currentHalfHourCycle() {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: saoPauloTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  const minute = Number(parts.minute) >= 30 ? "30" : "00";
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${minute}`;
}

function buildRequestHeaders(cookie: string) {
  const headers: Record<string, string> = {
    Accept: "*/*",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Referer: "https://kuaishousupport.freshdesk.com/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"
  };
  if (cookie) headers.Cookie = cookie;
  const authorization = process.env.CEC_FRESHDESK_AUTHORIZATION?.trim();
  if (authorization) headers.Authorization = authorization;
  return headers;
}

async function downloadReport(url: string, headers: Record<string, string>) {
  const response = await fetch(url, { headers, cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`Freshdesk respondeu HTTP ${response.status}.`);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, contentType };
}

export async function fetchRealtimeCecFromFreshdesk(): Promise<RealtimeCecImportInput> {
  const reportUrl = process.env.CEC_FRESHDESK_REPORT_URL?.trim() || process.env.CEC_NORMAL_REPORT_URL?.trim() || defaultReportUrl;
  const cookie = process.env.CEC_FRESHDESK_COOKIE?.replace(/[\r\n]/g, "").trim() || "";
  if (!cookie && !process.env.CEC_FRESHDESK_AUTHORIZATION?.trim()) {
    throw new Error("Configure CEC_FRESHDESK_COOKIE na Vercel para autenticar a API do Freshdesk.");
  }

  const headers = buildRequestHeaders(cookie);
  let downloaded = await downloadReport(reportUrl, headers);
  const initialText = downloaded.buffer.toString("utf8").trimStart();

  if (downloaded.contentType.includes("json") || initialText.startsWith("{")) {
    const parsed = JSON.parse(initialText) as UnknownRecord;
    if (parsed.require_login === true) throw new Error("A sessão da API Freshdesk expirou. Atualize CEC_FRESHDESK_COOKIE na Vercel.");
    const nestedUrl = findDownloadUrl(parsed);
    if (nestedUrl) downloaded = await downloadReport(nestedUrl, headers);
  }

  const tickets = normalizeTickets(parseRows(downloaded.buffer, downloaded.contentType));
  if (!tickets.length) throw new Error("A API Freshdesk não retornou linhas com ticket, agent name e status.");

  const statusCounts = tickets.reduce<Record<string, number>>((counts, ticket) => {
    counts[ticket.status] = (counts[ticket.status] || 0) + 1;
    return counts;
  }, {});
  const agentCounts = tickets.reduce<Record<string, number>>((counts, ticket) => {
    counts[ticket.agentName] = (counts[ticket.agentName] || 0) + 1;
    return counts;
  }, {});
  const total = tickets.length;

  return {
    cycleDownload: currentHalfHourCycle(),
    fileName: "cec_backlog_normal_api",
    source: "freshdesk-api",
    generatedDate: new Date().toISOString(),
    groups: [{
      key: "normal",
      label: "Backlog Normal",
      backlog: total,
      onHold: statusCounts["On Hold"] || 0,
      open: statusCounts.Open || 0,
      new: statusCounts.New || 0
    }],
    departments: Object.entries(agentCounts)
      .map(([name, backlog]) => ({ name, group: "normal", backlog, percent: total ? (backlog / total) * 100 : 0 }))
      .sort((left, right) => right.backlog - left.backlog || left.name.localeCompare(right.name)),
    tickets
  };
}

export function getCurrentCecCycle() {
  return currentHalfHourCycle();
}
