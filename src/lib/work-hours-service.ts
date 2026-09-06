import { randomUUID } from "crypto";
import {
  AuditAction,
  Prisma,
  type Schedule,
  type WorkHourAdjustmentStatus,
  type WorkHourRecordStatus
} from "@prisma/client";

import { rolesWithCapability } from "@/lib/access-control";
import { createPermissionError, createValidationError, mapPrismaError } from "@/lib/api-errors";
import { hasExcelValue, normalizeExcelDate } from "@/lib/excel-normalization";
import type { Actor } from "@/lib/mock-db";
import { recordErrorLog } from "@/lib/mock-db";
import {
  canApproveWorkHourAdjustment,
  canEditWorkHours,
  canImportWorkHours,
  canRequestWorkHourAdjustment,
  canViewWorkHours,
  normalizeRole
} from "@/lib/permissions";
import { auditPermissionDenied } from "@/lib/permission-audit";
import { prisma } from "@/lib/prisma";
import { getRealtimeHoursShiftActivityHours } from "@/lib/realtime-hours-service";
import { cleanShiftName, shiftCategoryName } from "@/lib/shift-display";
import { cancelAdherenceForDeletedWorkHours } from "@/lib/work-hours-adherence-cleanup";
import { syncWorkHourAdherence } from "@/lib/work-hours-adherence-sync";
import {
  DEFAULT_PRODUCTIVE_HOURS,
  WORK_HOUR_TOLERANCE_MINUTES,
  calculateProductiveDifferenceMinutes,
  formatSignedMinutesToHHMM,
  formatWorkHours,
  isProductiveDifferenceWithinTolerance,
  isWorkHoursAllowedForSchedule,
  parseWorkHoursToMinutes,
  plannedProductiveHoursForSchedule,
  workHourBalanceStatus,
  workHoursFromMinutes,
  workHoursBlockedReasonForSchedule
} from "@/lib/work-hours-rules";

const approvalRoles = rolesWithCapability("WORK_HOURS_EDIT");
const toleranceMinutes = WORK_HOUR_TOLERANCE_MINUTES;
const workHourExportBatchSize = 500;
const workHourExportMaxRows = 100_000;
const pendingWorkHourAdjustmentStatuses: WorkHourAdjustmentStatus[] = ["ABERTO", "EM_ANALISE"];
const inactiveEmployeeStatusLabels = [
  "Inativo",
  "Inativa",
  "INACTIVE",
  "Desativado",
  "Desativada",
  "DISABLED",
  "Desligado",
  "Desligada",
  "TERMINATED",
  "Terminado",
  "Terminada",
  "Suspenso",
  "Suspensa",
  "SUSPENDED"
];
const inactiveEmployeeStatusTokens = new Set(inactiveEmployeeStatusLabels.map((status) => normalizeStatusToken(status)));

const workHourReadInclude = {
  employee: { select: {
    id: true, fullName: true, wbLogin: true, operationalStatus: true, roleTitle: true,
    lob: { select: { name: true } }, shift: { select: { name: true } },
    supervisor: { select: { id: true, fullName: true, wbLogin: true } }
  } },
  adjustments: { orderBy: { createdAt: "desc" }, take: 1, select: {
    id: true, status: true, currentActualHours: true, requestedActualHours: true,
    requestedById: true, reason: true, justification: true, rejectionReason: true,
    rejectedAt: true, createdAt: true,
    requestedBy: { select: { name: true } }, rejectedBy: { select: { name: true } }
  } },
  schedule: { select: { status: true, startsAt: true, endsAt: true } }
} satisfies Prisma.WorkHourRecordInclude;

export const workHourReadData = { capturedHours: getRealtimeHoursShiftActivityHours };

type UserWithRole = Prisma.UserGetPayload<{ include: { role: true; employeeProfile: true } }>;
type WorkHourRecordViewer = {
  id: string;
  roleName: string;
  employeeProfileId?: string | null;
};

export type WorkHourQuery = {
  startDate?: string;
  endDate?: string;
  employeeId?: string;
  lob?: string;
  supervisor?: string;
  shift?: string;
  collaborator?: string;
  wbLogin?: string;
  employeeStatus?: string;
  status?: string;
  overtimeOnly?: boolean;
  hoursPendingOnly?: boolean;
  divergentOnly?: boolean;
  pendingOnly?: boolean;
  noScheduleOnly?: boolean;
  scope?: "mine" | "all";
  page?: number;
  limit?: number;
};

export type WorkHourImportInput = {
  fileName: string;
  rows: Array<Record<string, unknown>>;
  allowPartial?: boolean;
};

export type WorkHourAdjustmentInput = {
  workHourRecordId: string;
  requestedActualHours?: unknown;
  reason?: string;
  justification?: string;
};

export type WorkHourReviewInput = {
  id: string;
  action: "approve" | "reject";
  rejectionReason?: string;
};

export type ManualWorkHourInput = {
  employeeId: string;
  date: string;
  actualHours?: unknown;
  confirmOverwrite?: boolean;
};

export type DeleteWorkHourInput = {
  workHourRecordId: string;
  reason?: string;
};

type ValidationRow = {
  rowNumber: number;
  wbLogin: string;
  originalWbLogin?: string;
  normalizedWbLogin?: string;
  employeeId?: string;
  employeeName?: string;
  employeeStatus?: string;
  date?: Date;
  dateIso?: string;
  errors: string[];
  warnings: string[];
  action: "criar" | "atualizar" | "ignorar";
  hasSchedule: boolean;
  allowsWorkHours: boolean;
  scheduleStatus?: string;
  existingRecordId?: string;
  actualHours?: number;
  plannedHours?: number | null;
  differenceMinutes?: number | null;
};

const workHourColumnAliases: Record<string, string> = {
  wb_login: "wb_login",
  wblogin: "wb_login",
  wb: "wb_login",
  login: "wb_login",
  data: "data",
  date: "data",
  dia: "data",
  horas_realizadas: "horas_realizadas",
  horasrealizadas: "horas_realizadas",
  horas: "horas_realizadas",
  horas_liquidas: "horas_realizadas",
  horas_realizadas_liquidas: "horas_realizadas",
  lob: "lob",
  supervisor_wb_login: "supervisor_wb_login",
  supervisorwblogin: "supervisor_wb_login",
  supervisor_login: "supervisor_wb_login",
  supervisor: "supervisor_wb_login",
  turno: "turno",
  shift: "turno"
};

export async function listOperationalWorkHours(actor: Actor, query: WorkHourQuery = {}) {
  try {
    const user = await getUser(actor);
    if (!user) return { error: "Usuário não encontrado ou inativo." };
    const role = normalizeRole(user.role.name);
    if (!canViewWorkHours({ role: user.role.name, status: user.status }) && query.scope !== "mine") {
      return createPermissionError("Você não tem permissão para visualizar horas operacionais.");
    }

    const period = resolvePeriod(query);
    const page = Math.max(1, Number(query.page) || 1);
    const requestedLimit = Number(query.limit) || 50;
    const limit = Math.min(100, Math.max(10, requestedLimit));
    const where = buildRecordWhere(user, query, period);

    const [records, total] = await prisma.$transaction([
      prisma.workHourRecord.findMany({
        where,
        orderBy: [{ date: "desc" }, { employee: { fullName: "asc" } }],
        skip: (page - 1) * limit,
        take: limit,
        include: workHourReadInclude
      }),
      prisma.workHourRecord.count({ where })
    ]);

    const [summary, capturedHoursByRecordId] = await Promise.all([
      getWorkHoursSummary(where),
      workHourReadData.capturedHours(records.map((record) => ({
        key: record.id,
        employeeId: record.employeeId,
        wbLogin: record.wbLogin,
        shiftDate: record.date
      })))
    ]);

    return {
      data: records.map((record) => formatWorkHourRecord(
        record,
        toWorkHourRecordViewer(user),
        capturedHoursByRecordId.get(record.id) ?? 0
      )),
      summary,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      period: { startDate: formatDate(period.startDate), endDate: formatDate(period.endDate) },
      actor: { role, name: user.name }
    };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "WORK_HOURS_LIST_ERROR", message: error instanceof Error ? error.message : "Falha ao listar horas", action: "WORK_HOURS_LIST", severity: "ERROR" });
    return { error: "Não foi possível carregar horas operacionais." };
  }
}

export async function previewOperationalWorkHoursImport(actor: Actor, rows: Array<Record<string, unknown>>) {
  const user = await getUser(actor);
  const role = normalizeRole(user?.role.name ?? actor.role);
  if (!user || !canImportWorkHours({ role: user.role.name, status: user.status })) {
    const reason = role === "SUPERVISOR" ? "Apenas WFM ou ADMIN podem importar Horas Operacionais." : "Você não tem permissão para importar horas.";
    await auditPermissionDenied(actor, { action: "WORK_HOURS_IMPORT_PREVIEW", entity: "WorkHourRecord", reason });
    return toImportPreview(rows, rows.map((_, index) => ({
      rowNumber: index + 1,
      wbLogin: text(rows[index]?.wb_login),
      errors: [reason],
      warnings: [],
      action: "ignorar",
      hasSchedule: false,
      allowsWorkHours: false
    })));
  }

  const validation = await validateWorkHourRows(rows);
  return toImportPreview(rows, validation);
}

