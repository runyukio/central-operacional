import crypto from "node:crypto";

import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";

import {
  calculateAbsenceRate,
  calculateCoverageRate,
  isAbsenceStatus,
  isPresentStatus,
  isScheduledStatus,
  normalizeOperationalStatus
} from "@/lib/attendance-calculation";
import { isAgentJobTitle } from "@/lib/job-title-normalization";
import type { Actor } from "@/lib/mock-db";
import { canAccessExecutiveAdsReport, canAccessRealTime, canAccessRealTimeAgentsReports, canAccessRealTimeQueues } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { isProjectExcludedFromAdsCoverage } from "@/lib/coverage-lob-rules";
import { resolveQueueReference } from "@/lib/queue-dictionary";
import { getQueueReportMetadataById } from "@/lib/queue-report-metadata";
import { getRealtimeHoursOperationalPresence, type RealtimeHoursPresenceStatus } from "@/lib/realtime-hours-service";
import { matchesRealtimeEmployeeStatus } from "@/lib/realtime-employee-status";
import { buildRealtimePresenceFallbackRows } from "@/lib/realtime-presence-fallback";
import { shiftCategoryName } from "@/lib/shift-display";
import { isWorkHoursAllowedForSchedule, parseWorkHoursToMinutes } from "@/lib/work-hours-rules";
import type { XlsxExportPayload } from "@/lib/xlsx-export";

type RawRow = Record<string, unknown>;

export type RealTimeImportInput = {
  fileName: string;
  source?: string;
  queueRows: RawRow[];
  agentRows: RawRow[];
};

export type RealtimeSnapshotOptions = {
  cycleDownload?: string;
  view?: "agents" | "queues" | "both";
};

export type RealtimeExportQuery = RealtimeSnapshotOptions & {
  view?: string | null;
  search?: string | null;
  crossingStatus?: string | null;
  personType?: string | null;
  employeeStatus?: string | null;
  presenceStatus?: string | null;
  lob?: string | null;
  supervisor?: string | null;
  shift?: string | null;
  skill?: string | null;
  roleTitle?: string | null;
  queueSearch?: string | null;
  queueLob?: string | null;
  queueStatus?: string | null;
  queueSlaTarget?: string | null;
  queueId?: string | null;
  sortBy?: string | null;
};

function realTimePermissionUser(actor: Actor) {
  return {
    role: actor.role,
    email: actor.email,
    name: actor.name,
    roleTitle: actor.roleTitle,
    jobTitle: actor.jobTitle,
    skill: actor.skill,
    status: "ACTIVE"
  };
}

function canRequestRealtimeView(actor: Actor, view: "agents" | "queues" | "both") {
  const user = realTimePermissionUser(actor);
  if (view === "queues") return canAccessRealTimeQueues(user);
  if (view === "both" && canAccessExecutiveAdsReport(user)) return true;
  return canAccessRealTimeAgentsReports(user);
}

export type RealtimeAiSnapshotQuery = RealtimeExportQuery & {
  reportLob?: string | null;
  requiredLob?: string | null;
  limit?: string | number | null;
  agentLimit?: string | number | null;
  queueLimit?: string | number | null;
  departmentLimit?: string | number | null;
};

type EmployeeMatch = {
  id: string;
  wbLogin: string;
  userEmail: string;
  fullName: string;
  operationalStatus: string;
  roleTitle: string;
  skill: string;
  lob: string;
  supervisor: string;
  supervisorId: string;
  shift: string;
};

type AgentCycleMetric = {
  submit: number;
  ahtMs: number | null;
  moderationMs: number;
  timeout: number;
  refresh: number;
  queueCount: number;
  sourceRows: number;
};

type AgentPresenceStatus = "Online" | "Tela bloqueada" | "Ocioso" | "Offline";

type AgentCycleRow = {
  key: string;
  employeeId: string;
  displayName: string;
  wbLogin: string;
  rawWbLogin: string;
  crossingStatus: "Encontrado" | "Não encontrado";
  personType: "Agente" | "Staff" | "Não encontrado";
  employeeStatus: string;
  presenceStatus: AgentPresenceStatus;
  isScheduled: boolean;
  isSchedulePresent: boolean;
  lob: string;
  supervisor: string;
  shift: string;
  skill: string;
  roleTitle: string;
  current: AgentCycleMetric;
  previous: AgentCycleMetric | null;
  deltas: {
    submit: number | null;
    ahtMs: number | null;
    moderationMs: number | null;
    timeout: number | null;
    refresh: number | null;
  };
  history: Array<{
    cycleDownload: string;
    queueIds: string[];
    submit: number;
    ahtMs: number | null;
    moderationMs: number;
    timeout: number;
    refresh: number;
  }>;
  queueBreakdown: Array<{
    queueId: string;
    queueName: string;
    submit: number;
    ahtMs: number | null;
    moderationMs: number;
    timeout: number;
    refresh: number;
  }>;
};

type QueueStatus = "OK" | "Estável" | "Risco" | "Estourado" | "N/A";

type QueueCycleMetric = {
  input: number;
  output: number;
  ahtMs: number | null;
  latencyMs: number | null;
  maxLatencyMs: number | null;
  maxLatencyRowNumber: number;
  backlog: number;
  sourceRows: number;
};

type QueueCycleRow = {
  key: string;
  queueId: string;
  queueName: string;
  lob: "ADS" | "VIDEO" | "COMMENTS" | "N/A";
  slaTargetMinutes: number | null;
  status: QueueStatus;
  current: QueueCycleMetric;
  previous: QueueCycleMetric | null;
  deltas: {
    input: number | null;
    output: number | null;
    ahtMs: number | null;
    latencyMs: number | null;
    maxLatencyMs: number | null;
    backlog: number | null;
  };
  history: Array<{
    cycleDownload: string;
    status: QueueStatus;
    input: number;
    output: number;
    ahtMs: number | null;
    latencyMs: number | null;
    maxLatencyMs: number | null;
    maxLatencyRowNumber: number;
    backlog: number;
  }>;
};

type AgentSummaryReadRow = {
  batchId: string;
  cycleDownload: string;
  wbLoginNormalized: string;
  rawWbLogin: string;
  employeeId: string | null;
  displayName: string;
  wbLogin: string;
  crossingStatus: string;
  personType: string;
  employeeStatus: string;
  lob: string;
  supervisor: string;
  shift: string;
  skill: string;
  roleTitle: string;
  submit: number;
  ahtMs: number | null;
  moderationMs: number;
  timeout: number;
  refresh: number;
  queueCount: number;
  sourceRows: number;
  queueBreakdown: Prisma.JsonValue | null;
  batch: { id: string; importedAt: Date; fileName: string };
};

type QueueSummaryReadRow = {
  batchId: string;
  cycleDownload: string;
  queueKey: string;
  queueId: string;
  queueName: string;
  lob: string;
  slaTargetMinutes: number | null;
  status: string;
  input: number;
  output: number;
  ahtMs: number | null;
  latencyMs: number | null;
  maxLatencyMs: number | null;
  maxLatencyRowNumber: number;
  backlog: number;
  sourceRows: number;
  batch: { id: string; importedAt: Date; fileName: string };
};

const staleThresholdMinutes = 20;
const realtimeMinimumRetentionDays = 7;
const configuredRealtimeRetentionDays = Number.parseInt(
  process.env.REALTIME_RETENTION_DAYS ?? String(realtimeMinimumRetentionDays),
  10
);
const realtimeRetentionDays = Number.isFinite(configuredRealtimeRetentionDays)
  ? Math.max(realtimeMinimumRetentionDays, configuredRealtimeRetentionDays)
  : realtimeMinimumRetentionDays;
const realtimeImportsPerHour = 6;
const realtimeViewHistoryBatchLimit = Math.max(
  1200,
  realtimeRetentionDays * 24 * realtimeImportsPerHour
);
const realtimeRawFallbackBatchLimit = 12;
const configuredRealtimeRawRetentionHours = Number.parseInt(process.env.REALTIME_RAW_RETENTION_HOURS ?? "24", 10);
const realtimeRawRetentionHours = Number.isFinite(configuredRealtimeRawRetentionHours)
  ? Math.min(realtimeRetentionDays * 24, Math.max(12, configuredRealtimeRawRetentionHours))
  : 24;
const configuredRealtimeRawDeleteLimit = Number.parseInt(process.env.REALTIME_RAW_DELETE_LIMIT ?? "10000", 10);
const realtimeRawDeleteLimit = Number.isFinite(configuredRealtimeRawDeleteLimit)
  ? Math.min(50_000, Math.max(1_000, configuredRealtimeRawDeleteLimit))
  : 10_000;

const getCachedQueueRealtimeView = unstable_cache(
  async (cycleDownload: string) => buildQueueRealtimeView({ cycleDownload: cycleDownload || undefined }),
  ["realtime-queue-view-v1"],
  { revalidate: 60, tags: ["realtime-queue-view"] }
);
const getCachedAgentRealtimeView = unstable_cache(
  async (cycleDownload: string) => buildAgentRealtimeView({ cycleDownload: cycleDownload || undefined }),
  ["realtime-agent-view-v1"],
  { revalidate: 60, tags: ["realtime-agent-view"] }
);

type RealtimeBatchReadRow = {
  id: string;
  fileName: string;
  importedAt: Date;
  queueRows: number;
  agentRows: number;
  cycleDownload?: string | null;
  cycleDownloads?: Prisma.JsonValue | null;
};

type RealtimeCycleOption = {
  value: string;
  batchId: string;
  importedAt: Date;
  rows: number;
};

const queueNameCandidates = ["fila", "queue", "queue id", "queue_id", "queue name", "queue_name", "skill group queue", "skillgroupqueue"];
const agentNameCandidates = ["agente", "agent", "auditor", "auditor name", "nome", "name", "parceiro", "colaborador", "operator", "moderator"];
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
  ["Latência máx.", ["待审最大延时（毫秒）", "最大延时（毫秒）"]]
] as const;
const agentFriendlyFields = [
  ["Agente", ["姓名", "agent", "agente"]],
  ["WB/Login", ["邮箱前缀", "wb", "login"]],
  ["Admin ID", ["AdminId"]],
  ["Operação", ["组织架构"]],
  ["Operação completa", ["组织架构全称"]],
  ["Turno", ["班次名称"]],
  ["Skill", ["班次技能组"]],
  ["Fila ID", ["队列id", "queue id", "queue_id"]],
  ["Nome da fila", ["队列名称", "queue name", "queue_name"]],
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

export function validateRealtimeReportToken(authorizationHeader?: string | null) {
  const configuredToken = (
    process.env.REALTIME_REPORT_API_TOKEN
    ?? process.env.REALTIME_EXPORT_TOKEN
    ?? process.env.REALTIME_IMPORT_TOKEN
    ?? ""
  ).trim();
  if (!configuredToken) {
    return { error: "REALTIME_REPORT_API_TOKEN não configurado no ambiente.", status: 500 };
  }

  const match = String(authorizationHeader ?? "").match(/^Bearer\s+(.+)$/i);
  const providedToken = match?.[1]?.trim() ?? "";
  if (!providedToken || !safeEqual(providedToken, configuredToken)) {
    return { error: "Token de leitura do Real Time inválido.", status: 401 };
  }

  return { ok: true };
}

function realtimeRetentionCutoff() {
  return new Date(Date.now() - realtimeRetentionDays * 24 * 60 * 60 * 1000);
}

async function pruneRealtimeHistory(currentBatchId?: string) {
  try {
    const rawCutoff = new Date(Date.now() - realtimeRawRetentionHours * 60 * 60 * 1_000);
    await prisma.$executeRaw(Prisma.sql`
      WITH stale_records AS (
        SELECT "id"
        FROM "RealTimeRecord"
        WHERE "createdAt" < ${rawCutoff}
        ORDER BY "createdAt" ASC
        LIMIT ${realtimeRawDeleteLimit}
      )
      DELETE FROM "RealTimeRecord" AS record
      USING stale_records
      WHERE record."id" = stale_records."id"
    `);

    while (true) {
      const staleBatches = await prisma.realTimeImportBatch.findMany({
        where: {
          importedAt: { lt: realtimeRetentionCutoff() },
          ...(currentBatchId ? { id: { not: currentBatchId } } : {})
        },
        select: { id: true },
        take: 500
      });
      const staleIds = staleBatches.map((batch) => batch.id);
      if (!staleIds.length) return;

      await prisma.$transaction([
        prisma.realTimeAgentCycleSummary.deleteMany({ where: { batchId: { in: staleIds } } }),
        prisma.realTimeQueueCycleSummary.deleteMany({ where: { batchId: { in: staleIds } } }),
        prisma.realTimeRecord.deleteMany({ where: { batchId: { in: staleIds } } }),
        prisma.realTimeImportBatch.deleteMany({ where: { id: { in: staleIds } } })
      ]);
    }
  } catch (error) {
    console.warn("[realtime] Não foi possível limpar histórico antigo.", error);
  }
}

export async function importRealtimeSnapshot(input: RealTimeImportInput) {
  const fileName = input.fileName.trim() || "realtime.xlsx";
  const source = input.source?.trim() || "kap-local";
  const importedAt = new Date();
  const queueRows = input.queueRows.filter((row) => hasAnyValue(row));
  const rawAgentRows = input.agentRows.filter((row) => hasAnyValue(row));
  const { validRows: agentRows, rowErrors } = validateRealtimeAgentRows(rawAgentRows);
  const warnings: string[] = [];

  if (!queueRows.length) warnings.push("A aba Filas não possui linhas válidas.");
  if (!agentRows.length) warnings.push("A aba Agentes não possui linhas válidas.");
  rowErrors.slice(0, 10).forEach((error) => warnings.push(error));
  if (rowErrors.length > 10) warnings.push(`${rowErrors.length - 10} erro(s) adicional(is) foram omitidos do resumo.`);
  if (!queueRows.length && !agentRows.length) {
    return { error: "O arquivo não possui linhas válidas em Filas ou Agentes.", status: 400 };
  }

  const records = [
    ...queueRows.map((row, index) => buildRecord(row, "QUEUE", index + 1)),
    ...agentRows.map((row, index) => buildRecord(row, "AGENT", index + 1))
  ];
  const employeeMatches = await loadEmployeeMatches();
  const agentSummaries = buildAgentCycleSummaryRows(agentRows, employeeMatches, importedAt);
  const queueSummaries = buildQueueCycleSummaryRows(queueRows, importedAt);
  const importSummary = summarizeImportedSummaries(agentSummaries, queueSummaries);

  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.realTimeImportBatch.create({
      data: {
        fileName,
        source,
        status: "SUCCESS",
        cycleDownload: importSummary.cycleDownloads[0] ?? null,
        cycleDownloads: importSummary.cycleDownloads.length ? importSummary.cycleDownloads : Prisma.JsonNull,
        rowsTotal: records.length,
        queueRows: queueRows.length,
        agentRows: agentRows.length,
        importedAt,
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

    for (let index = 0; index < agentSummaries.length; index += 1000) {
      const chunk = agentSummaries.slice(index, index + 1000);
      await tx.realTimeAgentCycleSummary.createMany({
        data: chunk.map((summary) => ({
          ...summary,
          batchId: created.id
        }))
      });
    }

    for (let index = 0; index < queueSummaries.length; index += 1000) {
      const chunk = queueSummaries.slice(index, index + 1000);
      await tx.realTimeQueueCycleSummary.createMany({
        data: chunk.map((summary) => ({
          ...summary,
          batchId: created.id
        }))
      });
    }

    return created;
  });

  await pruneRealtimeHistory(batch.id);

  return {
    success: true,
    batchId: batch.id,
    fileName: batch.fileName,
    source: batch.source,
    cycleDownload: importSummary.cycleDownloads[0] ?? "",
    cycleDownloads: importSummary.cycleDownloads,
    rowsProcessed: queueRows.length + rawAgentRows.length,
    rowsValid: records.length,
    rowsError: rowErrors.length,
    rowsInserted: records.length,
    rowsUpdated: 0,
    matchedEmployees: importSummary.matchedEmployees,
    unmatchedEmployees: importSummary.unmatchedEmployees,
    mappedQueues: importSummary.mappedQueues,
    unmappedQueues: importSummary.unmappedQueues,
    queueRows: batch.queueRows,
    agentRows: batch.agentRows,
    importedAt: batch.importedAt.toISOString(),
    warnings
  };
}

export type RealtimeSummaryBackfillOptions = {
  fromCycle: string;
  toCycle: string;
  dryRun?: boolean;
};

export async function backfillRealtimeCycleSummaries(options: RealtimeSummaryBackfillOptions) {
  const fromCycle = options.fromCycle.trim();
  const toCycle = options.toCycle.trim();
  if (!fromCycle || !toCycle || fromCycle >= toCycle) {
    throw new Error("Informe um intervalo válido: fromCycle deve ser menor que toCycle.");
  }

  const [agentRecords, queueRecords] = await Promise.all([
    loadRawRealtimeRecordsForCycleRange("AGENT", fromCycle, toCycle),
    loadRawRealtimeRecordsForCycleRange("QUEUE", fromCycle, toCycle)
  ]);
  const employeeMatches = agentRecords.length ? await loadEmployeeMatches() : [];
  const agentSummaries = agentSummaryRowsFromRawRecords(agentRecords, employeeMatches);
  const queueSummaries = queueSummaryRowsFromRawRecords(queueRecords);

  const result = {
    fromCycle,
    toCycle,
    dryRun: Boolean(options.dryRun),
    agentRawRows: agentRecords.length,
    queueRawRows: queueRecords.length,
    agentSummaries: agentSummaries.length,
    queueSummaries: queueSummaries.length,
    deletedAgentSummaries: 0,
    deletedQueueSummaries: 0,
    insertedAgentSummaries: 0,
    insertedQueueSummaries: 0
  };

  if (options.dryRun || (!agentSummaries.length && !queueSummaries.length)) return result;

  const agentBatchIds = Array.from(new Set(agentRecords.map((record) => record.batchId)));
  const queueBatchIds = Array.from(new Set(queueRecords.map((record) => record.batchId)));

  await prisma.$transaction(async (tx) => {
    if (agentBatchIds.length) {
      const deleted = await tx.realTimeAgentCycleSummary.deleteMany({
        where: {
          batchId: { in: agentBatchIds },
          cycleDownload: { gte: fromCycle, lt: toCycle }
        }
      });
      result.deletedAgentSummaries = deleted.count;
    }

    if (queueBatchIds.length) {
      const deleted = await tx.realTimeQueueCycleSummary.deleteMany({
        where: {
          batchId: { in: queueBatchIds },
          cycleDownload: { gte: fromCycle, lt: toCycle }
        }
      });
      result.deletedQueueSummaries = deleted.count;
    }

    for (let index = 0; index < agentSummaries.length; index += 1000) {
      const chunk = agentSummaries.slice(index, index + 1000);
      await tx.realTimeAgentCycleSummary.createMany({
        data: chunk.map(({ batch: _batch, queueBreakdown, ...summary }) => ({
          ...summary,
          queueBreakdown: queueBreakdown as Prisma.InputJsonValue
        }))
      });
      result.insertedAgentSummaries += chunk.length;
    }

    for (let index = 0; index < queueSummaries.length; index += 1000) {
      const chunk = queueSummaries.slice(index, index + 1000);
      await tx.realTimeQueueCycleSummary.createMany({
        data: chunk.map(({ batch: _batch, ...summary }) => summary)
      });
      result.insertedQueueSummaries += chunk.length;
    }
  });

  return result;
}

export async function getRealtimeSnapshot(actor: Actor, options: RealtimeSnapshotOptions = {}) {
  const requestedView = options.view ?? "both";
  if (!canRequestRealtimeView(actor, requestedView)) {
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
        queueView: emptyQueueRealtimeView(),
        agents: emptyAgentRealtimeView(),
        kpis: []
      }
    };
  }

  const [queueRealtime, agentRealtime] = await Promise.all([
    requestedView === "agents" ? Promise.resolve(emptyQueueRealtimeView()) : getCachedQueueRealtimeView(options.cycleDownload ?? ""),
    requestedView === "queues" ? Promise.resolve(emptyAgentRealtimeView()) : getCachedAgentRealtimeView(options.cycleDownload ?? "")
  ]);

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
      queues: emptyDataset(),
      queueView: queueRealtime,
      agents: agentRealtime,
      kpis: []
    }
  };
}

