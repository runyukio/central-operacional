import crypto from "node:crypto";

import { AuditAction, Prisma, type ScheduleStatus } from "@prisma/client";

import type { Actor } from "@/lib/mock-db";
import {
  canAccessPerformance,
  canAccessPerformanceFramework,
  canAccessPerformanceWfh,
  canExportPerformance,
  canImportPerformance,
  normalizeRole
} from "@/lib/permissions";
import { isAgentJobTitle } from "@/lib/job-title-normalization";
import { parseWbLoginBatch } from "@/lib/batch-wb-filter";
import { getDefaultDatePeriod } from "@/lib/default-date-range";
import { prisma } from "@/lib/prisma";
import { QUEUE_METADATA, type QueueLob, type QueueMetadata } from "@/lib/queue-metadata";
import { QUEUE_REPORT_METADATA, getQueueReportMetadataById } from "@/lib/queue-report-metadata";
import { getQueueMetadataById, getQueueNameById } from "@/lib/queue-dictionary";
import { calculateWfhStatus, type WfhEligibilityStatus, type WfhMonitoringStatus } from "@/lib/wfh-rules";
import type { XlsxExportPayload } from "@/lib/xlsx-export";
import { calculateAbsenceRate, isAbsenceStatus, isScheduledStatus } from "@/lib/attendance-calculation";

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
type PerformanceProductionGranularity = "hourly" | "daily" | "weekly" | "monthly";

export type PerformanceQuery = {
  view?: "mine" | "wfh" | "framework";
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
  granularity?: PerformanceProductionGranularity;
  slaTargetMinutes?: number;
  metadataOnly?: boolean;
};

export type PerformanceQualityQuery = {
  startDate?: string;
  endDate?: string;
  view?: "monthly" | "weekly" | "daily";
  sortDirection?: "asc" | "desc";
};

export type PerformanceAgentsQuery = {
  view?: "monthly" | "weekly" | "daily";
  startDate?: string;
  endDate?: string;
  lob?: string;
  supervisorId?: string;
  shiftId?: string;
  search?: string;
  sortBy?: "employeeName" | "wbLogin" | "lob" | "supervisor" | "shift" | "submit" | "aht";
  sortDirection?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  metadataOnly?: boolean;
};

export type PerformanceSupervisorsQuery = {
  view?: "monthly" | "weekly" | "daily";
};

type ProductionRecordForDashboard = Prisma.ProductionRecordGetPayload<{
  select: {
    bzTime: true;
    bzDay: true;
    wbLogin: true;
    employeeId: true;
    submitNum: true;
    latencyMinutesSum: true;
    moderationSeconds: true;
    queueId: true;
    employee: {
      select: {
        fullName: true;
        wbLogin: true;
        roleTitle: true;
        skill: true;
        operationalStatus: true;
        lob: { select: { name: true } };
        supervisor: { select: { fullName: true } };
      };
    };
  };
}>;

type QueueVolumeRecordForDashboard = Prisma.PerformanceQueueVolumeRecordGetPayload<{
  select: {
    bzTime: true;
    bzDay: true;
    queueId: true;
    inputCount: true;
  };
}>;

type ProductionDashboardAggregate = {
  input: number;
  submit: number;
  moderationSeconds: number;
  latencyMinutesSum: number;
  records: number;
};

type ProductionDashboardAgentAggregate = ProductionDashboardAggregate & {
  employeeId: string;
  employeeName: string;
  wbLogin: string;
  cadastroLob: string;
  queueLobs: Set<string>;
  supervisor: string;
  roleTitle: string;
  skill: string;
  status: string;
  queues: Set<string>;
};

type ProductionDashboardQueueAggregate = ProductionDashboardAggregate & {
  queueId: string;
  queueName: string;
  lob: string;
  slaTargetMinutes: number | null;
  agents: Set<string>;
};

export type PerformancePreviewRow = {
  rowNumber: number;
  type: "QUALITY" | "TNS_QUALITY" | "CEC_QUALITY" | "PRODUCTION" | "PRODUCTION_VOLUME";
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
  skipExistingCheck?: boolean;
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
  latencyMinutesSum: true,
  moderationSeconds: true,
  queueId: true,
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
const productionAgentHeaders = ["agentes", "agente", "agentname", "wb_login", "wb login"];
const productionTimeHeaders = ["bz_time", "bz time", "brasiltime/hour", "brasiltime hour", "br_time(hour)", "br time(hour)", "br_time", "br time"];
const productionVolumeTimeHeaders = ["bz_enqueue_time", "bz enqueue time", "bz_enqueue_time(hour)", ...productionTimeHeaders];
const productionDayHeaders = ["bz_day", "bz day"];
const productionVolumeDayHeaders = ["bz_enqueue_day", "bz enqueue day", ...productionDayHeaders];
const productionQueueHeaders = ["id-queue_id", "id_queue_id", "id queue id", "队列id-queue_id", "队列id", "queue_id", "queueid", "queue id", "fila", "queue"];
const productionInputHeaders = ["enqueue", "enqueue_num", "enqueue num", "input", "input_num", "input num", "进审量", "recebidos"];

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
  const view = role === "CLIENT" ? (query.view === "framework" ? "framework" : "wfh") : query.view ?? (role === "COLABORADOR" ? "mine" : "wfh");
  const period = resolvePeriod(query);

  if (view === "framework") {
    if (!canAccessPerformanceFramework(permissionUser(user))) throw new PerformanceError("Você não tem permissão para acessar Framework.", 403);
    return {
      mode: "framework" as const,
      period: periodPayload(period),
      ...(await buildPerformanceFramework(period.end))
    };
  }

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

export async function getPerformanceProductionDashboard(actor: Actor, query: PerformanceQuery = {}) {
  const user = await requireActiveUser(actor);
  if (!canAccessPerformance(permissionUser(user))) throw new PerformanceError("Você não tem permissão para acessar Performance.", 403);

  const role = normalizeRole(user.role.name);
  const productionPeriod = await resolveProductionDashboardPeriod(query);
  const ownEmployeeId = role === "COLABORADOR" ? requireOwnEmployee(user).id : null;
  const requestedLob = query.lob && query.lob !== "Todos" ? query.lob.toUpperCase() : "";
  const granularity = normalizeProductionGranularity(query.granularity);
  const panel = await buildProductionDashboardPanel(productionPeriod);
  const canImport = canImportPerformance(permissionUser(user));
  if (query.metadataOnly || (requestedLob && !performanceLobOptions().includes(requestedLob))) {
    return emptyProductionDashboardPayload(productionPeriod, granularity, panel, canImport);
  }

  const bucketSql = productionBucketSql(granularity);
  const queueSql = performanceQueueFilterSql(requestedLob, query.slaTargetMinutes);
  const employeeSql = ownEmployeeId ? Prisma.sql`AND "employeeId" = ${ownEmployeeId}` : Prisma.empty;
  const [productionTrendRows, volumeTrendRows, productionQueueRows, volumeQueueRows] = await Promise.all([
    prisma.$queryRaw<Array<{ bucket: Date; submit: number; moderationSeconds: number; latencyMinutesSum: number; records: number }>>(Prisma.sql`
      SELECT
        ${bucketSql} AS "bucket",
        COALESCE(SUM("submitNum"), 0)::double precision AS "submit",
        COALESCE(SUM("moderationSeconds"), 0)::double precision AS "moderationSeconds",
        COALESCE(SUM("latencyMinutesSum"), 0)::double precision AS "latencyMinutesSum",
        COUNT(*)::integer AS "records"
      FROM "ProductionRecord"
      WHERE "bzDay" >= ${productionPeriod.start}
        AND "bzDay" <= ${productionPeriod.end}
        ${employeeSql}
        ${queueSql}
      GROUP BY ${bucketSql}
      ORDER BY ${bucketSql} ASC
    `),
    ownEmployeeId ? Promise.resolve([]) : prisma.$queryRaw<Array<{ bucket: Date; input: number; records: number }>>(Prisma.sql`
      SELECT
        ${bucketSql} AS "bucket",
        COALESCE(SUM("inputCount"), 0)::double precision AS "input",
        COUNT(*)::integer AS "records"
      FROM "PerformanceQueueVolumeRecord"
      WHERE "bzDay" >= ${productionPeriod.start}
        AND "bzDay" <= ${productionPeriod.end}
        ${queueSql}
      GROUP BY ${bucketSql}
      ORDER BY ${bucketSql} ASC
    `),
    prisma.$queryRaw<Array<{ queueId: string; submit: number; moderationSeconds: number; latencyMinutesSum: number; records: number; agents: number }>>(Prisma.sql`
      SELECT
        "queueId",
        COALESCE(SUM("submitNum"), 0)::double precision AS "submit",
        COALESCE(SUM("moderationSeconds"), 0)::double precision AS "moderationSeconds",
        COALESCE(SUM("latencyMinutesSum"), 0)::double precision AS "latencyMinutesSum",
        COUNT(*)::integer AS "records",
        COUNT(DISTINCT COALESCE("employeeId", "wbLogin"))::integer AS "agents"
      FROM "ProductionRecord"
      WHERE "bzDay" >= ${productionPeriod.start}
        AND "bzDay" <= ${productionPeriod.end}
        ${employeeSql}
        ${queueSql}
      GROUP BY "queueId"
    `),
    ownEmployeeId ? Promise.resolve([]) : prisma.$queryRaw<Array<{ queueId: string; input: number; records: number }>>(Prisma.sql`
      SELECT
        "queueId",
        COALESCE(SUM("inputCount"), 0)::double precision AS "input",
        COUNT(*)::integer AS "records"
      FROM "PerformanceQueueVolumeRecord"
      WHERE "bzDay" >= ${productionPeriod.start}
        AND "bzDay" <= ${productionPeriod.end}
        ${queueSql}
      GROUP BY "queueId"
    `)
  ]);
  const trendMap = new Map<string, ProductionDashboardAggregate>();
  const queueMap = new Map<string, ProductionDashboardQueueAggregate & { agentCount: number }>();

  for (const row of productionTrendRows) {
    const bucket = productionBucket(row.bucket, granularity);
    const aggregate = ensureProductionAggregate(trendMap, bucket.key);
    aggregate.submit += Number(row.submit ?? 0);
    aggregate.moderationSeconds += Number(row.moderationSeconds ?? 0);
    aggregate.latencyMinutesSum += Number(row.latencyMinutesSum ?? 0);
    aggregate.records += Number(row.records ?? 0);
  }
  for (const row of volumeTrendRows) {
    const bucket = productionBucket(row.bucket, granularity);
    const aggregate = ensureProductionAggregate(trendMap, bucket.key);
    aggregate.input += Number(row.input ?? 0);
    aggregate.records += Number(row.records ?? 0);
  }
  for (const row of productionQueueRows) {
    const queueId = row.queueId || "Sem Fila ID";
    const metadata = getPerformanceQueueMetadataById(queueId);
    queueMap.set(queueId, {
      ...emptyProductionAggregate(),
      input: 0,
      submit: Number(row.submit ?? 0),
      moderationSeconds: Number(row.moderationSeconds ?? 0),
      latencyMinutesSum: Number(row.latencyMinutesSum ?? 0),
      records: Number(row.records ?? 0),
      queueId,
      queueName: getQueueNameById(queueId),
      lob: metadata.lob,
      slaTargetMinutes: metadata.slaTargetMinutes,
      agents: new Set(),
      agentCount: Number(row.agents ?? 0)
    });
  }
  for (const row of volumeQueueRows) {
    const queueId = row.queueId || "Sem Fila ID";
    const current = queueMap.get(queueId);
    if (current) {
      current.input += Number(row.input ?? 0);
      current.records += Number(row.records ?? 0);
      continue;
    }
    const metadata = getPerformanceQueueMetadataById(queueId);
    queueMap.set(queueId, {
      ...emptyProductionAggregate(),
      input: Number(row.input ?? 0),
      records: Number(row.records ?? 0),
      queueId,
      queueName: getQueueNameById(queueId),
      lob: metadata.lob,
      slaTargetMinutes: metadata.slaTargetMinutes,
      agents: new Set(),
      agentCount: 0
    });
  }

  const trend = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, aggregate]) => ({
      key,
      label: productionBucketLabel(key, granularity),
      ...serializeProductionSummary(aggregate)
    }));
  const summary = summarizeProductionDashboardAggregates(Array.from(trendMap.values()));
  const previousTrend = trend.length > 1 ? trend[trend.length - 2] : null;
  const currentTrend = trend.length ? trend[trend.length - 1] : null;

  const latestImport = await prisma.performanceImportBatch.findFirst({
    where: { type: "PRODUCTION" },
    orderBy: { importedAt: "desc" },
    select: { fileName: true, importedAt: true, rowsValid: true, status: true }
  });

  return {
    mode: "production" as const,
    canImport,
    granularity,
    period: periodPayload(productionPeriod),
    panel,
    filters: {
      lobs: performanceLobOptions()
    },
    summary: {
      ...serializeProductionSummary(summary),
      agents: 0,
      queues: queueMap.size,
      comparison: currentTrend && previousTrend ? buildProductionComparison(currentTrend, previousTrend) : null,
      lastImport: latestImport ? {
        fileName: latestImport.fileName,
        importedAt: formatDateTime(latestImport.importedAt),
        rowsValid: latestImport.rowsValid,
        status: latestImport.status
      } : null
    },
    trend,
    agents: [],
    queues: Array.from(queueMap.values())
      .map((aggregate) => ({
        queueId: aggregate.queueId,
        queueName: aggregate.queueName,
        lob: aggregate.lob,
        slaTargetMinutes: aggregate.slaTargetMinutes,
        agents: aggregate.agentCount,
        ...serializeProductionSummary(aggregate)
      }))
      .sort((a, b) => b.submit - a.submit)
      .slice(0, 250)
  };
}

