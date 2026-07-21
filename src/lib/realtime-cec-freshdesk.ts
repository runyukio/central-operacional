import type { RealtimeCecImportInput, RealtimeCecTicketInput } from "@/lib/realtime-cec-service";

const defaultFreshdeskDomain = "kuaishousupport.freshdesk.com";
const defaultBacklogSince = "2015-01-01";
const saoPauloTimeZone = "America/Sao_Paulo";
const searchPageSize = 30;
const searchPageLimit = 10;

type UnknownRecord = Record<string, unknown>;

type FreshdeskConfig = {
  apiKey: string;
  domain: string;
  groupIds: Set<number>;
  groupNames: Set<string>;
  statusOverrides: Map<number, string>;
  backlogSince: Date;
};

type FreshdeskGroup = {
  id: number;
  name: string;
};

type FreshdeskTicket = {
  id: number;
  group_id: number | null;
  status: number;
  created_at?: string | null;
};

type FreshdeskSearchResponse = {
  total: number;
  results: FreshdeskTicket[];
};

type StatusChoice = {
  id: number;
  label: string;
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sanitizeSecret(value: string | undefined) {
  return String(value ?? "").replace(/[\r\n]/g, "").trim();
}

function parseList(value: string | undefined) {
  return String(value ?? "")
    .split(/[;,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseStatusOverrides(value: string | undefined) {
  const statuses = new Map<number, string>();
  parseList(value).forEach((item) => {
    const match = item.match(/^(\d+)(?::(.+))?$/);
    if (!match) return;
    const id = Number(match[1]);
    if (Number.isSafeInteger(id) && id > 0) statuses.set(id, match[2]?.trim() || "");
  });
  return statuses;
}

function parseBacklogSince(value: string | undefined) {
  const rawValue = String(value || defaultBacklogSince).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
    throw new Error("CEC_FRESHDESK_BACKLOG_SINCE deve usar o formato YYYY-MM-DD.");
  }
  const date = new Date(`${rawValue}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("CEC_FRESHDESK_BACKLOG_SINCE contém uma data inválida.");
  return date;
}

function getFreshdeskConfig(): FreshdeskConfig {
  const apiKey = sanitizeSecret(process.env.CEC_FRESHDESK_API_KEY);
  if (!apiKey) {
    throw new Error("Configure CEC_FRESHDESK_API_KEY com uma API Key da API Core v2 do Freshdesk.");
  }

  const domain = String(process.env.CEC_FRESHDESK_DOMAIN || defaultFreshdeskDomain)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  if (!domain.endsWith(".freshdesk.com") || domain.includes("/")) {
    throw new Error("CEC_FRESHDESK_DOMAIN deve conter apenas o domínio oficial *.freshdesk.com.");
  }

  const groupIds = new Set(
    parseList(process.env.CEC_FRESHDESK_GROUP_IDS)
      .map(Number)
      .filter((id) => Number.isSafeInteger(id) && id > 0)
  );
  const groupNames = new Set(parseList(process.env.CEC_FRESHDESK_GROUP_NAMES).map(normalizeText).filter(Boolean));
  if (!groupIds.size && !groupNames.size) {
    throw new Error("Configure CEC_FRESHDESK_GROUP_IDS ou CEC_FRESHDESK_GROUP_NAMES com os grupos permitidos no report CEC.");
  }

  return {
    apiKey,
    domain,
    groupIds,
    groupNames,
    statusOverrides: parseStatusOverrides(process.env.CEC_FRESHDESK_STATUS_IDS),
    backlogSince: parseBacklogSince(process.env.CEC_FRESHDESK_BACKLOG_SINCE)
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

async function freshdeskJson<T>(config: FreshdeskConfig, path: string): Promise<T> {
  const url = new URL(path, `https://${config.domain}`);
  if (url.hostname !== config.domain || !url.pathname.startsWith("/api/v2/")) {
    throw new Error("A consulta CEC tentou acessar um endpoint Freshdesk não permitido.");
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${config.apiKey}:X`).toString("base64")}`
      },
      cache: "no-store",
      signal: AbortSignal.timeout(45_000)
    });

    if (response.ok) return await response.json() as T;

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < 2) {
      await sleep(retryDelayMs(response, attempt));
      continue;
    }
    if (response.status === 401) {
      throw new Error("CEC_FRESHDESK_API_KEY não autenticou na API Core v2. Use a API Key do perfil de um agente Freshdesk autorizado.");
    }
    if (response.status === 403) {
      throw new Error("A API Key do Freshdesk não possui permissão para consultar tickets, grupos ou campos do report CEC.");
    }
    if (response.status === 429) {
      throw new Error("O limite de chamadas do Freshdesk foi atingido. O último snapshot CEC válido foi mantido.");
    }
    throw new Error(`A API Core v2 do Freshdesk respondeu HTTP ${response.status}.`);
  }

  throw new Error("A API Core v2 do Freshdesk não respondeu após três tentativas.");
}

