import type { RealtimeCecImportInput, RealtimeCecTicketInput } from "@/lib/realtime-cec-service";

const defaultFreshdeskDomain = "kuaishousupport.freshdesk.com";
const defaultNormalGroupPattern = "normal";
const saoPauloTimeZone = "America/Sao_Paulo";
const maxSearchPages = 10;

type UnknownRecord = Record<string, unknown>;

type FreshdeskTicket = {
  id: number;
  group_id: number | null;
  responder_id: number | null;
  status: number;
};

type FreshdeskSearchResponse = {
  total: number;
  results: FreshdeskTicket[];
};

type FreshdeskGroup = {
  id: number;
  name: string;
};

type FreshdeskAgent = {
  id: number;
  name?: string | null;
  contact?: {
    name?: string | null;
    email?: string | null;
  } | null;
};

type FreshdeskStatus = {
  id: number;
  label: string;
  reportStatus: "On Hold" | "Open" | "New";
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function sanitizeDomain(value: string) {
  return value
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .trim();
}

function getFreshdeskConfig() {
  const apiKey = process.env.CEC_FRESHDESK_API_KEY?.replace(/[\r\n]/g, "").trim() ?? "";
  if (!apiKey) {
    throw new Error("Configure CEC_FRESHDESK_API_KEY na Vercel para consultar a API oficial do Freshdesk.");
  }

  const domain = sanitizeDomain(process.env.CEC_FRESHDESK_DOMAIN?.trim() || defaultFreshdeskDomain);
  if (!domain.endsWith(".freshdesk.com")) {
    throw new Error("CEC_FRESHDESK_DOMAIN deve usar o domínio oficial *.freshdesk.com.");
  }

  return {
    apiKey,
    baseUrl: `https://${domain}`,
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

async function freshdeskFetchJson<T>(path: string, searchParams?: URLSearchParams): Promise<T> {
  const config = getFreshdeskConfig();
  const url = new URL(path, config.baseUrl);
  searchParams?.forEach((value, key) => url.searchParams.append(key, value));

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: config.authorization,
        "Content-Type": "application/json"
      },
      cache: "no-store",
      signal: AbortSignal.timeout(45_000)
    });

    if (response.ok) return response.json() as Promise<T>;

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < 2) {
      await sleep(retryDelayMs(response, attempt));
      continue;
    }

    if (response.status === 401) {
      throw new Error("A API Key do Freshdesk é inválida ou foi revogada. Atualize CEC_FRESHDESK_API_KEY na Vercel.");
    }
    if (response.status === 403) {
      throw new Error("A API Key do Freshdesk não possui permissão para consultar tickets, grupos e agentes.");
    }
    if (response.status === 429) {
      throw new Error("O limite de chamadas da API Freshdesk foi atingido. O último snapshot válido foi mantido.");
    }
    throw new Error(`A API Freshdesk respondeu HTTP ${response.status}.`);
  }

  throw new Error("A API Freshdesk não respondeu após três tentativas.");
}

async function fetchFreshdeskCollection<T>(path: string): Promise<T[]> {
  const rows: T[] = [];
  const perPage = 100;

  for (let page = 1; page <= 100; page += 1) {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    const current = await freshdeskFetchJson<T[]>(path, params);
    if (!Array.isArray(current)) throw new Error(`A API Freshdesk retornou formato inesperado em ${path}.`);
    rows.push(...current);
    if (current.length < perPage) return rows;
  }

  throw new Error(`A paginação da API Freshdesk excedeu o limite seguro em ${path}.`);
}

function parseConfiguredIds(value: string | undefined) {
  return Array.from(new Set(
    String(value ?? "")
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isSafeInteger(item) && item > 0)
  ));
}