export async function getRealtimeLatestStatus(actor: Actor, options: RealtimeSnapshotOptions = {}) {
  const requestedView = options.view ?? "both";
  if (!canRequestRealtimeView(actor, requestedView)) {
    return { error: "Você não tem permissão para acessar Real Time.", status: 403 };
  }

  const [queueLatest, agentLatest] = await Promise.all([
    requestedView === "agents" ? Promise.resolve(null) : latestRealtimeCycle("QUEUE"),
    requestedView === "queues" ? Promise.resolve(null) : latestRealtimeCycle("AGENT")
  ]);

  return {
    data: {
      queues: queueLatest,
      agents: agentLatest
    }
  };
}

export async function getRealtimeAiSnapshot(query: RealtimeAiSnapshotQuery = {}) {
  const snapshot = await getRealtimeSnapshot(realtimeApiActor, { cycleDownload: query.cycleDownload, view: "both" });
  if ("error" in snapshot && snapshot.error) return { error: snapshot.error, status: snapshot.status ?? 400 };
  const snapshotData = "data" in snapshot ? snapshot.data : null;
  if (!snapshotData) return { error: "Não foi possível carregar o snapshot do Real Time.", status: 500 };

  const reportLobs = normalizeAiReportLobs(query.reportLob);
  const filteredAgentRows = sortAgentRows(filterAgentRows(snapshotData.agents.rows, query), query.sortBy ?? "submit_desc");
  const filteredQueueRows = filterQueueRows(snapshotData.queueView.rows, query);
  const reportQueueBaseRows = filterQueueRows(snapshotData.queueView.rows, { ...query, queueSearch: null });
  const reportQueueRows = reportLobs
    .flatMap((reportLob) => buildAiReportQueueRows(reportQueueBaseRows, reportLob, query.queueSearch, snapshotData.queueView.selectedCycle))
    .sort(compareAiReportQueueRows);
  const reportDepartmentRows = reportLobs
    .flatMap((reportLob) => buildAiReportDepartmentRows(reportLob, reportQueueRows.filter((row) => row.report === reportLob)))
    .sort(compareAiReportDepartmentRows);

  const agentLimit = parseAiSnapshotLimit(query.agentLimit ?? query.limit, 500, 5000);
  const queueLimit = parseAiSnapshotLimit(query.queueLimit ?? query.limit, 500, 5000);
  const departmentLimit = parseAiSnapshotLimit(query.departmentLimit, 100, 1000);
  const filteredAgentSummary = summarizeAgentRows(filteredAgentRows);
  const filteredQueueSummary = summarizeQueueRowsForExport(filteredQueueRows);
  const operationalSummary = await buildAiOperationalSummary(
    snapshotData.agents.selectedCycle || snapshotData.queueView.selectedCycle,
    query
  );
  const requiredAgentsSummary = await buildAiRequiredAgentsSummary(
    snapshotData.agents.selectedCycle || snapshotData.queueView.selectedCycle,
    query
  );

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    metadata: {
      selectedCycle: snapshotData.agents.selectedCycle || snapshotData.queueView.selectedCycle,
      previousCycle: snapshotData.agents.previousCycle || snapshotData.queueView.previousCycle || null,
      importedAt: snapshotData.summary.importedAt,
      importedAtLabel: snapshotData.summary.importedAtLabel,
      minutesSinceImport: snapshotData.summary.minutesSinceImport,
      isStale: snapshotData.summary.isStale,
      availableAgentCycles: snapshotData.agents.cycles.map((cycle) => cycle.value),
      availableQueueCycles: snapshotData.queueView.cycles.map((cycle) => cycle.value),
      reportLobs,
      filters: normalizeAiSnapshotFilters(query),
      limits: {
        agents: agentLimit,
        reportQueues: queueLimit,
        reportDepartments: departmentLimit
      }
    },
    summary: {
      agents: {
        rows: filteredAgentRows.length,
        recordsImported: filteredAgentSummary.recordsImported,
        matched: filteredAgentSummary.matched,
        unmatched: filteredAgentSummary.unmatched,
        submit: filteredAgentSummary.submit,
        ahtMs: filteredAgentSummary.ahtMs,
        aht: formatDurationFromMs(filteredAgentSummary.ahtMs),
        moderationMs: filteredAgentSummary.moderationMs,
        moderation: formatDurationFromMs(filteredAgentSummary.moderationMs),
        timeout: filteredAgentSummary.timeout,
        refresh: filteredAgentSummary.refresh
      },
      queues: {
        rows: filteredQueueRows.length,
        input: filteredQueueSummary.input,
        output: filteredQueueSummary.output,
        backlog: filteredQueueSummary.backlog,
        ahtMs: filteredQueueSummary.ahtMs,
        aht: formatDurationFromMs(filteredQueueSummary.ahtMs),
        averageLatencyMs: filteredQueueSummary.latencyMs,
        averageLatency: formatDurationFromMs(filteredQueueSummary.latencyMs),
        maxLatencyMs: filteredQueueSummary.maxLatencyMs,
        maxLatency: formatDurationFromMs(filteredQueueSummary.maxLatencyMs)
      },
      reports: summarizeAiReportRows(reportQueueRows),
      operational: operationalSummary,
      requiredAgents: requiredAgentsSummary
    },
    tables: {
      reportQueues: reportQueueRows.slice(0, queueLimit),
      reportDepartments: reportDepartmentRows.slice(0, departmentLimit),
      agentProductivity: buildAiAgentProductivityRows(filteredAgentRows, snapshotData.agents.selectedCycle).slice(0, agentLimit),
      operationalByLob: operationalSummary.monthToDate.byLob,
      requiredAgentsByShift: requiredAgentsSummary.daily.rows,
      requiredAgentsMonthToDateByShift: requiredAgentsSummary.monthToDate.rows
    }
  };
}

type AiOperationalPeriod = {
  startDate: string;
  endDate: string;
};

type AiOperationalEmployee = {
  admissionDate: Date | null;
  terminationDate: Date | null;
  operationalStatus: string | null;
  lob: { name: string } | null;
};

type AiOperationalBucket = {
  lob: string;
  planned: number;
  present: number;
  absent: number;
  coverageRate: number;
  absRate: number;
  headcount: number;
  terminations: number;
  hcStart: number;
  hcEnd: number;
  hcAverage: number;
  attritionRate: number;
};

async function buildAiOperationalSummary(selectedCycle: string, query: RealtimeAiSnapshotQuery) {
  const referenceDate = realtimeReferenceDateKey(selectedCycle);
  const monthStart = `${referenceDate.slice(0, 8)}01`;
  const daily = await buildAiOperationalPeriodSummary({ startDate: referenceDate, endDate: referenceDate }, query);
  const monthToDate = await buildAiOperationalPeriodSummary({ startDate: monthStart, endDate: referenceDate }, query);
  return {
    referenceDate,
    daily,
    monthToDate
  };
}

async function buildAiOperationalPeriodSummary(period: AiOperationalPeriod, query: RealtimeAiSnapshotQuery) {
  const start = utcDateFromKey(period.startDate);
  const end = utcDateFromKey(period.endDate);
  const employeeWhere = aiOperationalEmployeeWhere(query);
  const [schedules, employees] = await Promise.all([
    prisma.schedule.findMany({
      where: {
        deletedAt: null,
        date: { gte: start, lte: end },
        employee: employeeWhere
      },
      select: {
        status: true,
        employee: {
          select: {
            lob: { select: { name: true } }
          }
        }
      }
    }),
    prisma.employeeProfile.findMany({
      where: employeeWhere,
      select: {
        admissionDate: true,
        terminationDate: true,
        operationalStatus: true,
        lob: { select: { name: true } }
      }
    })
  ]);

  const scheduleByLob = new Map<string, { planned: number; present: number; absent: number }>();
  schedules.forEach((schedule) => {
    const lob = schedule.employee.lob?.name?.trim() || "Sem LOB";
    const status = normalizeOperationalStatus(schedule.status);
    const bucket = scheduleByLob.get(lob) ?? { planned: 0, present: 0, absent: 0 };
    if (isScheduledStatus(status)) bucket.planned += 1;
    if (isPresentStatus(status)) bucket.present += 1;
    if (isAbsenceStatus(status)) bucket.absent += 1;
    scheduleByLob.set(lob, bucket);
  });

  const employeesByLob = new Map<string, AiOperationalEmployee[]>();
  employees.forEach((employee) => {
    const lob = employee.lob?.name?.trim() || "Sem LOB";
    const rows = employeesByLob.get(lob) ?? [];
    rows.push(employee);
    employeesByLob.set(lob, rows);
  });

  const lobs = Array.from(new Set([...scheduleByLob.keys(), ...employeesByLob.keys()])).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const byLob = lobs.map((lob) => {
    const schedule = scheduleByLob.get(lob) ?? { planned: 0, present: 0, absent: 0 };
    return buildAiOperationalBucket(lob, schedule, employeesByLob.get(lob) ?? [], start, end);
  });

  const totals = byLob.reduce(
    (acc, row) => ({
      planned: acc.planned + row.planned,
      present: acc.present + row.present,
      absent: acc.absent + row.absent,
      headcount: acc.headcount + row.headcount,
      terminations: acc.terminations + row.terminations,
      hcStart: acc.hcStart + row.hcStart,
      hcEnd: acc.hcEnd + row.hcEnd
    }),
    { planned: 0, present: 0, absent: 0, headcount: 0, terminations: 0, hcStart: 0, hcEnd: 0 }
  );
  const hcAverage = Number(((totals.hcStart + totals.hcEnd) / 2).toFixed(1));

  return {
    startDate: period.startDate,
    endDate: period.endDate,
    total: {
      lob: "Total",
      planned: totals.planned,
      present: totals.present,
      absent: totals.absent,
      coverageRate: calculateCoverageRate(totals.planned, totals.present),
      absRate: calculateAbsenceRate(totals.planned, totals.absent),
      headcount: totals.headcount,
      terminations: totals.terminations,
      hcStart: totals.hcStart,
      hcEnd: totals.hcEnd,
      hcAverage,
      attritionRate: aiOperationalAttritionRate(totals.terminations, hcAverage)
    },
    byLob
  };
}

function buildAiOperationalBucket(
  lob: string,
  schedule: { planned: number; present: number; absent: number },
  employees: AiOperationalEmployee[],
  start: Date,
  end: Date
): AiOperationalBucket {
  const headcount = employees.filter((employee) => aiOperationalWasActiveAt(employee, end, "end")).length;
  const hcStart = employees.filter((employee) => aiOperationalWasActiveAt(employee, start, "start")).length;
  const hcEnd = employees.filter((employee) => aiOperationalWasActiveAt(employee, end, "end")).length;
  const terminations = employees.filter((employee) => aiOperationalTerminationInPeriod(employee, start, end)).length;
  const hcAverage = Number(((hcStart + hcEnd) / 2).toFixed(1));
  return {
    lob,
    planned: schedule.planned,
    present: schedule.present,
    absent: schedule.absent,
    coverageRate: calculateCoverageRate(schedule.planned, schedule.present),
    absRate: calculateAbsenceRate(schedule.planned, schedule.absent),
    headcount,
    terminations,
    hcStart,
    hcEnd,
    hcAverage,
    attritionRate: aiOperationalAttritionRate(terminations, hcAverage)
  };
}

function aiOperationalEmployeeWhere(query: RealtimeAiSnapshotQuery): Prisma.EmployeeProfileWhereInput {
  const filters: Prisma.EmployeeProfileWhereInput[] = [{ deletedAt: null }];
  const search = query.search?.trim();
  if (search) {
    filters.push({
      OR: [
        { fullName: { contains: search, mode: "insensitive" } },
        { wbLogin: { contains: search, mode: "insensitive" } },
        { user: { email: { contains: search, mode: "insensitive" } } }
      ]
    });
  }
  if (query.lob && query.lob !== "Todos") filters.push({ lob: { name: query.lob } });
  if (query.supervisor && query.supervisor !== "Todos") {
    filters.push({
      supervisor: {
        OR: [
          { fullName: { contains: query.supervisor, mode: "insensitive" } },
          { wbLogin: { contains: query.supervisor, mode: "insensitive" } }
        ]
      }
    });
  }
  if (query.shift && query.shift !== "Todos") filters.push({ shift: { name: { contains: query.shift, mode: "insensitive" } } });
  if (query.skill && query.skill !== "Todos") filters.push({ skill: { contains: query.skill, mode: "insensitive" } });
  if (query.roleTitle && query.roleTitle !== "Todos") filters.push({ roleTitle: { contains: query.roleTitle, mode: "insensitive" } });
  return filters.length === 1 ? filters[0] : { AND: filters };
}

