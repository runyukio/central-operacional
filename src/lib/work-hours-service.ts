import { randomUUID } from "crypto";
import {
  AuditAction,
  Prisma,
  type Schedule,
  type WorkHourAdjustmentStatus,
  type WorkHourRecordStatus
} from "@prisma/client";

import { createPermissionError, createValidationError, mapPrismaError } from "@/lib/api-errors";
import { hasExcelValue, normalizeExcelDate } from "@/lib/excel-normalization";
import type { Actor } from "@/lib/mock-db";
import { recordErrorLog } from "@/lib/mock-db";
import { normalizeRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { cleanShiftName, shiftCategoryName } from "@/lib/shift-display";
import {
  DEFAULT_PRODUCTIVE_HOURS,
  WORK_HOUR_TOLERANCE_MINUTES,
  calculateProductiveDifferenceMinutes,
  isProductiveDifferenceWithinTolerance,
  isWorkHoursAllowedForSchedule,
  plannedProductiveHoursForSchedule,
  workHoursBlockedReasonForSchedule
} from "@/lib/work-hours-rules";

const uploadRoles = ["ADMIN", "GESTOR", "WFM"];
const approvalRoles = ["ADMIN", "GESTOR", "WFM"];
const manualEditRoles = ["ADMIN", "GESTOR", "WFM"];
const viewRoles = ["ADMIN", "GESTOR", "WFM", "SUPERVISOR", "COLABORADOR"];
const requestAdjustmentRoles = ["ADMIN", "GESTOR", "WFM", "SUPERVISOR"];
const toleranceMinutes = WORK_HOUR_TOLERANCE_MINUTES;
const workHourExportLimit = 10000;
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

type UserWithRole = Prisma.UserGetPayload<{ include: { role: true; employeeProfile: true } }>;

export type WorkHourQuery = {
  startDate?: string;
  endDate?: string;
  lob?: string;
  supervisor?: string;
  shift?: string;
  collaborator?: string;
  wbLogin?: string;
  employeeStatus?: string;
  status?: string;
  divergentOnly?: boolean;
  pendingOnly?: boolean;
  noScheduleOnly?: boolean;
  source?: string;
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
  observation?: string;
  source?: string;
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
  source?: string;
  observation?: string;
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
  sistema_origem: "sistema_origem",
  sistemaorigem: "sistema_origem",
  origem: "sistema_origem",
  source: "sistema_origem",
  observacao: "observacao",
  observacoes: "observacao",
  obs: "observacao",
  observation: "observacao",
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
    if (!viewRoles.includes(role)) return createPermissionError("Você não tem permissão para visualizar horas operacionais.");

    const period = resolvePeriod(query);
    const page = Math.max(1, Number(query.page) || 1);
    const requestedLimit = Number(query.limit) || 50;
    const maxLimit = requestedLimit > 100 ? workHourExportLimit : 100;
    const limit = Math.min(maxLimit, Math.max(10, requestedLimit));
    const where = buildRecordWhere(user, query, period);

    const [records, total] = await prisma.$transaction([
      prisma.workHourRecord.findMany({
        where,
        orderBy: [{ date: "desc" }, { employee: { fullName: "asc" } }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          employee: {
            select: {
              id: true,
              fullName: true,
              wbLogin: true,
              operationalStatus: true,
              roleTitle: true,
              lob: { select: { name: true } },
              shift: { select: { name: true } },
              supervisor: { select: { id: true, fullName: true, wbLogin: true } }
            }
          },
          adjustments: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              status: true,
              currentActualHours: true,
              requestedActualHours: true,
              reason: true,
              justification: true,
              rejectionReason: true,
              createdAt: true,
              requestedBy: { select: { name: true } }
            }
          },
          schedule: { select: { status: true, startsAt: true, endsAt: true } }
        }
      }),
      prisma.workHourRecord.count({ where })
    ]);

    const summary = await getWorkHoursSummary(where);

    return {
      data: records.map(formatWorkHourRecord),
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
  if (!user || !uploadRoles.includes(normalizeRole(user.role.name))) {
    return toImportPreview(rows, rows.map((_, index) => ({
      rowNumber: index + 1,
      wbLogin: text(rows[index]?.wb_login),
      errors: ["Você não tem permissão para importar horas."],
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
  if (!user || !uploadRoles.includes(normalizeRole(user.role.name))) return createPermissionError("Você não tem permissão para importar horas.");

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
          ${rowValidation.source || "upload-horas"},
          ${rowValidation.observation || null},
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
  if (!user || !requestAdjustmentRoles.includes(normalizeRole(user.role.name))) return createPermissionError("Você não tem permissão para solicitar ajuste de horas.");

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
    if (record.adjustments.length) return { error: "Já existe ajuste pendente para este registro." };
    const requestedHours = normalizeRequestedHours(input);
    if (requestedHours.error) {
      return createValidationError({ [requestedHours.field ?? "requestedActualHours"]: requestedHours.error });
    }

    const adjustmentDifferenceMinutes = calculateAdjustmentDifferenceMinutes(record.effectiveHours, requestedHours.hours!);
    const adjustment = await prisma.$transaction(async (tx) => {
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
  if (!user || !approvalRoles.includes(normalizeRole(user.role.name))) return createPermissionError("Você não tem permissão para aprovar este ajuste.");
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
        await notifyReviewResult(tx, adjustment, "Ajuste de horas recusado", input.rejectionReason!.trim());
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
      data: { adjustment: formatAdjustment(result.adjustment), record: formatWorkHourRecord(await getRecordWithRelations(result.record.id)) }
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
  if (!user || !manualEditRoles.includes(normalizeRole(user.role.name))) return createPermissionError("Você não tem permissão para lançar horas.");

  const fieldErrors: Record<string, string> = {};
  if (!input.employeeId) fieldErrors.employeeId = "Colaborador é obrigatório.";
  const date = parseImportDate(input.date);
  if (!date) fieldErrors.date = "Data inválida.";
  const actualHours = parseHours(input.actualHours);
  if (!hasExcelValue(input.actualHours)) fieldErrors.actualHours = "Horas realizadas são obrigatórias.";
  else if (actualHours === null) fieldErrors.actualHours = "Horas realizadas inválidas. Horas realizadas devem ser um número ou formato HH:mm.";
  if (Object.keys(fieldErrors).length) return createValidationError(fieldErrors, "Existem campos inválidos para lançar horas.");

  try {
    const employee = await prisma.employeeProfile.findFirst({
      where: { id: input.employeeId, deletedAt: null },
      include: { shift: true, lob: true, supervisor: true }
    });
    if (!employee) return createValidationError({ employeeId: "Colaborador não encontrado." }, "Colaborador não encontrado.");

    const schedule = await prisma.schedule.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: date! } }
    });
    if (!schedule) {
      return createValidationError({ scheduleId: "Não existe cronograma para este colaborador nesta data. Crie o cronograma antes de lançar horas." }, "Não é possível lançar horas sem cronograma vinculado.");
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
        existing: formatWorkHourRecord(await getRecordWithRelations(existing.id))
      };
    }

    const differenceMinutes = planned.hours === null ? null : calculateProductiveDifferenceMinutes(actualHours!, planned.hours);
    const baseStatus = calculateRecordStatus(planned.hours, actualHours!, true);
    const status: WorkHourRecordStatus = existing ? "MANUALLY_CORRECTED" : baseStatus;

    const saved = await prisma.$transaction(async (tx) => {
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
          observation: input.observation?.trim() || null,
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
          observation: input.observation?.trim() || null
        }
      });

      await tx.workHourHistory.create({
        data: {
          workHourRecordId: record.id,
          changedById: user.id,
          action: existing ? "MANUAL_UPDATE" : "MANUAL_CREATE",
          previousValue: serialize(existing),
          newValue: serialize(record),
          reason: input.observation?.trim() || "Lançamento manual pelo cronograma"
        }
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: AuditAction.EDICAO,
          entity: "WorkHourRecord",
          entityId: record.id,
          reason: input.observation?.trim() || "Lançamento manual de horas",
          previousValue: serialize(existing),
          newValue: serialize(record)
        }
      });

      return record;
    });

    return {
      success: true,
      message: existing ? "Horas atualizadas manualmente." : "Horas lançadas manualmente.",
      data: formatWorkHourRecord(await getRecordWithRelations(saved.id))
    };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "WORK_HOUR_MANUAL_UPSERT_ERROR", message: error instanceof Error ? error.message : "Falha ao lançar horas", action: "WORK_HOUR_MANUAL_UPSERT", severity: "ERROR" });
    return mapPrismaError(error) ?? { error: "Não foi possível salvar as horas manuais." };
  }
}

