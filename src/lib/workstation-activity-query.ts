import { Prisma, UserStatus } from "@prisma/client";

import { normalizeAccessRole } from "@/lib/access-control";
import type { Actor } from "@/lib/mock-db";
import { prisma } from "@/lib/prisma";
import { canAccessRealtimeHoursActivity } from "@/lib/realtime-hours-permissions";
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

type ActivityViewer = Prisma.UserGetPayload<{
  include: { role: true; employeeProfile: true };
}>;

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

  if (selectedAgent) conditions.push(Prisma.sql`${agentKeySql} = ${selectedAgent}`);

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

  const where = Prisma.join(conditions, " AND ");
  const baseActivityQuery = Prisma.sql`
    SELECT
      ${agentKeySql} AS "agentKey",
      activity."id",
      activity."eventId",
      activity."source",
      activity."capturedAt",
      activity."hostname",
      activity."windowsUser",
      activity."wbLogin",
      activity."employeeId",
      activity."sourceType",
      activity."applicationName",
      activity."domain",
      GREATEST(activity."startedAt", ${start}) AS "startedAt",
      LEAST(activity."endedAt", ${end}) AS "endedAt",
      activity."agentVersion",
      employee."fullName" AS "employeeName",
      lob."name" AS "lob",
      supervisor."fullName" AS "supervisor"
    FROM "agent_activity"."WorkstationActivitySegment" activity
    LEFT JOIN public."EmployeeProfile" employee ON employee."id" = activity."employeeId"
    LEFT JOIN public."Lob" lob ON lob."id" = employee."lobId"
    LEFT JOIN public."EmployeeProfile" supervisor ON supervisor."id" = employee."supervisorId"
    WHERE ${where}
  `;

  const overview = query.view === "overview";
  const agentSearch = String(query.agentSearch ?? "").trim().slice(0, 120);
  const nameFilter = agentSearch ? Prisma.sql`HAVING BOOL_OR(COALESCE("employeeName", '') ILIKE ${`%${agentSearch}%`}
    OR COALESCE("wbLogin", '') ILIKE ${`%${agentSearch}%`}
    OR COALESCE("windowsUser", '') ILIKE ${`%${agentSearch}%`}
    OR "hostname" ILIKE ${`%${agentSearch}%`})` : Prisma.empty;

  const [rawRows, summaries, agentRows, rankings] = await Promise.all([
    overview ? Promise.resolve([] as ActivityRawRow[]) : prisma.$queryRaw<ActivityRawRow[]>(Prisma.sql`
      ${baseActivityQuery}
      ORDER BY activity."startedAt" ASC, activity."hostname" ASC
      LIMIT ${limit}
    `),
    prisma.$queryRaw<ActivitySummaryRow[]>(Prisma.sql`
      WITH clipped_activity AS (${baseActivityQuery})
      SELECT COUNT(*)::int AS "rowCount", COUNT(DISTINCT "agentKey")::int AS "employees",
        COALESCE(SUM(EXTRACT(EPOCH FROM ("endedAt" - "startedAt"))), 0)::int AS "totalSeconds",
        COALESCE(SUM(CASE WHEN "sourceType" = 'WEB' THEN EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) ELSE 0 END), 0)::int AS "webSeconds",
        COALESCE(SUM(CASE WHEN "sourceType" = 'APP' THEN EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) ELSE 0 END), 0)::int AS "appSeconds",
        COALESCE(SUM(CASE WHEN "sourceType" = 'IDLE' THEN EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) ELSE 0 END), 0)::int AS "idleSeconds",
        COALESCE(SUM(CASE WHEN "sourceType" = 'LOCKED' THEN EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) ELSE 0 END), 0)::int AS "lockedSeconds",
        COALESCE(SUM(CASE WHEN "sourceType" = 'PRIVATE' THEN EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) ELSE 0 END), 0)::int AS "privateSeconds",
        COALESCE(SUM(CASE WHEN "sourceType" = 'UNKNOWN' THEN EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) ELSE 0 END), 0)::int AS "unknownSeconds",
        (COUNT(DISTINCT "domain") FILTER (WHERE "domain" IS NOT NULL))::int AS "uniqueDomains"
      FROM clipped_activity
    `),
    overview ? prisma.$queryRaw<AgentAggregate[]>(Prisma.sql`
      WITH clipped_activity AS (${baseActivityQuery})
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
      FROM clipped_activity
      GROUP BY "agentKey" ${nameFilter} ORDER BY "totalSeconds" DESC, "employeeName" ASC LIMIT 1000
    `) : Promise.resolve([] as AgentAggregate[]),
    query.view === "agent" ? prisma.$queryRaw<RankingAggregate[]>(Prisma.sql`
      WITH clipped_activity AS (${baseActivityQuery}), totals AS (
        SELECT "sourceType" AS "rankKind",
          CASE WHEN "sourceType"='WEB' THEN "domain" ELSE "applicationName" END AS "label",
          SUM(EXTRACT(EPOCH FROM ("endedAt" - "startedAt")))::int AS "seconds"
        FROM clipped_activity WHERE "sourceType" IN ('WEB', 'APP')
        GROUP BY "sourceType", CASE WHEN "sourceType"='WEB' THEN "domain" ELSE "applicationName" END
      ), ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY "rankKind" ORDER BY "seconds" DESC, "label" ASC) AS "rankPosition"
        FROM totals WHERE "label" IS NOT NULL
      ) SELECT "rankKind", "label", "seconds" FROM ranked WHERE "rankPosition" <= 100 ORDER BY "rankKind", "seconds" DESC, "label" ASC
    `) : Promise.resolve([] as RankingAggregate[])
  ]);

  const summary = summaries[0] ?? emptySummary();
  const rows = rawRows.map((row) => ({ ...row, durationSeconds: intervalSeconds(row.startedAt, row.endedAt) }));
  const mergedRows = mergeActivityRows(rows).map((row) => ({
    ...row, capturedAt: row.capturedAt.toISOString(), startedAt: row.startedAt.toISOString(), endedAt: row.endedAt.toISOString(),
    employeeName: row.employeeName || row.wbLogin || row.windowsUser || row.hostname,
    lob: row.lob || "Sem LOB", supervisor: row.supervisor || "Sem supervisor"
  }));
  return {
    success: true, date: dateKey, agentKey: selectedAgent || null,
    window: { start: start.toISOString(), end: end.toISOString() }, summary,
    agents: agentRows.map(({ agentsFound: _count, ...agent }) => ({ ...agent, lastActivityAt: agent.lastActivityAt.toISOString() })),
    agentsFound: agentRows[0]?.agentsFound ?? 0,
    agentsTruncated: (agentRows[0]?.agentsFound ?? 0) > agentRows.length,
    topDomains: rankings.filter((item) => item.rankKind === "WEB").map(({ label, seconds }) => ({ label, seconds })),
    topApplications: rankings.filter((item) => item.rankKind === "APP").map(({ label, seconds }) => ({ label, seconds })),
    rows: mergedRows, recordsReturned: mergedRows.length, sourceRecordsReturned: rawRows.length, limit,
    truncated: !overview && summary.rowCount > rawRows.length,
    privacy: "Somente domínio, aplicativo e intervalo são coletados."
  };
}

async function requireActivityViewer(actor: Actor) {
  const viewer = await prisma.user.findUnique({
    where: { email: actor.email },
    include: { role: true, employeeProfile: true }
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

async function visibleEmployeeIdsForViewer(viewer: ActivityViewer): Promise<string[] | null> {
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
