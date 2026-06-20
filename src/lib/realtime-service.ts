import crypto from "node:crypto";

import { Prisma } from "@prisma/client";

import { isAgentJobTitle } from "@/lib/job-title-normalization";
import type { Actor } from "@/lib/mock-db";
import { canAccessRealTime } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { resolveQueueReference } from "@/lib/queue-dictionary";
import { isWorkHoursAllowedForSchedule } from "@/lib/work-hours-rules";
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

type AgentPresenceStatus = "Online" | "Online sem produção" | "Ocioso" | "Offline" | "Fora do turno";

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
const realtimeRetentionDays = 7;
const realtimeViewHistoryBatchLimit = 180;
const realtimeRawFallbackBatchLimit = 12;

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

function realtimeRetentionCutoff() {
  return new Date(Date.now() - realtimeRetentionDays * 24 * 60 * 60 * 1000);
}

async function pruneRealtimeHistory(currentBatchId?: string) {
  try {
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
      prisma.realTimeRecord.deleteMany({ where: { batchId: { in: staleIds } } }),
      prisma.realTimeImportBatch.deleteMany({ where: { id: { in: staleIds } } })
    ]);
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

  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.realTimeImportBatch.create({
      data: {
        fileName,
        source,
        status: "SUCCESS",
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

  const importSummary = summarizeImportedSummaries(agentSummaries, queueSummaries);
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
        queueView: emptyQueueRealtimeView(),
        agents: emptyAgentRealtimeView(),
        kpis: []
      }
    };
  }

  const requestedView = options.view ?? "both";
  const [queueRealtime, agentRealtime] = await Promise.all([
    requestedView === "agents" ? Promise.resolve(emptyQueueRealtimeView()) : buildQueueRealtimeView(options),
    requestedView === "queues" ? Promise.resolve(emptyAgentRealtimeView()) : buildAgentRealtimeView(actor, options)
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
  if (!canAccessRealTime({ role: actor.role, email: actor.email, name: actor.name, status: "ACTIVE" })) {
    return { error: "Você não tem permissão para acessar Real Time.", status: 403 };
  }

  const requestedView = options.view ?? "both";
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
      importedAt: true
    }
  });

  if (!batch) return null;

  const cycleDownloadFromSummary = recordType === "QUEUE"
    ? (await prisma.realTimeQueueCycleSummary.findFirst({
      where: { batchId: batch.id },
      orderBy: { cycleDownload: "desc" },
      select: { cycleDownload: true }
    }))?.cycleDownload
    : (await prisma.realTimeAgentCycleSummary.findFirst({
      where: { batchId: batch.id },
      orderBy: { cycleDownload: "desc" },
      select: { cycleDownload: true }
    }))?.cycleDownload;

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
  if (!canAccessRealTime({ role: actor.role, email: actor.email, name: actor.name, status: "ACTIVE" })) {
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
  const snapshot = await getRealtimeSnapshot(actor, { cycleDownload: query.cycleDownload, view: "both" });
  if ("error" in snapshot && snapshot.error) return { error: snapshot.error, status: snapshot.status ?? 400 };
  const snapshotData = "data" in snapshot ? snapshot.data : null;
  if (!snapshotData) return { error: "Não foi possível exportar Real Time.", status: 500 };

  const agentView = snapshotData.agents;
  const queueView = snapshotData.queueView;
  const rows = sortAgentRows(filterAgentRows(agentView.rows, query), query.sortBy ?? "submit_desc");
  const queueRows = sortQueueRows(filterQueueRows(queueView.rows, query), query.sortBy ?? "backlog_desc");
  const filteredSummary = summarizeAgentRows(rows);
  const filteredQueueSummary = summarizeQueueRowsForExport(queueRows);
  const unfilteredUnmatched = agentView.rows.filter((row) => row.crossingStatus === "Não encontrado");
  const importRows = (await listRealtimeImports(actor));
  const imports = "error" in importRows ? [] : importRows.data;

  return {
    fileName: `real_time_${query.view === "queues" ? "filas" : "agentes"}_${agentView.selectedCycle || queueView.selectedCycle || "sem_ciclo"}.xlsx`,
    sheetName: "Resumo",
    headers: ["ciclo_download", "ciclo_anterior", "submit_total", "aht_medio", "moderacao_total", "timeout", "refresh"],
    rows: [[
      agentView.selectedCycle,
      agentView.previousCycle || "Sem comparação",
      filteredSummary.submit,
      formatDurationFromMs(filteredSummary.ahtMs),
      formatDurationFromMs(filteredSummary.moderationMs),
      filteredSummary.timeout,
      filteredSummary.refresh
    ]],
    sheets: [
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
      },
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
    ]
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

function buildQueueRealtimeViewFromSummaryRows(summaryRows: QueueSummaryReadRow[], options: RealtimeSnapshotOptions) {
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

  const cycles = Array.from(cycleMap.values())
    .sort((a, b) => b.importedAt.getTime() - a.importedAt.getTime() || b.value.localeCompare(a.value))
    .map((cycle) => ({ ...cycle, importedAt: cycle.importedAt.toISOString(), importedAtLabel: formatDateTime(cycle.importedAt) }));

  if (!cycles.length) return emptyQueueRealtimeView();

  const selectedCycle = cycles.some((cycle) => cycle.value === options.cycleDownload) ? String(options.cycleDownload) : cycles[0].value;
  const selectedIndex = cycles.findIndex((cycle) => cycle.value === selectedCycle);
  const previousCycle = selectedIndex >= 0 ? cycles[selectedIndex + 1]?.value ?? "" : "";

  const groupedByCycle = new Map<string, QueueCycleRow[]>();
  for (const cycle of cycles) {
    groupedByCycle.set(cycle.value, latestRows
      .filter((summary) => summary.cycleDownload === cycle.value)
      .map(queueSummaryToCycleRow)
    );
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
  return {
    key: summary.queueKey,
    queueId: summary.queueId,
    queueName: summary.queueName,
    lob: coerceQueueLob(summary.lob),
    slaTargetMinutes: summary.slaTargetMinutes,
    status: coerceQueueStatus(summary.status),
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
    select: { id: true, fileName: true, importedAt: true, queueRows: true }
  });

  if (!batches.length) return emptyQueueRealtimeView();

  const batchIds = batches.map((batch) => batch.id);
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
  const missingSummaryBatchIds = summaryRows.length
    ? []
    : batchIds.filter((batchId) => !summarizedBatchIds.has(batchId)).slice(0, realtimeRawFallbackBatchLimit);
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
      return buildQueueRealtimeViewFromSummaryRows([...summaryRows, ...fallbackSummaryRows], options);
    }
  }
  if (summaryRows.length) return buildQueueRealtimeViewFromSummaryRows(summaryRows, options);

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
  const selectedIndex = cycles.findIndex((cycle) => cycle.value === selectedCycle);
  const previousCycle = selectedIndex >= 0 ? cycles[selectedIndex + 1]?.value ?? "" : "";

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

