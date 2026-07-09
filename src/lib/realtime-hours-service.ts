import { createHash, timingSafeEqual } from "crypto";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import { canAccessRealTime } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const defaultSource = "local-windows-server";
const defaultStatusLimit = 200;
const maxStatusLimit = 1000;
const defaultImportsLimit = 30;
const maxImportsLimit = 100;
const maxRecordsPerImport = Number.parseInt(process.env.REALTIME_HOURS_MAX_RECORDS_PER_IMPORT ?? "1000", 10) || 1000;
const staleThresholdMinutes = Number.parseInt(process.env.REALTIME_HOURS_STALE_MINUTES ?? "15", 10) || 15;
const idleThresholdSeconds = Number.parseInt(process.env.REALTIME_HOURS_IDLE_SECONDS ?? "300", 10) || 300;
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

export async function authorizeRealtimeHoursRead(request: Request) {
  const authorization = request.headers.get("authorization");
  if (authorization) return validateRealtimeHoursImportToken(authorization);

  const actor = await getApiActor();
  if (!canAccessRealTime({ role: actor.role, email: actor.email, name: actor.name, roleTitle: actor.roleTitle, jobTitle: actor.jobTitle, skill: actor.skill, status: "ACTIVE" })) {
    return { error: "Você não tem permissão para acessar a captura de horas em tempo real.", status: 403 };
  }

  return { ok: true };
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
  const idle = records.filter((record) => (record.idleSeconds ?? 0) >= idleThresholdSeconds).length;
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