export async function deleteWorkHourRecord(actor: Actor, input: DeleteWorkHourInput) {
  const user = await getUser(actor);
  if (!user || !manualEditRoles.includes(normalizeRole(user.role.name))) return createPermissionError("Você não tem permissão para excluir horas.");
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
    });

    return { success: true, message: "Registro de horas excluído." };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "WORK_HOUR_DELETE_ERROR", message: error instanceof Error ? error.message : "Falha ao excluir horas", action: "WORK_HOUR_DELETE", severity: "ERROR" });
    return mapPrismaError(error) ?? { error: "Não foi possível excluir o registro de horas." };
  }
}

export async function exportOperationalWorkHoursXlsxData(actor: Actor, query: WorkHourQuery = {}) {
  const user = await getUser(actor);
  if (!user || !["ADMIN", "GESTOR", "WFM", "SUPERVISOR"].includes(normalizeRole(user.role.name))) return createPermissionError("Você não tem permissão para exportar horas.");

  const period = resolvePeriod(query);
  const result = await listOperationalWorkHours(actor, { ...query, page: 1, limit: workHourExportLimit });
  if ("error" in result) return result;
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
    "divergencia",
    "status",
    "sistema_origem",
    "observacao",
    "ajuste_solicitado",
    "diferenca_ajuste",
    "status_ajuste",
    "motivo_ajuste",
    "solicitado_por",
    "solicitado_em"
  ];
  const rows = result.data.map((row) => [
    row.date,
    row.employeeName,
    row.wbLogin,
    row.employeeStatus,
    row.lob,
    row.supervisor,
    row.shift,
    row.plannedHours,
    row.effectiveHours,
    formatHourDifferenceForExport(row.differenceMinutes),
    row.status,
    row.source,
    row.observation,
    row.adjustmentRequestedHours ?? "",
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
      newValue: { filters: query, exportedRows: result.data.length }
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
    if (wbLogin && !employee) errors.push("WB/Login não encontrado na base de funcionários.");
    if (employee?.deletedAt) errors.push("Colaborador removido/deletado não pode receber horas.");
    if (eligibleEmployee && isInactiveEmployeeStatusForWorkHours(eligibleEmployee.operationalStatus)) warnings.push("Colaborador desligado/inativo encontrado. Horas permitidas para fins de invoice.");

    const hasActualHours = hasExcelValue(row.horas_realizadas);
    const actualHours = parseHours(row.horas_realizadas);
    if (!hasActualHours) errors.push("Horas realizadas são obrigatórias.");
    else if (actualHours === null) errors.push("Horas realizadas inválidas. Horas realizadas devem ser um número ou formato HH:mm.");

    let schedule: Schedule | undefined;
    let existingRecordId: string | undefined;
    if (eligibleEmployee && date) {
      schedule = scheduleMap.get(`${eligibleEmployee.id}:${date.getTime()}`);
      existingRecordId = recordMap.get(`${eligibleEmployee.id}:${date.getTime()}`)?.id;
      if (!schedule) errors.push("Não existe cronograma para este colaborador nesta data. Importe ou crie o cronograma antes de subir as horas.");
      else if (!isWorkHoursAllowedForSchedule(schedule)) errors.push(workHoursBlockedReasonForSchedule(schedule));
      if (text(row.lob) && text(row.lob).toUpperCase() !== eligibleEmployee.lob.name.toUpperCase()) warnings.push("LOB no arquivo diferente da LOB do colaborador.");
      if (text(row.supervisor_wb_login) && normalizeWbLogin(row.supervisor_wb_login) !== normalizeWbLogin(eligibleEmployee.supervisor?.wbLogin)) warnings.push("Supervisor no arquivo diferente do supervisor do colaborador.");
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
      differenceMinutes,
      source: text(row.sistema_origem) || "upload-horas",
      observation: text(row.observacao)
    };
  });
}

