import { createHash, timingSafeEqual } from "crypto";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { canAccessRealTime } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { canManageRealtimeHoursMappings } from "@/lib/realtime-hours-permissions";

const defaultSource = "local-windows-server";
const defaultStatusLimit = 200;
const maxStatusLimit = 1000;
const defaultImportsLimit = 30;
const maxImportsLimit = 100;
const maxRecordsPerImport = Number.parseInt(process.env.REALTIME_HOURS_MAX_RECORDS_PER_IMPORT ?? "1000", 10) || 1000;
const staleThresholdMinutes = Number.parseInt(process.env.REALTIME_HOURS_STALE_MINUTES ?? "15", 10) || 15;
const idleThresholdSeconds = Number.parseInt(process.env.REALTIME_HOURS_IDLE_SECONDS ?? "300", 10) || 300;
const timelineHeartbeatMinutes = Number.parseInt(process.env.REALTIME_HOURS_TIMELINE_HEARTBEAT_MINUTES ?? "10", 10) || 10;
const timelineMaxGapMinutes = Number.parseInt(process.env.REALTIME_HOURS_TIMELINE_MAX_GAP_MINUTES ?? "15", 10) || 15;
const identityConfidences = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;

type RealtimeHoursRowError = {
  rowNumber: number;
  error: string;
};

