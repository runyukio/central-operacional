import { AuditAction, Prisma, type ScheduleStatus } from "@prisma/client";

import type { Actor } from "@/lib/mock-db";
import {
  canAccessPerformance,
  canAccessPerformanceWfh,
  canExportPerformance,
  canImportPerformance,
  normalizeRole
} from "@/lib/permissions";
import { isAgentJobTitle } from "@/lib/job-title-normalization";
import { prisma } from "@/lib/prisma";
import type { XlsxExportPayload } from "@/lib/xlsx-export";

type AuthenticatedUser = Prisma.UserGetPayload<{
  include: {
    role: true;
    employeeProfile: {
      include: {
        lob: true;
        supervisor: true;
      };
    };
  };
}>;

type PerformanceEmployee = Prisma.EmployeeProfileGetPayload<{
  include: {
    user: true;
    lob: true;
    supervisor: true;
  };
}>;

type QualityRecordForMetrics = Prisma.QualityRecordGetPayload<{ select: typeof qualityMetricSelect }>;
type ProductionRecordForMetrics = Prisma.ProductionRecordGetPayload<{ select: typeof productionMetricSelect }>;
type ScheduleRecordForMetrics = Prisma.ScheduleGetPayload<{ select: typeof scheduleMetricSelect }>;

export type PerformanceQuery = {
  view?: "mine" | "wfh";
  startDate?: string;
  endDate?: string;
  month?: string;
  employeeId?: string;
  lob?: string;
  supervisorId?: string;
  role?: string;
  skill?: string;
};

export type PerformancePreviewRow = {
  rowNumber: number;
  type: "QUALITY" | "PRODUCTION";
  wbLogin: string;
  employeeId?: string;
  employeeName?: string;
  lob?: string;
  lobId?: string;
  date: string;
  uniqueKey: string;
  action: "create" | "update" | "ignore";
  errors: string[];
  warnings: string[];
  payload: Record<string, unknown>;
};

type PerformancePreviewOptions = {
  rowNumberOffset?: number;
};

type PerformanceMetrics = {
  quality: number;
  qualityCorrect: number;
  qualityTotal: number;
  submit: number;
  ahtSeconds: number;
  moderationSeconds: number;
  abs: number;
  absences: number;
  scheduledDays: number;
};

type WeeklyMetricRow = PerformanceMetrics & {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
};

type AgentPerformanceRow = PerformanceMetrics & {
  employeeId: string;
  employeeName: string;
  wbLogin: string;
  lob: string;
  supervisor: string;
  roleTitle: string;
  skill: string;
  weekly: WeeklyMetricRow[];
};

const agentRoleTitleAliases = ["Agente", "Agent", "Moderador de Conteúdo", "Content Moderator"];
const scheduledStatuses = new Set<ScheduleStatus>(["ESCALADO", "PRESENTE", "FALTA", "ATRASO", "SAIDA_ANTECIPADA", "TROCA_APROVADA", "VENDA_FOLGA_APROVADA", "FOLGA_APROVADA"]);
const qualityMetricSelect = {
  auditDate: true,
  concatKey: true,
  finalResult: true,
  employeeId: true
} satisfies Prisma.QualityRecordSelect;
const productionMetricSelect = {
  bzDay: true,
  submitNum: true,
  moderationSeconds: true,
  employeeId: true
} satisfies Prisma.ProductionRecordSelect;
const scheduleMetricSelect = {
  date: true,
  status: true,
  employeeId: true
} satisfies Prisma.ScheduleSelect;

export class PerformanceError extends Error {
  status: number;
  fields?: Record<string, string>;

  constructor(message: string, status = 400, fields?: Record<string, string>) {
    super(message);
    this.name = "PerformanceError";
    this.status = status;
    this.fields = fields;
  }
}

