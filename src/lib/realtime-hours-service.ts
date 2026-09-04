import { createHash, timingSafeEqual } from "crypto";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { logPerformanceMetric } from "@/lib/performance-logger";
import { canAccessRealtimeHoursCapture, canManageRealtimeHoursMappings } from "@/lib/realtime-hours-permissions";
import { prisma } from "@/lib/prisma";
import {
  addDateKeyDays,
  buildRealtimeHoursPlannedShifts,
  buildRealtimeHoursSlotAssignmentWindows,
  matchRealtimeHoursPlannedShift,
  realtimeHoursArchiveThroughDate,
  realtimeHoursRawDeleteBefore,
  saoPauloDateKey,
  startOfSaoPauloDate,
  type RealtimeHoursPlannedShift,
  type RealtimeHoursScheduleSlot,
  type RealtimeHoursSlotAssignmentWindow
} from "@/lib/realtime-hours-timeline";

const defaultSource = "local-windows-server";
const defaultStatusLimit = 200;
const maxStatusLimit = 1000;
const defaultImportsLimit = 30;
const maxImportsLimit = 100;
const maxRecordsPerImport = Number.parseInt(process.env.REALTIME_HOURS_MAX_RECORDS_PER_IMPORT ?? "1000", 10) || 1000;
const staleThresholdMinutes = Number.parseInt(process.env.REALTIME_HOURS_STALE_MINUTES ?? "15", 10) || 15;
const configuredIdleThresholdSeconds = Number.parseInt(process.env.REALTIME_HOURS_IDLE_SECONDS ?? "600", 10);
const idleThresholdSeconds = Number.isFinite(configuredIdleThresholdSeconds)
  ? Math.max(600, configuredIdleThresholdSeconds)
  : 600;
const configuredActivityIdleThresholdSeconds = Number.parseInt(process.env.REALTIME_HOURS_ACTIVITY_IDLE_SECONDS ?? "900", 10);
const activityIdleThresholdSeconds = Number.isFinite(configuredActivityIdleThresholdSeconds)
  ? Math.max(900, configuredActivityIdleThresholdSeconds)
  : 900;
const legacyTimelineHeartbeatMinutes = Number.parseInt(process.env.REALTIME_HOURS_TIMELINE_HEARTBEAT_MINUTES ?? "", 10);
const legacyTimelineMaxGapMinutes = Number.parseInt(process.env.REALTIME_HOURS_TIMELINE_MAX_GAP_MINUTES ?? "", 10);
const timelineHeartbeatSeconds = Number.parseInt(process.env.REALTIME_HOURS_TIMELINE_HEARTBEAT_SECONDS ?? "", 10)
  || (Number.isFinite(legacyTimelineHeartbeatMinutes) ? legacyTimelineHeartbeatMinutes * 60 : 120);
const timelineMaxGapSeconds = Number.parseInt(process.env.REALTIME_HOURS_TIMELINE_MAX_GAP_SECONDS ?? "", 10)
  || (Number.isFinite(legacyTimelineMaxGapMinutes) ? legacyTimelineMaxGapMinutes * 60 : 180);
const configuredRetentionDays = Number.parseInt(process.env.REALTIME_HOURS_RAW_RETENTION_DAYS ?? "7", 10);
const retentionDays = Number.isFinite(configuredRetentionDays)
  ? Math.min(730, Math.max(7, configuredRetentionDays))
  : 7;
const configuredArchiveDaysPerRun = Number.parseInt(process.env.REALTIME_HOURS_ARCHIVE_DAYS_PER_RUN ?? "2", 10);
const archiveDaysPerRun = Number.isFinite(configuredArchiveDaysPerRun)
  ? Math.min(7, Math.max(1, configuredArchiveDaysPerRun))
  : 2;
const configuredRetentionDeleteLimit = Number.parseInt(process.env.REALTIME_HOURS_RETENTION_DELETE_LIMIT ?? "20000", 10);
const retentionDeleteLimit = Number.isFinite(configuredRetentionDeleteLimit)
  ? Math.min(100_000, Math.max(1_000, configuredRetentionDeleteLimit))
  : 20_000;
const identityConfidences = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;
const realtimeHoursEventTypes = ["SESSION_START", "SESSION_RESUME", "HEARTBEAT", "SESSION_END"] as const;

export type RealtimeHoursPresenceStatus = "ONLINE" | "IDLE" | "LOCKED" | "OFFLINE";

type RealtimeHoursPresenceRecord = {
  capturedAt: Date;
  isSessionActive: boolean;
  sessionState: string | null;
  idleSeconds: number | null;
};

type RealtimeHoursRowError = {
  rowNumber: number;
  error: string;
};

type NormalizedRealtimeHoursRecord = {
  eventId: string | null;
  eventType: string | null;
  sessionId: number | null;
  sessionState: string | null;
  capturedAt: Date;
  hostname: string;
  windowsUser: string | null;
  wbLogin: string | null;
  employeeId: string | null;
  ipAddress: string | null;
  isSessionActive: boolean;
  isInputActive: boolean | null;
  idleSeconds: number | null;
  lastActivityAt: Date | null;
  activeProcessName: string | null;
  activeWindowTitle: string | null;
  identitySource: string | null;
  identityConfidence: string;
  agentVersion: string | null;
  rawData: Prisma.InputJsonValue;
};

type NormalizeRecordResult = { record: NormalizedRealtimeHoursRecord } | { error: RealtimeHoursRowError };

type RealtimeHoursStatusOptions = {
  limit?: string | number | null;
};

type RealtimeHoursImportsOptions = {
  limit?: string | number | null;
};

type RealtimeHoursTimelineOptions = {
  date?: string | null;
  search?: string | null;
  employeeId?: string | null;
  wbLogin?: string | null;
  includeOvernightShiftTail?: boolean;
  /** Internal import scope; regular capture screens remain unfiltered. */
  eligibleEmployeeIds?: string[];
  eligibleWbLogins?: string[];
};

export type RealtimeHoursTimelineRow = ReturnType<typeof buildRealtimeHoursTimelineRow>;

export type RealtimeHoursTimelineResult = {
  success: true;
  date: string;
  window: {
    start: string;
    end: string;
    calculationEnd: string;
  };
  summary: {
    users: number;
    activeMs: number;
    noActivityMs: number;
    sessions: number;
  };
  rows: RealtimeHoursTimelineRow[];
  sourceRecords?: number;
  archived?: boolean;
};

export type RealtimeHoursShiftActivityRequest = {
  key: string;
  employeeId: string;
  wbLogin: string;
  shiftDate: Date;
};

type RealtimeHoursIdentityMappingInput = {
  hostname?: unknown;
  windowsUser?: unknown;
  wbLogin?: unknown;
};

type RealtimeHoursIdentityDiscoveryRecord = {
  hostname: string;
  windowsUser: string;
  wbLogin: string | null;
  employeeId: string | null;
  capturedAt: Date;
  identityConfidence: string;
  recordCount: number;
};

type TimelineSegment = {
  type: "ACTIVE" | "NO_ACTIVITY";
  start: Date;
  end: Date;
  durationMs: number;
};

type TimelineRecord = {
  capturedAt: Date;
  eventType?: string | null;
  lastActivityAt?: Date | null;
  isSessionActive: boolean;
  idleSeconds: number | null;
};

type TimelineDeviceRecord = TimelineRecord & {
  hostname: string;
  windowsUser?: string | null;
};

type TimelineRecordWithIdentity = TimelineDeviceRecord & {
  sessionState: string | null;
  wbLogin: string | null;
  employeeId: string | null;
  ipAddress: string | null;
};

type TimelineEmployee = {
  id: string;
  wbLogin: string;
  fullName: string;
  roleTitle: string;
  lob: { name: string } | null;
  shift: { name: string; startsAt: string; endsAt: string };
  supervisor: { fullName: string } | null;
};

const realtimeHoursImportSchema = z.object({
  source: optionalString(120),
  capturedAt: z.string().trim().min(1, "capturedAt é obrigatório."),
  records: z.array(z.unknown()).min(1, "records precisa ter ao menos um registro.").max(maxRecordsPerImport, `records aceita no máximo ${maxRecordsPerImport} registros por importação.`)
}).passthrough();

const realtimeHoursRecordSchema = z.object({
  eventId: optionalString(80),
  eventType: z.preprocess((value) => {
    const normalized = blankToUndefined(value);
    return typeof normalized === "string" ? normalized.trim().toUpperCase() : normalized;
  }, z.enum(realtimeHoursEventTypes).optional()),
  sessionId: optionalNonNegativeInt(1_000_000),
  sessionState: optionalString(40),
  hostname: z.string().trim().min(1, "hostname é obrigatório.").max(120, "hostname deve ter no máximo 120 caracteres."),
  windowsUser: optionalString(120),
  wbLogin: optionalString(120),
  employeeId: optionalString(120),
  ipAddress: optionalString(64),
  isSessionActive: optionalBoolean(),
  isInputActive: optionalBoolean(),
  idleSeconds: optionalNonNegativeInt(86_400),
  activeWindowTitle: optionalString(300),
  activeProcessName: optionalString(120),
  lastActivityAt: optionalString(80),
  agentVersion: optionalString(40),
  identitySource: optionalString(80),
  identityConfidence: z.preprocess((value) => {
    const normalized = blankToUndefined(value);
    if (typeof normalized === "string") return normalized.trim().toUpperCase();
    return normalized ?? "UNKNOWN";
  }, z.enum(identityConfidences).default("UNKNOWN"))
}).passthrough();

export function validateRealtimeHoursImportToken(authorizationHeader?: string | null) {
  const configuredToken = process.env.REALTIME_HOURS_IMPORT_TOKEN?.trim();
  if (!configuredToken) {
    return { error: "REALTIME_HOURS_IMPORT_TOKEN não configurado no ambiente.", status: 500 };
  }

  const match = String(authorizationHeader ?? "").match(/^Bearer\s+(.+)$/i);
  const providedToken = match?.[1]?.trim() ?? "";
  if (!providedToken || !safeEqualString(providedToken, configuredToken)) {
    return { error: "Token de integração de horas inválido.", status: 401 };
  }

  return { ok: true };
}

export function validateRealtimeHoursAgentToken(authorizationHeader?: string | null) {
  const configuredToken = process.env.REALTIME_HOURS_AGENT_TOKEN?.trim();
  if (!configuredToken) {
    return { error: "REALTIME_HOURS_AGENT_TOKEN não configurado no ambiente.", status: 500 };
  }

  const match = String(authorizationHeader ?? "").match(/^Bearer\s+(.+)$/i);
  const providedToken = match?.[1]?.trim() ?? "";
  if (!providedToken || !safeEqualString(providedToken, configuredToken)) {
    return { error: "Token do agente de horas inválido.", status: 401 };
  }

  return { ok: true };
}

