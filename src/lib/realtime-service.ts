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
const queueFriendlyFields = [
  ["Fila", ["队列名称", "queue name", "queue"]],
  ["ID da fila", ["队列id", "queue id"]],
  ["Grupo", ["技能组名称", "skill group"]],
  ["Recebidos", ["进审量"]],
  ["Recebidos 30min", ["近半小时进审量"]],
  ["Dentro SLA", ["及时率"]],
  ["AHT médio", ["平均AHT"]],
  ["Backlog", ["待审量"]],
  ["Backlog timeout", ["超时待审量"]],
  ["Aguardando coleta", ["待领取量"]],
  ["Agentes revisando", ["审核人数"]],
  ["Revisados", ["审核量"]],
  ["Latência média", ["平均延时（毫秒）"]],
  ["Latência máx.", ["最大延时（毫秒）"]]
] as const;
const agentFriendlyFields = [
  ["Agente", ["姓名", "agent", "agente"]],
  ["WB/Login", ["邮箱前缀", "wb", "login"]],
  ["Admin ID", ["AdminId"]],
  ["Operação", ["组织架构"]],
  ["Operação completa", ["组织架构全称"]],
  ["Turno", ["班次名称"]],
  ["Skill", ["班次技能组"]],
  ["Fila atual", ["当前队列"]],
  ["Status atual", ["当前工作状态"]],
  ["Tempo no status", ["当前状态时长（毫秒）"]],
  ["Revisados", ["审核量"]],
  ["AHT médio", ["平均AHT（毫秒）"]],
  ["Utilização", ["利用率"]],
  ["Ocupação", ["占用率"]],
  ["Pausas", ["小休次数"]],
  ["Offline", ["离线次数"]],
  ["Tempo revisão", ["审核时长（毫秒）"]],
  ["Tempo pausa", ["小休时长（毫秒）"]],
  ["Tempo refeição", ["用餐时长（毫秒）"]],
  ["Tempo treinamento", ["培训时长（毫秒）"]],
  ["Tempo online", ["在岗时长（毫秒）"]]
] as const;
const queueStatusByChinese = new Map([
  ["签出", "Deslogado"],
  ["小休", "Pausa"],
  ["离线", "Offline"],
  ["审核中", "Revisando"],
  ["空闲", "Disponível"],
  ["就餐", "Refeição"],
  ["培训", "Treinamento"],
  ["例会", "Reunião"]
]);

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
  const sourceData = serializeRow(row);
  const friendlyData = recordType === "QUEUE" ? friendlyRow(sourceData, queueFriendlyFields) : friendlyRow(sourceData, agentFriendlyFields);
  const rawData = { ...friendlyData, ...sourceData };
  const queueName = valueFromCandidates(rawData, queueNameCandidates) || stringValue(rawData["Fila"]);
  const agentName = valueFromCandidates(rawData, agentNameCandidates) || stringValue(rawData["Agente"]);
  const status = recordType === "AGENT"
    ? translateAgentStatus(valueFromCandidates(rawData, statusCandidates) || stringValue(rawData["Status atual"]))
    : queueRiskStatus(rawData);
  return {
    recordType,
    rowNumber,
    queueName,
    agentName,
    wbLogin: valueFromCandidates(rawData, wbLoginCandidates) || stringValue(rawData["WB/Login"]),
    status,
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
  const agentStatuses = countBy(agentRows.map((row) => row.status).filter(Boolean));
  const criticalQueues = queueRows.filter((row) => normalizeHeader(row.status).includes("critico")).length;
  const attentionQueues = queueRows.filter((row) => normalizeHeader(row.status).includes("atencao")).length;
  const onlineAgents = agentRows.filter((row) => ["revisando", "disponivel", "pausa", "refeicao", "treinamento", "reuniao"].includes(normalizeHeader(row.status))).length;
  const offlineAgents = agentRows.filter((row) => ["offline", "deslogado"].includes(normalizeHeader(row.status))).length;
  return [
    { label: "Filas críticas", value: String(criticalQueues), helper: "backlog com timeout", tone: criticalQueues ? "orange" : "green" },
    { label: "Filas em atenção", value: String(attentionQueues), helper: "backlog sem timeout", tone: attentionQueues ? "orange" : "blue" },
    { label: "Agentes online", value: String(onlineAgents), helper: "ativos/pausa/refeição/reunião", tone: "green" },
    { label: "Agentes offline", value: String(offlineAgents), helper: `${agentStatuses.length} status reconhecidos`, tone: offlineAgents ? "orange" : "blue" }
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

function friendlyRow(row: RawRow, fields: readonly (readonly [string, readonly string[]])[]) {
  const output: RawRow = {};
  for (const [label, candidates] of fields) {
    const value = valueFromCandidates(row, [...candidates]);
    if (value !== "") output[label] = formatFriendlyValue(label, value);
  }
  return output;
}

function formatFriendlyValue(label: string, value: string) {
  if (["AHT médio", "Latência média", "Latência máx.", "Tempo no status", "Tempo revisão", "Tempo pausa", "Tempo refeição", "Tempo treinamento", "Tempo online"].includes(label)) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return formatDuration(numeric);
  }
  if (["Dentro SLA", "Utilização", "Ocupação"].includes(label)) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return `${(numeric * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  }
  return value;
}

function queueRiskStatus(row: RawRow) {
  const timeoutBacklog = numberFromRow(row, "Backlog timeout", "超时待审量");
  const backlog = numberFromRow(row, "Backlog", "待审量");
  const received = numberFromRow(row, "Recebidos", "进审量");
  if (timeoutBacklog > 0) return "Crítico";
  if (backlog > 0) return "Atenção";
  if (received > 0) return "Fluxo ativo";
  return "Sem demanda";
}

function translateAgentStatus(value: string) {
  return queueStatusByChinese.get(value.trim()) ?? value.trim();
}

function numberFromRow(row: RawRow, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    const number = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function stringValue(value: unknown) {
  return normalizeCell(value);
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
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
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
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