export async function getPerformanceDashboard(actor: Actor, query: PerformanceQuery = {}) {
  const user = await requireActiveUser(actor);
  if (!canAccessPerformance(permissionUser(user))) throw new PerformanceError("Você não tem permissão para acessar Performance.", 403);
  const role = normalizeRole(user.role.name);
  const view = query.view ?? (role === "COLABORADOR" ? "mine" : "wfh");
  const period = resolvePeriod(query);

  if (view === "mine" || role === "COLABORADOR") {
    const ownEmployee = requireOwnEmployee(user);
    const operationEmployees = await listPerformanceEmployees({}, { defaultAgentsOnly: true });
    const ownLobEmployees = operationEmployees.filter((employee) => employee.lobId === ownEmployee.lobId);
    const ownRows = await buildAgentRows([ownEmployee as PerformanceEmployee], period);
    const lobRows = await buildAgentRows(ownLobEmployees, period);
    const operationRows = await buildAgentRows(operationEmployees, period);
    const mine = ownRows[0] ?? emptyAgentRow(ownEmployee as PerformanceEmployee, period);

    return {
      mode: "mine" as const,
      canAccessWfh: canAccessPerformanceWfh(permissionUser(user)),
      period: periodPayload(period),
      summary: {
        mine,
        lobAverage: summarizeRows(lobRows),
        operationAverage: summarizeRows(operationRows)
      },
      weekly: mine.weekly.map((week) => ({
        ...week,
        lobAverage: summarizeRows(lobRows.map((row) => ({ ...row, weekly: row.weekly.filter((item) => item.weekStart === week.weekStart) }))),
        operationAverage: summarizeRows(operationRows.map((row) => ({ ...row, weekly: row.weekly.filter((item) => item.weekStart === week.weekStart) })))
      }))
    };
  }

  if (!canAccessPerformanceWfh(permissionUser(user))) throw new PerformanceError("Você não tem permissão para acessar WFH.", 403);
  const employees = await listPerformanceEmployees(query, { defaultAgentsOnly: true });
  const rows = await buildAgentRows(employees, period);
  const imports = await prisma.performanceImportBatch.findMany({
    orderBy: { importedAt: "desc" },
    take: 12,
    include: { importedBy: { select: { name: true, email: true } } }
  });
  const filters = await getPerformanceFilterOptions();

  return {
    mode: "wfh" as const,
    canImport: canImportPerformance(permissionUser(user)),
    canExport: canExportPerformance(permissionUser(user)),
    period: periodPayload(period),
    summary: {
      ...summarizeRows(rows),
      agentsWithData: rows.filter(hasAnyData).length,
      importedRows: imports.reduce((sum, item) => sum + item.rowsValid, 0),
      lastImport: imports[0] ? formatDateTime(imports[0].importedAt) : ""
    },
    ranking: rows.sort((a, b) => b.quality - a.quality || b.submit - a.submit).slice(0, 200),
    weekly: buildWeeklyEvolution(rows, period),
    filters,
    imports: imports.map((item) => ({
      id: item.id,
      type: item.type,
      fileName: item.fileName,
      rowsTotal: item.rowsTotal,
      rowsValid: item.rowsValid,
      rowsError: item.rowsError,
      rowsInserted: item.rowsInserted,
      rowsUpdated: item.rowsUpdated,
      status: item.status,
      importedBy: item.importedBy?.name ?? item.importedBy?.email ?? "Sistema",
      importedAt: formatDateTime(item.importedAt)
    }))
  };
}

export async function previewQualityImport(actor: Actor, rawRows: Record<string, unknown>[], options: PerformancePreviewOptions = {}) {
  const user = await requireActiveUser(actor);
  requireImportPermission(user);
  return previewQualityRows(rawRows, options);
}

export async function previewProductionImport(actor: Actor, rawRows: Record<string, unknown>[], options: PerformancePreviewOptions = {}) {
  const user = await requireActiveUser(actor);
  requireImportPermission(user);
  return previewProductionRows(rawRows, options);
}

export async function commitQualityRawImport(actor: Actor, rawRows: Record<string, unknown>[], fileName = "qualidade.xlsx", batchId?: string, rowNumberOffset = 0) {
  const user = await requireActiveUser(actor);
  requireImportPermission(user);
  const preview = await previewQualityRows(rawRows, { rowNumberOffset });
  return commitQualityRows(user, preview.rows, fileName, batchId);
}

export async function commitProductionRawImport(actor: Actor, rawRows: Record<string, unknown>[], fileName = "producao.xlsx", batchId?: string, rowNumberOffset = 0) {
  const user = await requireActiveUser(actor);
  requireImportPermission(user);
  const preview = await previewProductionRows(rawRows, { rowNumberOffset });
  return commitProductionRows(user, preview.rows, fileName, batchId);
}

async function previewQualityRows(rawRows: Record<string, unknown>[], options: PerformancePreviewOptions = {}) {
  const normalizedRows = rawRows.map(normalizeObjectKeys);
  const wbLogins = unique(normalizedRows.map((row) => normalizeWbLogin(text(rowValue(row, ["audit_name", "audit name", "wb_login", "wb login"])))).filter(Boolean));
  const employees = await findEmployeesByWbLogins(wbLogins);
  const employeeByLogin = new Map(employees.map((employee) => [normalizeWbLogin(employee.wbLogin), employee]));
  const seen = new Map<string, number>();

  const previewRows: PerformancePreviewRow[] = normalizedRows.map((row, index) => {
    const rowNumber = (options.rowNumberOffset ?? 0) + index + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    const wbLogin = normalizeWbLogin(text(rowValue(row, ["audit_name", "audit name", "wb_login", "wb login"])));
    const employee = employeeByLogin.get(wbLogin);
    const auditTime = normalizeExcelDate(rowValue(row, ["audit_time", "audit time", "data"]));
    const finalResult = text(rowValue(row, ["final_result", "final result", "resultado"]));
    const caseOrderId = text(rowValue(row, ["质检case_order_id", "case_order_id", "case order id"]));
    const auditCaseOrderId = text(rowValue(row, ["audit_case_order_id", "audit case order id"]));
    const rawLob = text(rowValue(row, ["lob"]));
    const concatKey = text(rowValue(row, ["concat", "concatkey", "concat_key"])) || (caseOrderId && auditCaseOrderId ? `${caseOrderId}-${auditCaseOrderId}` : "");

    if (!wbLogin) errors.push("WB/Login é obrigatório.");
    else if (!employee) errors.push("WB/Login não encontrado no cadastro.");
    if (!auditTime) errors.push("Data da auditoria inválida.");
    if (!finalResult) warnings.push("final_result vazio; linha importada com valor em branco.");
    if (!caseOrderId) errors.push("Case Order ID é obrigatório.");
    if (!auditCaseOrderId) errors.push("Audit Case Order ID é obrigatório.");
    if (!concatKey) errors.push("Concat inválido.");
    if (concatKey) {
      const first = seen.get(concatKey);
      if (first) warnings.push(`Concat duplicado no arquivo. Primeira ocorrência na linha ${first}; será tratado por upsert.`);
      else seen.set(concatKey, rowNumber);
    }

    return {
      rowNumber,
      type: "QUALITY",
      wbLogin,
      employeeId: employee?.id,
      employeeName: employee?.fullName,
      lob: rawLob || employee?.lob?.name || "",
      lobId: employee?.lobId ?? undefined,
      date: auditTime ? formatDateKey(auditTime) : text(rowValue(row, ["audit_time", "audit time"])),
      uniqueKey: concatKey,
      action: errors.length ? "ignore" : "create",
      errors,
      warnings,
      payload: {
        auditTime: auditTime ? auditTime.toISOString() : "",
        auditDate: auditTime ? formatDateKey(auditTime) : "",
        finalResult,
        caseOrderId,
        auditCaseOrderId,
        concatKey,
        rawLob
      }
    };
  });

  return markExistingQualityRows(previewRows);
}