export async function getPerformanceAdsQualityDashboard(actor: Actor, query: PerformanceQualityQuery = {}) {
  const user = await requireActiveUser(actor);
  if (!canAccessPerformance(permissionUser(user))) throw new PerformanceError("Você não tem permissão para acessar Performance.", 403);

  const view = query.view === "monthly" || query.view === "weekly" ? query.view : "daily";
  const sortDirection = query.sortDirection === "asc" ? "asc" : "desc";
  const sortDirectionSql = sortDirection === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const bucketSql = qualityBucketSql(view);
  const baseLobSql = Prisma.sql`AND UPPER(COALESCE(l."name", '')) IN ('ADS', 'PROJECT')`;
  const [range] = await prisma.$queryRaw<Array<{ startDate: Date | null; endDate: Date | null }>>(Prisma.sql`
    SELECT MIN(q."auditDate") AS "startDate", MAX(q."auditDate") AS "endDate"
    FROM "QualityRecord" q
    LEFT JOIN "EmployeeProfile" e ON e."id" = q."employeeId"
    LEFT JOIN "Lob" l ON l."id" = COALESCE(q."lobId", e."lobId")
    WHERE 1 = 1 ${baseLobSql}
  `);
  const fallback = getDefaultDatePeriod();
  const start = parseDate(query.startDate) ?? range?.startDate ?? fallback.start;
  const end = parseDate(query.endDate) ?? range?.endDate ?? fallback.end;
  if (start > end) throw new PerformanceError("A data inicial não pode ser posterior à data final.", 400);

  const scopedSql = Prisma.sql`
    FROM "QualityRecord" q
    LEFT JOIN "EmployeeProfile" e ON e."id" = q."employeeId"
    LEFT JOIN "Lob" l ON l."id" = COALESCE(q."lobId", e."lobId")
    LEFT JOIN "EmployeeProfile" s ON s."id" = e."supervisorId"
    WHERE q."auditDate" >= ${start}
      AND q."auditDate" <= ${end}
      ${baseLobSql}
  `;

  const [summaryRows, trendRows, agentRows, latestImport] = await Promise.all([
    prisma.$queryRaw<Array<{ total: number; correct: number }>>(Prisma.sql`
      SELECT
        COUNT(DISTINCT q."concatKey")::integer AS "total",
        COUNT(DISTINCT CASE WHEN LOWER(TRIM(q."finalResult")) = 'correct' THEN q."concatKey" END)::integer AS "correct"
      ${scopedSql}
    `),
    prisma.$queryRaw<Array<{ periodStart: Date; total: number; correct: number }>>(Prisma.sql`
      SELECT
        ${bucketSql} AS "periodStart",
        COUNT(DISTINCT q."concatKey")::integer AS "total",
        COUNT(DISTINCT CASE WHEN LOWER(TRIM(q."finalResult")) = 'correct' THEN q."concatKey" END)::integer AS "correct"
      ${scopedSql}
      GROUP BY ${bucketSql}
      ORDER BY ${bucketSql} ASC
    `),
    prisma.$queryRaw<Array<{
      employeeId: string;
      employeeName: string;
      wbLogin: string;
      lob: string;
      supervisor: string;
      total: number;
      correct: number;
      lastAuditAt: Date;
    }>>(Prisma.sql`
      SELECT
        q."employeeId" AS "employeeId",
        COALESCE(e."fullName", q."wbLogin") AS "employeeName",
        q."wbLogin" AS "wbLogin",
        'ADS' AS "lob",
        COALESCE(s."fullName", 'Sem supervisor') AS "supervisor",
        COUNT(DISTINCT q."concatKey")::integer AS "total",
        COUNT(DISTINCT CASE WHEN LOWER(TRIM(q."finalResult")) = 'correct' THEN q."concatKey" END)::integer AS "correct",
        MAX(q."auditTime") AS "lastAuditAt"
      ${scopedSql}
      AND q."employeeId" IS NOT NULL
      GROUP BY q."employeeId", e."fullName", q."wbLogin", s."fullName"
      ORDER BY
        (COUNT(DISTINCT CASE WHEN LOWER(TRIM(q."finalResult")) = 'correct' THEN q."concatKey" END)::double precision
          / NULLIF(COUNT(DISTINCT q."concatKey"), 0)) ${sortDirectionSql},
        COUNT(DISTINCT q."concatKey") DESC
      LIMIT 500
    `),
    prisma.performanceImportBatch.findFirst({
      where: { type: "QUALITY" },
      orderBy: { importedAt: "desc" },
      select: { fileName: true, importedAt: true, rowsValid: true, rowsError: true, status: true }
    })
  ]);

  const summary = summaryRows[0] ?? { total: 0, correct: 0 };
  return {
    mode: "quality" as const,
    canImport: canImportPerformance(permissionUser(user)),
    period: {
      startDate: formatDateKey(start),
      endDate: formatDateKey(end)
    },
    dataRange: range?.startDate && range.endDate ? {
      startDate: formatDateKey(range.startDate),
      endDate: formatDateKey(range.endDate)
    } : null,
    granularity: view,
    selectedLob: "ADS",
    filters: { lobs: ["ADS"] },
    summary: serializeQualityAggregate(summary.correct, summary.total),
    trend: trendRows.map((row) => ({
      key: formatDateKey(row.periodStart),
      label: qualityBucketLabel(row.periodStart, view),
      ...serializeQualityAggregate(row.correct, row.total)
    })),
    agents: agentRows.map((row) => ({
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      wbLogin: row.wbLogin,
      lob: "ADS",
      supervisor: row.supervisor,
      lastAuditAt: row.lastAuditAt.toISOString(),
      ...serializeQualityAggregate(row.correct, row.total)
    })),
    lastImport: latestImport ? {
      ...latestImport,
      importedAt: latestImport.importedAt.toISOString()
    } : null
  };
}

export async function getPerformanceAgentsDashboard(actor: Actor, query: PerformanceAgentsQuery = {}) {
  const user = await requireActiveUser(actor);
  if (!canAccessPerformance(permissionUser(user))) throw new PerformanceError("Você não tem permissão para acessar Performance.", 403);

  const role = normalizeRole(user.role.name);
  const ownEmployeeId = role === "COLABORADOR" ? requireOwnEmployee(user).id : null;
  const requestedLob = query.lob && query.lob !== "Todos" ? query.lob.trim().toUpperCase() : "";
  const validLobs = performanceLobOptions();
  const [range, employeeOptions] = await Promise.all([
    prisma.productionRecord.aggregate({ _min: { bzDay: true }, _max: { bzDay: true } }),
    prisma.employeeProfile.findMany({
      where: { deletedAt: null, ...(ownEmployeeId ? { id: ownEmployeeId } : {}) },
      select: {
        id: true,
        shift: { select: { id: true, name: true } },
        supervisor: { select: { id: true, fullName: true } }
      }
    })
  ]);
  const view = normalizeDashboardView(query.view);
  const fallback = getDefaultDatePeriod();
  const referenceDate = range._max.bzDay ?? fallback.end;
  const defaultPeriod = dashboardViewPeriod(referenceDate, view);
  const start = parseDate(query.startDate) ?? defaultPeriod.start;
  const end = parseDate(query.endDate) ?? defaultPeriod.end;
  if (start > end) throw new PerformanceError("A data inicial não pode ser posterior à data final.", 400);

  const supervisors = uniqueBy(
    employeeOptions.flatMap((employee) => employee.supervisor ? [employee.supervisor] : []),
    (item) => item.id
  ).sort((a, b) => a.fullName.localeCompare(b.fullName, "pt-BR"));
  const shifts = uniqueBy(
    employeeOptions.map((employee) => employee.shift),
    (item) => item.id
  ).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const filters = { lobs: validLobs, supervisors, shifts };
  const dataRange = range._min.bzDay && range._max.bzDay
    ? { startDate: formatDateKey(range._min.bzDay), endDate: formatDateKey(range._max.bzDay) }
    : null;

  if (query.metadataOnly || !requestedLob || !validLobs.includes(requestedLob)) {
    return emptyPerformanceAgentsPayload(start, end, dataRange, filters, view);
  }

  const queueSql = performanceQueueFilterSql(requestedLob);
  const ownEmployeeSql = ownEmployeeId ? Prisma.sql`AND p."employeeId" = ${ownEmployeeId}` : Prisma.empty;
  const rawRows = await prisma.$queryRaw<Array<{
    employeeId: string | null;
    employeeName: string;
    wbLogin: string;
    supervisorId: string | null;
    supervisor: string;
    shiftId: string | null;
    shift: string;
    queueId: string;
    submit: number;
    moderationSeconds: number;
    activeDates: Date[];
  }>>(Prisma.sql`
    SELECT
      p."employeeId" AS "employeeId",
      COALESCE(e."fullName", p."wbLogin") AS "employeeName",
      COALESCE(e."wbLogin", p."wbLogin") AS "wbLogin",
      e."supervisorId" AS "supervisorId",
      COALESCE(s."fullName", 'Sem supervisor') AS "supervisor",
      e."shiftId" AS "shiftId",
      COALESCE(sh."name", 'Sem turno') AS "shift",
      p."queueId" AS "queueId",
      COALESCE(SUM(p."submitNum"), 0)::double precision AS "submit",
      COALESCE(SUM(p."moderationSeconds"), 0)::double precision AS "moderationSeconds",
      ARRAY_AGG(DISTINCT p."bzDay") AS "activeDates"
    FROM "ProductionRecord" p
    LEFT JOIN "EmployeeProfile" e ON e."id" = p."employeeId"
    LEFT JOIN "EmployeeProfile" s ON s."id" = e."supervisorId"
    LEFT JOIN "Shift" sh ON sh."id" = e."shiftId"
    WHERE p."bzDay" >= ${start}
      AND p."bzDay" <= ${end}
      ${ownEmployeeSql}
      ${queueSql}
    GROUP BY
      p."employeeId",
      e."fullName",
      e."wbLogin",
      p."wbLogin",
      e."supervisorId",
      s."fullName",
      e."shiftId",
      sh."name",
      p."queueId"
  `);

  const aggregateMap = new Map<string, {
    employeeId: string | null;
    employeeName: string;
    wbLogin: string;
    lob: string;
    supervisorId: string | null;
    supervisor: string;
    shiftId: string | null;
    shift: string;
    submit: number;
    moderationSeconds: number;
    activeDates: Set<string>;
    outputAveragePerDay: number;
  }>();
  for (const row of rawRows) {
    const lob = getPerformanceQueueMetadataById(row.queueId).lob;
    const identity = row.employeeId || `wb:${row.wbLogin.trim().toLocaleLowerCase("pt-BR")}`;
    const key = `${identity}:${lob}`;
    const current = aggregateMap.get(key) ?? {
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      wbLogin: row.wbLogin,
      lob,
      supervisorId: row.supervisorId,
      supervisor: row.supervisor,
      shiftId: row.shiftId,
      shift: row.shift,
      submit: 0,
      moderationSeconds: 0,
      activeDates: new Set<string>(),
      outputAveragePerDay: 0
    };
    current.submit += Number(row.submit ?? 0);
    current.moderationSeconds += Number(row.moderationSeconds ?? 0);
    for (const date of row.activeDates ?? []) current.activeDates.add(formatDateKey(date));
    current.outputAveragePerDay = current.activeDates.size > 0 ? current.submit / current.activeDates.size : 0;
    aggregateMap.set(key, current);
  }

  const search = query.search?.trim().toLocaleLowerCase("pt-BR") ?? "";
  const filteredRows = Array.from(aggregateMap.values()).filter((row) => {
    if (query.supervisorId && row.supervisorId !== query.supervisorId) return false;
    if (query.shiftId && row.shiftId !== query.shiftId) return false;
    if (!search) return true;
    return row.employeeName.toLocaleLowerCase("pt-BR").includes(search)
      || row.wbLogin.toLocaleLowerCase("pt-BR").includes(search);
  });
  const sortBy = query.sortBy ?? "submit";
  const sortDirection = query.sortDirection === "asc" ? "asc" : "desc";
  filteredRows.sort((a, b) => comparePerformanceAgentRows(a, b, sortBy, sortDirection));

  const pageSize = Math.min(100, Math.max(10, Math.trunc(query.pageSize ?? 50)));
  const totalRows = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const page = Math.min(totalPages, Math.max(1, Math.trunc(query.page ?? 1)));
  const pageRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);
  const submit = filteredRows.reduce((total, row) => total + row.submit, 0);
  const moderationSeconds = filteredRows.reduce((total, row) => total + row.moderationSeconds, 0);
  const activeDates = new Set(filteredRows.flatMap((row) => Array.from(row.activeDates)));
  const outputAveragePerDay = activeDates.size > 0 ? submit / activeDates.size : 0;
  const agents = new Set(filteredRows.map((row) => row.employeeId || `wb:${row.wbLogin.toLocaleLowerCase("pt-BR")}`)).size;

  return {
    mode: "agents" as const,
    view,
    period: periodPayload({ start, end }),
    dataRange,
    selectedLob: requestedLob,
    filters,
    summary: {
      agents,
      submit,
      outputAveragePerDay: round2(outputAveragePerDay),
      daysWithData: activeDates.size,
      moderationSeconds,
      ahtSeconds: submit > 0 ? round2(moderationSeconds / submit) : 0
    },
    pagination: { page, pageSize, totalRows, totalPages },
    sort: { sortBy, sortDirection },
    agents: pageRows.map((row) => ({
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      wbLogin: row.wbLogin,
      lob: row.lob,
      supervisorId: row.supervisorId,
      supervisor: row.supervisor,
      shiftId: row.shiftId,
      shift: row.shift,
      submit: Math.round(row.submit),
      outputAveragePerDay: round2(row.outputAveragePerDay),
      daysWithData: row.activeDates.size,
      moderationSeconds: round2(row.moderationSeconds),
      ahtSeconds: row.submit > 0 ? round2(row.moderationSeconds / row.submit) : 0
    }))
  };
}

