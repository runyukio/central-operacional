import { Prisma, UserStatus } from "@prisma/client";

import { normalizeAccessRole } from "@/lib/access-control";
import type { Actor } from "@/lib/mock-db";
import { prisma } from "@/lib/prisma";
import { canAccessRealtimeHoursActivity } from "@/lib/realtime-hours-permissions";
import { shiftCategoryName } from "@/lib/shift-display";
import { activityTimelineCursorScope, activityTimelinePageSql, decodeActivityTimelineCursor, encodeActivityTimelineCursor } from "@/lib/workstation-activity-pagination";
import {
  addDateKeyDays,
  saoPauloDateKey,
  startOfSaoPauloDate
} from "@/lib/realtime-hours-timeline";

const activitySourceTypes = ["WEB", "APP", "IDLE", "LOCKED", "PRIVATE", "UNKNOWN"] as const;
const defaultQueryLimit = 1_500;
const maxQueryLimit = 5_000;
const mergeGapSeconds = 15;

type ActivitySourceType = (typeof activitySourceTypes)[number];

type ActivityRawRow = {
  id: string;
  agentKey: string;
  eventId: string;
  source: string;
  capturedAt: Date;
  hostname: string;
  windowsUser: string | null;
  wbLogin: string | null;
  employeeId: string | null;
  sourceType: ActivitySourceType;
  applicationName: string | null;
  domain: string | null;
  startedAt: Date;
  endedAt: Date;
  agentVersion: string | null;
  employeeName: string | null;
  lob: string | null;
  supervisor: string | null;
};

type ActivityRow = ActivityRawRow & {
  durationSeconds: number;
};

type ActivitySummaryRow = {
  rowCount: number;
  employees: number;
  totalSeconds: number;
  webSeconds: number;
  appSeconds: number;
  idleSeconds: number;
  lockedSeconds: number;
  privateSeconds: number;
  unknownSeconds: number;
  uniqueDomains: number;
};

const activityViewerSelect = {
  email: true, name: true, status: true, deletedAt: true,
  role: { select: { name: true } },
  employeeProfile: { select: { id: true, roleTitle: true } }
} satisfies Prisma.UserSelect;

type ActivityViewer = Prisma.UserGetPayload<{ select: typeof activityViewerSelect }>;

export type WorkstationActivityQuery = {
  date?: string | null;
  search?: string | null;
  sourceType?: string | null;
  domain?: string | null;
  employeeId?: string | null;
  limit?: string | number | null;
  view?: string | null;
  agentKey?: string | null;
  agentSearch?: string | null;
  timeline?: string | boolean | null;
  lob?: string | null;
  shift?: string | null;
  pageSize?: string | number | null;
  cursor?: string | null;
};

const agentKeySql = Prisma.sql`CASE WHEN activity."employeeId" IS NOT NULL
  THEN 'employee:' || activity."employeeId"
  ELSE 'device:' || LOWER(activity."hostname") || '|' || LOWER(COALESCE(activity."windowsUser", '')) END`;

type AgentAggregate = {
  agentKey: string; employeeId: string | null; employeeName: string; wbLogin: string | null;
  windowsUser: string | null; lob: string; supervisor: string; hostnames: string[];
  totalSeconds: number; webSeconds: number; appSeconds: number; idleSeconds: number;
  lockedSeconds: number; uniqueDomains: number; lastActivityAt: Date; agentsFound: number;
};

type RankingAggregate = { rankKind: string; label: string; seconds: number };
type ActivityQueryResult = {
  summary: ActivitySummaryRow;
  agents: Array<Omit<AgentAggregate, "lastActivityAt"> & { lastActivityAt: string }>;
  rankings: RankingAggregate[];
  filterOptions?: Array<{ lob: string | null; shift: string | null }>;
  timelineGroups?: number;
  rows: Array<Omit<ActivityRawRow, "capturedAt" | "startedAt" | "endedAt"> & {
    capturedAt: string; startedAt: string; endedAt: string;
    sourceStartedAt?: string;
    mergedSourceRecords?: number;
  }>;
};

