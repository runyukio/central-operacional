import crypto from "node:crypto";

import { Prisma } from "@prisma/client";

import type { Actor } from "@/lib/mock-db";
import { canAccessRealTime } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type RawRow = Record<string, unknown>;

export type RealTimeImportInput = {
  fileName: string;
  source?: string;
  queueRows: RawRow[];
  agentRows: RawRow[];
};

const realtimeRecordLimit = 1000;
const staleThresholdMinutes = 20;

const queueNameCandidates = ["fila", "queue", "queue id", "queue_id", "queue name", "queue_name", "skill group queue", "skillgroupqueue"];
const agentNameCandidates = ["agente", "agent", "auditor", "auditor name", "nome", "name", "colaborador", "operator", "moderator"];
const wbLoginCandidates = ["wb", "wb login", "wblogin", "login", "user id", "userid", "uid", "email", "e-mail"];
const statusCandidates = ["status", "state", "estado", "situacao", "situação", "agent status", "queue status", "online status"];
const lobCandidates = ["lob", "operation", "operacao", "operação", "skill group", "skillgroup", "business", "cost center"];
const supervisorCandidates = ["supervisor", "team leader", "tl", "lider", "líder", "leader"];

export function validateRealtimeImportToken(authorizationHeader?: string | null) {
  const configuredToken = process.env.REALTIME_IMPORT_TOKEN?.trim();
  if (!configuredToken) {
    return { error: "REALTIME_IMPORT_TOKEN não configurado no ambiente.", status: 500 };
  }

  const match = String(authorizationHeader ?? "").match(/^Bearer\s+(.+)$/i);
  const providedToken = match?.[1]?.trim() ?? "";
  if (!providedToken || !safeEqual(providedToken, configuredToken)) {
    return { error: "Token de integração inválido.", status: 401 };
  }

  return { ok: true };
}