export async function getPerformanceSupervisorsDashboard(actor: Actor, query: PerformanceSupervisorsQuery = {}) {
  const user = await requireActiveUser(actor);
  if (!canAccessPerformance(permissionUser(user))) throw new PerformanceError("Você não tem permissão para acessar Performance.", 403);

  const view = normalizeDashboardView(query.view);
  const range = await prisma.productionRecord.aggregate({ _min: { bzDay: true }, _max: { bzDay: true } });
  const fallback = getDefaultDatePeriod();
  const referenceDate = range._max.bzDay ?? fallback.end;
  const period = dashboardViewPeriod(referenceDate, view);
  const employees = (await prisma.employeeProfile.findMany({
    where: { deletedAt: null, supervisorId: { not: null } },
    select: {
      id: true,
      roleTitle: true,
      operationalStatus: true,
      admissionDate: true,
      terminationDate: true,
      terminationType: true,
      terminationReason: true,
      supervisorId: true,
      supervisor: { select: { fullName: true } }
    }
  })).filter((employee) => isAgentJobTitle(employee.roleTitle));

  const employeeIds = employees.map((employee) => employee.id);
  const supervisorNames = new Map<string, string>();
  const employeesBySupervisor = new Map<string, typeof employees>();
  for (const employee of employees) {
    if (!employee.supervisorId) continue;
    supervisorNames.set(employee.supervisorId, employee.supervisor?.fullName?.trim() || "Sem supervisor");
    const team = employeesBySupervisor.get(employee.supervisorId) ?? [];
    team.push(employee);
    employeesBySupervisor.set(employee.supervisorId, team);
  }

  if (!employeeIds.length) {
    return emptyPerformanceSupervisorsPayload(view, period, range);
  }

  const ahtQueueIds = allPerformanceQueueIds().filter((queueId) => {
    const metadata = getPerformanceQueueMetadataById(queueId);
    return metadata.lob === "ADS" || (metadata.lob === "VIDEO" && metadata.slaTargetMinutes === 15);
  });
  const [schedules, moods, ahtRows, adsQualityRows, tnsQualityRows, cecQualityRows] = await Promise.all([
    prisma.schedule.findMany({
      where: { employeeId: { in: employeeIds }, date: { gte: period.start, lte: period.end }, deletedAt: null },
      select: { employeeId: true, status: true }
    }),
    prisma.employeeMoodRecord.findMany({
      where: { employeeId: { in: employeeIds }, date: { gte: period.start, lte: period.end } },
      select: { employeeId: true, moodScore: true }
    }),
    ahtQueueIds.length ? prisma.$queryRaw<Array<{ supervisorId: string; submit: number; moderationSeconds: number }>>(Prisma.sql`
      SELECT
        e."supervisorId" AS "supervisorId",
        COALESCE(SUM(p."submitNum"), 0)::double precision AS "submit",
        COALESCE(SUM(p."moderationSeconds"), 0)::double precision AS "moderationSeconds"
      FROM "ProductionRecord" p
      INNER JOIN "EmployeeProfile" e ON e."id" = p."employeeId"
      WHERE p."employeeId" IN (${Prisma.join(employeeIds)})
        AND p."bzDay" >= ${period.start}
        AND p."bzDay" <= ${period.end}
        AND p."queueId" IN (${Prisma.join(ahtQueueIds)})
        AND e."supervisorId" IS NOT NULL
      GROUP BY e."supervisorId"
    `) : Promise.resolve([]),
    prisma.$queryRaw<Array<{ supervisorId: string; correct: number; total: number }>>(Prisma.sql`
      SELECT
        e."supervisorId" AS "supervisorId",
        COUNT(DISTINCT CASE WHEN LOWER(TRIM(q."finalResult")) = 'correct' THEN q."concatKey" END)::integer AS "correct",
        COUNT(DISTINCT q."concatKey")::integer AS "total"
      FROM "QualityRecord" q
      INNER JOIN "EmployeeProfile" e ON e."id" = q."employeeId"
      WHERE q."employeeId" IN (${Prisma.join(employeeIds)})
        AND q."auditDate" >= ${period.start}
        AND q."auditDate" <= ${period.end}
        AND e."supervisorId" IS NOT NULL
      GROUP BY e."supervisorId"
    `),
    prisma.$queryRaw<Array<{ supervisorId: string; correct: number; total: number }>>(Prisma.sql`
      SELECT
        e."supervisorId" AS "supervisorId",
        COALESCE(SUM(GREATEST(q."sampling" - q."mislabeled" - q."leakage" - q."falsePositive", 0)), 0)::integer AS "correct",
        COALESCE(SUM(q."sampling"), 0)::integer AS "total"
      FROM "TnsQualityRecord" q
      INNER JOIN "EmployeeProfile" e ON e."id" = q."employeeId"
      WHERE q."employeeId" IN (${Prisma.join(employeeIds)})
        AND q."auditDate" >= ${period.start}
        AND q."auditDate" <= ${period.end}
        AND e."supervisorId" IS NOT NULL
      GROUP BY e."supervisorId"
    `),
    prisma.$queryRaw<Array<{ supervisorId: string; correct: number; total: number }>>(Prisma.sql`
      SELECT
        e."supervisorId" AS "supervisorId",
        COALESCE(SUM(q."passQuantity"), 0)::integer AS "correct",
        COALESCE(SUM(q."passQuantity" + q."failQuantity"), 0)::integer AS "total"
      FROM "CecQualityRecord" q
      INNER JOIN "EmployeeProfile" e ON e."id" = q."employeeId"
      WHERE q."employeeId" IN (${Prisma.join(employeeIds)})
        AND q."qualityDate" >= ${period.start}
        AND q."qualityDate" <= ${period.end}
        AND e."supervisorId" IS NOT NULL
      GROUP BY e."supervisorId"
    `)
  ]);

  const supervisorByEmployee = new Map(employees.map((employee) => [employee.id, employee.supervisorId!]));
  const aggregates = new Map<string, {
    planned: number;
    absences: number;
    moodTotal: number;
    moodResponses: number;
    submit: number;
    moderationSeconds: number;
    qualityCorrect: number;
    qualityTotal: number;
  }>();
  const ensureAggregate = (supervisorId: string) => {
    const aggregate = aggregates.get(supervisorId) ?? {
      planned: 0,
      absences: 0,
      moodTotal: 0,
      moodResponses: 0,
      submit: 0,
      moderationSeconds: 0,
      qualityCorrect: 0,
      qualityTotal: 0
    };
    aggregates.set(supervisorId, aggregate);
    return aggregate;
  };

  for (const schedule of schedules) {
    const supervisorId = supervisorByEmployee.get(schedule.employeeId);
    if (!supervisorId) continue;
    const aggregate = ensureAggregate(supervisorId);
    if (isScheduledStatus(schedule.status)) aggregate.planned += 1;
    if (isAbsenceStatus(schedule.status)) aggregate.absences += 1;
  }
  for (const mood of moods) {
    const supervisorId = supervisorByEmployee.get(mood.employeeId);
    if (!supervisorId) continue;
    const aggregate = ensureAggregate(supervisorId);
    aggregate.moodTotal += mood.moodScore;
    aggregate.moodResponses += 1;
  }
  for (const row of ahtRows) {
    const aggregate = ensureAggregate(row.supervisorId);
    aggregate.submit += Number(row.submit ?? 0);
    aggregate.moderationSeconds += Number(row.moderationSeconds ?? 0);
  }
  for (const rows of [adsQualityRows, tnsQualityRows, cecQualityRows]) {
    for (const row of rows) {
      const aggregate = ensureAggregate(row.supervisorId);
      aggregate.qualityCorrect += Number(row.correct ?? 0);
      aggregate.qualityTotal += Number(row.total ?? 0);
    }
  }

  const supervisors = Array.from(employeesBySupervisor.entries()).map(([supervisorId, team]) => {
    const aggregate = ensureAggregate(supervisorId);
    const attrition = supervisorAttrition(team, period);
    return {
      supervisorId,
      supervisor: supervisorNames.get(supervisorId) ?? "Sem supervisor",
      teamSize: team.filter((employee) => supervisorEmployeeActiveAt(employee, period.end, "end")).length,
      planned: aggregate.planned,
      absences: aggregate.absences,
      absRate: calculateAbsenceRate(aggregate.planned, aggregate.absences),
      terminations: attrition.terminations,
      hcAverage: attrition.hcAverage,
      attritionRate: attrition.rate,
      moodAverage: aggregate.moodResponses > 0 ? round2(aggregate.moodTotal / aggregate.moodResponses) : 0,
      moodResponses: aggregate.moodResponses,
      submit: Math.round(aggregate.submit),
      moderationSeconds: round2(aggregate.moderationSeconds),
      ahtSeconds: aggregate.submit > 0 ? round2(aggregate.moderationSeconds / aggregate.submit) : 0,
      qualityCorrect: aggregate.qualityCorrect,
      qualityTotal: aggregate.qualityTotal,
      quality: aggregate.qualityTotal > 0 ? round2((aggregate.qualityCorrect / aggregate.qualityTotal) * 100) : 0
    };
  }).sort((a, b) => a.supervisor.localeCompare(b.supervisor, "pt-BR"));

  const summary = supervisors.reduce((total, row) => ({
    supervisors: total.supervisors + 1,
    teamSize: total.teamSize + row.teamSize,
    planned: total.planned + row.planned,
    absences: total.absences + row.absences,
    terminations: total.terminations + row.terminations,
    hcAverage: total.hcAverage + row.hcAverage,
    moodWeighted: total.moodWeighted + row.moodAverage * row.moodResponses,
    moodResponses: total.moodResponses + row.moodResponses,
    submit: total.submit + row.submit,
    moderationSeconds: total.moderationSeconds + row.moderationSeconds,
    qualityCorrect: total.qualityCorrect + row.qualityCorrect,
    qualityTotal: total.qualityTotal + row.qualityTotal
  }), {
    supervisors: 0,
    teamSize: 0,
    planned: 0,
    absences: 0,
    terminations: 0,
    hcAverage: 0,
    moodWeighted: 0,
    moodResponses: 0,
    submit: 0,
    moderationSeconds: 0,
    qualityCorrect: 0,
    qualityTotal: 0
  });

  return {
    mode: "supervisors" as const,
    view,
    period: periodPayload(period),
    dataRange: range._min.bzDay && range._max.bzDay
      ? { startDate: formatDateKey(range._min.bzDay), endDate: formatDateKey(range._max.bzDay) }
      : null,
    summary: {
      supervisors: summary.supervisors,
      teamSize: summary.teamSize,
      planned: summary.planned,
      absences: summary.absences,
      absRate: calculateAbsenceRate(summary.planned, summary.absences),
      terminations: summary.terminations,
      hcAverage: round2(summary.hcAverage),
      attritionRate: summary.hcAverage > 0 ? round2((summary.terminations / summary.hcAverage) * 100) : 0,
      moodAverage: summary.moodResponses > 0 ? round2(summary.moodWeighted / summary.moodResponses) : 0,
      moodResponses: summary.moodResponses,
      submit: summary.submit,
      moderationSeconds: round2(summary.moderationSeconds),
      ahtSeconds: summary.submit > 0 ? round2(summary.moderationSeconds / summary.submit) : 0,
      qualityCorrect: summary.qualityCorrect,
      qualityTotal: summary.qualityTotal,
      quality: summary.qualityTotal > 0 ? round2((summary.qualityCorrect / summary.qualityTotal) * 100) : 0
    },
    supervisors
  };
}

function emptyPerformanceSupervisorsPayload(
  view: "monthly" | "weekly" | "daily",
  period: Period,
  range: { _min: { bzDay: Date | null }; _max: { bzDay: Date | null } }
) {
  return {
    mode: "supervisors" as const,
    view,
    period: periodPayload(period),
    dataRange: range._min.bzDay && range._max.bzDay
      ? { startDate: formatDateKey(range._min.bzDay), endDate: formatDateKey(range._max.bzDay) }
      : null,
    summary: {
      supervisors: 0,
      teamSize: 0,
      planned: 0,
      absences: 0,
      absRate: 0,
      terminations: 0,
      hcAverage: 0,
      attritionRate: 0,
      moodAverage: 0,
      moodResponses: 0,
      submit: 0,
      moderationSeconds: 0,
      ahtSeconds: 0,
      qualityCorrect: 0,
      qualityTotal: 0,
      quality: 0
    },
    supervisors: []
  };
}