export async function getWorkstationActivityQuery(actor: Actor, query: WorkstationActivityQuery = {}) {
  const viewerResult = await requireActivityViewer(actor);
  if ("error" in viewerResult) return viewerResult;
  const viewer = viewerResult.viewer;

  const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(query.date ?? ""))
    ? String(query.date)
    : saoPauloDateKey(new Date());
  const start = startOfSaoPauloDate(dateKey);
  const end = startOfSaoPauloDate(addDateKeyDays(dateKey, 1));
  const limit = boundedInteger(query.limit, defaultQueryLimit, 100, maxQueryLimit);

  const selectedAgent = String(query.agentKey ?? "").trim();
  if (query.view === "agent" && (!selectedAgent || selectedAgent.length > 400)) {
    return { success: false, status: 400, error: "Selecione um agente para consultar os detalhes." } as const;
  }
  const conditions: Prisma.Sql[] = [
    Prisma.sql`activity."startedAt" < ${end}`,
    Prisma.sql`activity."endedAt" > ${start}`
  ];

  const visibleEmployeeIds = await visibleEmployeeIdsForViewer(viewer);
  if (visibleEmployeeIds) {
    conditions.push(visibleEmployeeIds.length
      ? Prisma.sql`activity."employeeId" IN (${Prisma.join(visibleEmployeeIds)})`
      : Prisma.sql`FALSE`);
  }

  if (selectedAgent.startsWith("employee:")) {
    // Match the stored key directly so the employee/date index remains usable.
    conditions.push(Prisma.sql`activity."employeeId" = ${selectedAgent.slice("employee:".length)}`);
  } else if (selectedAgent) {
    conditions.push(Prisma.sql`${agentKeySql} = ${selectedAgent}`);
  }

  const sourceType = String(query.sourceType ?? "").trim().toUpperCase();
  if (activitySourceTypes.includes(sourceType as ActivitySourceType)) {
    conditions.push(Prisma.sql`activity."sourceType" = ${sourceType}`);
  }

  const employeeId = String(query.employeeId ?? "").trim();
  if (employeeId) conditions.push(Prisma.sql`activity."employeeId" = ${employeeId}`);

  const domain = normalizeDomain(query.domain);
  if (domain) conditions.push(Prisma.sql`activity."domain" = ${domain}`);

  const search = String(query.search ?? "").trim();
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(Prisma.sql`(
      COALESCE(employee."fullName", '') ILIKE ${pattern}
      OR COALESCE(activity."wbLogin", '') ILIKE ${pattern}
      OR COALESCE(activity."windowsUser", '') ILIKE ${pattern}
      OR activity."hostname" ILIKE ${pattern}
      OR COALESCE(activity."domain", '') ILIKE ${pattern}
      OR COALESCE(activity."applicationName", '') ILIKE ${pattern}
    )`);
  }

  const overview = query.view === "overview";
  const lobFilter = String(query.lob ?? "").trim().slice(0, 120);
  const shiftFilter = String(query.shift ?? "").trim().slice(0, 120);
  const filters: Prisma.Sql[] = [];
  if (lobFilter && lobFilter !== "Todos") filters.push(Prisma.sql`COALESCE("lob", 'Sem LOB') = ${lobFilter}`);
  if (shiftFilter && shiftFilter !== "Todos") {
    const category = shiftCategoryName(shiftFilter);
    const shifts = await prisma.shift.findMany({ select: { name: true } });
    const names = shifts.filter((shift) => shiftCategoryName(shift.name) === category).map((shift) => shift.name);
    if (category === "Sem turno") names.push("Sem turno");
    filters.push(names.length ? Prisma.sql`COALESCE("shift", 'Sem turno') IN (${Prisma.join(names)})` : Prisma.sql`FALSE`);
  }
  const includeTimeline = !overview && query.timeline !== false && query.timeline !== "false";
  const paged = includeTimeline && query.view === "agent" && query.pageSize != null;
  const pageSize = boundedInteger(query.pageSize, 50, 1, 200);
  const cursorScope = activityTimelineCursorScope({ dateKey, selectedAgent, sourceType, domain, search, lobFilter, shiftFilter, viewer: viewer.email });
  let cursor;
  try { cursor = decodeActivityTimelineCursor(paged ? query.cursor : null, cursorScope); }
  catch { return { success: false, status: 400, error: "Página inválida. Atualize a consulta." } as const; }
  const where = Prisma.join(conditions, " AND ");
  const baseActivityQuery = Prisma.sql`
    SELECT
      ${agentKeySql} AS "agentKey",
      ${includeTimeline ? Prisma.sql`activity."id", activity."eventId", activity."source", activity."capturedAt",
        activity."agentVersion", activity."startedAt" AS "sourceStartedAt",` : Prisma.empty}
      activity."hostname",
      activity."windowsUser",
      activity."wbLogin",
      activity."employeeId",
      activity."sourceType",
      ${!overview ? Prisma.sql`activity."applicationName",` : Prisma.empty}
      activity."domain",
      GREATEST(activity."startedAt", ${start}) AS "startedAt",
      LEAST(activity."endedAt", ${end}) AS "endedAt",
      employee."fullName" AS "employeeName",
      lob."name" AS "lob",
      shift."name" AS "shift",
      supervisor."fullName" AS "supervisor"
    FROM "agent_activity"."WorkstationActivitySegment" activity
    LEFT JOIN public."EmployeeProfile" employee ON employee."id" = activity."employeeId"
    LEFT JOIN public."Lob" lob ON lob."id" = employee."lobId"
    LEFT JOIN public."Shift" shift ON shift."id" = employee."shiftId"
    LEFT JOIN public."EmployeeProfile" supervisor ON supervisor."id" = employee."supervisorId"
    WHERE ${where}
  `;

  const agentSearch = String(query.agentSearch ?? "").trim().slice(0, 120);
  const nameFilter = agentSearch ? Prisma.sql`HAVING BOOL_OR(COALESCE("employeeName", '') ILIKE ${`%${agentSearch}%`}
    OR COALESCE("wbLogin", '') ILIKE ${`%${agentSearch}%`}
    OR COALESCE("windowsUser", '') ILIKE ${`%${agentSearch}%`}
    OR "hostname" ILIKE ${`%${agentSearch}%`})` : Prisma.empty;

  // A single materialized day window serves every aggregate. Besides avoiding
  // repeated raw-table scans, this gives totals and details one database snapshot.
  const summaryQuery = Prisma.sql`
      SELECT COUNT(*)::int AS "rowCount", COUNT(DISTINCT "agentKey")::int AS "employees",
        COALESCE(SUM(EXTRACT(EPOCH FROM ("endedAt" - "startedAt"))), 0)::int AS "totalSeconds",
        COALESCE(SUM(CASE WHEN "sourceType" = 'WEB' THEN EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) ELSE 0 END), 0)::int AS "webSeconds",
        COALESCE(SUM(CASE WHEN "sourceType" = 'APP' THEN EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) ELSE 0 END), 0)::int AS "appSeconds",
        COALESCE(SUM(CASE WHEN "sourceType" = 'IDLE' THEN EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) ELSE 0 END), 0)::int AS "idleSeconds",
        COALESCE(SUM(CASE WHEN "sourceType" = 'LOCKED' THEN EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) ELSE 0 END), 0)::int AS "lockedSeconds",
        COALESCE(SUM(CASE WHEN "sourceType" = 'PRIVATE' THEN EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) ELSE 0 END), 0)::int AS "privateSeconds",
        COALESCE(SUM(CASE WHEN "sourceType" = 'UNKNOWN' THEN EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) ELSE 0 END), 0)::int AS "unknownSeconds",
        (COUNT(DISTINCT "domain") FILTER (WHERE "domain" IS NOT NULL))::int AS "uniqueDomains"
      FROM filtered_activity
  `;
  const agentsQuery = overview ? Prisma.sql`, agent_totals AS (
      SELECT "agentKey", MIN("employeeId") AS "employeeId",
        MIN(COALESCE(NULLIF("employeeName", ''), NULLIF("wbLogin", ''), NULLIF("windowsUser", ''), "hostname")) AS "employeeName",
        MIN("wbLogin") AS "wbLogin", MIN("windowsUser") AS "windowsUser",
        COALESCE(MIN("lob"), 'Sem LOB') AS "lob", COALESCE(MIN("supervisor"), 'Sem supervisor') AS "supervisor",
        ARRAY_AGG(DISTINCT "hostname" ORDER BY "hostname") AS "hostnames",
        COALESCE(SUM(EXTRACT(EPOCH FROM ("endedAt" - "startedAt"))), 0)::int AS "totalSeconds",
        COALESCE(SUM(CASE WHEN "sourceType"='WEB' THEN EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) ELSE 0 END), 0)::int AS "webSeconds",
        COALESCE(SUM(CASE WHEN "sourceType"='APP' THEN EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) ELSE 0 END), 0)::int AS "appSeconds",
        COALESCE(SUM(CASE WHEN "sourceType"='IDLE' THEN EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) ELSE 0 END), 0)::int AS "idleSeconds",
        COALESCE(SUM(CASE WHEN "sourceType"='LOCKED' THEN EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) ELSE 0 END), 0)::int AS "lockedSeconds",
        COUNT(DISTINCT "domain")::int AS "uniqueDomains", MAX("endedAt") AS "lastActivityAt",
        COUNT(*) OVER()::int AS "agentsFound"
      FROM filtered_activity
      GROUP BY "agentKey" ${nameFilter} ORDER BY "totalSeconds" DESC, "employeeName" ASC LIMIT 1000
  )` : Prisma.empty;
  const rankingsQuery = query.view === "agent" ? Prisma.sql`, ranking_totals AS (
      SELECT "sourceType" AS "rankKind",
        CASE WHEN "sourceType"='WEB' THEN "domain" ELSE "applicationName" END AS "label",
        SUM(EXTRACT(EPOCH FROM ("endedAt" - "startedAt")))::int AS "seconds"
      FROM filtered_activity WHERE "sourceType" IN ('WEB', 'APP')
      GROUP BY "sourceType", CASE WHEN "sourceType"='WEB' THEN "domain" ELSE "applicationName" END
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY "rankKind" ORDER BY "seconds" DESC, "label" ASC) AS "rankPosition"
      FROM ranking_totals WHERE "label" IS NOT NULL
    ), ranking_results AS (
      SELECT "rankKind", "label", "seconds" FROM ranked WHERE "rankPosition" <= 100
  )` : Prisma.empty;
  const timelineQuery = paged ? activityTimelinePageSql(pageSize, cursor) : includeTimeline ? Prisma.sql`, timeline AS (
      SELECT * FROM filtered_activity
      ORDER BY "sourceStartedAt" ASC, "hostname" ASC, "id" ASC LIMIT ${limit}
  )` : Prisma.empty;

  const [result] = await prisma.$queryRaw<ActivityQueryResult[]>(Prisma.sql`
    WITH clipped_activity AS MATERIALIZED (${baseActivityQuery}),
    filtered_activity AS (SELECT * FROM clipped_activity ${filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.empty}),
    summary AS (${summaryQuery})
    ${agentsQuery} ${rankingsQuery} ${timelineQuery}
    SELECT (SELECT to_jsonb(summary) FROM summary) AS "summary",
      ${overview ? Prisma.sql`(SELECT COALESCE(jsonb_agg(options), '[]'::jsonb) FROM (SELECT DISTINCT "lob", "shift" FROM clipped_activity) options)` : Prisma.sql`'[]'::jsonb`} AS "filterOptions",
      ${overview ? Prisma.sql`(SELECT COALESCE(jsonb_agg(to_jsonb(agent_totals) ORDER BY "totalSeconds" DESC, "employeeName" ASC), '[]'::jsonb) FROM agent_totals)` : Prisma.sql`'[]'::jsonb`} AS "agents",
      ${query.view === "agent" ? Prisma.sql`(SELECT COALESCE(jsonb_agg(to_jsonb(ranking_results) ORDER BY "rankKind", "seconds" DESC, "label" ASC), '[]'::jsonb) FROM ranking_results)` : Prisma.sql`'[]'::jsonb`} AS "rankings",
      ${paged ? Prisma.sql`(SELECT COUNT(*)::int FROM timeline_merged)` : Prisma.sql`NULL::int`} AS "timelineGroups",
      ${paged ? Prisma.sql`(SELECT COALESCE(jsonb_agg(payload ORDER BY "sourceStartedAt", "hostname", "id"), '[]'::jsonb) FROM timeline)` : includeTimeline ? Prisma.sql`(SELECT COALESCE(jsonb_agg(to_jsonb(timeline) - 'sourceStartedAt' ORDER BY "sourceStartedAt" ASC, "hostname" ASC, "id" ASC), '[]'::jsonb) FROM timeline)` : Prisma.sql`'[]'::jsonb`} AS "rows"
  `);
  const summary = result?.summary ?? emptySummary();
  const agentRows = (result?.agents ?? []).map((row) => ({ ...row, lastActivityAt: activityTimestamp(row.lastActivityAt) }));
  const rankings = result?.rankings ?? [];
  const returnedRows = result?.rows ?? [];
  const hasMore = paged && returnedRows.length > pageSize;
  const pageRows = paged ? returnedRows.slice(0, pageSize) : returnedRows;
  const lastRow = pageRows.at(-1);
  const nextCursor = hasMore && lastRow?.sourceStartedAt ? encodeActivityTimelineCursor({
    at: activityTimestamp(lastRow.sourceStartedAt).toISOString(), hostname: lastRow.hostname, id: lastRow.id, scope: cursorScope
  }) : null;
  const sourceRecordsReturned = pageRows.reduce((sum, row) => sum + (paged ? row.mergedSourceRecords ?? 1 : 1), 0);
  const rawRows: ActivityRawRow[] = pageRows.map(({ sourceStartedAt: _cursorAt, mergedSourceRecords: _mergedCount, ...row }) => ({
    ...row, capturedAt: activityTimestamp(row.capturedAt),
    startedAt: activityTimestamp(row.startedAt), endedAt: activityTimestamp(row.endedAt)
  }));
  const rows = rawRows.map((row) => ({ ...row, durationSeconds: intervalSeconds(row.startedAt, row.endedAt) }));
  const mergedRows = mergeActivityRows(rows).map((row) => ({
    ...row, capturedAt: row.capturedAt.toISOString(), startedAt: row.startedAt.toISOString(), endedAt: row.endedAt.toISOString(),
    employeeName: row.employeeName || row.wbLogin || row.windowsUser || row.hostname,
    lob: row.lob || "Sem LOB", supervisor: row.supervisor || "Sem supervisor"
  }));
  return {
    success: true, date: dateKey, agentKey: selectedAgent || null,
    filters: { lob: lobFilter, shift: shiftFilter },
    filterOptions: {
      lobs: Array.from(new Set((result?.filterOptions ?? []).map((item) => item.lob || "Sem LOB"))).sort((a, b) => a.localeCompare(b, "pt-BR")),
      shifts: Array.from(new Set((result?.filterOptions ?? []).map((item) => shiftCategoryName(item.shift) || "Sem turno"))).sort((a, b) => a.localeCompare(b, "pt-BR"))
    },
    window: { start: start.toISOString(), end: end.toISOString() }, summary,
    agents: agentRows.map(({ agentsFound: _count, ...agent }) => ({ ...agent, lastActivityAt: agent.lastActivityAt.toISOString() })),
    agentsFound: agentRows[0]?.agentsFound ?? 0,
    agentsTruncated: (agentRows[0]?.agentsFound ?? 0) > agentRows.length,
    topDomains: rankings.filter((item) => item.rankKind === "WEB").map(({ label, seconds }) => ({ label, seconds })),
    topApplications: rankings.filter((item) => item.rankKind === "APP").map(({ label, seconds }) => ({ label, seconds })),
    rows: mergedRows, recordsReturned: mergedRows.length, sourceRecordsReturned, limit,
    timelineIncluded: includeTimeline,
    ...(paged ? { pagination: { cursor: query.cursor ?? null, nextCursor, hasMore, pageSize, totalGroups: result?.timelineGroups ?? 0 } } : {}),
    truncated: paged ? hasMore : includeTimeline && summary.rowCount > rawRows.length,
    privacy: "Somente domínio, aplicativo e intervalo são coletados."
  };
}