function toImportPreview(rows: Array<Record<string, unknown>>, validation: ValidationRow[]) {
  const uniqueNormalizedWbLogins = Array.from(new Set(validation.map((row) => row.normalizedWbLogin).filter(Boolean)));
  const foundNormalizedWbLogins = Array.from(new Set(validation.filter((row) => row.employeeId).map((row) => row.normalizedWbLogin).filter(Boolean)));
  const missingEmployeeRows = validation.filter((row) => row.normalizedWbLogin && !row.employeeId);
  return {
    message: uniqueNormalizedWbLogins.length && !foundNormalizedWbLogins.length
      ? "Nenhum WB/Login do arquivo foi encontrado no banco. Verifique se a base de funcionários foi importada no ambiente atual."
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
        ...row,
        wb_login: result?.originalWbLogin ?? row.wb_login,
        data: result?.dateIso ?? row.data,
        horas_realizadas: result?.actualHours ?? row.horas_realizadas
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
      actualHours: row.actualHours ?? 0,
      plannedHours: row.plannedHours,
      differenceMinutes: row.differenceMinutes,
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
  if (query.status && query.status !== "Todos") where.status = uiToRecordStatus(query.status);
  if (query.divergentOnly) where.status = "DIVERGENT";
  if (query.pendingOnly) where.status = "ADJUSTMENT_REQUESTED";
  if (query.noScheduleOnly) where.status = "NO_SCHEDULE";
  if (query.source && query.source !== "Todos") where.source = { equals: query.source, mode: "insensitive" };
  const employeeStatusFilter = buildEmployeeStatusFilter(query.employeeStatus);
  if (employeeStatusFilter) where.employee = { AND: [where.employee as Prisma.EmployeeProfileWhereInput, employeeStatusFilter] };
  return where;
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
  const productiveWhere: Prisma.WorkHourRecordWhereInput = { AND: [where, { status: { not: "NO_SCHEDULE" } }] };
  const okWhere: Prisma.WorkHourRecordWhereInput = {
    AND: [productiveWhere, { differenceMinutes: { gte: -toleranceMinutes, lte: toleranceMinutes } }]
  };
  const divergentWhere: Prisma.WorkHourRecordWhereInput = {
    AND: [productiveWhere, { OR: [{ differenceMinutes: { lt: -toleranceMinutes } }, { differenceMinutes: { gt: toleranceMinutes } }] }]
  };
  const [totals, okRecords, divergentRecords, noScheduleRecords, adjustments] = await Promise.all([
    prisma.workHourRecord.aggregate({
      where: productiveWhere,
      _count: { _all: true },
      _sum: { effectiveHours: true, adjustedHours: true }
    }),
    prisma.workHourRecord.count({ where: okWhere }),
    prisma.workHourRecord.count({ where: divergentWhere }),
    prisma.workHourRecord.count({ where: { AND: [where, { status: "NO_SCHEDULE" }] } }),
    prisma.workHourAdjustmentRequest.groupBy({ by: ["status"], where: { record: { is: where } }, _count: { _all: true } }).catch(() => [])
  ]);
  const adjustmentCount = (status: WorkHourAdjustmentStatus) => adjustments.find((item) => item.status === status)?._count._all ?? 0;
  const plannedHours = (totals._count._all ?? 0) * DEFAULT_PRODUCTIVE_HOURS;
  const effectiveHours = Number(totals._sum.effectiveHours ?? 0);
  return {
    plannedHours: roundHours(plannedHours),
    actualHours: roundHours(effectiveHours),
    differenceHours: roundHours(effectiveHours - plannedHours),
    okRecords,
    divergentRecords,
    noScheduleRecords,
    pendingAdjustments: adjustmentCount("ABERTO") + adjustmentCount("EM_ANALISE"),
    approvedAdjustments: adjustmentCount("APROVADO"),
    rejectedAdjustments: adjustmentCount("RECUSADO"),
    adjustedHours: roundHours(Number(totals._sum.adjustedHours ?? 0))
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
          reason: true,
          justification: true,
          rejectionReason: true,
          createdAt: true,
          requestedBy: { select: { name: true } }
        }
      },
      schedule: { select: { status: true, startsAt: true, endsAt: true } }
    }
  });
}