export function validateRealtimeHoursCronToken(authorizationHeader?: string | null) {
  const configuredToken = process.env.CRON_SECRET?.trim();
  if (!configuredToken) {
    return { error: "CRON_SECRET não configurado no ambiente.", status: 500 };
  }

  const match = String(authorizationHeader ?? "").match(/^Bearer\s+(.+)$/i);
  const providedToken = match?.[1]?.trim() ?? "";
  if (!providedToken || !safeEqualString(providedToken, configuredToken)) {
    return { error: "Token da rotina de retenção inválido.", status: 401 };
  }

  return { ok: true };
}

export async function authorizeRealtimeHoursRead(request: Request) {
  const authorization = request.headers.get("authorization");
  if (authorization) return validateRealtimeHoursImportToken(authorization);

  const actor = await getApiActor();
  if (!canAccessRealtimeHoursCapture({ role: actor.role, status: "ACTIVE" })) {
    return { error: "Você não tem permissão para acessar a captura de horas em tempo real.", status: 403 };
  }

  return { ok: true };
}

export async function authorizeRealtimeHoursManage() {
  const actor = await getApiActor();
  if (!canManageRealtimeHoursMappings({ role: actor.role, status: "ACTIVE" })) {
    return { error: "Você não tem permissão para configurar vínculos da captura de horas.", status: 403 };
  }

  return { ok: true, actor };
}

export async function importRealtimeHoursSnapshot(input: unknown) {
  const parsed = realtimeHoursImportSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Payload inválido para importação de horas.",
      message: "Payload inválido para importação de horas.",
      status: 400,
      details: zodErrorMessages(parsed.error)
    };
  }

  const capturedAt = parseDate(parsed.data.capturedAt);
  if (!capturedAt) {
    return {
      success: false,
      error: "capturedAt inválido.",
      message: "capturedAt inválido.",
      status: 400
    };
  }

  const rowErrors: RealtimeHoursRowError[] = [];
  const records: NormalizedRealtimeHoursRecord[] = [];

  parsed.data.records.forEach((rawRecord, index) => {
    const result = normalizeRecord(rawRecord, index + 1, capturedAt);
    if ("error" in result) {
      rowErrors.push(result.error);
      return;
    }
    records.push(result.record);
  });

  if (!records.length) {
    return {
      success: false,
      error: "Nenhum registro válido para importar.",
      message: "Nenhum registro válido para importar.",
      status: 400,
      rowsProcessed: parsed.data.records.length,
      rowsValid: 0,
      rowsError: rowErrors.length,
      errors: rowErrors.slice(0, 50)
    };
  }

  const eventIds = records.map((record) => record.eventId).filter(Boolean) as string[];
  const existingEventIds = eventIds.length
    ? new Set((await prisma.realTimeHoursRecord.findMany({
      where: { eventId: { in: eventIds } },
      select: { eventId: true }
    })).map((record) => record.eventId).filter(Boolean) as string[])
    : new Set<string>();
  const seenEventIds = new Set<string>();
  let duplicateCount = 0;
  const recordsToInsert = records.filter((record) => {
    if (!record.eventId) return true;
    if (existingEventIds.has(record.eventId) || seenEventIds.has(record.eventId)) {
      duplicateCount += 1;
      return false;
    }
    seenEventIds.add(record.eventId);
    return true;
  });

  if (!recordsToInsert.length) {
    return {
      success: true,
      batchId: null,
      source: parsed.data.source || defaultSource,
      status: "DUPLICATE",
      capturedAt: capturedAt.toISOString(),
      rowsProcessed: parsed.data.records.length,
      rowsValid: 0,
      rowsError: rowErrors.length,
      rowsDuplicate: duplicateCount,
      importedAt: new Date().toISOString(),
      errors: rowErrors.slice(0, 50)
    };
  }

  await applyRealtimeHoursIdentityMappings(recordsToInsert);

  const source = parsed.data.source || defaultSource;
  const status = rowErrors.length ? "PARTIAL" : "SUCCESS";
  const batch = await prisma.$transaction(async (tx) => {
    const sharedBatchId = realtimeHoursSharedBatchId(source, capturedAt);
    const created = sharedBatchId
      ? await tx.realTimeHoursImportBatch.upsert({
        where: { id: sharedBatchId },
        create: {
          id: sharedBatchId,
          source,
          capturedAt,
          importedAt: new Date(),
          status,
          rowsTotal: 0,
          rowsValid: 0,
          rowsError: 0,
          errorSummary: Prisma.JsonNull
        },
        update: {
          capturedAt,
          importedAt: new Date(),
          ...(rowErrors.length ? { status: "PARTIAL", errorSummary: rowErrors.slice(0, 50) } : {})
        }
      })
      : await tx.realTimeHoursImportBatch.create({
        data: {
          source,
          capturedAt,
          status,
          rowsTotal: 0,
          rowsValid: 0,
          rowsError: 0,
          errorSummary: Prisma.JsonNull
        }
      });

    let insertedCount = 0;
    for (let index = 0; index < recordsToInsert.length; index += 1000) {
      const chunk = recordsToInsert.slice(index, index + 1000);
      const inserted = await tx.realTimeHoursRecord.createMany({
        data: chunk.map((record) => ({
          ...record,
          batchId: created.id
        })),
        skipDuplicates: true
      });
      insertedCount += inserted.count;
    }

    if (insertedCount === 0) {
      if (!sharedBatchId) {
        await tx.realTimeHoursImportBatch.delete({ where: { id: created.id } });
      }
      return { created: null, insertedCount };
    }

    const updated = await tx.realTimeHoursImportBatch.update({
      where: { id: created.id },
      data: {
        rowsTotal: { increment: parsed.data.records.length },
        rowsValid: { increment: insertedCount },
        rowsError: { increment: rowErrors.length },
        ...(rowErrors.length ? { status: "PARTIAL", errorSummary: rowErrors.slice(0, 50) } : {})
      }
    });

    return { created: updated, insertedCount };
  });

  if (!batch.created) {
    return {
      success: true,
      batchId: null,
      source,
      status: "DUPLICATE",
      capturedAt: capturedAt.toISOString(),
      rowsProcessed: parsed.data.records.length,
      rowsValid: 0,
      rowsError: rowErrors.length,
      rowsDuplicate: duplicateCount + recordsToInsert.length,
      importedAt: new Date().toISOString(),
      errors: rowErrors.slice(0, 50)
    };
  }

  return {
    success: true,
    batchId: batch.created.id,
    source: batch.created.source,
    status: batch.created.status,
    capturedAt: batch.created.capturedAt.toISOString(),
    rowsProcessed: parsed.data.records.length,
    rowsValid: batch.insertedCount,
    rowsError: batch.created.rowsError,
    rowsDuplicate: duplicateCount + recordsToInsert.length - batch.insertedCount,
    importedAt: batch.created.importedAt.toISOString(),
    errors: rowErrors.slice(0, 50)
  };
}

export async function getRealtimeHoursStatus(options: RealtimeHoursStatusOptions = {}) {
  const limit = parseLimit(options.limit, defaultStatusLimit, maxStatusLimit);
  const batch = await prisma.realTimeHoursImportBatch.findFirst({
    where: { status: { in: ["SUCCESS", "PARTIAL"] } },
    orderBy: [{ capturedAt: "desc" }, { importedAt: "desc" }],
    select: {
      id: true,
      source: true,
      status: true,
      capturedAt: true,
      importedAt: true,
      rowsTotal: true,
      rowsValid: true,
      rowsError: true
    }
  });

  if (!batch) {
    return {
      success: true,
      batch: null,
      summary: emptyStatusSummary(),
      records: [],
      recordsReturned: 0,
      limit
    };
  }

  const summaryRecords = await loadRecentRealtimeHoursStatusRecords(limit);
  const records = summaryRecords
    .slice(0, limit)
    .sort((left, right) => `${left.hostname} ${left.windowsUser ?? ""}`.localeCompare(`${right.hostname} ${right.windowsUser ?? ""}`));

  const minutesSinceCaptured = Math.max(0, Math.floor((Date.now() - batch.capturedAt.getTime()) / 60_000));

  return {
    success: true,
    batch: {
      id: batch.id,
      source: batch.source,
      status: batch.status,
      capturedAt: batch.capturedAt.toISOString(),
      importedAt: batch.importedAt.toISOString(),
      rowsTotal: batch.rowsTotal,
      rowsValid: batch.rowsValid,
      rowsError: batch.rowsError,
      minutesSinceCaptured,
      isStale: minutesSinceCaptured > staleThresholdMinutes
    },
    summary: summarizeStatus(summaryRecords),
    records: records.map((record) => ({
      id: record.id,
      eventType: record.eventType ?? "",
      sessionId: record.sessionId,
      sessionState: record.sessionState ?? "",
      agentVersion: record.agentVersion ?? "",
      capturedAt: record.capturedAt.toISOString(),
      hostname: record.hostname,
      windowsUser: record.windowsUser ?? "",
      wbLogin: record.wbLogin ?? "",
      employeeId: record.employeeId ?? "",
      ipAddress: record.ipAddress ?? "",
      isSessionActive: record.isSessionActive,
      isInputActive: record.isInputActive,
      idleSeconds: record.idleSeconds ?? null,
      activeProcessName: record.activeProcessName ?? "",
      activeWindowTitle: record.activeWindowTitle ?? "",
      lastActivityAt: record.lastActivityAt?.toISOString() ?? null,
      identitySource: record.identitySource ?? "",
      identityConfidence: record.identityConfidence,
      createdAt: record.createdAt.toISOString()
    })),
    recordsReturned: records.length,
    limit
  };
}

