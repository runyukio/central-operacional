import { randomUUID } from "crypto";

import { Prisma, UserStatus } from "@prisma/client";
import { z } from "zod";

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
const maxRecordsPerImport = 500;
const defaultQueryLimit = 1_500;
const maxQueryLimit = 5_000;
const mergeGapSeconds = 15;

const optionalString = (max: number) => z.preprocess((value) => {
  if (value === null || typeof value === "undefined") return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}, z.string().max(max).optional());

const activityRecordSchema = z.object({
  eventId: z.string().trim().min(8).max(160),
  hostname: z.string().trim().min(1).max(120),
  windowsUser: optionalString(120),
  wbLogin: optionalString(120),
  employeeId: optionalString(120),
  sourceType: z.preprocess((value) => String(value ?? "").trim().toUpperCase(), z.enum(activitySourceTypes)),
  applicationName: optionalString(120),
  domain: optionalString(300),
  startedAt: z.string().trim().min(1).max(80),
  endedAt: z.string().trim().min(1).max(80),
  durationSeconds: z.coerce.number().int().min(1).max(86_400),
  agentVersion: optionalString(40)
}).passthrough();

const activityPayloadSchema = z.object({
  source: optionalString(80),
  capturedAt: z.string().trim().min(1).max(80),
  records: z.array(activityRecordSchema).min(1).max(maxRecordsPerImport)
}).passthrough();

type ActivitySourceType = (typeof activitySourceTypes)[number];

type NormalizedActivityRecord = {
  id: string;
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
  durationSeconds: number;
  agentVersion: string | null;
};

type ActivityDbRow = NormalizedActivityRecord & {
  employeeName: string | null;
  lob: string | null;
  supervisor: string | null;
};

type ActivitySummaryDbRow = {
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
};

