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
import { parseWbLoginBatch } from "@/lib/batch-wb-filter";
import { getDefaultDatePeriod } from "@/lib/default-date-range";
import { prisma } from "@/lib/prisma";
import { calculateWfhStatus, type WfhEligibilityStatus, type WfhMonitoringStatus } from "@/lib/wfh-rules";
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
type TnsQualityRecordForMetrics = Prisma.TnsQualityRecordGetPayload<{ select: typeof tnsQualityMetricSelect }>;
type CecQualityRecordForMetrics = Prisma.CecQualityRecordGetPayload<{ select: typeof cecQualityMetricSelect }>;
type ProductionRecordForMetrics = Prisma.ProductionRecordGetPayload<{ select: typeof productionMetricSelect }>;
type ScheduleRecordForMetrics = Prisma.ScheduleGetPayload<{ select: typeof scheduleMetricSelect }>;
type AttendanceRecordForMetrics = Prisma.AttendanceRecordGetPayload<{ select: typeof attendanceMetricSelect }>;

type QualityRule = "ADS_QUALITY" | "TNS_QUALITY" | "CEC_QUALITY" | "UNKNOWN" | "MIXED";
type PerformanceSortBy = "quality" | "submit" | "aht" | "abs";
type PerformanceSortDirection = "asc" | "desc";

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
  employeeStatus?: string;
  wfhStatus?: string;
  wbLogins?: string[] | string;
  sortBy?: PerformanceSortBy;
  sortDirection?: PerformanceSortDirection;
};

export type PerformancePreviewRow = {
  rowNumber: number;
  type: "QUALITY" | "TNS_QUALITY" | "CEC_QUALITY" | "PRODUCTION";
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
  yearReference?: number;
};

type PerformanceMetrics = {
  quality: number;
  qualityRule: QualityRule;
  qualityNumerator: number;
  qualityDenominator: number;
  qualityErrors: number;
  qualityCorrect: number;
  qualityTotal: number;
  submit: number;
  submitTotal: number;
  submitDays: number;
  ahtSeconds: number;
  moderationSeconds: number;
  abs: number;
  absences: number;
  unjustifiedAbsences: number;
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
  employeeStatus: string;
  wfhStatus: WfhEligibilityStatus;
  wfhStatusLabel: string;
  wfhMonitoringStatus: WfhMonitoringStatus;
  wfhMonitoringLabel: string;
  wfhRule: string;
  submitAveragePerDay: number;
  wfhFailedCriteria: string[];
  wfhReasons: string[];
  weekly: WeeklyMetricRow[];
};