export async function getRealtimeHoursOperationalPresence() {
  const referenceTime = new Date();
  const records = await loadRecentRealtimeHoursStatusRecords(maxStatusLimit);
  const mappings = await mappingLookupFor(records);
  const employees = await employeeLookupFor(records.map((record) => {
    const mapping = mappings.get(identityKey(record.hostname, record.windowsUser));
    return {
      employeeId: mapping?.employeeId ?? record.employeeId,
      wbLogin: mapping?.wbLogin ?? record.wbLogin
    };
  }));

  const resolved = records.map((record) => {
    const deviceKey = identityKey(record.hostname, record.windowsUser);
    const mapping = mappings.get(deviceKey);
    const employee = employees.get(employeeKey(mapping?.employeeId ?? record.employeeId, mapping?.wbLogin ?? record.wbLogin));
    const employeeId = mapping?.employeeId ?? employee?.id ?? record.employeeId ?? "";
    const wbLogin = mapping?.wbLogin ?? employee?.wbLogin ?? record.wbLogin ?? "";
    const personKey = employeeKey(employeeId, wbLogin) || `device:${deviceKey || record.hostname.trim().toLowerCase()}`;
    return { record, employee, employeeId, wbLogin, personKey };
  });

  const recordsByPerson = new Map<string, Array<typeof resolved[number]>>();
  for (const item of resolved) {
    const current = recordsByPerson.get(item.personKey) ?? [];
    current.push(item);
    recordsByPerson.set(item.personKey, current);
  }

  const rows = Array.from(recordsByPerson.values())
    .map((items) => {
      const selectedRecord = selectRealtimeHoursPresenceRecord(items.map((item) => item.record), referenceTime);
      return items.find((item) => item.record === selectedRecord) ?? items[0];
    })
    .map(({ record, employee, employeeId, wbLogin }) => ({
      employeeId,
      employeeName: employee?.fullName ?? "",
      wbLogin,
      roleTitle: employee?.roleTitle ?? "",
      skill: employee?.skill ?? "",
      lob: employee?.lob?.name ?? "",
      shift: employee?.shift?.name ?? "",
      supervisor: employee?.supervisor?.fullName ?? "Sem supervisor",
      employeeStatus: employee?.operationalStatus ?? "",
      hostname: record.hostname,
      windowsUser: record.windowsUser ?? "",
      lastSeenAt: record.capturedAt.toISOString(),
      status: resolveRealtimeHoursPresenceStatus(record, referenceTime)
    }))
    .sort((left, right) => (left.employeeName || left.wbLogin || left.hostname).localeCompare(right.employeeName || right.wbLogin || right.hostname));

  const statusCount = (status: "ONLINE" | "IDLE" | "LOCKED" | "OFFLINE") => rows.filter((row) => row.status === status).length;
  const latestCapturedAt = rows.reduce<string | null>((latest, row) => !latest || row.lastSeenAt > latest ? row.lastSeenAt : latest, null);

  return {
    success: true,
    capturedAt: latestCapturedAt,
    summary: {
      online: statusCount("ONLINE"),
      idle: statusCount("IDLE"),
      locked: statusCount("LOCKED"),
      offline: statusCount("OFFLINE")
    },
    rows
  };
}

export async function listRealtimeHoursImports(options: RealtimeHoursImportsOptions = {}) {
  const limit = parseLimit(options.limit, defaultImportsLimit, maxImportsLimit);
  const imports = await prisma.realTimeHoursImportBatch.findMany({
    orderBy: { importedAt: "desc" },
    take: limit,
    select: {
      id: true,
      source: true,
      capturedAt: true,
      importedAt: true,
      status: true,
      rowsTotal: true,
      rowsValid: true,
      rowsError: true,
      errorSummary: true,
      _count: {
        select: { records: true }
      }
    }
  });

  return {
    success: true,
    data: imports.map((item) => ({
      id: item.id,
      source: item.source,
      status: item.status,
      capturedAt: item.capturedAt.toISOString(),
      importedAt: item.importedAt.toISOString(),
      rowsTotal: item.rowsTotal,
      rowsValid: item.rowsValid,
      rowsError: item.rowsError,
      recordCount: item._count.records,
      errorSummary: item.errorSummary ?? null
    })),
    limit
  };
}

export async function cleanupRealtimeHoursRetention() {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const archive = await archiveRealtimeHoursBeforeCutoff(cutoff);

  // Raw heartbeats are deleted only after every affected operational date is
  // archived. The first runs therefore backfill safely before pruning starts.
  const batchesDeleted = archive.remainingDays === 0 && archive.deleteBefore
    ? await deleteRealtimeHoursBatchesBefore(new Date(archive.deleteBefore), retentionDeleteLimit)
    : 0;

  return {
    success: true,
    retentionDays,
    cutoff: cutoff.toISOString(),
    archive,
    batchesDeleted,
    deleteLimit: retentionDeleteLimit
  };
}

async function archiveRealtimeHoursBeforeCutoff(cutoff: Date) {
  const oldestBatch = await prisma.realTimeHoursImportBatch.findFirst({
    where: { capturedAt: { lt: cutoff } },
    orderBy: { capturedAt: "asc" },
    select: { capturedAt: true }
  });
  if (!oldestBatch) {
    return {
      requiredDays: 0,
      archivedDays: 0,
      remainingDays: 0,
      processedDates: [] as string[],
      deleteBefore: null as string | null
    };
  }

  const startDate = addDateKeyDays(saoPauloDateKey(oldestBatch.capturedAt), -1);
  const endDate = realtimeHoursArchiveThroughDate(cutoff);
  const requiredDates = dateKeysBetween(startDate, endDate, 4_000);
  const coveredThroughEndDate = requiredDates.at(-1) === endDate;
  const existing = await prisma.realTimeHoursArchiveDay.findMany({
    where: { dateKey: { in: requiredDates } },
    select: { dateKey: true }
  });
  const archivedDates = new Set(existing.map((row) => row.dateKey));
  const missingDates = requiredDates.filter((dateKey) => !archivedDates.has(dateKey));
  const datesToProcess = missingDates.slice(0, archiveDaysPerRun);

  for (const dateKey of datesToProcess) {
    await archiveRealtimeHoursDate(dateKey);
    archivedDates.add(dateKey);
  }

  return {
    requiredDays: requiredDates.length,
    archivedDays: archivedDates.size,
    remainingDays: requiredDates.filter((dateKey) => !archivedDates.has(dateKey)).length + (coveredThroughEndDate ? 0 : 1),
    processedDates: datesToProcess,
    deleteBefore: coveredThroughEndDate ? realtimeHoursRawDeleteBefore(endDate).toISOString() : null
  };
}

async function archiveRealtimeHoursDate(dateKey: string) {
  const timeline = await getRealtimeHoursTimelineFromRaw({ date: dateKey });
  const generatedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.realTimeHoursArchiveDay.upsert({
      where: { dateKey },
      create: {
        dateKey,
        windowStart: new Date(timeline.window.start),
        windowEnd: new Date(timeline.window.end),
        calculationEnd: new Date(timeline.window.calculationEnd),
        sourceRecords: timeline.sourceRecords ?? 0,
        generatedAt
      },
      update: {
        windowStart: new Date(timeline.window.start),
        windowEnd: new Date(timeline.window.end),
        calculationEnd: new Date(timeline.window.calculationEnd),
        sourceRecords: timeline.sourceRecords ?? 0,
        generatedAt
      }
    });
    await tx.realTimeHoursArchiveRow.deleteMany({ where: { dateKey } });
    for (let index = 0; index < timeline.rows.length; index += 500) {
      const rows = timeline.rows.slice(index, index + 500);
      await tx.realTimeHoursArchiveRow.createMany({
        data: rows.map((row) => ({
          dateKey,
          rowKey: row.key,
          employeeId: row.employeeId || null,
          wbLoginNormalized: row.wbLogin ? normalizeLogin(row.wbLogin) : null,
          payload: toJsonValue(row)
        }))
      });
    }
  }, { timeout: 30_000 });
}

async function deleteRealtimeHoursBatchesBefore(cutoff: Date, limit: number) {
  return prisma.$executeRaw(Prisma.sql`
    WITH stale_batches AS (
      SELECT "id"
      FROM "RealTimeHoursImportBatch"
      WHERE "capturedAt" < ${cutoff}
      ORDER BY "capturedAt" ASC
      LIMIT ${limit}
    )
    DELETE FROM "RealTimeHoursImportBatch" AS batch
    USING stale_batches
    WHERE batch."id" = stale_batches."id"
  `);
}

function dateKeysBetween(startDate: string, endDate: string, maximumDays: number) {
  const dates: string[] = [];
  let current = startDate;
  while (current <= endDate && dates.length < maximumDays) {
    dates.push(current);
    current = addDateKeyDays(current, 1);
  }
  return dates;
}

export async function listRealtimeHoursIdentityMappings() {
  const [mappings, recentRecords] = await Promise.all([
    prisma.realTimeHoursIdentityMapping.findMany({
      orderBy: [{ hostname: "asc" }, { windowsUser: "asc" }],
      include: {
        employee: {
          select: {
            id: true,
            wbLogin: true,
            fullName: true,
            roleTitle: true,
            skill: true,
            operationalStatus: true,
            lob: { select: { name: true } },
            shift: { select: { name: true, startsAt: true, endsAt: true } },
            supervisor: { select: { fullName: true } }
          }
        }
      }
    }),
    loadRealtimeHoursIdentityDiscoveryRecords()
  ]);

  const discovered = new Map<string, {
    hostname: string;
    windowsUser: string;
    wbLogin: string | null;
    employeeId: string | null;
    lastSeenAt: Date | null;
    recordCount: number;
    identityConfidence: string;
  }>();

  for (const record of recentRecords) {
    const key = identityKey(record.hostname, record.windowsUser);
    if (!key) continue;
    const current = discovered.get(key);
    discovered.set(key, {
      hostname: record.hostname,
      windowsUser: record.windowsUser ?? "",
      wbLogin: current?.wbLogin ?? record.wbLogin,
      employeeId: current?.employeeId ?? record.employeeId,
      lastSeenAt: current?.lastSeenAt ?? record.capturedAt,
      recordCount: (current?.recordCount ?? 0) + record.recordCount,
      identityConfidence: current?.identityConfidence === "HIGH" ? "HIGH" : record.identityConfidence
    });
  }

  const employees = await employeeLookupFor(
    Array.from(discovered.values()).map((item) => ({ employeeId: item.employeeId, wbLogin: item.wbLogin }))
  );

  for (const mapping of mappings) {
    const key = identityKey(mapping.hostname, mapping.windowsUser);
    if (!key) continue;
    const current = discovered.get(key);
    discovered.set(key, {
      hostname: mapping.hostname,
      windowsUser: mapping.windowsUser,
      wbLogin: mapping.wbLogin,
      employeeId: mapping.employeeId,
      lastSeenAt: current?.lastSeenAt ?? null,
      recordCount: current?.recordCount ?? 0,
      identityConfidence: "HIGH"
    });
    if (mapping.employee) employees.set(employeeKey(mapping.employee.id, mapping.employee.wbLogin), mapping.employee);
  }

  const mappingIndex = new Map(mappings.map((mapping) => [identityKey(mapping.hostname, mapping.windowsUser), mapping]));

  return {
    success: true,
    data: Array.from(discovered.values())
      .map((item) => {
        const key = identityKey(item.hostname, item.windowsUser);
        const mapping = key ? mappingIndex.get(key) : null;
        const employee = mapping?.employee ?? employees.get(employeeKey(item.employeeId, item.wbLogin));
        return {
          id: mapping?.id ?? null,
          hostname: item.hostname,
          windowsUser: item.windowsUser,
          wbLogin: mapping?.wbLogin ?? employee?.wbLogin ?? item.wbLogin ?? "",
          employeeId: mapping?.employeeId ?? employee?.id ?? item.employeeId ?? "",
          employeeName: employee?.fullName ?? "",
          roleTitle: employee?.roleTitle ?? "",
          lob: employee?.lob?.name ?? "",
          shift: employee?.shift?.name ?? "",
          mapped: Boolean(mapping),
          lastSeenAt: item.lastSeenAt?.toISOString() ?? null,
          recordCount: item.recordCount,
          identityConfidence: mapping ? "HIGH" : item.identityConfidence
        };
      })
      .sort((a, b) => `${a.hostname} ${a.windowsUser}`.localeCompare(`${b.hostname} ${b.windowsUser}`))
  };
}