function realtimeReferenceDateKey(selectedCycle: string) {
  const parsed = parseRealtimeCycleForPresence(selectedCycle);
  if (parsed) return parsed.dateKey;
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function utcDateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function aiOperationalAttritionRate(terminations: number, hcAverage: number) {
  if (!hcAverage) return 0;
  return Number(((terminations / hcAverage) * 100).toFixed(2));
}

function aiOperationalStatusKey(status: unknown) {
  return String(status ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function aiOperationalIsEligibleStatus(status: unknown) {
  const key = aiOperationalStatusKey(status);
  return ["ATIVO", "ACTIVE", "DESLIGADO", "TERMINATED"].includes(key);
}

function aiOperationalIsTerminatedStatus(status: unknown) {
  const key = aiOperationalStatusKey(status);
  return key === "DESLIGADO" || key === "TERMINATED";
}

function aiOperationalWasActiveAt(employee: AiOperationalEmployee, boundary: Date, boundaryType: "start" | "end") {
  if (!aiOperationalIsEligibleStatus(employee.operationalStatus)) return false;
  if (aiOperationalIsTerminatedStatus(employee.operationalStatus) && !employee.terminationDate) return false;
  const admittedByBoundary = !employee.admissionDate || employee.admissionDate <= boundary;
  const notTerminatedByBoundary =
    boundaryType === "start"
      ? !employee.terminationDate || employee.terminationDate >= boundary
      : !employee.terminationDate || employee.terminationDate > boundary;
  return admittedByBoundary && notTerminatedByBoundary;
}

function aiOperationalTerminationInPeriod(employee: AiOperationalEmployee, start: Date, end: Date) {
  return Boolean(
    aiOperationalIsTerminatedStatus(employee.operationalStatus) &&
      employee.terminationDate &&
      employee.terminationDate >= start &&
      employee.terminationDate <= end
  );
}

const aiRequiredProductiveShifts = ["Manhã", "Tarde", "Noite"] as const;
type AiRequiredProductiveShift = (typeof aiRequiredProductiveShifts)[number];
const aiRequiredDefaultLobs = ["ADS", "VIDEO", "COMMENTS", "CEC"];

const aiRequiredCoverageStatuses = new Set(["ESCALADO", "PRESENTE", "ATRASO", "SAIDA_ANTECIPADA", "VENDA_FOLGA_APROVADA", "TROCA_APROVADA"]);
const aiRequiredInactiveEmployeeStatusTokens = new Set([
  "inativo",
  "inativa",
  "inactive",
  "desativado",
  "desativada",
  "disabled",
  "desligado",
  "desligada",
  "desligado em treinamento",
  "desligada em treinamento",
  "desligado treinamento",
  "desligada treinamento",
  "terminated",
  "suspenso",
  "suspensa",
  "suspended",
  "em treinamento",
  "treinamento",
  "training",
  "nesting"
]);

type AiRequiredAgentsRow = {
  date: string;
  dateLabel: string;
  weekday: string;
  lob: string;
  shift: AiRequiredProductiveShift;
  required: number;
  available: number;
  necessidade: number;
  programado: number;
  scheduled: number;
  escaladoStatus: number;
  present: number;
  absent: number;
  gap: number;
  coverageRate: number;
  absRate: number;
  status: string;
};

async function buildAiRequiredAgentsSummary(selectedCycle: string, query: RealtimeAiSnapshotQuery) {
  const referenceDate = realtimeReferenceDateKey(selectedCycle);
  const monthStart = `${referenceDate.slice(0, 8)}01`;
  const targetLobs = aiRequiredTargetLobs(query);
  const daily = await buildAiRequiredAgentsPeriodSummary({ startDate: referenceDate, endDate: referenceDate }, targetLobs);
  const monthToDate = await buildAiRequiredAgentsPeriodSummary({ startDate: monthStart, endDate: referenceDate }, targetLobs);
  return {
    referenceDate,
    lobs: targetLobs ?? ["Todos"],
    daily,
    monthToDate
  };
}

async function buildAiRequiredAgentsPeriodSummary(period: AiOperationalPeriod, targetLobs: string[] | null) {
  const start = utcDateFromKey(period.startDate);
  const end = utcDateFromKey(period.endDate);
  const [requirements, schedules] = await Promise.all([
    prisma.staffCoverage.findMany({
      where: {
        date: { gte: start, lte: end },
        ...(targetLobs ? { OR: targetLobs.map((lob) => ({ lob: { name: { equals: lob, mode: "insensitive" as const } } })) } : {})
      },
      select: {
        date: true,
        requiredStaff: true,
        lob: { select: { name: true } },
        shift: { select: { name: true } }
      },
      orderBy: [{ date: "asc" }, { lob: { name: "asc" } }, { shift: { name: "asc" } }]
    }),
    prisma.schedule.findMany({
      where: {
        deletedAt: null,
        date: { gte: start, lte: end },
        employee: { deletedAt: null }
      },
      select: {
        date: true,
        status: true,
        lobId: true,
        shift: { select: { name: true } },
        employee: {
          select: {
            roleTitle: true,
            operationalStatus: true,
            skill: true,
            lob: { select: { id: true, name: true } },
            shift: { select: { name: true } }
          }
        }
      }
    })
  ]);

  const lobIds = Array.from(new Set(schedules.map((schedule) => schedule.lobId).filter((value): value is string => Boolean(value))));
  const lobs = lobIds.length ? await prisma.lob.findMany({ where: { id: { in: lobIds } }, select: { id: true, name: true } }) : [];
  const lobNameById = new Map(lobs.map((lob) => [lob.id, lob.name]));
  const rowsByKey = new Map<string, AiRequiredAgentsRow>();

  requirements.forEach((requirement) => {
    const date = realtimeDateKeyFromDate(requirement.date);
    const lob = requirement.lob.name;
    const shift = aiRequiredShiftName(requirement.shift.name);
    if (!shift || !aiRequiredMatchesTargetLob(lob, targetLobs)) return;
    const key = aiRequiredRowKey(date, lob, shift);
    const current = rowsByKey.get(key) ?? emptyAiRequiredAgentsRow(date, lob, shift);
    current.required += requirement.requiredStaff;
    rowsByKey.set(key, current);
  });

  schedules.forEach((schedule) => {
    const lob = schedule.lobId ? lobNameById.get(schedule.lobId) ?? schedule.employee.lob.name : schedule.employee.lob.name;
    if (isProjectExcludedFromAdsCoverage(schedule.employee.lob.name, lob)) return;
    if (!aiRequiredMatchesTargetLob(lob, targetLobs)) return;
    if (!isAgentJobTitle(schedule.employee.roleTitle)) return;
    const status = normalizeOperationalStatus(schedule.status);
    if (!aiRequiredEmployeeCountsAsActive(schedule.employee.operationalStatus, status)) return;
    const shift = aiRequiredShiftName(schedule.shift?.name ?? schedule.employee.shift?.name);
    if (!shift) return;
    const date = realtimeDateKeyFromDate(schedule.date);
    const key = aiRequiredRowKey(date, lob, shift);
    const current = rowsByKey.get(key) ?? emptyAiRequiredAgentsRow(date, lob, shift);
    if (status === "ESCALADO") current.escaladoStatus += 1;
    if (isScheduledStatus(status) || status === "NESTING") current.scheduled += 1;
    if (isPresentStatus(status)) current.present += 1;
    if (isAbsenceStatus(status)) current.absent += 1;
    if (aiRequiredCountsAsAvailable(status)) current.available += 1;
    rowsByKey.set(key, current);
  });

  const rows = Array.from(rowsByKey.values())
    .map((row) => finalizeAiRequiredAgentsRow(row))
    .sort((a, b) => `${a.date}|${a.lob}|${a.shift}`.localeCompare(`${b.date}|${b.lob}|${b.shift}`, "pt-BR"));

  return {
    startDate: period.startDate,
    endDate: period.endDate,
    total: summarizeAiRequiredAgentsRows("Total", rows),
    byLob: summarizeAiRequiredAgentsRowsBy(rows, "lob"),
    byDay: summarizeAiRequiredAgentsRowsBy(rows, "date"),
    rows
  };
}

function aiRequiredTargetLobs(query: RealtimeAiSnapshotQuery) {
  const explicit = query.requiredLob?.trim();
  if (explicit) {
    const requestedLobs = explicit
      .split(",")
      .map((lob) => aiRequiredLookupKey(lob))
      .filter(Boolean);
    if (requestedLobs.some((lob) => ["TODOS", "TODAS", "ALL"].includes(lob))) {
      return [...aiRequiredDefaultLobs];
    }
    return Array.from(
      new Set(requestedLobs.flatMap((lob) => (lob === "TNS" ? ["VIDEO", "COMMENTS"] : [lob])))
    );
  }
  return [...aiRequiredDefaultLobs];
}

function emptyAiRequiredAgentsRow(date: string, lob: string, shift: AiRequiredProductiveShift): AiRequiredAgentsRow {
  return {
    date,
    dateLabel: realtimeDateLabelFromKey(date),
    weekday: realtimeWeekdayFromKey(date),
    lob,
    shift,
    required: 0,
    available: 0,
    necessidade: 0,
    programado: 0,
    scheduled: 0,
    escaladoStatus: 0,
    present: 0,
    absent: 0,
    gap: 0,
    coverageRate: 0,
    absRate: 0,
    status: "Sem requerido"
  };
}

function finalizeAiRequiredAgentsRow(row: AiRequiredAgentsRow): AiRequiredAgentsRow {
  const gap = row.available - row.required;
  return {
    ...row,
    necessidade: row.required,
    programado: row.available,
    gap,
    coverageRate: aiRequiredCoverageRate(row.required, row.available),
    absRate: calculateAbsenceRate(row.scheduled, row.absent),
    status: aiRequiredCoverageStatus(row.required, row.available)
  };
}

function summarizeAiRequiredAgentsRows(label: string, rows: AiRequiredAgentsRow[]) {
  const total = rows.reduce(
    (acc, row) => ({
      required: acc.required + row.required,
      available: acc.available + row.available,
      scheduled: acc.scheduled + row.scheduled,
      escaladoStatus: acc.escaladoStatus + row.escaladoStatus,
      present: acc.present + row.present,
      absent: acc.absent + row.absent
    }),
    { required: 0, available: 0, scheduled: 0, escaladoStatus: 0, present: 0, absent: 0 }
  );
  return {
    label,
    ...total,
    necessidade: total.required,
    programado: total.available,
    gap: total.available - total.required,
    coverageRate: aiRequiredCoverageRate(total.required, total.available),
    absRate: calculateAbsenceRate(total.scheduled, total.absent),
    status: aiRequiredCoverageStatus(total.required, total.available)
  };
}

function aiRequiredCoverageRate(required: number, available: number) {
  return required > 0 ? Math.round((available / required) * 1000) / 10 : available > 0 ? 100 : 0;
}

function summarizeAiRequiredAgentsRowsBy(rows: AiRequiredAgentsRow[], field: "lob" | "date") {
  const grouped = new Map<string, AiRequiredAgentsRow[]>();
  rows.forEach((row) => {
    const key = field === "date" ? row.date : row.lob;
    const values = grouped.get(key) ?? [];
    values.push(row);
    grouped.set(key, values);
  });
  return Array.from(grouped.entries()).map(([key, values]) => summarizeAiRequiredAgentsRows(key, values));
}

function aiRequiredCountsAsAvailable(status: ReturnType<typeof normalizeOperationalStatus>) {
  if (status && aiRequiredCoverageStatuses.has(status)) return true;
  return status === "NESTING";
}

function aiRequiredEmployeeCountsAsActive(
  status: string | null | undefined,
  scheduleStatus: ReturnType<typeof normalizeOperationalStatus>
) {
  const key = String(status ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (key === "nesting") return aiRequiredCountsAsAvailable(scheduleStatus);
  return !aiRequiredInactiveEmployeeStatusTokens.has(key);
}

function aiRequiredMatchesTargetLob(lob: string, targetLobs: string[] | null) {
  if (!targetLobs) return true;
  const key = aiRequiredLookupKey(lob);
  return targetLobs.some((target) => aiRequiredLookupKey(target) === key);
}

function aiRequiredShiftName(value?: string | null): AiRequiredProductiveShift | null {
  const shift = shiftCategoryName(value);
  return aiRequiredProductiveShifts.includes(shift as AiRequiredProductiveShift) ? shift as AiRequiredProductiveShift : null;
}

function aiRequiredCoverageStatus(required: number, available: number) {
  if (required === 0 && available > 0) return "Sem requerido";
  if (required > 0 && available === 0) return "Sem cobertura";
  const gap = available - required;
  if (gap < 0) return "Déficit";
  if (gap === 0) return "OK";
  return "Sobra";
}

function aiRequiredRowKey(date: string, lob: string, shift: AiRequiredProductiveShift) {
  return `${date}|${aiRequiredLookupKey(lob)}|${shift}`;
}

function aiRequiredLookupKey(value: string) {
  return value.trim().toUpperCase();
}

function realtimeDateKeyFromDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function realtimeDateLabelFromKey(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function realtimeWeekdayFromKey(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(utcDateFromKey(value));
}

type AiReportLob = "ADS" | "TNS";
type AiReportQueueRow = ReturnType<typeof buildAiReportQueueRow>;
type AiReportDepartmentRow = ReturnType<typeof buildAiReportDepartmentRow>;

const realtimeApiActor: Actor = {
  email: "realtime-api@central.local",
  name: "Real Time API",
  role: "ADMIN"
};
const adsAiReportTargetLatencyMinutes = 120;
const adsAiReportTargetLatencyLabel = "2:00h";

function normalizeAiReportLobs(value?: string | null): AiReportLob[] {
  const normalized = normalizeHeader(String(value ?? "ALL"));
  if (normalized === "ads") return ["ADS"];
  if (normalized === "tns" || normalized === "video" || normalized === "comments") return ["TNS"];
  return ["ADS", "TNS"];
}

function buildAiReportQueueRows(rows: QueueCycleRow[], report: AiReportLob, search?: string | null, selectedCycle = "") {
  const normalizedSearch = normalizeHeader(String(search ?? ""));
  return rows.flatMap((row) => {
    const metadata = getQueueReportMetadataById(row.queueId);
    if (!matchesAiReportLob(metadata.lob, report)) return [];
    const reportRow = buildAiReportQueueRow(row, report, selectedCycle);
    if (!normalizedSearch) return [reportRow];
    const searchable = normalizeHeader([
      reportRow.report,
      reportRow.lob,
      reportRow.department,
      reportRow.queueId,
      reportRow.queueName,
      reportRow.latencyTarget
    ].join(" "));
    return searchable.includes(normalizedSearch) ? [reportRow] : [];
  });
}

function buildAiReportQueueRow(row: QueueCycleRow, report: AiReportLob, selectedCycle = "") {
  const metadata = getQueueReportMetadataById(row.queueId);
  const latencyTargetMinutes = getAiReportLatencyTargetMinutes(report, row.slaTargetMinutes);
  const latencyTarget = getAiReportLatencyTargetLabel(report, row.slaTargetMinutes);
  return {
    report,
    cycleDownload: selectedCycle,
    lob: metadata.lob,
    department: metadata.department,
    queueId: row.queueId || "Sem Fila ID",
    queueName: metadata.queueName || row.queueName,
    input: row.current.input,
    output: row.current.output,
    backlog: row.current.backlog,
    ahtMs: row.current.ahtMs,
    aht: formatDurationFromMs(row.current.ahtMs),
    averageLatencyMs: row.current.latencyMs,
    averageLatency: formatDurationFromMs(row.current.latencyMs),
    maxLatencyMs: row.current.maxLatencyMs,
    maxLatency: formatAiReportMaxLatency(row.current.maxLatencyMs, report),
    latencyTargetMinutes,
    latencyTarget,
    latencyAdherence: calculateLatencyAdherence(row.current.maxLatencyMs, latencyTargetMinutes),
    deltas: {
      input: row.deltas.input,
      output: row.deltas.output,
      backlog: row.deltas.backlog,
      ahtMs: row.deltas.ahtMs,
      aht: formatDurationDelta(row.deltas.ahtMs),
      averageLatencyMs: row.deltas.latencyMs,
      averageLatency: formatDurationDelta(row.deltas.latencyMs),
      maxLatencyMs: row.deltas.maxLatencyMs,
      maxLatency: formatAiReportMaxLatencyDelta(row.deltas.maxLatencyMs, report)
    }
  };
}

function buildAiReportDepartmentRows(report: AiReportLob, rows: AiReportQueueRow[]) {
  const groups = new Map<string, AiReportQueueRow[]>();
  for (const row of rows) {
    const key = `${row.report}::${row.lob}::${row.department}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return Array.from(groups.values()).map((groupRows) => buildAiReportDepartmentRow(report, groupRows));
}

function buildAiReportDepartmentRow(report: AiReportLob, rows: AiReportQueueRow[]) {
  const first = rows[0];
  const positiveAhtRows = rows.filter((row) => row.ahtMs !== null && row.ahtMs > 0);
  const maxLatencyQueue = rows.reduce<AiReportQueueRow | null>((currentMax, row) => {
    if (row.maxLatencyMs === null) return currentMax;
    if (!currentMax || currentMax.maxLatencyMs === null || row.maxLatencyMs > currentMax.maxLatencyMs) return row;
    return currentMax;
  }, null);
  const latencyTargetMinutes = maxLatencyQueue?.latencyTargetMinutes ?? getAiReportLatencyTargetMinutes(report, null);
  return {
    report,
    lob: first?.lob ?? "",
    department: first?.department ?? "",
    backlog: rows.reduce((sum, row) => sum + row.backlog, 0),
    ahtMs: positiveAhtRows.length
      ? positiveAhtRows.reduce((sum, row) => sum + (row.ahtMs ?? 0), 0) / positiveAhtRows.length
      : null,
    aht: formatDurationFromMs(positiveAhtRows.length
      ? positiveAhtRows.reduce((sum, row) => sum + (row.ahtMs ?? 0), 0) / positiveAhtRows.length
      : null),
    maxLatencyMs: maxLatencyQueue?.maxLatencyMs ?? null,
    maxLatency: formatAiReportMaxLatency(maxLatencyQueue?.maxLatencyMs ?? null, report),
    maxLatencyQueueId: maxLatencyQueue?.queueId ?? "",
    maxLatencyQueueName: maxLatencyQueue?.queueName ?? "",
    latencyTargetMinutes,
    latencyTarget: getAiReportLatencyTargetLabel(report, latencyTargetMinutes),
    latencyAdherence: calculateLatencyAdherence(maxLatencyQueue?.maxLatencyMs ?? null, latencyTargetMinutes),
    queueCount: rows.length
  };
}

function compareAiReportQueueRows(a: AiReportQueueRow, b: AiReportQueueRow) {
  if (a.report !== b.report) return a.report === "ADS" ? -1 : 1;
  if (a.report === "ADS") {
    return b.backlog - a.backlog
      || a.department.localeCompare(b.department, "pt-BR", { sensitivity: "base" })
      || a.queueName.localeCompare(b.queueName, "pt-BR", { sensitivity: "base" })
      || a.queueId.localeCompare(b.queueId);
  }
  const lobOrder = (lob: string) => lob === "VIDEO" ? 0 : lob === "COMMENTS" ? 1 : 2;
  return lobOrder(a.lob) - lobOrder(b.lob)
    || (a.latencyTargetMinutes ?? Number.MAX_SAFE_INTEGER) - (b.latencyTargetMinutes ?? Number.MAX_SAFE_INTEGER)
    || (b.maxLatencyMs ?? -1) - (a.maxLatencyMs ?? -1)
    || a.department.localeCompare(b.department, "pt-BR", { sensitivity: "base" })
    || a.queueName.localeCompare(b.queueName, "pt-BR", { sensitivity: "base" })
    || a.queueId.localeCompare(b.queueId);
}

function compareAiReportDepartmentRows(a: AiReportDepartmentRow, b: AiReportDepartmentRow) {
  if (a.report !== b.report) return a.report === "ADS" ? -1 : 1;
  return b.backlog - a.backlog
    || (b.maxLatencyMs ?? -1) - (a.maxLatencyMs ?? -1)
    || a.department.localeCompare(b.department, "pt-BR", { sensitivity: "base" });
}

function matchesAiReportLob(lob: string, report: AiReportLob) {
  if (report === "ADS") return lob === "ADS";
  return lob === "VIDEO" || lob === "COMMENTS";
}

function getAiReportLatencyTargetMinutes(report: AiReportLob, fallback: number | null | undefined) {
  return report === "ADS" ? adsAiReportTargetLatencyMinutes : fallback ?? null;
}

function getAiReportLatencyTargetLabel(report: AiReportLob, fallback: number | null | undefined) {
  if (report === "ADS") return adsAiReportTargetLatencyLabel;
  return formatSlaTargetMinutes(fallback);
}

function formatAiReportMaxLatency(value: number | null | undefined, report: AiReportLob) {
  return report === "ADS" ? formatLatencyAsHours(value) : formatDurationFromMs(value);
}

function formatAiReportMaxLatencyDelta(value: number | null | undefined, report: AiReportLob) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Sem comparação";
  if (value === 0) return report === "ADS" ? "0:00h" : "0:00s";
  const formatted = report === "ADS" ? formatLatencyAsHours(Math.abs(value)) : formatDurationFromMs(Math.abs(value));
  return `${value > 0 ? "+" : "-"}${formatted}`;
}

function formatLatencyAsHours(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  const totalMinutes = Math.max(0, Math.round(value / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}h`;
}

function summarizeAiReportRows(rows: AiReportQueueRow[]) {
  const byReport = new Map<AiReportLob, AiReportQueueRow[]>();
  for (const row of rows) byReport.set(row.report, [...(byReport.get(row.report) ?? []), row]);
  return Array.from(byReport.entries()).map(([report, reportRows]) => {
    const maxLatencyRow = reportRows.reduce<AiReportQueueRow | null>((currentMax, row) => {
      if (row.maxLatencyMs === null) return currentMax;
      if (!currentMax || currentMax.maxLatencyMs === null || row.maxLatencyMs > currentMax.maxLatencyMs) return row;
      return currentMax;
    }, null);
    return {
      report,
      rows: reportRows.length,
      departments: new Set(reportRows.map((row) => row.department)).size,
      backlog: reportRows.reduce((sum, row) => sum + row.backlog, 0),
      input: reportRows.reduce((sum, row) => sum + row.input, 0),
      output: reportRows.reduce((sum, row) => sum + row.output, 0),
      maxLatencyMs: maxLatencyRow?.maxLatencyMs ?? null,
      maxLatency: formatAiReportMaxLatency(maxLatencyRow?.maxLatencyMs ?? null, report),
      maxLatencyQueueId: maxLatencyRow?.queueId ?? "",
      maxLatencyQueueName: maxLatencyRow?.queueName ?? ""
    };
  });
}

function buildAiAgentProductivityRows(rows: AgentCycleRow[], selectedCycle: string) {
  return rows.map((row) => ({
    cycleDownload: selectedCycle,
    agent: row.displayName,
    wbLogin: row.wbLogin || row.rawWbLogin,
    rawWbLogin: row.rawWbLogin,
    crossingStatus: row.crossingStatus,
    personType: row.personType,
    employeeStatus: row.employeeStatus,
    currentStatus: row.presenceStatus,
    isScheduled: row.isScheduled,
    lob: row.lob,
    supervisor: row.supervisor,
    shift: row.shift,
    skill: row.skill,
    roleTitle: row.roleTitle,
    queueIds: row.queueBreakdown.map((queue) => queue.queueId || "Sem Fila ID"),
    queueNames: row.queueBreakdown.map((queue) => queue.queueName),
    submit: row.current.submit,
    ahtMs: row.current.ahtMs,
    aht: formatDurationFromMs(row.current.ahtMs),
    moderationMs: row.current.moderationMs,
    moderation: formatDurationFromMs(row.current.moderationMs),
    timeout: row.current.timeout,
    refresh: row.current.refresh,
    previous: row.previous ? {
      submit: row.previous.submit,
      ahtMs: row.previous.ahtMs,
      aht: formatDurationFromMs(row.previous.ahtMs),
      moderationMs: row.previous.moderationMs,
      moderation: formatDurationFromMs(row.previous.moderationMs),
      timeout: row.previous.timeout,
      refresh: row.previous.refresh
    } : null,
    deltas: {
      submit: row.deltas.submit,
      ahtMs: row.deltas.ahtMs,
      aht: formatDurationDelta(row.deltas.ahtMs),
      moderationMs: row.deltas.moderationMs,
      moderation: formatDurationDelta(row.deltas.moderationMs),
      timeout: row.deltas.timeout,
      refresh: row.deltas.refresh
    }
  }));
}

function parseAiSnapshotLimit(value: string | number | null | undefined, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function normalizeAiSnapshotFilters(query: RealtimeAiSnapshotQuery) {
  return {
    cycleDownload: query.cycleDownload ?? null,
    reportLob: query.reportLob ?? "ALL",
    requiredLob: query.requiredLob ?? aiRequiredDefaultLobs.join(","),
    search: query.search ?? null,
    crossingStatus: query.crossingStatus ?? null,
    personType: query.personType ?? null,
    employeeStatus: query.employeeStatus ?? null,
    presenceStatus: query.presenceStatus ?? null,
    lob: query.lob ?? null,
    supervisor: query.supervisor ?? null,
    shift: query.shift ?? null,
    skill: query.skill ?? null,
    roleTitle: query.roleTitle ?? null,
    queueSearch: query.queueSearch ?? null,
    queueLob: query.queueLob ?? null,
    queueStatus: query.queueStatus ?? null,
    queueSlaTarget: query.queueSlaTarget ?? null,
    queueId: query.queueId ?? null,
    sortBy: query.sortBy ?? "submit_desc"
  };
}

async function latestRealtimeCycle(recordType: "QUEUE" | "AGENT") {
  const batch = await prisma.realTimeImportBatch.findFirst({
    where: {
      status: "SUCCESS",
      ...(recordType === "QUEUE" ? { queueRows: { gt: 0 } } : { agentRows: { gt: 0 } })
    },
    orderBy: { importedAt: "desc" },
    select: {
      id: true,
      fileName: true,
      source: true,
      status: true,
      rowsTotal: true,
      queueRows: true,
      agentRows: true,
      importedAt: true,
      cycleDownload: true,
      cycleDownloads: true
    }
  });

  if (!batch) return null;

  const cycleDownloadFromBatch = readBatchCycleDownloads(batch)[0] ?? "";
  const cycleDownloadFromSummary = cycleDownloadFromBatch || (recordType === "QUEUE"
    ? (await prisma.realTimeQueueCycleSummary.findFirst({
      where: { batchId: batch.id },
      orderBy: { cycleDownload: "desc" },
      select: { cycleDownload: true }
    }))?.cycleDownload
    : (await prisma.realTimeAgentCycleSummary.findFirst({
      where: { batchId: batch.id },
      orderBy: { cycleDownload: "desc" },
      select: { cycleDownload: true }
    }))?.cycleDownload);

  let cycleDownload = cycleDownloadFromSummary ?? "";
  if (!cycleDownload) {
    const record = await prisma.realTimeRecord.findFirst({
      where: { batchId: batch.id, recordType },
      orderBy: { rowNumber: "asc" },
      select: { rawData: true }
    });
    const rawData = isPlainObject(record?.rawData) ? record.rawData : {};
    cycleDownload = extractCycleDownload(rawData) || formatCycleFromDate(batch.importedAt);
  }
  const minutesSinceImport = Math.max(0, Math.floor((Date.now() - batch.importedAt.getTime()) / 60000));

  return {
    batchId: batch.id,
    cycleDownload,
    fileName: batch.fileName,
    source: batch.source,
    status: batch.status,
    rows: recordType === "QUEUE" ? batch.queueRows : batch.agentRows,
    rowsTotal: batch.rowsTotal,
    importedAt: batch.importedAt.toISOString(),
    importedAtLabel: formatDateTime(batch.importedAt),
    minutesSinceImport,
    isStale: minutesSinceImport > staleThresholdMinutes
  };
}

export async function listRealtimeImports(actor: Actor) {
  if (!canAccessRealTime({ role: actor.role, email: actor.email, name: actor.name, roleTitle: actor.roleTitle, jobTitle: actor.jobTitle, skill: actor.skill, status: "ACTIVE" })) {
    return { error: "Você não tem permissão para acessar Real Time.", status: 403 };
  }

  const imports = await prisma.realTimeImportBatch.findMany({
    where: { importedAt: { gte: realtimeRetentionCutoff() } },
    orderBy: { importedAt: "desc" },
    take: 30,
    include: {
      agentSummaries: {
        select: {
          cycleDownload: true,
          wbLoginNormalized: true,
          crossingStatus: true
        }
      },
      queueSummaries: {
        select: {
          cycleDownload: true,
          queueId: true,
          queueName: true
        }
      }
    }
  });

  return {
    data: imports.map((item) => {
      const cycleDownloads = Array.from(new Set([
        ...item.agentSummaries.map((summary) => summary.cycleDownload),
        ...item.queueSummaries.map((summary) => summary.cycleDownload)
      ].filter(Boolean))).sort().reverse();
      const matchedEmployees = new Set(item.agentSummaries
        .filter((summary) => summary.crossingStatus === "Encontrado")
        .map((summary) => summary.wbLoginNormalized)
      );
      const unmatchedEmployees = new Set(item.agentSummaries
        .filter((summary) => summary.crossingStatus !== "Encontrado")
        .map((summary) => summary.wbLoginNormalized)
      );
      const mappedQueues = new Set(item.queueSummaries
        .filter((summary) => summary.queueId && summary.queueName !== "Fila não mapeada" && summary.queueName !== "Sem Fila ID")
        .map((summary) => summary.queueId)
      );
      const unmappedQueues = new Set(item.queueSummaries
        .filter((summary) => summary.queueId && (summary.queueName === "Fila não mapeada" || summary.queueName === "Sem Fila ID"))
        .map((summary) => summary.queueId || summary.queueName)
      );
      return {
        id: item.id,
        fileName: item.fileName,
        source: item.source,
        status: item.status,
        rowsTotal: item.rowsTotal,
        rowsValid: item.rowsTotal,
        rowsError: Array.isArray(item.warnings) ? item.warnings.length : 0,
        rowsInserted: item.rowsTotal,
        rowsUpdated: 0,
        queueRows: item.queueRows,
        agentRows: item.agentRows,
        cycleDownload: cycleDownloads[0] ?? "",
        cycleDownloads,
        matchedEmployees: matchedEmployees.size,
        unmatchedEmployees: unmatchedEmployees.size,
        mappedQueues: mappedQueues.size,
        unmappedQueues: unmappedQueues.size,
        importedAt: item.importedAt.toISOString(),
        importedAtLabel: formatDateTime(item.importedAt),
        errorMessage: item.errorMessage ?? "",
        warnings: Array.isArray(item.warnings) ? item.warnings : []
      };
    })
  };
}

export async function exportRealtimeAgents(actor: Actor, query: RealtimeExportQuery): Promise<XlsxExportPayload | { error: string; status: number }> {
  const exportView = query.view === "queues" ? "queues" : "both";
  const snapshot = await getRealtimeSnapshot(actor, { cycleDownload: query.cycleDownload, view: exportView });
  if ("error" in snapshot && snapshot.error) return { error: snapshot.error, status: snapshot.status ?? 400 };
  const snapshotData = "data" in snapshot ? snapshot.data : null;
  if (!snapshotData) return { error: "Não foi possível exportar Real Time.", status: 500 };

  const agentView = snapshotData.agents;
  const queueView = snapshotData.queueView;
  const rows = sortAgentRows(filterAgentRows(agentView.rows, query), query.sortBy ?? "submit_desc");
  const queueRows = sortQueueRows(filterQueueRows(queueView.rows, query), query.sortBy ?? "backlog_desc");
  const filteredSummary = summarizeAgentRows(rows.filter((row) => row.personType === "Agente"));
  const filteredQueueSummary = summarizeQueueRowsForExport(queueRows);
  const unfilteredUnmatched = agentView.rows.filter((row) => row.crossingStatus === "Não encontrado");
  const importRows = (await listRealtimeImports(actor));
  const imports = "error" in importRows ? [] : importRows.data;
  const queueSheets = [
    {
      sheetName: "Resumo Filas",
      headers: ["ciclo_download", "ciclo_anterior", "filas", "input", "output", "aht_medio", "latencia_media", "max_latencia", "backlog", "ok", "estavel", "risco", "estourado", "na"],
      rows: [[
        queueView.selectedCycle,
        queueView.previousCycle || "Sem comparação",
        queueRows.length,
        filteredQueueSummary.input,
        filteredQueueSummary.output,
        formatDurationFromMs(filteredQueueSummary.ahtMs),
        formatDurationFromMs(filteredQueueSummary.latencyMs),
        formatDurationFromMs(filteredQueueSummary.maxLatencyMs),
        filteredQueueSummary.backlog,
        queueRows.filter((row) => row.status === "OK").length,
        queueRows.filter((row) => row.status === "Estável").length,
        queueRows.filter((row) => row.status === "Risco").length,
        queueRows.filter((row) => row.status === "Estourado").length,
        queueRows.filter((row) => row.status === "N/A").length
      ]]
    },
    {
      sheetName: "Filas",
      headers: [
        "ciclo_download",
        "status_fila",
        "lob",
        "queue_id",
        "queue_name",
        "sla_target_minutes",
        "input",
        "input_delta",
        "output",
        "output_delta",
        "aht_formatado",
        "aht_delta_formatado",
        "latency_formatada",
        "latency_delta_formatada",
        "max_latency_formatada",
        "max_latency_delta_formatada",
        "meta_latency_formatada",
        "aderencia_latencia",
        "backlog",
        "backlog_delta"
      ],
      rows: queueRows.map((row) => [
        queueView.selectedCycle,
        row.status,
        row.lob,
        row.queueId || "Sem Fila ID",
        row.queueName,
        row.slaTargetMinutes ?? "Sem meta",
        row.current.input,
        row.deltas.input ?? "Sem comparação",
        row.current.output,
        row.deltas.output ?? "Sem comparação",
        formatDurationFromMs(row.current.ahtMs),
        row.deltas.ahtMs === null ? "Sem comparação" : formatMetricValue(row.deltas.ahtMs, "duration", true),
        formatDurationFromMs(row.current.latencyMs),
        row.deltas.latencyMs === null ? "Sem comparação" : formatMetricValue(row.deltas.latencyMs, "duration", true),
        formatDurationFromMs(row.current.maxLatencyMs),
        row.deltas.maxLatencyMs === null ? "Sem comparação" : formatMetricValue(row.deltas.maxLatencyMs, "duration", true),
        formatSlaTargetMinutes(row.slaTargetMinutes),
        calculateLatencyAdherence(row.current.maxLatencyMs, row.slaTargetMinutes),
        row.current.backlog,
        row.deltas.backlog ?? "Sem comparação"
      ])
    },
    {
      sheetName: "Detalhe por Fila",
      headers: ["queue_id", "queue_name", "lob", "sla_target_minutes", "meta_latency_formatada", "ciclo_download", "status_fila", "aderencia_latencia", "input", "output", "aht_formatado", "latency_formatada", "max_latency_formatada", "backlog"],
      rows: queueRows.flatMap((row) => row.history.map((item) => [
        row.queueId || "Sem Fila ID",
        row.queueName,
        row.lob,
        row.slaTargetMinutes ?? "Sem meta",
        formatSlaTargetMinutes(row.slaTargetMinutes),
        item.cycleDownload,
        item.status,
        calculateLatencyAdherence(item.maxLatencyMs, row.slaTargetMinutes),
        item.input,
        item.output,
        formatDurationFromMs(item.ahtMs),
        formatDurationFromMs(item.latencyMs),
        formatDurationFromMs(item.maxLatencyMs),
        item.backlog
      ]))
    },
    {
      sheetName: "Filas N/A",
      headers: ["ciclo_download", "queue_id", "queue_name", "meta_latency_formatada", "aderencia_latencia", "input", "output", "aht_formatado", "latency_formatada", "max_latency_formatada", "backlog"],
      rows: queueRows.filter((row) => row.lob === "N/A").map((row) => [
        queueView.selectedCycle,
        row.queueId || "Sem Fila ID",
        row.queueName,
        formatSlaTargetMinutes(row.slaTargetMinutes),
        calculateLatencyAdherence(row.current.maxLatencyMs, row.slaTargetMinutes),
        row.current.input,
        row.current.output,
        formatDurationFromMs(row.current.ahtMs),
        formatDurationFromMs(row.current.latencyMs),
        formatDurationFromMs(row.current.maxLatencyMs),
        row.current.backlog
      ])
    }
  ];

  const agentSheets = [
    {
      sheetName: "Agentes Real Time",
      headers: [
        "ciclo_download",
        "agente",
        "wb_login",
        "status_atual",
        "status_colaborador",
        "lob",
        "supervisor",
        "turno",
        "skill",
        "cargo_funcao",
        "submit",
        "aht_formatado",
        "moderation_formatada",
        "timeout_returns",
        "refresh_returns"
      ],
      rows: rows.map((row) => [
        agentView.selectedCycle,
        row.displayName,
        row.wbLogin || row.rawWbLogin,
        row.presenceStatus,
        row.employeeStatus,
        row.lob,
        row.supervisor,
        row.shift,
        row.skill,
        row.roleTitle,
        row.current.submit,
        formatDurationFromMs(row.current.ahtMs),
        formatDurationFromMs(row.current.moderationMs),
        row.current.timeout,
        row.current.refresh
      ])
    },
    {
      sheetName: "Historico por agente",
      headers: ["agente", "wb_login", "ciclo_download", "submit", "aht", "moderacao", "timeout", "refresh"],
      rows: rows.flatMap((row) => row.history.map((item) => [
        row.displayName,
        row.wbLogin || row.rawWbLogin,
        item.cycleDownload,
        item.submit,
        formatDurationFromMs(item.ahtMs),
        formatDurationFromMs(item.moderationMs),
        item.timeout,
        item.refresh
      ]))
    },
    {
      sheetName: "Nao encontrados",
      headers: ["ciclo_download", "wb_login", "submit", "aht", "moderacao", "timeout", "refresh"],
      rows: unfilteredUnmatched.map((row) => [
        agentView.selectedCycle,
        row.rawWbLogin,
        row.current.submit,
        formatDurationFromMs(row.current.ahtMs),
        formatDurationFromMs(row.current.moderationMs),
        row.current.timeout,
        row.current.refresh
      ])
    },
    {
      sheetName: "Filas tecnicas",
      headers: ["ciclo_download", "wb_login", "queue_id", "queue_name", "submit", "aht_formatado", "moderation_formatada", "timeout_returns", "refresh_returns"],
      rows: rows.flatMap((row) => row.queueBreakdown.map((queue) => [
        agentView.selectedCycle,
        row.wbLogin || row.rawWbLogin,
        queue.queueId || "Sem Fila ID",
        queue.queueName,
        queue.submit,
        formatDurationFromMs(queue.ahtMs),
        formatDurationFromMs(queue.moderationMs),
        queue.timeout,
        queue.refresh
      ]))
    },
    {
      sheetName: "Importacoes",
      headers: ["arquivo", "ciclo_download", "importado_em", "linhas_totais", "linhas_validas", "linhas_erro", "criados", "atualizados", "wbs_encontrados", "wbs_nao_encontrados", "filas_mapeadas", "filas_nao_mapeadas", "status"],
      rows: imports.map((item) => [
        item.fileName,
        item.cycleDownload,
        item.importedAtLabel,
        item.rowsTotal,
        item.rowsValid,
        item.rowsError,
        item.rowsInserted,
        item.rowsUpdated,
        item.matchedEmployees,
        item.unmatchedEmployees,
        item.mappedQueues,
        item.unmappedQueues,
        item.status
      ])
    }
  ];

  return {
    fileName: `real_time_${query.view === "queues" ? "filas" : "agentes"}_${agentView.selectedCycle || queueView.selectedCycle || "sem_ciclo"}.xlsx`,
    sheetName: "Resumo",
    headers: query.view === "queues"
      ? ["ciclo_download", "ciclo_anterior", "filas", "input", "output", "aht_medio", "latencia_media", "max_latencia", "backlog"]
      : ["ciclo_download", "ciclo_anterior", "submit_total", "aht_medio", "moderacao_total", "timeout", "refresh"],
    rows: query.view === "queues"
      ? [[
        queueView.selectedCycle,
        queueView.previousCycle || "Sem comparação",
        queueRows.length,
        filteredQueueSummary.input,
        filteredQueueSummary.output,
        formatDurationFromMs(filteredQueueSummary.ahtMs),
        formatDurationFromMs(filteredQueueSummary.latencyMs),
        formatDurationFromMs(filteredQueueSummary.maxLatencyMs),
        filteredQueueSummary.backlog
      ]]
      : [[
        agentView.selectedCycle,
        agentView.previousCycle || "Sem comparação",
        filteredSummary.submit,
        formatDurationFromMs(filteredSummary.ahtMs),
        formatDurationFromMs(filteredSummary.moderationMs),
        filteredSummary.timeout,
        filteredSummary.refresh
      ]],
    sheets: query.view === "queues" ? queueSheets : [...queueSheets, ...agentSheets]
  };
}

async function loadEmployeeMatches() {
  const employeeProfiles = await prisma.employeeProfile.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      wbLogin: true,
      fullName: true,
      operationalStatus: true,
      roleTitle: true,
      skill: true,
      supervisorId: true,
      user: { select: { email: true } },
      lob: { select: { name: true } },
      supervisor: { select: { fullName: true, wbLogin: true } },
      shift: { select: { name: true } }
    }
  });

  return employeeProfiles.map((employee): EmployeeMatch => ({
    id: employee.id,
    wbLogin: employee.wbLogin,
    userEmail: employee.user?.email ?? "",
    fullName: employee.fullName,
    operationalStatus: employee.operationalStatus,
    roleTitle: employee.roleTitle,
    skill: employee.skill ?? "",
    lob: employee.lob?.name ?? "",
    supervisor: employee.supervisor?.fullName ?? "",
    supervisorId: employee.supervisorId ?? "",
    shift: employee.shift?.name ?? ""
  }));
}

async function loadRawRealtimeRecordsForCycleRange(recordType: "AGENT" | "QUEUE", fromCycle: string, toCycle: string) {
  const records = await prisma.$queryRaw<Array<{
    batchId: string;
    rowNumber: number;
    rawData: Prisma.JsonValue;
    importedAt: Date;
    fileName: string;
  }>>(Prisma.sql`
    SELECT
      r."batchId",
      r."rowNumber",
      r."rawData",
      b."importedAt",
      b."fileName"
    FROM "RealTimeRecord" r
    JOIN "RealTimeImportBatch" b ON b."id" = r."batchId"
    WHERE r."recordType" = ${recordType}
      AND r."rawData"->>'ciclo_download' >= ${fromCycle}
      AND r."rawData"->>'ciclo_download' < ${toCycle}
    ORDER BY b."importedAt" ASC, r."rowNumber" ASC
  `);

  return records.map((record) => ({
    batchId: record.batchId,
    rowNumber: record.rowNumber,
    rawData: record.rawData,
    batch: {
      id: record.batchId,
      importedAt: record.importedAt,
      fileName: record.fileName
    }
  }));
}

function validateRealtimeAgentRows(rows: RawRow[]) {
  const numericFields = [
    ["审核量", "Submit"],
    ["平均AHT（毫秒）", "AHT"],
    ["超时退库量", "Timeout"],
    ["刷新退库量", "Refresh"],
    ["真实审核时长（毫秒）", "Moderação"]
  ] as const;
  const validRows: RawRow[] = [];
  const rowErrors: string[] = [];

  rows.forEach((row, index) => {
    const errors: string[] = [];
    for (const [key, label] of numericFields) {
      const rawValue = rawText(row, [key]);
      if (!rawValue) continue;
      if (parseOptionalRealtimeNumber(rawValue) === null) errors.push(`${label} inválido`);
    }
    if (errors.length) {
      rowErrors.push(`Linha ${index + 1}: ${errors.join(", ")}.`);
    } else {
      validRows.push(row);
    }
  });

  return { validRows, rowErrors };
}

function buildAgentCycleSummaryRows(rows: RawRow[], employeeMatches: EmployeeMatch[], fallbackDate: Date) {
  const employeesByWb = new Map(employeeMatches.map((employee) => [normalizeWbLogin(employee.wbLogin), employee]));
  const groupedByCycle = new Map<string, Array<{
    rawData: RawRow;
    cycleDownload: string;
    employee: EmployeeMatch | null;
    rawWbLogin: string;
    wbKey: string;
  }>>();

  rows.forEach((rawData, index) => {
    const cycleDownload = extractCycleDownload(rawData) || formatCycleFromDate(fallbackDate);
    const candidates = extractWbCandidates(rawData);
    const employee = candidates.map((candidate) => employeesByWb.get(candidate.normalized)).find(Boolean) ?? null;
    const rawWbLogin = employee?.wbLogin ?? candidates[0]?.raw ?? "";
    const wbKey = employee ? normalizeWbLogin(employee.wbLogin) : (candidates[0]?.normalized || `linha-${index + 1}`);
    const items = groupedByCycle.get(cycleDownload) ?? [];
    items.push({ rawData, cycleDownload, employee, rawWbLogin, wbKey });
    groupedByCycle.set(cycleDownload, items);
  });

  return Array.from(groupedByCycle.entries()).flatMap(([cycleDownload, items]) => (
    aggregateAgentCycleRows(items).map((row) => ({
      cycleDownload,
      wbLoginNormalized: row.key,
      rawWbLogin: row.rawWbLogin,
      employeeId: row.employeeId || null,
      displayName: row.displayName,
      wbLogin: row.wbLogin,
      crossingStatus: row.crossingStatus,
      personType: row.personType,
      employeeStatus: row.employeeStatus,
      lob: row.lob,
      supervisor: row.supervisor,
      shift: row.shift,
      skill: row.skill,
      roleTitle: row.roleTitle,
      submit: row.current.submit,
      ahtMs: row.current.ahtMs,
      moderationMs: row.current.moderationMs,
      timeout: row.current.timeout,
      refresh: row.current.refresh,
      queueCount: row.current.queueCount,
      sourceRows: row.current.sourceRows,
      queueBreakdown: row.queueBreakdown as unknown as Prisma.InputJsonValue
    }))
  ));
}

function buildQueueCycleSummaryRows(rows: RawRow[], fallbackDate: Date) {
  const groupedByCycle = new Map<string, Array<{
    rawData: RawRow;
    cycleDownload: string;
    rowNumber?: number;
  }>>();

  rows.forEach((rawData, index) => {
    const cycleDownload = extractCycleDownload(rawData) || formatCycleFromDate(fallbackDate);
    const items = groupedByCycle.get(cycleDownload) ?? [];
    items.push({ rawData, cycleDownload, rowNumber: index + 1 });
    groupedByCycle.set(cycleDownload, items);
  });

  return Array.from(groupedByCycle.entries()).flatMap(([cycleDownload, items]) => (
    aggregateQueueCycleRows(items).map((row) => ({
      cycleDownload,
      queueKey: row.key,
      queueId: row.queueId,
      queueName: row.queueName,
      lob: row.lob,
      slaTargetMinutes: row.slaTargetMinutes,
      status: row.status,
      input: row.current.input,
      output: row.current.output,
      ahtMs: row.current.ahtMs,
      latencyMs: row.current.latencyMs,
      maxLatencyMs: row.current.maxLatencyMs,
      maxLatencyRowNumber: row.current.maxLatencyRowNumber,
      backlog: row.current.backlog,
      sourceRows: row.current.sourceRows
    }))
  ));
}

function summarizeImportedSummaries(
  agentSummaries: Array<{
    cycleDownload: string;
    wbLoginNormalized: string;
    crossingStatus: string;
    queueBreakdown: Prisma.InputJsonValue;
  }>,
  queueSummaries: Array<{
    cycleDownload: string;
    queueId: string;
    queueName: string;
  }>
) {
  const cycleDownloads = new Set<string>();
  const matchedWbs = new Set<string>();
  const unmatchedWbs = new Set<string>();
  const mappedQueues = new Set<string>();
  const unmappedQueues = new Set<string>();

  agentSummaries.forEach((summary) => {
    if (summary.cycleDownload) cycleDownloads.add(summary.cycleDownload);
    if (summary.wbLoginNormalized) {
      if (summary.crossingStatus === "Encontrado") matchedWbs.add(summary.wbLoginNormalized);
      else unmatchedWbs.add(summary.wbLoginNormalized);
    }
    parseQueueBreakdown(summary.queueBreakdown as Prisma.JsonValue).forEach((queue) => {
      if (queue.queueId && queue.queueName !== "Fila não mapeada" && queue.queueName !== "Sem Fila ID") mappedQueues.add(queue.queueId);
      else if (queue.queueId) unmappedQueues.add(queue.queueId);
      else if (queue.queueName && queue.queueName !== "Sem Fila ID") unmappedQueues.add(queue.queueName);
    });
  });

  queueSummaries.forEach((summary) => {
    if (summary.cycleDownload) cycleDownloads.add(summary.cycleDownload);
    if (summary.queueId && summary.queueName !== "Fila não mapeada" && summary.queueName !== "Sem Fila ID") mappedQueues.add(summary.queueId);
    else if (summary.queueId) unmappedQueues.add(summary.queueId);
    else if (summary.queueName && summary.queueName !== "Sem Fila ID") unmappedQueues.add(summary.queueName);
  });

  return {
    cycleDownloads: Array.from(cycleDownloads).sort().reverse(),
    matchedEmployees: matchedWbs.size,
    unmatchedEmployees: unmatchedWbs.size,
    mappedQueues: mappedQueues.size,
    unmappedQueues: unmappedQueues.size
  };
}

function readBatchCycleDownloads(batch: RealtimeBatchReadRow) {
  const values = new Set<string>();
  if (batch.cycleDownload) values.add(batch.cycleDownload);
  if (Array.isArray(batch.cycleDownloads)) {
    batch.cycleDownloads.forEach((value) => {
      if (typeof value === "string" && value.trim()) values.add(value.trim());
    });
  }
  if (!values.size) values.add(formatCycleFromDate(batch.importedAt));
  return Array.from(values).sort().reverse();
}

function buildRealtimeCycleOptionsFromBatches(
  batches: RealtimeBatchReadRow[],
  rowCountKey: "agentRows" | "queueRows"
): RealtimeCycleOption[] {
  const latestByCycle = new Map<string, RealtimeCycleOption>();
  batches.forEach((batch) => {
    if (batch[rowCountKey] <= 0) return;
    readBatchCycleDownloads(batch).forEach((cycleDownload) => {
      const current = latestByCycle.get(cycleDownload);
      if (!current || batch.importedAt > current.importedAt) {
        latestByCycle.set(cycleDownload, {
          value: cycleDownload,
          batchId: batch.id,
          importedAt: batch.importedAt,
          rows: batch[rowCountKey]
        });
      }
    });
  });

  return Array.from(latestByCycle.values()).sort(compareRealtimeCyclesDesc);
}

function compareRealtimeCyclesDesc(a: RealtimeCycleOption, b: RealtimeCycleOption) {
  return b.importedAt.getTime() - a.importedAt.getTime() || b.value.localeCompare(a.value);
}

function formatRealtimeCycleOptions(cycleOptions: RealtimeCycleOption[]) {
  return cycleOptions
    .sort(compareRealtimeCyclesDesc)
    .map((cycle) => ({ ...cycle, importedAt: cycle.importedAt.toISOString(), importedAtLabel: formatDateTime(cycle.importedAt) }));
}

function resolveSelectedRealtimeCycle(cycleOptions: RealtimeCycleOption[], requestedCycle?: string) {
  if (!cycleOptions.length) return { selectedCycle: "", previousCycle: "", selectedIndex: -1 };
  const selectedCycle = requestedCycle && cycleOptions.some((cycle) => cycle.value === requestedCycle)
    ? requestedCycle
    : cycleOptions[0].value;
  const selectedIndex = cycleOptions.findIndex((cycle) => cycle.value === selectedCycle);
  return {
    selectedCycle,
    selectedIndex,
    previousCycle: resolvePreviousRealtimeCycle(cycleOptions, selectedCycle)
  };
}

function cycleDateKey(value: string) {
  return String(value ?? "").match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
}

function parseRealtimeCycleParts(value: string) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})[ T_](\d{2}):(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const normalized = `${year}-${month}-${day} ${hour}:${minute}`;
  return {
    normalized,
    dateKey: `${year}-${month}-${day}`,
    hour: Number(hour),
    minute: Number(minute),
    timestamp: Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))
  };
}