function supervisorAttrition(
  employees: Array<{
    operationalStatus: string;
    admissionDate: Date;
    terminationDate: Date | null;
    terminationType: string | null;
    terminationReason: string | null;
  }>,
  period: Period
) {
  const eligible = employees.filter((employee) => supervisorAttritionEligible(employee.operationalStatus));
  const hcStart = eligible.filter((employee) => supervisorEmployeeActiveAt(employee, period.start, "start")).length;
  const hcEnd = eligible.filter((employee) => supervisorEmployeeActiveAt(employee, period.end, "end")).length;
  const terminations = eligible.filter((employee) => {
    if (!employee.terminationDate || !isOperationallyTerminated(employee.operationalStatus)) return false;
    if (isTrainingTermination(employee)) return false;
    return employee.terminationDate >= period.start && employee.terminationDate <= period.end;
  }).length;
  const hcAverage = round2((hcStart + hcEnd) / 2);
  return { terminations, hcAverage, rate: hcAverage > 0 ? round2((terminations / hcAverage) * 100) : 0 };
}

function supervisorAttritionEligible(status: string) {
  const token = normalizeTextToken(status);
  return ["active", "ativo", "ativa", "desligado", "desligada", "terminated"].includes(token);
}

function supervisorEmployeeActiveAt(
  employee: { operationalStatus: string; admissionDate: Date; terminationDate: Date | null },
  boundary: Date,
  boundaryType: "start" | "end"
) {
  if (!supervisorAttritionEligible(employee.operationalStatus)) return false;
  if (isOperationallyTerminated(employee.operationalStatus) && !employee.terminationDate) return false;
  if (employee.admissionDate > boundary) return false;
  return boundaryType === "start"
    ? !employee.terminationDate || employee.terminationDate >= boundary
    : !employee.terminationDate || employee.terminationDate > boundary;
}

function isTrainingTermination(employee: { terminationType: string | null; terminationReason: string | null }) {
  const token = `${normalizeTextToken(employee.terminationType ?? "")} ${normalizeTextToken(employee.terminationReason ?? "")}`;
  return token.includes("treinamento") || token.includes("training");
}

function emptyPerformanceAgentsPayload(
  start: Date,
  end: Date,
  dataRange: { startDate: string; endDate: string } | null,
  filters: {
    lobs: string[];
    supervisors: Array<{ id: string; fullName: string }>;
    shifts: Array<{ id: string; name: string }>;
  },
  view: "monthly" | "weekly" | "daily"
) {
  return {
    mode: "agents" as const,
    view,
    period: periodPayload({ start, end }),
    dataRange,
    selectedLob: "",
    filters,
    summary: { agents: 0, submit: 0, outputAveragePerDay: 0, daysWithData: 0, moderationSeconds: 0, ahtSeconds: 0 },
    pagination: { page: 1, pageSize: 50, totalRows: 0, totalPages: 1 },
    sort: { sortBy: "submit" as const, sortDirection: "desc" as const },
    agents: []
  };
}

function uniqueBy<T>(items: T[], key: (item: T) => string) {
  return Array.from(new Map(items.map((item) => [key(item), item])).values());
}

function comparePerformanceAgentRows(
  a: { employeeName: string; wbLogin: string; lob: string; supervisor: string; shift: string; submit: number; outputAveragePerDay: number; moderationSeconds: number },
  b: { employeeName: string; wbLogin: string; lob: string; supervisor: string; shift: string; submit: number; outputAveragePerDay: number; moderationSeconds: number },
  sortBy: NonNullable<PerformanceAgentsQuery["sortBy"]>,
  direction: "asc" | "desc"
) {
  const aValue = sortBy === "aht"
    ? (a.submit > 0 ? a.moderationSeconds / a.submit : -1)
    : sortBy === "submit"
      ? a.outputAveragePerDay
      : a[sortBy];
  const bValue = sortBy === "aht"
    ? (b.submit > 0 ? b.moderationSeconds / b.submit : -1)
    : sortBy === "submit"
      ? b.outputAveragePerDay
      : b[sortBy];
  const result = typeof aValue === "number" && typeof bValue === "number"
    ? aValue - bValue
    : String(aValue).localeCompare(String(bValue), "pt-BR", { sensitivity: "base" });
  return direction === "asc" ? result : -result;
}

function serializeQualityAggregate(correct: number, total: number) {
  const safeCorrect = Number(correct ?? 0);
  const safeTotal = Number(total ?? 0);
  return {
    correct: safeCorrect,
    total: safeTotal,
    errors: Math.max(0, safeTotal - safeCorrect),
    quality: safeTotal > 0 ? round2((safeCorrect / safeTotal) * 100) : 0
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

export async function authorizePerformanceImport(actor: Actor) {
  const user = await requireActiveUser(actor);
  requireImportPermission(user);
  return { id: user.id, email: user.email };
}

export async function previewProductionAutomatedImport(rawRows: Record<string, unknown>[], options: PerformancePreviewOptions = {}) {
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

export async function commitProductionAutomatedRawImport(rawRows: Record<string, unknown>[], fileName = "producao.xlsx", batchId?: string, rowNumberOffset = 0, options: { pruneSnapshot?: boolean } = { pruneSnapshot: true }) {
  const preview = await previewProductionRows(rawRows, { rowNumberOffset, skipExistingCheck: true });
  return commitProductionRows(null, preview.rows, fileName, batchId, options);
}

export async function commitProductionAutomatedPreviewImport(rows: PerformancePreviewRow[], fileName = "producao.xlsx", batchId?: string, options: { pruneSnapshot?: boolean } = { pruneSnapshot: true }) {
  return commitProductionRows(null, rows, fileName, batchId, options);
}

export async function commitProductionManualPreviewImport(actor: Actor, rows: PerformancePreviewRow[], fileName = "performance.xlsx", batchId?: string) {
  const user = await requireActiveUser(actor);
  requireImportPermission(user);
  return commitProductionRows(user, rows, fileName, batchId, { pruneSnapshot: false });
}

export async function replacePerformanceSnapshot(actor: Actor, batchIdToKeep: string) {
  const user = await requireActiveUser(actor);
  requireImportPermission(user);
  if (!batchIdToKeep) throw new PerformanceError("Lote de importação obrigatório para substituir Performance.", 400);

  const [productionDeleted, volumeDeleted, batchesDeleted] = await prisma.$transaction([
    prisma.productionRecord.deleteMany({
      where: { OR: [{ importBatchId: null }, { importBatchId: { not: batchIdToKeep } }] }
    }),
    prisma.performanceQueueVolumeRecord.deleteMany({
      where: { OR: [{ importBatchId: null }, { importBatchId: { not: batchIdToKeep } }] }
    }),
    prisma.performanceImportBatch.deleteMany({
      where: { type: "PRODUCTION", id: { not: batchIdToKeep } }
    })
  ]);

  return {
    batchIdKept: batchIdToKeep,
    productionRowsDeleted: productionDeleted.count,
    volumeRowsDeleted: volumeDeleted.count,
    importBatchesDeleted: batchesDeleted.count
  };
}

export async function replaceQualitySnapshot(actor: Actor, batchIdToKeep: string) {
  const user = await requireActiveUser(actor);
  requireImportPermission(user);
  if (!batchIdToKeep) throw new PerformanceError("Lote de Qualidade obrigatório para substituir a base.", 400);

  const [recordsDeleted, batchesDeleted] = await prisma.$transaction([
    prisma.qualityRecord.deleteMany({
      where: { OR: [{ importBatchId: null }, { importBatchId: { not: batchIdToKeep } }] }
    }),
    prisma.performanceImportBatch.deleteMany({
      where: { type: "QUALITY", id: { not: batchIdToKeep } }
    })
  ]);

  return {
    batchIdKept: batchIdToKeep,
    qualityRowsDeleted: recordsDeleted.count,
    importBatchesDeleted: batchesDeleted.count
  };
}

export function validatePerformanceImportToken(authorizationHeader?: string | null) {
  const configuredToken = process.env.PERFORMANCE_IMPORT_TOKEN?.trim();
  if (!configuredToken) {
    return { error: "PERFORMANCE_IMPORT_TOKEN não configurado no ambiente.", status: 500 };
  }

  const match = String(authorizationHeader ?? "").match(/^Bearer\s+(.+)$/i);
  const providedToken = match?.[1]?.trim() ?? "";
  if (!providedToken || !safeEqual(providedToken, configuredToken)) {
    return { error: "Token de integração inválido.", status: 401 };
  }

  return { ok: true };
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
    else if (!employee) warnings.push("WB/Login não encontrado no cadastro; a produção será mantida sem vínculo individual.");
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
        rawLob,
        qualityRule
      }
    };
  });

  return options.skipExistingCheck ? buildPreviewResult(previewRows) : markExistingQualityRows(previewRows);
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
    else if (!employee) warnings.push("WB/Login não encontrado no cadastro; a produção será mantida sem vínculo individual.");
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
  const wbLogins = unique(normalizedRows
    .filter((row) => !isProductionVolumeRow(row))
    .map((row) => normalizeWbLogin(text(rowValue(row, productionAgentHeaders))))
    .filter(Boolean));
  const employees = await findEmployeesByWbLogins(wbLogins);
  const employeeByLogin = new Map(employees.map((employee) => [normalizeWbLogin(employee.wbLogin), employee]));
  const seen = new Map<string, number>();

  const previewRows: PerformancePreviewRow[] = normalizedRows.map((row, index) => {
    const rowNumber = (options.rowNumberOffset ?? 0) + index + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    if (isProductionVolumeRow(row)) {
      const bzTime = normalizeExcelDate(rowValue(row, productionVolumeTimeHeaders));
      const bzDay = normalizeExcelDate(rowValue(row, productionVolumeDayHeaders)) ?? bzTime;
      const queueId = normalizeQueueId(rowValue(row, productionQueueHeaders));
      const inputCount = parseInteger(rowValue(row, productionInputHeaders));
      const volumeKey = bzTime && queueId ? `${formatDateTimeKey(bzTime)}|${queueId}` : "";

      if (!bzTime) errors.push("brasiltime/hour inválido.");
      if (!bzDay) errors.push("Data do volume inválida.");
      if (!queueId) errors.push("queue_id inválido.");
      if (inputCount === null || inputCount < 0) errors.push("enqueue inválido.");
      if (volumeKey) {
        const first = seen.get(`volume:${volumeKey}`);
        if (first) warnings.push(`Volume duplicado no arquivo. Primeira ocorrência na linha ${first}; será tratado por upsert.`);
        else seen.set(`volume:${volumeKey}`, rowNumber);
      }

      return {
        rowNumber,
        type: "PRODUCTION_VOLUME",
        wbLogin: "",
        date: bzDay ? formatDateKey(bzDay) : "",
        uniqueKey: volumeKey,
        action: errors.length ? "ignore" : "create",
        errors,
        warnings,
        payload: {
          bzTime: bzTime ? bzTime.toISOString() : "",
          bzDay: bzDay ? formatDateKey(bzDay) : "",
          queueId,
          inputCount,
          volumeKey
        }
      };
    }

    const wbLogin = normalizeWbLogin(text(rowValue(row, productionAgentHeaders)));
    const employee = employeeByLogin.get(wbLogin);
    const bzTime = normalizeExcelDate(rowValue(row, productionTimeHeaders));
    const bzDay = normalizeExcelDate(rowValue(row, productionDayHeaders)) ?? bzTime;
    const submitNum = parseInteger(rowValue(row, ["submit_num", "submit num", "submit"]));
    const moderationSeconds = parseNumber(rowValue(row, ["moderation", "moderation(s)", "moderation seconds", "moderation duration (s)"]));
    const rawAhtSeconds = parseNumber(rowValue(row, ["aht(s)", "aht", "aht_seconds"]));
    const ahtSeconds = submitNum && submitNum > 0 && moderationSeconds !== null ? round2(moderationSeconds / submitNum) : rawAhtSeconds;
    const latencyMinutesSum = parseNumber(rowValue(row, ["latency(min)_sum", "latency_sum", "latency min sum", "latency (min)", "latency(min)"]));
    const queueId = normalizeQueueId(rowValue(row, productionQueueHeaders));
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
      date: bzDay ? formatDateKey(bzDay) : text(rowValue(row, productionDayHeaders)),
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

  return options.skipExistingCheck ? buildPreviewResult(previewRows) : markExistingProductionRows(previewRows);
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
  const validRows = rows.filter((row) => (
    row.type === "QUALITY"
    && !row.errors.length
    && row.employeeId
    && row.uniqueKey
    && row.payload.qualityRule === "ADS_QUALITY"
  ));
  if (!validRows.length) throw new PerformanceError("Não há linhas válidas para importar.", 400);
  const createdRows = validRows.length;
  const updatedRows = 0;
  const batch = await upsertImportBatch(user, "QUALITY", fileName, rows, validRows.length, createdRows, updatedRows, batchId);

  for (const chunk of chunks(validRows, 500)) {
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

async function commitProductionRows(user: AuthenticatedUser | null, rows: PerformancePreviewRow[], fileName = "producao.xlsx", batchId?: string, options: { pruneSnapshot?: boolean } = {}) {
  const validRows = rows.filter((row) => row.type === "PRODUCTION" && !row.errors.length && row.uniqueKey);
  const validVolumeRows = rows.filter((row) => row.type === "PRODUCTION_VOLUME" && !row.errors.length && row.uniqueKey);
  const aggregatedRows = aggregateProductionRows(validRows);
  const aggregatedVolumeRows = aggregateProductionVolumeRows(validVolumeRows);
  const allValidRows = [...validRows, ...validVolumeRows];
  if (!allValidRows.length) throw new PerformanceError("Não há linhas válidas para importar.", 400);
  const allPersistedRows = [...aggregatedRows, ...aggregatedVolumeRows];
  const createdRows = allPersistedRows.filter((row) => row.action === "create").length;
  const updatedRows = allPersistedRows.filter((row) => row.action === "update").length;
  const batch = await upsertImportBatch(user, "PRODUCTION", fileName, rows, allValidRows.length, createdRows, updatedRows, batchId);

  await bulkUpsertProductionRecords(aggregatedRows, batch.id);
  await bulkUpsertPerformanceQueueVolumeRecords(aggregatedVolumeRows, batch.id);
  const snapshotPrune = !user && options.pruneSnapshot ? await pruneAutomatedProductionSnapshot(aggregatedRows, aggregatedVolumeRows, batch.id) : null;
  if (user && !batchId) await auditImport(user.id, "PRODUCTION", batch.id, {
    fileName,
    rowsTotal: rows.length,
    rowsValid: allValidRows.length,
    productionRows: validRows.length,
    volumeRows: validVolumeRows.length,
    createdRows,
    updatedRows
  });
  return {
    success: true,
    importedRows: allValidRows.length,
    productionRows: validRows.length,
    volumeRows: validVolumeRows.length,
    createdRows,
    updatedRows,
    snapshotPrune,
    batchId: batch.id
  };
}

async function bulkUpsertProductionRecords(rows: PerformancePreviewRow[], batchId: string) {
  for (const chunk of chunks(rows, 2500)) {
    const payload = JSON.stringify(chunk.map((row) => ({
      id: crypto.randomUUID(),
      bzTime: new Date(String(row.payload.bzTime)).toISOString(),
      bzDay: parseDate(String(row.payload.bzDay))!.toISOString(),
      wbLogin: row.wbLogin,
      employeeId: row.employeeId ?? null,
      ahtSeconds: nullableNumber(row.payload.ahtSeconds),
      latencyMinutesSum: nullableNumber(row.payload.latencyMinutesSum),
      submitNum: Number(row.payload.submitNum ?? 0),
      queueId: String(row.payload.queueId),
      moderationSeconds: Number(row.payload.moderationSeconds ?? 0),
      lobId: row.lobId ?? null,
      productionKey: String(row.payload.productionKey),
      importBatchId: batchId
    })));

    await prisma.$executeRaw(Prisma.sql`
      WITH incoming AS (
        SELECT *
        FROM jsonb_to_recordset(${payload}::jsonb) AS x(
          "id" text,
          "bzTime" timestamp,
          "bzDay" timestamp,
          "wbLogin" text,
          "employeeId" text,
          "ahtSeconds" double precision,
          "latencyMinutesSum" double precision,
          "submitNum" integer,
          "queueId" text,
          "moderationSeconds" double precision,
          "lobId" text,
          "productionKey" text,
          "importBatchId" text
        )
      )
      INSERT INTO "ProductionRecord" (
        "id",
        "bzTime",
        "bzDay",
        "wbLogin",
        "employeeId",
        "ahtSeconds",
        "latencyMinutesSum",
        "submitNum",
        "queueId",
        "moderationSeconds",
        "lobId",
        "productionKey",
        "importBatchId",
        "createdAt",
        "updatedAt"
      )
      SELECT
        "id",
        "bzTime",
        "bzDay",
        "wbLogin",
        "employeeId",
        "ahtSeconds",
        "latencyMinutesSum",
        "submitNum",
        "queueId",
        "moderationSeconds",
        "lobId",
        "productionKey",
        "importBatchId",
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM incoming
      ON CONFLICT ("productionKey") DO UPDATE SET
        "bzTime" = EXCLUDED."bzTime",
        "bzDay" = EXCLUDED."bzDay",
        "wbLogin" = EXCLUDED."wbLogin",
        "employeeId" = EXCLUDED."employeeId",
        "ahtSeconds" = EXCLUDED."ahtSeconds",
        "latencyMinutesSum" = EXCLUDED."latencyMinutesSum",
        "submitNum" = EXCLUDED."submitNum",
        "queueId" = EXCLUDED."queueId",
        "moderationSeconds" = EXCLUDED."moderationSeconds",
        "lobId" = EXCLUDED."lobId",
        "importBatchId" = EXCLUDED."importBatchId",
        "updatedAt" = EXCLUDED."updatedAt"
    `);
  }
}

async function bulkUpsertPerformanceQueueVolumeRecords(rows: PerformancePreviewRow[], batchId: string) {
  for (const chunk of chunks(rows, 2500)) {
    const payload = JSON.stringify(chunk.map((row) => ({
      id: crypto.randomUUID(),
      bzTime: new Date(String(row.payload.bzTime)).toISOString(),
      bzDay: parseDate(String(row.payload.bzDay))!.toISOString(),
      queueId: String(row.payload.queueId),
      inputCount: Number(row.payload.inputCount ?? 0),
      volumeKey: String(row.payload.volumeKey),
      importBatchId: batchId
    })));

    await prisma.$executeRaw(Prisma.sql`
      WITH incoming AS (
        SELECT *
        FROM jsonb_to_recordset(${payload}::jsonb) AS x(
          "id" text,
          "bzTime" timestamp,
          "bzDay" timestamp,
          "queueId" text,
          "inputCount" integer,
          "volumeKey" text,
          "importBatchId" text
        )
      )
      INSERT INTO "PerformanceQueueVolumeRecord" (
        "id",
        "bzTime",
        "bzDay",
        "queueId",
        "inputCount",
        "volumeKey",
        "importBatchId",
        "createdAt",
        "updatedAt"
      )
      SELECT
        "id",
        "bzTime",
        "bzDay",
        "queueId",
        "inputCount",
        "volumeKey",
        "importBatchId",
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM incoming
      ON CONFLICT ("volumeKey") DO UPDATE SET
        "bzTime" = EXCLUDED."bzTime",
        "bzDay" = EXCLUDED."bzDay",
        "queueId" = EXCLUDED."queueId",
        "inputCount" = EXCLUDED."inputCount",
        "importBatchId" = EXCLUDED."importBatchId",
        "updatedAt" = EXCLUDED."updatedAt"
    `);
  }
}

function aggregateProductionRows(rows: PerformancePreviewRow[]) {
  const byKey = new Map<string, PerformancePreviewRow>();
  for (const row of rows) {
    const key = String(row.payload.productionKey ?? row.uniqueKey ?? "");
    if (!key) continue;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, {
        ...row,
        payload: {
          ...row.payload,
          submitNum: Number(row.payload.submitNum ?? 0),
          moderationSeconds: Number(row.payload.moderationSeconds ?? 0),
          latencyMinutesSum: nullableNumber(row.payload.latencyMinutesSum) ?? 0
        }
      });
      continue;
    }

    const submitNum = Number(current.payload.submitNum ?? 0) + Number(row.payload.submitNum ?? 0);
    const moderationSeconds = Number(current.payload.moderationSeconds ?? 0) + Number(row.payload.moderationSeconds ?? 0);
    const latencyMinutesSum = (nullableNumber(current.payload.latencyMinutesSum) ?? 0) + (nullableNumber(row.payload.latencyMinutesSum) ?? 0);
    current.payload = {
      ...current.payload,
      submitNum,
      moderationSeconds,
      latencyMinutesSum,
      ahtSeconds: submitNum > 0 ? round2(moderationSeconds / submitNum) : nullableNumber(current.payload.ahtSeconds)
    };
    current.warnings = unique([...current.warnings, "Linhas duplicadas da mesma hora/fila/agente foram consolidadas por soma."]);
  }
  return Array.from(byKey.values());
}

function aggregateProductionVolumeRows(rows: PerformancePreviewRow[]) {
  const byKey = new Map<string, PerformancePreviewRow>();
  for (const row of rows) {
    const key = String(row.payload.volumeKey ?? row.uniqueKey ?? "");
    if (!key) continue;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, {
        ...row,
        payload: {
          ...row.payload,
          inputCount: Number(row.payload.inputCount ?? 0)
        }
      });
      continue;
    }

    current.payload = {
      ...current.payload,
      inputCount: Number(current.payload.inputCount ?? 0) + Number(row.payload.inputCount ?? 0)
    };
    current.warnings = unique([...current.warnings, "Linhas duplicadas da mesma hora/fila foram consolidadas por soma."]);
  }
  return Array.from(byKey.values());
}