export async function requireActivityViewer(actor: Actor) {
  const viewer = await prisma.user.findUnique({
    where: { email: actor.email },
    select: activityViewerSelect
  });
  if (!viewer || viewer.status !== UserStatus.ACTIVE || viewer.deletedAt) {
    return { success: false, error: "Usuário sem acesso ativo.", message: "Usuário sem acesso ativo.", status: 403 } as const;
  }
  if (!canAccessRealtimeHoursActivity({
    role: viewer.role.name,
    email: viewer.email,
    name: viewer.name,
    roleTitle: viewer.employeeProfile?.roleTitle,
    status: viewer.status
  })) {
    return {
      success: false,
      error: "Você não tem permissão para acessar atividade de sites e aplicativos.",
      message: "Você não tem permissão para acessar atividade de sites e aplicativos.",
      status: 403
    } as const;
  }
  return { success: true, viewer } as const;
}

export async function visibleEmployeeIdsForViewer(viewer: ActivityViewer): Promise<string[] | null> {
  if (normalizeAccessRole(viewer.role.name) !== "SUPERVISOR") return null;
  if (!viewer.employeeProfile?.id) return [];
  const employees = await prisma.employeeProfile.findMany({
    where: { deletedAt: null, supervisorId: viewer.employeeProfile.id },
    select: { id: true }
  });
  return employees.map((employee) => employee.id);
}