const agentRoleTitleAliases = ["Agente", "Agent", "Moderador de Conteúdo", "Content Moderator"];
const scheduledStatuses = new Set<ScheduleStatus>(["ESCALADO", "PRESENTE", "FALTA", "FALTA_JUSTIFICADA", "FALTA_INJUSTIFICADA", "ATRASO", "SAIDA_ANTECIPADA", "TROCA_APROVADA", "VENDA_FOLGA_APROVADA", "FOLGA_APROVADA"]);
const absenceStatuses = new Set<ScheduleStatus>(["FALTA", "FALTA_JUSTIFICADA", "FALTA_INJUSTIFICADA"]);
const qualityMetricSelect = {
  auditDate: true,
  concatKey: true,
  finalResult: true,
  caseOrderId: true,
  auditCaseOrderId: true,
  employeeId: true
} satisfies Prisma.QualityRecordSelect;
const tnsQualityMetricSelect = {
  auditDate: true,
  sampling: true,
  mislabeled: true,
  leakage: true,
  falsePositive: true,
  employeeId: true
} satisfies Prisma.TnsQualityRecordSelect;
const cecQualityMetricSelect = {
  qualityDate: true,
  weekNumber: true,
  passQuantity: true,
  failQuantity: true,
  employeeId: true
} satisfies Prisma.CecQualityRecordSelect;
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
const attendanceMetricSelect = {
  date: true,
  status: true,
  isJustified: true,
  reasonClassification: true,
  employeeId: true
} satisfies Prisma.AttendanceRecordSelect;

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
  const view = role === "CLIENT" ? "wfh" : query.view ?? (role === "COLABORADOR" ? "mine" : "wfh");
  const period = resolvePeriod(query);

  if (view === "mine" || role === "COLABORADOR") {
    const ownEmployee = requireOwnEmployee(user);
    const operationEmployees = await listPerformanceEmployees({}, { defaultAgentsOnly: true }, period.end);
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
        lobAverage: summarizeRows(lobRows, period),
        operationAverage: summarizeRows(operationRows, period)
      },
      weekly: mine.weekly.map((week) => ({
        ...week,
        lobAverage: summarizeWeeklyRows(lobRows.flatMap((row) => row.weekly.filter((item) => item.weekStart === week.weekStart))),
        operationAverage: summarizeWeeklyRows(operationRows.flatMap((row) => row.weekly.filter((item) => item.weekStart === week.weekStart)))
      }))
    };
  }

  if (!canAccessPerformanceWfh(permissionUser(user))) throw new PerformanceError("Você não tem permissão para acessar WFH.", 403);
  const employees = await listPerformanceEmployees(query, { defaultAgentsOnly: true }, period.end);
  const rows = sortAgentRows(filterRowsByWfhStatus(await buildAgentRows(employees, period), query.wfhStatus), query);
  const isClientView = role === "CLIENT";
  const imports = isClientView ? [] : await prisma.performanceImportBatch.findMany({
    orderBy: { importedAt: "desc" },
    take: 12,
    include: { importedBy: { select: { name: true, email: true } } }
  });
  const filters = await getPerformanceFilterOptions(period.end);
  const batchWb = await resolveBatchWbInfo(query.wbLogins);

  return {
    mode: "wfh" as const,
    canImport: canImportPerformance(permissionUser(user)),
    canExport: canExportPerformance(permissionUser(user)),
    period: periodPayload(period),
    summary: {
      ...summarizeRows(rows, period),
      agentsWithData: rows.filter(hasAnyData).length,
      importedRows: imports.reduce((sum, item) => sum + item.rowsValid, 0),
      lastImport: imports[0] ? formatDateTime(imports[0].importedAt) : ""
    },
    ranking: rows.slice(0, 200),
    weekly: buildWeeklyEvolution(rows, period),
    filters: {
      ...filters,
      batchWb
    },
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

export async function previewTnsQualityImport(actor: Actor, rawRows: Record<string, unknown>[], options: PerformancePreviewOptions = {}) {
  const user = await requireActiveUser(actor);
  requireImportPermission(user);
  return previewTnsQualityRows(rawRows, options);
}

export async function previewCecQualityImport(actor: Actor, rawRows: Record<string, unknown>[], options: PerformancePreviewOptions = {}) {
  const user = await requireActiveUser(actor);
  requireImportPermission(user);
  return previewCecQualityRows(rawRows, options);
}

export async function commitQualityRawImport(actor: Actor, rawRows: Record<string, unknown>[], fileName = "qualidade.xlsx", batchId?: string, rowNumberOffset = 0) {
  const user = await requireActiveUser(actor);
  requireImportPermission(user);
  const preview = await previewQualityRows(rawRows, { rowNumberOffset });
  return commitQualityRows(user, preview.rows, fileName, batchId);
}

export async function commitTnsQualityRawImport(actor: Actor, rawRows: Record<string, unknown>[], fileName = "qualidade_tns.xlsx", batchId?: string, rowNumberOffset = 0) {
  const user = await requireActiveUser(actor);
  requireImportPermission(user);
  const preview = await previewTnsQualityRows(rawRows, { rowNumberOffset });
  return commitTnsQualityRows(user, preview.rows, fileName, batchId);
}

export async function commitCecQualityRawImport(actor: Actor, rawRows: Record<string, unknown>[], fileName = "qualidade_cec.xlsx", batchId?: string, rowNumberOffset = 0, yearReference?: number) {
  const user = await requireActiveUser(actor);
  requireImportPermission(user);
  const preview = await previewCecQualityRows(rawRows, { rowNumberOffset, yearReference });
  return commitCecQualityRows(user, preview.rows, fileName, batchId);
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

  const previewRows: PerformancePreviewRow[] = normalizedRows.map((row, index) => {
    const rowNumber = (options.rowNumberOffset ?? 0) + index + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    const wbLogin = normalizeWbLogin(text(rowValue(row, ["audit_name", "audit name", "wb_login", "wb login"])));
    const employee = employeeByLogin.get(wbLogin);
    const auditTime = normalizeExcelDate(rowValue(row, ["audit_time", "audit_time(年月日)", "audit time", "data"]));
    const finalResult = text(rowValue(row, ["final_result", "final result", "resultado"]));
    const caseOrderId = text(rowValue(row, ["质检case_order_id", "case_order_id", "case order id"]));
    const auditCaseOrderId = text(rowValue(row, ["audit_case_order_id", "audit case order id"]));
    const rawLob = text(rowValue(row, ["lob"]));
    const concatKey = buildQualityTaskKey(caseOrderId, auditCaseOrderId);
    const qualityRule = getQualityRuleByEmployee(employee);

    if (!wbLogin) errors.push("WB/Login é obrigatório.");
    else if (!employee) errors.push("WB/Login não encontrado no cadastro.");
    else if (qualityRule === "TNS_QUALITY") warnings.push("Este agente pertence à operação TNS. A qualidade dele deve ser calculada pela base TNS.");
    else if (qualityRule === "CEC_QUALITY") warnings.push("Este agente pertence à operação CEC. A qualidade dele deve ser calculada pela base CEC.");
    else if (qualityRule === "UNKNOWN") warnings.push("Colaborador sem LOB cadastrada ou com LOB sem regra de qualidade.");
    if (!auditTime) errors.push("Data da auditoria inválida.");
    if (!finalResult) warnings.push("final_result vazio; linha importada com valor em branco.");
    if (!caseOrderId) errors.push("Case Order ID é obrigatório.");
    if (!auditCaseOrderId) errors.push("Audit Case Order ID é obrigatório.");
    if (!concatKey) errors.push("Concat inválido.");

    return {
      rowNumber,
      type: "QUALITY",
      wbLogin,
      employeeId: employee?.id,
      employeeName: employee?.fullName,
      lob: rawLob || employee?.lob?.name || "",
      lobId: employee?.lobId ?? undefined,
      date: auditTime ? formatDateKey(auditTime) : text(rowValue(row, ["audit_time", "audit_time(年月日)", "audit time"])),
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

async function previewTnsQualityRows(rawRows: Record<string, unknown>[], options: PerformancePreviewOptions = {}) {
  const normalizedRows = rawRows.map(normalizeObjectKeys);
  const wbLogins = unique(normalizedRows.map((row) => normalizeWbLogin(text(rowValue(row, ["audit_name", "audit name", "wb_login", "wb login", "agente", "agentes", "agent"])))).filter(Boolean));
  const employees = await findEmployeesByWbLogins(wbLogins);
  const employeeByLogin = new Map(employees.map((employee) => [normalizeWbLogin(employee.wbLogin), employee]));

  const previewRows: PerformancePreviewRow[] = normalizedRows.map((row, index) => {
    const rowNumber = (options.rowNumberOffset ?? 0) + index + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    const wbLogin = normalizeWbLogin(text(rowValue(row, ["audit_name", "audit name", "wb_login", "wb login", "agente", "agentes", "agent"])));
    const employee = employeeByLogin.get(wbLogin);
    const auditDate = normalizeExcelDate(rowValue(row, ["audit_time", "audit date", "audit_date", "data", "date", "bz_day", "bz day"]));
    const rawLob = text(rowValue(row, ["lob"]));
    const sampling = parseInteger(rowValue(row, ["sampling", "amostra"]));
    const mislabeled = parseInteger(rowValue(row, ["mislabeled", "mis labeled", "mislabelled"]));
    const leakage = parseInteger(rowValue(row, ["leakage"]));
    const falsePositive = parseInteger(rowValue(row, ["false positive", "false_positive", "falsepositive"]));
    const caseOrderId = text(rowValue(row, ["质检case_order_id", "case_order_id", "case order id"]));
    const auditCaseOrderId = text(rowValue(row, ["audit_case_order_id", "audit case order id"]));
    const concatKey = text(rowValue(row, ["concat", "concatkey", "source_key", "source key"])) || buildQualityTaskKey(caseOrderId, auditCaseOrderId);
    const sourceKey = concatKey || `${auditDate ? formatDateKey(auditDate) : "sem-data"}|${wbLogin || "sem-wb"}|${rowNumber}`;
    const qualityRule = getQualityRuleByEmployee(employee);

    if (!wbLogin) errors.push("WB/Login é obrigatório.");
    else if (!employee) errors.push("WB/Login não encontrado no cadastro.");
    else if (qualityRule === "ADS_QUALITY") warnings.push("Este agente pertence à ADS. A qualidade dele deve ser calculada pela base ADS.");
    else if (qualityRule === "CEC_QUALITY") warnings.push("Este agente pertence à CEC. A qualidade dele deve ser calculada pela base CEC.");
    else if (qualityRule === "UNKNOWN") warnings.push("Colaborador sem LOB cadastrada ou com LOB sem regra de qualidade.");
    if (!auditDate) errors.push("Data da qualidade TNS inválida.");
    if (sampling === null || sampling < 0) errors.push("Sampling inválido.");
    if (mislabeled === null || mislabeled < 0) errors.push("Mislabeled inválido.");
    if (leakage === null || leakage < 0) errors.push("Leakage inválido.");
    if (falsePositive === null || falsePositive < 0) errors.push("False Positive inválido.");

    return {
      rowNumber,
      type: "TNS_QUALITY",
      wbLogin,
      employeeId: employee?.id,
      employeeName: employee?.fullName,
      lob: rawLob || employee?.lob?.name || "",
      lobId: employee?.lobId ?? undefined,
      date: auditDate ? formatDateKey(auditDate) : text(rowValue(row, ["audit_time", "audit date", "audit_date", "data", "date", "bz_day", "bz day"])),
      uniqueKey: sourceKey,
      action: errors.length ? "ignore" : "create",
      errors,
      warnings,
      payload: {
        auditDate: auditDate ? formatDateKey(auditDate) : "",
        sampling,
        mislabeled,
        leakage,
        falsePositive,
        rawLob,
        sourceKey
      }
    };
  });

  return markExistingTnsQualityRows(previewRows);
}

async function previewCecQualityRows(rawRows: Record<string, unknown>[], options: PerformancePreviewOptions = {}) {
  const normalizedRows = rawRows.map(normalizeObjectKeys);
  const yearReference = normalizeYearReference(options.yearReference);
  const wbLogins = unique(normalizedRows.map((row) => normalizeWbLogin(text(rowValue(row, ["wb", "wb_login", "wb login", "agente", "agent"])))).filter(Boolean));
  const employees = await findEmployeesByWbLogins(wbLogins);
  const employeeByLogin = new Map(employees.map((employee) => [normalizeWbLogin(employee.wbLogin), employee]));
  const seen = new Map<string, number>();

  const previewRows: PerformancePreviewRow[] = normalizedRows.map((row, index) => {
    const rowNumber = (options.rowNumberOffset ?? 0) + index + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    const wbLogin = normalizeWbLogin(text(rowValue(row, ["wb", "wb_login", "wb login", "agente", "agent"])));
    const employee = employeeByLogin.get(wbLogin);
    const weekNumber = parseWeekNumber(rowValue(row, ["week", "semana"]));
    const passQuantity = parseInteger(rowValue(row, ["pass quantity", "pass_quantity", "passquantity", "pass"]));
    const failQuantity = parseInteger(rowValue(row, ["fail quantity", "fail_quantity", "failquantity", "fail"]));
    const qualityRule = getQualityRuleByEmployee(employee);
    const weekRange = yearReference && weekNumber ? getIsoWeekDateRange(yearReference, weekNumber) : null;
    const expandedDates = weekRange ? datesInRange(weekRange.start, weekRange.end).map(formatDateKey) : [];
    const uniqueKey = yearReference && weekNumber && wbLogin ? `${wbLogin}|${yearReference}-W${String(weekNumber).padStart(2, "0")}` : "";

    if (!yearReference) errors.push("Ano de referência não informado.");
    if (!wbLogin) errors.push("WB/Login é obrigatório.");
    else if (!employee) errors.push("WB/Login não encontrado no cadastro.");
    else if (qualityRule !== "CEC_QUALITY") warnings.push("Agente não está cadastrado como CEC. Verifique se este arquivo pertence à operação correta.");
    if (!weekNumber) errors.push("Week inválida.");
    if (passQuantity === null || passQuantity < 0) errors.push("Pass Quantity inválido.");
    if (failQuantity === null || failQuantity < 0) errors.push("Fail Quantity inválido.");
    if ((passQuantity ?? 0) + (failQuantity ?? 0) === 0) warnings.push("Pass + Fail = 0; qualidade ficará sem base no cálculo.");
    if (uniqueKey) {
      const first = seen.get(uniqueKey);
      if (first) warnings.push(`Duplicidade da mesma semana/agente no arquivo. Primeira ocorrência na linha ${first}; será tratada por upsert.`);
      else seen.set(uniqueKey, rowNumber);
    }

    return {
      rowNumber,
      type: "CEC_QUALITY",
      wbLogin,
      employeeId: employee?.id,
      employeeName: employee?.fullName,
      lob: employee?.lob?.name ?? "",
      lobId: employee?.lobId ?? undefined,
      date: weekRange ? `${formatDateKey(weekRange.start)} a ${formatDateKey(weekRange.end)}` : "",
      uniqueKey,
      action: errors.length ? "ignore" : "create",
      errors,
      warnings,
      payload: {
        yearReference,
        weekNumber,
        weekStartDate: weekRange ? formatDateKey(weekRange.start) : "",
        weekEndDate: weekRange ? formatDateKey(weekRange.end) : "",
        expandedDates,
        expandedCount: expandedDates.length,
        passQuantity,
        failQuantity
      }
    };
  });

  return markExistingCecQualityRows(previewRows);
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

export async function commitTnsQualityImport(actor: Actor, rows: PerformancePreviewRow[], fileName = "qualidade_tns.xlsx") {
  const user = await requireActiveUser(actor);
  requireImportPermission(user);
  return commitTnsQualityRows(user, rows, fileName);
}

export async function commitCecQualityImport(actor: Actor, rows: PerformancePreviewRow[], fileName = "qualidade_cec.xlsx") {
  const user = await requireActiveUser(actor);
  requireImportPermission(user);
  return commitCecQualityRows(user, rows, fileName);
}

async function commitQualityRows(user: AuthenticatedUser, rows: PerformancePreviewRow[], fileName = "qualidade.xlsx", batchId?: string) {
  const validRows = rows.filter((row) => row.type === "QUALITY" && !row.errors.length && row.employeeId && row.uniqueKey);
  if (!validRows.length) throw new PerformanceError("Não há linhas válidas para importar.", 400);
  const createdRows = validRows.length;
  const updatedRows = 0;
  const batch = await upsertImportBatch(user, "QUALITY", fileName, rows, validRows.length, createdRows, updatedRows, batchId);

  for (const chunk of chunks(validRows, 100)) {
    await prisma.qualityRecord.createMany({
      data: chunk.map((row) => ({
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
      }))
    });
  }
  if (!batchId) await auditImport(user.id, "QUALITY", batch.id, { fileName, rowsTotal: rows.length, rowsValid: validRows.length, createdRows, updatedRows });
  return { success: true, importedRows: validRows.length, createdRows, updatedRows, batchId: batch.id };
}

async function commitTnsQualityRows(user: AuthenticatedUser, rows: PerformancePreviewRow[], fileName = "qualidade_tns.xlsx", batchId?: string) {
  const validRows = rows.filter((row) => row.type === "TNS_QUALITY" && !row.errors.length && row.employeeId);
  if (!validRows.length) throw new PerformanceError("Não há linhas válidas para importar.", 400);
  const createdRows = validRows.length;
  const updatedRows = 0;
  const batch = await upsertImportBatch(user, "TNS_QUALITY", fileName, rows, validRows.length, createdRows, updatedRows, batchId);

  for (const chunk of chunks(validRows, 100)) {
    await prisma.tnsQualityRecord.createMany({
      data: chunk.map((row) => ({
        auditDate: parseDate(String(row.payload.auditDate))!,
        wbLogin: row.wbLogin,
        employeeId: row.employeeId,
        lobId: row.lobId ?? null,
        rawLob: String(row.payload.rawLob ?? "") || null,
        sampling: Number(row.payload.sampling ?? 0),
        mislabeled: Number(row.payload.mislabeled ?? 0),
        leakage: Number(row.payload.leakage ?? 0),
        falsePositive: Number(row.payload.falsePositive ?? 0),
        sourceKey: String(row.payload.sourceKey ?? row.uniqueKey ?? "") || null,
        importBatchId: batch.id
      }))
    });
  }
  if (!batchId) await auditImport(user.id, "TNS_QUALITY", batch.id, { fileName, rowsTotal: rows.length, rowsValid: validRows.length, createdRows, updatedRows });
  return { success: true, importedRows: validRows.length, createdRows, updatedRows, batchId: batch.id };
}

async function commitCecQualityRows(user: AuthenticatedUser, rows: PerformancePreviewRow[], fileName = "qualidade_cec.xlsx", batchId?: string) {
  const validRows = rows.filter((row) => row.type === "CEC_QUALITY" && !row.errors.length && row.employeeId && row.uniqueKey && Array.isArray(row.payload.expandedDates));
  if (!validRows.length) throw new PerformanceError("Não há linhas válidas para importar.", 400);
  const expandedRows = validRows.reduce((sum, row) => sum + (Array.isArray(row.payload.expandedDates) ? row.payload.expandedDates.length : 0), 0);
  const createdRows = validRows.filter((row) => row.action === "create").reduce((sum, row) => sum + (Array.isArray(row.payload.expandedDates) ? row.payload.expandedDates.length : 0), 0);
  const updatedRows = Math.max(0, expandedRows - createdRows);
  const batch = await upsertImportBatch(user, "CEC_QUALITY", fileName, rows, validRows.length, createdRows, updatedRows, batchId);

  for (const chunk of chunks(validRows, 50)) {
    const operations = chunk.flatMap((row) => {
      const weekNumber = Number(row.payload.weekNumber);
      const weekStartDate = parseDate(String(row.payload.weekStartDate))!;
      const weekEndDate = parseDate(String(row.payload.weekEndDate))!;
      const passQuantity = Number(row.payload.passQuantity ?? 0);
      const failQuantity = Number(row.payload.failQuantity ?? 0);
      const expandedDates = Array.isArray(row.payload.expandedDates) ? row.payload.expandedDates.map((date) => String(date)) : [];

      return expandedDates.map((date) => {
        const qualityDate = parseDate(date)!;
        return prisma.cecQualityRecord.upsert({
          where: { wbLogin_weekNumber_qualityDate: { wbLogin: row.wbLogin, weekNumber, qualityDate } },
          update: {
            employeeId: row.employeeId,
            weekStartDate,
            weekEndDate,
            passQuantity,
            failQuantity,
            lobId: row.lobId ?? null,
            importBatchId: batch.id,
            originalRowNumber: row.rowNumber
          },
          create: {
            wbLogin: row.wbLogin,
            employeeId: row.employeeId,
            weekNumber,
            weekStartDate,
            weekEndDate,
            qualityDate,
            passQuantity,
            failQuantity,
            lobId: row.lobId ?? null,
            importBatchId: batch.id,
            originalRowNumber: row.rowNumber
          }
        });
      });
    });
    await prisma.$transaction(operations);
  }
  if (!batchId) await auditImport(user.id, "CEC_QUALITY", batch.id, { fileName, rowsTotal: rows.length, rowsValid: validRows.length, expandedRows, createdRows, updatedRows });
  return { success: true, importedRows: expandedRows, createdRows, updatedRows, batchId: batch.id };
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
    headers: ["semana_inicio", "semana_fim", "agente", "wb_login", "status_colaborador", "lob_colaborador", "supervisor", "regra_qualidade_aplicada", "wfh_status", "wfh_monitoramento", "wfh_motivos", "submit_medio_dia", "submit_total", "dias_com_submit", "qualidade", "numerador_qualidade", "denominador_qualidade", "aht_segundos", "aht_formatado", "abs", "faltas", "faltas_injustificadas", "dias_escalados_validos"],
    rows: dashboard.ranking.flatMap((agent) => agent.weekly.map((week) => {
      return [
        week.weekStart,
        week.weekEnd,
        agent.employeeName,
        agent.wbLogin,
        agent.employeeStatus,
        agent.lob,
        agent.supervisor,
        week.qualityRule,
        agent.wfhStatusLabel,
        agent.wfhMonitoringLabel,
        agent.wfhReasons.join("; "),
        week.submit,
        week.submitTotal,
        week.submitDays,
        `${week.quality}%`,
        week.qualityNumerator,
        week.qualityDenominator,
        week.ahtSeconds,
        formatAht(week.ahtSeconds),
        `${week.abs}%`,
        week.absences,
        week.unjustifiedAbsences,
        week.scheduledDays
      ];
    }))
  };
}

export function performanceTemplate(type: "quality" | "tns-quality" | "cec-quality" | "production"): XlsxExportPayload {
  if (type === "quality") {
    return {
      fileName: "template_performance_qualidade.xlsx",
      sheetName: "qualidade",
      headers: ["audit_time", "audit_name", "final_result", "质检case_order_id", "audit_case_order_id", "LOB", "Concat"],
      rows: []
    };
  }
  if (type === "tns-quality") {
    return {
      fileName: "template_performance_qualidade_tns.xlsx",
      sheetName: "qualidade_tns",
      headers: ["audit_date", "wb_login", "LOB", "Sampling", "Mislabeled", "Leakage", "False Positive", "source_key"],
      rows: []
    };
  }
  if (type === "cec-quality") {
    return {
      fileName: "template_performance_qualidade_cec.xlsx",
      sheetName: "Planilha1",
      headers: ["WB", "Week", "Pass Quantity", "Fail Quantity"],
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

export function getQualityRuleByEmployee(employee?: { lob?: { name?: string | null } | null } | null): QualityRule {
  const lobName = employee?.lob?.name?.trim().toLowerCase();
  if (!lobName) return "UNKNOWN";
  if (lobName === "ads") return "ADS_QUALITY";
  if (["tns", "video", "comments"].includes(lobName)) return "TNS_QUALITY";
  if (lobName === "cec") return "CEC_QUALITY";
  return "UNKNOWN";
}

function summarizeQualityRule(rules: QualityRule[]): QualityRule {
  const meaningful = unique(rules.filter((rule) => rule !== "UNKNOWN"));
  if (!meaningful.length) return "UNKNOWN";
  return meaningful.length === 1 ? meaningful[0] : "MIXED";
}

function buildPerformanceEmployeeStatusWhere(filter?: string): Prisma.EmployeeProfileWhereInput | null {
  const status = normalizeEmployeeStatusFilter(filter);
  if (!status) {
    return {
      NOT: {
        OR: [
          { operationalStatus: { equals: "Desligado", mode: "insensitive" } },
          { operationalStatus: { equals: "Desligada", mode: "insensitive" } },
          { operationalStatus: { equals: "DESLIGADO", mode: "insensitive" } },
          { operationalStatus: { equals: "DESLIGADA", mode: "insensitive" } }
        ]
      }
    };
  }
  const values = status === "Ativo"
    ? ["Ativo", "ATIVO", "ACTIVE", "Online", "ONLINE", "Aprovado", "APROVADO"]
    : status === "Afastado"
      ? ["Afastado", "AFASTADO"]
      : ["Desligado", "DESLIGADO", "Desligada", "DESLIGADA"];
  return { OR: values.map((value) => ({ operationalStatus: { equals: value, mode: "insensitive" } })) };
}

function normalizeEmployeeStatusFilter(filter?: string) {
  const value = filter?.trim();
  if (!value || value === "Todos" || value === "ALL") return "";
  const token = normalizeTextToken(value);
  if (["ativo", "active"].includes(token)) return "Ativo";
  if (["afastado", "away", "leave"].includes(token)) return "Afastado";
  if (["desligado", "desligada", "terminated"].includes(token)) return "Desligado";
  return "";
}

function displayPerformanceEmployeeStatus(status?: string | null) {
  const raw = status?.trim() ?? "";
  if (!raw) return "";
  const token = normalizeTextToken(raw);
  if (["active", "ativo", "ativa", "online", "aprovado", "aprovada"].includes(token)) return "Ativo";
  if (["afastado"].includes(token)) return "Afastado";
  if (["desligado", "desligada", "terminated"].includes(token)) return "Desligado";
  return raw;
}

function isOperationallyTerminated(status?: string | null) {
  const token = normalizeTextToken(status ?? "");
  return ["desligado", "desligada", "terminated"].includes(token);
}

function isUnjustifiedAbsenceRecord(record: Pick<AttendanceRecordForMetrics, "status" | "isJustified" | "reasonClassification">) {
  const status = String(record.status);
  const classification = record.reasonClassification?.trim().toUpperCase();
  if (classification === "UNJUSTIFIED") return true;
  return ["FALTA", "AUSENTE"].includes(status) && !record.isJustified;
}

function shouldShowEmployeeForPerformancePeriod(employee: { terminationDate?: Date | null }, referenceDate?: Date | null) {
  if (!referenceDate || !employee.terminationDate) return true;
  return formatDateKey(referenceDate) < formatDateKey(employee.terminationDate);
}

function normalizeWfhStatusFilter(filter?: string): WfhEligibilityStatus | "" {
  const value = filter?.trim();
  if (!value || value === "Todos" || value === "ALL") return "";
  const token = normalizeTextToken(value);
  if (["qualified", "qualificado", "qualificado_para_home"].includes(token)) return "QUALIFIED";
  if (["pending_validation", "aguardando_validacao", "aguardando_validação"].includes(token)) return "PENDING_VALIDATION";
  if (["not_qualified", "not-qualified", "nao_qualificado", "nao-qualificado", "não_qualificado", "não-qualificado", "naoqualificado", "nãoqualificado", "nao_qualificado_para_home", "não_qualificado_para_home"].includes(token)) return "NOT_QUALIFIED";
  if (["insufficient_data", "dados_insuficientes"].includes(token)) return "INSUFFICIENT_DATA";
  if (["not_applicable", "na", "n_a", "nao_aplicavel", "não_aplicavel"].includes(token)) return "NOT_APPLICABLE";
  return "";
}

function normalizeTextToken(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, "_");
}

async function listPerformanceEmployees(query: PerformanceQuery = {}, options: { defaultAgentsOnly?: boolean } = {}, referenceDate?: Date) {
  const where: Prisma.EmployeeProfileWhereInput = { deletedAt: null };
  const and: Prisma.EmployeeProfileWhereInput[] = [];
  const batch = parseWbLoginBatch(query.wbLogins ?? "");
  if (options.defaultAgentsOnly && (!query.role || query.role === "Todos")) {
    and.push({ OR: agentRoleTitleAliases.map((roleTitle) => ({ roleTitle: { equals: roleTitle, mode: "insensitive" } })) });
  } else if (query.role && query.role !== "Todos") {
    and.push({ roleTitle: { equals: query.role, mode: "insensitive" } });
  }
  const identityFilters: Prisma.EmployeeProfileWhereInput[] = [];
  if (query.employeeId && query.employeeId !== "Todos") identityFilters.push({ id: query.employeeId });
  if (batch.normalizedValues.length) identityFilters.push({ OR: batch.normalizedValues.map((wbLogin) => ({ wbLogin: { equals: wbLogin, mode: "insensitive" } })) });
  if (identityFilters.length === 1) and.push(identityFilters[0]);
  else if (identityFilters.length > 1) and.push({ OR: identityFilters });
  if (query.lob && query.lob !== "Todos") and.push({ lob: { name: { equals: query.lob, mode: "insensitive" } } });
  if (query.supervisorId && query.supervisorId !== "Todos") {
    and.push(query.supervisorId === "SEM_SUPERVISOR" ? { supervisorId: null } : { supervisorId: query.supervisorId });
  }
  if (query.skill && query.skill !== "Todos") and.push(query.skill === "SEM_SKILL" ? { OR: [{ skill: null }, { skill: "" }] } : { skill: { equals: query.skill, mode: "insensitive" } });
  const employeeStatusWhere = buildPerformanceEmployeeStatusWhere(query.employeeStatus);
  if (employeeStatusWhere) and.push(employeeStatusWhere);
  if (referenceDate && normalizeEmployeeStatusFilter(query.employeeStatus) !== "Desligado") and.push({ OR: [{ terminationDate: null }, { terminationDate: { gt: referenceDate } }] });
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
  const shouldApplyTerminationCutoff = normalizeEmployeeStatusFilter(query.employeeStatus) !== "Desligado";
  const dateFilteredEmployees = shouldApplyTerminationCutoff ? employees.filter((employee) => shouldShowEmployeeForPerformancePeriod(employee, referenceDate)) : employees;
  return options.defaultAgentsOnly && (!query.role || query.role === "Todos") ? dateFilteredEmployees.filter((employee) => isAgentJobTitle(employee.roleTitle)) : dateFilteredEmployees;
}

async function getPerformanceFilterOptions(referenceDate?: Date) {
  const employees = await prisma.employeeProfile.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      fullName: true,
      wbLogin: true,
      roleTitle: true,
      skill: true,
      operationalStatus: true,
      terminationDate: true,
      lob: { select: { name: true } },
      supervisor: { select: { id: true, fullName: true } }
    },
    orderBy: { fullName: "asc" }
  });
  const agents = employees.filter((employee) => isAgentJobTitle(employee.roleTitle) && !isOperationallyTerminated(employee.operationalStatus) && shouldShowEmployeeForPerformancePeriod(employee, referenceDate));
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

async function resolveBatchWbInfo(input?: PerformanceQuery["wbLogins"]) {
  const parsed = parseWbLoginBatch(input ?? "");
  if (!parsed.normalizedValues.length) {
    return { applied: [] as string[], notFound: [] as string[], duplicatesRemoved: parsed.duplicatesRemoved };
  }
  const records = await prisma.employeeProfile.findMany({
    where: {
      deletedAt: null,
      OR: parsed.normalizedValues.map((wbLogin) => ({ wbLogin: { equals: wbLogin, mode: "insensitive" as const } }))
    },
    select: { wbLogin: true }
  });
  const foundByNormalized = new Map(records.map((record) => [normalizeWbLogin(record.wbLogin), record.wbLogin]));
  return {
    applied: parsed.normalizedValues.map((value) => foundByNormalized.get(value)).filter((value): value is string => Boolean(value)),
    notFound: parsed.values.filter((value) => !foundByNormalized.has(normalizeWbLogin(value))),
    duplicatesRemoved: parsed.duplicatesRemoved
  };
}

async function buildAgentRows(employees: PerformanceEmployee[], period: Period) {
  if (!employees.length) return [];
  const employeeIds = employees.map((employee) => employee.id);
  const [qualityRecords, tnsQualityRecords, cecQualityRecords, productionRecords, schedules, attendanceRecords] = await Promise.all([
    prisma.qualityRecord.findMany({
      where: { employeeId: { in: employeeIds }, auditDate: { gte: period.start, lte: period.end } },
      select: qualityMetricSelect
    }),
    prisma.tnsQualityRecord.findMany({
      where: { employeeId: { in: employeeIds }, auditDate: { gte: period.start, lte: period.end } },
      select: tnsQualityMetricSelect
    }),
    prisma.cecQualityRecord.findMany({
      where: { employeeId: { in: employeeIds }, qualityDate: { gte: period.start, lte: period.end } },
      select: cecQualityMetricSelect
    }),
    prisma.productionRecord.findMany({
      where: { employeeId: { in: employeeIds }, bzDay: { gte: period.start, lte: period.end } },
      select: productionMetricSelect
    }),
    prisma.schedule.findMany({
      where: { employeeId: { in: employeeIds }, date: { gte: period.start, lte: period.end }, deletedAt: null },
      select: scheduleMetricSelect
    }),
    prisma.attendanceRecord.findMany({
      where: { employeeId: { in: employeeIds }, date: { gte: period.start, lte: period.end } },
      select: attendanceMetricSelect
    })
  ]);

  const periodSubmitDays = countDistinctProductionDays(productionRecords, period);
  const weeks = weeksInPeriod(period);
  const submitDaysByWeekStart = new Map(weeks.map((week) => [formatDateKey(week.start), countDistinctProductionDays(productionRecords, week)]));
  return employees.map((employee) => {
    const qualityRule = getQualityRuleByEmployee(employee);
    const weekly = weeks.map((week) => buildWeeklyMetrics(employee.id, week, submitDaysByWeekStart.get(formatDateKey(week.start)) ?? 0, qualityRule, qualityRecords, tnsQualityRecords, cecQualityRecords, productionRecords, schedules, attendanceRecords));
    const employeeQualityRecords = qualityRecords.filter((record) => record.employeeId === employee.id);
    const employeeTnsQualityRecords = tnsQualityRecords.filter((record) => record.employeeId === employee.id);
    const employeeCecQualityRecords = cecQualityRecords.filter((record) => record.employeeId === employee.id);
    const periodMetrics = {
      ...summarizeWeeklyRows(weekly, period),
      ...calculateQualityByRule(qualityRule, employeeQualityRecords, employeeTnsQualityRecords, employeeCecQualityRecords)
    };
    const wfhQualification = calculateWfhStatus(
      {
        lob: employee.lob?.name ?? "",
        admissionDate: employee.admissionDate,
        hasDisciplinaryIncidentData: false,
        hasSlaData: false,
        hasCurrentWfhStatusData: false
      },
      periodMetrics,
      weekly,
      period.end
    );
    return {
      employeeId: employee.id,
      employeeName: employee.fullName,
      wbLogin: employee.wbLogin,
      lob: employee.lob?.name ?? "Sem LOB",
      supervisor: employee.supervisor?.fullName ?? "Sem supervisor",
      roleTitle: employee.roleTitle,
      skill: employee.skill ?? "",
      employeeStatus: displayPerformanceEmployeeStatus(employee.operationalStatus),
      weekly,
      ...wfhQualification,
      ...periodMetrics,
      submitDays: periodSubmitDays,
      submitAveragePerDay: periodMetrics.submit
    };
  });
}

function buildWeeklyMetrics(employeeId: string, week: WeekRange, uploadedDaysCount: number, qualityRule: QualityRule, qualityRecords: QualityRecordForMetrics[], tnsQualityRecords: TnsQualityRecordForMetrics[], cecQualityRecords: CecQualityRecordForMetrics[], productionRecords: ProductionRecordForMetrics[], schedules: ScheduleRecordForMetrics[], attendanceRecords: AttendanceRecordForMetrics[]): WeeklyMetricRow {
  const weekQualityRecords: QualityRecordForMetrics[] = [];
  const weekTnsQualityRecords: TnsQualityRecordForMetrics[] = [];
  const weekCecQualityRecords: CecQualityRecordForMetrics[] = [];
  let submitTotal = 0;
  let moderationSeconds = 0;
  let absences = 0;
  const unjustifiedAbsenceDates = new Set<string>();
  let scheduledDays = 0;
  for (const record of qualityRecords) {
    if (record.employeeId !== employeeId || !isDateInRange(record.auditDate, week.start, week.end)) continue;
    weekQualityRecords.push(record);
  }
  for (const record of tnsQualityRecords) {
    if (record.employeeId !== employeeId || !isDateInRange(record.auditDate, week.start, week.end)) continue;
    weekTnsQualityRecords.push(record);
  }
  for (const record of cecQualityRecords) {
    if (record.employeeId !== employeeId || !isDateInRange(record.qualityDate, week.start, week.end)) continue;
    weekCecQualityRecords.push(record);
  }
  for (const record of productionRecords) {
    if (record.employeeId !== employeeId || !isDateInRange(record.bzDay, week.start, week.end)) continue;
    submitTotal += record.submitNum;
    moderationSeconds += record.moderationSeconds;
  }
  for (const schedule of schedules) {
    if (schedule.employeeId !== employeeId || !isDateInRange(schedule.date, week.start, week.end)) continue;
    if (scheduledStatuses.has(schedule.status)) scheduledDays += 1;
    if (absenceStatuses.has(schedule.status)) absences += 1;
    if (schedule.status === "FALTA_INJUSTIFICADA") unjustifiedAbsenceDates.add(formatDateKey(schedule.date));
  }
  for (const record of attendanceRecords) {
    if (record.employeeId !== employeeId || !isDateInRange(record.date, week.start, week.end)) continue;
    if (isUnjustifiedAbsenceRecord(record)) unjustifiedAbsenceDates.add(formatDateKey(record.date));
  }
  return {
    weekStart: formatDateKey(week.start),
    weekEnd: formatDateKey(week.end),
    weekLabel: `${formatDisplayDate(week.start)} a ${formatDisplayDate(week.end)}`,
    ...calculateQualityByRule(qualityRule, weekQualityRecords, weekTnsQualityRecords, weekCecQualityRecords),
    submit: calculateDailySubmit(submitTotal, week.start, week.end, uploadedDaysCount).submitAveragePerDay,
    submitTotal,
    submitDays: uploadedDaysCount,
    moderationSeconds: round2(moderationSeconds),
    ahtSeconds: submitTotal > 0 ? round2(moderationSeconds / submitTotal) : 0,
    absences,
    unjustifiedAbsences: unjustifiedAbsenceDates.size,
    scheduledDays,
    abs: percent(absences, scheduledDays)
  };
}

function summarizeRows(rows: AgentPerformanceRow[], period: Period) {
  const qualityNumerator = rows.reduce((sum, row) => sum + row.qualityNumerator, 0);
  const qualityDenominator = rows.reduce((sum, row) => sum + row.qualityDenominator, 0);
  const submitTotal = rows.reduce((sum, row) => sum + row.submitTotal, 0);
  const submitDays = rows.reduce((max, row) => Math.max(max, row.submitDays), 0);
  const moderationSeconds = rows.reduce((sum, row) => sum + row.moderationSeconds, 0);
  const absences = rows.reduce((sum, row) => sum + row.absences, 0);
  const unjustifiedAbsences = rows.reduce((sum, row) => sum + row.unjustifiedAbsences, 0);
  const scheduledDays = rows.reduce((sum, row) => sum + row.scheduledDays, 0);
  const qualityRule = summarizeQualityRule(rows.map((row) => row.qualityRule));
  const submit = calculateDailySubmit(submitTotal, period.start, period.end, submitDays);
  return {
    qualityRule,
    qualityNumerator,
    qualityDenominator,
    qualityErrors: rows.reduce((sum, row) => sum + row.qualityErrors, 0),
    qualityCorrect: qualityNumerator,
    qualityTotal: qualityDenominator,
    quality: percent(qualityNumerator, qualityDenominator),
    submit: submit.submitAveragePerDay,
    submitTotal,
    submitDays,
    moderationSeconds: round2(moderationSeconds),
    ahtSeconds: submitTotal > 0 ? round2(moderationSeconds / submitTotal) : 0,
    absences,
    unjustifiedAbsences,
    scheduledDays,
    abs: percent(absences, scheduledDays)
  };
}

function calculateQualityByRule(qualityRule: QualityRule, adsRecords: QualityRecordForMetrics[], tnsRecords: TnsQualityRecordForMetrics[], cecRecords: CecQualityRecordForMetrics[] = []) {
  if (qualityRule === "ADS_QUALITY") return calculateAdsQuality(adsRecords);
  if (qualityRule === "TNS_QUALITY") return calculateTnsQuality(tnsRecords);
  if (qualityRule === "CEC_QUALITY") return calculateCecQuality(cecRecords);
  return emptyQualityMetrics(qualityRule);
}

function calculateAdsQuality(records: QualityRecordForMetrics[]) {
  const totalConcatKeys = new Set<string>();
  const correctConcatKeys = new Set<string>();
  for (const record of records) {
    const concatKey = qualityTaskKey(record);
    if (!concatKey) continue;
    totalConcatKeys.add(concatKey);
    if (isCorrectQualityResult(record.finalResult)) correctConcatKeys.add(concatKey);
  }
  const qualityNumerator = correctConcatKeys.size;
  const qualityDenominator = totalConcatKeys.size;
  return {
    qualityRule: "ADS_QUALITY" as const,
    qualityNumerator,
    qualityDenominator,
    qualityErrors: Math.max(0, qualityDenominator - qualityNumerator),
    qualityCorrect: qualityNumerator,
    qualityTotal: qualityDenominator,
    quality: percent(qualityNumerator, qualityDenominator)
  };
}

function calculateTnsQuality(records: TnsQualityRecordForMetrics[]) {
  const sampling = records.reduce((sum, record) => sum + record.sampling, 0);
  const errors = records.reduce((sum, record) => sum + record.mislabeled + record.leakage + record.falsePositive, 0);
  const numerator = Math.max(0, sampling - errors);
  return {
    qualityRule: "TNS_QUALITY" as const,
    qualityNumerator: numerator,
    qualityDenominator: sampling,
    qualityErrors: errors,
    qualityCorrect: numerator,
    qualityTotal: sampling,
    quality: percent(numerator, sampling)
  };
}

function calculateCecQuality(records: CecQualityRecordForMetrics[]) {
  const pass = records.reduce((sum, record) => sum + record.passQuantity, 0);
  const fail = records.reduce((sum, record) => sum + record.failQuantity, 0);
  const total = pass + fail;
  return {
    qualityRule: "CEC_QUALITY" as const,
    qualityNumerator: pass,
    qualityDenominator: total,
    qualityErrors: fail,
    qualityCorrect: pass,
    qualityTotal: total,
    quality: percent(pass, total)
  };
}

function emptyQualityMetrics(qualityRule: QualityRule = "UNKNOWN") {
  return {
    qualityRule,
    qualityNumerator: 0,
    qualityDenominator: 0,
    qualityErrors: 0,
    qualityCorrect: 0,
    qualityTotal: 0,
    quality: 0
  };
}

function qualityTaskKey(record: Pick<QualityRecordForMetrics, "caseOrderId" | "auditCaseOrderId" | "concatKey">) {
  return buildQualityTaskKey(record.caseOrderId, record.auditCaseOrderId) || record.concatKey?.trim() || "";
}

function buildQualityTaskKey(caseOrderId?: string | null, auditCaseOrderId?: string | null) {
  const caseKey = caseOrderId?.trim();
  const auditKey = auditCaseOrderId?.trim();
  return caseKey && auditKey ? `${caseKey}${auditKey}` : "";
}

function isCorrectQualityResult(value?: string | null) {
  return value?.trim().toLowerCase() === "correct";
}

function summarizeWeeklyRows(rows: WeeklyMetricRow[], period?: Period): PerformanceMetrics {
  const qualityNumerator = rows.reduce((sum, row) => sum + row.qualityNumerator, 0);
  const qualityDenominator = rows.reduce((sum, row) => sum + row.qualityDenominator, 0);
  const submitTotal = rows.reduce((sum, row) => sum + row.submitTotal, 0);
  const submitDays = period
    ? rows.reduce((sum, row) => sum + row.submitDays, 0)
    : rows.reduce((max, row) => Math.max(max, row.submitDays), 0);
  const moderationSeconds = rows.reduce((sum, row) => sum + row.moderationSeconds, 0);
  const absences = rows.reduce((sum, row) => sum + row.absences, 0);
  const unjustifiedAbsences = rows.reduce((sum, row) => sum + row.unjustifiedAbsences, 0);
  const scheduledDays = rows.reduce((sum, row) => sum + row.scheduledDays, 0);
  const qualityRule = summarizeQualityRule(rows.map((row) => row.qualityRule));
  const range = period ?? weeklyRowsPeriod(rows);
  const submit = range ? calculateDailySubmit(submitTotal, range.start, range.end, submitDays) : { submitAveragePerDay: 0, daysCount: 0 };
  return {
    qualityRule,
    qualityNumerator,
    qualityDenominator,
    qualityErrors: rows.reduce((sum, row) => sum + row.qualityErrors, 0),
    qualityCorrect: qualityNumerator,
    qualityTotal: qualityDenominator,
    quality: percent(qualityNumerator, qualityDenominator),
    submit: submit.submitAveragePerDay,
    submitTotal,
    submitDays,
    moderationSeconds: round2(moderationSeconds),
    ahtSeconds: submitTotal > 0 ? round2(moderationSeconds / submitTotal) : 0,
    absences,
    unjustifiedAbsences,
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

function countDistinctProductionDays(records: ProductionRecordForMetrics[], period: Period) {
  const dates = new Set<string>();
  for (const record of records) {
    if (!isDateInRange(record.bzDay, period.start, period.end)) continue;
    dates.add(formatDateKey(record.bzDay));
  }
  return dates.size;
}

export function calculateDailySubmit(totalSubmit: number, startDate: Date, endDate: Date, uploadedDaysCount?: number) {
  const safeTotal = Number.isFinite(Number(totalSubmit)) ? Number(totalSubmit) : 0;
  const normalizedUploadedDays = Number(uploadedDaysCount);
  const daysCount = Number.isFinite(normalizedUploadedDays) && normalizedUploadedDays > 0
    ? Math.floor(normalizedUploadedDays)
    : daysInPeriod({ start: startDate, end: endDate });
  return {
    submitAveragePerDay: daysCount > 0 ? round2(safeTotal / daysCount) : 0,
    daysCount
  };
}

function weeklyRowsPeriod(rows: WeeklyMetricRow[]): Period | null {
  const starts = rows.map((row) => parseDate(row.weekStart)).filter((date): date is Date => Boolean(date));
  const ends = rows.map((row) => parseDate(row.weekEnd)).filter((date): date is Date => Boolean(date));
  if (!starts.length || !ends.length) return null;
  return {
    start: new Date(Math.min(...starts.map((date) => date.getTime()))),
    end: new Date(Math.max(...ends.map((date) => date.getTime())))
  };
}

function daysInPeriod(period: Period) {
  const start = Date.UTC(period.start.getUTCFullYear(), period.start.getUTCMonth(), period.start.getUTCDate());
  const end = Date.UTC(period.end.getUTCFullYear(), period.end.getUTCMonth(), period.end.getUTCDate());
  if (end < start) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}

function filterRowsByWfhStatus(rows: AgentPerformanceRow[], filter?: string) {
  const status = normalizeWfhStatusFilter(filter);
  if (!status) return rows;
  return rows.filter((row) => row.wfhStatus === status);
}

function sortAgentRows(rows: AgentPerformanceRow[], query: PerformanceQuery) {
  const sortBy = query.sortBy && ["quality", "submit", "aht", "abs"].includes(query.sortBy) ? query.sortBy : "quality";
  const direction = query.sortDirection === "asc" ? "asc" : "desc";
  const multiplier = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const aValue = sortablePerformanceValue(a, sortBy);
    const bValue = sortablePerformanceValue(b, sortBy);
    const aValid = Number.isFinite(aValue);
    const bValid = Number.isFinite(bValue);
    if (!aValid && !bValid) return a.employeeName.localeCompare(b.employeeName, "pt-BR");
    if (!aValid) return 1;
    if (!bValid) return -1;
    if (aValue !== bValue) return (aValue - bValue) * multiplier;
    return a.employeeName.localeCompare(b.employeeName, "pt-BR");
  });
}

function sortablePerformanceValue(row: AgentPerformanceRow, sortBy: PerformanceSortBy) {
  if (sortBy === "quality") return row.qualityDenominator > 0 ? row.quality : Number.NaN;
  if (sortBy === "aht") return row.submitTotal > 0 ? row.ahtSeconds : Number.NaN;
  if (sortBy === "abs") return row.scheduledDays > 0 ? row.abs : Number.NaN;
  return row[sortBy];
}

function emptyAgentRow(employee: PerformanceEmployee, period: Period): AgentPerformanceRow {
  const qualityRule = getQualityRuleByEmployee(employee);
  const weekly = weeksInPeriod(period).map((week) => ({
    weekStart: formatDateKey(week.start),
    weekEnd: formatDateKey(week.end),
    weekLabel: `${formatDisplayDate(week.start)} a ${formatDisplayDate(week.end)}`,
    ...emptyMetrics(qualityRule)
  }));
  return {
    employeeId: employee.id,
    employeeName: employee.fullName,
    wbLogin: employee.wbLogin,
    lob: employee.lob?.name ?? "Sem LOB",
    supervisor: employee.supervisor?.fullName ?? "Sem supervisor",
    roleTitle: employee.roleTitle,
    skill: employee.skill ?? "",
    employeeStatus: displayPerformanceEmployeeStatus(employee.operationalStatus),
    weekly,
    ...calculateWfhStatus(
      {
        lob: employee.lob?.name ?? "",
        admissionDate: employee.admissionDate,
        hasDisciplinaryIncidentData: false,
        hasSlaData: false,
        hasCurrentWfhStatusData: false
      },
      emptyMetrics(qualityRule),
      weekly,
      period.end
    ),
    ...emptyMetrics(qualityRule),
    submitAveragePerDay: 0
  };
}

function emptyMetrics(qualityRule: QualityRule = "UNKNOWN"): PerformanceMetrics {
  return { ...emptyQualityMetrics(qualityRule), submit: 0, submitTotal: 0, submitDays: 0, ahtSeconds: 0, moderationSeconds: 0, abs: 0, absences: 0, unjustifiedAbsences: 0, scheduledDays: 0 };
}

function hasAnyData(row: AgentPerformanceRow) {
  return row.qualityTotal > 0 || row.submitTotal > 0 || row.scheduledDays > 0;
}

async function markExistingQualityRows(previewRows: PerformancePreviewRow[]) {
  return buildPreviewResult(previewRows.map((row) => row.errors.length ? row : { ...row, action: "create" }));
}

async function markExistingTnsQualityRows(previewRows: PerformancePreviewRow[]) {
  return buildPreviewResult(previewRows.map((row) => row.errors.length ? row : { ...row, action: "create" }));
}

async function markExistingCecQualityRows(previewRows: PerformancePreviewRow[]) {
  const validRows = previewRows.filter((row) => !row.errors.length && row.wbLogin && Number(row.payload.weekNumber) && Array.isArray(row.payload.expandedDates));
  const existingKeys = new Set<string>();
  for (const chunk of chunks(validRows, 40)) {
    const existing = await prisma.cecQualityRecord.findMany({
      where: {
        OR: chunk.flatMap((row) => {
          const weekNumber = Number(row.payload.weekNumber);
          const expandedDates = Array.isArray(row.payload.expandedDates) ? row.payload.expandedDates.map((date) => String(date)) : [];
          return expandedDates.map((date) => ({ wbLogin: row.wbLogin, weekNumber, qualityDate: parseDate(date)! }));
        })
      },
      select: { wbLogin: true, weekNumber: true, qualityDate: true }
    });
    for (const row of existing) existingKeys.add(cecQualityExistingKey(row.wbLogin, row.weekNumber, row.qualityDate));
  }
  return buildPreviewResult(previewRows.map((row) => {
    if (row.errors.length) return row;
    const weekNumber = Number(row.payload.weekNumber);
    const expandedDates = Array.isArray(row.payload.expandedDates) ? row.payload.expandedDates.map((date) => String(date)) : [];
    const hasExisting = expandedDates.some((date) => existingKeys.has(cecQualityExistingKey(row.wbLogin, weekNumber, parseDate(date)!)));
    return { ...row, action: hasExisting ? "update" : "create" };
  }));
}

async function markExistingProductionRows(previewRows: PerformancePreviewRow[]) {
  const validKeys = unique(previewRows.filter((row) => !row.errors.length && row.uniqueKey).map((row) => row.uniqueKey));
  const existing = validKeys.length ? await prisma.productionRecord.findMany({ where: { productionKey: { in: validKeys } }, select: { productionKey: true } }) : [];
  const existingKeys = new Set(existing.map((row) => row.productionKey));
  return buildPreviewResult(previewRows.map((row) => row.errors.length ? row : { ...row, action: existingKeys.has(row.uniqueKey) ? "update" : "create" }));
}

async function upsertImportBatch(
  user: AuthenticatedUser,
  type: "QUALITY" | "TNS_QUALITY" | "CEC_QUALITY" | "PRODUCTION",
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
      expandedRows: rows.reduce((sum, row) => sum + (row.type === "CEC_QUALITY" && !row.errors.length ? Number(row.payload.expandedCount ?? 0) : 0), 0),
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
  const defaultPeriod = getDefaultDatePeriod();
  return {
    start: parseDate(query.startDate) ?? defaultPeriod.start,
    end: parseDate(query.endDate) ?? defaultPeriod.end
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

function getIsoWeekDateRange(year: number, weekNumber: number): WeekRange {
  const januaryFourth = utcDate(year, 1, 4);
  const weekOneStart = startOfWeekMonday(januaryFourth);
  const start = addDays(weekOneStart, (weekNumber - 1) * 7);
  return { start, end: addDays(start, 6) };
}

function datesInRange(start: Date, end: Date) {
  const dates: Date[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) dates.push(cursor);
  return dates;
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

function parseWeekNumber(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const match = raw.match(/\d{1,2}/);
  const parsed = match ? Number(match[0]) : Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 53 ? parsed : null;
}

function normalizeYearReference(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : null;
}

function nullableNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cecQualityExistingKey(wbLogin: string, weekNumber: number, qualityDate: Date) {
  return `${normalizeWbLogin(wbLogin)}|${weekNumber}|${formatDateKey(qualityDate)}`;
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}
