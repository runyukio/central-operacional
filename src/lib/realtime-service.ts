import crypto from "node:crypto";

import { Prisma } from "@prisma/client";

import { isAgentJobTitle } from "@/lib/job-title-normalization";
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

export type RealtimeSnapshotOptions = {
  cycleDownload?: string;
};

type EmployeeMatch = {
  id: string;
  wbLogin: string;
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
  queueName: string;
  queues: string[];
  sourceRows: number;
};

type AgentCycleRow = {
  key: string;
  employeeId: string;
  displayName: string;
  wbLogin: string;
  rawWbLogin: string;
  crossingStatus: "Encontrado" | "Não encontrado";
  personType: "Agente" | "Staff" | "Não encontrado";
  employeeStatus: string;
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
    submit: number;
    ahtMs: number | null;
    moderationMs: number;
    timeout: number;
    refresh: number;
    queues: string[];
  }>;
  queueBreakdown: Array<{
    queueName: string;
    submit: number;
    ahtMs: number | null;
    moderationMs: number;
    timeout: number;
    refresh: number;
  }>;
};

const realtimeRecordLimit = 1000;
const staleThresholdMinutes = 20;
const realtimeAgentHistoryBatchLimit = 160;

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
        agents: emptyAgentRealtimeView(),
        kpis: []
      }
    };
  }

  const [queueRecords, agentRealtime] = await Promise.all([
    prisma.realTimeRecord.findMany({ where: { batchId: batch.id, recordType: "QUEUE" }, orderBy: { rowNumber: "asc" }, take: realtimeRecordLimit }),
    buildAgentRealtimeView(actor, options)
  ]);

  const queues = buildDataset(queueRecords, batch.queueRows);
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
      agents: agentRealtime,
      kpis: buildKpis(queues.rows, agentRealtime.rows)
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