async function pruneAutomatedProductionSnapshot(validRows: PerformancePreviewRow[], validVolumeRows: PerformancePreviewRow[], batchId: string) {
  const productionRange = payloadDateRange(validRows);
  const volumeRange = payloadDateRange(validVolumeRows);
  const result = {
    productionDeleted: 0,
    volumeDeleted: 0,
    productionRange: productionRange ? { start: formatDateKey(productionRange.start), end: formatDateKey(productionRange.end) } : null,
    volumeRange: volumeRange ? { start: formatDateKey(volumeRange.start), end: formatDateKey(volumeRange.end) } : null
  };

  if (productionRange) {
    const deleted = await prisma.productionRecord.deleteMany({
      where: {
        OR: [
          { bzDay: { lt: productionRange.start } },
          { bzDay: { gt: productionRange.end } },
          {
            AND: [
              { bzDay: { gte: productionRange.start, lte: productionRange.end } },
              { OR: [{ importBatchId: null }, { importBatchId: { not: batchId } }] }
            ]
          }
        ]
      }
    });
    result.productionDeleted = deleted.count;
  }

  if (volumeRange) {
    const deleted = await prisma.performanceQueueVolumeRecord.deleteMany({
      where: {
        OR: [
          { bzDay: { lt: volumeRange.start } },
          { bzDay: { gt: volumeRange.end } },
          {
            AND: [
              { bzDay: { gte: volumeRange.start, lte: volumeRange.end } },
              { OR: [{ importBatchId: null }, { importBatchId: { not: batchId } }] }
            ]
          }
        ]
      }
    });
    result.volumeDeleted = deleted.count;
  }

  return result;
}