export async function commitOperationalWorkHoursImport(actor: Actor, input: WorkHourImportInput) {
  const user = await getUser(actor);
  const role = normalizeRole(user?.role.name ?? actor.role);
  if (!user || !canImportWorkHours({ role: user.role.name, status: user.status })) {
    const reason = role === "SUPERVISOR" ? "Apenas WFM ou ADMIN podem importar Horas Operacionais." : "Você não tem permissão para importar horas.";
    await auditPermissionDenied(actor, { action: "WORK_HOURS_IMPORT_COMMIT", entity: "WorkHourRecord", reason });
    return createPermissionError(reason);
  }

  try {
    const validation = await validateWorkHourRows(input.rows);
    const hasErrors = validation.some((row) => row.errors.length);
    const validRows = validation.filter((row) => !row.errors.length && row.employeeId && row.date && row.actualHours !== undefined);

    if (hasErrors && !input.allowPartial) {
      return { error: `Existem erros na importação de horas. ${summarizeImportErrors(validation)}`, preview: toImportPreview(input.rows, validation) };
    }
    if (!validRows.length) {
      return { error: `Nenhuma linha válida para importar horas. ${summarizeImportErrors(validation)}`, preview: toImportPreview(input.rows, validation) };
    }

    const batch = await prisma.workHourImportBatch.create({
      data: {
        fileName: input.fileName,
        uploadedById: user.id,
        totalRows: input.rows.length,
        validRows: validRows.length,
        errorRows: validation.filter((row) => row.errors.length).length,
        warningRows: validation.filter((row) => row.warnings.length).length,
        createdRows: validation.filter((row) => !row.errors.length && row.action === "criar").length,
        updatedRows: validation.filter((row) => !row.errors.length && row.action === "atualizar").length,
        status: hasErrors ? "PARTIAL" : "IMPORTED"
      }
    });

    const employeeIds = Array.from(new Set(validRows.map((row) => row.employeeId!).filter(Boolean)));
    const dates = Array.from(new Set(validRows.map((row) => row.date!.getTime()))).map((value) => new Date(value));
    const schedules = employeeIds.length && dates.length
      ? await prisma.schedule.findMany({
        where: {
          employeeId: { in: employeeIds },
          date: { gte: new Date(Math.min(...dates.map((date) => date.getTime()))), lte: new Date(Math.max(...dates.map((date) => date.getTime()))) },
          deletedAt: null
        }
      })
      : [];
    const scheduleMap = new Map(schedules.map((schedule) => [`${schedule.employeeId}:${schedule.date.getTime()}`, schedule]));

    let importedRows = 0;
    for (const chunk of chunkArray(validRows, 500)) {
      const values = chunk.map((rowValidation) => {
        const schedule = scheduleMap.get(`${rowValidation.employeeId!}:${rowValidation.date!.getTime()}`);
        if (!schedule) {
          throw new Error(`Linha ${rowValidation.rowNumber} sem cronograma vinculado.`);
        }
        if (!isWorkHoursAllowedForSchedule(schedule)) {
          throw new Error(`Linha ${rowValidation.rowNumber}: ${workHoursBlockedReasonForSchedule(schedule)}`);
        }
        const planned = plannedFromSchedule(schedule);
        const status = calculateRecordStatus(planned.hours, rowValidation.actualHours!, true);
        const differenceMinutes = planned.hours === null ? null : calculateProductiveDifferenceMinutes(rowValidation.actualHours!, planned.hours);
        return Prisma.sql`(
          ${randomUUID()},
          ${rowValidation.employeeId!},
          ${schedule.id},
          ${rowValidation.wbLogin},
          ${rowValidation.date!},
          ${planned.start},
          ${planned.end},
          ${planned.hours},
          ${null},
          ${null},
          ${0},
          ${rowValidation.actualHours!},
          ${null},
          ${null},
          ${null},
          ${null},
          ${null},
          ${null},
          ${0},
          ${rowValidation.actualHours!},
          ${differenceMinutes},
          ${status}::"WorkHourRecordStatus",
          ${"upload-horas"},
          ${null},
          ${batch.id},
          NOW(),
          NOW()
        )`;
      });
      const saved = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        INSERT INTO "WorkHourRecord" (
          "id", "employeeId", "scheduleId", "wbLogin", "date", "plannedStart", "plannedEnd", "plannedHours",
          "actualStart", "actualEnd", "breakMinutes", "actualHours", "adjustedStart", "adjustedEnd", "adjustedBreakMinutes", "adjustedHours",
          "effectiveStart", "effectiveEnd", "effectiveBreakMinutes", "effectiveHours", "differenceMinutes", "status", "source",
          "observation", "importBatchId", "createdAt", "updatedAt"
        )
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("employeeId", "date") DO UPDATE SET
          "scheduleId" = EXCLUDED."scheduleId",
          "wbLogin" = EXCLUDED."wbLogin",
          "plannedStart" = EXCLUDED."plannedStart",
          "plannedEnd" = EXCLUDED."plannedEnd",
          "plannedHours" = EXCLUDED."plannedHours",
          "actualStart" = NULL,
          "actualEnd" = NULL,
          "breakMinutes" = EXCLUDED."breakMinutes",
          "actualHours" = EXCLUDED."actualHours",
          "adjustedStart" = NULL,
          "adjustedEnd" = NULL,
          "adjustedBreakMinutes" = NULL,
          "adjustedHours" = NULL,
          "effectiveStart" = NULL,
          "effectiveEnd" = NULL,
          "effectiveBreakMinutes" = EXCLUDED."effectiveBreakMinutes",
          "effectiveHours" = EXCLUDED."effectiveHours",
          "differenceMinutes" = EXCLUDED."differenceMinutes",
          "status" = EXCLUDED."status",
          "source" = EXCLUDED."source",
          "observation" = EXCLUDED."observation",
          "importBatchId" = EXCLUDED."importBatchId",
          "updatedAt" = NOW()
        RETURNING "id"
      `);
      importedRows += saved.length;
      if (saved.length) {
        await prisma.workHourHistory.createMany({
          data: saved.map((record, index) => ({
            workHourRecordId: record.id,
            changedById: user.id,
            action: chunk[index]?.action === "atualizar" ? "IMPORT_UPDATE" : "IMPORT_CREATE",
            previousValue: {},
            newValue: { importBatchId: batch.id, fileName: input.fileName },
            reason: `Importação de horas ${input.fileName}`
          }))
        });
      }
    }

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: AuditAction.IMPORTACAO,
        entity: "WorkHourImportBatch",
        entityId: batch.id,
        reason: `${importedRows} registro(s) de horas importado(s)`,
        newValue: { fileName: input.fileName, importedRows, totalRows: input.rows.length, chunks: Math.ceil(validRows.length / 500) }
      }
    });

    const result = {
      id: batch.id,
      fileName: batch.fileName,
      importedRows,
      createdRows: batch.createdRows,
      updatedRows: batch.updatedRows,
      status: batch.status,
      createdAt: formatDateTime(batch.createdAt)
    };

    return { data: result, preview: toImportPreview(input.rows, validation) };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "WORK_HOURS_IMPORT_ERROR", message: error instanceof Error ? error.message : "Falha ao importar horas", action: "WORK_HOURS_IMPORT", severity: "ERROR" });
    return mapPrismaError(error) ?? { error: error instanceof Error ? `Não foi possível importar horas operacionais: ${error.message}` : "Não foi possível importar horas operacionais." };
  }
}

export async function requestWorkHourAdjustment(actor: Actor, input: WorkHourAdjustmentInput) {
  const user = await getUser(actor);
  if (!user || !canRequestWorkHourAdjustment({ role: user.role.name, status: user.status })) return createPermissionError("Você não tem permissão para solicitar ajuste de horas.");

  const fieldErrors: Record<string, string> = {};
  if (!input.workHourRecordId) fieldErrors.workHourRecordId = "Registro de horas é obrigatório.";
  if (!input.reason?.trim()) fieldErrors.reason = "Motivo do ajuste é obrigatório.";
  if (!input.justification?.trim()) fieldErrors.justification = "Justificativa é obrigatória.";
  if (Object.keys(fieldErrors).length) return createValidationError(fieldErrors);

  try {
    const record = await prisma.workHourRecord.findUnique({
      where: { id: input.workHourRecordId },
      include: {
        employee: { include: { user: true, supervisor: true } },
        schedule: true,
        adjustments: { where: { status: { in: ["ABERTO", "EM_ANALISE"] } } }
      }
    });
    if (!record) return { error: "Registro de horas não encontrado." };
    if (!isWorkHoursAllowedForSchedule(record.schedule)) {
      return createValidationError({ scheduleId: workHoursBlockedReasonForSchedule(record.schedule) }, "Este status não permite ajuste de horas realizadas.");
    }
    const requestedHours = normalizeRequestedHours(input);
    if (requestedHours.error) {
      return createValidationError({ [requestedHours.field ?? "requestedActualHours"]: requestedHours.error });
    }

    const adjustmentDifferenceMinutes = calculateAdjustmentDifferenceMinutes(record.effectiveHours, requestedHours.hours!);
    const adjustment = await prisma.$transaction(async (tx) => {
      if (record.adjustments.length) {
        await tx.workHourAdjustmentRequest.updateMany({
          where: { workHourRecordId: record.id, status: { in: ["ABERTO", "EM_ANALISE"] } },
          data: { status: "CANCELADO", rejectionReason: "Substituído por nova solicitação de ajuste." }
        });
      }

      const created = await tx.workHourAdjustmentRequest.create({
        data: {
          workHourRecordId: record.id,
          employeeId: record.employeeId,
          requestedById: user.id,
          status: "EM_ANALISE",
          currentActualStart: null,
          currentActualEnd: null,
          currentBreakMinutes: 0,
          currentActualHours: record.effectiveHours,
          requestedActualStart: null,
          requestedActualEnd: null,
          requestedBreakMinutes: 0,
          requestedActualHours: requestedHours.hours!,
          reason: input.reason!.trim(),
          justification: input.justification!.trim()
        }
      });

      await tx.workHourRecord.update({
        where: { id: record.id },
        data: { status: "ADJUSTMENT_REQUESTED" }
      });
      await tx.workHourHistory.create({
        data: {
          workHourRecordId: record.id,
          changedById: user.id,
          action: "ADJUSTMENT_REQUESTED",
          previousValue: { status: record.status },
          newValue: {
            status: "ADJUSTMENT_REQUESTED",
            adjustmentId: created.id,
            currentActualHours: record.effectiveHours,
            requestedActualHours: requestedHours.hours,
            adjustmentDifferenceMinutes
          },
          reason: input.reason!.trim()
        }
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: AuditAction.CRIACAO,
          entity: "WorkHourAdjustmentRequest",
          entityId: created.id,
          reason: input.reason!.trim(),
          previousValue: { recordId: record.id, effectiveHours: record.effectiveHours },
          newValue: {
            requestedHours: requestedHours.hours,
            adjustmentDifferenceMinutes,
            reason: input.reason!.trim(),
            justification: input.justification!.trim()
          }
        }
      });

      return created;
    });

    notifyWorkHourAdjustmentApprovers(adjustment.id, user.name, record.employee.fullName).catch((error) => {
      recordErrorLog({
        userEmail: actor.email,
        code: "WORK_HOUR_ADJUSTMENT_NOTIFICATION_WARNING",
        message: error instanceof Error ? error.message : "Falha ao notificar aprovadores do ajuste de horas",
        action: "WORK_HOUR_ADJUSTMENT_NOTIFICATION",
        severity: "WARNING"
      });
    });

    return { success: true, message: "Ajuste de horas solicitado.", data: formatAdjustment(adjustment) };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "WORK_HOUR_ADJUSTMENT_CREATE_ERROR", message: error instanceof Error ? error.message : "Falha ao solicitar ajuste", action: "WORK_HOUR_ADJUSTMENT_CREATE", severity: "ERROR" });
    return mapPrismaError(error) ?? { error: "Não foi possível solicitar ajuste de horas." };
  }
}

export async function reviewWorkHourAdjustment(actor: Actor, input: WorkHourReviewInput) {
  const user = await getUser(actor);
  const role = normalizeRole(user?.role.name ?? actor.role);
  if (!user || !canApproveWorkHourAdjustment({ role: user.role.name, status: user.status })) {
    const reason = role === "SUPERVISOR" ? "Supervisor pode solicitar ajuste de horas, mas não pode alterar horas oficiais." : "Você não tem permissão para aprovar este ajuste.";
    await auditPermissionDenied(actor, { action: "WORK_HOUR_ADJUSTMENT_REVIEW", entity: "WorkHourAdjustmentRequest", reason, entityId: input.id });
    return createPermissionError(reason);
  }
  if (!input.id) return createValidationError({ id: "Ajuste é obrigatório." });
  if (input.action === "reject" && !input.rejectionReason?.trim()) return createValidationError({ rejectionReason: "Motivo da recusa é obrigatório." });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const adjustment = await tx.workHourAdjustmentRequest.findUnique({
        where: { id: input.id },
        include: { record: { include: { schedule: true } }, requestedBy: true, employee: { include: { user: true } } }
      });
      if (!adjustment) throw new Error("Ajuste não encontrado.");
      if (!["ABERTO", "EM_ANALISE"].includes(adjustment.status)) throw new Error("Este ajuste já foi processado.");

      if (input.action === "reject") {
        const updatedAdjustment = await tx.workHourAdjustmentRequest.update({
          where: { id: adjustment.id },
          data: { status: "RECUSADO", rejectedById: user.id, rejectedAt: new Date(), rejectionReason: input.rejectionReason!.trim() }
        });
        const updatedRecord = await tx.workHourRecord.update({
          where: { id: adjustment.workHourRecordId },
          data: { status: "ADJUSTMENT_REJECTED" }
        });
        await writeReviewHistory(tx, user.id, updatedRecord.id, "ADJUSTMENT_REJECTED", adjustment.record, updatedRecord, input.rejectionReason);
        await notifyReviewResult(tx, adjustment, "Ajuste de horas recusado", input.rejectionReason!.trim(), "Seu ajuste de horas foi recusado. Consulte seu supervisor para mais detalhes.");
        return { adjustment: updatedAdjustment, record: updatedRecord };
      }

      if (!isWorkHoursAllowedForSchedule(adjustment.record.schedule)) {
        throw new Error(workHoursBlockedReasonForSchedule(adjustment.record.schedule));
      }
      const plannedHours = productivePlannedHoursForRecord(adjustment.record);
      const nextDifference = plannedHours === null ? null : calculateProductiveDifferenceMinutes(adjustment.requestedActualHours, plannedHours);
      const updatedRecord = await tx.workHourRecord.update({
        where: { id: adjustment.workHourRecordId },
        data: {
          adjustedStart: null,
          adjustedEnd: null,
          adjustedBreakMinutes: 0,
          adjustedHours: adjustment.requestedActualHours,
          effectiveStart: null,
          effectiveEnd: null,
          effectiveBreakMinutes: 0,
          effectiveHours: adjustment.requestedActualHours,
          differenceMinutes: nextDifference,
          status: "ADJUSTMENT_APPROVED"
        }
      });
      const updatedAdjustment = await tx.workHourAdjustmentRequest.update({
        where: { id: adjustment.id },
        data: { status: "APROVADO", approvedById: user.id, approvedAt: new Date() }
      });
      await writeReviewHistory(tx, user.id, updatedRecord.id, "ADJUSTMENT_APPROVED", adjustment.record, updatedRecord, "Ajuste de horas aprovado");
      await notifyReviewResult(tx, adjustment, "Ajuste de horas aprovado", "A correção solicitada foi aprovada pelo WFM/Admin.");
      return { adjustment: updatedAdjustment, record: updatedRecord };
    });

    return {
      success: true,
      message: input.action === "approve" ? "Ajuste aprovado e horas efetivas atualizadas." : "Ajuste recusado.",
      data: { adjustment: formatAdjustment(result.adjustment), record: formatWorkHourRecord(await getRecordWithRelations(result.record.id), toWorkHourRecordViewer(user)) }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível processar ajuste.";
    if (message === "Este ajuste já foi processado." || message === "Ajuste não encontrado.") return { error: message };
    recordErrorLog({ userEmail: actor.email, code: "WORK_HOUR_ADJUSTMENT_REVIEW_ERROR", message, action: "WORK_HOUR_ADJUSTMENT_REVIEW", severity: "ERROR" });
    return mapPrismaError(error) ?? { error: "Não foi possível processar ajuste de horas." };
  }
}

export async function upsertManualWorkHourRecord(actor: Actor, input: ManualWorkHourInput) {
  const user = await getUser(actor);
  const role = normalizeRole(user?.role.name ?? actor.role);
  if (!user || !canEditWorkHours({ role: user.role.name, status: user.status })) {
    const reason = role === "SUPERVISOR" ? "Supervisor pode solicitar ajuste de horas, mas não pode alterar horas oficiais." : "Você não tem permissão para lançar horas.";
    await auditPermissionDenied(actor, { action: "WORK_HOURS_MANUAL_UPSERT", entity: "WorkHourRecord", reason, entityId: input.employeeId });
    return createPermissionError(reason);
  }

  const fieldErrors: Record<string, string> = {};
  if (!input.employeeId) fieldErrors.employeeId = "Parceiro é obrigatório.";
  const date = parseImportDate(input.date);
  if (!date) fieldErrors.date = "Data inválida.";
  const actualHours = parseHours(input.actualHours);
  if (!hasExcelValue(input.actualHours)) fieldErrors.actualHours = "Horas realizadas são obrigatórias.";
  else if (actualHours === null) fieldErrors.actualHours = "Horas realizadas inválidas. Use formato HH:mm, como 8:30, ou decimal, como 8,5.";
  if (Object.keys(fieldErrors).length) return createValidationError(fieldErrors, "Existem campos inválidos para lançar horas.");

  try {
    const employee = await prisma.employeeProfile.findFirst({
      where: { id: input.employeeId, deletedAt: null },
      include: { shift: true, lob: true, supervisor: true }
    });
    if (!employee) return createValidationError({ employeeId: "Parceiro não encontrado." }, "Parceiro não encontrado.");

    const schedule = await prisma.schedule.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: date! } }
    });
    if (!schedule) {
      return createValidationError({ scheduleId: "Não existe cronograma para este parceiro nesta data. Crie o cronograma antes de lançar horas." }, "Não é possível lançar horas sem cronograma vinculado.");
    }
    if (!isWorkHoursAllowedForSchedule(schedule)) {
      return createValidationError({ scheduleId: workHoursBlockedReasonForSchedule(schedule) }, workHoursBlockedReasonForSchedule(schedule));
    }
    const planned = plannedFromSchedule(schedule);
    if (planned.hours === null) {
      return createValidationError({ scheduleId: "Cronograma desta data não permite lançamento de horas produtivas." }, "Não é possível lançar horas neste cronograma.");
    }
    const existing = await prisma.workHourRecord.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: date! } }
    });
    if (existing && existing.source && !/^manual$/i.test(existing.source) && !input.confirmOverwrite) {
      return {
        error: "Já existe um registro de horas para este dia. Confirme se deseja atualizar.",
        type: "CONFIRMATION_REQUIRED",
        existing: formatWorkHourRecord(await getRecordWithRelations(existing.id), toWorkHourRecordViewer(user))
      };
    }

    const differenceMinutes = planned.hours === null ? null : calculateProductiveDifferenceMinutes(actualHours!, planned.hours);
    const baseStatus = calculateRecordStatus(planned.hours, actualHours!, true);
    const status: WorkHourRecordStatus = existing ? "MANUALLY_CORRECTED" : baseStatus;

    const saved = await prisma.$transaction(async (tx) => {
      const currentSchedule = await tx.schedule.findUnique({ where: { employeeId_date: { employeeId: employee.id, date: date! } } });
      if (!currentSchedule || currentSchedule.deletedAt || !isWorkHoursAllowedForSchedule(currentSchedule)
        || currentSchedule.id !== schedule.id || currentSchedule.status !== schedule.status
        || currentSchedule.startsAt !== schedule.startsAt || currentSchedule.endsAt !== schedule.endsAt) {
        throw new Error("O cronograma mudou. Atualize a tela antes de lançar horas.");
      }
      const currentEmployee = await tx.employeeProfile.findUnique({ where: { id: employee.id }, include: {
        lob: true, team: { select: { name: true } }, user: { select: { role: { select: { name: true } } } },
        skillAssignments: { include: { skill: true } }
      } });
      if (!currentEmployee) throw new Error("Parceiro não encontrado.");
      const record = await tx.workHourRecord.upsert({
        where: { employeeId_date: { employeeId: employee.id, date: date! } },
        update: {
          scheduleId: schedule.id,
          wbLogin: employee.wbLogin,
          plannedStart: planned.start,
          plannedEnd: planned.end,
          plannedHours: planned.hours,
          actualStart: null,
          actualEnd: null,
          breakMinutes: 0,
          actualHours: actualHours!,
          adjustedStart: null,
          adjustedEnd: null,
          adjustedBreakMinutes: null,
          adjustedHours: null,
          effectiveStart: null,
          effectiveEnd: null,
          effectiveBreakMinutes: 0,
          effectiveHours: actualHours!,
          differenceMinutes,
          status,
          source: "MANUAL",
          observation: null,
          importBatchId: null
        },
        create: {
          employeeId: employee.id,
          scheduleId: schedule.id,
          wbLogin: employee.wbLogin,
          date: date!,
          plannedStart: planned.start,
          plannedEnd: planned.end,
          plannedHours: planned.hours,
          actualStart: null,
          actualEnd: null,
          breakMinutes: 0,
          actualHours: actualHours!,
          effectiveStart: null,
          effectiveEnd: null,
          effectiveBreakMinutes: 0,
          effectiveHours: actualHours!,
          differenceMinutes,
          status,
          source: "MANUAL",
          observation: null
        }
      });

      await syncWorkHourAdherence(tx, {
        employee: currentEmployee, schedule: currentSchedule, date: date!, durationMs: Math.round(actualHours! * 3_600_000),
        actorId: user.id, hadOperationalHours: Boolean(existing), source: "MANUAL",
        sourceChanged: Boolean(existing && !/^manual$/i.test(existing.source ?? ""))
      });

      await tx.workHourHistory.create({
        data: {
          workHourRecordId: record.id,
          changedById: user.id,
          action: existing ? "MANUAL_UPDATE" : "MANUAL_CREATE",
          previousValue: serialize(existing),
          newValue: serialize(record),
          reason: "Lançamento manual pelo cronograma"
        }
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: AuditAction.EDICAO,
          entity: "WorkHourRecord",
          entityId: record.id,
          reason: "Lançamento manual de horas",
          previousValue: serialize(existing),
          newValue: serialize(record)
        }
      });

      return record;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return {
      success: true,
      message: existing ? "Horas atualizadas manualmente." : "Horas lançadas manualmente.",
      data: formatWorkHourRecord(await getRecordWithRelations(saved.id), toWorkHourRecordViewer(user))
    };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "WORK_HOUR_MANUAL_UPSERT_ERROR", message: error instanceof Error ? error.message : "Falha ao lançar horas", action: "WORK_HOUR_MANUAL_UPSERT", severity: "ERROR" });
    return mapPrismaError(error) ?? { error: "Não foi possível salvar as horas manuais." };
  }
}

export async function deleteWorkHourRecord(actor: Actor, input: DeleteWorkHourInput) {
  const user = await getUser(actor);
  const role = normalizeRole(user?.role.name ?? actor.role);
  if (!user || !canEditWorkHours({ role: user.role.name, status: user.status })) {
    const reason = role === "SUPERVISOR" ? "Supervisor pode solicitar ajuste de horas, mas não pode alterar horas oficiais." : "Você não tem permissão para excluir horas.";
    await auditPermissionDenied(actor, { action: "WORK_HOURS_DELETE", entity: "WorkHourRecord", reason, entityId: input.workHourRecordId });
    return createPermissionError(reason);
  }
  if (!input.workHourRecordId) return createValidationError({ workHourRecordId: "Registro de horas é obrigatório." }, "Registro de horas é obrigatório.");

  try {
    const record = await prisma.workHourRecord.findUnique({
      where: { id: input.workHourRecordId },
      include: {
        employee: { select: { id: true, fullName: true, wbLogin: true } },
        schedule: { select: { id: true, date: true, status: true, startsAt: true, endsAt: true } },
        adjustments: { select: { id: true, status: true, reason: true, requestedActualHours: true } },
        histories: { select: { id: true, action: true, createdAt: true } }
      }
    });
    if (!record) return createValidationError({ workHourRecordId: "Registro de horas não encontrado." }, "Registro de horas não encontrado.");

    const reason = input.reason?.trim() || "Exclusão manual de horas operacionais";
    await prisma.$transaction(async (tx) => {
      await cancelAdherenceForDeletedWorkHours(tx, {
        employeeId: record.employeeId, date: record.date, actorId: user.id, reason
      });
      await tx.workHourRecord.delete({ where: { id: record.id } });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: AuditAction.EXCLUSAO,
          entity: "WorkHourRecord",
          entityId: record.id,
          reason,
          previousValue: serialize(record),
          newValue: serialize(null)
        }
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return { success: true, message: "Registro de horas e pendências de aderência vinculadas excluídos." };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "WORK_HOUR_DELETE_ERROR", message: error instanceof Error ? error.message : "Falha ao excluir horas", action: "WORK_HOUR_DELETE", severity: "ERROR" });
    return mapPrismaError(error) ?? { error: "Não foi possível excluir o registro de horas." };
  }
}

export async function exportOperationalWorkHoursXlsxData(actor: Actor, query: WorkHourQuery = {}) {
  const user = await getUser(actor);
  if (!user || !canViewWorkHours({ role: user.role.name, status: user.status })) return createPermissionError("Você não tem permissão para exportar horas.");

  const period = resolvePeriod(query);
  const where = buildRecordWhere(user, query, period);
  // XLSX serialization is in-memory; refuse oversize files explicitly, never truncate.
  const expectedRows = await prisma.workHourRecord.count({ where });
  if (expectedRows > workHourExportMaxRows) {
    return { error: `A seleção contém ${expectedRows} registros. Divida o período em exportações de até ${workHourExportMaxRows} registros.`, status: 413 };
  }
  const data: ReturnType<typeof formatWorkHourRecord>[] = [];
  let afterId: string | undefined;
  const exportStartedAt = new Date();
  while (true) {
    const records = await prisma.workHourRecord.findMany({
      where: { AND: [where, { createdAt: { lte: exportStartedAt } }, ...(afterId ? [{ id: { gt: afterId } }] : [])] },
      orderBy: { id: "asc" }, take: workHourExportBatchSize, include: workHourReadInclude
    });
    if (!records.length) break;
    const capturedHours = await workHourReadData.capturedHours(records.map((record) => ({
      key: record.id, employeeId: record.employeeId, wbLogin: record.wbLogin, shiftDate: record.date
    })));
    data.push(...records.map((record) => formatWorkHourRecord(record, toWorkHourRecordViewer(user), capturedHours.get(record.id) ?? 0)));
    if (data.length > workHourExportMaxRows) {
      return { error: "A seleção excedeu o limite seguro de exportação. Divida o período e tente novamente.", status: 413 };
    }
    afterId = records.at(-1)!.id;
    if (records.length < workHourExportBatchSize) break;
  }
  // Reject a changing result set rather than silently deliver an incomplete workbook.
  if (data.length !== expectedRows) {
    return { error: "Os registros mudaram durante a exportação. Atualize os dados e tente novamente.", status: 409 };
  }
  data.sort((left, right) => right.date.localeCompare(left.date) || left.employeeName.localeCompare(right.employeeName));
  const headers = [
    "data",
    "nome",
    "wb_login",
    "status_colaborador",
    "lob",
    "supervisor",
    "turno",
    "horas_planejadas_produtivas",
    "horas_realizadas",
    "horas_captura",
    "divergencia",
    "status",
    "ajuste_solicitado",
    "diferenca_ajuste",
    "status_ajuste",
    "motivo_ajuste",
    "solicitado_por",
    "solicitado_em"
  ];
  const rows = data.map((row) => [
    row.date,
    row.employeeName,
    row.wbLogin,
    row.employeeStatus,
    row.lob,
    row.supervisor,
    row.shift,
    formatWorkHours(row.plannedHours),
    formatWorkHours(row.effectiveHours),
    formatWorkHours(row.capturedHours),
    formatHourDifferenceForExport(row.differenceMinutes),
    workHourBalanceStatus(row.plannedHours, row.differenceMinutes),
    row.adjustmentRequestedHours === null || row.adjustmentRequestedHours === undefined ? "" : formatWorkHours(row.adjustmentRequestedHours),
    formatHourDifferenceForExport(row.adjustmentDifferenceMinutes),
    row.adjustmentStatus === "Sem ajuste" ? "" : row.adjustmentStatus,
    row.adjustmentReason,
    row.adjustmentRequestedBy,
    row.adjustmentRequestedAt
  ]);

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: AuditAction.UPLOAD,
      entity: "WorkHourRecord",
      reason: "Exportação XLSX de horas operacionais",
      newValue: { filters: query, exportedRows: data.length }
    }
  }).catch(() => undefined);

  const start = formatDate(period.startDate);
  const end = formatDate(period.endDate);
  return {
    headers,
    rows,
    sheetName: "Horas",
    fileName: start === end ? `horas_operacionais_${start}.xlsx` : `horas_operacionais_${start}_a_${end}.xlsx`
  };
}

async function validateWorkHourRows(rows: Array<Record<string, unknown>>) {
  const duplicateKeys = new Map<string, number>();
  const normalizedRows = rows.map((rawRow, index) => {
    const row = normalizeWorkHourImportRow(rawRow);
    const originalWbLogin = text(row.wb_login);
    const normalizedWbLogin = normalizeWbLogin(originalWbLogin);
    const date = parseImportDate(row.data);
    const key = normalizedWbLogin && date ? `${normalizedWbLogin}:${formatDate(date)}` : "";
    if (key) duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1);
    return { row, rowNumber: index + 1, wbLogin: originalWbLogin, normalizedWbLogin, date, key };
  });

  const wbLogins = Array.from(new Set(normalizedRows.map((row) => row.normalizedWbLogin).filter(Boolean)));
  const employees = wbLogins.length ? await findWorkHourEmployeesByWbLoginBatch(wbLogins) : [];
  const employeeMap = new Map(employees.map((employee) => [normalizeWbLogin(employee.wbLogin), employee]));
  const missingWbLogins = wbLogins.filter((wbLogin) => !employeeMap.has(wbLogin));
  console.info("[work-hours-import:validation]", {
    totalRows: rows.length,
    uniqueWbLogins: wbLogins.length,
    firstNormalizedWbLogins: wbLogins.slice(0, 10),
    employeeProfilesFound: wbLogins.length - missingWbLogins.length,
    employeeProfilesMissing: missingWbLogins.length,
    firstMissingWbLogins: missingWbLogins.slice(0, 20)
  });
  const matchedEmployees = Array.from(new Map(
    normalizedRows
      .map((row) => row.normalizedWbLogin ? employeeMap.get(row.normalizedWbLogin) : null)
      .filter((employee): employee is (typeof employees)[number] => Boolean(employee && !employee.deletedAt))
      .map((employee) => [employee.id, employee])
  ).values());
  const employeeIds = matchedEmployees.map((employee) => employee.id);
  const dates = Array.from(new Set(normalizedRows.map((row) => row.date?.getTime()).filter((value): value is number => Boolean(value)))).map((value) => new Date(value));
  const [schedules, existingRecords] = await Promise.all([
    employeeIds.length && dates.length
      ? prisma.schedule.findMany({ where: { employeeId: { in: employeeIds }, date: { in: dates }, deletedAt: null } })
      : Promise.resolve([]),
    employeeIds.length && dates.length
      ? prisma.workHourRecord.findMany({ where: { employeeId: { in: employeeIds }, date: { in: dates } } })
      : Promise.resolve([])
  ]);
  const scheduleMap = new Map(schedules.map((schedule) => [`${schedule.employeeId}:${schedule.date.getTime()}`, schedule]));
  const recordMap = new Map(existingRecords.map((record) => [`${record.employeeId}:${record.date.getTime()}`, record]));

  return normalizedRows.map<ValidationRow>(({ row, rowNumber, wbLogin, normalizedWbLogin, date, key }) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!wbLogin) errors.push("WB/Login é obrigatório.");
    if (!hasExcelValue(row.data)) errors.push("Data é obrigatória.");
    else if (!date) errors.push("Data inválida. Use DD/MM/AAAA ou AAAA-MM-DD.");
    if (key && (duplicateKeys.get(key) ?? 0) > 1) errors.push("Linha duplicada no arquivo para o mesmo WB/Login + data.");

    const employee = normalizedWbLogin ? employeeMap.get(normalizedWbLogin) : null;
    const eligibleEmployee = employee && !employee.deletedAt ? employee : null;
    if (wbLogin && !employee) errors.push("WB/Login não encontrado na base de parceiros.");
    if (employee?.deletedAt) errors.push("Parceiro removido/deletado não pode receber horas.");
    if (eligibleEmployee && isInactiveEmployeeStatusForWorkHours(eligibleEmployee.operationalStatus)) warnings.push("Parceiro desligado/inativo encontrado. Horas permitidas para fins de invoice.");

    const hasActualHours = hasExcelValue(row.horas_realizadas);
    const actualHours = parseHours(row.horas_realizadas);
    if (!hasActualHours) errors.push("Horas realizadas são obrigatórias.");
    else if (actualHours === null) errors.push("Horas realizadas inválidas. Use formato HH:mm, como 8:30, ou decimal, como 8,5.");

    let schedule: Schedule | undefined;
    let existingRecordId: string | undefined;
    if (eligibleEmployee && date) {
      schedule = scheduleMap.get(`${eligibleEmployee.id}:${date.getTime()}`);
      existingRecordId = recordMap.get(`${eligibleEmployee.id}:${date.getTime()}`)?.id;
      if (!schedule) errors.push("Não existe cronograma para este parceiro nesta data. Importe ou crie o cronograma antes de subir as horas.");
      else if (!isWorkHoursAllowedForSchedule(schedule)) errors.push(workHoursBlockedReasonForSchedule(schedule));
      if (text(row.lob) && text(row.lob).toUpperCase() !== eligibleEmployee.lob.name.toUpperCase()) warnings.push("LOB no arquivo diferente da LOB do parceiro.");
      if (text(row.supervisor_wb_login) && normalizeWbLogin(row.supervisor_wb_login) !== normalizeWbLogin(eligibleEmployee.supervisor?.wbLogin)) warnings.push("Supervisor no arquivo diferente do supervisor do parceiro.");
      if (existingRecordId) warnings.push("Registro já existe e será atualizado.");
    }
    const allowsWorkHours = isWorkHoursAllowedForSchedule(schedule);
    const plannedHours = schedule ? plannedProductiveHoursForSchedule(schedule) : null;
    const differenceMinutes = actualHours !== null && plannedHours !== null ? calculateProductiveDifferenceMinutes(actualHours, plannedHours) : null;

    return {
      rowNumber,
      wbLogin: eligibleEmployee?.wbLogin ?? employee?.wbLogin ?? wbLogin,
      originalWbLogin: wbLogin,
      normalizedWbLogin,
      employeeId: eligibleEmployee?.id,
      employeeName: employee?.fullName,
      employeeStatus: employee?.operationalStatus,
      date: date ?? undefined,
      dateIso: date ? formatDate(date) : undefined,
      errors,
      warnings,
      action: errors.length ? "ignorar" : existingRecordId ? "atualizar" : "criar",
      hasSchedule: Boolean(schedule),
      allowsWorkHours,
      scheduleStatus: schedule?.status,
      existingRecordId,
      actualHours: actualHours ?? undefined,
      plannedHours,
      differenceMinutes
    };
  });
}

function toImportPreview(rows: Array<Record<string, unknown>>, validation: ValidationRow[]) {
  const uniqueNormalizedWbLogins = Array.from(new Set(validation.map((row) => row.normalizedWbLogin).filter(Boolean)));
  const foundNormalizedWbLogins = Array.from(new Set(validation.filter((row) => row.employeeId).map((row) => row.normalizedWbLogin).filter(Boolean)));
  const missingEmployeeRows = validation.filter((row) => row.normalizedWbLogin && !row.employeeId);
  return {
    message: uniqueNormalizedWbLogins.length && !foundNormalizedWbLogins.length
      ? "Nenhum WB/Login do arquivo foi encontrado no banco. Verifique se a base de parceiros foi importada no ambiente atual."
      : undefined,
    totalRows: rows.length,
    validRows: validation.filter((row) => !row.errors.length).length,
    errorRows: validation.filter((row) => row.errors.length).length,
    warningRows: validation.filter((row) => row.warnings.length).length,
    createdRows: validation.filter((row) => !row.errors.length && row.action === "criar").length,
    updatedRows: validation.filter((row) => !row.errors.length && row.action === "atualizar").length,
    foundEmployees: validation.filter((row) => row.employeeId).length,
    missingEmployees: missingEmployeeRows.length,
    uniqueWbLogins: uniqueNormalizedWbLogins.length,
    foundUniqueWbLogins: foundNormalizedWbLogins.length,
    missingWbLogins: Array.from(new Set(missingEmployeeRows.map((row) => row.normalizedWbLogin).filter(Boolean))).slice(0, 20),
    scheduleFoundRows: validation.filter((row) => row.hasSchedule).length,
    noScheduleRows: validation.filter((row) => !row.hasSchedule).length,
    rows: rows.map((row, index) => {
      const result = validation[index];
      return {
        wb_login: result?.originalWbLogin ?? row.wb_login,
        data: result?.dateIso ?? row.data,
        horas_realizadas: result?.actualHours === undefined ? row.horas_realizadas : formatWorkHours(result.actualHours)
      };
    }),
    validation: validation.map((row) => ({
      rowNumber: row.rowNumber,
      wbLogin: row.wbLogin,
      originalWbLogin: row.originalWbLogin ?? row.wbLogin,
      normalizedWbLogin: row.normalizedWbLogin ?? "",
      employeeName: row.employeeName ?? "",
      employeeStatus: row.employeeStatus ?? "",
      date: row.dateIso ?? "",
      hasSchedule: row.hasSchedule,
      allowsWorkHours: row.allowsWorkHours,
      scheduleStatus: row.scheduleStatus ?? "",
      actualHours: row.actualHours,
      actualHoursLabel: row.actualHours === undefined ? "" : formatWorkHours(row.actualHours),
      plannedHours: row.plannedHours,
      plannedHoursLabel: row.plannedHours === null || row.plannedHours === undefined ? "" : formatWorkHours(row.plannedHours),
      differenceMinutes: row.differenceMinutes,
      differenceLabel: row.differenceMinutes === null || row.differenceMinutes === undefined ? "" : formatHourDifferenceForExport(row.differenceMinutes),
      errors: row.errors,
      warnings: row.warnings,
      action: row.action,
      status: row.errors.length ? "Erro" : row.warnings.length ? "Alerta" : "Válida"
    }))
  };
}

function summarizeImportErrors(validation: ValidationRow[]) {
  const issues = validation
    .filter((row) => row.errors.length)
    .slice(0, 8)
    .map((row) => `Linha ${row.rowNumber}: ${row.errors.join(" ")}`);
  if (!issues.length) return "Revise os alertas do preview.";
  const remaining = validation.filter((row) => row.errors.length).length - issues.length;
  return `${issues.join(" | ")}${remaining > 0 ? ` | +${remaining} linha(s) com erro.` : ""}`;
}

function buildRecordWhere(user: UserWithRole, query: WorkHourQuery, period: { startDate: Date; endDate: Date }): Prisma.WorkHourRecordWhereInput {
  const role = normalizeRole(user.role.name);
  const where: Prisma.WorkHourRecordWhereInput = {
    date: { gte: period.startDate, lte: period.endDate },
    employee: { deletedAt: null }
  };
  if (role === "COLABORADOR" || query.scope === "mine") where.employeeId = user.employeeProfile?.id ?? "__none__";
  else if (query.employeeId) where.employeeId = query.employeeId;
  if (query.lob && query.lob !== "Todos") where.employee = { ...(where.employee as Prisma.EmployeeProfileWhereInput), lob: { name: query.lob } };
  if (query.supervisor && query.supervisor !== "Todos") {
    where.employee = {
      ...(where.employee as Prisma.EmployeeProfileWhereInput),
      ...(isNoSupervisorFilter(query.supervisor)
        ? { supervisorId: null }
        : { supervisor: { fullName: { contains: query.supervisor, mode: "insensitive" } } })
    };
  }
  const shiftWhere = workHourShiftCategoryWhere(query.shift);
  if (shiftWhere) where.AND = [shiftWhere];
  if (query.collaborator || query.wbLogin) {
    const search = query.collaborator || query.wbLogin || "";
    where.OR = [
      { wbLogin: { contains: search, mode: "insensitive" } },
      { employee: { fullName: { contains: search, mode: "insensitive" } } }
    ];
  }
  if (query.status && query.status !== "Todos") {
    if (query.status === "Hora extra") {
      where.status = { not: "NO_SCHEDULE" };
      where.differenceMinutes = { gt: 0 };
    } else if (query.status === "OK") {
      where.status = { not: "NO_SCHEDULE" };
      where.differenceMinutes = 0;
    } else if (query.status === "Horas pendentes") {
      where.status = { not: "NO_SCHEDULE" };
      where.differenceMinutes = { lt: 0 };
    } else if (query.status === "Sem cronograma") {
      where.status = "NO_SCHEDULE";
    } else if (query.status === "Ajuste solicitado") {
      where.adjustments = pendingWorkHourAdjustmentFilter();
    } else {
      where.status = uiToRecordStatus(query.status);
    }
  }
  if (query.divergentOnly) where.status = "DIVERGENT";
  if (query.pendingOnly) {
    delete where.status;
    where.adjustments = pendingWorkHourAdjustmentFilter();
  }
  if (query.overtimeOnly) {
    delete where.adjustments;
    where.status = { not: "NO_SCHEDULE" };
    where.differenceMinutes = { gt: 0 };
  }
  if (query.hoursPendingOnly) {
    delete where.adjustments;
    where.status = { not: "NO_SCHEDULE" };
    where.differenceMinutes = { lt: 0 };
  }
  if (query.noScheduleOnly) {
    delete where.adjustments;
    delete where.differenceMinutes;
    where.status = "NO_SCHEDULE";
  }
  const employeeStatusFilter = buildEmployeeStatusFilter(query.employeeStatus);
  if (employeeStatusFilter) where.employee = { AND: [where.employee as Prisma.EmployeeProfileWhereInput, employeeStatusFilter] };
  return where;
}

function pendingWorkHourAdjustmentFilter() {
  return { some: { status: { in: pendingWorkHourAdjustmentStatuses } } };
}

function isNoSupervisorFilter(value: string) {
  return /^(sem\s*supervisor|sem_supervisor|none|no_supervisor|null)$/i.test(value.trim());
}

function buildEmployeeStatusFilter(status?: string): Prisma.EmployeeProfileWhereInput | null {
  const rawStatus = text(status);
  const normalized = normalizeStatusToken(rawStatus);
  if (!normalized || normalized === "TODOS") return null;
  if (["ATIVO", "ATIVOS", "ACTIVE"].includes(normalized)) return { NOT: inactiveEmployeeStatusWhere() };
  if (["INATIVO", "INATIVOS", "DESATIVADO", "DESATIVADOS", "DESLIGADO", "DESLIGADOS", "DESLIGADOS_INATIVOS", "INATIVOS_DESLIGADOS"].includes(normalized)) {
    return inactiveEmployeeStatusWhere();
  }
  return { operationalStatus: { equals: rawStatus, mode: "insensitive" } };
}

function workHourShiftCategoryWhere(value?: string | null): Prisma.WorkHourRecordWhereInput | null {
  const category = shiftCategoryName(value);
  if (!category || category === "Todos") return null;
  if (category === "Sem turno") return { scheduleId: "__sem_turno__" };
  const shiftWhere = shiftNameCategoryWhere(category);
  if (!shiftWhere) return null;
  return {
    OR: [
      { schedule: { is: { shift: shiftWhere } } },
      { schedule: { is: { shiftId: null } }, employee: { shift: shiftWhere } },
      { scheduleId: null, employee: { shift: shiftWhere } }
    ]
  };
}

function shiftNameCategoryWhere(value?: string | null): Prisma.ShiftWhereInput | null {
  const category = shiftCategoryName(value);
  if (!category || category === "Todos" || category === "Sem turno") return null;
  return {
    OR: [
      { name: { equals: category, mode: "insensitive" } },
      { name: { startsWith: `${category} `, mode: "insensitive" } },
      { name: { startsWith: `${category}(`, mode: "insensitive" } }
    ]
  };
}

function inactiveEmployeeStatusWhere(): Prisma.EmployeeProfileWhereInput {
  return {
    OR: inactiveEmployeeStatusLabels.map((status) => ({
      operationalStatus: { equals: status, mode: "insensitive" as const }
    }))
  };
}

function isInactiveEmployeeStatusForWorkHours(status: unknown) {
  const normalized = normalizeStatusToken(status);
  return inactiveEmployeeStatusTokens.has(normalized) || ["INATIVO", "DESATIVADO", "DESLIGADO", "INACTIVE", "DISABLED", "TERMINATED", "SUSPENS"].some((token) => normalized.includes(token));
}

function normalizeStatusToken(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function getWorkHoursSummary(where: Prisma.WorkHourRecordWhereInput) {
  const [groups, adjustments] = await Promise.all([
    prisma.workHourRecord.groupBy({
      by: ["status", "differenceMinutes"],
      where,
      _count: { _all: true },
      _sum: { effectiveHours: true, adjustedHours: true }
    }),
    prisma.workHourAdjustmentRequest.groupBy({ by: ["status"], where: { record: { is: where } }, _count: { _all: true } }).catch(() => [])
  ]);
  return summarizeWorkHourGroups(groups, adjustments);
}

export function summarizeWorkHourGroups(groups: Array<{
  status: string; differenceMinutes: number | null;
  _count: { _all: number }; _sum: { effectiveHours: number | null; adjustedHours: number | null };
}>, adjustments: Array<{ status: WorkHourAdjustmentStatus; _count: { _all: number } }>) {
  let productiveCount = 0;
  let effectiveHours = 0;
  let adjustedHours = 0;
  let okRecords = 0;
  let divergentRecords = 0;
  let noScheduleRecords = 0;
  let overtimeMinutes = 0;
  let pendingMinutes = 0;
  for (const group of groups) {
    const count = group._count._all;
    if (group.status === "NO_SCHEDULE") { noScheduleRecords += count; continue; }
    productiveCount += count;
    effectiveHours += Number(group._sum.effectiveHours ?? 0);
    adjustedHours += Number(group._sum.adjustedHours ?? 0);
    if (group.differenceMinutes === null) continue;
    if (Math.abs(group.differenceMinutes) <= toleranceMinutes) okRecords += count;
    else divergentRecords += count;
    if (group.differenceMinutes > 0) overtimeMinutes += group.differenceMinutes * count;
    if (group.differenceMinutes < 0) pendingMinutes += group.differenceMinutes * count;
  }
  const adjustmentCount = (status: WorkHourAdjustmentStatus) => adjustments.find((item) => item.status === status)?._count._all ?? 0;
  const plannedHours = productiveCount * DEFAULT_PRODUCTIVE_HOURS;
  return {
    plannedHours: roundHours(plannedHours),
    actualHours: roundHours(effectiveHours),
    differenceHours: roundHours(effectiveHours - plannedHours),
    okRecords,
    divergentRecords,
    overtimeHours: roundHours(overtimeMinutes / 60),
    pendingHours: roundHours(Math.abs(pendingMinutes) / 60),
    noScheduleRecords,
    pendingAdjustments: adjustmentCount("ABERTO") + adjustmentCount("EM_ANALISE"),
    approvedAdjustments: adjustmentCount("APROVADO"),
    rejectedAdjustments: adjustmentCount("RECUSADO"),
    adjustedHours: roundHours(adjustedHours)
  };
}

async function notifyWorkHourAdjustmentApprovers(adjustmentId: string, requesterName: string, employeeName: string) {
  const approvers = await prisma.user.findMany({ where: { status: "ACTIVE", role: { name: { in: approvalRoles } } }, select: { id: true } });
  if (!approvers.length) return;
  await prisma.notification.createMany({
    data: approvers.map((approver) => ({
      userId: approver.id,
      title: "Novo ajuste de horas aguardando análise",
      body: `${requesterName} solicitou ajuste para ${employeeName}.`,
      category: "Horas Operacionais",
      type: "INFO" as const,
      entity: "WorkHourAdjustmentRequest",
      entityId: adjustmentId,
      href: "/horas-operacionais"
    }))
  });
}

function productivePlannedHoursForRecord(record: { plannedHours?: number | null; schedule?: { status?: string | null; startsAt?: string | null; endsAt?: string | null } | null }) {
  if (record.schedule?.status) return plannedProductiveHoursForSchedule(record.schedule);
  return null;
}

function displayWorkHourStatus(status: WorkHourRecordStatus, plannedHours: number | null, differenceMinutes: number | null): WorkHourRecordStatus {
  if (["ADJUSTMENT_REQUESTED", "ADJUSTMENT_APPROVED", "ADJUSTMENT_REJECTED", "MANUALLY_CORRECTED"].includes(status)) return status;
  if (plannedHours === null || differenceMinutes === null) return "NO_SCHEDULE";
  return isProductiveDifferenceWithinTolerance(differenceMinutes) ? "OK" : "DIVERGENT";
}

async function getRecordWithRelations(id: string) {
  return prisma.workHourRecord.findUniqueOrThrow({
    where: { id },
    include: {
      employee: { select: { id: true, fullName: true, wbLogin: true, operationalStatus: true, roleTitle: true, lob: { select: { name: true } }, shift: { select: { name: true } }, supervisor: { select: { id: true, fullName: true, wbLogin: true } } } },
      adjustments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          currentActualHours: true,
          requestedActualHours: true,
          requestedById: true,
          reason: true,
          justification: true,
          rejectionReason: true,
          rejectedAt: true,
          createdAt: true,
          requestedBy: { select: { name: true } },
          rejectedBy: { select: { name: true } }
        }
      },
      schedule: { select: { status: true, startsAt: true, endsAt: true } }
    }
  });
}

function formatWorkHourRecord(record: any, viewer?: WorkHourRecordViewer, capturedHours = 0) {
  const adjustment = record.adjustments?.[0];
  const canSeeRejectionDetails = canSeeWorkHourAdjustmentRejectionReason(viewer, adjustment);
  const adjustmentDifferenceMinutes = adjustment
    ? calculateAdjustmentDifferenceMinutes(adjustment.currentActualHours ?? record.effectiveHours, adjustment.requestedActualHours)
    : null;
  const plannedHours = productivePlannedHoursForRecord(record);
  const differenceMinutes = plannedHours === null ? record.differenceMinutes ?? 0 : calculateProductiveDifferenceMinutes(record.effectiveHours, plannedHours);
  const status = displayWorkHourStatus(record.status, plannedHours, differenceMinutes);
  return {
    id: record.id,
    employeeId: record.employeeId,
    employeeName: record.employee?.fullName ?? "",
    wbLogin: record.wbLogin,
    employeeStatus: record.employee?.operationalStatus ?? "",
    date: formatDate(record.date),
    lob: record.employee?.lob?.name ?? "",
    supervisor: record.employee?.supervisor?.fullName ?? "",
    shift: cleanShiftName(record.employee?.shift?.name) || "",
    plannedStart: record.plannedStart ?? "",
    plannedEnd: record.plannedEnd ?? "",
    plannedHours: plannedHours ?? 0,
    actualHours: record.actualHours,
    adjustedHours: record.adjustedHours ?? 0,
    effectiveHours: record.effectiveHours,
    capturedHours,
    differenceMinutes,
    status: recordStatusLabel(status),
    rawStatus: status,
    adjustmentId: adjustment?.id ?? "",
    adjustmentStatus: adjustment ? adjustmentStatusLabel(adjustment.status) : "Sem ajuste",
    adjustmentCurrentHours: adjustment?.currentActualHours ?? null,
    adjustmentRequestedHours: adjustment?.requestedActualHours ?? null,
    adjustmentDifferenceMinutes,
    adjustmentReason: adjustment?.reason ?? "",
    adjustmentJustification: adjustment?.justification ?? "",
    adjustmentRejectionReason: canSeeRejectionDetails ? adjustment?.rejectionReason ?? "" : "",
    adjustmentRejectedBy: canSeeRejectionDetails ? adjustment?.rejectedBy?.name ?? "" : "",
    adjustmentRejectedAt: canSeeRejectionDetails && adjustment?.rejectedAt ? formatDateTime(adjustment.rejectedAt) : "",
    adjustmentRequestedBy: adjustment?.requestedBy?.name ?? "",
    adjustmentRequestedAt: adjustment ? formatDateTime(adjustment.createdAt) : "",
    source: record.source ?? "",
    createdAt: formatDateTime(record.createdAt),
    updatedAt: formatDateTime(record.updatedAt)
  };
}

function canSeeWorkHourAdjustmentRejectionReason(viewer: WorkHourRecordViewer | undefined, adjustment: any) {
  if (!viewer || !adjustment?.rejectionReason) return false;
  if (canApproveWorkHourAdjustment({ role: viewer.roleName, status: "ACTIVE" })) return true;
  if (adjustment.requestedById && adjustment.requestedById === viewer.id) return true;
  return false;
}

function formatAdjustment(adjustment: {
  id: string;
  status: WorkHourAdjustmentStatus;
  currentActualHours?: number | null;
  requestedActualHours?: number | null;
  reason: string;
  justification?: string | null;
  createdAt: Date;
}) {
  return {
    id: adjustment.id,
    status: adjustmentStatusLabel(adjustment.status),
    currentActualHours: adjustment.currentActualHours ?? null,
    requestedActualHours: adjustment.requestedActualHours ?? null,
    adjustmentDifferenceMinutes: calculateAdjustmentDifferenceMinutes(adjustment.currentActualHours, adjustment.requestedActualHours),
    reason: adjustment.reason,
    justification: adjustment.justification ?? "",
    createdAt: formatDateTime(adjustment.createdAt)
  };
}

function calculateAdjustmentDifferenceMinutes(currentHours: number | null | undefined, requestedHours: number | null | undefined) {
  if (currentHours === null || currentHours === undefined || requestedHours === null || requestedHours === undefined) return null;
  return Math.round((requestedHours - currentHours) * 60);
}

async function writeReviewHistory(tx: Prisma.TransactionClient, userId: string, recordId: string, action: string, before: unknown, after: unknown, reason?: string) {
  await tx.workHourHistory.create({
    data: { workHourRecordId: recordId, changedById: userId, action, previousValue: serialize(before), newValue: serialize(after), reason }
  });
  await tx.auditLog.create({
    data: { actorId: userId, action: AuditAction.APROVACAO, entity: "WorkHourAdjustmentRequest", entityId: recordId, reason, previousValue: serialize(before), newValue: serialize(after) }
  });
}

async function notifyReviewResult(tx: Prisma.TransactionClient, adjustment: any, title: string, requesterBody: string, employeeBody = requesterBody) {
  const adjustmentDate = adjustment.record?.date ? formatDate(adjustment.record.date) : "";
  const hrefParams = new URLSearchParams();
  if (adjustmentDate) {
    hrefParams.set("startDate", adjustmentDate);
    hrefParams.set("endDate", adjustmentDate);
  }
  if (adjustment.employeeId) hrefParams.set("employeeId", adjustment.employeeId);
  const href = `/horas-operacionais${hrefParams.size ? `?${hrefParams.toString()}` : ""}`;
  const notifications = [
    adjustment.requestedById ? { userId: adjustment.requestedById, body: requesterBody } : null,
    adjustment.employee?.userId ? { userId: adjustment.employee.userId, body: adjustment.employee.userId === adjustment.requestedById ? requesterBody : employeeBody } : null
  ].filter((item): item is { userId: string; body: string } => Boolean(item?.userId));
  const uniqueNotifications = Array.from(new Map(notifications.map((item) => [item.userId, item])).values());
  for (const notification of uniqueNotifications) {
    await tx.notification.create({
      data: { userId: notification.userId, title, body: notification.body, category: "Horas Operacionais", type: "INFO", entity: "WorkHourAdjustmentRequest", entityId: adjustment.id, href }
    });
  }
}

function normalizeRequestedHours(input: WorkHourAdjustmentInput): {
  hours?: number;
  error?: string;
  field?: string;
} {
  const explicit = parseHours(input.requestedActualHours);
  if (explicit !== null) return { hours: explicit };
  if (hasExcelValue(input.requestedActualHours)) return { error: "Horas solicitadas inválidas. Use formato HH:mm, como 8:30, ou decimal, como 8,5.", field: "requestedActualHours" };
  return { error: "Nova hora solicitada é obrigatória.", field: "requestedActualHours" };
}

function plannedFromSchedule(schedule: Schedule) {
  return {
    start: schedule.startsAt,
    end: schedule.endsAt,
    hours: plannedProductiveHoursForSchedule(schedule)
  };
}

function calculateRecordStatus(plannedHours: number | null, actualHours: number, hasSchedule: boolean): WorkHourRecordStatus {
  if (!hasSchedule || plannedHours === null) return "NO_SCHEDULE";
  const difference = calculateProductiveDifferenceMinutes(actualHours, plannedHours);
  return isProductiveDifferenceWithinTolerance(difference, toleranceMinutes) ? "OK" : "DIVERGENT";
}

function currentOperationalMonthBounds() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  return {
    startDate: new Date(Date.UTC(year, month - 1, 1)),
    endDate: new Date(Date.UTC(year, month, 0))
  };
}

function resolvePeriod(query: WorkHourQuery) {
  const defaultPeriod = currentOperationalMonthBounds();
  const startDate = parseImportDate(query.startDate) ?? defaultPeriod.startDate;
  const endDate = parseImportDate(query.endDate) ?? defaultPeriod.endDate;
  endDate.setUTCHours(23, 59, 59, 999);
  return { startDate, endDate };
}

async function getUser(actor: Actor) {
  return prisma.user.findUnique({ where: { email: actor.email }, include: { role: true, employeeProfile: true } });
}

function toWorkHourRecordViewer(user: UserWithRole): WorkHourRecordViewer {
  return {
    id: user.id,
    roleName: user.role.name,
    employeeProfileId: user.employeeProfile?.id ?? null
  };
}

function uiToRecordStatus(status: string): WorkHourRecordStatus | undefined {
  const map: Record<string, WorkHourRecordStatus> = {
    Importado: "IMPORTED",
    OK: "OK",
    Divergente: "DIVERGENT",
    "Sem escala": "NO_SCHEDULE",
    "Sem cronograma": "NO_SCHEDULE",
    "Sem horas": "MISSING_WORK_HOURS",
    "Ajuste solicitado": "ADJUSTMENT_REQUESTED",
    "Ajuste aprovado": "ADJUSTMENT_APPROVED",
    "Ajuste recusado": "ADJUSTMENT_REJECTED",
    "Corrigido manualmente": "MANUALLY_CORRECTED"
  };
  return map[status];
}

function recordStatusLabel(status: WorkHourRecordStatus) {
  const labels: Record<WorkHourRecordStatus, string> = {
    IMPORTED: "Importado",
    OK: "OK",
    DIVERGENT: "Divergente",
    NO_SCHEDULE: "Sem cronograma",
    MISSING_WORK_HOURS: "Sem horas",
    ADJUSTMENT_REQUESTED: "Ajuste solicitado",
    ADJUSTMENT_APPROVED: "Ajuste aprovado",
    ADJUSTMENT_REJECTED: "Ajuste recusado",
    MANUALLY_CORRECTED: "Corrigido manualmente"
  };
  return labels[status] ?? status;
}

function adjustmentStatusLabel(status: WorkHourAdjustmentStatus) {
  const labels: Record<WorkHourAdjustmentStatus, string> = {
    ABERTO: "Aberto",
    EM_ANALISE: "Em análise",
    APROVADO: "Aprovado",
    RECUSADO: "Recusado",
    CANCELADO: "Cancelado"
  };
  return labels[status] ?? status;
}

function parseImportDate(value: unknown) {
  return normalizeExcelDate(value);
}

function parseHours(value: unknown) {
  const minutes = parseWorkHoursToMinutes(value);
  return minutes === null ? null : roundHours(workHoursFromMinutes(minutes));
}

function normalizeWorkHourImportRow(row: Record<string, unknown>) {
  return Object.entries(row).reduce<Record<string, unknown>>((normalized, [key, value]) => {
    const normalizedKey = normalizeExcelHeaderKey(key);
    const canonicalKey = workHourColumnAliases[normalizedKey] ?? normalizedKey;
    if (!hasExcelValue(normalized[canonicalKey]) || hasExcelValue(value)) normalized[canonicalKey] = value;
    return normalized;
  }, {});
}

function normalizeExcelHeaderKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeWbLogin(value: unknown) {
  return text(value)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function text(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .trim();
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

async function findWorkHourEmployeesByWbLoginBatch(normalizedWbLogins: string[]) {
  const chunks = chunkArray(normalizedWbLogins, 500);
  const results = await Promise.all(
    chunks.map((chunk) =>
      prisma.employeeProfile.findMany({
        where: {
          OR: chunk.map((wbLogin) => ({ wbLogin: { equals: wbLogin, mode: "insensitive" as const } }))
        },
        include: { lob: true, supervisor: true, shift: true }
      })
    )
  );
  return Array.from(new Map(results.flat().map((employee) => [employee.id, employee])).values());
}

function roundHours(value: number) {
  return Math.round(value * 100) / 100;
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(date);
}

function formatHourDifferenceForExport(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) return "";
  return formatSignedMinutesToHHMM(minutes);
}

function serialize(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null));
}