function dateKeyOffset(dateKey: string, days: number) {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return date.toISOString().slice(0, 10);
}

function resolvePreviousRealtimeCycle<T extends { value: string; importedAt: Date | string }>(cycleOptions: T[], selectedCycle: string) {
  const selected = parseRealtimeCycleParts(selectedCycle);
  if (!selected) return "";

  const candidates = cycleOptions
    .map((cycle) => ({ cycle, parsed: parseRealtimeCycleParts(cycle.value) }))
    .filter((item): item is { cycle: T; parsed: NonNullable<ReturnType<typeof parseRealtimeCycleParts>> } => Boolean(item.parsed))
    .filter((item) => item.parsed.timestamp < selected.timestamp);

  if (selected.hour === 0) {
    const previousDateKey = dateKeyOffset(selected.dateKey, -1);
    const previousDayLateHour = candidates
      .filter((item) => item.parsed.dateKey === previousDateKey && item.parsed.hour === 23)
      .sort((a, b) => b.parsed.timestamp - a.parsed.timestamp || cycleImportedAtTime(b.cycle) - cycleImportedAtTime(a.cycle))[0]?.cycle.value ?? "";
    if (previousDayLateHour) return previousDayLateHour;
  }

  return candidates
    .sort((a, b) => b.parsed.timestamp - a.parsed.timestamp || cycleImportedAtTime(b.cycle) - cycleImportedAtTime(a.cycle))[0]?.cycle.value ?? "";
}