function resolveNormalGroups(groups: FreshdeskGroup[]) {
  const configuredIds = parseConfiguredIds(process.env.CEC_FRESHDESK_GROUP_IDS);
  if (configuredIds.length) {
    const byId = new Map(groups.map((group) => [group.id, group]));
    const missing = configuredIds.filter((id) => !byId.has(id));
    if (missing.length) throw new Error(`CEC_FRESHDESK_GROUP_IDS contém grupo(s) inexistente(s): ${missing.join(", ")}.`);
    return configuredIds.map((id) => byId.get(id) as FreshdeskGroup);
  }

  const patterns = String(process.env.CEC_FRESHDESK_GROUP_NAME_PATTERN || defaultNormalGroupPattern)
    .split(",")
    .map(normalizeText)
    .filter(Boolean);

  const selected = groups.filter((group) => {
    const name = normalizeText(group.name);
    const matches = patterns.some((pattern) => name.includes(pattern));
    const isP0 = /(^|[^a-z0-9])p\s*0([^a-z0-9]|$)/i.test(name) || name.includes("priority 0");
    return matches && !isP0;
  });

  if (!selected.length) {
    throw new Error("Nenhum grupo de Backlog Normal foi encontrado. Configure CEC_FRESHDESK_GROUP_IDS com os IDs oficiais.");
  }
  return selected;
}

function toReportStatus(value: unknown): FreshdeskStatus["reportStatus"] | null {
  const normalized = normalizeText(value).replace(/[_-]+/g, " ");
  if (normalized.includes("on hold") || normalized.includes("pending") || normalized.includes("pendente")) return "On Hold";
  if (normalized === "open" || normalized.includes("aberto")) return "Open";
  if (normalized === "new" || normalized.includes("novo") || normalized.includes("nova")) return "New";
  return null;
}

function collectStatusChoices(value: unknown, statuses: Map<number, string>, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectStatusChoices(item, statuses, depth + 1));
    return;
  }
  if (!isRecord(value)) return;

  const id = Number(value.id ?? value.value);
  const labelValue = value.label ?? value.name ?? value.value;
  if (Number.isSafeInteger(id) && typeof labelValue === "string" && labelValue.trim()) {
    statuses.set(id, labelValue.trim());
  }

  for (const [key, child] of Object.entries(value)) {
    if (Number.isSafeInteger(Number(child)) && toReportStatus(key)) statuses.set(Number(child), key);
    else collectStatusChoices(child, statuses, depth + 1);
  }
}

function parseStatusOverride() {
  const raw = process.env.CEC_FRESHDESK_STATUS_MAP?.trim();
  if (!raw) return new Map<number, string>();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) throw new Error("mapa inválido");
    return new Map(
      Object.entries(parsed)
        .map(([id, label]) => [Number(id), String(label)] as const)
        .filter(([id, label]) => Number.isSafeInteger(id) && id > 0 && Boolean(toReportStatus(label)))
    );
  } catch {
    throw new Error('CEC_FRESHDESK_STATUS_MAP deve ser um JSON válido, por exemplo {"2":"Open","3":"On Hold"}.');
  }
}

async function resolveBacklogStatuses() {
  const configured = parseStatusOverride();
  const labels = configured.size ? configured : new Map<number, string>();

  if (!configured.size) {
    const fields = await freshdeskFetchJson<unknown[]>("/api/v2/ticket_fields");
    const statusField = Array.isArray(fields)
      ? fields.find((field) => isRecord(field) && normalizeText(field.name ?? field.label) === "status")
      : null;
    if (statusField) collectStatusChoices(statusField, labels);
  }

  if (!labels.size) {
    labels.set(2, "Open");
    labels.set(3, "Pending");
  }

  const statuses = Array.from(labels, ([id, label]) => ({ id, label, reportStatus: toReportStatus(label) }))
    .filter((status): status is FreshdeskStatus => Boolean(status.reportStatus));

  if (!statuses.length) throw new Error("Nenhum status aberto do Freshdesk foi reconhecido para o report CEC.");
  return statuses;
}

