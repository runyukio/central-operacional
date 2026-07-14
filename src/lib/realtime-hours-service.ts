import { createHash, timingSafeEqual } from "crypto";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { canAccessRealTime } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { canManageRealtimeHoursMappings } from "@/lib/realtime-hours-permissions";
import { parseWorkHoursToMinutes } from "@/lib/work-hours-rules";

const defaultSource = "local-windows-server";
const defaultStatusLimit = 200;
const maxStatusLimit = 1000;
const defaultImportsLimit = 30;
const maxImportsLimit = 100;
const maxRecordsPerImport = Number.parseInt(process.env.REALTIME_HOURS_MAX_RECORDS_PER_IMPORT ?? "1000", 10) || 1000;
const staleThresholdMinutes = Number.parseInt(process.env.REALTIME_HOURS_STALE_MINUTES ?? "15", 10) || 15;
const idleThresholdSeconds = Number.parseInt(process.env.REALTIME_HOURS_IDLE_SECONDS ?? "300", 10) || 300;
const legacyTimelineHeartbeatMinutes = Number.parseInt(process.env.REALTIME_HOURS_TIMELINE_HEARTBEAT_MINUTES ?? "", 10);
const legacyTimelineMaxGapMinutes = Number.parseInt(process.env.REALTIME_HOURS_TIMELINE_MAX_GAP_MINUTES ?? "", 10);
const timelineHeartbeatSeconds = Number.parseInt(process.env.REALTIME_HOURS_TIMELINE_HEARTBEAT_SECONDS ?? "", 10)
  || (Number.isFinite(legacyTimelineHeartbeatMinutes) ? legacyTimelineHeartbeatMinutes * 60 : 120);
const timelineMaxGapSeconds = Number.parseInt(process.env.REALTIME_HOURS_TIMELINE_MAX_GAP_SECONDS ?? "", 10)
  || (Number.isFinite(legacyTimelineMaxGapMinutes) ? legacyTimelineMaxGapMinutes * 60 : 180);
const configuredRetentionDays = Number.parseInt(process.env.REALTIME_HOURS_RETENTION_DAYS ?? "90", 10);
const retentionDays = Number.isFinite(configuredRetentionDays)
  ? Math.min(730, Math.max(7, configuredRetentionDays))
  : 90;
const identityConfidences = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;
const realtimeHoursEventTypes = ["SESSION_START", "SESSION_RESUME", "HEARTBEAT", "SESSION_END"] as const;

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
};

type RealtimeHoursIdentityMappingInput = {
  hostname?: unknown;
  windowsUser?: unknown;
  wbLogin?: unknown;
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

type TimelineSchedule = {
  employeeId: string;
  date: Date;
  startsAt: string | null;
  endsAt: string | null;
  status: string;
  shift: {
    name: string;
    startsAt: string;
    endsAt: string;
  } | null;
};

const scheduleStatusesWithoutPlannedWork = new Set([
  "AFASTADO",
  "DESLIGADO",
  "ERRO_ESCALA",
  "FERIADO",
  "FERIAS",
  "FOLGA",
  "FOLGA_APROVADA",
  "SEM_ESCALA"
]);

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
  if (!canAccessRealTime({ role: actor.role, email: actor.email, name: actor.name, roleTitle: actor.roleTitle, jobTitle: actor.jobTitle, skill: actor.skill, status: "ACTIVE" })) {
    return { error: "Você não tem permissão para acessar a captura de horas em tempo real.", status: 403 };
  }

  return { ok: true };
}