async function previewProductionRows(rawRows: Record<string, unknown>[], options: PerformancePreviewOptions = {}) {
  const normalizedRows = rawRows.map(normalizeObjectKeys);
  const wbLogins = unique(normalizedRows.map((row) => normalizeWbLogin(text(rowValue(row, ["agentes", "agente", "wb_login", "wb login"])))).filter(Boolean));
  const employees = await findEmployeesByWbLogins(wbLogins);
  const employeeByLogin = new Map(employees.map((employee) => [normalizeWbLogin(employee.wbLogin), employee]));
  const seen = new Map<string, number>();

  const previewRows: PerformancePreviewRow[] = normalizedRows.map((row, index) => {
    const rowNumber = (options.rowNumberOffset ?? 0) + index + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    const wbLogin = normalizeWbLogin(text(rowValue(row, ["agentes", "agente", "wb_login", "wb login"])));
    const employee = employeeByLogin.get(wbLogin);
    const bzTime = normalizeExcelDate(rowValue(row, ["bz_time", "bz time"]));
    const bzDay = normalizeExcelDate(rowValue(row, ["bz_day", "bz day"])) ?? bzTime;
    const submitNum = parseInteger(rowValue(row, ["submit_num", "submit num"]));
    const moderationSeconds = parseNumber(rowValue(row, ["moderation", "moderation(s)", "moderation seconds"]));
    const ahtSeconds = parseNumber(rowValue(row, ["aht(s)", "aht", "aht_seconds"]));
    const latencyMinutesSum = parseNumber(rowValue(row, ["latency(min)_sum", "latency_sum", "latency min sum"]));
    const queueId = text(rowValue(row, ["队列id-queue_id", "queue_id", "fila", "queue"]));
    const productionKey = bzTime && queueId && wbLogin ? `${formatDateTimeKey(bzTime)}|${queueId}|${wbLogin}` : "";

    if (!wbLogin) errors.push("WB/Login é obrigatório.");
    else if (!employee) errors.push("WB/Login não encontrado no cadastro.");
    if (!bzTime) errors.push("BZ_time inválido.");
    if (!bzDay) errors.push("BZ_day inválido.");
    if (submitNum === null || submitNum < 0) errors.push("submit_num inválido.");
    if (moderationSeconds === null || moderationSeconds < 0) errors.push("Moderation inválido.");
    if (!queueId) errors.push("queue_id inválido.");
    if (!productionKey) errors.push("Chave única da produção ausente.");
    if (productionKey) {
      const first = seen.get(productionKey);
      if (first) warnings.push(`Chave duplicada no arquivo. Primeira ocorrência na linha ${first}; será tratada por upsert.`);
      else seen.set(productionKey, rowNumber);
    }

    return {
      rowNumber,
      type: "PRODUCTION",
      wbLogin,
      employeeId: employee?.id,
      employeeName: employee?.fullName,
      lob: employee?.lob?.name ?? "",
      lobId: employee?.lobId ?? undefined,
      date: bzDay ? formatDateKey(bzDay) : text(rowValue(row, ["bz_day", "bz day"])),
      uniqueKey: productionKey,
      action: errors.length ? "ignore" : "create",
      errors,
      warnings,
      payload: {
        bzTime: bzTime ? bzTime.toISOString() : "",
        bzDay: bzDay ? formatDateKey(bzDay) : "",
        submitNum,
        moderationSeconds,
        ahtSeconds,
        latencyMinutesSum,
        queueId,
        productionKey
      }
    };
  });

  return markExistingProductionRows(previewRows);
}

export async function commitQualityImport(actor: Actor, rows: PerformancePreviewRow[], fileName = "qualidade.xlsx") {
  const user = await requireActiveUser(actor);
  requireImportPermission(user);
  return commitQualityRows(user, rows, fileName);
}