function mergeActivityRows(rows: ActivityRow[]) {
  const merged: ActivityRow[] = [];
  for (const row of rows) {
    const previous = merged.at(-1);
    const sameContext = previous
      && activityIdentityKey(previous) === activityIdentityKey(row)
      && previous.sourceType === row.sourceType
      && (previous.applicationName ?? "") === (row.applicationName ?? "")
      && (previous.domain ?? "") === (row.domain ?? "")
      && row.startedAt.getTime() - previous.endedAt.getTime() <= mergeGapSeconds * 1_000;
    if (!sameContext || !previous) {
      merged.push({ ...row });
      continue;
    }
    if (row.endedAt > previous.endedAt) previous.endedAt = row.endedAt;
    if (row.capturedAt > previous.capturedAt) previous.capturedAt = row.capturedAt;
    previous.durationSeconds = intervalSeconds(previous.startedAt, previous.endedAt);
  }
  return merged;
}

function activityIdentityKey(row: Pick<ActivityRow, "agentKey">) {
  return row.agentKey;
}

function activityTimestamp(value: string) {
  // PostgreSQL's timestamp-without-time-zone JSON omits the UTC suffix; Prisma
  // normally supplies it when decoding a top-level timestamp column.
  return new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`);
}

function intervalSeconds(startedAt: Date, endedAt: Date) {
  return Math.max(1, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1_000));
}

function normalizeDomain(value: unknown) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (/^(chrome|edge|about|file|data|view-source|moz-extension|chrome-extension):/i.test(raw)) return null;
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(candidate);
    let hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (hostname.startsWith("www.")) hostname = hostname.slice(4);
    if (!hostname || hostname.length > 253 || !/^[a-z0-9.-]+$/i.test(hostname)) return null;
    return hostname;
  } catch {
    return null;
  }
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function emptySummary(): ActivitySummaryRow {
  return {
    rowCount: 0,
    employees: 0,
    totalSeconds: 0,
    webSeconds: 0,
    appSeconds: 0,
    idleSeconds: 0,
    lockedSeconds: 0,
    privateSeconds: 0,
    unknownSeconds: 0,
    uniqueDomains: 0
  };
}