export async function authorizeRealtimeHoursManage() {
  const actor = await getApiActor();
  if (!canManageRealtimeHoursMappings(actor.email)) {
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
    const created = await tx.realTimeHoursImportBatch.create({
      data: {
        source,
        capturedAt,
        status,
        rowsTotal: parsed.data.records.length,
        rowsValid: recordsToInsert.length,
        rowsError: rowErrors.length,
        errorSummary: rowErrors.length ? rowErrors.slice(0, 50) : Prisma.JsonNull
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

    if (insertedCount !== recordsToInsert.length) {
      if (insertedCount === 0) {
        await tx.realTimeHoursImportBatch.delete({ where: { id: created.id } });
        return { created: null, insertedCount };
      }
      await tx.realTimeHoursImportBatch.update({
        where: { id: created.id },
        data: { rowsValid: insertedCount }
      });
    }

    return { created, insertedCount };
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
    rowsProcessed: batch.created.rowsTotal,
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
  const summaryRecords = Array.from(latestByIdentity.values());
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
  const deleted = await prisma.realTimeHoursImportBatch.deleteMany({
    where: { capturedAt: { lt: cutoff } }
  });

  return {
    success: true,
    retentionDays,
    cutoff: cutoff.toISOString(),
    batchesDeleted: deleted.count
  };
}

export async function listRealtimeHoursIdentityMappings() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
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
            lob: { select: { name: true } },
            shift: { select: { name: true, startsAt: true, endsAt: true } }
          }
        }
      }
    }),
    prisma.realTimeHoursRecord.findMany({
      where: { capturedAt: { gte: since } },
      orderBy: { capturedAt: "desc" },
      take: 5000,
      select: {
        hostname: true,
        windowsUser: true,
        wbLogin: true,
        employeeId: true,
        capturedAt: true,
        identityConfidence: true
      }
    })
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
      recordCount: (current?.recordCount ?? 0) + 1,
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
      shift: { select: { name: true } }
    }
  });

  if (!employee) {
    return { success: false, error: "WB/Login não encontrado no Mapa de Funcionários.", message: "WB/Login não encontrado no Mapa de Funcionários.", status: 404 };
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
            shift: { select: { name: true } }
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

export async function getRealtimeHoursTimeline(options: RealtimeHoursTimelineOptions = {}) {
  const period = resolveTimelineDate(options.date);
  const records = await prisma.realTimeHoursRecord.findMany({
    where: {
      capturedAt: {
        gte: period.start,
        lte: period.end
      }
    },
    orderBy: [{ hostname: "asc" }, { windowsUser: "asc" }, { capturedAt: "asc" }],
    select: {
      id: true,
      eventType: true,
      capturedAt: true,
      hostname: true,
      windowsUser: true,
      wbLogin: true,
      employeeId: true,
      ipAddress: true,
      isSessionActive: true,
      idleSeconds: true,
      activeProcessName: true,
      activeWindowTitle: true,
      lastActivityAt: true,
      identityConfidence: true
    }
  });

  const mappings = await mappingLookupFor(records);
  const employees = await employeeLookupFor(records.map((record) => {
    const mapping = mappings.get(identityKey(record.hostname, record.windowsUser));
    return {
      employeeId: mapping?.employeeId ?? record.employeeId,
      wbLogin: mapping?.wbLogin ?? record.wbLogin
    };
  }));

  const employeeIds = Array.from(new Set(Array.from(employees.values()).map((employee) => employee.id)));
  const selectedScheduleDate = new Date(`${period.date}T00:00:00.000Z`);
  const previousScheduleDate = new Date(selectedScheduleDate.getTime() - 24 * 60 * 60 * 1000);
  const schedules = employeeIds.length
    ? await prisma.schedule.findMany({
      where: {
        employeeId: { in: employeeIds },
        date: { in: [previousScheduleDate, selectedScheduleDate] },
        deletedAt: null
      },
      select: {
        employeeId: true,
        date: true,
        startsAt: true,
        endsAt: true,
        status: true,
        shift: { select: { name: true, startsAt: true, endsAt: true } }
      }
    })
    : [];
  const schedulesByEmployeeId = new Map<string, TimelineSchedule[]>();
  for (const schedule of schedules) {
    const employeeSchedules = schedulesByEmployeeId.get(schedule.employeeId) ?? [];
    employeeSchedules.push(schedule);
    schedulesByEmployeeId.set(schedule.employeeId, employeeSchedules);
  }

  const groups = new Map<string, Array<{
    record: typeof records[number];
    employeeId: string;
    wbLogin: string;
  }>>();
  for (const record of records) {
    const deviceKey = identityKey(record.hostname, record.windowsUser) || `${record.hostname.trim().toLowerCase()}::`;
    const mapping = mappings.get(deviceKey);
    const employee = employees.get(employeeKey(mapping?.employeeId ?? record.employeeId, mapping?.wbLogin ?? record.wbLogin));
    const employeeId = mapping?.employeeId ?? employee?.id ?? record.employeeId ?? "";
    const wbLogin = mapping?.wbLogin ?? employee?.wbLogin ?? record.wbLogin ?? "";
    const key = realtimeHoursTimelinePersonKey({ employeeId, wbLogin, hostname: record.hostname, windowsUser: record.windowsUser });
    const group = groups.get(key) ?? [];
    group.push({ record, employeeId, wbLogin });
    groups.set(key, group);
  }

  const search = normalizeSearch(options.search);
  const rows = Array.from(groups.entries()).map(([key, group]) => {
    const latestItem = group.reduce((latest, item) => item.record.capturedAt > latest.record.capturedAt ? item : latest);
    const latest = latestItem.record;
    const employeeId = latestItem.employeeId || group.find((item) => item.employeeId)?.employeeId || "";
    const wbLogin = latestItem.wbLogin || group.find((item) => item.wbLogin)?.wbLogin || "";
    const employee = employees.get(employeeKey(employeeId, wbLogin));
    const segments = buildMergedTimelineSegments(group.map((item) => item.record), period.start, period.calculationEnd);
    const activeMs = segments.filter((segment) => segment.type === "ACTIVE").reduce((sum, segment) => sum + segment.durationMs, 0);
    const noActivityMs = Math.max(0, period.calculationEnd.getTime() - period.start.getTime() - activeMs);
    const sessionCount = segments.filter((segment) => segment.type === "ACTIVE").length;
    const devicesByKey = new Map<string, typeof records[number]>();
    for (const item of group) {
      const record = item.record;
      const deviceKey = identityKey(record.hostname, record.windowsUser) || `${record.hostname.trim().toLowerCase()}::`;
      const current = devicesByKey.get(deviceKey);
      if (!current || record.capturedAt > current.capturedAt) devicesByKey.set(deviceKey, record);
    }
    const devices = Array.from(devicesByKey.values())
      .map((latestDeviceRecord) => {
        return {
          hostname: latestDeviceRecord.hostname,
          windowsUser: latestDeviceRecord.windowsUser ?? "",
          ipAddress: latestDeviceRecord.ipAddress ?? "",
          lastSeenAt: latestDeviceRecord.capturedAt.toISOString()
        };
      })
      .sort((left, right) => left.hostname.localeCompare(right.hostname));
    const plannedShifts = employee
      ? buildPlannedShiftWindows(
        schedulesByEmployeeId.get(employeeId || employee.id) ?? [],
        employee.shift,
        period.start,
        period.end
      )
      : [];

    return {
      key,
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
      ipAddress: latest.ipAddress ?? "",
      lastSeenAt: latest.capturedAt.toISOString(),
      activeMs,
      noActivityMs,
      sessionCount,
      plannedShifts,
      segments: segments.map((segment) => ({
        type: segment.type,
        start: segment.start.toISOString(),
        end: segment.end.toISOString(),
        durationMs: segment.durationMs
      }))
    };
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
    return left.localeCompare(right);
  });

  return {
    success: true,
    date: period.date,
    window: {
      start: period.start.toISOString(),
      end: period.end.toISOString(),
      calculationEnd: period.calculationEnd.toISOString()
    },
    summary: {
      users: rows.length,
      activeMs: rows.reduce((sum, row) => sum + row.activeMs, 0),
      noActivityMs: rows.reduce((sum, row) => sum + row.noActivityMs, 0),
      sessions: rows.reduce((sum, row) => sum + row.sessionCount, 0)
    },
    rows
  };
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
        lob: { select: { name: true } },
        shift: { select: { name: true, startsAt: true, endsAt: true } }
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

function buildPlannedShiftWindows(
  schedules: TimelineSchedule[],
  employeeShift: { name: string; startsAt: string; endsAt: string },
  windowStart: Date,
  windowEnd: Date
) {
  const windows = schedules.flatMap((schedule) => {
    if (scheduleStatusesWithoutPlannedWork.has(schedule.status)) return [];

    const startMinutes = parseWorkHoursToMinutes(schedule.startsAt ?? schedule.shift?.startsAt ?? employeeShift.startsAt);
    const endMinutes = parseWorkHoursToMinutes(schedule.endsAt ?? schedule.shift?.endsAt ?? employeeShift.endsAt);
    if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) return [];

    const dateKey = schedule.date.toISOString().slice(0, 10);
    const localDayStart = new Date(`${dateKey}T00:00:00.000-03:00`).getTime();
    const plannedStartMs = localDayStart + startMinutes * 60_000;
    let plannedEndMs = localDayStart + endMinutes * 60_000;
    const overnight = plannedEndMs <= plannedStartMs;
    if (overnight) plannedEndMs += 24 * 60 * 60 * 1000;
    if (plannedEndMs <= windowStart.getTime() || plannedStartMs >= windowEnd.getTime()) return [];

    return [{
      start: new Date(plannedStartMs).toISOString(),
      end: new Date(plannedEndMs).toISOString(),
      startsAt: formatClockMinutes(startMinutes),
      endsAt: formatClockMinutes(endMinutes),
      status: schedule.status,
      shift: schedule.shift?.name ?? employeeShift.name,
      sourceDate: dateKey,
      overnight
    }];
  });

  return Array.from(new Map(windows.map((item) => [`${item.start}:${item.end}`, item])).values())
    .sort((left, right) => left.start.localeCompare(right.start));
}

function formatClockMinutes(minutes: number) {
  const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
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
    const isActive = record.isSessionActive;
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
  const start = new Date(`${date}T00:00:00.000-03:00`);
  const end = new Date(`${date}T23:59:59.999-03:00`);
  const now = new Date();
  const calculationEnd = date === todayInSaoPaulo()
    ? new Date(Math.min(now.getTime(), end.getTime()))
    : start.getTime() > now.getTime()
      ? start
      : end;
  return {
    date,
    start,
    end,
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
  hostname: string;
  wbLogin: string | null;
  employeeId: string | null;
  sessionState: string | null;
  isSessionActive: boolean;
  idleSeconds: number | null;
  identityConfidence: string;
}>) {
  const hostnames = new Set(records.map((record) => record.hostname));
  const active = records.filter((record) => record.isSessionActive).length;
  const idle = records.filter((record) => record.isSessionActive && (record.idleSeconds ?? 0) >= idleThresholdSeconds).length;
  const locked = records.filter((record) => (
    !record.isSessionActive
    && String(record.sessionState ?? "").trim().toUpperCase() === "LOCKED"
  )).length;
  const highConfidence = records.filter((record) => record.identityConfidence === "HIGH").length;
  const mediumConfidence = records.filter((record) => record.identityConfidence === "MEDIUM").length;
  const lowConfidence = records.filter((record) => record.identityConfidence === "LOW").length;
  const unknownIdentity = records.filter((record) => record.identityConfidence === "UNKNOWN" && !record.wbLogin && !record.employeeId).length;

  return {
    totalRecords: records.length,
    distinctHosts: hostnames.size,
    activeSessions: active,
    inactiveSessions: records.length - active,
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