async function commitQualityRows(user: AuthenticatedUser, rows: PerformancePreviewRow[], fileName = "qualidade.xlsx", batchId?: string) {
  const validRows = rows.filter((row) => row.type === "QUALITY" && !row.errors.length && row.employeeId && row.uniqueKey);
  if (!validRows.length) throw new PerformanceError("Não há linhas válidas para importar.", 400);
  const createdRows = validRows.filter((row) => row.action === "create").length;
  const updatedRows = validRows.filter((row) => row.action === "update").length;
  const batch = await upsertImportBatch(user, "QUALITY", fileName, rows, validRows.length, createdRows, updatedRows, batchId);

  for (const chunk of chunks(validRows, 100)) {
    await prisma.$transaction(chunk.map((row) => prisma.qualityRecord.upsert({
      where: { concatKey: String(row.payload.concatKey) },
      update: {
        auditTime: new Date(String(row.payload.auditTime)),
        auditDate: parseDate(String(row.payload.auditDate))!,
        wbLogin: row.wbLogin,
        employeeId: row.employeeId,
        finalResult: String(row.payload.finalResult),
        caseOrderId: String(row.payload.caseOrderId),
        auditCaseOrderId: String(row.payload.auditCaseOrderId),
        lobId: row.lobId ?? null,
        rawLob: String(row.payload.rawLob ?? "") || null,
        importBatchId: batch.id
      },
      create: {
        auditTime: new Date(String(row.payload.auditTime)),
        auditDate: parseDate(String(row.payload.auditDate))!,
        wbLogin: row.wbLogin,
        employeeId: row.employeeId,
        finalResult: String(row.payload.finalResult),
        caseOrderId: String(row.payload.caseOrderId),
        auditCaseOrderId: String(row.payload.auditCaseOrderId),
        concatKey: String(row.payload.concatKey),
        lobId: row.lobId ?? null,
        rawLob: String(row.payload.rawLob ?? "") || null,
        importBatchId: batch.id
      }
    })));
  }
  if (!batchId) await auditImport(user.id, "QUALITY", batch.id, { fileName, rowsTotal: rows.length, rowsValid: validRows.length, createdRows, updatedRows });
  return { success: true, importedRows: validRows.length, createdRows, updatedRows, batchId: batch.id };
}

export async function commitProductionImport(actor: Actor, rows: PerformancePreviewRow[], fileName = "producao.xlsx") {
  const user = await requireActiveUser(actor);
  requireImportPermission(user);
  return commitProductionRows(user, rows, fileName);
}

async function commitProductionRows(user: AuthenticatedUser, rows: PerformancePreviewRow[], fileName = "producao.xlsx", batchId?: string) {
  const validRows = rows.filter((row) => row.type === "PRODUCTION" && !row.errors.length && row.employeeId && row.uniqueKey);
  if (!validRows.length) throw new PerformanceError("Não há linhas válidas para importar.", 400);
  const createdRows = validRows.filter((row) => row.action === "create").length;
  const updatedRows = validRows.filter((row) => row.action === "update").length;
  const batch = await upsertImportBatch(user, "PRODUCTION", fileName, rows, validRows.length, createdRows, updatedRows, batchId);

  for (const chunk of chunks(validRows, 100)) {
    await prisma.$transaction(chunk.map((row) => prisma.productionRecord.upsert({
      where: { productionKey: String(row.payload.productionKey) },
      update: {
        bzTime: new Date(String(row.payload.bzTime)),
        bzDay: parseDate(String(row.payload.bzDay))!,
        wbLogin: row.wbLogin,
        employeeId: row.employeeId,
        ahtSeconds: nullableNumber(row.payload.ahtSeconds),
        latencyMinutesSum: nullableNumber(row.payload.latencyMinutesSum),
        submitNum: Number(row.payload.submitNum ?? 0),
        queueId: String(row.payload.queueId),
        moderationSeconds: Number(row.payload.moderationSeconds ?? 0),
        lobId: row.lobId ?? null,
        importBatchId: batch.id
      },
      create: {
        bzTime: new Date(String(row.payload.bzTime)),
        bzDay: parseDate(String(row.payload.bzDay))!,
        wbLogin: row.wbLogin,
        employeeId: row.employeeId,
        ahtSeconds: nullableNumber(row.payload.ahtSeconds),
        latencyMinutesSum: nullableNumber(row.payload.latencyMinutesSum),
        submitNum: Number(row.payload.submitNum ?? 0),
        queueId: String(row.payload.queueId),
        moderationSeconds: Number(row.payload.moderationSeconds ?? 0),
        lobId: row.lobId ?? null,
        productionKey: String(row.payload.productionKey),
        importBatchId: batch.id
      }
    })));
  }
  if (!batchId) await auditImport(user.id, "PRODUCTION", batch.id, { fileName, rowsTotal: rows.length, rowsValid: validRows.length, createdRows, updatedRows });
  return { success: true, importedRows: validRows.length, createdRows, updatedRows, batchId: batch.id };
}