type NormalizedRealtimeHoursRecord = {
  capturedAt: Date;
  hostname: string;
  windowsUser: string | null;
  wbLogin: string | null;
  employeeId: string | null;
  ipAddress: string | null;
  isSessionActive: boolean;
  idleSeconds: number | null;
  lastActivityAt: Date | null;
  activeProcessName: string | null;
  activeWindowTitle: string | null;
  identitySource: string | null;
  identityConfidence: string;
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

const realtimeHoursImportSchema = z.object({
  source: optionalString(120),
  capturedAt: z.string().trim().min(1, "capturedAt é obrigatório."),
  records: z.array(z.unknown()).min(1, "records precisa ter ao menos um registro.").max(maxRecordsPerImport, `records aceita no máximo ${maxRecordsPerImport} registros por importação.`)
}).passthrough();

const realtimeHoursRecordSchema = z.object({
  hostname: z.string().trim().min(1, "hostname é obrigatório.").max(120, "hostname deve ter no máximo 120 caracteres."),
  windowsUser: optionalString(120),
  wbLogin: optionalString(120),
  employeeId: optionalString(120),
  ipAddress: optionalString(64),
  isSessionActive: optionalBoolean(),
  idleSeconds: optionalNonNegativeInt(86_400),
  activeWindowTitle: optionalString(300),
  activeProcessName: optionalString(120),
  lastActivityAt: optionalString(80),
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

  await applyRealtimeHoursIdentityMappings(records);

  const source = parsed.data.source || defaultSource;
  const status = rowErrors.length ? "PARTIAL" : "SUCCESS";
  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.realTimeHoursImportBatch.create({
      data: {
        source,
        capturedAt,
        status,
        rowsTotal: parsed.data.records.length,
        rowsValid: records.length,
        rowsError: rowErrors.length,
        errorSummary: rowErrors.length ? rowErrors.slice(0, 50) : Prisma.JsonNull
      }
    });

    for (let index = 0; index < records.length; index += 1000) {
      const chunk = records.slice(index, index + 1000);
      await tx.realTimeHoursRecord.createMany({
        data: chunk.map((record) => ({
          ...record,
          batchId: created.id
        }))
      });
    }

    return created;
  });

  return {
    success: true,
    batchId: batch.id,
    source: batch.source,
    status: batch.status,
    capturedAt: batch.capturedAt.toISOString(),
    rowsProcessed: batch.rowsTotal,
    rowsValid: batch.rowsValid,
    rowsError: batch.rowsError,
    importedAt: batch.importedAt.toISOString(),
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

  const [summaryRecords, records] = await Promise.all([
    prisma.realTimeHoursRecord.findMany({
      where: { batchId: batch.id },
      select: {
        hostname: true,
        wbLogin: true,
        employeeId: true,
        isSessionActive: true,
        idleSeconds: true,
        identityConfidence: true
      }
    }),
    prisma.realTimeHoursRecord.findMany({
      where: { batchId: batch.id },
      orderBy: [{ hostname: "asc" }, { createdAt: "asc" }],
      take: limit,
      select: {
        id: true,
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
        identitySource: true,
        identityConfidence: true,
        createdAt: true
      }
    })
  ]);

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
      capturedAt: record.capturedAt.toISOString(),
      hostname: record.hostname,
      windowsUser: record.windowsUser ?? "",
      wbLogin: record.wbLogin ?? "",
      employeeId: record.employeeId ?? "",
      ipAddress: record.ipAddress ?? "",
      isSessionActive: record.isSessionActive,
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
            shift: { select: { name: true } }
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

  const groups = new Map<string, typeof records>();
  for (const record of records) {
    const key = identityKey(record.hostname, record.windowsUser) ?? `${record.hostname}::`;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }

  const search = normalizeSearch(options.search);
  const rows = Array.from(groups.entries()).map(([key, group]) => {
    const latest = group[group.length - 1];
    const mapping = mappings.get(key);
    const employee = employees.get(employeeKey(mapping?.employeeId ?? latest.employeeId, mapping?.wbLogin ?? latest.wbLogin));
    const segments = buildTimelineSegments(group, period.start, period.end);
    const activeMs = segments.filter((segment) => segment.type === "ACTIVE").reduce((sum, segment) => sum + segment.durationMs, 0);
    const noActivityMs = Math.max(0, period.end.getTime() - period.start.getTime() - activeMs);
    const sessionCount = segments.filter((segment) => segment.type === "ACTIVE").length;

    return {
      key,
      hostname: latest.hostname,
      windowsUser: latest.windowsUser ?? "",
      wbLogin: mapping?.wbLogin ?? employee?.wbLogin ?? latest.wbLogin ?? "",
      employeeId: mapping?.employeeId ?? employee?.id ?? latest.employeeId ?? "",
      employeeName: employee?.fullName ?? "",
      roleTitle: employee?.roleTitle ?? "",
      lob: employee?.lob?.name ?? "",
      shift: employee?.shift?.name ?? "",
      ipAddress: latest.ipAddress ?? "",
      lastSeenAt: latest.capturedAt.toISOString(),
      activeMs,
      noActivityMs,
      sessionCount,
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
      end: period.end.toISOString()
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
      capturedAt,
      hostname: parsed.data.hostname,
      windowsUser: parsed.data.windowsUser ?? null,
      wbLogin: parsed.data.wbLogin ? normalizeLogin(parsed.data.wbLogin) : null,
      employeeId: parsed.data.employeeId ?? null,
      ipAddress: parsed.data.ipAddress ?? null,
      isSessionActive: parsed.data.isSessionActive ?? false,
      idleSeconds: parsed.data.idleSeconds ?? null,
      lastActivityAt,
      activeProcessName: parsed.data.activeProcessName ?? null,
      activeWindowTitle: parsed.data.activeWindowTitle ?? null,
      identitySource: parsed.data.identitySource ?? null,
      identityConfidence: parsed.data.identityConfidence,
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
        shift: { select: { name: true } }
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

function buildTimelineSegments(
  records: Array<{ capturedAt: Date; lastActivityAt?: Date | null; isSessionActive: boolean; idleSeconds: number | null }>,
  start: Date,
  end: Date
): TimelineSegment[] {
  const usesActivityEvents = records.some((record) => record.lastActivityAt);
  const heartbeatMs = usesActivityEvents ? 60_000 : timelineHeartbeatMinutes * 60_000;
  const maxGapMs = usesActivityEvents ? 2 * 60_000 : timelineMaxGapMinutes * 60_000;
  const startMs = start.getTime();
  const endMs = end.getTime();
  const pointIndex = new Map<string, {
    at: Date;
    type: TimelineSegment["type"];
  }>();

  for (const record of records) {
    const isActive = record.isSessionActive;
    const activityAt = record.lastActivityAt?.getTime();
    const capturedAt = record.capturedAt.getTime();
    const pointMs =
      isActive && activityAt && activityAt >= startMs && activityAt <= endMs
        ? activityAt
        : capturedAt;

    if (pointMs < startMs || pointMs > endMs) continue;

    const roundedMinute = Math.floor(pointMs / 60_000);
    const key = String(roundedMinute);
    const type: TimelineSegment["type"] = isActive ? "ACTIVE" : "NO_ACTIVITY";
    const current = pointIndex.get(key);
    if (!current || (current.type === "NO_ACTIVITY" && type === "ACTIVE")) {
      pointIndex.set(key, { at: new Date(roundedMinute * 60_000), type });
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
  return {
    date,
    start: new Date(`${date}T00:00:00.000-03:00`),
    end: new Date(`${date}T23:59:59.999-03:00`)
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
  isSessionActive: boolean;
  idleSeconds: number | null;
  identityConfidence: string;
}>) {
  const hostnames = new Set(records.map((record) => record.hostname));
  const active = records.filter((record) => record.isSessionActive).length;
  const idle = records.filter((record) => record.isSessionActive && (record.idleSeconds ?? 0) >= idleThresholdSeconds).length;
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