async function buildAgentRealtimeViewFromSummaryRows(summaryRows: AgentSummaryReadRow[], options: RealtimeSnapshotOptions) {
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

  const cycles = Array.from(cycleMap.values())
    .sort((a, b) => b.importedAt.getTime() - a.importedAt.getTime() || b.value.localeCompare(a.value))
    .map((cycle) => ({ ...cycle, importedAt: cycle.importedAt.toISOString(), importedAtLabel: formatDateTime(cycle.importedAt) }));

  if (!cycles.length) return emptyAgentRealtimeView();

  const selectedCycle = cycles.some((cycle) => cycle.value === options.cycleDownload) ? String(options.cycleDownload) : cycles[0].value;
  const selectedIndex = cycles.findIndex((cycle) => cycle.value === selectedCycle);
  const previousCycle = selectedIndex >= 0 ? cycles[selectedIndex + 1]?.value ?? "" : "";

  const groupedByCycle = new Map<string, AgentCycleRow[]>();
  for (const cycle of cycles) {
    groupedByCycle.set(cycle.value, latestRows
      .filter((summary) => summary.cycleDownload === cycle.value)
      .map(agentSummaryToCycleRow)
    );
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
  const presenceContext = await loadAgentPresenceContext(baseRows, selectedCycle, latestBatchByCycle.get(selectedCycle)?.batchId ?? "");
  const rows = baseRows.map((row) => ({
    ...row,
    presenceStatus: resolveAgentPresenceStatus(row, presenceContext)
  }));

  const summaryCurrent = summarizeAgentRows(rows);
  const summaryPrevious = previousCycle ? summarizeAgentRows(previousRows) : null;

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

async function buildAgentRealtimeView(actor: Actor, options: RealtimeSnapshotOptions) {
  const batches = await prisma.realTimeImportBatch.findMany({
    where: { status: "SUCCESS", agentRows: { gt: 0 }, importedAt: { gte: realtimeRetentionCutoff() } },
    orderBy: { importedAt: "desc" },
    take: realtimeViewHistoryBatchLimit,
    select: { id: true, fileName: true, importedAt: true, agentRows: true }
  });

  if (!batches.length) return emptyAgentRealtimeView();

  const batchIds = batches.map((batch) => batch.id);
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
  const missingSummaryBatchIds = summaryRows.length
    ? []
    : batchIds.filter((batchId) => !summarizedBatchIds.has(batchId)).slice(0, realtimeRawFallbackBatchLimit);
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
      return await buildAgentRealtimeViewFromSummaryRows([...summaryRows, ...fallbackSummaryRows], options);
    }
  }
  if (summaryRows.length) return await buildAgentRealtimeViewFromSummaryRows(summaryRows, options);

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
  const selectedIndex = cycles.findIndex((cycle) => cycle.value === selectedCycle);
  const previousCycle = selectedIndex >= 0 ? cycles[selectedIndex + 1]?.value ?? "" : "";

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

  const rows = currentRows
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

  const summaryCurrent = summarizeAgentRows(rows);
  const summaryPrevious = previousCycle ? summarizeAgentRows(previousRows) : null;

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

async function loadAgentPresenceContext(rows: AgentCycleRow[], selectedCycle: string, selectedBatchId: string) {
  const selectedCycleInfo = parseRealtimeCycleForPresence(selectedCycle);
  const [scheduleByEmployeeId, kapStatusByAgentKey] = await Promise.all([
    loadRealtimeSchedulePresence(rows, selectedCycleInfo?.date ?? null),
    loadRealtimeKapStatusByAgentKey(selectedBatchId)
  ]);

  return {
    selectedCycle,
    selectedCycleInfo,
    scheduleByEmployeeId,
    kapStatusByAgentKey
  };
}

async function loadRealtimeSchedulePresence(rows: AgentCycleRow[], date: Date | null) {
  const employeeIds = Array.from(new Set(rows.map((row) => row.employeeId).filter(Boolean)));
  const scheduleByEmployeeId = new Map<string, { scheduled: boolean; startsAt: string | null; endsAt: string | null }>();
  if (!date || !employeeIds.length) return scheduleByEmployeeId;

  const schedules = await prisma.schedule.findMany({
    where: {
      employeeId: { in: employeeIds },
      date,
      deletedAt: null
    },
    select: {
      employeeId: true,
      status: true,
      startsAt: true,
      endsAt: true,
      shift: { select: { name: true } }
    }
  });

  schedules.forEach((schedule) => {
    scheduleByEmployeeId.set(schedule.employeeId, {
      scheduled: isWorkHoursAllowedForSchedule(schedule),
      startsAt: schedule.startsAt,
      endsAt: schedule.endsAt
    });
  });

  return scheduleByEmployeeId;
}

async function loadRealtimeKapStatusByAgentKey(batchId: string) {
  const statusByKey = new Map<string, string>();
  if (!batchId) return statusByKey;

  const records = await prisma.realTimeRecord.findMany({
    where: { batchId, recordType: "AGENT" },
    select: { wbLogin: true, status: true }
  });

  records.forEach((record) => {
    const normalized = normalizeWbLogin(record.wbLogin ?? "");
    if (normalized && !statusByKey.has(normalized)) statusByKey.set(normalized, record.status ?? "");
  });

  return statusByKey;
}

function resolveAgentPresenceStatus(
  row: AgentCycleRow,
  context: Awaited<ReturnType<typeof loadAgentPresenceContext>>
): AgentPresenceStatus {
  const schedule = row.employeeId ? context.scheduleByEmployeeId.get(row.employeeId) : null;
  const isScheduled = Boolean(schedule?.scheduled);
  const hasProduction = row.current.submit > 0 || row.current.moderationMs > 0;
  const hasRecentProduction = (row.deltas.submit ?? 0) > 0 || (row.deltas.moderationMs ?? 0) > 0 || (!row.previous && hasProduction);

  if (!isScheduled) return hasProduction ? "Fora do turno" : "Offline";
  if (hasRecentProduction) return "Online";

  const minutesSinceMovement = minutesSinceLastAgentMovement(row, context.selectedCycle);
  if (hasProduction && minutesSinceMovement !== null && minutesSinceMovement >= 60) return "Ocioso";
  if (hasProduction && minutesSinceMovement !== null && minutesSinceMovement < 60) return "Online sem produção";

  const kapStatus = context.kapStatusByAgentKey.get(row.key) ?? "";
  if (isKapStatusActiveSignal(kapStatus) || isWithinScheduleStartTolerance(schedule ?? null, context.selectedCycleInfo)) return "Online sem produção";
  return "Offline";
}

function minutesSinceLastAgentMovement(row: AgentCycleRow, selectedCycle: string) {
  const selectedInfo = parseRealtimeCycleForPresence(selectedCycle);
  if (!selectedInfo) return null;
  const selectedOperationalDay = operationalDayKeyFromCycleInfo(selectedInfo);
  const history = row.history
    .map((item) => ({ item, info: parseRealtimeCycleForPresence(item.cycleDownload) }))
    .filter((entry): entry is { item: AgentCycleRow["history"][number]; info: NonNullable<ReturnType<typeof parseRealtimeCycleForPresence>> } => Boolean(entry.info))
    .filter((entry) => entry.info.timestamp <= selectedInfo.timestamp && operationalDayKeyFromCycleInfo(entry.info) === selectedOperationalDay)
    .sort((a, b) => a.info.timestamp - b.info.timestamp);

  let previous: AgentCycleRow["history"][number] | null = null;
  let lastMovementTimestamp: number | null = null;
  history.forEach(({ item, info }) => {
    const moved = previous
      ? item.submit > previous.submit || item.moderationMs > previous.moderationMs
      : item.submit > 0 || item.moderationMs > 0;
    if (moved) lastMovementTimestamp = info.timestamp;
    previous = item;
  });

  if (lastMovementTimestamp === null) return null;
  return Math.max(0, Math.floor((selectedInfo.timestamp - lastMovementTimestamp) / 60000));
}

function isKapStatusActiveSignal(status: string) {
  const normalized = normalizeHeader(status);
  if (!normalized) return false;
  if (["offline", "deslogado", "signout", "signedout"].includes(normalized)) return false;
  return ["revisando", "disponivel", "pausa", "refeicao", "treinamento", "reuniao", "auditing", "available"].includes(normalized);
}

function isWithinScheduleStartTolerance(
  schedule: { startsAt: string | null; endsAt: string | null } | null,
  selectedCycleInfo: ReturnType<typeof parseRealtimeCycleForPresence>
) {
  if (!schedule?.startsAt || !selectedCycleInfo) return false;
  const [hour, minute] = schedule.startsAt.split(":").map((part) => Number(part));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  const startTimestamp = Date.parse(`${selectedCycleInfo.dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-03:00`);
  if (!Number.isFinite(startTimestamp)) return false;
  return selectedCycleInfo.timestamp >= startTimestamp && selectedCycleInfo.timestamp - startTimestamp <= 20 * 60000;
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
    timestamp
  };
}

function operationalDayKeyFromCycleInfo(info: NonNullable<ReturnType<typeof parseRealtimeCycleForPresence>>) {
  if (info.hour >= 13) return info.dateKey;
  const previousDay = new Date(info.date.getTime() - 24 * 60 * 60 * 1000);
  return previousDay.toISOString().slice(0, 10);
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
    if (query.employeeStatus && !matchesEmployeeStatus(row.employeeStatus, query.employeeStatus)) return false;
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

function matchesEmployeeStatus(value: string, filter: string) {
  const normalizedValue = normalizeHeader(value);
  const normalizedFilter = normalizeHeader(filter);
  if (normalizedFilter === "ativo") return normalizedValue === "ativo" || normalizedValue === "active";
  return normalizedValue === normalizedFilter;
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