export async function importRealtimeSnapshot(input: RealTimeImportInput) {
  const fileName = input.fileName.trim() || "realtime.xlsx";
  const source = input.source?.trim() || "kap-local";
  const queueRows = input.queueRows.filter((row) => hasAnyValue(row));
  const agentRows = input.agentRows.filter((row) => hasAnyValue(row));
  const warnings: string[] = [];

  if (!queueRows.length) warnings.push("A aba Filas não possui linhas válidas.");
  if (!agentRows.length) warnings.push("A aba Agentes não possui linhas válidas.");
  if (!queueRows.length && !agentRows.length) {
    return { error: "O arquivo não possui linhas válidas em Filas ou Agentes.", status: 400 };
  }

  const records = [
    ...queueRows.map((row, index) => buildRecord(row, "QUEUE", index + 1)),
    ...agentRows.map((row, index) => buildRecord(row, "AGENT", index + 1))
  ];

  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.realTimeImportBatch.create({
      data: {
        fileName,
        source,
        status: "SUCCESS",
        rowsTotal: records.length,
        queueRows: queueRows.length,
        agentRows: agentRows.length,
        warnings: warnings.length ? warnings : Prisma.JsonNull
      }
    });

    for (let index = 0; index < records.length; index += 1000) {
      const chunk = records.slice(index, index + 1000);
      await tx.realTimeRecord.createMany({
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
    queueRows: batch.queueRows,
    agentRows: batch.agentRows,
    importedAt: batch.importedAt.toISOString(),
    warnings
  };
}

export async function getRealtimeSnapshot(actor: Actor) {
  if (!canAccessRealTime({ role: actor.role, email: actor.email, name: actor.name, status: "ACTIVE" })) {
    return { error: "Você não tem permissão para acessar Real Time.", status: 403 };
  }

  const batch = await prisma.realTimeImportBatch.findFirst({
    where: { status: "SUCCESS" },
    orderBy: { importedAt: "desc" }
  });

  if (!batch) {
    return {
      data: {
        summary: {
          hasData: false,
          status: "EMPTY",
          fileName: "",
          source: "",
          importedAt: "",
          importedAtLabel: "",
          minutesSinceImport: null,
          isStale: false,
          staleThresholdMinutes,
          queueRows: 0,
          agentRows: 0,
          rowsTotal: 0,
          warnings: []
        },
        queues: emptyDataset(),
        agents: emptyDataset(),
        kpis: []
      }
    };
  }

  const [queueRecords, agentRecords] = await Promise.all([
    prisma.realTimeRecord.findMany({ where: { batchId: batch.id, recordType: "QUEUE" }, orderBy: { rowNumber: "asc" }, take: realtimeRecordLimit }),
    prisma.realTimeRecord.findMany({ where: { batchId: batch.id, recordType: "AGENT" }, orderBy: { rowNumber: "asc" }, take: realtimeRecordLimit })
  ]);

  const queues = buildDataset(queueRecords, batch.queueRows);
  const agents = buildDataset(agentRecords, batch.agentRows);
  const minutesSinceImport = Math.max(0, Math.floor((Date.now() - batch.importedAt.getTime()) / 60000));

  return {
    data: {
      summary: {
        hasData: true,
        status: batch.status,
        fileName: batch.fileName,
        source: batch.source,
        importedAt: batch.importedAt.toISOString(),
        importedAtLabel: formatDateTime(batch.importedAt),
        minutesSinceImport,
        isStale: minutesSinceImport > staleThresholdMinutes,
        staleThresholdMinutes,
        queueRows: batch.queueRows,
        agentRows: batch.agentRows,
        rowsTotal: batch.rowsTotal,
        warnings: Array.isArray(batch.warnings) ? batch.warnings : []
      },
      queues,
      agents,
      kpis: buildKpis(queues.rows, agents.rows)
    }
  };
}

export async function listRealtimeImports(actor: Actor) {
  if (!canAccessRealTime({ role: actor.role, email: actor.email, name: actor.name, status: "ACTIVE" })) {
    return { error: "Você não tem permissão para acessar Real Time.", status: 403 };
  }

  const imports = await prisma.realTimeImportBatch.findMany({
    orderBy: { importedAt: "desc" },
    take: 30
  });

  return {
    data: imports.map((item) => ({
      id: item.id,
      fileName: item.fileName,
      source: item.source,
      status: item.status,
      rowsTotal: item.rowsTotal,
      queueRows: item.queueRows,
      agentRows: item.agentRows,
      importedAt: item.importedAt.toISOString(),
      importedAtLabel: formatDateTime(item.importedAt),
      errorMessage: item.errorMessage ?? "",
      warnings: Array.isArray(item.warnings) ? item.warnings : []
    }))
  };
}

function buildRecord(row: RawRow, recordType: "QUEUE" | "AGENT", rowNumber: number) {
  const rawData = serializeRow(row);
  return {
    recordType,
    rowNumber,
    queueName: valueFromCandidates(rawData, queueNameCandidates),
    agentName: valueFromCandidates(rawData, agentNameCandidates),
    wbLogin: valueFromCandidates(rawData, wbLoginCandidates),
    status: valueFromCandidates(rawData, statusCandidates),
    lob: valueFromCandidates(rawData, lobCandidates),
    supervisor: valueFromCandidates(rawData, supervisorCandidates),
    rawData: rawData as Prisma.InputJsonObject
  };
}

function buildDataset(records: Array<{ id: string; rowNumber: number; queueName: string | null; agentName: string | null; wbLogin: string | null; status: string | null; lob: string | null; supervisor: string | null; rawData: Prisma.JsonValue }>, totalRows: number) {
  const rows = records.map((record) => {
    const rawData = isPlainObject(record.rawData) ? record.rawData : {};
    return {
      id: record.id,
      rowNumber: record.rowNumber,
      queueName: record.queueName ?? "",
      agentName: record.agentName ?? "",
      wbLogin: record.wbLogin ?? "",
      status: record.status ?? "",
      lob: record.lob ?? "",
      supervisor: record.supervisor ?? "",
      rawData
    };
  });

  return {
    totalRows,
    returnedRows: rows.length,
    truncated: totalRows > rows.length,
    columns: collectColumns(rows.map((row) => row.rawData)),
    statuses: countBy(rows.map((row) => row.status).filter(Boolean)),
    lobs: countBy(rows.map((row) => row.lob).filter(Boolean)),
    rows
  };
}

function buildKpis(queueRows: Array<{ status: string; lob: string }>, agentRows: Array<{ status: string; lob: string }>) {
  const queueStatuses = countBy(queueRows.map((row) => row.status).filter(Boolean));
  const agentStatuses = countBy(agentRows.map((row) => row.status).filter(Boolean));
  const topQueueStatus = queueStatuses[0];
  const topAgentStatus = agentStatuses[0];
  return [
    { label: "Filas no snapshot", value: String(queueRows.length), helper: topQueueStatus ? `Maior status: ${topQueueStatus.label}` : "Sem status reconhecido", tone: "blue" },
    { label: "Agentes no snapshot", value: String(agentRows.length), helper: topAgentStatus ? `Maior status: ${topAgentStatus.label}` : "Sem status reconhecido", tone: "green" },
    { label: "Status de filas", value: String(queueStatuses.length), helper: "categorias reconhecidas", tone: "purple" },
    { label: "Status de agentes", value: String(agentStatuses.length), helper: "categorias reconhecidas", tone: "orange" }
  ];
}

function emptyDataset() {
  return {
    totalRows: 0,
    returnedRows: 0,
    truncated: false,
    columns: [],
    statuses: [],
    lobs: [],
    rows: []
  };
}

function collectColumns(rows: RawRow[]) {
  const columns = new Set<string>();
  for (const row of rows.slice(0, 100)) {
    Object.keys(row).forEach((key) => columns.add(key));
  }
  return Array.from(columns);
}

function countBy(values: string[]) {
  const map = new Map<string, number>();
  for (const value of values) {
    const label = value.trim();
    if (!label) continue;
    map.set(label, (map.get(label) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function valueFromCandidates(row: RawRow, candidates: string[]) {
  const normalizedCandidates = new Set(candidates.map(normalizeHeader));
  for (const [key, value] of Object.entries(row)) {
    if (normalizedCandidates.has(normalizeHeader(key))) {
      return normalizeCell(value);
    }
  }
  return "";
}

function serializeRow(row: RawRow) {
  return JSON.parse(JSON.stringify(row, (_key, value) => {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "bigint") return String(value);
    return value;
  })) as RawRow;
}

function hasAnyValue(row: RawRow) {
  return Object.values(row).some((value) => normalizeCell(value) !== "");
}

function normalizeCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "");
}

function isPlainObject(value: unknown): value is RawRow {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}