async function searchTickets(groupId: number, status: FreshdeskStatus) {
  const tickets: FreshdeskTicket[] = [];
  let expectedTotal = 0;
  const query = `group_id:${groupId} AND status:${status.id}`;

  for (let page = 1; page <= maxSearchPages; page += 1) {
    const params = new URLSearchParams({ query: `"${query}"`, page: String(page) });
    const response = await freshdeskFetchJson<FreshdeskSearchResponse>("/api/v2/search/tickets", params);
    if (!response || !Array.isArray(response.results) || !Number.isFinite(Number(response.total))) {
      throw new Error("A busca de tickets do Freshdesk retornou um formato inesperado.");
    }
    expectedTotal = Number(response.total);
    tickets.push(...response.results);
    if (response.results.length < 30 || tickets.length >= expectedTotal) break;
  }

  if (tickets.length < expectedTotal) {
    throw new Error(
      `A busca Freshdesk foi truncada para o grupo ${groupId} e status ${status.label} (${tickets.length}/${expectedTotal}). ` +
      "Refine CEC_FRESHDESK_GROUP_IDS antes de publicar o snapshot."
    );
  }
  return tickets;
}

function agentDisplayName(agent: FreshdeskAgent | undefined) {
  return String(agent?.contact?.name || agent?.name || agent?.contact?.email || "").trim();
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
  const [allGroups, agents, statuses] = await Promise.all([
    fetchFreshdeskCollection<FreshdeskGroup>("/api/v2/groups"),
    fetchFreshdeskCollection<FreshdeskAgent>("/api/v2/agents"),
    resolveBacklogStatuses()
  ]);
  const groups = resolveNormalGroups(allGroups);
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const statusById = new Map(statuses.map((status) => [status.id, status]));

  const results = await Promise.all(
    groups.flatMap((group) => statuses.map(async (status) => ({ status, tickets: await searchTickets(group.id, status) })))
  );
  const ticketsById = new Map<number, FreshdeskTicket>();
  results.forEach(({ tickets }) => tickets.forEach((ticket) => ticketsById.set(ticket.id, ticket)));

  const breakdownBy = normalizeText(process.env.CEC_FRESHDESK_BREAKDOWN_BY || "agent");
  const tickets: RealtimeCecTicketInput[] = Array.from(ticketsById.values()).map((ticket) => {
    const groupName = groupById.get(Number(ticket.group_id))?.name || "Grupo não encontrado";
    const responderName = agentDisplayName(agentById.get(Number(ticket.responder_id))) || "Sem agente";
    return {
      ticket: String(ticket.id),
      agentName: breakdownBy === "group" ? groupName : responderName,
      status: statusById.get(ticket.status)?.reportStatus || "Sem status"
    };
  });

  if (!tickets.length) throw new Error("A API oficial do Freshdesk não retornou tickets para os grupos de Backlog Normal.");

  const statusCounts = tickets.reduce<Record<string, number>>((counts, ticket) => {
    counts[ticket.status] = (counts[ticket.status] || 0) + 1;
    return counts;
  }, {});
  const departmentCounts = tickets.reduce<Record<string, number>>((counts, ticket) => {
    counts[ticket.agentName] = (counts[ticket.agentName] || 0) + 1;
    return counts;
  }, {});
  const total = tickets.length;

  return {
    cycleDownload: currentHalfHourCycle(),
    fileName: "cec_backlog_normal_freshdesk_api_v2",
    source: "freshdesk-api-v2",
    generatedDate: new Date().toISOString(),
    groups: [{
      key: "normal",
      label: "Backlog Normal",
      backlog: total,
      onHold: statusCounts["On Hold"] || 0,
      open: statusCounts.Open || 0,
      new: statusCounts.New || 0
    }],
    departments: Object.entries(departmentCounts)
      .map(([name, backlog]) => ({ name, group: "normal", backlog, percent: total ? (backlog / total) * 100 : 0 }))
      .sort((left, right) => right.backlog - left.backlog || left.name.localeCompare(right.name)),
    tickets
  };
}

export function getCurrentCecCycle() {
  return currentHalfHourCycle();
}