async function loadRealtimeHoursIdentityDiscoveryRecords() {
  const since = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  return prisma.$queryRaw<RealtimeHoursIdentityDiscoveryRecord[]>(Prisma.sql`
    SELECT
      latest."hostname",
      latest."windowsUser",
      latest."wbLogin",
      latest."employeeId",
      latest."capturedAt",
      latest."identityConfidence",
      latest."recordCount"
    FROM (
      SELECT DISTINCT ON (record."hostname", record."windowsUser")
        record."hostname",
        record."windowsUser",
        record."wbLogin",
        record."employeeId",
        record."capturedAt",
        record."identityConfidence",
        COUNT(*) OVER (
          PARTITION BY record."hostname", record."windowsUser"
        )::integer AS "recordCount"
      FROM "RealTimeHoursRecord" AS record
      WHERE record."capturedAt" >= ${since}
        AND COALESCE(BTRIM(record."windowsUser"), '') <> ''
      ORDER BY
        record."hostname" ASC,
        record."windowsUser" ASC,
        record."capturedAt" DESC,
        record."createdAt" DESC
    ) AS latest
    ORDER BY latest."capturedAt" DESC
  `);
}

export async function upsertRealtimeHoursIdentityMapping(input: RealtimeHoursIdentityMappingInput, actorEmail?: string | null) {
  const hostname = String(input.hostname ?? "").trim();
  const windowsUser = String(input.windowsUser ?? "").trim();
  const wbLogin = normalizeLogin(String(input.wbLogin ?? ""));

  if (!hostname || !windowsUser) {
    return { success: false, error: "hostname e windowsUser são obrigatórios.", message: "hostname e windowsUser são obrigatórios.", status: 400 };
  }

  if (!wbLogin) {
    await prisma.realTimeHoursIdentityMapping.deleteMany({ where: { hostname, windowsUser } });
    return { success: true, deleted: true, hostname, windowsUser };
  }

  const employee = await prisma.employeeProfile.findFirst({
    where: { wbLogin: { equals: wbLogin, mode: "insensitive" } },
    select: {
      id: true,
      wbLogin: true,
      fullName: true,
      roleTitle: true,
      lob: { select: { name: true } },
      shift: { select: { name: true } },
      supervisor: { select: { fullName: true } }
    }
  });

  if (!employee) {
    return { success: false, error: "WB/Login não encontrado no Mapa de Parceiros.", message: "WB/Login não encontrado no Mapa de Parceiros.", status: 404 };
  }

  const mapping = await prisma.$transaction(async (tx) => {
    const saved = await tx.realTimeHoursIdentityMapping.upsert({
      where: { hostname_windowsUser: { hostname, windowsUser } },
      create: {
        hostname,
        windowsUser,
        wbLogin: employee.wbLogin,
        employeeId: employee.id,
        createdByEmail: actorEmail ?? null,
        updatedByEmail: actorEmail ?? null
      },
      update: {
        wbLogin: employee.wbLogin,
        employeeId: employee.id,
        updatedByEmail: actorEmail ?? null
      },
      include: {
        employee: {
          select: {
            id: true,
            wbLogin: true,
            fullName: true,
            roleTitle: true,
            lob: { select: { name: true } },
            shift: { select: { name: true } },
            supervisor: { select: { fullName: true } }
          }
        }
      }
    });

    await tx.realTimeHoursRecord.updateMany({
      where: { hostname, windowsUser },
      data: {
        wbLogin: employee.wbLogin,
        employeeId: employee.id,
        identitySource: "manual_site_mapping",
        identityConfidence: "HIGH"
      }
    });

    return saved;
  });

  return {
    success: true,
    data: {
      id: mapping.id,
      hostname: mapping.hostname,
      windowsUser: mapping.windowsUser,
      wbLogin: mapping.wbLogin,
      employeeId: mapping.employeeId ?? "",
      employeeName: mapping.employee?.fullName ?? "",
      roleTitle: mapping.employee?.roleTitle ?? "",
      lob: mapping.employee?.lob?.name ?? "",
      shift: mapping.employee?.shift?.name ?? "",
      mapped: true
    }
  };
}

export async function getRealtimeHoursTimeline(options: RealtimeHoursTimelineOptions = {}): Promise<RealtimeHoursTimelineResult> {
  const startedAt = Date.now();
  const archived = await getArchivedRealtimeHoursTimeline(options);
  const result = archived ?? await getRealtimeHoursTimelineFromRaw(options);
  logPerformanceMetric("realtime-hours.timeline", startedAt, {
    date: result.date,
    records: result.sourceRecords ?? 0,
    rows: result.rows.length,
    archived: Boolean(result.archived)
  });
  return result;
}

export async function getRealtimeHoursTimelineRange(options: {
  dates: string[];
  employeeId?: string | null;
  wbLogin?: string | null;
  eligibleEmployeeIds?: string[];
  eligibleWbLogins?: string[];
}) {
  const dates = Array.from(new Set(options.dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))));
  if (!dates.length) return [];

  const employeeId = String(options.employeeId ?? "").trim();
  const wbLogin = normalizeLogin(String(options.wbLogin ?? ""));
  const archivedDays = await prisma.realTimeHoursArchiveDay.findMany({
    where: { dateKey: { in: dates } },
    include: {
      rows: {
        where: options.eligibleEmployeeIds ? {
          OR: [
            { employeeId: { in: options.eligibleEmployeeIds } },
            { wbLoginNormalized: { in: (options.eligibleWbLogins ?? []).map(normalizeLogin) } }
          ]
        } : employeeId || wbLogin ? {
          OR: [
            ...(employeeId ? [{ employeeId }] : []),
            ...(wbLogin ? [{ wbLoginNormalized: wbLogin }] : [])
          ]
        } : undefined,
        orderBy: { rowKey: "asc" }
      }
    }
  });
  const results = new Map<string, RealtimeHoursTimelineResult>(
    archivedDays.map((day) => [day.dateKey, timelineFromArchivedDay(day, {})])
  );
  const missingDates = dates.filter((date) => !results.has(date));

  for (let index = 0; index < missingDates.length; index += 4) {
    const chunk = missingDates.slice(index, index + 4);
    const timelines = await Promise.all(chunk.map((date) => getRealtimeHoursTimelineFromRaw({
      date,
      employeeId,
      wbLogin,
      eligibleEmployeeIds: options.eligibleEmployeeIds,
      eligibleWbLogins: options.eligibleWbLogins
    })));
    timelines.forEach((timeline) => results.set(timeline.date, timeline));
  }

  return dates
    .map((date) => results.get(date))
    .filter((timeline): timeline is RealtimeHoursTimelineResult => Boolean(timeline));
}

async function getArchivedRealtimeHoursTimeline(options: RealtimeHoursTimelineOptions) {
  const dateKey = resolveTimelineDate(options.date).date;
  const employeeId = String(options.employeeId ?? "").trim();
  const wbLogin = normalizeLogin(String(options.wbLogin ?? ""));
  const day = await prisma.realTimeHoursArchiveDay.findUnique({
    where: { dateKey },
    include: {
      rows: {
        where: employeeId || wbLogin ? {
          OR: [
            ...(employeeId ? [{ employeeId }] : []),
            ...(wbLogin ? [{ wbLoginNormalized: wbLogin }] : [])
          ]
        } : undefined,
        orderBy: { rowKey: "asc" }
      }
    }
  });
  return day ? timelineFromArchivedDay(day, options) : null;
}

function timelineFromArchivedDay(
  day: {
    dateKey: string;
    windowStart: Date;
    windowEnd: Date;
    calculationEnd: Date;
    sourceRecords: number;
    rows: Array<{ payload: Prisma.JsonValue }>;
  },
  options: Pick<RealtimeHoursTimelineOptions, "search">
): RealtimeHoursTimelineResult {
  const search = normalizeSearch(options.search);
  const rows = day.rows
    .map((row) => archivedTimelineRow(row.payload))
    .filter((row): row is RealtimeHoursTimelineRow => Boolean(row))
    .filter((row) => !search || normalizeSearch([
      row.hostname,
      ...row.hostnames,
      ...row.windowsUsers,
      row.windowsUser,
      row.wbLogin,
      row.employeeName,
      row.lob,
      row.shift,
      row.ipAddress
    ].join(" ")).includes(search));

  return buildRealtimeHoursTimelineResult({
    date: day.dateKey,
    window: {
      start: day.windowStart.toISOString(),
      end: day.windowEnd.toISOString(),
      calculationEnd: day.calculationEnd.toISOString()
    },
    rows,
    sourceRecords: day.sourceRecords,
    archived: true
  });
}

function archivedTimelineRow(payload: Prisma.JsonValue) {
  if (!isPlainObject(payload) || typeof payload.key !== "string" || !Array.isArray(payload.segments)) return null;
  return payload as unknown as RealtimeHoursTimelineRow;
}