function cycleImportedAtTime(cycle: { importedAt: Date | string }) {
  const value = cycle.importedAt instanceof Date ? cycle.importedAt.getTime() : new Date(cycle.importedAt).getTime();
  return Number.isFinite(value) ? value : 0;
}

function selectRealtimeBatchIdsForView(cycleOptions: RealtimeCycleOption[], selectedCycle: string, previousCycle: string) {
  const selectedDateKey = cycleDateKey(selectedCycle);
  const selectedParts = parseRealtimeCycleParts(selectedCycle);
  const selectedValues = new Set<string>();
  cycleOptions.forEach((cycle) => {
    if (selectedDateKey && cycleDateKey(cycle.value) === selectedDateKey) selectedValues.add(cycle.value);
  });
  const previousDateKey = selectedDateKey ? dateKeyOffset(selectedDateKey, -1) : "";
  const previousDayCycles = previousDateKey
    ? cycleOptions.filter((cycle) => cycleDateKey(cycle.value) === previousDateKey)
    : [];
  const previousDayCycle = previousDayCycles
    .sort((a, b) => b.value.localeCompare(a.value) || b.importedAt.getTime() - a.importedAt.getTime())[0]?.value ?? "";
  if (selectedCycle) selectedValues.add(selectedCycle);
  if (previousCycle) selectedValues.add(previousCycle);
  if (previousDayCycle) selectedValues.add(previousDayCycle);
  if (selectedParts?.hour === 0) {
    previousDayCycles.forEach((cycle) => selectedValues.add(cycle.value));
  }

  return Array.from(new Set(
    cycleOptions
      .filter((cycle) => selectedValues.has(cycle.value))
      .map((cycle) => cycle.batchId)
  ));
}

function buildQueueRealtimeViewFromSummaryRows(
  summaryRows: QueueSummaryReadRow[],
  options: RealtimeSnapshotOptions,
  cycleOptions?: RealtimeCycleOption[]
) {
  const latestBatchByCycle = new Map<string, { batchId: string; importedAt: Date }>();
  summaryRows.forEach((summary) => {
    const currentLatest = latestBatchByCycle.get(summary.cycleDownload);
    if (!currentLatest || summary.batch.importedAt > currentLatest.importedAt) {
      latestBatchByCycle.set(summary.cycleDownload, { batchId: summary.batchId, importedAt: summary.batch.importedAt });
    }
  });

  const latestRows = summaryRows.filter((summary) => latestBatchByCycle.get(summary.cycleDownload)?.batchId === summary.batchId);
  const cycleMap = new Map<string, { value: string; batchId: string; importedAt: Date; rows: number }>();
  latestRows.forEach((summary) => {
    const existing = cycleMap.get(summary.cycleDownload);
    if (!existing) {
      cycleMap.set(summary.cycleDownload, { value: summary.cycleDownload, batchId: summary.batchId, importedAt: summary.batch.importedAt, rows: 1 });
    } else {
      existing.rows += 1;
      if (summary.batch.importedAt > existing.importedAt) {
        existing.batchId = summary.batchId;
        existing.importedAt = summary.batch.importedAt;
      }
    }
  });

  const rawCycles = cycleOptions?.length
    ? cycleOptions
    : Array.from(cycleMap.values()).sort(compareRealtimeCyclesDesc);
  const cycles = formatRealtimeCycleOptions(rawCycles);

  if (!cycles.length) return emptyQueueRealtimeView();

  const selectedCycle = cycles.some((cycle) => cycle.value === options.cycleDownload) ? String(options.cycleDownload) : cycles[0].value;
  const previousCycle = resolvePreviousRealtimeCycle(cycles, selectedCycle);

  const latestRowsByCycle = new Map<string, QueueSummaryReadRow[]>();
  latestRows.forEach((summary) => {
    const current = latestRowsByCycle.get(summary.cycleDownload) ?? [];
    current.push(summary);
    latestRowsByCycle.set(summary.cycleDownload, current);
  });

  const groupedByCycle = new Map<string, QueueCycleRow[]>();
  for (const cycle of cycles) {
    groupedByCycle.set(cycle.value, (latestRowsByCycle.get(cycle.value) ?? []).map(queueSummaryToCycleRow));
  }

  const currentRows = groupedByCycle.get(selectedCycle) ?? [];
  const previousRows = groupedByCycle.get(previousCycle) ?? [];
  const previousByKey = new Map(previousRows.map((row) => [row.key, row.current]));
  const historyByKey = new Map<string, QueueCycleRow["history"]>();

  for (const cycle of cycles) {
    for (const row of groupedByCycle.get(cycle.value) ?? []) {
      const history = historyByKey.get(row.key) ?? [];
      history.push({
        cycleDownload: cycle.value,
        status: row.status,
        input: row.current.input,
        output: row.current.output,
        ahtMs: row.current.ahtMs,
        latencyMs: row.current.latencyMs,
        maxLatencyMs: row.current.maxLatencyMs,
        maxLatencyRowNumber: row.current.maxLatencyRowNumber,
        backlog: row.current.backlog
      });
      historyByKey.set(row.key, history);
    }
  }

  const baseRows = currentRows
    .map((row) => {
      const previous = previousByKey.get(row.key) ?? null;
      return {
        ...row,
        previous,
        deltas: {
          input: previous ? row.current.input - previous.input : null,
          output: previous ? row.current.output - previous.output : null,
          ahtMs: previous && row.current.ahtMs !== null && previous.ahtMs !== null ? row.current.ahtMs - previous.ahtMs : null,
          latencyMs: previous && row.current.latencyMs !== null && previous.latencyMs !== null ? row.current.latencyMs - previous.latencyMs : null,
          maxLatencyMs: previous && row.current.maxLatencyMs !== null && previous.maxLatencyMs !== null ? row.current.maxLatencyMs - previous.maxLatencyMs : null,
          backlog: previous ? row.current.backlog - previous.backlog : null
        },
        history: historyByKey.get(row.key) ?? row.history
      };
    })
    .sort(compareQueueRowsDefault);

  return {
    cycles,
    selectedCycle,
    previousCycle,
    filters: {
      lobs: countBy(baseRows.map((row) => row.lob)),
      statuses: countBy(baseRows.map((row) => row.status)),
      slaTargets: countBy(baseRows.map((row) => row.slaTargetMinutes === null ? "Sem meta" : String(row.slaTargetMinutes))),
      queueIds: countBy(baseRows.map((row) => row.queueId || "Sem Fila ID"))
    },
    rows: baseRows
  };
}

function queueSummaryToCycleRow(summary: {
  queueKey: string;
  queueId: string;
  queueName: string;
  lob: string;
  slaTargetMinutes: number | null;
  status: string;
  input: number;
  output: number;
  ahtMs: number | null;
  latencyMs: number | null;
  maxLatencyMs: number | null;
  maxLatencyRowNumber: number;
  backlog: number;
  sourceRows: number;
}): QueueCycleRow {
  const queueReference = resolveQueueReference(summary.queueId, summary.queueName);
  const lob = queueReference.queueId ? queueReference.lob : coerceQueueLob(summary.lob);
  const slaTargetMinutes = queueReference.queueId ? queueReference.slaTargetMinutes : summary.slaTargetMinutes;
  const status = calculateQueueStatus(summary.latencyMs, slaTargetMinutes);
  return {
    key: summary.queueKey,
    queueId: summary.queueId,
    queueName: queueReference.queueId ? queueReference.queueName : summary.queueName,
    lob,
    slaTargetMinutes,
    status,
    current: {
      input: summary.input,
      output: summary.output,
      ahtMs: summary.ahtMs,
      latencyMs: summary.latencyMs,
      maxLatencyMs: summary.maxLatencyMs,
      maxLatencyRowNumber: summary.maxLatencyRowNumber,
      backlog: summary.backlog,
      sourceRows: summary.sourceRows
    },
    previous: null,
    deltas: { input: null, output: null, ahtMs: null, latencyMs: null, maxLatencyMs: null, backlog: null },
    history: []
  };
}

function queueSummaryRowsFromRawRecords(records: Array<{
  batchId: string;
  rowNumber: number;
  rawData: Prisma.JsonValue;
  batch: { id: string; importedAt: Date; fileName: string };
}>): QueueSummaryReadRow[] {
  const groups = new Map<string, {
    batchId: string;
    cycleDownload: string;
    batch: { id: string; importedAt: Date; fileName: string };
    items: Array<{ rawData: RawRow; cycleDownload: string; rowNumber?: number }>;
  }>();

  records.forEach((record) => {
    const rawData = isPlainObject(record.rawData) ? record.rawData : {};
    const cycleDownload = extractCycleDownload(rawData) || formatCycleFromDate(record.batch.importedAt);
    const key = `${record.batchId}|${cycleDownload}`;
    const group = groups.get(key) ?? {
      batchId: record.batchId,
      cycleDownload,
      batch: record.batch,
      items: []
    };
    group.items.push({ rawData, cycleDownload, rowNumber: record.rowNumber });
    groups.set(key, group);
  });

  return Array.from(groups.values()).flatMap((group) => (
    aggregateQueueCycleRows(group.items).map((row) => ({
      batchId: group.batchId,
      cycleDownload: group.cycleDownload,
      queueKey: row.key,
      queueId: row.queueId,
      queueName: row.queueName,
      lob: row.lob,
      slaTargetMinutes: row.slaTargetMinutes,
      status: row.status,
      input: row.current.input,
      output: row.current.output,
      ahtMs: row.current.ahtMs,
      latencyMs: row.current.latencyMs,
      maxLatencyMs: row.current.maxLatencyMs,
      maxLatencyRowNumber: row.current.maxLatencyRowNumber,
      backlog: row.current.backlog,
      sourceRows: row.current.sourceRows,
      batch: group.batch
    }))
  ));
}

async function buildQueueRealtimeView(options: RealtimeSnapshotOptions) {
  const batches = await prisma.realTimeImportBatch.findMany({
    where: { status: "SUCCESS", queueRows: { gt: 0 }, importedAt: { gte: realtimeRetentionCutoff() } },
    orderBy: { importedAt: "desc" },
    take: realtimeViewHistoryBatchLimit,
    select: { id: true, fileName: true, importedAt: true, queueRows: true, agentRows: true, cycleDownload: true, cycleDownloads: true }
  });

  if (!batches.length) return emptyQueueRealtimeView();

  const cycleOptions = buildRealtimeCycleOptionsFromBatches(batches, "queueRows");
  const { selectedCycle: viewSelectedCycle, previousCycle: viewPreviousCycle } = resolveSelectedRealtimeCycle(cycleOptions, options.cycleDownload);
  const batchIds = selectRealtimeBatchIdsForView(cycleOptions, viewSelectedCycle, viewPreviousCycle);
  const summaryRows = await prisma.realTimeQueueCycleSummary.findMany({
    where: { batchId: { in: batchIds } },
    orderBy: [{ cycleDownload: "desc" }, { queueKey: "asc" }],
    select: {
      id: true,
      batchId: true,
      cycleDownload: true,
      queueKey: true,
      queueId: true,
      queueName: true,
      lob: true,
      slaTargetMinutes: true,
      status: true,
      input: true,
      output: true,
      ahtMs: true,
      latencyMs: true,
      maxLatencyMs: true,
      maxLatencyRowNumber: true,
      backlog: true,
      sourceRows: true,
      batch: { select: { id: true, importedAt: true, fileName: true } }
    }
  });
  const summarizedBatchIds = new Set(summaryRows.map((row) => row.batchId));
  const missingSummaryBatchIds = batchIds
    .filter((batchId) => !summarizedBatchIds.has(batchId))
    .slice(0, realtimeRawFallbackBatchLimit);
  if (missingSummaryBatchIds.length) {
    const fallbackRecords = await prisma.realTimeRecord.findMany({
      where: { recordType: "QUEUE", batchId: { in: missingSummaryBatchIds } },
      orderBy: { rowNumber: "asc" },
      select: {
        id: true,
        batchId: true,
        rowNumber: true,
        rawData: true,
        batch: { select: { id: true, importedAt: true, fileName: true } }
      }
    });
    const fallbackSummaryRows = queueSummaryRowsFromRawRecords(fallbackRecords);
    if (summaryRows.length || fallbackSummaryRows.length) {
      return buildQueueRealtimeViewFromSummaryRows([...summaryRows, ...fallbackSummaryRows], options, cycleOptions);
    }
  }
  if (summaryRows.length) return buildQueueRealtimeViewFromSummaryRows(summaryRows, options, cycleOptions);

  const rawFallbackBatchIds = batchIds.slice(0, realtimeRawFallbackBatchLimit);
  const records = await prisma.realTimeRecord.findMany({
    where: { recordType: "QUEUE", batchId: { in: rawFallbackBatchIds } },
    orderBy: { rowNumber: "asc" },
    select: {
      id: true,
      batchId: true,
      rowNumber: true,
      rawData: true,
      batch: { select: { id: true, importedAt: true, fileName: true } }
    }
  });

  const latestBatchByCycle = new Map<string, { batchId: string; importedAt: Date }>();
  const prepared = records.map((record) => {
    const rawData = isPlainObject(record.rawData) ? record.rawData : {};
    const cycleDownload = extractCycleDownload(rawData) || formatCycleFromDate(record.batch.importedAt);
    const currentLatest = latestBatchByCycle.get(cycleDownload);
    if (!currentLatest || record.batch.importedAt > currentLatest.importedAt) {
      latestBatchByCycle.set(cycleDownload, { batchId: record.batchId, importedAt: record.batch.importedAt });
    }
    return { record, rawData, cycleDownload };
  });

  const latestRecords = prepared.filter((item) => latestBatchByCycle.get(item.cycleDownload)?.batchId === item.record.batchId);
  const cycleMap = new Map<string, { value: string; batchId: string; importedAt: Date; rows: number }>();
  latestRecords.forEach((item) => {
    const existing = cycleMap.get(item.cycleDownload);
    if (!existing) {
      cycleMap.set(item.cycleDownload, { value: item.cycleDownload, batchId: item.record.batchId, importedAt: item.record.batch.importedAt, rows: 1 });
    } else {
      existing.rows += 1;
      if (item.record.batch.importedAt > existing.importedAt) {
        existing.batchId = item.record.batchId;
        existing.importedAt = item.record.batch.importedAt;
      }
    }
  });

  const cycles = Array.from(cycleMap.values())
    .sort((a, b) => b.importedAt.getTime() - a.importedAt.getTime() || b.value.localeCompare(a.value))
    .map((cycle) => ({ ...cycle, importedAt: cycle.importedAt.toISOString(), importedAtLabel: formatDateTime(cycle.importedAt) }));

  if (!cycles.length) return emptyQueueRealtimeView();

  const selectedCycle = cycles.some((cycle) => cycle.value === options.cycleDownload) ? String(options.cycleDownload) : cycles[0].value;
  const previousCycle = resolvePreviousRealtimeCycle(cycles, selectedCycle);

  const groupedByCycle = new Map<string, QueueCycleRow[]>();
  for (const cycle of cycles) {
    groupedByCycle.set(cycle.value, aggregateQueueCycleRows(
      latestRecords
        .filter((item) => item.cycleDownload === cycle.value)
        .map((item) => ({ rawData: item.rawData, cycleDownload: item.cycleDownload, rowNumber: item.record.rowNumber }))
    ));
  }

  const currentRows = groupedByCycle.get(selectedCycle) ?? [];
  const previousRows = groupedByCycle.get(previousCycle) ?? [];
  const previousByKey = new Map(previousRows.map((row) => [row.key, row.current]));
  const historyByKey = new Map<string, QueueCycleRow["history"]>();

  for (const cycle of cycles) {
    for (const row of groupedByCycle.get(cycle.value) ?? []) {
      const history = historyByKey.get(row.key) ?? [];
      history.push({
        cycleDownload: cycle.value,
        status: row.status,
        input: row.current.input,
        output: row.current.output,
        ahtMs: row.current.ahtMs,
        latencyMs: row.current.latencyMs,
        maxLatencyMs: row.current.maxLatencyMs,
        maxLatencyRowNumber: row.current.maxLatencyRowNumber,
        backlog: row.current.backlog
      });
      historyByKey.set(row.key, history);
    }
  }

  const rows = currentRows
    .map((row) => {
      const previous = previousByKey.get(row.key) ?? null;
      return {
        ...row,
        previous,
        deltas: {
          input: previous ? row.current.input - previous.input : null,
          output: previous ? row.current.output - previous.output : null,
          ahtMs: previous && row.current.ahtMs !== null && previous.ahtMs !== null ? row.current.ahtMs - previous.ahtMs : null,
          latencyMs: previous && row.current.latencyMs !== null && previous.latencyMs !== null ? row.current.latencyMs - previous.latencyMs : null,
          maxLatencyMs: previous && row.current.maxLatencyMs !== null && previous.maxLatencyMs !== null ? row.current.maxLatencyMs - previous.maxLatencyMs : null,
          backlog: previous ? row.current.backlog - previous.backlog : null
        },
        history: historyByKey.get(row.key) ?? row.history
      };
    })
    .sort(compareQueueRowsDefault);

  return {
    cycles,
    selectedCycle,
    previousCycle,
    filters: {
      lobs: countBy(rows.map((row) => row.lob)),
      statuses: countBy(rows.map((row) => row.status)),
      slaTargets: countBy(rows.map((row) => row.slaTargetMinutes === null ? "Sem meta" : String(row.slaTargetMinutes))),
      queueIds: countBy(rows.map((row) => row.queueId || "Sem Fila ID"))
    },
    rows
  };
}