async function listAllPages<T>(config: FreshdeskConfig, path: string) {
  const rows: T[] = [];
  for (let page = 1; page <= 300; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const pageRows = await freshdeskJson<T[]>(config, `${path}${separator}per_page=100&page=${page}`);
    rows.push(...pageRows);
    if (pageRows.length < 100) return rows;
  }
  throw new Error("A listagem Freshdesk excedeu 30.000 registros e foi interrompida para não retornar dados incompletos.");
}

async function loadSelectedGroups(config: FreshdeskConfig) {
  const groups = await listAllPages<FreshdeskGroup>(config, "/api/v2/groups");
  const selected = groups.filter((group) => config.groupIds.has(group.id) || config.groupNames.has(normalizeText(group.name)));
  const selectedIds = new Set(selected.map((group) => group.id));
  const selectedNames = new Set(selected.map((group) => normalizeText(group.name)));
  const missingIds = [...config.groupIds].filter((id) => !selectedIds.has(id));
  const missingNames = [...config.groupNames].filter((name) => !selectedNames.has(name));
  if (missingIds.length || missingNames.length) {
    const missing = [...missingIds.map(String), ...missingNames];
    throw new Error(`Grupo(s) CEC não encontrado(s) ou sem permissão no Freshdesk: ${missing.join(", ")}.`);
  }
  if (!selected.length) throw new Error("Nenhum grupo Freshdesk permitido foi encontrado para o report CEC.");
  return selected;
}

function collectChoiceEntries(value: unknown, choices: StatusChoice[]) {
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (isRecord(item)) {
        const id = Number(item.value ?? item.id);
        const label = String(item.label ?? item.name ?? "").trim();
        if (Number.isSafeInteger(id) && id > 0 && label) choices.push({ id, label });
        else collectChoiceEntries(item, choices);
      }
    });
    return;
  }
  if (!isRecord(value)) return;
  Object.entries(value).forEach(([key, child]) => {
    const keyId = Number(key);
    const childId = Number(child);
    if (Number.isSafeInteger(keyId) && keyId > 0 && typeof child === "string") {
      choices.push({ id: keyId, label: child });
    } else if (Number.isSafeInteger(childId) && childId > 0 && !/^\d+$/.test(key)) {
      choices.push({ id: childId, label: key });
    } else {
      collectChoiceEntries(child, choices);
    }
  });
}

function isTerminalStatus(label: string) {
  const normalized = normalizeText(label);
  return ["resolved", "closed", "resolvido", "resolvida", "fechado", "fechada", "deleted", "spam"]
    .some((status) => normalized === status || normalized.includes(status));
}

function normalizeStatusLabel(label: string) {
  const normalized = normalizeText(label);
  if (normalized.includes("new") || normalized.includes("novo") || normalized.includes("nova")) return "New";
  if (
    normalized.includes("on hold") ||
    normalized.includes("pending") ||
    normalized.includes("waiting") ||
    normalized.includes("pendente") ||
    normalized.includes("aguardando")
  ) return "On Hold";
  if (normalized.includes("open") || normalized.includes("aberto") || normalized.includes("aberta")) return "Open";
  return label.trim() || "Sem status";
}

async function loadBacklogStatuses(config: FreshdeskConfig) {
  const fields = await freshdeskJson<UnknownRecord[]>(config, "/api/v2/ticket_fields");
  const statusField = fields.find((field) => normalizeText(field.name) === "status");
  const choices: StatusChoice[] = [];
  if (statusField) collectChoiceEntries(statusField.choices, choices);
  const labelsById = new Map(choices.map((choice) => [choice.id, choice.label]));

  if (config.statusOverrides.size) {
    return [...config.statusOverrides].map(([id, configuredLabel]) => ({
      id,
      label: normalizeStatusLabel(configuredLabel || labelsById.get(id) || `Status ${id}`)
    }));
  }

  const unresolved = choices.filter((choice) => !isTerminalStatus(choice.label));
  if (unresolved.length) {
    return [...new Map(unresolved.map((choice) => [choice.id, { ...choice, label: normalizeStatusLabel(choice.label) }])).values()];
  }

  // Standard Freshdesk unresolved statuses, used only if the account does not expose choices.
  return [
    { id: 2, label: "Open" },
    { id: 3, label: "On Hold" },
    { id: 6, label: "On Hold" },
    { id: 7, label: "On Hold" }
  ];
}

function formatUtcDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addUtcDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function ticketDateInRange(ticket: FreshdeskTicket, start: Date, end: Date) {
  if (!ticket.created_at) return false;
  const date = ticket.created_at.slice(0, 10);
  return date >= formatUtcDate(start) && date <= formatUtcDate(end);
}