export async function exportPerformanceXlsxData(actor: Actor, query: PerformanceQuery = {}): Promise<XlsxExportPayload> {
  const user = await requireActiveUser(actor);
  if (!canExportPerformance(permissionUser(user))) throw new PerformanceError("Você não tem permissão para exportar Performance.", 403);
  const dashboard = await getPerformanceDashboard(actor, { ...query, view: "wfh" });
  if (dashboard.mode !== "wfh") throw new PerformanceError("Exportação disponível apenas na visão WFH.", 403);
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: AuditAction.EDICAO,
      entity: "Performance",
      entityId: "WFH",
      after: { filters: query, rows: dashboard.ranking.length },
      reason: "PERFORMANCE_EXPORTED"
    }
  }).catch(() => undefined);
  return {
    fileName: `performance_wfh_${new Date().toISOString().slice(0, 10)}.xlsx`,
    sheetName: "Ranking",
    headers: ["semana_inicio", "semana_fim", "agente", "wb_login", "lob", "supervisor", "qualidade", "submit", "aht_segundos", "aht_formatado", "abs", "faltas", "dias_escalados_validos"],
    rows: dashboard.ranking.flatMap((agent) => agent.weekly.map((week) => [
      week.weekStart,
      week.weekEnd,
      agent.employeeName,
      agent.wbLogin,
      agent.lob,
      agent.supervisor,
      `${week.quality}%`,
      week.submit,
      week.ahtSeconds,
      formatAht(week.ahtSeconds),
      `${week.abs}%`,
      week.absences,
      week.scheduledDays
    ]))
  };
}

export function performanceTemplate(type: "quality" | "production"): XlsxExportPayload {
  if (type === "quality") {
    return {
      fileName: "template_performance_qualidade.xlsx",
      sheetName: "qualidade",
      headers: ["audit_time", "audit_name", "final_result", "质检case_order_id", "audit_case_order_id", "LOB", "Concat"],
      rows: []
    };
  }
  return {
    fileName: "template_performance_producao.xlsx",
    sheetName: "producao",
    headers: ["BZ_time", "BZ_day", "AHT(s)", "Latency(min)_sum", "submit_num", "队列id-queue_id", "Moderation", "Agentes"],
    rows: []
  };
}

function requireImportPermission(user: AuthenticatedUser) {
  if (!canImportPerformance(permissionUser(user))) throw new PerformanceError("Apenas ADMIN ou WFM podem importar Performance.", 403);
}

async function requireActiveUser(actor: Actor): Promise<AuthenticatedUser> {
  if (!actor.email) throw new PerformanceError("Faça login para acessar Performance.", 401);
  const user = await prisma.user.findUnique({
    where: { email: actor.email },
    include: {
      role: true,
      employeeProfile: {
        include: {
          lob: true,
          supervisor: true
        }
      }
    }
  });
  if (!user || user.status !== "ACTIVE" || user.deletedAt) throw new PerformanceError("Usuário sem acesso ativo.", 403);
  return user;
}

function requireOwnEmployee(user: AuthenticatedUser) {
  if (!user.employeeProfile || user.employeeProfile.deletedAt) throw new PerformanceError("Seu usuário não está vinculado a um cadastro de colaborador.", 403);
  return user.employeeProfile;
}

function permissionUser(user: AuthenticatedUser) {
  return {
    role: user.role.name,
    email: user.email,
    name: user.name,
    status: user.status,
    roleTitle: user.employeeProfile?.roleTitle ?? null
  };
}

async function listPerformanceEmployees(query: PerformanceQuery = {}, options: { defaultAgentsOnly?: boolean } = {}) {
  const where: Prisma.EmployeeProfileWhereInput = { deletedAt: null };
  const and: Prisma.EmployeeProfileWhereInput[] = [];
  if (options.defaultAgentsOnly && (!query.role || query.role === "Todos")) {
    and.push({ OR: agentRoleTitleAliases.map((roleTitle) => ({ roleTitle: { equals: roleTitle, mode: "insensitive" } })) });
  } else if (query.role && query.role !== "Todos") {
    and.push({ roleTitle: { equals: query.role, mode: "insensitive" } });
  }
  if (query.employeeId && query.employeeId !== "Todos") and.push({ id: query.employeeId });
  if (query.lob && query.lob !== "Todos") and.push({ lob: { name: { equals: query.lob, mode: "insensitive" } } });
  if (query.supervisorId && query.supervisorId !== "Todos") {
    and.push(query.supervisorId === "SEM_SUPERVISOR" ? { supervisorId: null } : { supervisorId: query.supervisorId });
  }
  if (query.skill && query.skill !== "Todos") and.push(query.skill === "SEM_SKILL" ? { OR: [{ skill: null }, { skill: "" }] } : { skill: { equals: query.skill, mode: "insensitive" } });
  if (and.length) where.AND = and;

  const employees = await prisma.employeeProfile.findMany({
    where,
    include: {
      user: true,
      lob: true,
      supervisor: true
    },
    orderBy: { fullName: "asc" },
    take: 3000
  });
  return options.defaultAgentsOnly && (!query.role || query.role === "Todos") ? employees.filter((employee) => isAgentJobTitle(employee.roleTitle)) : employees;
}