async function buildAgentRealtimeViewFromSummaryRows(
  summaryRows: AgentSummaryReadRow[],
  options: RealtimeSnapshotOptions,
  cycleOptions?: RealtimeCycleOption[]
) {
  const latestBatchByCycle = new Map<string, { batchId: string; importedAt: Date }>();
  summaryRows.forEach((summary) => {
    const currentLatest = latestBatchByCycle.get(summary.cycleDownload);
    if (!currentLatest || summary.batch.importedAt > currentLatest.importedAt) {
      latestBatchByCycle.set(summary.cycleDownload, { batchId: summary.batchId, importedAt: summary.batch.importedAt });
    }
  });

  const latestRows = summaryRows.filter((summary) => latestBatchByCycle.get(summary.cycleDownload)?.batchId === summary.batchId);
  const cycleMap = new Map<string, { value: string; batchId: string; importedAt: Date; rows: number }>();
  latestRows.forEach((summary) => {
    const existing = cycleMap.get(summary.cycleDownload);
    if (!existing) {
      cycleMap.set(summary.cycleDownload, { value: summary.cycleDownload, batchId: summary.batchId, importedAt: summary.batch.importedAt, rows: 1 });
    } else {
      existing.rows += 1;
      if (summary.batch.importedAt > existing.importedAt) {
        existing.batchId = summary.batchId;
        existing.importedAt = summary.batch.importedAt;
      }
    }
  });

  const rawCycles = cycleOptions?.length
    ? cycleOptions
    : Array.from(cycleMap.values()).sort(compareRealtimeCyclesDesc);
  const cycles = formatRealtimeCycleOptions(rawCycles);

  if (!cycles.length) return emptyAgentRealtimeView();

  const selectedCycle = cycles.some((cycle) => cycle.value === options.cycleDownload) ? String(options.cycleDownload) : cycles[0].value;
  const previousCycle = resolvePreviousRealtimeCycle(cycles, selectedCycle);

  const latestRowsByCycle = new Map<string, AgentSummaryReadRow[]>();
  latestRows.forEach((summary) => {
    const current = latestRowsByCycle.get(summary.cycleDownload) ?? [];
    current.push(summary);
    latestRowsByCycle.set(summary.cycleDownload, current);
  });

  const groupedByCycle = new Map<string, AgentCycleRow[]>();
  for (const cycle of cycles) {
    groupedByCycle.set(cycle.value, (latestRowsByCycle.get(cycle.value) ?? []).map(agentSummaryToCycleRow));
  }

  const currentRows = groupedByCycle.get(selectedCycle) ?? [];
  const previousRows = groupedByCycle.get(previousCycle) ?? [];
  const previousByKey = new Map(previousRows.map((row) => [row.key, row.current]));
  const historyByKey = new Map<string, AgentCycleRow["history"]>();

  for (const cycle of cycles) {
    for (const row of groupedByCycle.get(cycle.value) ?? []) {
      const history = historyByKey.get(row.key) ?? [];
      history.push({
        cycleDownload: cycle.value,
        queueIds: row.queueBreakdown.map((queue) => queue.queueId).filter(Boolean),
        submit: row.current.submit,
        ahtMs: row.current.ahtMs,
        moderationMs: row.current.moderationMs,
        timeout: row.current.timeout,
        refresh: row.current.refresh
      });
      historyByKey.set(row.key, history);
    }
  }

  const baseRows = currentRows
    .map((row) => {
      const previous = previousByKey.get(row.key) ?? null;
      return {
        ...row,
        previous,
        deltas: {
          submit: previous ? row.current.submit - previous.submit : null,
          ahtMs: previous && row.current.ahtMs !== null && previous.ahtMs !== null ? row.current.ahtMs - previous.ahtMs : null,
          moderationMs: previous ? row.current.moderationMs - previous.moderationMs : null,
          timeout: previous ? row.current.timeout - previous.timeout : null,
          refresh: previous ? row.current.refresh - previous.refresh : null
        },
        history: historyByKey.get(row.key) ?? row.history
      };
    })
    .sort((a, b) => b.current.submit - a.current.submit || a.displayName.localeCompare(b.displayName));
  const presenceContext = await loadAgentPresenceContext(baseRows, selectedCycle);
  const rowsWithPresenceFallback = [
    ...baseRows,
    ...buildRealtimePresenceFallbackRows({
      existingRows: baseRows,
      candidates: presenceContext.captureRows,
      selectedCycle
    })
  ];
  const rows = rowsWithPresenceFallback.map((row) => ({
    ...row,
    presenceStatus: resolveAgentPresenceStatus(row, presenceContext),
    isScheduled: isAgentScheduledForPresence(row, presenceContext),
    isSchedulePresent: isAgentPresentInSchedule(row, presenceContext)
  }));

  const summaryCurrent = summarizeAgentRows(rows.filter((row) => row.personType === "Agente"));
  const summaryPrevious = previousCycle ? summarizeAgentRows(previousRows.filter((row) => row.personType === "Agente")) : null;

  return {
    cycles,
    selectedCycle,
    previousCycle,
    summary: {
      current: summaryCurrent,
      previous: summaryPrevious
    },
    cards: buildAgentSummaryCards(summaryCurrent, summaryPrevious),
    filters: {
      crossingStatuses: countBy(rows.map((row) => row.crossingStatus)),
      personTypes: countBy(rows.map((row) => row.personType)),
      employeeStatuses: countBy(rows.map((row) => row.employeeStatus).filter(Boolean)),
      presenceStatuses: countBy(rows.map((row) => row.presenceStatus)),
      lobs: countBy(rows.map((row) => row.lob).filter(Boolean)),
      supervisors: countBy(rows.map((row) => row.supervisor).filter(Boolean)),
      shifts: countBy(rows.map((row) => row.shift).filter(Boolean)),
      skills: countBy(rows.map((row) => row.skill).filter(Boolean)),
      roleTitles: countBy(rows.map((row) => row.roleTitle).filter(Boolean))
    },
    rows
  };
}

function agentSummaryToCycleRow(summary: {
  wbLoginNormalized: string;
  rawWbLogin: string;
  employeeId: string | null;
  displayName: string;
  wbLogin: string;
  crossingStatus: string;
  personType: string;
  employeeStatus: string;
  lob: string;
  supervisor: string;
  shift: string;
  skill: string;
  roleTitle: string;
  submit: number;
  ahtMs: number | null;
  moderationMs: number;
  timeout: number;
  refresh: number;
  queueCount: number;
  sourceRows: number;
  queueBreakdown: Prisma.JsonValue | null;
}): AgentCycleRow {
  return {
    key: summary.wbLoginNormalized,
    employeeId: summary.employeeId ?? "",
    displayName: summary.displayName,
    wbLogin: summary.wbLogin,
    rawWbLogin: summary.rawWbLogin,
    crossingStatus: summary.crossingStatus === "Encontrado" ? "Encontrado" : "Não encontrado",
    personType: coercePersonType(summary.personType),
    employeeStatus: summary.employeeStatus,
    presenceStatus: "Offline",
    isScheduled: false,
    isSchedulePresent: false,
    lob: summary.lob,
    supervisor: summary.supervisor,
    shift: summary.shift,
    skill: summary.skill,
    roleTitle: summary.roleTitle,
    current: {
      submit: summary.submit,
      ahtMs: summary.ahtMs,
      moderationMs: summary.moderationMs,
      timeout: summary.timeout,
      refresh: summary.refresh,
      queueCount: summary.queueCount,
      sourceRows: summary.sourceRows
    },
    previous: null,
    deltas: { submit: null, ahtMs: null, moderationMs: null, timeout: null, refresh: null },
    history: [],
    queueBreakdown: parseQueueBreakdown(summary.queueBreakdown)
  };
}

function agentSummaryRowsFromRawRecords(records: Array<{
  batchId: string;
  rowNumber: number;
  rawData: Prisma.JsonValue;
  batch: { id: string; importedAt: Date; fileName: string };
}>, employeeMatches: EmployeeMatch[]): AgentSummaryReadRow[] {
  const employeesByWb = new Map<string, EmployeeMatch>();
  employeeMatches.forEach((employee) => employeesByWb.set(normalizeWbLogin(employee.wbLogin), employee));
  const groups = new Map<string, {
    batchId: string;
    cycleDownload: string;
    batch: { id: string; importedAt: Date; fileName: string };
    items: Array<{
      rawData: RawRow;
      cycleDownload: string;
      employee: EmployeeMatch | null;
      rawWbLogin: string;
      wbKey: string;
    }>;
  }>();

  records.forEach((record) => {
    const rawData = isPlainObject(record.rawData) ? record.rawData : {};
    const cycleDownload = extractCycleDownload(rawData) || formatCycleFromDate(record.batch.importedAt);
    const candidates = extractWbCandidates(rawData);
    const employee = candidates.map((candidate) => employeesByWb.get(candidate.normalized)).find(Boolean) ?? null;
    const rawWbLogin = employee?.wbLogin ?? candidates[0]?.raw ?? "";
    const wbKey = employee ? normalizeWbLogin(employee.wbLogin) : (candidates[0]?.normalized || `linha-${record.batchId}-${record.rowNumber}`);
    const key = `${record.batchId}|${cycleDownload}`;
    const group = groups.get(key) ?? {
      batchId: record.batchId,
      cycleDownload,
      batch: record.batch,
      items: []
    };
    group.items.push({ rawData, cycleDownload, employee, rawWbLogin, wbKey });
    groups.set(key, group);
  });

  return Array.from(groups.values()).flatMap((group) => (
    aggregateAgentCycleRows(group.items).map((row) => ({
      batchId: group.batchId,
      cycleDownload: group.cycleDownload,
      wbLoginNormalized: row.key,
      rawWbLogin: row.rawWbLogin,
      employeeId: row.employeeId || null,
      displayName: row.displayName,
      wbLogin: row.wbLogin,
      crossingStatus: row.crossingStatus,
      personType: row.personType,
      employeeStatus: row.employeeStatus,
      lob: row.lob,
      supervisor: row.supervisor,
      shift: row.shift,
      skill: row.skill,
      roleTitle: row.roleTitle,
      submit: row.current.submit,
      ahtMs: row.current.ahtMs,
      moderationMs: row.current.moderationMs,
      timeout: row.current.timeout,
      refresh: row.current.refresh,
      queueCount: row.current.queueCount,
      sourceRows: row.current.sourceRows,
      queueBreakdown: row.queueBreakdown as unknown as Prisma.JsonValue,
      batch: group.batch
    }))
  ));
}

async function buildAgentRealtimeView(options: RealtimeSnapshotOptions) {
  const batches = await prisma.realTimeImportBatch.findMany({
    where: { status: "SUCCESS", agentRows: { gt: 0 }, importedAt: { gte: realtimeRetentionCutoff() } },
    orderBy: { importedAt: "desc" },
    take: realtimeViewHistoryBatchLimit,
    select: { id: true, fileName: true, importedAt: true, queueRows: true, agentRows: true, cycleDownload: true, cycleDownloads: true }
  });

  if (!batches.length) return emptyAgentRealtimeView();

  const cycleOptions = buildRealtimeCycleOptionsFromBatches(batches, "agentRows");
  const { selectedCycle: viewSelectedCycle, previousCycle: viewPreviousCycle } = resolveSelectedRealtimeCycle(cycleOptions, options.cycleDownload);
  const batchIds = selectRealtimeBatchIdsForView(cycleOptions, viewSelectedCycle, viewPreviousCycle);
  const summaryRows = await prisma.realTimeAgentCycleSummary.findMany({
    where: { batchId: { in: batchIds } },
    orderBy: [{ cycleDownload: "desc" }, { displayName: "asc" }],
    select: {
      id: true,
      batchId: true,
      cycleDownload: true,
      wbLoginNormalized: true,
      rawWbLogin: true,
      employeeId: true,
      displayName: true,
      wbLogin: true,
      crossingStatus: true,
      personType: true,
      employeeStatus: true,
      lob: true,
      supervisor: true,
      shift: true,
      skill: true,
      roleTitle: true,
      submit: true,
      ahtMs: true,
      moderationMs: true,
      timeout: true,
      refresh: true,
      queueCount: true,
      sourceRows: true,
      queueBreakdown: true,
      batch: { select: { id: true, importedAt: true, fileName: true } }
    }
  });
  const summarizedBatchIds = new Set(summaryRows.map((row) => row.batchId));
  const missingSummaryBatchIds = batchIds
    .filter((batchId) => !summarizedBatchIds.has(batchId))
    .slice(0, realtimeRawFallbackBatchLimit);
  if (missingSummaryBatchIds.length) {
    const fallbackRecords = await prisma.realTimeRecord.findMany({
      where: { recordType: "AGENT", batchId: { in: missingSummaryBatchIds } },
      orderBy: { rowNumber: "asc" },
      select: {
        id: true,
        batchId: true,
        rowNumber: true,
        rawData: true,
        batch: { select: { id: true, importedAt: true, fileName: true } }
      }
    });
    const employeeMatches = await loadEmployeeMatches();
    const fallbackSummaryRows = agentSummaryRowsFromRawRecords(fallbackRecords, employeeMatches);
    if (summaryRows.length || fallbackSummaryRows.length) {
      return await buildAgentRealtimeViewFromSummaryRows([...summaryRows, ...fallbackSummaryRows], options, cycleOptions);
    }
  }
  if (summaryRows.length) return await buildAgentRealtimeViewFromSummaryRows(summaryRows, options, cycleOptions);

  const rawFallbackBatchIds = batchIds.slice(0, realtimeRawFallbackBatchLimit);
  const records = await prisma.realTimeRecord.findMany({
    where: { recordType: "AGENT", batchId: { in: rawFallbackBatchIds } },
    orderBy: { rowNumber: "asc" },
    select: {
      id: true,
      batchId: true,
      rowNumber: true,
      rawData: true,
      batch: { select: { id: true, importedAt: true, fileName: true } }
    }
  });

  const employeesByWb = new Map<string, EmployeeMatch>();
  const employeeMatches = await loadEmployeeMatches();
  employeeMatches.forEach((employee) => employeesByWb.set(normalizeWbLogin(employee.wbLogin), employee));

  const latestBatchByCycle = new Map<string, { batchId: string; importedAt: Date }>();
  const prepared = records.map((record) => {
    const rawData = isPlainObject(record.rawData) ? record.rawData : {};
    const cycleDownload = extractCycleDownload(rawData) || formatCycleFromDate(record.batch.importedAt);
    const candidates = extractWbCandidates(rawData);
    const employee = candidates.map((candidate) => employeesByWb.get(candidate.normalized)).find(Boolean) ?? null;
    const rawWbLogin = employee?.wbLogin ?? candidates[0]?.raw ?? "";
    const wbKey = employee ? normalizeWbLogin(employee.wbLogin) : (candidates[0]?.normalized || `linha-${record.id}`);
    const currentLatest = latestBatchByCycle.get(cycleDownload);
    if (!currentLatest || record.batch.importedAt > currentLatest.importedAt) {
      latestBatchByCycle.set(cycleDownload, { batchId: record.batchId, importedAt: record.batch.importedAt });
    }
    return { record, rawData, cycleDownload, employee, rawWbLogin, wbKey };
  });

  const latestRecords = prepared.filter((item) => latestBatchByCycle.get(item.cycleDownload)?.batchId === item.record.batchId);

  const cycleMap = new Map<string, { value: string; batchId: string; importedAt: Date; rows: number }>();
  latestRecords.forEach((item) => {
    const existing = cycleMap.get(item.cycleDownload);
    if (!existing) {
      cycleMap.set(item.cycleDownload, { value: item.cycleDownload, batchId: item.record.batchId, importedAt: item.record.batch.importedAt, rows: 1 });
    } else {
      existing.rows += 1;
      if (item.record.batch.importedAt > existing.importedAt) {
        existing.batchId = item.record.batchId;
        existing.importedAt = item.record.batch.importedAt;
      }
    }
  });

  const cycles = Array.from(cycleMap.values())
    .sort((a, b) => b.importedAt.getTime() - a.importedAt.getTime() || b.value.localeCompare(a.value))
    .map((cycle) => ({ ...cycle, importedAt: cycle.importedAt.toISOString(), importedAtLabel: formatDateTime(cycle.importedAt) }));

  if (!cycles.length) return emptyAgentRealtimeView();

  const selectedCycle = cycles.some((cycle) => cycle.value === options.cycleDownload) ? String(options.cycleDownload) : cycles[0].value;
  const previousCycle = resolvePreviousRealtimeCycle(cycles, selectedCycle);

  const groupedByCycle = new Map<string, AgentCycleRow[]>();
  for (const cycle of cycles) {
    groupedByCycle.set(cycle.value, aggregateAgentCycleRows(latestRecords.filter((item) => item.cycleDownload === cycle.value)));
  }

  const currentRows = groupedByCycle.get(selectedCycle) ?? [];
  const previousRows = groupedByCycle.get(previousCycle) ?? [];
  const previousByKey = new Map(previousRows.map((row) => [row.key, row.current]));
  const historyByKey = new Map<string, AgentCycleRow["history"]>();

  for (const cycle of cycles) {
    for (const row of groupedByCycle.get(cycle.value) ?? []) {
      const history = historyByKey.get(row.key) ?? [];
      history.push({
        cycleDownload: cycle.value,
        queueIds: row.queueBreakdown.map((queue) => queue.queueId).filter(Boolean),
        submit: row.current.submit,
        ahtMs: row.current.ahtMs,
        moderationMs: row.current.moderationMs,
        timeout: row.current.timeout,
        refresh: row.current.refresh
      });
      historyByKey.set(row.key, history);
    }
  }

  const baseRows = currentRows
    .map((row) => {
      const previous = previousByKey.get(row.key) ?? null;
      return {
        ...row,
        previous,
        deltas: {
          submit: previous ? row.current.submit - previous.submit : null,
          ahtMs: previous && row.current.ahtMs !== null && previous.ahtMs !== null ? row.current.ahtMs - previous.ahtMs : null,
          moderationMs: previous ? row.current.moderationMs - previous.moderationMs : null,
          timeout: previous ? row.current.timeout - previous.timeout : null,
          refresh: previous ? row.current.refresh - previous.refresh : null
        },
        history: historyByKey.get(row.key) ?? row.history
      };
    })
    .sort((a, b) => b.current.submit - a.current.submit || a.displayName.localeCompare(b.displayName));

  const presenceContext = await loadAgentPresenceContext(baseRows, selectedCycle);
  const rowsWithPresenceFallback = [
    ...baseRows,
    ...buildRealtimePresenceFallbackRows({
      existingRows: baseRows,
      candidates: presenceContext.captureRows,
      selectedCycle
    })
  ];
  const rows = rowsWithPresenceFallback.map((row) => ({
    ...row,
    presenceStatus: resolveAgentPresenceStatus(row, presenceContext),
    isScheduled: isAgentScheduledForPresence(row, presenceContext),
    isSchedulePresent: isAgentPresentInSchedule(row, presenceContext)
  }));

  const summaryCurrent = summarizeAgentRows(rows.filter((row) => row.personType === "Agente"));
  const summaryPrevious = previousCycle ? summarizeAgentRows(previousRows.filter((row) => row.personType === "Agente")) : null;

  return {
    cycles,
    selectedCycle,
    previousCycle,
    summary: {
      current: summaryCurrent,
      previous: summaryPrevious
    },
    cards: buildAgentSummaryCards(summaryCurrent, summaryPrevious),
    filters: {
      crossingStatuses: countBy(rows.map((row) => row.crossingStatus)),
      personTypes: countBy(rows.map((row) => row.personType)),
      employeeStatuses: countBy(rows.map((row) => row.employeeStatus).filter(Boolean)),
      presenceStatuses: countBy(rows.map((row) => row.presenceStatus)),
      lobs: countBy(rows.map((row) => row.lob).filter(Boolean)),
      supervisors: countBy(rows.map((row) => row.supervisor).filter(Boolean)),
      shifts: countBy(rows.map((row) => row.shift).filter(Boolean)),
      skills: countBy(rows.map((row) => row.skill).filter(Boolean)),
      roleTitles: countBy(rows.map((row) => row.roleTitle).filter(Boolean))
    },
    rows
  };
}