function formatWorkHourRecord(record: any) {
  const adjustment = record.adjustments?.[0];
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
    adjustmentRejectionReason: adjustment?.rejectionReason ?? "",
    adjustmentRequestedBy: adjustment?.requestedBy?.name ?? "",
    adjustmentRequestedAt: adjustment ? formatDateTime(adjustment.createdAt) : "",
    source: record.source ?? "",
    observation: record.observation ?? "",
    createdAt: formatDateTime(record.createdAt),
    updatedAt: formatDateTime(record.updatedAt)
  };
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

async function notifyReviewResult(tx: Prisma.TransactionClient, adjustment: any, title: string, body: string) {
  const users = [adjustment.requestedById, adjustment.employee?.userId].filter(Boolean);
  for (const userId of Array.from(new Set(users))) {
    await tx.notification.create({
      data: { userId, title, body, category: "Horas Operacionais", type: "INFO", entity: "WorkHourAdjustmentRequest", entityId: adjustment.id, href: "/horas-operacionais" }
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
  if (hasExcelValue(input.requestedActualHours)) return { error: "Horas solicitadas inválidas. Horas solicitadas devem ser um número ou formato HH:mm.", field: "requestedActualHours" };
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

function resolvePeriod(query: WorkHourQuery) {
  const startDate = parseImportDate(query.startDate) ?? new Date(Date.UTC(2026, 4, 1));
  const endDate = parseImportDate(query.endDate) ?? new Date(Date.UTC(2026, 4, 31));
  endDate.setUTCHours(23, 59, 59, 999);
  return { startDate, endDate };
}

async function getUser(actor: Actor) {
  return prisma.user.findUnique({ where: { email: actor.email }, include: { role: true, employeeProfile: true } });
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
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 24) return roundHours(value);
  const raw = text(value);
  if (!raw) return null;
  const time = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (time) {
    const hour = Number(time[1]);
    const minute = Number(time[2]);
    const second = Number(time[3] ?? 0);
    if (hour > 24 || minute > 59 || second > 59) return null;
    return roundHours(hour + minute / 60);
  }
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 24 ? roundHours(parsed) : null;
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
  const rounded = Math.round(minutes);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  const absolute = Math.abs(rounded);
  const hours = Math.floor(absolute / 60);
  const remaining = absolute % 60;
  return hours ? `${sign}${hours}h${String(remaining).padStart(2, "0")}` : `${sign}${remaining}min`;
}

function serialize(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null));
}