export async function importWorkstationActivity(input: unknown) {
  const parsed = activityPayloadSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Payload inválido para atividade da estação.",
      message: "Payload inválido para atividade da estação.",
      details: parsed.error.issues.map((issue) => issue.message),
      status: 400
    };
  }

  const capturedAt = parseDate(parsed.data.capturedAt);
  if (!capturedAt || capturedAt.getTime() > Date.now() + 5 * 60_000) {
    return {
      success: false,
      error: "capturedAt inválido ou adiantado mais de 5 minutos.",
      message: "capturedAt inválido ou adiantado mais de 5 minutos.",
      status: 400
    };
  }

  const source = parsed.data.source ?? "direct-windows-agent";
  const rowErrors: Array<{ rowNumber: number; error: string }> = [];
  const records: NormalizedActivityRecord[] = [];

  parsed.data.records.forEach((raw, index) => {
    const startedAt = parseDate(raw.startedAt);
    const endedAt = parseDate(raw.endedAt);
    if (!startedAt || !endedAt || endedAt <= startedAt) {
      rowErrors.push({ rowNumber: index + 1, error: "Intervalo de atividade inválido." });
      return;
    }
    if (endedAt.getTime() > Date.now() + 5 * 60_000) {
      rowErrors.push({ rowNumber: index + 1, error: "Fim do intervalo adiantado mais de 5 minutos." });
      return;
    }

    const computedDuration = Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 1_000));
    if (computedDuration > 86_400) {
      rowErrors.push({ rowNumber: index + 1, error: "O intervalo excede 24 horas." });
      return;
    }

    const domain = normalizeDomain(raw.domain);
    if (raw.sourceType === "WEB" && !domain) {
      rowErrors.push({ rowNumber: index + 1, error: "Domínio inválido para atividade WEB." });
      return;
    }

    records.push({
      id: randomUUID(),
      eventId: raw.eventId,
      source,
      capturedAt,
      hostname: raw.hostname.trim(),
      windowsUser: normalizeNullable(raw.windowsUser),
      wbLogin: normalizeLogin(raw.wbLogin),
      employeeId: normalizeNullable(raw.employeeId),
      sourceType: raw.sourceType,
      applicationName: normalizeApplicationName(raw.applicationName),
      domain: raw.sourceType === "WEB" ? domain : null,
      startedAt,
      endedAt,
      durationSeconds: computedDuration,
      agentVersion: normalizeNullable(raw.agentVersion)
    });
  });

  if (!records.length) {
    return {
      success: false,
      error: "Nenhum intervalo válido para importar.",
      message: "Nenhum intervalo válido para importar.",
      status: 400,
      rowsProcessed: parsed.data.records.length,
      rowsValid: 0,
      rowsError: rowErrors.length,
      errors: rowErrors.slice(0, 50)
    };
  }

  const resolvedRecords = await resolveActivityIdentities(records);
  const values = resolvedRecords.map((record) => Prisma.sql`(
    ${record.id}, ${record.eventId}, ${record.source}, ${record.capturedAt},
    ${record.hostname}, ${record.windowsUser}, ${record.wbLogin}, ${record.employeeId},
    ${record.sourceType}, ${record.applicationName}, ${record.domain},
    ${record.startedAt}, ${record.endedAt}, ${record.durationSeconds}, ${record.agentVersion}
  )`);

  const affectedRows = await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "agent_activity"."WorkstationActivitySegment" AS current_activity (
      "id", "eventId", "source", "capturedAt", "hostname", "windowsUser", "wbLogin", "employeeId",
      "sourceType", "applicationName", "domain", "startedAt", "endedAt", "durationSeconds", "agentVersion"
    )
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("eventId") DO UPDATE SET
      "capturedAt" = GREATEST(current_activity."capturedAt", EXCLUDED."capturedAt"),
      "endedAt" = GREATEST(current_activity."endedAt", EXCLUDED."endedAt"),
      "durationSeconds" = GREATEST(current_activity."durationSeconds", EXCLUDED."durationSeconds"),
      "employeeId" = COALESCE(EXCLUDED."employeeId", current_activity."employeeId"),
      "wbLogin" = COALESCE(EXCLUDED."wbLogin", current_activity."wbLogin"),
      "windowsUser" = COALESCE(EXCLUDED."windowsUser", current_activity."windowsUser"),
      "applicationName" = COALESCE(EXCLUDED."applicationName", current_activity."applicationName"),
      "domain" = COALESCE(EXCLUDED."domain", current_activity."domain"),
      "agentVersion" = COALESCE(EXCLUDED."agentVersion", current_activity."agentVersion"),
      "updatedAt" = CURRENT_TIMESTAMP
  `);

  const retentionDays = boundedInteger(process.env.REALTIME_HOURS_ACTIVITY_RETENTION_DAYS, 7, 1, 90);
  const retentionCutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1_000);
  await prisma.$executeRaw(Prisma.sql`
    DELETE FROM "agent_activity"."WorkstationActivitySegment"
    WHERE "endedAt" < ${retentionCutoff}
  `).catch(() => undefined);

  return {
    success: true,
    source,
    capturedAt: capturedAt.toISOString(),
    rowsProcessed: parsed.data.records.length,
    rowsValid: resolvedRecords.length,
    rowsError: rowErrors.length,
    rowsAffected: affectedRows,
    importedAt: new Date().toISOString(),
    retentionDays,
    errors: rowErrors.slice(0, 50)
  };
}

export async function getWorkstationActivity(actor: Actor, query: WorkstationActivityQuery = {}) {
  const viewerResult = await requireActivityViewer(actor);
  if ("error" in viewerResult) return viewerResult;
  const viewer = viewerResult.viewer;

  const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(query.date ?? ""))
    ? String(query.date)
    : saoPauloDateKey(new Date());
  const start = startOfSaoPauloDate(dateKey);
  const end = startOfSaoPauloDate(addDateKeyDays(dateKey, 1));
  const limit = boundedInteger(query.limit, defaultQueryLimit, 100, maxQueryLimit);
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
  const rows = await prisma.$queryRaw<ActivityDbRow[]>(Prisma.sql`
    SELECT
      activity."id", activity."eventId", activity."source", activity."capturedAt",
      activity."hostname", activity."windowsUser", activity."wbLogin", activity."employeeId",
      activity."sourceType", activity."applicationName", activity."domain",
      GREATEST(activity."startedAt", ${start}) AS "startedAt",
      LEAST(activity."endedAt", ${end}) AS "endedAt",
      GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (
        LEAST(activity."endedAt", ${end}) - GREATEST(activity."startedAt", ${start})
      )))::int AS "durationSeconds",
      activity."agentVersion",
      employee."fullName" AS "employeeName",
      lob."name" AS "lob",
      supervisor."fullName" AS "supervisor"
    FROM "agent_activity"."WorkstationActivitySegment" activity
    LEFT JOIN public."EmployeeProfile" employee ON employee."id" = activity."employeeId"
    LEFT JOIN public."Lob" lob ON lob."id" = employee."lobId"
    LEFT JOIN public."EmployeeProfile" supervisor ON supervisor."id" = employee."supervisorId"
    WHERE ${where}
    ORDER BY activity."startedAt" ASC, activity."hostname" ASC
    LIMIT ${limit}
  `);

  const [summary = emptySummaryDbRow()] = await prisma.$queryRaw<ActivitySummaryDbRow[]>(Prisma.sql`
    SELECT
      COUNT(*)::int AS "rowCount",
      COUNT(DISTINCT COALESCE(activity."employeeId", activity."wbLogin", activity."hostname"))::int AS "employees",
      COALESCE(SUM(GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (LEAST(activity."endedAt", ${end}) - GREATEST(activity."startedAt", ${start}))))::int)), 0)::int AS "totalSeconds",
      COALESCE(SUM(CASE WHEN activity."sourceType" = 'WEB' THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (LEAST(activity."endedAt", ${end}) - GREATEST(activity."startedAt", ${start}))))::int) ELSE 0 END), 0)::int AS "webSeconds",
      COALESCE(SUM(CASE WHEN activity."sourceType" = 'APP' THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (LEAST(activity."endedAt", ${end}) - GREATEST(activity."startedAt", ${start}))))::int) ELSE 0 END), 0)::int AS "appSeconds",
      COALESCE(SUM(CASE WHEN activity."sourceType" = 'IDLE' THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (LEAST(activity."endedAt", ${end}) - GREATEST(activity."startedAt", ${start}))))::int) ELSE 0 END), 0)::int AS "idleSeconds",
      COALESCE(SUM(CASE WHEN activity."sourceType" = 'LOCKED' THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (LEAST(activity."endedAt", ${end}) - GREATEST(activity."startedAt", ${start}))))::int) ELSE 0 END), 0)::int AS "lockedSeconds",
      COALESCE(SUM(CASE WHEN activity."sourceType" = 'PRIVATE' THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (LEAST(activity."endedAt", ${end}) - GREATEST(activity."startedAt", ${start}))))::int) ELSE 0 END), 0)::int AS "privateSeconds",
      COALESCE(SUM(CASE WHEN activity."sourceType" = 'UNKNOWN' THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (LEAST(activity."endedAt", ${end}) - GREATEST(activity."startedAt", ${start}))))::int) ELSE 0 END), 0)::int AS "unknownSeconds",
      COUNT(DISTINCT activity."domain") FILTER (WHERE activity."domain" IS NOT NULL)::int AS "uniqueDomains"
    FROM "agent_activity"."WorkstationActivitySegment" activity
    LEFT JOIN public."EmployeeProfile" employee ON employee."id" = activity."employeeId"
    WHERE ${where}
  `);

  const mergedRows = mergeActivityRows(rows).map((row) => ({
    ...row,
    capturedAt: row.capturedAt.toISOString(),
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt.toISOString(),
    employeeName: row.employeeName || row.wbLogin || row.windowsUser || row.hostname,
    lob: row.lob || "Sem LOB",
    supervisor: row.supervisor || "Sem supervisor"
  }));

  return {
    success: true,
    date: dateKey,
    window: { start: start.toISOString(), end: end.toISOString() },
    summary,
    rows: mergedRows,
    recordsReturned: mergedRows.length,
    sourceRecordsReturned: rows.length,
    limit,
    truncated: summary.rowCount > rows.length,
    privacy: "A Central armazena somente domínio, aplicativo e intervalo. URL completa, conteúdo, texto digitado e captura de tela não são coletados."
  };
}

async function resolveActivityIdentities(records: NormalizedActivityRecord[]) {
  const employeeIds = unique(records.map((record) => record.employeeId));
  const wbLogins = unique(records.map((record) => record.wbLogin));
  const employees = employeeIds.length || wbLogins.length
    ? await prisma.employeeProfile.findMany({
      where: {
        deletedAt: null,
        OR: [
          ...(employeeIds.length ? [{ id: { in: employeeIds } }] : []),
          ...(wbLogins.length ? [{ wbLogin: { in: wbLogins, mode: "insensitive" as const } }] : [])
        ]
      },
      select: { id: true, wbLogin: true }
    })
    : [];
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const employeeByWb = new Map(employees.map((employee) => [normalizeLogin(employee.wbLogin) as string, employee]));

  const pairs = uniquePairs(records.map((record) => ({ hostname: record.hostname, windowsUser: record.windowsUser })));
  const mappings = pairs.length
    ? await prisma.realTimeHoursIdentityMapping.findMany({
      where: {
        OR: pairs.map((pair) => ({
          hostname: { equals: pair.hostname, mode: "insensitive" },
          windowsUser: { equals: pair.windowsUser, mode: "insensitive" }
        }))
      },
      select: {
        hostname: true,
        windowsUser: true,
        wbLogin: true,
        employeeId: true,
        employee: { select: { id: true, wbLogin: true } }
      }
    })
    : [];
  const mappingByPair = new Map(mappings.map((mapping) => [
    identityPairKey(mapping.hostname, mapping.windowsUser), mapping
  ]));

  return records.map((record) => {
    const directEmployee = (record.employeeId ? employeeById.get(record.employeeId) : null)
      ?? (record.wbLogin ? employeeByWb.get(record.wbLogin) : null);
    if (directEmployee) {
      return { ...record, employeeId: directEmployee.id, wbLogin: normalizeLogin(directEmployee.wbLogin) };
    }

    const mapping = record.windowsUser
      ? mappingByPair.get(identityPairKey(record.hostname, record.windowsUser))
      : null;
    if (!mapping) return record;
    return {
      ...record,
      employeeId: mapping.employee?.id ?? mapping.employeeId ?? null,
      wbLogin: normalizeLogin(mapping.employee?.wbLogin ?? mapping.wbLogin) ?? record.wbLogin
    };
  });
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

function mergeActivityRows(rows: ActivityDbRow[]) {
  const merged: ActivityDbRow[] = [];
  for (const row of rows) {
    const previous = merged.length ? merged[merged.length - 1] : null;
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
    previous.durationSeconds = Math.max(1, Math.round((previous.endedAt.getTime() - previous.startedAt.getTime()) / 1_000));
  }
  return merged;
}

function activityIdentityKey(row: Pick<ActivityDbRow, "employeeId" | "wbLogin" | "windowsUser" | "hostname">) {
  return row.employeeId || row.wbLogin || `${row.hostname}|${row.windowsUser ?? ""}`;
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

function normalizeApplicationName(value: unknown) {
  const normalized = normalizeNullable(value);
  return normalized ? normalized.replace(/\.exe$/i, "").slice(0, 120) : null;
}

function normalizeLogin(value: unknown) {
  const normalized = normalizeNullable(value)?.toLowerCase() ?? null;
  return normalized?.includes("\\") ? normalized.split("\\").pop() ?? null : normalized;
}

function normalizeNullable(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function parseDate(value: unknown) {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function unique(values: Array<string | null>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function uniquePairs(pairs: Array<{ hostname: string; windowsUser: string | null }>) {
  const result = new Map<string, { hostname: string; windowsUser: string }>();
  for (const pair of pairs) {
    if (!pair.windowsUser) continue;
    result.set(identityPairKey(pair.hostname, pair.windowsUser), { hostname: pair.hostname, windowsUser: pair.windowsUser });
  }
  return Array.from(result.values());
}

function identityPairKey(hostname: string, windowsUser: string) {
  return `${hostname.trim().toLowerCase()}|${windowsUser.trim().toLowerCase()}`;
}

function emptySummaryDbRow(): ActivitySummaryDbRow {
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