async function loadAgentPresenceContext(rows: AgentCycleRow[], selectedCycle: string) {
  const selectedCycleInfo = parseRealtimeCycleForPresence(selectedCycle);
  const [scheduleByEmployeeId, capturePresence] = await Promise.all([
    loadRealtimeSchedulePresence(rows, selectedCycleInfo),
    getRealtimeHoursOperationalPresence()
  ]);
  const presenceByEmployeeId = new Map<string, AgentPresenceStatus>();
  const presenceByWbLogin = new Map<string, AgentPresenceStatus>();

  capturePresence.rows.forEach((presence) => {
    const status = mapRealtimeHoursPresenceStatus(presence.status);
    if (presence.employeeId) presenceByEmployeeId.set(presence.employeeId, status);
    const wbLogin = normalizeWbLogin(presence.wbLogin);
    if (wbLogin) presenceByWbLogin.set(wbLogin, status);
  });

  return {
    scheduleByEmployeeId,
    presenceByEmployeeId,
    presenceByWbLogin,
    captureRows: capturePresence.rows
  };
}

async function loadRealtimeSchedulePresence(rows: AgentCycleRow[], cycleInfo: ReturnType<typeof parseRealtimeCycleForPresence>) {
  const employeeIds = Array.from(new Set(rows.map((row) => row.employeeId).filter(Boolean)));
  const scheduleByEmployeeId = new Map<string, { scheduled: boolean; present: boolean; startsAt: string | null; endsAt: string | null }>();
  if (!cycleInfo || !employeeIds.length) return scheduleByEmployeeId;

  const previousDate = new Date(cycleInfo.date.getTime() - 24 * 60 * 60 * 1000);

  const schedules = await prisma.schedule.findMany({
    where: {
      employeeId: { in: employeeIds },
      date: { in: [cycleInfo.date, previousDate] },
      deletedAt: null
    },
    select: {
      employeeId: true,
      date: true,
      status: true,
      startsAt: true,
      endsAt: true,
      shift: { select: { name: true } }
    }
  });

  schedules.forEach((schedule) => {
    if (!isScheduleActiveAtRealtimeCycle(schedule, cycleInfo)) return;
    const current = scheduleByEmployeeId.get(schedule.employeeId);
    scheduleByEmployeeId.set(schedule.employeeId, {
      scheduled: true,
      present: Boolean(current?.present || isPresentStatus(schedule.status)),
      startsAt: schedule.startsAt,
      endsAt: schedule.endsAt
    });
  });

  return scheduleByEmployeeId;
}

function resolveAgentPresenceStatus(
  row: AgentCycleRow,
  context: Awaited<ReturnType<typeof loadAgentPresenceContext>>
): AgentPresenceStatus {
  if (row.employeeId) {
    const byEmployee = context.presenceByEmployeeId.get(row.employeeId);
    if (byEmployee) return byEmployee;
  }

  const wbLogins = [row.wbLogin, row.rawWbLogin].map(normalizeWbLogin).filter(Boolean);
  for (const wbLogin of wbLogins) {
    const byWbLogin = context.presenceByWbLogin.get(wbLogin);
    if (byWbLogin) return byWbLogin;
  }

  return "Offline";
}

function mapRealtimeHoursPresenceStatus(status: RealtimeHoursPresenceStatus): AgentPresenceStatus {
  if (status === "ONLINE") return "Online";
  if (status === "LOCKED") return "Tela bloqueada";
  if (status === "IDLE") return "Ocioso";
  return "Offline";
}

function isScheduleActiveAtRealtimeCycle(
  schedule: {
    date: Date;
    status?: string | null;
    startsAt?: string | null;
    endsAt?: string | null;
    shift?: { name?: string | null } | null;
  },
  cycleInfo: NonNullable<ReturnType<typeof parseRealtimeCycleForPresence>>
) {
  if (!isWorkHoursAllowedForSchedule(schedule)) return false;

  const startMinute = parseWorkHoursToMinutes(schedule.startsAt);
  const endMinute = parseWorkHoursToMinutes(schedule.endsAt);
  if (startMinute === null || endMinute === null || startMinute === endMinute) return true;

  const cycleMinute = cycleInfo.hour * 60 + cycleInfo.minute;
  const scheduleDateKey = schedule.date.toISOString().slice(0, 10);

  if (endMinute > startMinute) {
    return scheduleDateKey === cycleInfo.dateKey && cycleMinute >= startMinute && cycleMinute < endMinute;
  }

  if (scheduleDateKey === cycleInfo.dateKey) {
    return cycleMinute >= startMinute;
  }

  const nextScheduleDateKey = new Date(schedule.date.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return nextScheduleDateKey === cycleInfo.dateKey && cycleMinute < endMinute;
}

function isAgentScheduledForPresence(
  row: AgentCycleRow,
  context: Awaited<ReturnType<typeof loadAgentPresenceContext>>
) {
  return Boolean(row.employeeId && context.scheduleByEmployeeId.get(row.employeeId)?.scheduled);
}

function isAgentPresentInSchedule(
  row: AgentCycleRow,
  context: Awaited<ReturnType<typeof loadAgentPresenceContext>>
) {
  return Boolean(row.employeeId && context.scheduleByEmployeeId.get(row.employeeId)?.present);
}

function parseRealtimeCycleForPresence(value: string) {
  const match = String(value ?? "").match(/(\d{4})-(\d{2})-(\d{2})[ T_](\d{2}):(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const dateKey = `${year}-${month}-${day}`;
  const timestamp = Date.parse(`${dateKey}T${hour}:${minute}:00-03:00`);
  if (!Number.isFinite(timestamp)) return null;
  return {
    date: new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))),
    dateKey,
    hour: Number(hour),
    minute: Number(minute),
    timestamp
  };
}

function aggregateAgentCycleRows(items: Array<{
  rawData: RawRow;
  cycleDownload: string;
  employee: EmployeeMatch | null;
  rawWbLogin: string;
  wbKey: string;
}>) {
  type MutableAgg = {
    key: string;
    employee: EmployeeMatch | null;
    rawWbLogin: string;
    submit: number;
    weightedAhtMs: number;
    simpleAhtMs: number;
    simpleAhtCount: number;
    moderationMs: number;
    timeout: number;
    refresh: number;
    sourceRows: number;
    queues: Map<string, {
      queueId: string;
      queueName: string;
      submit: number;
      weightedAhtMs: number;
      simpleAhtMs: number;
      simpleAhtCount: number;
      moderationMs: number;
      timeout: number;
      refresh: number;
    }>;
  };

  const groups = new Map<string, MutableAgg>();

  for (const item of items) {
    const key = item.wbKey;
    const submit = Math.max(0, parseRealtimeNumberFromRow(item.rawData, ["审核量", "Revisados", "submit", "Submit"]));
    const ahtMs = parseOptionalRealtimeNumberFromRow(item.rawData, ["平均AHT（毫秒）", "avg_aht_ms", "aht_ms"]);
    const timeout = Math.max(0, parseRealtimeNumberFromRow(item.rawData, ["超时退库量", "timeout", "timeout_returns"]));
    const refresh = Math.max(0, parseRealtimeNumberFromRow(item.rawData, ["刷新退库量", "refresh", "refresh_returns"]));
    const moderationMs = Math.max(0, parseRealtimeNumberFromRow(item.rawData, ["真实审核时长（毫秒）", "moderation_duration_ms"]));
    const queueReference = resolveQueueReference(
      rawText(item.rawData, ["队列id", "Fila ID", "queue_id", "queue id"]),
      rawText(item.rawData, ["当前队列", "队列名称", "Nome da fila", "queue_name", "queue name", "Fila atual"])
    );
    const queueId = queueReference.queueId;
    const queueName = queueReference.queueName;
    const queueKey = queueId || `sem-fila-id:${queueName}`;
    const group = groups.get(key) ?? {
      key,
      employee: item.employee,
      rawWbLogin: item.rawWbLogin,
      submit: 0,
      weightedAhtMs: 0,
      simpleAhtMs: 0,
      simpleAhtCount: 0,
      moderationMs: 0,
      timeout: 0,
      refresh: 0,
      sourceRows: 0,
      queues: new Map()
    };

    group.employee = group.employee ?? item.employee;
    group.rawWbLogin = group.rawWbLogin || item.rawWbLogin;
    group.submit += submit;
    group.moderationMs += moderationMs;
    group.timeout += timeout;
    group.refresh += refresh;
    group.sourceRows += 1;
    if (ahtMs !== null && ahtMs >= 0) {
      if (submit > 0) group.weightedAhtMs += ahtMs * submit;
      else {
        group.simpleAhtMs += ahtMs;
        group.simpleAhtCount += 1;
      }
    }

    const queue = group.queues.get(queueKey) ?? {
      queueId,
      queueName,
      submit: 0,
      weightedAhtMs: 0,
      simpleAhtMs: 0,
      simpleAhtCount: 0,
      moderationMs: 0,
      timeout: 0,
      refresh: 0
    };
    queue.submit += submit;
    queue.moderationMs += moderationMs;
    queue.timeout += timeout;
    queue.refresh += refresh;
    if (ahtMs !== null && ahtMs >= 0) {
      if (submit > 0) queue.weightedAhtMs += ahtMs * submit;
      else {
        queue.simpleAhtMs += ahtMs;
        queue.simpleAhtCount += 1;
      }
    }
    group.queues.set(queueKey, queue);
    groups.set(key, group);
  }

  return Array.from(groups.values()).map((group): AgentCycleRow => {
    const queueBreakdown = Array.from(group.queues.values()).map((queue) => ({
      queueId: queue.queueId,
      queueName: queue.queueName,
      submit: queue.submit,
      ahtMs: resolveAhtMs(queue.submit, queue.weightedAhtMs, queue.simpleAhtMs, queue.simpleAhtCount),
      moderationMs: queue.moderationMs,
      timeout: queue.timeout,
      refresh: queue.refresh
    })).sort((a, b) => b.submit - a.submit || a.queueName.localeCompare(b.queueName));
    const current: AgentCycleMetric = {
      submit: group.submit,
      ahtMs: resolveAhtMs(group.submit, group.weightedAhtMs, group.simpleAhtMs, group.simpleAhtCount),
      moderationMs: group.moderationMs,
      timeout: group.timeout,
      refresh: group.refresh,
      queueCount: queueBreakdown.length,
      sourceRows: group.sourceRows
    };
    const employee = group.employee;
    const isMatched = Boolean(employee);
    const personType = !employee ? "Não encontrado" : isAgentJobTitle(employee.roleTitle) ? "Agente" : "Staff";
    return {
      key: group.key,
      employeeId: employee?.id ?? "",
      displayName: employee?.fullName ?? "Não encontrado",
      wbLogin: employee?.wbLogin ?? "",
      rawWbLogin: group.rawWbLogin,
      crossingStatus: isMatched ? "Encontrado" : "Não encontrado",
      personType,
      employeeStatus: employee?.operationalStatus ?? "Não encontrado",
      presenceStatus: "Offline",
      isScheduled: false,
      isSchedulePresent: false,
      lob: employee?.lob ?? "Não encontrado",
      supervisor: employee?.supervisor ?? "Não encontrado",
      shift: employee?.shift ?? "Não encontrado",
      skill: employee?.skill ?? "Não encontrado",
      roleTitle: employee?.roleTitle ?? "Não encontrado",
      current,
      previous: null,
      deltas: { submit: null, ahtMs: null, moderationMs: null, timeout: null, refresh: null },
      history: [],
      queueBreakdown
    };
  });
}

function aggregateQueueCycleRows(items: Array<{
  rawData: RawRow;
  cycleDownload: string;
  rowNumber?: number;
}>) {
  type MutableQueueAgg = {
    key: string;
    queueId: string;
    queueName: string;
    lob: "ADS" | "VIDEO" | "COMMENTS" | "N/A";
    slaTargetMinutes: number | null;
    input: number;
    output: number;
    backlog: number;
    weightedAhtMs: number;
    simpleAhtMs: number;
    simpleAhtCount: number;
    weightedLatencyByBacklogMs: number;
    latencyBacklogWeight: number;
    weightedLatencyByInputMs: number;
    latencyInputWeight: number;
    simpleLatencyMs: number;
    simpleLatencyCount: number;
    maxLatencyMs: number | null;
    maxLatencyRowNumber: number;
    sourceRows: number;
  };

  const groups = new Map<string, MutableQueueAgg>();

  for (const item of items) {
    const queueReference = resolveQueueReference(
      rawText(item.rawData, ["队列id", "Fila ID", "queue_id", "queue id"]),
      rawText(item.rawData, ["队列名称", "当前队列", "Nome da fila", "queue_name", "queue name", "Fila atual"])
    );
    const key = queueReference.queueId || queueReference.queueName;
    const input = Math.max(0, parseRealtimeNumberFromRow(item.rawData, ["进审量", "input", "Input"]));
    const output = Math.max(0, parseRealtimeNumberFromRow(item.rawData, ["审核量", "output", "Output"]));
    const ahtMs = parseOptionalRealtimeNumberFromRow(item.rawData, ["平均AHT", "平均AHT（毫秒）", "avg_aht_ms", "aht_ms"]);
    const latencyMs = parseOptionalRealtimeNumberFromRow(item.rawData, ["平均延时（毫秒）", "latency_ms", "sla_ms"]);
    const maxLatencyMs = parseOptionalRealtimeNumberFromRow(item.rawData, ["待审最大延时（毫秒）", "最大延时（毫秒）", "max_latency_ms", "max latency"]);
    const backlog = Math.max(0, parseRealtimeNumberFromRow(item.rawData, ["待审量", "backlog", "Backlog"]));
    const group = groups.get(key) ?? {
      key,
      queueId: queueReference.queueId,
      queueName: queueReference.queueName,
      lob: queueReference.lob,
      slaTargetMinutes: queueReference.slaTargetMinutes,
      input: 0,
      output: 0,
      backlog: 0,
      weightedAhtMs: 0,
      simpleAhtMs: 0,
      simpleAhtCount: 0,
      weightedLatencyByBacklogMs: 0,
      latencyBacklogWeight: 0,
      weightedLatencyByInputMs: 0,
      latencyInputWeight: 0,
      simpleLatencyMs: 0,
      simpleLatencyCount: 0,
      maxLatencyMs: null,
      maxLatencyRowNumber: -1,
      sourceRows: 0
    };

    group.input += input;
    group.output += output;
    group.backlog += backlog;
    group.sourceRows += 1;
    if (ahtMs !== null && ahtMs >= 0) {
      if (output > 0) group.weightedAhtMs += ahtMs * output;
      else {
        group.simpleAhtMs += ahtMs;
        group.simpleAhtCount += 1;
      }
    }
    if (latencyMs !== null && latencyMs >= 0) {
      if (backlog > 0) {
        group.weightedLatencyByBacklogMs += latencyMs * backlog;
        group.latencyBacklogWeight += backlog;
      } else if (input > 0) {
        group.weightedLatencyByInputMs += latencyMs * input;
        group.latencyInputWeight += input;
      } else {
        group.simpleLatencyMs += latencyMs;
        group.simpleLatencyCount += 1;
      }
    }
    if (maxLatencyMs !== null && maxLatencyMs >= 0 && (item.rowNumber ?? 0) >= group.maxLatencyRowNumber) {
      group.maxLatencyMs = maxLatencyMs;
      group.maxLatencyRowNumber = item.rowNumber ?? 0;
    }
    groups.set(key, group);
  }

  return Array.from(groups.values()).map((group): QueueCycleRow => {
    const ahtMs = resolveAhtMs(group.output, group.weightedAhtMs, group.simpleAhtMs, group.simpleAhtCount);
    const latencyMs = resolveQueueLatencyMs(group);
    const status = calculateQueueStatus(latencyMs, group.slaTargetMinutes);
    return {
      key: group.key,
      queueId: group.queueId,
      queueName: group.queueName,
      lob: group.lob,
      slaTargetMinutes: group.slaTargetMinutes,
      status,
      current: {
        input: group.input,
        output: group.output,
        ahtMs,
        latencyMs,
        maxLatencyMs: group.maxLatencyMs,
        maxLatencyRowNumber: group.maxLatencyRowNumber,
        backlog: group.backlog,
        sourceRows: group.sourceRows
      },
      previous: null,
      deltas: { input: null, output: null, ahtMs: null, latencyMs: null, maxLatencyMs: null, backlog: null },
      history: []
    };
  });
}

function resolveQueueLatencyMs(group: {
  weightedLatencyByBacklogMs: number;
  latencyBacklogWeight: number;
  weightedLatencyByInputMs: number;
  latencyInputWeight: number;
  simpleLatencyMs: number;
  simpleLatencyCount: number;
}) {
  if (group.latencyBacklogWeight > 0) return group.weightedLatencyByBacklogMs / group.latencyBacklogWeight;
  if (group.latencyInputWeight > 0) return group.weightedLatencyByInputMs / group.latencyInputWeight;
  if (group.simpleLatencyCount > 0) return group.simpleLatencyMs / group.simpleLatencyCount;
  return null;
}

function calculateQueueStatus(latencyMs: number | null, slaTargetMinutes: number | null): QueueStatus {
  if (latencyMs === null || !slaTargetMinutes || slaTargetMinutes <= 0) return "N/A";
  const targetMs = slaTargetMinutes * 60 * 1000;
  if (latencyMs <= targetMs * 0.8) return "OK";
  if (latencyMs <= targetMs) return "Estável";
  if (latencyMs <= targetMs * 1.2) return "Risco";
  return "Estourado";
}

function coerceQueueStatus(value: string): QueueStatus {
  if (value === "OK" || value === "Estável" || value === "Risco" || value === "Estourado" || value === "N/A") return value;
  return "N/A";
}

function coerceQueueLob(value: string): QueueCycleRow["lob"] {
  if (value === "ADS" || value === "VIDEO" || value === "COMMENTS") return value;
  return "N/A";
}

function coercePersonType(value: string): AgentCycleRow["personType"] {
  if (value === "Agente" || value === "Staff" || value === "Não encontrado") return value;
  return "Não encontrado";
}

function parseQueueBreakdown(value: Prisma.JsonValue | null): AgentCycleRow["queueBreakdown"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isPlainObject(item)) return [];
    return [{
      queueId: stringValue(item.queueId),
      queueName: stringValue(item.queueName),
      submit: Number(item.submit) || 0,
      ahtMs: Number.isFinite(Number(item.ahtMs)) ? Number(item.ahtMs) : null,
      moderationMs: Number(item.moderationMs) || 0,
      timeout: Number(item.timeout) || 0,
      refresh: Number(item.refresh) || 0
    }];
  });
}

function compareQueueRowsDefault(a: QueueCycleRow, b: QueueCycleRow) {
  const severity = (status: QueueStatus) => {
    if (status === "Estourado") return 4;
    if (status === "Risco") return 3;
    if (status === "Estável") return 2;
    if (status === "OK") return 1;
    return 0;
  };
  return severity(b.status) - severity(a.status)
    || b.current.backlog - a.current.backlog
    || a.queueId.localeCompare(b.queueId);
}