async function getPerformanceFilterOptions() {
  const employees = await prisma.employeeProfile.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      fullName: true,
      wbLogin: true,
      roleTitle: true,
      skill: true,
      lob: { select: { name: true } },
      supervisor: { select: { id: true, fullName: true } }
    },
    orderBy: { fullName: "asc" }
  });
  const agents = employees.filter((employee) => isAgentJobTitle(employee.roleTitle));
  const supervisors = new Map<string, string>();
  for (const employee of agents) {
    if (employee.supervisor?.id) supervisors.set(employee.supervisor.id, employee.supervisor.fullName);
  }
  return {
    lobs: ["Todos", ...unique(agents.map((employee) => employee.lob?.name).filter((value): value is string => Boolean(value))).sort()],
    skills: ["Todos", "SEM_SKILL", ...unique(agents.map((employee) => employee.skill).filter((value): value is string => Boolean(value))).sort()],
    roles: ["Todos", ...unique(agents.map((employee) => employee.roleTitle).filter(Boolean)).sort()],
    supervisors: [
      { id: "Todos", name: "Todos os supervisores" },
      { id: "SEM_SUPERVISOR", name: "Sem supervisor" },
      ...Array.from(supervisors.entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => ({ id, name }))
    ],
    employees: [
      { id: "Todos", name: "Todos os agentes", wbLogin: "" },
      ...agents.map((employee) => ({ id: employee.id, name: employee.fullName, wbLogin: employee.wbLogin }))
    ]
  };
}

async function buildAgentRows(employees: PerformanceEmployee[], period: Period) {
  if (!employees.length) return [];
  const employeeIds = employees.map((employee) => employee.id);
  const [qualityRecords, productionRecords, schedules] = await Promise.all([
    prisma.qualityRecord.findMany({
      where: { employeeId: { in: employeeIds }, auditDate: { gte: period.start, lte: period.end } },
      select: qualityMetricSelect
    }),
    prisma.productionRecord.findMany({
      where: { employeeId: { in: employeeIds }, bzDay: { gte: period.start, lte: period.end } },
      select: productionMetricSelect
    }),
    prisma.schedule.findMany({
      where: { employeeId: { in: employeeIds }, date: { gte: period.start, lte: period.end }, deletedAt: null },
      select: scheduleMetricSelect
    })
  ]);

  const weeks = weeksInPeriod(period);
  return employees.map((employee) => {
    const weekly = weeks.map((week) => buildWeeklyMetrics(employee.id, week, qualityRecords, productionRecords, schedules));
    const periodMetrics = summarizeWeeklyRows(weekly);
    return {
      employeeId: employee.id,
      employeeName: employee.fullName,
      wbLogin: employee.wbLogin,
      lob: employee.lob?.name ?? "Sem LOB",
      supervisor: employee.supervisor?.fullName ?? "Sem supervisor",
      roleTitle: employee.roleTitle,
      skill: employee.skill ?? "",
      weekly,
      ...periodMetrics
    };
  });
}

function buildWeeklyMetrics(employeeId: string, week: WeekRange, qualityRecords: QualityRecordForMetrics[], productionRecords: ProductionRecordForMetrics[], schedules: ScheduleRecordForMetrics[]): WeeklyMetricRow {
  const weekQualityRecords: Array<Pick<QualityRecordForMetrics, "concatKey" | "finalResult">> = [];
  let submit = 0;
  let moderationSeconds = 0;
  let absences = 0;
  let scheduledDays = 0;
  for (const record of qualityRecords) {
    if (record.employeeId !== employeeId || !isDateInRange(record.auditDate, week.start, week.end)) continue;
    weekQualityRecords.push(record);
  }
  for (const record of productionRecords) {
    if (record.employeeId !== employeeId || !isDateInRange(record.bzDay, week.start, week.end)) continue;
    submit += record.submitNum;
    moderationSeconds += record.moderationSeconds;
  }
  for (const schedule of schedules) {
    if (schedule.employeeId !== employeeId || !isDateInRange(schedule.date, week.start, week.end)) continue;
    if (scheduledStatuses.has(schedule.status)) scheduledDays += 1;
    if (schedule.status === "FALTA") absences += 1;
  }
  return {
    weekStart: formatDateKey(week.start),
    weekEnd: formatDateKey(week.end),
    weekLabel: `${formatDisplayDate(week.start)} a ${formatDisplayDate(week.end)}`,
    ...calculateQuality(weekQualityRecords),
    submit,
    moderationSeconds: round2(moderationSeconds),
    ahtSeconds: submit > 0 ? round2(moderationSeconds / submit) : 0,
    absences,
    scheduledDays,
    abs: percent(absences, scheduledDays)
  };
}

function summarizeRows(rows: AgentPerformanceRow[]) {
  return summarizeWeeklyRows(rows.flatMap((row) => row.weekly));
}

function calculateQuality(records: Array<Pick<QualityRecordForMetrics, "concatKey" | "finalResult">>) {
  const totalConcatKeys = new Set<string>();
  const correctConcatKeys = new Set<string>();
  for (const record of records) {
    totalConcatKeys.add(record.concatKey);
    if (record.finalResult === "Correct") correctConcatKeys.add(record.concatKey);
  }
  return {
    qualityCorrect: correctConcatKeys.size,
    qualityTotal: totalConcatKeys.size,
    quality: percent(correctConcatKeys.size, totalConcatKeys.size)
  };
}