async function buildAgentRealtimeView(actor: Actor, options: RealtimeSnapshotOptions) {
  const batches = await prisma.realTimeImportBatch.findMany({
    where: { status: "SUCCESS", agentRows: { gt: 0 } },
    orderBy: { importedAt: "desc" },
    take: realtimeAgentHistoryBatchLimit,
    select: { id: true, fileName: true, importedAt: true, agentRows: true }
  });

  if (!batches.length) return emptyAgentRealtimeView();

  const batchIds = batches.map((batch) => batch.id);
  const records = await prisma.realTimeRecord.findMany({
    where: { recordType: "AGENT", batchId: { in: batchIds } },
    orderBy: { rowNumber: "asc" },
    include: { batch: { select: { id: true, importedAt: true, fileName: true } } }
  });

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

  const employeesByWb = new Map<string, EmployeeMatch>();
  const employeeMatches = employeeProfiles.map((employee) => ({
    id: employee.id,
    wbLogin: employee.wbLogin,
    fullName: employee.fullName,
    operationalStatus: employee.operationalStatus,
    roleTitle: employee.roleTitle,
    skill: employee.skill ?? "",
    lob: employee.lob?.name ?? "",
    supervisor: employee.supervisor?.fullName ?? "",
    supervisorId: employee.supervisorId ?? "",
    shift: employee.shift?.name ?? ""
  }));
  employeeMatches.forEach((employee) => employeesByWb.set(normalizeWbLogin(employee.wbLogin), employee));

  const actorEmail = actor.email.trim().toLowerCase();
  const actorEmployee = employeeProfiles.find((employee) => employee.user?.email?.trim().toLowerCase() === actorEmail)
    ?? employeeProfiles.find((employee) => normalizeWbLogin(employee.wbLogin) === normalizeWbLogin(actor.email.split("@")[0] ?? ""));

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
  const role = actor.role;
  const visibleRecords = role === "SUPERVISOR"
    ? latestRecords.filter((item) => Boolean(actorEmployee && item.employee && (item.employee.supervisorId === actorEmployee.id || item.employee.id === actorEmployee.id)))
    : latestRecords;

  const cycleMap = new Map<string, { value: string; importedAt: Date; rows: number }>();
  visibleRecords.forEach((item) => {
    const existing = cycleMap.get(item.cycleDownload);
    if (!existing) {
      cycleMap.set(item.cycleDownload, { value: item.cycleDownload, importedAt: item.record.batch.importedAt, rows: 1 });
    } else {
      existing.rows += 1;
      if (item.record.batch.importedAt > existing.importedAt) existing.importedAt = item.record.batch.importedAt;
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
    groupedByCycle.set(cycle.value, aggregateAgentCycleRows(visibleRecords.filter((item) => item.cycleDownload === cycle.value)));
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
        submit: row.current.submit,
        ahtMs: row.current.ahtMs,
        moderationMs: row.current.moderationMs,
        timeout: row.current.timeout,
        refresh: row.current.refresh,
        queues: row.current.queues
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
      lobs: countBy(rows.map((row) => row.lob).filter(Boolean)),
      supervisors: countBy(rows.map((row) => row.supervisor).filter(Boolean)),
      shifts: countBy(rows.map((row) => row.shift).filter(Boolean)),
      skills: countBy(rows.map((row) => row.skill).filter(Boolean)),
      roleTitles: countBy(rows.map((row) => row.roleTitle).filter(Boolean)),
      queues: countBy(rows.map((row) => row.current.queueName).filter(Boolean))
    },
    rows
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
    const queueName = rawText(item.rawData, ["当前队列", "Fila atual", "queue", "queue_name"]) || "Sem fila";
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

    const queue = group.queues.get(queueName) ?? {
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
    group.queues.set(queueName, queue);
    groups.set(key, group);
  }

  return Array.from(groups.values()).map((group): AgentCycleRow => {
    const queueBreakdown = Array.from(group.queues.entries()).map(([queueName, queue]) => ({
      queueName,
      submit: queue.submit,
      ahtMs: resolveAhtMs(queue.submit, queue.weightedAhtMs, queue.simpleAhtMs, queue.simpleAhtCount),
      moderationMs: queue.moderationMs,
      timeout: queue.timeout,
      refresh: queue.refresh
    })).sort((a, b) => b.submit - a.submit || a.queueName.localeCompare(b.queueName));
    const queues = queueBreakdown.map((queue) => queue.queueName).filter(Boolean);
    const current: AgentCycleMetric = {
      submit: group.submit,
      ahtMs: resolveAhtMs(group.submit, group.weightedAhtMs, group.simpleAhtMs, group.simpleAhtCount),
      moderationMs: group.moderationMs,
      timeout: group.timeout,
      refresh: group.refresh,
      queueName: queues.length > 1 ? "Múltiplas filas" : queues[0] ?? "Sem fila",
      queues,
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
    buildSummaryCard("Registros importados", current.recordsImported, previous?.recordsImported ?? null, "number", "neutral"),
    buildSummaryCard("Agentes encontrados", current.matched, previous?.matched ?? null, "number", "up"),
    buildSummaryCard("Não encontrados", current.unmatched, previous?.unmatched ?? null, "number", "down"),
    buildSummaryCard("Submit total", current.submit, previous?.submit ?? null, "number", "up"),
    buildSummaryCard("AHT médio", current.ahtMs, previous?.ahtMs ?? null, "minutes", "down"),
    buildSummaryCard("Moderação total", current.moderationMs, previous?.moderationMs ?? null, "hours", "neutral"),
    buildSummaryCard("Timeout", current.timeout, previous?.timeout ?? null, "number", "down"),
    buildSummaryCard("Refresh", current.refresh, previous?.refresh ?? null, "number", "down")
  ];
}

function buildSummaryCard(label: string, current: number | null, previous: number | null, format: "number" | "minutes" | "hours", positiveDirection: "up" | "down" | "neutral") {
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
    cycles: [] as Array<{ value: string; importedAt: string; importedAtLabel: string; rows: number }>,
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
      lobs: [] as ReturnType<typeof countBy>,
      supervisors: [] as ReturnType<typeof countBy>,
      shifts: [] as ReturnType<typeof countBy>,
      skills: [] as ReturnType<typeof countBy>,
      roleTitles: [] as ReturnType<typeof countBy>,
      queues: [] as ReturnType<typeof countBy>
    },
    rows: [] as AgentCycleRow[]
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

function formatMetricValue(value: number | null, format: "number" | "minutes" | "hours", signed = false) {
  if (value === null || !Number.isFinite(value)) return "N/A";
  const sign = signed && value > 0 ? "+" : "";
  if (format === "minutes") return `${sign}${msToMinutes(value)} min`;
  if (format === "hours") return `${sign}${msToHours(value)} h`;
  return `${sign}${Math.round(value).toLocaleString("pt-BR")}`;
}

function msToMinutes(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "";
  return Number((value / 60000).toFixed(2));
}

function msToHours(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "";
  return Number((value / 3600000).toFixed(2));
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