function summarizeAgentRows(rows: AgentCycleRow[]) {
  const submit = rows.reduce((sum, row) => sum + row.current.submit, 0);
  const weightedAht = rows.reduce((sum, row) => sum + (row.current.ahtMs !== null ? row.current.ahtMs * row.current.submit : 0), 0);
  const simpleAhtRows = rows.filter((row) => row.current.submit === 0 && row.current.ahtMs !== null);
  const simpleAht = simpleAhtRows.reduce((sum, row) => sum + (row.current.ahtMs ?? 0), 0);
  return {
    recordsImported: rows.reduce((sum, row) => sum + row.current.sourceRows, 0),
    matched: rows.filter((row) => row.crossingStatus === "Encontrado").length,
    unmatched: rows.filter((row) => row.crossingStatus === "Não encontrado").length,
    submit,
    ahtMs: submit > 0 ? weightedAht / submit : simpleAhtRows.length ? simpleAht / simpleAhtRows.length : null,
    moderationMs: rows.reduce((sum, row) => sum + row.current.moderationMs, 0),
    timeout: rows.reduce((sum, row) => sum + row.current.timeout, 0),
    refresh: rows.reduce((sum, row) => sum + row.current.refresh, 0)
  };
}

function buildAgentSummaryCards(current: ReturnType<typeof summarizeAgentRows>, previous: ReturnType<typeof summarizeAgentRows> | null) {
  return [
    buildSummaryCard("Submit total", current.submit, previous?.submit ?? null, "number", "up"),
    buildSummaryCard("AHT médio", current.ahtMs, previous?.ahtMs ?? null, "duration", "down"),
    buildSummaryCard("Moderação total", current.moderationMs, previous?.moderationMs ?? null, "duration", "neutral"),
    buildSummaryCard("Timeout", current.timeout, previous?.timeout ?? null, "number", "down"),
    buildSummaryCard("Refresh", current.refresh, previous?.refresh ?? null, "number", "down")
  ];
}

function buildSummaryCard(label: string, current: number | null, previous: number | null, format: "number" | "duration", positiveDirection: "up" | "down" | "neutral") {
  const delta = current !== null && previous !== null ? current - previous : null;
  return {
    label,
    value: formatMetricValue(current, format),
    previous: previous === null ? "" : formatMetricValue(previous, format),
    delta: delta === null ? "" : formatMetricValue(delta, format, true),
    trend: delta === null || delta === 0 || positiveDirection === "neutral" ? "neutral" : (positiveDirection === "up" ? delta > 0 : delta < 0) ? "positive" : "negative",
    direction: delta === null || delta === 0 ? "none" : delta > 0 ? "up" : "down"
  };
}

function emptyAgentRealtimeView() {
  return {
    cycles: [] as Array<{ value: string; batchId: string; importedAt: string; importedAtLabel: string; rows: number }>,
    selectedCycle: "",
    previousCycle: "",
    summary: {
      current: { recordsImported: 0, matched: 0, unmatched: 0, submit: 0, ahtMs: null as number | null, moderationMs: 0, timeout: 0, refresh: 0 },
      previous: null as ReturnType<typeof summarizeAgentRows> | null
    },
    cards: [] as ReturnType<typeof buildAgentSummaryCards>,
    filters: {
      crossingStatuses: [] as ReturnType<typeof countBy>,
      personTypes: [] as ReturnType<typeof countBy>,
      employeeStatuses: [] as ReturnType<typeof countBy>,
      presenceStatuses: [] as ReturnType<typeof countBy>,
      lobs: [] as ReturnType<typeof countBy>,
      supervisors: [] as ReturnType<typeof countBy>,
      shifts: [] as ReturnType<typeof countBy>,
      skills: [] as ReturnType<typeof countBy>,
      roleTitles: [] as ReturnType<typeof countBy>
    },
    rows: [] as AgentCycleRow[]
  };
}

function emptyQueueRealtimeView() {
  return {
    cycles: [] as Array<{ value: string; batchId: string; importedAt: string; importedAtLabel: string; rows: number }>,
    selectedCycle: "",
    previousCycle: "",
    filters: {
      lobs: [] as ReturnType<typeof countBy>,
      statuses: [] as ReturnType<typeof countBy>,
      slaTargets: [] as ReturnType<typeof countBy>,
      queueIds: [] as ReturnType<typeof countBy>
    },
    rows: [] as QueueCycleRow[]
  };
}

function extractCycleDownload(row: RawRow) {
  return rawText(row, ["ciclo_download", "cycle_download", "ciclo download", "data_execucao"]) || "";
}

function extractWbCandidates(row: RawRow) {
  const rawValues = [
    rawText(row, ["姓名"]),
    rawText(row, ["WB/Login", "邮箱前缀"]),
    rawText(row, ["wb_login", "wb login", "login", "Agente"])
  ].filter(Boolean);
  const seen = new Set<string>();
  return rawValues.flatMap((raw) => {
    const normalized = normalizeWbLogin(raw);
    if (!normalized || seen.has(normalized)) return [];
    seen.add(normalized);
    return [{ raw, normalized }];
  });
}

function rawText(row: RawRow, keys: string[]) {
  for (const key of keys) {
    const expected = normalizeHeader(key);
    for (const [rowKey, value] of Object.entries(row)) {
      if (normalizeHeader(rowKey) === expected) return normalizeCell(value);
    }
  }
  return "";
}

function parseRealtimeNumberFromRow(row: RawRow, keys: string[]) {
  return parseOptionalRealtimeNumberFromRow(row, keys) ?? 0;
}

function parseOptionalRealtimeNumberFromRow(row: RawRow, keys: string[]) {
  const value = rawText(row, keys);
  if (!value) return null;
  return parseOptionalRealtimeNumber(value);
}

function parseOptionalRealtimeNumber(value: string) {
  const normalized = value.replace("%", "").replace(/\./g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function resolveAhtMs(submit: number, weightedAhtMs: number, simpleAhtMs: number, simpleAhtCount: number) {
  if (submit > 0 && weightedAhtMs > 0) return weightedAhtMs / submit;
  if (simpleAhtCount > 0) return simpleAhtMs / simpleAhtCount;
  return null;
}

function normalizeWbLogin(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function formatCycleFromDate(date: Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date).replace(" ", "_");
}

function formatMetricValue(value: number | null, format: "number" | "duration", signed = false) {
  if (value === null || !Number.isFinite(value)) return "N/A";
  const sign = signed ? (value > 0 ? "+" : value < 0 ? "-" : "") : "";
  if (format === "duration") return `${sign}${formatDurationFromMs(Math.abs(value))}`;
  return `${sign}${Math.round(Math.abs(value)).toLocaleString("pt-BR")}`;
}

function filterAgentRows(rows: AgentCycleRow[], query: RealtimeExportQuery) {
  const search = normalizeHeader(String(query.search ?? ""));
  return rows.filter((row) => {
    if (query.crossingStatus && row.crossingStatus !== query.crossingStatus) return false;
    if (query.personType && row.personType !== query.personType) return false;
    if (query.employeeStatus && !matchesRealtimeEmployeeStatus(row.employeeStatus, query.employeeStatus)) return false;
    if (query.presenceStatus && row.presenceStatus !== query.presenceStatus) return false;
    if (query.lob && row.lob !== query.lob) return false;
    if (query.supervisor && row.supervisor !== query.supervisor) return false;
    if (query.shift && row.shift !== query.shift) return false;
    if (query.skill && row.skill !== query.skill) return false;
    if (query.roleTitle && row.roleTitle !== query.roleTitle) return false;
    if (!search) return true;
    return normalizeHeader([
      row.displayName,
      row.wbLogin,
      row.rawWbLogin,
      row.employeeStatus,
      row.presenceStatus,
      row.lob,
      row.supervisor,
      row.shift,
      row.skill,
      row.roleTitle
    ].join(" ")).includes(search);
  });
}

function sortAgentRows(rows: AgentCycleRow[], sortBy = "submit_desc") {
  const sorted = [...rows];
  const textValue = (row: AgentCycleRow, key: string) => {
    if (key === "displayName") return row.displayName;
    if (key === "wbLogin") return row.wbLogin || row.rawWbLogin;
    if (key === "employeeStatus") return row.employeeStatus;
    if (key === "presenceStatus") return row.presenceStatus;
    if (key === "lob") return row.lob;
    if (key === "supervisor") return row.supervisor;
    if (key === "shift") return row.shift;
    if (key === "skill") return row.skill;
    return row.displayName;
  };
  const metric = (row: AgentCycleRow, key: string): number | null => {
    if (key === "submit") return row.current.submit;
    if (key === "aht") return row.current.ahtMs;
    if (key === "moderation") return row.current.moderationMs;
    if (key === "timeout") return row.current.timeout;
    if (key === "refresh") return row.current.refresh;
    return null;
  };
  const sortMap: Record<string, { key: string; direction: "asc" | "desc" }> = {
    displayName_asc: { key: "displayName", direction: "asc" },
    displayName_desc: { key: "displayName", direction: "desc" },
    wbLogin_asc: { key: "wbLogin", direction: "asc" },
    wbLogin_desc: { key: "wbLogin", direction: "desc" },
    employeeStatus_asc: { key: "employeeStatus", direction: "asc" },
    employeeStatus_desc: { key: "employeeStatus", direction: "desc" },
    presenceStatus_asc: { key: "presenceStatus", direction: "asc" },
    presenceStatus_desc: { key: "presenceStatus", direction: "desc" },
    lob_asc: { key: "lob", direction: "asc" },
    lob_desc: { key: "lob", direction: "desc" },
    supervisor_asc: { key: "supervisor", direction: "asc" },
    supervisor_desc: { key: "supervisor", direction: "desc" },
    shift_asc: { key: "shift", direction: "asc" },
    shift_desc: { key: "shift", direction: "desc" },
    skill_asc: { key: "skill", direction: "asc" },
    skill_desc: { key: "skill", direction: "desc" },
    submit_desc: { key: "submit", direction: "desc" },
    submit_asc: { key: "submit", direction: "asc" },
    aht_desc: { key: "aht", direction: "desc" },
    aht_asc: { key: "aht", direction: "asc" },
    moderation_desc: { key: "moderation", direction: "desc" },
    moderation_asc: { key: "moderation", direction: "asc" },
    timeout_desc: { key: "timeout", direction: "desc" },
    timeout_asc: { key: "timeout", direction: "asc" },
    refresh_desc: { key: "refresh", direction: "desc" },
    refresh_asc: { key: "refresh", direction: "asc" }
  };
  const config = sortMap[sortBy] ?? sortMap.submit_desc;
  const numericKeys = new Set(["submit", "aht", "moderation", "timeout", "refresh"]);
  return sorted.sort((a, b) => {
    if (!numericKeys.has(config.key)) {
      const diff = textValue(a, config.key).localeCompare(textValue(b, config.key), "pt-BR", { sensitivity: "base" });
      return (config.direction === "asc" ? diff : -diff) || a.displayName.localeCompare(b.displayName);
    }
    const left = metric(a, config.key);
    const right = metric(b, config.key);
    if (left === null && right === null) return a.displayName.localeCompare(b.displayName);
    if (left === null) return 1;
    if (right === null) return -1;
    const diff = config.direction === "asc" ? left - right : right - left;
    return diff || a.displayName.localeCompare(b.displayName);
  });
}

function filterQueueRows(rows: QueueCycleRow[], query: RealtimeExportQuery) {
  const search = normalizeHeader(String(query.queueSearch ?? ""));
  return rows.filter((row) => {
    if (query.queueLob === "MAPPED" && row.lob === "N/A") return false;
    if (query.queueLob && query.queueLob !== "MAPPED" && row.lob !== query.queueLob) return false;
    if (query.queueStatus && row.status !== query.queueStatus) return false;
    if (query.queueSlaTarget) {
      const target = row.slaTargetMinutes === null ? "Sem meta" : String(row.slaTargetMinutes);
      if (target !== query.queueSlaTarget) return false;
    }
    if (query.queueId && (row.queueId || "Sem Fila ID") !== query.queueId) return false;
    if (!search) return true;
    return normalizeHeader([
      row.queueId,
      row.queueName,
      row.lob,
      row.status,
      row.slaTargetMinutes === null ? "" : String(row.slaTargetMinutes)
    ].join(" ")).includes(search);
  });
}

function sortQueueRows(rows: QueueCycleRow[], sortBy = "backlog_desc") {
  const sorted = [...rows];
  const severity = (status: QueueStatus) => {
    if (status === "Estourado") return 4;
    if (status === "Risco") return 3;
    if (status === "Estável") return 2;
    if (status === "OK") return 1;
    return 0;
  };
  const sortMap: Record<string, { key: string; direction: "asc" | "desc" }> = {
    status_asc: { key: "status", direction: "asc" },
    status_desc: { key: "status", direction: "desc" },
    lob_asc: { key: "lob", direction: "asc" },
    lob_desc: { key: "lob", direction: "desc" },
    queueId_asc: { key: "queueId", direction: "asc" },
    queueId_desc: { key: "queueId", direction: "desc" },
    input_asc: { key: "input", direction: "asc" },
    input_desc: { key: "input", direction: "desc" },
    output_asc: { key: "output", direction: "asc" },
    output_desc: { key: "output", direction: "desc" },
    aht_asc: { key: "aht", direction: "asc" },
    aht_desc: { key: "aht", direction: "desc" },
    latency_asc: { key: "latency", direction: "asc" },
    latency_desc: { key: "latency", direction: "desc" },
    maxLatency_asc: { key: "maxLatency", direction: "asc" },
    maxLatency_desc: { key: "maxLatency", direction: "desc" },
    slaTarget_asc: { key: "slaTarget", direction: "asc" },
    slaTarget_desc: { key: "slaTarget", direction: "desc" },
    latencyAdherence_asc: { key: "latencyAdherence", direction: "asc" },
    latencyAdherence_desc: { key: "latencyAdherence", direction: "desc" },
    backlog_asc: { key: "backlog", direction: "asc" },
    backlog_desc: { key: "backlog", direction: "desc" }
  };
  const config = sortMap[sortBy] ?? sortMap.backlog_desc;
  const numericKeys = new Set(["input", "output", "aht", "latency", "maxLatency", "slaTarget", "backlog"]);
  return sorted.sort((a, b) => {
    if (config.key === "status") {
      const diff = severity(a.status) - severity(b.status);
      return (config.direction === "asc" ? diff : -diff) || a.queueId.localeCompare(b.queueId);
    }
    if (config.key === "latencyAdherence") {
      const diff = latencyAdherenceSeverity(calculateLatencyAdherence(a.current.maxLatencyMs, a.slaTargetMinutes)) - latencyAdherenceSeverity(calculateLatencyAdherence(b.current.maxLatencyMs, b.slaTargetMinutes));
      return (config.direction === "asc" ? diff : -diff) || a.queueId.localeCompare(b.queueId);
    }
    if (!numericKeys.has(config.key)) {
      const left = config.key === "lob" ? a.lob : a.queueId || a.queueName;
      const right = config.key === "lob" ? b.lob : b.queueId || b.queueName;
      const diff = left.localeCompare(right, "pt-BR", { sensitivity: "base" });
      return (config.direction === "asc" ? diff : -diff) || a.queueId.localeCompare(b.queueId);
    }
    const left = config.key === "input"
      ? a.current.input
      : config.key === "output"
        ? a.current.output
        : config.key === "aht"
          ? a.current.ahtMs
          : config.key === "latency"
            ? a.current.latencyMs
            : config.key === "maxLatency"
              ? a.current.maxLatencyMs
              : config.key === "slaTarget"
                ? a.slaTargetMinutes
                : a.current.backlog;
    const right = config.key === "input"
      ? b.current.input
      : config.key === "output"
        ? b.current.output
        : config.key === "aht"
          ? b.current.ahtMs
          : config.key === "latency"
            ? b.current.latencyMs
            : config.key === "maxLatency"
              ? b.current.maxLatencyMs
              : config.key === "slaTarget"
                ? b.slaTargetMinutes
                : b.current.backlog;
    if (left === null && right === null) return a.queueId.localeCompare(b.queueId);
    if (left === null) return 1;
    if (right === null) return -1;
    const diff = config.direction === "asc" ? left - right : right - left;
    return diff || a.queueId.localeCompare(b.queueId);
  });
}

function summarizeQueueRowsForExport(rows: QueueCycleRow[]) {
  const input = rows.reduce((sum, row) => sum + row.current.input, 0);
  const output = rows.reduce((sum, row) => sum + row.current.output, 0);
  const backlog = rows.reduce((sum, row) => sum + row.current.backlog, 0);
  const weightedAht = rows.reduce((sum, row) => sum + (row.current.ahtMs !== null ? row.current.ahtMs * row.current.output : 0), 0);
  const simpleAhtRows = rows.filter((row) => row.current.output === 0 && row.current.ahtMs !== null);
  const simpleAht = simpleAhtRows.reduce((sum, row) => sum + (row.current.ahtMs ?? 0), 0);
  const latencyWeightedByBacklog = rows.reduce((sum, row) => sum + (row.current.latencyMs !== null ? row.current.latencyMs * row.current.backlog : 0), 0);
  const latencyBacklogWeight = rows.reduce((sum, row) => sum + (row.current.latencyMs !== null ? row.current.backlog : 0), 0);
  const latencyWeightedByInput = rows.reduce((sum, row) => sum + (row.current.latencyMs !== null ? row.current.latencyMs * row.current.input : 0), 0);
  const latencyInputWeight = rows.reduce((sum, row) => sum + (row.current.latencyMs !== null ? row.current.input : 0), 0);
  const simpleLatencyRows = rows.filter((row) => row.current.backlog === 0 && row.current.input === 0 && row.current.latencyMs !== null);
  const simpleLatency = simpleLatencyRows.reduce((sum, row) => sum + (row.current.latencyMs ?? 0), 0);
  return {
    input,
    output,
    backlog,
    ahtMs: output > 0 ? weightedAht / output : simpleAhtRows.length ? simpleAht / simpleAhtRows.length : null,
    latencyMs: latencyBacklogWeight > 0
      ? latencyWeightedByBacklog / latencyBacklogWeight
      : latencyInputWeight > 0
        ? latencyWeightedByInput / latencyInputWeight
        : simpleLatencyRows.length
          ? simpleLatency / simpleLatencyRows.length
          : null,
    maxLatencyMs: rows.reduce<number | null>((currentMax, row) => {
      if (row.current.maxLatencyMs === null) return currentMax;
      return currentMax === null ? row.current.maxLatencyMs : Math.max(currentMax, row.current.maxLatencyMs);
    }, null)
  };
}

function calculateLatencyAdherence(maxLatencyMs: number | null, slaTargetMinutes: number | null) {
  if (maxLatencyMs === null || !slaTargetMinutes || slaTargetMinutes <= 0) return "N/A";
  const targetMs = slaTargetMinutes * 60 * 1000;
  const adherenceRatio = maxLatencyMs / targetMs;
  if (adherenceRatio < 0.7) return "OK";
  if (adherenceRatio < 1) return "Alerta";
  return "Estourado";
}

function latencyAdherenceSeverity(status: string) {
  if (status === "Estourado") return 3;
  if (status === "Alerta") return 2;
  if (status === "OK") return 1;
  return 0;
}

function formatSlaTargetMinutes(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Sem meta";
  if (value < 60) return `${value} min`;
  if (value % 60 === 0) return `${value / 60}h`;
  return `${Math.floor(value / 60)}h ${value % 60}min`;
}

export function formatDurationFromMs(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  const totalSeconds = Math.max(0, Math.round(value / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}h`;
  if (minutes > 0) return `${minutes}:${String(seconds).padStart(2, "0")}m`;
  return `0:${String(seconds).padStart(2, "0")}s`;
}

export function formatDurationDelta(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Sem comparação";
  if (value === 0) return "0:00s";
  return `${value > 0 ? "+" : "-"}${formatDurationFromMs(Math.abs(value))}`;
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

function buildKpis(queueRows: Array<{ status: string; lob: string }>, agentRows: AgentCycleRow[]) {
  const criticalQueues = queueRows.filter((row) => normalizeHeader(row.status).includes("critico")).length;
  const attentionQueues = queueRows.filter((row) => normalizeHeader(row.status).includes("atencao")).length;
  const foundAgents = agentRows.filter((row) => row.crossingStatus === "Encontrado").length;
  const unmatchedAgents = agentRows.filter((row) => row.crossingStatus === "Não encontrado").length;
  return [
    { label: "Filas críticas", value: String(criticalQueues), helper: "backlog com timeout", tone: criticalQueues ? "orange" : "green" },
    { label: "Filas em atenção", value: String(attentionQueues), helper: "backlog sem timeout", tone: attentionQueues ? "orange" : "blue" },
    { label: "Agentes encontrados", value: String(foundAgents), helper: "cruzados com cadastro", tone: "green" },
    { label: "Não encontrados", value: String(unmatchedAgents), helper: "WB/Login sem cadastro", tone: unmatchedAgents ? "orange" : "blue" }
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