async function getRealtimeHoursTimelineFromRaw(options: RealtimeHoursTimelineOptions = {}): Promise<RealtimeHoursTimelineResult> {
  const period = resolveTimelineDate(options.date);
  const employeeId = String(options.employeeId ?? "").trim();
  const wbLogin = normalizeLogin(String(options.wbLogin ?? ""));
  const eligibleIds = options.eligibleEmployeeIds ? new Set(options.eligibleEmployeeIds) : null;
  const eligibleLogins = new Set((options.eligibleWbLogins ?? []).map(normalizeLogin));
  const eligibleMappings = eligibleIds ? await prisma.realTimeHoursIdentityMapping.findMany({
    where: { OR: [{ employeeId: { in: [...eligibleIds] } }, { wbLogin: { in: [...eligibleLogins], mode: "insensitive" } }] },
    select: { hostname: true, windowsUser: true }
  }) : [];
  const records = await prisma.realTimeHoursRecord.findMany({
    where: {
      capturedAt: {
        gte: period.queryStart,
        lt: period.end
      },
      ...(eligibleIds ? {
        OR: [
          { employeeId: { in: [...eligibleIds] } },
          { wbLogin: { in: [...eligibleLogins], mode: "insensitive" as const } },
          ...eligibleMappings.map(({ hostname, windowsUser }) => ({ hostname, windowsUser }))
        ]
      } : employeeId || wbLogin ? {
        OR: [
          ...(employeeId ? [{ employeeId }] : []),
          ...(wbLogin ? [{ wbLogin: { equals: wbLogin, mode: "insensitive" as const } }] : [])
        ]
      } : {})
    },
    orderBy: [{ hostname: "asc" }, { windowsUser: "asc" }, { capturedAt: "asc" }],
    select: {
      eventType: true,
      capturedAt: true,
      hostname: true,
      windowsUser: true,
      wbLogin: true,
      employeeId: true,
      ipAddress: true,
      isSessionActive: true,
      sessionState: true,
      idleSeconds: true,
      lastActivityAt: true
    }
  });

  const mappings = await mappingLookupFor(records);
  const matchedEmployees = await employeeLookupFor(records.map((record) => {
    const mapping = mappings.get(identityKey(record.hostname, record.windowsUser));
    return {
      employeeId: mapping?.employeeId ?? record.employeeId,
      wbLogin: mapping?.wbLogin ?? record.wbLogin
    };
  }));
  const employees = eligibleIds
    ? new Map([...matchedEmployees].filter(([, employee]) => eligibleIds.has(employee.id)))
    : matchedEmployees;

  const employeeIds = Array.from(new Set(Array.from(employees.values()).map((employee) => employee.id)));
  const scheduleDateKeys = [
    addDateKeyDays(period.date, -1),
    period.date,
    addDateKeyDays(period.date, 1)
  ];
  const scheduleDates = scheduleDateKeys.map((date) => new Date(`${date}T00:00:00.000Z`));
  const schedules = employeeIds.length
    ? await prisma.schedule.findMany({
      where: {
        employeeId: { in: employeeIds },
        date: { in: scheduleDates },
        deletedAt: null
      },
      select: {
        id: true,
        employeeId: true,
        date: true,
        startsAt: true,
        endsAt: true,
        status: true,
        shift: { select: { name: true, startsAt: true, endsAt: true } }
      }
    })
    : [];
  const schedulesByEmployeeId = new Map<string, RealtimeHoursScheduleSlot[]>();
  for (const schedule of schedules) {
    const employeeSchedules = schedulesByEmployeeId.get(schedule.employeeId) ?? [];
    employeeSchedules.push({ ...schedule, status: schedule.status });
    schedulesByEmployeeId.set(schedule.employeeId, employeeSchedules);
  }

  const groups = new Map<string, Array<{
    record: TimelineRecordWithIdentity;
    employeeId: string;
    wbLogin: string;
  }>>();
  for (const record of records) {
    const deviceKey = identityKey(record.hostname, record.windowsUser) || `${record.hostname.trim().toLowerCase()}::`;
    const mapping = mappings.get(deviceKey);
    const employee = employees.get(employeeKey(mapping?.employeeId ?? record.employeeId, mapping?.wbLogin ?? record.wbLogin));
    const employeeId = mapping?.employeeId ?? employee?.id ?? record.employeeId ?? "";
    const wbLogin = mapping?.wbLogin ?? employee?.wbLogin ?? record.wbLogin ?? "";
    if (eligibleIds && (employeeId ? !eligibleIds.has(employeeId) : !eligibleLogins.has(normalizeLogin(wbLogin)))) continue;
    const key = realtimeHoursTimelinePersonKey({ employeeId, wbLogin, hostname: record.hostname, windowsUser: record.windowsUser });
    const group = groups.get(key) ?? [];
    group.push({ record, employeeId, wbLogin });
    groups.set(key, group);
  }

  const search = normalizeSearch(options.search);
  const rows = Array.from(groups.entries()).flatMap(([personKey, group]) => {
    const latestItem = group.reduce((latest, item) => item.record.capturedAt > latest.record.capturedAt ? item : latest);
    const employeeId = latestItem.employeeId || group.find((item) => item.employeeId)?.employeeId || "";
    const wbLogin = latestItem.wbLogin || group.find((item) => item.wbLogin)?.wbLogin || "";
    const employee = employees.get(employeeKey(employeeId, wbLogin));
    const allPlannedShifts = employee
      ? buildRealtimeHoursPlannedShifts(schedulesByEmployeeId.get(employeeId || employee.id) ?? [])
      : [];
    const assignmentWindows = buildRealtimeHoursSlotAssignmentWindows(allPlannedShifts);
    const recordsBySlot = new Map<string, TimelineRecordWithIdentity[]>();
    const unmatchedRecords: TimelineRecordWithIdentity[] = [];

    for (const item of group) {
      const plannedShift = matchRealtimeHoursPlannedShift(item.record.capturedAt, assignmentWindows);
      if (!plannedShift) {
        unmatchedRecords.push(item.record);
        continue;
      }
      const slotRecords = recordsBySlot.get(plannedShift.id) ?? [];
      slotRecords.push(item.record);
      recordsBySlot.set(plannedShift.id, slotRecords);
    }

    const selectedShifts = allPlannedShifts.filter((shift) => shift.sourceDate === period.date);
    const scheduledRows = selectedShifts.flatMap((plannedShift) => {
      const slotRecords = recordsBySlot.get(plannedShift.id) ?? [];
      if (!slotRecords.length) return [];
      const assignmentWindow = assignmentWindows.find((window) => window.shift.id === plannedShift.id) ?? null;
      return [buildRealtimeHoursTimelineRow({
        personKey,
        slotRecords,
        employee,
        employeeId,
        wbLogin,
        plannedShift,
        assignmentWindow,
        period
      })];
    });

    if (selectedShifts.length) return scheduledRows;

    const fallbackRows = splitFallbackTimelineRecords(unmatchedRecords)
      .filter((slotRecords) => fallbackDataFor(slotRecords, period.date) === period.date)
      .map((slotRecords, index) => buildRealtimeHoursTimelineRow({
        personKey,
        slotRecords,
        employee,
        employeeId,
        wbLogin,
        plannedShift: null,
        assignmentWindow: null,
        period,
        fallbackIndex: index
      }));

    return [...scheduledRows, ...fallbackRows];
  }).filter((row) => {
    if (!search) return true;
    return normalizeSearch([
      row.hostname,
      ...row.hostnames,
      ...row.windowsUsers,
      row.windowsUser,
      row.wbLogin,
      row.employeeName,
      row.lob,
      row.shift,
      row.ipAddress
    ].join(" ")).includes(search);
  }).sort((a, b) => {
    const left = a.employeeName || a.wbLogin || a.windowsUser || a.hostname;
    const right = b.employeeName || b.wbLogin || b.windowsUser || b.hostname;
    return left.localeCompare(right) || a.data.localeCompare(b.data) || a.key.localeCompare(b.key);
  });

  return buildRealtimeHoursTimelineResult({
    date: period.date,
    window: {
      start: period.start.toISOString(),
      end: period.end.toISOString(),
      calculationEnd: period.calculationEnd.toISOString()
    },
    rows,
    sourceRecords: records.length,
    archived: false
  });
}

function buildRealtimeHoursTimelineResult(input: {
  date: string;
  window: RealtimeHoursTimelineResult["window"];
  rows: RealtimeHoursTimelineRow[];
  sourceRecords?: number;
  archived?: boolean;
}): RealtimeHoursTimelineResult {
  return {
    success: true,
    date: input.date,
    window: input.window,
    summary: {
      users: input.rows.length,
      activeMs: input.rows.reduce((sum, row) => sum + row.activeMs, 0),
      noActivityMs: input.rows.reduce((sum, row) => sum + row.noActivityMs, 0),
      sessions: input.rows.reduce((sum, row) => sum + row.sessionCount, 0)
    },
    rows: input.rows,
    sourceRecords: input.sourceRecords,
    archived: input.archived
  };
}