async function searchPage(config: FreshdeskConfig, query: string, page: number) {
  const params = new URLSearchParams({ query: `"${query}"`, page: String(page) });
  const payload = await freshdeskJson<FreshdeskSearchResponse>(config, `/api/v2/search/tickets?${params.toString()}`);
  return {
    total: Math.max(0, Number(payload.total) || 0),
    results: Array.isArray(payload.results) ? payload.results : []
  };
}

async function collectSearch(config: FreshdeskConfig, query: string, firstPage?: FreshdeskSearchResponse) {
  const first = firstPage ?? await searchPage(config, query, 1);
  if (first.total > searchPageSize * searchPageLimit) return null;

  const results = [...first.results];
  const pages = Math.min(searchPageLimit, Math.ceil(first.total / searchPageSize));
  for (let page = 2; page <= pages; page += 1) {
    results.push(...(await searchPage(config, query, page)).results);
  }
  return results;
}

async function collectSearchRange(config: FreshdeskConfig, baseQuery: string, start: Date, end: Date): Promise<FreshdeskTicket[]> {
  const sameDay = formatUtcDate(start) === formatUtcDate(end);
  const rangeQuery = sameDay
    ? `${baseQuery} AND created_at:'${formatUtcDate(start)}'`
    : `${baseQuery} AND created_at:>'${formatUtcDate(addUtcDays(start, -1))}' AND created_at:<'${formatUtcDate(addUtcDays(end, 1))}'`;
  const first = await searchPage(config, rangeQuery, 1);
  const direct = await collectSearch(config, rangeQuery, first);
  if (direct) return direct.filter((ticket) => ticketDateInRange(ticket, start, end));
  if (sameDay) {
    throw new Error(`Mais de 300 tickets CEC foram encontrados em ${formatUtcDate(start)} para um único grupo/status. Refine os grupos antes de ativar o report.`);
  }

  const totalDays = Math.floor((end.getTime() - start.getTime()) / 86_400_000);
  const midpoint = addUtcDays(start, Math.floor(totalDays / 2));
  // Keep date partitions sequential so a large backlog cannot fan out into
  // dozens of concurrent requests and consume the account rate limit.
  const left = await collectSearchRange(config, baseQuery, start, midpoint);
  const right = await collectSearchRange(config, baseQuery, addUtcDays(midpoint, 1), end);
  return [...left, ...right];
}

async function collectTicketsForGroupStatus(config: FreshdeskConfig, groupId: number, statusId: number) {
  const baseQuery = `group_id:${groupId} AND status:${statusId}`;
  const first = await searchPage(config, baseQuery, 1);
  const direct = await collectSearch(config, baseQuery, first);
  if (direct) return direct;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return collectSearchRange(config, baseQuery, config.backlogSince, today);
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

export async function fetchRealtimeCecFromFreshdesk(): Promise<RealtimeCecImportInput> {
  const config = getFreshdeskConfig();
  const groups = await loadSelectedGroups(config);
  const statuses = await loadBacklogStatuses(config);
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const statusById = new Map(statuses.map((status) => [status.id, status.label]));
  const ticketsById = new Map<number, FreshdeskTicket>();

  for (const group of groups) {
    for (const status of statuses) {
      const tickets = await collectTicketsForGroupStatus(config, group.id, status.id);
      tickets.forEach((ticket) => {
        if (ticket.group_id === group.id && ticket.status === status.id) ticketsById.set(ticket.id, ticket);
      });
    }
  }

  const tickets: RealtimeCecTicketInput[] = [...ticketsById.values()].map((ticket) => {
    const group = ticket.group_id ? groupById.get(ticket.group_id) : null;
    return {
      ticket: String(ticket.id),
      agentName: group?.name || "Grupo não encontrado",
      status: statusById.get(ticket.status) || `Status ${ticket.status}`,
      groupId: ticket.group_id ? String(ticket.group_id) : null,
      groupName: group?.name || "Grupo não encontrado"
    };
  });

  const reportGroups = groups.map((group) => {
    const groupTickets = tickets.filter((ticket) => ticket.groupId === String(group.id));
    return {
      key: `freshdesk_${group.id}`,
      label: group.name,
      backlog: groupTickets.length,
      onHold: groupTickets.filter((ticket) => ticket.status === "On Hold").length,
      open: groupTickets.filter((ticket) => ticket.status === "Open").length,
      new: groupTickets.filter((ticket) => ticket.status === "New").length
    };
  });
  const total = tickets.length;

  return {
    cycleDownload: currentHalfHourCycle(),
    fileName: "freshdesk-api-v2",
    source: "freshdesk-core-api-v2",
    generatedDate: new Date().toISOString(),
    groups: reportGroups,
    departments: reportGroups
      .map((group) => ({
        name: group.label,
        group: group.key,
        backlog: group.backlog,
        percent: total ? (group.backlog / total) * 100 : 0
      }))
      .sort((left, right) => right.backlog - left.backlog || left.name.localeCompare(right.name)),
    tickets
  };
}

export function getCurrentCecCycle() {
  return currentHalfHourCycle();
}