function summarizeWeeklyRows(rows: WeeklyMetricRow[]): PerformanceMetrics {
  const qualityCorrect = rows.reduce((sum, row) => sum + row.qualityCorrect, 0);
  const qualityTotal = rows.reduce((sum, row) => sum + row.qualityTotal, 0);
  const submit = rows.reduce((sum, row) => sum + row.submit, 0);
  const moderationSeconds = rows.reduce((sum, row) => sum + row.moderationSeconds, 0);
  const absences = rows.reduce((sum, row) => sum + row.absences, 0);
  const scheduledDays = rows.reduce((sum, row) => sum + row.scheduledDays, 0);
  return {
    qualityCorrect,
    qualityTotal,
    quality: percent(qualityCorrect, qualityTotal),
    submit,
    moderationSeconds: round2(moderationSeconds),
    ahtSeconds: submit > 0 ? round2(moderationSeconds / submit) : 0,
    absences,
    scheduledDays,
    abs: percent(absences, scheduledDays)
  };
}

function buildWeeklyEvolution(rows: AgentPerformanceRow[], period: Period) {
  return weeksInPeriod(period).map((week) => {
    const weeklyRows = rows.flatMap((row) => row.weekly.filter((item) => item.weekStart === formatDateKey(week.start)));
    return {
      weekStart: formatDateKey(week.start),
      weekEnd: formatDateKey(week.end),
      weekLabel: `${formatDisplayDate(week.start)} a ${formatDisplayDate(week.end)}`,
      ...summarizeWeeklyRows(weeklyRows)
    };
  });
}

function emptyAgentRow(employee: PerformanceEmployee, period: Period): AgentPerformanceRow {
  const weekly = weeksInPeriod(period).map((week) => ({
    weekStart: formatDateKey(week.start),
    weekEnd: formatDateKey(week.end),
    weekLabel: `${formatDisplayDate(week.start)} a ${formatDisplayDate(week.end)}`,
    ...emptyMetrics()
  }));
  return {
    employeeId: employee.id,
    employeeName: employee.fullName,
    wbLogin: employee.wbLogin,
    lob: employee.lob?.name ?? "Sem LOB",
    supervisor: employee.supervisor?.fullName ?? "Sem supervisor",
    roleTitle: employee.roleTitle,
    skill: employee.skill ?? "",
    weekly,
    ...emptyMetrics()
  };
}

function emptyMetrics(): PerformanceMetrics {
  return { quality: 0, qualityCorrect: 0, qualityTotal: 0, submit: 0, ahtSeconds: 0, moderationSeconds: 0, abs: 0, absences: 0, scheduledDays: 0 };
}

function hasAnyData(row: AgentPerformanceRow) {
  return row.qualityTotal > 0 || row.submit > 0 || row.scheduledDays > 0;
}

async function markExistingQualityRows(previewRows: PerformancePreviewRow[]) {
  const validKeys = unique(previewRows.filter((row) => !row.errors.length && row.uniqueKey).map((row) => row.uniqueKey));
  const existing = validKeys.length ? await prisma.qualityRecord.findMany({ where: { concatKey: { in: validKeys } }, select: { concatKey: true } }) : [];
  const existingKeys = new Set(existing.map((row) => row.concatKey));
  return buildPreviewResult(previewRows.map((row) => row.errors.length ? row : { ...row, action: existingKeys.has(row.uniqueKey) ? "update" : "create" }));
}

async function markExistingProductionRows(previewRows: PerformancePreviewRow[]) {
  const validKeys = unique(previewRows.filter((row) => !row.errors.length && row.uniqueKey).map((row) => row.uniqueKey));
  const existing = validKeys.length ? await prisma.productionRecord.findMany({ where: { productionKey: { in: validKeys } }, select: { productionKey: true } }) : [];
  const existingKeys = new Set(existing.map((row) => row.productionKey));
  return buildPreviewResult(previewRows.map((row) => row.errors.length ? row : { ...row, action: existingKeys.has(row.uniqueKey) ? "update" : "create" }));
}

async function upsertImportBatch(
  user: AuthenticatedUser,
  type: "QUALITY" | "PRODUCTION",
  fileName: string,
  rows: PerformancePreviewRow[],
  rowsValid: number,
  rowsInserted: number,
  rowsUpdated: number,
  batchId?: string
) {
  const rowsError = rows.filter((row) => row.errors.length).length;
  const errorSummary = previewErrorSummary(rows);
  if (batchId) {
    const existing = await prisma.performanceImportBatch.findUnique({
      where: { id: batchId },
      select: { id: true, type: true, status: true, errorSummary: true }
    });
    if (!existing || existing.type !== type) throw new PerformanceError("Lote de importação inválido para esta base.", 400);
    const nextErrorSummary = [existing.errorSummary, errorSummary].filter(Boolean).join(" | ").slice(0, 4000) || null;
    return prisma.performanceImportBatch.update({
      where: { id: batchId },
      data: {
        rowsTotal: { increment: rows.length },
        rowsValid: { increment: rowsValid },
        rowsError: { increment: rowsError },
        rowsInserted: { increment: rowsInserted },
        rowsUpdated: { increment: rowsUpdated },
        status: existing.status === "PARTIAL" || rowsError ? "PARTIAL" : "SUCCESS",
        errorSummary: nextErrorSummary
      }
    });
  }
  return prisma.performanceImportBatch.create({
    data: {
      type,
      fileName,
      rowsTotal: rows.length,
      rowsValid,
      rowsError,
      rowsInserted,
      rowsUpdated,
      status: rowsError ? "PARTIAL" : "SUCCESS",
      errorSummary,
      importedById: user.id
    }
  });
}