export async function getRealtimeHoursShiftActivityHours(
  requests: RealtimeHoursShiftActivityRequest[]
) {
  const uniqueRequests = Array.from(new Map(requests.map((request) => [request.key, request])).values());
  const result = new Map(uniqueRequests.map((request) => [request.key, 0]));
  if (!uniqueRequests.length) return result;

  const allDateKeys = Array.from(new Set(uniqueRequests.map((request) => request.shiftDate.toISOString().slice(0, 10))));
  const allEmployeeIds = Array.from(new Set(uniqueRequests.map((request) => request.employeeId).filter(Boolean)));
  const allWbLogins = Array.from(new Set(uniqueRequests.map((request) => normalizeLogin(request.wbLogin)).filter(Boolean)));
  const archivedDays = await prisma.realTimeHoursArchiveDay.findMany({
    where: { dateKey: { in: allDateKeys } },
    include: {
      rows: {
        where: {
          OR: [
            ...(allEmployeeIds.length ? [{ employeeId: { in: allEmployeeIds } }] : []),
            ...(allWbLogins.length ? [{ wbLoginNormalized: { in: allWbLogins } }] : [])
          ]
        },
        select: { payload: true }
      }
    }
  });
  const archivedDateKeys = new Set(archivedDays.map((day) => day.dateKey));
  const requestsByDate = new Map<string, RealtimeHoursShiftActivityRequest[]>();
  for (const request of uniqueRequests) {
    const dateKey = request.shiftDate.toISOString().slice(0, 10);
    const dateRequests = requestsByDate.get(dateKey) ?? [];
    dateRequests.push(request);
    requestsByDate.set(dateKey, dateRequests);
  }
  for (const day of archivedDays) {
    const rows = day.rows
      .map((row) => archivedTimelineRow(row.payload))
      .filter((row): row is RealtimeHoursTimelineRow => Boolean(row));
    for (const request of requestsByDate.get(day.dateKey) ?? []) {
      const normalizedWbLogin = normalizeLogin(request.wbLogin);
      const activeMs = rows
        .filter((row) => row.data === day.dateKey && (
          row.employeeId === request.employeeId
          || (normalizedWbLogin && normalizeLogin(row.wbLogin) === normalizedWbLogin)
        ))
        .reduce((sum, row) => sum + row.activeMs, 0);
      result.set(request.key, activeMs / (60 * 60 * 1_000));
    }
  }

  const rawRequests = uniqueRequests.filter((request) => (
    !archivedDateKeys.has(request.shiftDate.toISOString().slice(0, 10))
  ));
  if (!rawRequests.length) return result;

  const employeeIds = Array.from(new Set(rawRequests.map((request) => request.employeeId).filter(Boolean)));
  const wbLogins = Array.from(new Set(rawRequests.map((request) => request.wbLogin).filter(Boolean)));
  const employeeIdByWbLogin = new Map(
    rawRequests
      .filter((request) => request.employeeId && request.wbLogin)
      .map((request) => [normalizeLogin(request.wbLogin), request.employeeId])
  );
  const requestsByEmployeeId = new Map<string, RealtimeHoursShiftActivityRequest[]>();
  for (const request of rawRequests) {
    const employeeRequests = requestsByEmployeeId.get(request.employeeId) ?? [];
    employeeRequests.push(request);
    requestsByEmployeeId.set(request.employeeId, employeeRequests);
  }

  const requestedDateKeys = Array.from(new Set(rawRequests.map((request) => request.shiftDate.toISOString().slice(0, 10))));
  const scheduleDateKeys = Array.from(new Set(requestedDateKeys.flatMap((date) => [
    addDateKeyDays(date, -1),
    date,
    addDateKeyDays(date, 1)
  ])));
  const periods = new Map(requestedDateKeys.map((date) => [date, resolveTimelineDate(date)]));
  const queryStart = new Date(Math.min(...Array.from(periods.values()).map((period) => period.queryStart.getTime())));
  const queryEnd = new Date(Math.max(...Array.from(periods.values()).map((period) => period.end.getTime())));

  const [records, schedules] = await Promise.all([
    prisma.realTimeHoursRecord.findMany({
      where: {
        capturedAt: { gte: queryStart, lt: queryEnd },
        OR: [
          { employeeId: { in: employeeIds } },
          ...(wbLogins.length ? [{ wbLogin: { in: wbLogins } }] : [])
        ]
      },
      orderBy: [{ capturedAt: "asc" }],
      select: {
        capturedAt: true,
        eventType: true,
        lastActivityAt: true,
        isSessionActive: true,
        idleSeconds: true,
        hostname: true,
        windowsUser: true,
        wbLogin: true,
        employeeId: true
      }
    }),
    prisma.schedule.findMany({
      where: {
        employeeId: { in: employeeIds },
        date: { in: scheduleDateKeys.map((date) => new Date(`${date}T00:00:00.000Z`)) },
        deletedAt: null
      },
      select: {
        id: true,
        employeeId: true,
        date: true,
        startsAt: true,
        endsAt: true,
        status: true,
        shift: { select: { name: true, startsAt: true, endsAt: true } }
      }
    })
  ]);

  const recordsByEmployeeId = new Map<string, TimelineDeviceRecord[]>();
  for (const record of records) {
    const employeeId = record.employeeId && requestsByEmployeeId.has(record.employeeId)
      ? record.employeeId
      : employeeIdByWbLogin.get(normalizeLogin(record.wbLogin ?? "")) ?? "";
    if (!employeeId) continue;
    const employeeRecords = recordsByEmployeeId.get(employeeId) ?? [];
    employeeRecords.push(record);
    recordsByEmployeeId.set(employeeId, employeeRecords);
  }

  const schedulesByEmployeeId = new Map<string, RealtimeHoursScheduleSlot[]>();
  for (const schedule of schedules) {
    const employeeSchedules = schedulesByEmployeeId.get(schedule.employeeId) ?? [];
    employeeSchedules.push({ ...schedule, status: schedule.status });
    schedulesByEmployeeId.set(schedule.employeeId, employeeSchedules);
  }

  for (const [employeeId, employeeRequests] of requestsByEmployeeId) {
    const plannedShifts = buildRealtimeHoursPlannedShifts(schedulesByEmployeeId.get(employeeId) ?? []);
    const assignmentWindows = buildRealtimeHoursSlotAssignmentWindows(plannedShifts);
    const recordsByShiftId = new Map<string, TimelineDeviceRecord[]>();

    for (const record of recordsByEmployeeId.get(employeeId) ?? []) {
      const plannedShift = matchRealtimeHoursPlannedShift(record.capturedAt, assignmentWindows);
      if (!plannedShift) continue;
      const shiftRecords = recordsByShiftId.get(plannedShift.id) ?? [];
      shiftRecords.push(record);
      recordsByShiftId.set(plannedShift.id, shiftRecords);
    }

    for (const request of employeeRequests) {
      const dateKey = request.shiftDate.toISOString().slice(0, 10);
      const plannedShift = plannedShifts.find((shift) => shift.sourceDate === dateKey);
      const period = periods.get(dateKey);
      if (!plannedShift || !period) continue;
      const slotRecords = recordsByShiftId.get(plannedShift.id) ?? [];
      const assignmentWindow = assignmentWindows.find((window) => window.shift.id === plannedShift.id) ?? null;
      const segments = buildRealtimeHoursCapturedSegments(slotRecords, plannedShift, assignmentWindow, period);
      const activeMs = wholeSecondsMs(segments
        .filter((segment) => segment.type === "ACTIVE")
        .reduce((sum, segment) => sum + segment.durationMs, 0));
      result.set(request.key, activeMs / (60 * 60 * 1_000));
    }
  }

  return result;
}

type RealtimeHoursTimelinePeriod = ReturnType<typeof resolveTimelineDate>;

function buildRealtimeHoursCapturedSegments(
  slotRecords: TimelineDeviceRecord[],
  plannedShift: RealtimeHoursPlannedShift | null,
  assignmentWindow: RealtimeHoursSlotAssignmentWindow | null,
  period: RealtimeHoursTimelinePeriod
) {
  if (!slotRecords.length) return [];
  const sortedRecords = [...slotRecords].sort((left, right) => left.capturedAt.getTime() - right.capturedAt.getTime());
  const firstRecord = sortedRecords[0];
  const latest = sortedRecords[sortedRecords.length - 1];
  const preliminaryStart = new Date(Math.max(
    period.start.getTime(),
    assignmentWindow?.assignmentStart ?? firstRecord.capturedAt.getTime()
  ));
  const preliminaryEnd = new Date(Math.min(
    period.calculationEnd.getTime(),
    assignmentWindow?.assignmentEnd ?? period.end.getTime()
  ));
  const preliminarySegments = preliminaryEnd > preliminaryStart
    ? buildMergedTimelineSegments(sortedRecords, preliminaryStart, preliminaryEnd)
    : [];
  const preliminaryActive = preliminarySegments.filter((segment) => segment.type === "ACTIVE");
  const firstActive = preliminaryActive[0] ?? null;
  const lastActive = preliminaryActive[preliminaryActive.length - 1] ?? null;
  const plannedStart = plannedShift ? new Date(plannedShift.start).getTime() : null;
  const plannedEnd = plannedShift ? new Date(plannedShift.end).getTime() : null;
  const metricStartMs = plannedStart !== null
    ? Math.min(plannedStart, firstActive?.start.getTime() ?? plannedStart)
    : firstActive?.start.getTime() ?? firstRecord.capturedAt.getTime();
  const observedPlannedEnd = plannedEnd !== null
    ? Math.min(plannedEnd, period.calculationEnd.getTime())
    : latest.capturedAt.getTime();
  const metricEndMs = Math.max(
    metricStartMs,
    observedPlannedEnd,
    lastActive?.end.getTime() ?? latest.capturedAt.getTime()
  );
  const metricEnd = new Date(Math.min(metricEndMs, period.calculationEnd.getTime(), period.end.getTime()));
  const metricStart = new Date(Math.min(metricStartMs, metricEnd.getTime()));
  return metricEnd > metricStart
    ? buildMergedTimelineSegments(sortedRecords, metricStart, metricEnd)
    : [];
}

function buildRealtimeHoursTimelineRow({
  personKey,
  slotRecords,
  employee,
  employeeId,
  wbLogin,
  plannedShift,
  assignmentWindow,
  period,
  fallbackIndex = 0
}: {
  personKey: string;
  slotRecords: TimelineRecordWithIdentity[];
  employee: TimelineEmployee | undefined;
  employeeId: string;
  wbLogin: string;
  plannedShift: RealtimeHoursPlannedShift | null;
  assignmentWindow: RealtimeHoursSlotAssignmentWindow | null;
  period: RealtimeHoursTimelinePeriod;
  fallbackIndex?: number;
}) {
  const sortedRecords = [...slotRecords].sort((left, right) => left.capturedAt.getTime() - right.capturedAt.getTime());
  const latest = sortedRecords[sortedRecords.length - 1];
  const segments = buildRealtimeHoursCapturedSegments(sortedRecords, plannedShift, assignmentWindow, period);
  const plannedStart = plannedShift ? new Date(plannedShift.start).getTime() : null;
  const plannedEnd = plannedShift ? new Date(plannedShift.end).getTime() : null;
  const activeSegments = segments.filter((segment) => segment.type === "ACTIVE");
  const entryAt = activeSegments[0]?.start ?? null;
  const exitAt = activeSegments[activeSegments.length - 1]?.end ?? null;
  const activeMs = wholeSecondsMs(activeSegments.reduce((sum, segment) => sum + segment.durationMs, 0));
  const noActivityMs = wholeSecondsMs(segments
    .filter((segment) => segment.type === "NO_ACTIVITY")
    .reduce((sum, segment) => sum + segment.durationMs, 0));
  const arrivalDelayMs = wholeSecondsMs(plannedStart !== null
    ? entryAt
      ? Math.max(0, entryAt.getTime() - plannedStart)
      : Math.max(0, Math.min(period.calculationEnd.getTime(), plannedEnd ?? plannedStart) - plannedStart)
    : 0);
  const earlyDepartureMs = wholeSecondsMs(plannedEnd !== null
    && period.calculationEnd.getTime() >= plannedEnd
    && exitAt
    ? Math.max(0, plannedEnd - exitAt.getTime())
    : 0);
  const devicesByKey = new Map<string, TimelineRecordWithIdentity>();
  for (const record of sortedRecords) {
    const deviceKey = identityKey(record.hostname, record.windowsUser) || `${record.hostname.trim().toLowerCase()}::`;
    const current = devicesByKey.get(deviceKey);
    if (!current || record.capturedAt > current.capturedAt) devicesByKey.set(deviceKey, record);
  }
  const devices = Array.from(devicesByKey.values())
    .map((record) => ({
      hostname: record.hostname,
      windowsUser: record.windowsUser ?? "",
      ipAddress: record.ipAddress ?? "",
      lastSeenAt: record.capturedAt.toISOString()
    }))
    .sort((left, right) => left.hostname.localeCompare(right.hostname));
  const data = plannedShift?.sourceDate ?? fallbackDataFor(sortedRecords, period.date);
  const slotId = plannedShift?.id ?? null;

  return {
    key: `${personKey}:slot:${slotId ?? `${data}:fallback:${fallbackIndex}`}`,
    data,
    slotId,
    hostname: latest.hostname,
    windowsUser: latest.windowsUser ?? "",
    hostnames: devices.map((device) => device.hostname),
    windowsUsers: Array.from(new Set(devices.map((device) => device.windowsUser).filter(Boolean))),
    deviceCount: devices.length,
    devices,
    wbLogin,
    employeeId,
    employeeName: employee?.fullName ?? "",
    roleTitle: employee?.roleTitle ?? "",
    lob: employee?.lob?.name ?? "",
    shift: employee?.shift?.name ?? "",
    supervisor: employee?.supervisor?.fullName ?? "Sem supervisor",
    ipAddress: latest.ipAddress ?? "",
    lastSeenAt: latest.capturedAt.toISOString(),
    currentStatus: resolveRealtimeHoursPresenceStatus(latest, period.calculationEnd),
    activeMs,
    noActivityMs,
    entryAt: entryAt?.toISOString() ?? null,
    exitAt: exitAt?.toISOString() ?? null,
    arrivalDelayMs,
    earlyDepartureMs,
    sessionCount: activeSegments.length,
    plannedShifts: plannedShift ? [plannedShift] : [],
    segments: segments.map((segment) => ({
      type: segment.type,
      start: segment.start.toISOString(),
      end: segment.end.toISOString(),
      durationMs: segment.durationMs
    }))
  };
}