function payloadDateRange(rows: PerformancePreviewRow[]) {
  const times = rows
    .map((row) => parseDate(String(row.payload.bzDay ?? ""))?.getTime())
    .filter((time): time is number => Number.isFinite(time));
  if (!times.length) return null;
  return {
    start: new Date(Math.min(...times)),
    end: new Date(Math.max(...times))
  };
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
    headers: ["BZ_time", "BZ_day", "AHT(s)", "Latency(min)_sum", "submit_num", "id-queue_id", "Moderation", "Agentes"],
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
  if (lobName === "ads" || lobName === "project") return "ADS_QUALITY";
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

type FrameworkGroupKey = "CEC" | "ADS" | "TNS_VIDEO" | "TNS_COMMENTS" | "TNS";
type FrameworkMetricKind = "number" | "percent" | "seconds" | "minutes" | "hours";
type FrameworkTargetDirection = "gte" | "lte";
type FrameworkStatus = "ok" | "fail" | "neutral";

type FrameworkMetricDefinition = {
  key: string;
  label: string;
  group: FrameworkGroupKey;
  kind: FrameworkMetricKind;
  target?: number | null;
  targetLabel?: string;
  direction?: FrameworkTargetDirection;
  source: "hc" | "abs" | "attrition" | "quality" | "moderationRate" | "aht" | "cpd" | "latency" | "empty";
};

type FrameworkPeriod = Period & { key: string; label: string };
type FrameworkAggregate = {
  qualityNumerator: number;
  qualityDenominator: number;
  qualityErrors: number;
  submitTotal: number;
  submitDays: number;
  moderationSeconds: number;
  latencyMinutesSum: number;
  latencySubmitTotal: number;
  absences: number;
  scheduledDays: number;
};

const frameworkTnsVideoLatencyQueueIds = new Set(["9553", "5860", "11364", "9551", "9550"]);

const frameworkSections: Array<{ key: "CEC" | "ADS" | "TNS"; title: string; metrics: FrameworkMetricDefinition[] }> = [
  {
    key: "ADS",
    title: "ADS",
    metrics: [
      { key: "ads-hc", label: "ADS HC", group: "ADS", kind: "number", source: "hc", target: 65, direction: "gte" },
      { key: "ads-abs", label: "ADS ABS", group: "ADS", kind: "percent", source: "abs", target: 8, direction: "lte" },
      { key: "ads-attrition", label: "ADS Attrition", group: "ADS", kind: "percent", source: "attrition", target: 10, direction: "lte" },
      { key: "ads-latency", label: "ADS Latency", group: "ADS", kind: "hours", source: "latency", target: 2, direction: "lte" },
      { key: "ads-quality", label: "ADS Quality", group: "ADS", kind: "percent", source: "quality", target: 95, direction: "gte" },
      { key: "ads-moderation", label: "ADS Moderation Time", group: "ADS", kind: "percent", source: "moderationRate", target: 60, direction: "gte" },
      { key: "ads-aht", label: "ADS AHT", group: "ADS", kind: "seconds", source: "aht", target: 22, direction: "lte" }
    ]
  },
  {
    key: "TNS",
    title: "TNS",
    metrics: [
      { key: "tns-video-hc", label: "Video HC", group: "TNS_VIDEO", kind: "number", source: "hc", target: 31, direction: "gte" },
      { key: "tns-comments-hc", label: "Comments HC", group: "TNS_COMMENTS", kind: "number", source: "hc", target: null },
      { key: "tns-abs", label: "TNS ABS", group: "TNS", kind: "percent", source: "abs", target: 8, direction: "lte" },
      { key: "tns-attrition", label: "TNS Attrition", group: "TNS", kind: "percent", source: "attrition", target: 10, direction: "lte" },
      { key: "tns-video-latency", label: "TNS Latency Video", group: "TNS_VIDEO", kind: "minutes", source: "latency", target: 15, direction: "lte" },
      { key: "tns-comments-latency", label: "TNS Latency Comments", group: "TNS_COMMENTS", kind: "hours", source: "latency", target: 24, direction: "lte" },
      { key: "tns-quality", label: "TNS Quality", group: "TNS", kind: "percent", source: "quality", target: 98, direction: "gte" },
      { key: "tns-moderation", label: "TNS Moderation Time", group: "TNS", kind: "percent", source: "moderationRate", target: 60, direction: "gte" },
      { key: "tns-aht", label: "TNS AHT", group: "TNS", kind: "seconds", source: "aht", target: 32, direction: "lte" }
    ]
  },
  {
    key: "CEC",
    title: "CEC",
    metrics: [
      { key: "cec-hc", label: "CEC HC", group: "CEC", kind: "number", source: "hc", target: 26, direction: "gte" },
      { key: "cec-abs", label: "CEC ABS", group: "CEC", kind: "percent", source: "abs", target: 8, direction: "lte" },
      { key: "cec-attrition", label: "CEC Attrition", group: "CEC", kind: "percent", source: "attrition", target: 10, direction: "lte" },
      { key: "cec-csat", label: "CEC CSAT", group: "CEC", kind: "percent", source: "empty", target: 30, direction: "gte" },
      { key: "cec-quality", label: "CEC Quality", group: "CEC", kind: "percent", source: "quality", target: 90, direction: "gte" },
      { key: "cec-frt", label: "CEC FRT", group: "CEC", kind: "percent", source: "empty", target: 97, direction: "gte" },
      { key: "cec-cpd", label: "CEC CPD", group: "CEC", kind: "number", source: "cpd", target: null }
    ]
  }
];

async function buildPerformanceFramework(referenceDate: Date) {
  const monthPeriods = frameworkMonthPeriods(referenceDate);
  const weekPeriods = frameworkWeekPeriods(referenceDate);
  const periods = [...monthPeriods, ...weekPeriods];
  const employees = await listFrameworkEmployees();
  const snapshots = await buildFrameworkSnapshots(employees, periods);
  const sections = frameworkSections.map((section) => ({
    key: section.key,
    title: section.title,
    rows: section.metrics.map((metric) => {
      const values = Object.fromEntries(periods.map((period) => {
        const snapshot = snapshots.get(period.key);
        return [period.key, calculateFrameworkMetric(metric, snapshot?.get(metric.group), employees, period)];
      })) as Record<string, number | null>;
      const currentValue = values[monthPeriods[monthPeriods.length - 1]?.key ?? ""];
      return {
        key: metric.key,
        label: metric.label,
        kind: metric.kind,
        target: metric.target ?? null,
        targetLabel: metric.targetLabel ?? formatFrameworkValue(metric.target ?? null, metric.kind),
        direction: metric.direction ?? null,
        status: frameworkStatus(currentValue, metric.target, metric.direction),
        values
      };
    })
  }));
  return {
    referenceDate: formatDateKey(referenceDate),
    monthPeriods: monthPeriods.map((period) => ({ key: period.key, label: period.label })),
    weekPeriods: weekPeriods.map((period) => ({ key: period.key, label: period.label })),
    sections,
    summary: {
      ok: sections.flatMap((section) => section.rows).filter((row) => row.status === "ok").length,
      fail: sections.flatMap((section) => section.rows).filter((row) => row.status === "fail").length,
      pending: sections.flatMap((section) => section.rows).filter((row) => row.status === "neutral").length
    }
  };
}

async function listFrameworkEmployees(): Promise<PerformanceEmployee[]> {
  const where: Prisma.EmployeeProfileWhereInput = {
    deletedAt: null,
    OR: agentRoleTitleAliases.map((roleTitle) => ({ roleTitle: { equals: roleTitle, mode: "insensitive" } }))
  };
  const employees = await prisma.employeeProfile.findMany({
    where,
    include: { user: true, lob: true, supervisor: true },
    orderBy: { fullName: "asc" },
    take: 3000
  });
  return employees.filter((employee) => isAgentJobTitle(employee.roleTitle));
}

function frameworkMonthPeriods(referenceDate: Date): FrameworkPeriod[] {
  const endMonth = utcDate(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + 1, 1);
  return [2, 1, 0].map((offset) => {
    const start = utcDate(endMonth.getUTCFullYear(), endMonth.getUTCMonth() + 1 - offset, 1);
    const end = utcDate(start.getUTCFullYear(), start.getUTCMonth() + 2, 0);
    return {
      key: `m-${formatDateKey(start).slice(0, 7)}`,
      label: start.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
      start,
      end
    };
  });
}

function frameworkWeekPeriods(referenceDate: Date): FrameworkPeriod[] {
  const currentWeekStart = startOfWeekMonday(referenceDate);
  return [3, 2, 1, 0].map((offset) => {
    const start = addDays(currentWeekStart, -offset * 7);
    const end = addDays(start, 6);
    return {
      key: `w-${formatDateKey(start)}`,
      label: `${isoWeekLabel(start)} ${formatDisplayDate(start).slice(0, 5)} - ${formatDisplayDate(end).slice(0, 5)}`,
      start,
      end
    };
  });
}

function isoWeekLabel(date: Date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((target.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `W${String(weekNumber).padStart(2, "0")}`;
}

async function buildFrameworkSnapshots(employees: PerformanceEmployee[], periods: FrameworkPeriod[]) {
  const snapshots = new Map<string, Map<FrameworkGroupKey, FrameworkAggregate>>();
  if (!employees.length || !periods.length) return snapshots;
  const employeeIds = employees.map((employee) => employee.id);
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const firstStart = periods.reduce((earliest, period) => period.start < earliest ? period.start : earliest, periods[0].start);
  const lastEnd = periods.reduce((latest, period) => period.end > latest ? period.end : latest, periods[0].end);
  const [qualityRecords, tnsQualityRecords, cecQualityRecords, productionRecords, schedules] = await Promise.all([
    prisma.qualityRecord.findMany({
      where: { employeeId: { in: employeeIds }, auditDate: { gte: firstStart, lte: lastEnd } },
      select: qualityMetricSelect
    }),
    prisma.tnsQualityRecord.findMany({
      where: { employeeId: { in: employeeIds }, auditDate: { gte: firstStart, lte: lastEnd } },
      select: tnsQualityMetricSelect
    }),
    prisma.cecQualityRecord.findMany({
      where: { employeeId: { in: employeeIds }, qualityDate: { gte: firstStart, lte: lastEnd } },
      select: cecQualityMetricSelect
    }),
    prisma.productionRecord.findMany({
      where: { employeeId: { in: employeeIds }, bzDay: { gte: firstStart, lte: lastEnd } },
      select: productionMetricSelect
    }),
    prisma.schedule.findMany({
      where: { employeeId: { in: employeeIds }, date: { gte: firstStart, lte: lastEnd }, deletedAt: null },
      select: scheduleMetricSelect
    })
  ]);

  for (const period of periods) snapshots.set(period.key, new Map());
  const periodSubmitDays = new Map(periods.map((period) => [period.key, countDistinctProductionDays(productionRecords, period)]));
  const adsQualityByKey = new Map<string, { total: Set<string>; correct: Set<string> }>();
  const aggregateFor = (period: FrameworkPeriod, group: FrameworkGroupKey) => {
    const periodSnapshot = snapshots.get(period.key)!;
    const existing = periodSnapshot.get(group);
    if (existing) return existing;
    const created = emptyFrameworkAggregate(periodSubmitDays.get(period.key) ?? 0);
    periodSnapshot.set(group, created);
    return created;
  };

  for (const record of productionRecords) {
    const employee = record.employeeId ? employeeById.get(record.employeeId) : null;
    if (!employee) continue;
    const groups = frameworkGroupsForProductionRecord(employee, record);
    for (const period of periods) {
      if (!isDateInRange(record.bzDay, period.start, period.end)) continue;
      for (const group of groups) {
        const aggregate = aggregateFor(period, group);
        const submitTotal = Number(record.submitNum ?? 0);
        aggregate.submitTotal += submitTotal;
        aggregate.moderationSeconds += Number(record.moderationSeconds ?? 0);
        if (shouldIncludeFrameworkLatencyRecord(group, record)) {
          aggregate.latencyMinutesSum += Number(record.latencyMinutesSum ?? 0);
          aggregate.latencySubmitTotal += submitTotal;
        }
      }
    }
  }

  for (const schedule of schedules) {
    const employee = schedule.employeeId ? employeeById.get(schedule.employeeId) : null;
    if (!employee) continue;
    const isScheduled = scheduledStatuses.has(schedule.status);
    const isAbsence = absenceStatuses.has(schedule.status);
    if (!isScheduled && !isAbsence) continue;
    const groups = frameworkGroupsForEmployee(employee);
    for (const period of periods) {
      if (!isDateInRange(schedule.date, period.start, period.end)) continue;
      for (const group of groups) {
        const aggregate = aggregateFor(period, group);
        if (isScheduled) aggregate.scheduledDays += 1;
        if (isAbsence) aggregate.absences += 1;
      }
    }
  }

  for (const record of qualityRecords) {
    const employee = record.employeeId ? employeeById.get(record.employeeId) : null;
    if (!employee) continue;
    const taskKey = qualityTaskKey(record);
    if (!taskKey) continue;
    const groups = frameworkGroupsForEmployee(employee);
    for (const period of periods) {
      if (!isDateInRange(record.auditDate, period.start, period.end)) continue;
      for (const group of groups) {
        const key = `${period.key}:${group}`;
        const quality = adsQualityByKey.get(key) ?? { total: new Set<string>(), correct: new Set<string>() };
        quality.total.add(taskKey);
        if (isCorrectQualityResult(record.finalResult)) quality.correct.add(taskKey);
        adsQualityByKey.set(key, quality);
      }
    }
  }
  for (const [key, quality] of adsQualityByKey) {
    const [periodKey, group] = key.split(":") as [string, FrameworkGroupKey];
    const period = periods.find((item) => item.key === periodKey);
    if (!period) continue;
    const aggregate = aggregateFor(period, group);
    aggregate.qualityNumerator += quality.correct.size;
    aggregate.qualityDenominator += quality.total.size;
    aggregate.qualityErrors += Math.max(0, quality.total.size - quality.correct.size);
  }

  for (const record of tnsQualityRecords) {
    const employee = record.employeeId ? employeeById.get(record.employeeId) : null;
    if (!employee) continue;
    const sampling = Number(record.sampling ?? 0);
    const errors = Number(record.mislabeled ?? 0) + Number(record.leakage ?? 0) + Number(record.falsePositive ?? 0);
    const groups = frameworkGroupsForEmployee(employee);
    for (const period of periods) {
      if (!isDateInRange(record.auditDate, period.start, period.end)) continue;
      for (const group of groups) {
        const aggregate = aggregateFor(period, group);
        aggregate.qualityNumerator += Math.max(0, sampling - errors);
        aggregate.qualityDenominator += sampling;
        aggregate.qualityErrors += errors;
      }
    }
  }

  for (const record of cecQualityRecords) {
    const employee = record.employeeId ? employeeById.get(record.employeeId) : null;
    if (!employee) continue;
    const pass = Number(record.passQuantity ?? 0);
    const fail = Number(record.failQuantity ?? 0);
    const groups = frameworkGroupsForEmployee(employee);
    for (const period of periods) {
      if (!isDateInRange(record.qualityDate, period.start, period.end)) continue;
      for (const group of groups) {
        const aggregate = aggregateFor(period, group);
        aggregate.qualityNumerator += pass;
        aggregate.qualityDenominator += pass + fail;
        aggregate.qualityErrors += fail;
      }
    }
  }

  return snapshots;
}

function emptyFrameworkAggregate(submitDays = 0): FrameworkAggregate {
  return {
    qualityNumerator: 0,
    qualityDenominator: 0,
    qualityErrors: 0,
    submitTotal: 0,
    submitDays,
    moderationSeconds: 0,
    latencyMinutesSum: 0,
    latencySubmitTotal: 0,
    absences: 0,
    scheduledDays: 0
  };
}

function shouldIncludeFrameworkLatencyRecord(group: FrameworkGroupKey, record: ProductionRecordForMetrics) {
  if (group !== "TNS_VIDEO") return true;
  return frameworkTnsVideoLatencyQueueIds.has(String(record.queueId ?? "").trim());
}

function calculateFrameworkMetric(metric: FrameworkMetricDefinition, aggregate: FrameworkAggregate | undefined, employees: PerformanceEmployee[], period: Period) {
  if (metric.source === "empty") return null;
  if (metric.source === "hc") return frameworkHeadcount(employees, metric.group, period.end);
  if (metric.source === "attrition") return frameworkAttrition(employees, metric.group, period);
  const summary = aggregate ?? emptyFrameworkAggregate();
  if (metric.source === "latency") {
    const averageLatencyMinutes = summary.latencySubmitTotal > 0 ? summary.latencyMinutesSum / summary.latencySubmitTotal : 0;
    return metric.kind === "hours" ? round2(averageLatencyMinutes / 60) : round2(averageLatencyMinutes);
  }
  if (metric.source === "abs") return percent(summary.absences, summary.scheduledDays);
  if (metric.source === "quality") return summary.qualityDenominator > 0 ? percent(summary.qualityNumerator, summary.qualityDenominator) : null;
  if (metric.source === "aht") return summary.submitTotal > 0 ? round2(summary.moderationSeconds / summary.submitTotal) : null;
  if (metric.source === "cpd") return calculateDailySubmit(summary.submitTotal, period.start, period.end, summary.submitDays).submitAveragePerDay;
  if (metric.source === "moderationRate") {
    const plannedSeconds = summary.scheduledDays * DEFAULT_FRAMEWORK_PRODUCTIVE_SECONDS;
    return plannedSeconds > 0 ? percent(summary.moderationSeconds, plannedSeconds) : null;
  }
  return null;
}

const DEFAULT_FRAMEWORK_PRODUCTIVE_SECONDS = 8 * 60 * 60;

function frameworkHeadcount(employees: PerformanceEmployee[], group: FrameworkGroupKey, referenceDate: Date) {
  return employees.filter((employee) => frameworkEmployeeMatchesGroup(employee, group) && isFrameworkActiveAt(employee, referenceDate)).length;
}

function frameworkAttrition(employees: PerformanceEmployee[], group: FrameworkGroupKey, period: Period) {
  const eligibleEmployees = employees.filter((employee) => frameworkEmployeeMatchesGroup(employee, group) && isFrameworkAttritionEligibleStatus(employee.operationalStatus));
  const hcStart = eligibleEmployees.filter((employee) => wasFrameworkAttritionActiveAtBoundary(employee, period.start, "start")).length;
  const hcEnd = eligibleEmployees.filter((employee) => wasFrameworkAttritionActiveAtBoundary(employee, period.end, "end")).length;
  const hcAverage = Number(((hcStart + hcEnd) / 2).toFixed(1));
  const terminations = eligibleEmployees.filter((employee) => isFrameworkAttritionTerminationInPeriod(employee, period)).length;
  return percent(terminations, hcAverage);
}

function isFrameworkActiveAt(employee: PerformanceEmployee, referenceDate: Date) {
  if (employee.admissionDate && employee.admissionDate.getTime() > referenceDate.getTime()) return false;
  if (employee.terminationDate && employee.terminationDate.getTime() <= referenceDate.getTime()) return false;
  if (!employee.terminationDate && isOperationallyTerminated(employee.operationalStatus)) return false;
  return true;
}

function frameworkEmployeeStatusLookupKey(status?: string | null) {
  return String(status ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isFrameworkAttritionActiveStatus(status?: string | null) {
  const key = frameworkEmployeeStatusLookupKey(status);
  return key === "ATIVO" || key === "ACTIVE";
}

function isFrameworkAttritionTerminatedStatus(status?: string | null) {
  const key = frameworkEmployeeStatusLookupKey(status);
  return key === "DESLIGADO" || key === "TERMINATED";
}

function isFrameworkAttritionEligibleStatus(status?: string | null) {
  return isFrameworkAttritionActiveStatus(status) || isFrameworkAttritionTerminatedStatus(status);
}

function wasFrameworkAttritionActiveAtBoundary(employee: PerformanceEmployee, boundary: Date, boundaryType: "start" | "end") {
  if (!isFrameworkAttritionEligibleStatus(employee.operationalStatus)) return false;
  if (isFrameworkAttritionTerminatedStatus(employee.operationalStatus) && !employee.terminationDate) return false;
  const admittedByBoundary = !employee.admissionDate || employee.admissionDate <= boundary;
  const notTerminatedByBoundary =
    boundaryType === "start"
      ? !employee.terminationDate || employee.terminationDate >= boundary
      : !employee.terminationDate || employee.terminationDate > boundary;
  return admittedByBoundary && notTerminatedByBoundary;
}

function isFrameworkAttritionTerminationInPeriod(employee: PerformanceEmployee, period: Period) {
  return Boolean(
    isFrameworkAttritionTerminatedStatus(employee.operationalStatus) &&
      employee.terminationDate &&
      isDateInRange(employee.terminationDate, period.start, period.end)
  );
}

function frameworkEmployeeMatchesGroup(employee: Pick<PerformanceEmployee, "lob" | "skill">, group: FrameworkGroupKey) {
  return frameworkGroupsForEmployee(employee).includes(group);
}

function frameworkGroupsForEmployee(employee: Pick<PerformanceEmployee, "lob" | "skill">) {
  return frameworkGroupKeys(employee.lob?.name ?? "", employee.skill ?? "");
}

function frameworkGroupsForProductionRecord(employee: Pick<PerformanceEmployee, "lob" | "skill">, record: Pick<ProductionRecordForMetrics, "queueId">) {
  const queueLob = QUEUE_METADATA[String(record.queueId ?? "").trim()]?.lob;
  if (queueLob === "ADS") return ["ADS"] satisfies FrameworkGroupKey[];
  if (queueLob === "VIDEO") return ["TNS", "TNS_VIDEO"] satisfies FrameworkGroupKey[];
  if (queueLob === "COMMENTS") return ["TNS", "TNS_COMMENTS"] satisfies FrameworkGroupKey[];
  return frameworkGroupsForEmployee(employee);
}

function frameworkGroupKeys(lobName?: string | null, skill?: string | null): FrameworkGroupKey[] {
  const lob = normalizeTextToken(lobName ?? "");
  const normalizedSkill = normalizeTextToken(skill ?? "");
  if (lob === "ads" || lob === "project" || normalizedSkill.includes("project")) return ["ADS"];
  if (lob === "cec") return ["CEC"];
  const isVideo = lob === "video" || normalizedSkill.includes("video");
  const isComments = lob === "comments" || normalizedSkill.includes("comments");
  if (lob === "tns" || isVideo || isComments) {
    const groups: FrameworkGroupKey[] = ["TNS"];
    if (isVideo) groups.push("TNS_VIDEO");
    if (isComments) groups.push("TNS_COMMENTS");
    return groups;
  }
  return [];
}

function frameworkStatus(value?: number | null, target?: number | null, direction?: FrameworkTargetDirection | null): FrameworkStatus {
  if (value === null || value === undefined || target === null || target === undefined || !direction) return "neutral";
  return direction === "gte" ? (value >= target ? "ok" : "fail") : (value <= target ? "ok" : "fail");
}

function formatFrameworkValue(value: number | null, kind: FrameworkMetricKind) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  if (kind === "percent") return `${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  if (kind === "seconds") return Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (kind === "minutes") return `${formatFrameworkUnitNumber(Number(value))} min`;
  if (kind === "hours") return `${formatFrameworkUnitNumber(Number(value))} h`;
  return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function formatFrameworkUnitNumber(value: number) {
  const hasFraction = Math.abs(value % 1) > 0.005;
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2
  });
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

async function resolveProductionDashboardPeriod(query: PerformanceQuery): Promise<Period> {
  const explicit = query.startDate || query.endDate;
  if (explicit) {
    const fallback = await latestProductionPeriod();
    return {
      start: parseDate(query.startDate) ?? fallback.start,
      end: parseDate(query.endDate) ?? fallback.end
    };
  }
  return latestProductionPeriod();
}

async function latestProductionPeriod(): Promise<Period> {
  const [productionRange, volumeRange] = await Promise.all([
    prisma.productionRecord.aggregate({
      _min: { bzDay: true },
      _max: { bzDay: true }
    }),
    prisma.performanceQueueVolumeRecord.aggregate({
      _min: { bzDay: true },
      _max: { bzDay: true }
    })
  ]);
  const fallback = getDefaultDatePeriod();
  const minDates = [productionRange._min.bzDay, volumeRange._min.bzDay].filter((date): date is Date => Boolean(date));
  const maxDates = [productionRange._max.bzDay, volumeRange._max.bzDay].filter((date): date is Date => Boolean(date));
  return {
    start: minDates.length ? new Date(Math.min(...minDates.map((date) => date.getTime()))) : fallback.start,
    end: maxDates.length ? new Date(Math.max(...maxDates.map((date) => date.getTime()))) : fallback.end
  };
}

function normalizeProductionGranularity(value?: string | null): PerformanceProductionGranularity {
  return value === "hourly" || value === "weekly" || value === "monthly" ? value : "daily";
}

function performanceLobOptions() {
  return ["ADS", "VIDEO", "COMMENTS", "N/A"];
}

function getPerformanceQueueMetadataById(queueId?: string | null): QueueMetadata {
  const normalizedQueueId = String(queueId ?? "").trim();
  const metadata = getQueueMetadataById(normalizedQueueId);
  if (!normalizedQueueId || QUEUE_METADATA[normalizedQueueId]) return metadata;
  const reportMetadata = getQueueReportMetadataById(normalizedQueueId);
  return reportMetadata.lob === "N/A"
    ? metadata
    : { lob: reportMetadata.lob as QueueLob, slaTargetMinutes: metadata.slaTargetMinutes };
}

async function buildProductionDashboardPanel(period: Period) {
  const [
    productionRange,
    volumeRange,
    latestImport,
    productionQueues,
    volumeQueues
  ] = await Promise.all([
    prisma.productionRecord.aggregate({
      where: { bzDay: { gte: period.start, lte: period.end } },
      _min: { bzDay: true },
      _max: { bzDay: true, bzTime: true },
      _sum: { submitNum: true },
      _count: { _all: true }
    }),
    prisma.performanceQueueVolumeRecord.aggregate({
      where: { bzDay: { gte: period.start, lte: period.end } },
      _min: { bzDay: true },
      _max: { bzDay: true, bzTime: true },
      _sum: { inputCount: true },
      _count: { _all: true }
    }),
    prisma.performanceImportBatch.findFirst({
      where: { type: "PRODUCTION" },
      orderBy: { importedAt: "desc" },
      select: { fileName: true, importedAt: true, rowsValid: true, rowsError: true, status: true }
    }),
    prisma.productionRecord.groupBy({
      by: ["queueId"],
      where: { bzDay: { gte: period.start, lte: period.end } },
      _count: { _all: true },
      _max: { bzTime: true }
    }),
    prisma.performanceQueueVolumeRecord.groupBy({
      by: ["queueId"],
      where: { bzDay: { gte: period.start, lte: period.end } },
      _count: { _all: true },
      _max: { bzTime: true }
    })
  ]);

  const minDates = [productionRange._min.bzDay, volumeRange._min.bzDay].filter((date): date is Date => Boolean(date));
  const maxDates = [productionRange._max.bzDay, volumeRange._max.bzDay].filter((date): date is Date => Boolean(date));
  const maxDataTimes = [productionRange._max.bzTime, volumeRange._max.bzTime].filter((date): date is Date => Boolean(date));
  const queueMap = new Map<string, { queueId: string; productionRows: number; volumeRows: number; lastSeenAt: Date | null }>();

  for (const item of productionQueues) {
    const queueId = item.queueId || "Sem Fila ID";
    queueMap.set(queueId, {
      queueId,
      productionRows: item._count._all,
      volumeRows: 0,
      lastSeenAt: item._max.bzTime
    });
  }
  for (const item of volumeQueues) {
    const queueId = item.queueId || "Sem Fila ID";
    const current = queueMap.get(queueId);
    if (current) {
      current.volumeRows = item._count._all;
      current.lastSeenAt = latestDate([current.lastSeenAt, item._max.bzTime]);
    } else {
      queueMap.set(queueId, {
        queueId,
        productionRows: 0,
        volumeRows: item._count._all,
        lastSeenAt: item._max.bzTime
      });
    }
  }

  const unmappedQueues = Array.from(queueMap.values())
    .filter((item) => item.queueId === "Sem Fila ID" || !QUEUE_METADATA[item.queueId])
    .sort((a, b) => (b.productionRows + b.volumeRows) - (a.productionRows + a.volumeRows))
    .slice(0, 50)
    .map((item) => ({
      queueId: item.queueId,
      productionRows: item.productionRows,
      volumeRows: item.volumeRows,
      lastSeenAt: item.lastSeenAt ? formatDateTime(item.lastSeenAt) : null
    }));

  const productionRowsCount = productionRange._count._all;
  const volumeRowsCount = volumeRange._count._all;
  const totalRows = productionRowsCount + volumeRowsCount;
  const lastImportAgeHours = latestImport ? round2((Date.now() - latestImport.importedAt.getTime()) / 36e5) : null;
  const staleThresholdHours = 24;
  const isStale = lastImportAgeHours === null || lastImportAgeHours > staleThresholdHours;
  const alerts: Array<{ type: "OK" | "WARNING" | "CRITICAL"; title: string; description: string }> = [];

  if (!latestImport) {
    alerts.push({ type: "CRITICAL", title: "Base não importada", description: "Nenhuma importação de produtividade foi encontrada." });
  } else if (isStale) {
    alerts.push({ type: "WARNING", title: "Base pode estar desatualizada", description: `Última importação há ${formatHoursAge(lastImportAgeHours ?? 0)}.` });
  }
  if (!totalRows) {
    alerts.push({ type: "WARNING", title: "Sem dados no range", description: "Não há dados de produção ou volume para o intervalo selecionado." });
  }
  if (productionRowsCount > 0 && volumeRowsCount === 0) {
    alerts.push({ type: "WARNING", title: "Base de input não importada", description: "Existe output/submit no range, mas não há registros de input/enqueue." });
  }
  if (volumeRowsCount > 0 && productionRowsCount === 0) {
    alerts.push({ type: "WARNING", title: "Base de output não importada", description: "Existe input/enqueue no range, mas não há registros de output/submit." });
  }
  if (unmappedQueues.length) {
    alerts.push({ type: "WARNING", title: "Filas não mapeadas", description: `${unmappedQueues.length} ID(s) de fila não foram encontrados no dicionário.` });
  }
  if (!alerts.length) {
    alerts.push({ type: "OK", title: "Base atualizada", description: "Range, importação e mapeamento estão consistentes." });
  }

  return {
    dataRange: minDates.length && maxDates.length ? {
      startDate: formatDateKey(new Date(Math.min(...minDates.map((date) => date.getTime())))),
      endDate: formatDateKey(new Date(Math.max(...maxDates.map((date) => date.getTime()))))
    } : null,
    lastDataAt: maxDataTimes.length ? formatDateTime(new Date(Math.max(...maxDataTimes.map((date) => date.getTime())))) : null,
    lastImport: latestImport ? {
      fileName: latestImport.fileName,
      importedAt: formatDateTime(latestImport.importedAt),
      rowsValid: latestImport.rowsValid,
      rowsError: latestImport.rowsError,
      status: latestImport.status,
      ageHours: lastImportAgeHours
    } : null,
    staleThresholdHours,
    isStale,
    totalRows,
    totalSubmit: Number(productionRange._sum.submitNum ?? 0),
    totalInput: Number(volumeRange._sum.inputCount ?? 0),
    totalQueueIds: queueMap.size,
    mappedQueueIds: queueMap.size - unmappedQueues.length,
    unmappedQueues,
    alerts
  };
}

function emptyProductionDashboardPayload(
  period: Period,
  granularity: PerformanceProductionGranularity,
  panel: Awaited<ReturnType<typeof buildProductionDashboardPanel>>,
  canImport = false
) {
  return {
    mode: "production" as const,
    canImport,
    granularity,
    period: periodPayload(period),
    panel,
    filters: { lobs: performanceLobOptions() },
    summary: {
      ...serializeProductionSummary(emptyProductionAggregate()),
      agents: 0,
      queues: 0,
      comparison: null,
      lastImport: null
    },
    trend: [],
    agents: [],
    queues: []
  };
}

function queueIdsByPerformanceLob(lob: string) {
  return allPerformanceQueueIds().filter((queueId) => getPerformanceQueueMetadataById(queueId).lob === lob);
}

function queueWhereByPerformanceLob(lob: string) {
  if (!lob) return {};
  if (lob === "N/A") {
    const mappedQueueIds = allPerformanceQueueIds().filter((queueId) => getPerformanceQueueMetadataById(queueId).lob !== "N/A");
    return { queueId: { notIn: mappedQueueIds } };
  }
  return { queueId: { in: queueIdsByPerformanceLob(lob) } };
}

function allPerformanceQueueIds() {
  return unique([...Object.keys(QUEUE_METADATA), ...Object.keys(QUEUE_REPORT_METADATA)]);
}

function productionBucketSql(granularity: PerformanceProductionGranularity) {
  if (granularity === "hourly") return Prisma.sql`date_trunc('hour', "bzTime")`;
  if (granularity === "weekly") return Prisma.sql`date_trunc('week', "bzDay")`;
  if (granularity === "monthly") return Prisma.sql`date_trunc('month', "bzDay")`;
  return Prisma.sql`date_trunc('day', "bzDay")`;
}

function qualityBucketSql(granularity: "monthly" | "weekly" | "daily") {
  if (granularity === "monthly") return Prisma.sql`date_trunc('month', q."auditDate")`;
  if (granularity === "weekly") return Prisma.sql`date_trunc('week', q."auditDate")`;
  return Prisma.sql`date_trunc('day', q."auditDate")`;
}

function qualityBucketLabel(periodStart: Date, granularity: "monthly" | "weekly" | "daily") {
  if (granularity === "monthly") {
    return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" }).format(periodStart);
  }
  if (granularity === "weekly") {
    return `${formatDisplayDate(periodStart).slice(0, 5)}-${formatDisplayDate(addDays(periodStart, 6)).slice(0, 5)}`;
  }
  return formatDisplayDate(periodStart).slice(0, 5);
}

function performanceQueueFilterSql(lob: string, slaTargetMinutes?: number) {
  const normalizedTarget = Number.isFinite(slaTargetMinutes) && Number(slaTargetMinutes) > 0
    ? Number(slaTargetMinutes)
    : null;
  if (!lob && normalizedTarget === null) return Prisma.empty;
  if (lob === "N/A") {
    const mappedQueueIds = allPerformanceQueueIds().filter((queueId) => getPerformanceQueueMetadataById(queueId).lob !== "N/A");
    return mappedQueueIds.length ? Prisma.sql`AND "queueId" NOT IN (${Prisma.join(mappedQueueIds)})` : Prisma.empty;
  }
  const queueIds = (lob ? queueIdsByPerformanceLob(lob) : allPerformanceQueueIds())
    .filter((queueId) => normalizedTarget === null || getPerformanceQueueMetadataById(queueId).slaTargetMinutes === normalizedTarget);
  return queueIds.length ? Prisma.sql`AND "queueId" IN (${Prisma.join(queueIds)})` : Prisma.sql`AND 1 = 0`;
}

function latestDate(dates: Array<Date | null | undefined>) {
  const validDates = dates.filter((date): date is Date => Boolean(date));
  return validDates.length ? new Date(Math.max(...validDates.map((date) => date.getTime()))) : null;
}

function formatHoursAge(hours: number) {
  if (!Number.isFinite(hours)) return "-";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)} dias`;
}

function productionBucket(date: Date, granularity: PerformanceProductionGranularity) {
  if (granularity === "hourly") {
    return { key: `${formatDateKey(date)} ${String(date.getUTCHours()).padStart(2, "0")}:00` };
  }
  if (granularity === "monthly") {
    return { key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}` };
  }
  if (granularity === "weekly") {
    const start = startOfWeekMonday(date);
    return { key: formatDateKey(start) };
  }
  return { key: formatDateKey(date) };
}

function productionBucketLabel(key: string, granularity: PerformanceProductionGranularity) {
  if (granularity === "hourly") {
    const [datePart, hourPart] = key.split(" ");
    const date = parseDate(datePart);
    return date ? `${formatDisplayDate(date).slice(0, 5)} ${hourPart ?? ""}`.trim() : key;
  }
  if (granularity === "monthly") {
    const [year, month] = key.split("-").map(Number);
    return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" }).format(utcDate(year, month, 1));
  }
  if (granularity === "weekly") {
    const start = parseDate(key);
    if (!start) return key;
    return `${isoWeekLabel(start)} · ${formatDisplayDate(start).slice(0, 5)}-${formatDisplayDate(addDays(start, 6)).slice(0, 5)}`;
  }
  const date = parseDate(key);
  return date ? formatDisplayDate(date) : key;
}

function buildProductionComparison(
  current: ReturnType<typeof serializeProductionSummary> & { key: string; label: string },
  previous: ReturnType<typeof serializeProductionSummary> & { key: string; label: string }
) {
  return {
    currentLabel: current.label,
    previousLabel: previous.label,
    inputDelta: current.input - previous.input,
    submitDelta: current.submit - previous.submit,
    moderationHoursDelta: round2(current.moderationHours - previous.moderationHours),
    ahtSecondsDelta: round2(current.ahtSeconds - previous.ahtSeconds),
    latencyMinutesDelta: round2(current.latencyMinutes - previous.latencyMinutes)
  };
}

function emptyProductionAggregate(): ProductionDashboardAggregate {
  return { input: 0, submit: 0, moderationSeconds: 0, latencyMinutesSum: 0, records: 0 };
}

function ensureProductionAggregate(map: Map<string, ProductionDashboardAggregate>, key: string) {
  if (!map.has(key)) map.set(key, emptyProductionAggregate());
  return map.get(key)!;
}

function incrementProductionAggregate<T extends ProductionDashboardAggregate>(aggregate: T, record: Pick<ProductionRecordForDashboard, "submitNum" | "moderationSeconds" | "latencyMinutesSum">) {
  aggregate.submit += Number(record.submitNum || 0);
  aggregate.moderationSeconds += Number(record.moderationSeconds || 0);
  aggregate.latencyMinutesSum += Number(record.latencyMinutesSum || 0);
  aggregate.records += 1;
  return aggregate;
}

function incrementProductionInput<T extends ProductionDashboardAggregate>(aggregate: T, inputCount: number | null | undefined) {
  aggregate.input += Math.max(0, Number(inputCount || 0));
  aggregate.records += 1;
  return aggregate;
}

function summarizeProductionDashboardRecords(records: ProductionRecordForDashboard[]) {
  const aggregate = emptyProductionAggregate();
  for (const record of records) incrementProductionAggregate(aggregate, record);
  return aggregate;
}

function summarizeProductionDashboardAggregates(aggregates: ProductionDashboardAggregate[]) {
  const summary = emptyProductionAggregate();
  for (const aggregate of aggregates) {
    summary.input += aggregate.input;
    summary.submit += aggregate.submit;
    summary.moderationSeconds += aggregate.moderationSeconds;
    summary.latencyMinutesSum += aggregate.latencyMinutesSum;
    summary.records += aggregate.records;
  }
  return summary;
}

function serializeProductionSummary(aggregate: ProductionDashboardAggregate) {
  const input = Math.round(aggregate.input);
  const submit = Math.round(aggregate.submit);
  const moderationHours = round2(aggregate.moderationSeconds / 3600);
  return {
    records: aggregate.records,
    input,
    submit,
    moderationSeconds: round2(aggregate.moderationSeconds),
    moderationHours,
    ahtSeconds: submit > 0 ? round2(aggregate.moderationSeconds / submit) : 0,
    latencyMinutes: submit > 0 ? round2(aggregate.latencyMinutesSum / submit) : 0
  };
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
  const validProductionKeys = unique(previewRows.filter((row) => row.type === "PRODUCTION" && !row.errors.length && row.uniqueKey).map((row) => row.uniqueKey));
  const validVolumeKeys = unique(previewRows.filter((row) => row.type === "PRODUCTION_VOLUME" && !row.errors.length && row.uniqueKey).map((row) => row.uniqueKey));
  const [existing, existingVolume] = await Promise.all([
    validProductionKeys.length ? prisma.productionRecord.findMany({ where: { productionKey: { in: validProductionKeys } }, select: { productionKey: true } }) : Promise.resolve([]),
    validVolumeKeys.length ? prisma.performanceQueueVolumeRecord.findMany({ where: { volumeKey: { in: validVolumeKeys } }, select: { volumeKey: true } }) : Promise.resolve([])
  ]);
  const existingKeys = new Set(existing.map((row) => row.productionKey));
  const existingVolumeKeys = new Set(existingVolume.map((row) => row.volumeKey));
  return buildPreviewResult(previewRows.map((row) => {
    if (row.errors.length) return row;
    const exists = row.type === "PRODUCTION_VOLUME" ? existingVolumeKeys.has(row.uniqueKey) : existingKeys.has(row.uniqueKey);
    return { ...row, action: exists ? "update" : "create" };
  }));
}

async function upsertImportBatch(
  user: AuthenticatedUser | null,
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
      importedById: user?.id ?? null
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
  const missingWbLogins = unique(rows
    .filter((row) => [...row.errors, ...row.warnings].some((message) => /WB\/Login não encontrado/i.test(message)))
    .map((row) => row.wbLogin)
    .filter(Boolean));
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

function normalizeDashboardView(value?: string | null): "monthly" | "weekly" | "daily" {
  return value === "monthly" || value === "weekly" ? value : "daily";
}

function dashboardViewPeriod(referenceDate: Date, view: "monthly" | "weekly" | "daily"): Period {
  const end = utcDate(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + 1, referenceDate.getUTCDate());
  if (view === "monthly") return { start: utcDate(end.getUTCFullYear(), end.getUTCMonth() + 1, 1), end };
  if (view === "weekly") return { start: startOfWeekMonday(end), end };
  return { start: end, end };
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
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2})(?::(\d{2})(?::(\d{2}))?)?)?/);
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

function isProductionVolumeRow(row: Record<string, unknown>) {
  const hasAgent = Boolean(text(rowValue(row, productionAgentHeaders)));
  const hasSubmit = Boolean(text(rowValue(row, ["submit_num", "submit num", "submit"])));
  const hasInput = Boolean(text(rowValue(row, productionInputHeaders)));
  const hasQueue = Boolean(text(rowValue(row, productionQueueHeaders)));
  const hasVolumeTime = Boolean(text(rowValue(row, productionVolumeTimeHeaders)));
  return hasInput && hasQueue && hasVolumeTime && !hasAgent && !hasSubmit;
}

function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[（）]/g, (char) => (char === "（" ? "(" : ")"))
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
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

function normalizeQueueId(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const normalized = raw.replace(/,/g, "").replace(/\.0+$/, "");
  if (/^-?\d+(?:\.\d+)?e\+?\d+$/i.test(normalized)) {
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return String(Math.trunc(parsed));
  }
  return normalized;
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

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
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