function previewErrorSummary(rows: PerformancePreviewRow[]) {
  return rows
    .filter((row) => row.errors.length)
    .slice(0, 20)
    .map((row) => `Linha ${row.rowNumber}: ${row.errors.join("; ")}`)
    .join(" | ") || null;
}

function buildPreviewResult(rows: PerformancePreviewRow[]) {
  const missingWbLogins = unique(rows.filter((row) => row.errors.some((error) => /WB\/Login não encontrado/i.test(error))).map((row) => row.wbLogin).filter(Boolean));
  return {
    success: rows.every((row) => !row.errors.length),
    rows,
    summary: {
      totalRows: rows.length,
      validRows: rows.filter((row) => !row.errors.length).length,
      errorRows: rows.filter((row) => row.errors.length).length,
      warningRows: rows.filter((row) => row.warnings.length).length,
      createdRows: rows.filter((row) => !row.errors.length && row.action === "create").length,
      updatedRows: rows.filter((row) => !row.errors.length && row.action === "update").length,
      foundEmployees: rows.filter((row) => row.employeeId).length,
      missingEmployees: missingWbLogins.length,
      missingWbLogins
    }
  };
}

async function findEmployeesByWbLogins(wbLogins: string[]) {
  if (!wbLogins.length) return [];
  return prisma.employeeProfile.findMany({
    where: { OR: wbLogins.map((wbLogin) => ({ wbLogin: { equals: wbLogin, mode: "insensitive" } })), deletedAt: null },
    include: { user: true, lob: true, supervisor: true }
  });
}

async function auditImport(userId: string, type: string, batchId: string, details: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: {
      actorId: userId,
      action: AuditAction.IMPORTACAO,
      entity: "PerformanceImportBatch",
      entityId: batchId,
      after: { type, ...details },
      reason: `PERFORMANCE_${type}_IMPORT`
    }
  }).catch(() => undefined);
}

type Period = { start: Date; end: Date };
type WeekRange = { start: Date; end: Date };

function resolvePeriod(query: PerformanceQuery): Period {
  if (query.month && /^\d{4}-\d{2}$/.test(query.month)) {
    const [year, month] = query.month.split("-").map(Number);
    return { start: utcDate(year, month, 1), end: utcDate(year, month + 1, 0) };
  }
  const now = new Date();
  const defaultStart = utcDate(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const defaultEnd = utcDate(now.getUTCFullYear(), now.getUTCMonth() + 2, 0);
  return {
    start: parseDate(query.startDate) ?? defaultStart,
    end: parseDate(query.endDate) ?? defaultEnd
  };
}

function weeksInPeriod(period: Period): WeekRange[] {
  const start = startOfWeekMonday(period.start);
  const weeks: WeekRange[] = [];
  for (let cursor = start; cursor <= period.end; cursor = addDays(cursor, 7)) {
    weeks.push({ start: cursor, end: addDays(cursor, 6) });
  }
  return weeks;
}

function startOfWeekMonday(date: Date) {
  const base = utcDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  const day = base.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(base, diff);
}

function isDateInRange(date: Date, start: Date, end: Date) {
  const time = date.getTime();
  return time >= start.getTime() && time <= end.getTime();
}

function addDays(date: Date, days: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function utcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

function normalizeExcelDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate(), value.getHours(), value.getMinutes(), value.getSeconds()));
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30));
    date.setUTCDate(date.getUTCDate() + Math.floor(value));
    const fraction = value - Math.floor(value);
    if (fraction > 0) date.setUTCSeconds(Math.round(fraction * 24 * 60 * 60));
    return date;
  }
  const raw = text(value);
  if (!raw) return null;
  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (br) return new Date(Date.UTC(Number(br[3]), Number(br[2]) - 1, Number(br[1]), Number(br[4] ?? 0), Number(br[5] ?? 0), Number(br[6] ?? 0)));
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4] ?? 0), Number(iso[5] ?? 0), Number(iso[6] ?? 0)));
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDate(value?: string | null) {
  return normalizeExcelDate(value);
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDateTimeKey(date: Date) {
  return date.toISOString().slice(0, 19);
}

function formatDisplayDate(date: Date) {
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function periodPayload(period: Period) {
  return { startDate: formatDateKey(period.start), endDate: formatDateKey(period.end) };
}

function percent(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

function round2(value: number) {
  return Number(value.toFixed(2));
}

function formatAht(seconds: number) {
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes ? `${minutes}:${String(rest).padStart(2, "0")}` : `${rest}s`;
}

function normalizeObjectKeys(row: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) result[normalizeHeader(key)] = value;
  return result;
}

function normalizeHeader(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function rowValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[normalizeHeader(key)];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeWbLogin(value: string) {
  return value.trim().toLowerCase();
}

function parseNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const valueText = text(value);
  const raw = valueText.includes(",") ? valueText.replace(/\./g, "").replace(",", ".") : valueText;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: unknown) {
  const parsed = parseNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

function nullableNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}