function splitFallbackTimelineRecords(records: TimelineRecordWithIdentity[]) {
  const maximumFallbackGapMs = 8 * 60 * 60 * 1_000;
  const sorted = [...records].sort((left, right) => left.capturedAt.getTime() - right.capturedAt.getTime());
  const groups: TimelineRecordWithIdentity[][] = [];
  for (const record of sorted) {
    const current = groups[groups.length - 1];
    const previous = current?.[current.length - 1];
    if (!current || !previous || record.capturedAt.getTime() - previous.capturedAt.getTime() > maximumFallbackGapMs) {
      groups.push([record]);
    } else {
      current.push(record);
    }
  }
  return groups;
}

function fallbackDataFor(records: TimelineRecordWithIdentity[], referenceDate: string) {
  const firstEntry = records.find((record) => record.isSessionActive);
  return firstEntry ? saoPauloDateKey(firstEntry.capturedAt) : referenceDate;
}

function wholeSecondsMs(value: number) {
  return Math.max(0, Math.floor(value / 1_000) * 1_000);
}

function normalizeRecord(rawRecord: unknown, rowNumber: number, capturedAt: Date): NormalizeRecordResult {
  if (!isPlainObject(rawRecord)) {
    return { error: { rowNumber, error: "Registro precisa ser um objeto JSON." } };
  }

  const parsed = realtimeHoursRecordSchema.safeParse(rawRecord);
  if (!parsed.success) {
    return { error: { rowNumber, error: zodErrorMessages(parsed.error).join("; ") } };
  }

  const lastActivityAt = parsed.data.lastActivityAt ? parseDate(parsed.data.lastActivityAt) : null;
  if (parsed.data.lastActivityAt && !lastActivityAt) {
    return { error: { rowNumber, error: "lastActivityAt inválido." } };
  }

  return {
    record: {
      eventId: parsed.data.eventId ?? null,
      eventType: parsed.data.eventType ?? null,
      sessionId: parsed.data.sessionId ?? null,
      sessionState: parsed.data.sessionState ?? null,
      capturedAt,
      hostname: parsed.data.hostname,
      windowsUser: parsed.data.windowsUser ?? null,
      wbLogin: parsed.data.wbLogin ? normalizeLogin(parsed.data.wbLogin) : null,
      employeeId: parsed.data.employeeId ?? null,
      ipAddress: parsed.data.ipAddress ?? null,
      isSessionActive: parsed.data.isSessionActive ?? false,
      isInputActive: parsed.data.isInputActive ?? null,
      idleSeconds: parsed.data.idleSeconds ?? null,
      lastActivityAt,
      activeProcessName: parsed.data.activeProcessName ?? null,
      activeWindowTitle: parsed.data.activeWindowTitle ?? null,
      identitySource: parsed.data.identitySource ?? null,
      identityConfidence: parsed.data.identityConfidence,
      agentVersion: parsed.data.agentVersion ?? null,
      rawData: toJsonValue(rawRecord)
    }
  };
}

async function applyRealtimeHoursIdentityMappings(records: NormalizedRealtimeHoursRecord[]) {
  const mappings = await mappingLookupFor(records);
  for (const record of records) {
    const mapping = mappings.get(identityKey(record.hostname, record.windowsUser));
    if (!mapping) continue;
    record.wbLogin = mapping.wbLogin;
    record.employeeId = mapping.employeeId ?? null;
    record.identitySource = "manual_site_mapping";
    record.identityConfidence = "HIGH";
  }
}

async function loadRecentRealtimeHoursStatusRecords(limit: number) {
  const statusSince = new Date(Date.now() - staleThresholdMinutes * 60_000);
  const candidates = await prisma.realTimeHoursRecord.findMany({
    where: { capturedAt: { gte: statusSince } },
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
    take: Math.min(20_000, Math.max(5_000, limit * 20)),
    select: {
      id: true,
      eventType: true,
      sessionId: true,
      sessionState: true,
      agentVersion: true,
      capturedAt: true,
      hostname: true,
      windowsUser: true,
      wbLogin: true,
      employeeId: true,
      ipAddress: true,
      isSessionActive: true,
      isInputActive: true,
      idleSeconds: true,
      activeProcessName: true,
      activeWindowTitle: true,
      lastActivityAt: true,
      identitySource: true,
      identityConfidence: true,
      createdAt: true
    }
  });
  const latestByIdentity = new Map<string, typeof candidates[number]>();
  for (const record of candidates) {
    const key = identityKey(record.hostname, record.windowsUser) || record.hostname.trim().toLowerCase();
    if (!latestByIdentity.has(key)) latestByIdentity.set(key, record);
  }
  return Array.from(latestByIdentity.values());
}

async function mappingLookupFor(records: Array<{ hostname: string; windowsUser: string | null }>) {
  const keys = new Set(records.map((record) => identityKey(record.hostname, record.windowsUser)).filter(Boolean));
  if (!keys.size) return new Map<string, { hostname: string; windowsUser: string; wbLogin: string; employeeId: string | null }>();

  const mappings = await prisma.realTimeHoursIdentityMapping.findMany({
    where: {
      OR: Array.from(keys).map((key) => {
        const [hostname, windowsUser] = key.split("::");
        return {
          hostname: { equals: hostname, mode: "insensitive" as const },
          windowsUser: { equals: windowsUser, mode: "insensitive" as const }
        };
      })
    },
    select: {
      hostname: true,
      windowsUser: true,
      wbLogin: true,
      employeeId: true
    }
  });

  return new Map(mappings.map((mapping) => [identityKey(mapping.hostname, mapping.windowsUser), mapping]));
}

async function employeeLookupFor(entries: Array<{ employeeId?: string | null; wbLogin?: string | null }>) {
  const ids = Array.from(new Set(entries.map((entry) => entry.employeeId).filter(Boolean) as string[]));
  const wbLogins = Array.from(new Set(entries.map((entry) => entry.wbLogin).filter(Boolean).map((value) => normalizeLogin(String(value)))));
  const employees = ids.length || wbLogins.length
    ? await prisma.employeeProfile.findMany({
      where: {
        OR: [
          ...(ids.length ? [{ id: { in: ids } }] : []),
          ...wbLogins.map((wbLogin) => ({ wbLogin: { equals: wbLogin, mode: "insensitive" as const } }))
        ]
      },
      select: {
        id: true,
        wbLogin: true,
        fullName: true,
        roleTitle: true,
        skill: true,
        operationalStatus: true,
        lob: { select: { name: true } },
        shift: { select: { name: true, startsAt: true, endsAt: true } },
        supervisor: { select: { fullName: true } }
      }
    })
    : [];

  const lookup = new Map<string, typeof employees[number]>();
  for (const employee of employees) {
    lookup.set(employeeKey(employee.id, null), employee);
    lookup.set(employeeKey(null, employee.wbLogin), employee);
  }
  return lookup;
}

export function resolveRealtimeHoursPresenceStatus(
  record: RealtimeHoursPresenceRecord,
  referenceTime: Date,
  thresholdSeconds = idleThresholdSeconds
): RealtimeHoursPresenceStatus {
  const isFresh = referenceTime.getTime() - record.capturedAt.getTime() <= staleThresholdMinutes * 60_000;
  const sessionState = String(record.sessionState ?? "").trim().toUpperCase();
  if (!isFresh) return "OFFLINE";
  if (sessionState === "LOCKED") return "LOCKED";
  if (!record.isSessionActive || sessionState === "DISCONNECTED") return "OFFLINE";
  if ((record.idleSeconds ?? 0) > Math.max(600, thresholdSeconds)) return "IDLE";
  return "ONLINE";
}

export function selectRealtimeHoursPresenceRecord<T extends RealtimeHoursPresenceRecord>(
  records: T[],
  referenceTime: Date,
  thresholdSeconds = idleThresholdSeconds
) {
  const priority: Record<RealtimeHoursPresenceStatus, number> = {
    ONLINE: 4,
    IDLE: 3,
    LOCKED: 2,
    OFFLINE: 1
  };

  return records.reduce<T | null>((selected, candidate) => {
    if (!selected) return candidate;
    const candidateStatus = resolveRealtimeHoursPresenceStatus(candidate, referenceTime, thresholdSeconds);
    const selectedStatus = resolveRealtimeHoursPresenceStatus(selected, referenceTime, thresholdSeconds);
    const statusDifference = priority[candidateStatus] - priority[selectedStatus];
    if (statusDifference !== 0) return statusDifference > 0 ? candidate : selected;
    return candidate.capturedAt > selected.capturedAt ? candidate : selected;
  }, null);
}
export function buildTimelineSegments(
  records: TimelineRecord[],
  start: Date,
  end: Date
): TimelineSegment[] {
  const heartbeatMs = timelineHeartbeatSeconds * 1_000;
  const maxGapMs = timelineMaxGapSeconds * 1_000;
  const startMs = start.getTime();
  const endMs = end.getTime();
  const pointIndex = new Map<string, {
    at: Date;
    type: TimelineSegment["type"];
    isSessionEnd: boolean;
  }>();

  for (const record of records) {
    const isActive = record.isSessionActive && (record.idleSeconds ?? 0) <= activityIdleThresholdSeconds;
    const capturedAt = record.capturedAt.getTime();
    const pointMs = capturedAt;

    if (pointMs < startMs || pointMs > endMs) continue;

    const key = String(pointMs);
    const type: TimelineSegment["type"] = isActive ? "ACTIVE" : "NO_ACTIVITY";
    const isSessionEnd = record.eventType === "SESSION_END";
    const current = pointIndex.get(key);
    if (!current || isSessionEnd || (!current.isSessionEnd && current.type === "NO_ACTIVITY" && type === "ACTIVE")) {
      pointIndex.set(key, { at: new Date(pointMs), type, isSessionEnd });
    }
  }

  const sorted = Array.from(pointIndex.values()).sort((a, b) => a.at.getTime() - b.at.getTime());
  const segments: TimelineSegment[] = [];
  let cursor = startMs;

  sorted.forEach((point, index) => {
    const pointStart = Math.min(Math.max(point.at.getTime(), startMs), endMs);
    if (pointStart > cursor) appendTimelineSegment(segments, "NO_ACTIVITY", new Date(cursor), new Date(pointStart));

    const next = sorted[index + 1]?.at.getTime();
    const expectedEnd = Math.min(pointStart + heartbeatMs, endMs);
    const segmentEnd = next && next > pointStart && next - pointStart <= maxGapMs
      ? Math.min(next, endMs)
      : expectedEnd;

    appendTimelineSegment(segments, point.type, new Date(pointStart), new Date(segmentEnd));
    cursor = Math.max(cursor, segmentEnd);
  });

  if (cursor < endMs) appendTimelineSegment(segments, "NO_ACTIVITY", new Date(cursor), end);
  return segments;
}

export function buildMergedTimelineSegments(records: TimelineDeviceRecord[], start: Date, end: Date): TimelineSegment[] {
  const recordsByDevice = new Map<string, TimelineDeviceRecord[]>();
  for (const record of records) {
    const key = identityKey(record.hostname, record.windowsUser) || `${record.hostname.trim().toLowerCase()}::`;
    const deviceRecords = recordsByDevice.get(key) ?? [];
    deviceRecords.push(record);
    recordsByDevice.set(key, deviceRecords);
  }

  const activeSegments = Array.from(recordsByDevice.values())
    .flatMap((deviceRecords) => buildTimelineSegments(
      deviceRecords.sort((left, right) => left.capturedAt.getTime() - right.capturedAt.getTime()),
      start,
      end
    ))
    .filter((segment) => segment.type === "ACTIVE")
    .sort((left, right) => left.start.getTime() - right.start.getTime());

  const mergedActive: TimelineSegment[] = [];
  for (const segment of activeSegments) {
    const previous = mergedActive[mergedActive.length - 1];
    if (previous && segment.start.getTime() <= previous.end.getTime()) {
      const nextEnd = Math.max(previous.end.getTime(), segment.end.getTime());
      previous.end = new Date(nextEnd);
      previous.durationMs = nextEnd - previous.start.getTime();
      continue;
    }
    mergedActive.push({ ...segment });
  }

  const timeline: TimelineSegment[] = [];
  let cursor = start.getTime();
  for (const segment of mergedActive) {
    if (segment.start.getTime() > cursor) {
      appendTimelineSegment(timeline, "NO_ACTIVITY", new Date(cursor), segment.start);
    }
    appendTimelineSegment(timeline, "ACTIVE", segment.start, segment.end);
    cursor = Math.max(cursor, segment.end.getTime());
  }
  if (cursor < end.getTime()) appendTimelineSegment(timeline, "NO_ACTIVITY", new Date(cursor), end);
  return timeline;
}

export function realtimeHoursTimelinePersonKey(input: {
  employeeId?: string | null;
  wbLogin?: string | null;
  hostname: string;
  windowsUser?: string | null;
}) {
  const employeeId = String(input.employeeId ?? "").trim();
  if (employeeId) return `employee:${employeeId}`;
  const wbLogin = normalizeLogin(String(input.wbLogin ?? ""));
  if (wbLogin) return `wb:${wbLogin}`;
  const deviceKey = identityKey(input.hostname, input.windowsUser) || `${input.hostname.trim().toLowerCase()}::`;
  return `device:${deviceKey}`;
}

function appendTimelineSegment(segments: TimelineSegment[], type: TimelineSegment["type"], start: Date, end: Date) {
  const durationMs = Math.max(0, end.getTime() - start.getTime());
  if (!durationMs) return;
  const previous = segments[segments.length - 1];
  if (previous?.type === type && previous.end.getTime() === start.getTime()) {
    previous.end = end;
    previous.durationMs += durationMs;
    return;
  }
  segments.push({ type, start, end, durationMs });
}

function resolveTimelineDate(value?: string | null) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) ? String(value) : todayInSaoPaulo();
  const start = startOfSaoPauloDate(date);
  const end = startOfSaoPauloDate(addDateKeyDays(date, 2));
  const queryStart = new Date(start.getTime() - 8 * 60 * 60 * 1_000);
  const now = new Date();
  const calculationEnd = start.getTime() > now.getTime()
    ? start
    : new Date(Math.min(now.getTime(), end.getTime()));
  return {
    date,
    start,
    end,
    queryStart,
    calculationEnd
  };
}

function todayInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function identityKey(hostname?: string | null, windowsUser?: string | null) {
  const host = String(hostname ?? "").trim().toLowerCase();
  const user = String(windowsUser ?? "").trim().toLowerCase();
  return host && user ? `${host}::${user}` : "";
}

function employeeKey(employeeId?: string | null, wbLogin?: string | null) {
  if (employeeId) return `id:${employeeId}`;
  return wbLogin ? `wb:${normalizeLogin(wbLogin)}` : "";
}

function normalizeSearch(value?: string | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function summarizeStatus(records: Array<{
  capturedAt: Date;
  hostname: string;
  wbLogin: string | null;
  employeeId: string | null;
  sessionState: string | null;
  isSessionActive: boolean;
  idleSeconds: number | null;
  identityConfidence: string;
}>) {
  const hostnames = new Set(records.map((record) => record.hostname));
  const referenceTime = new Date();
  const statuses = records.map((record) => resolveRealtimeHoursPresenceStatus(record, referenceTime));
  const online = statuses.filter((status) => status === "ONLINE").length;
  const idle = statuses.filter((status) => status === "IDLE").length;
  const locked = statuses.filter((status) => status === "LOCKED").length;
  const offline = statuses.filter((status) => status === "OFFLINE").length;
  const highConfidence = records.filter((record) => record.identityConfidence === "HIGH").length;
  const mediumConfidence = records.filter((record) => record.identityConfidence === "MEDIUM").length;
  const lowConfidence = records.filter((record) => record.identityConfidence === "LOW").length;
  const unknownIdentity = records.filter((record) => record.identityConfidence === "UNKNOWN" && !record.wbLogin && !record.employeeId).length;

  return {
    totalRecords: records.length,
    distinctHosts: hostnames.size,
    activeSessions: online + idle,
    inactiveSessions: locked + offline,
    idleSessions: idle,
    lockedSessions: locked,
    identifiedRecords: records.length - unknownIdentity,
    unknownIdentityRecords: unknownIdentity,
    identityConfidence: {
      high: highConfidence,
      medium: mediumConfidence,
      low: lowConfidence,
      unknown: records.length - highConfidence - mediumConfidence - lowConfidence
    }
  };
}

function emptyStatusSummary() {
  return {
    totalRecords: 0,
    distinctHosts: 0,
    activeSessions: 0,
    inactiveSessions: 0,
    idleSessions: 0,
    lockedSessions: 0,
    identifiedRecords: 0,
    unknownIdentityRecords: 0,
    identityConfidence: {
      high: 0,
      medium: 0,
      low: 0,
      unknown: 0
    }
  };
}

function optionalString(max: number) {
  return z.preprocess(blankToUndefined, z.string().trim().max(max).optional());
}

function optionalNonNegativeInt(max: number) {
  return z.preprocess((value) => {
    const normalized = blankToUndefined(value);
    if (typeof normalized === "string" && /^-?\d+$/.test(normalized.trim())) return Number(normalized);
    return normalized;
  }, z.number().int().min(0).max(max).optional());
}

function optionalBoolean() {
  return z.preprocess((value) => {
    const normalized = blankToUndefined(value);
    if (typeof normalized !== "string") return normalized;
    const lower = normalized.trim().toLowerCase();
    if (["true", "1", "sim", "yes"].includes(lower)) return true;
    if (["false", "0", "nao", "não", "no"].includes(lower)) return false;
    return normalized;
  }, z.boolean().optional());
}

function blankToUndefined(value: unknown) {
  if (value === null || typeof value === "undefined") return undefined;
  if (typeof value === "string" && !value.trim()) return undefined;
  return value;
}

function parseDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function realtimeHoursSharedBatchId(source: string, capturedAt: Date) {
  if (source !== "direct-windows-agent") return null;
  const minute = new Date(Math.floor(capturedAt.getTime() / 60_000) * 60_000)
    .toISOString()
    .slice(0, 16)
    .replace(/[-:T]/g, "");
  return `direct-windows-agent-${minute}`;
}

function parseLimit(value: string | number | null | undefined, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

function zodErrorMessages(error: z.ZodError) {
  return error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "payload";
    return `${path}: ${issue.message}`;
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeLogin(value: string) {
  return value.trim().toLowerCase();
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function safeEqualString(actual: string, expected: string) {
  const actualHash = createHash("sha256").update(actual).digest("hex");
  const expectedHash = createHash("sha256").update(expected).digest("hex");
  return timingSafeEqual(Buffer.from(actualHash, "hex"), Buffer.from(expectedHash, "hex"));
}
