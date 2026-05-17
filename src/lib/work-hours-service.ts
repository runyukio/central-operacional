import {
  AuditAction,
  Prisma,
  type Schedule,
  type WorkHourAdjustmentStatus,
  type WorkHourRecordStatus
} from "@prisma/client";

import { createPermissionError, createValidationError, mapPrismaError } from "@/lib/api-errors";
import type { Actor } from "@/lib/mock-db";
import { recordErrorLog } from "@/lib/mock-db";
import { normalizeRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const uploadRoles = ["ADMIN", "GESTOR", "WFM"];
const approvalRoles = ["ADMIN", "GESTOR", "WFM"];
const manualEditRoles = ["ADMIN", "GESTOR", "WFM"];
const viewRoles = ["ADMIN", "GESTOR", "WFM", "SUPERVISOR", "COLABORADOR"];
const requestAdjustmentRoles = ["ADMIN", "GESTOR", "WFM", "SUPERVISOR"];
const toleranceMinutes = 5;

type UserWithRole = Prisma.UserGetPayload<{ include: { role: true; employeeProfile: true } }>;

export type WorkHourQuery = {
  startDate?: string;
  endDate?: string;
  lob?: string;
  supervisor?: string;
  shift?: string;
  collaborator?: string;
  wbLogin?: string;
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
  requestedActualStart?: string;
  requestedActualEnd?: string;
  requestedActualHours?: number;
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
  actualStart?: string;
  actualEnd?: string;
  actualHours?: number;
  observation?: string;
  source?: string;
  confirmOverwrite?: boolean;
};

type ValidationRow = {
  rowNumber: number;
  wbLogin: string;
  employeeId?: string;
  employeeName?: string;
  date?: Date;
  dateIso?: string;
  errors: string[];
  warnings: string[];
  action: "criar" | "atualizar" | "ignorar";
  hasSchedule: boolean;
  existingRecordId?: string;
  actualStart?: string;
  actualEnd?: string;
  actualHours?: number;
  source?: string;
  observation?: string;
};

export async function listOperationalWorkHours(actor: Actor, query: WorkHourQuery = {}) {
  try {
    const user = await getUser(actor);
    if (!user) return { error: "Usuário não encontrado ou inativo." };
    const role = normalizeRole(user.role.name);
    if (!viewRoles.includes(role)) return createPermissionError("Você não tem permissão para visualizar horas operacionais.");

    const period = resolvePeriod(query);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(10, Number(query.limit) || 50));
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
              roleTitle: true,
              lob: { select: { name: true } },
              shift: { select: { name: true } },
              supervisor: { select: { id: true, fullName: true, wbLogin: true } }
            }
          },
          adjustments: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true, status: true, reason: true, createdAt: true, requestedBy: { select: { name: true } } }
          }
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
      hasSchedule: false
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
      return { error: "Existem erros na importação. Corrija ou confirme importação parcial.", preview: toImportPreview(input.rows, validation) };
    }

    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.workHourImportBatch.create({
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

      let importedRows = 0;
      for (const rowValidation of validRows) {
        const schedule = await tx.schedule.findUnique({
          where: { employeeId_date: { employeeId: rowValidation.employeeId!, date: rowValidation.date! } }
        });
        const planned = schedule ? plannedFromSchedule(schedule) : { start: null, end: null, hours: null };
        const status = calculateRecordStatus(planned.hours, rowValidation.actualHours!, Boolean(schedule));
        const differenceMinutes = planned.hours === null ? null : Math.round((rowValidation.actualHours! - planned.hours) * 60);
        const before = rowValidation.existingRecordId
          ? await tx.workHourRecord.findUnique({ where: { id: rowValidation.existingRecordId } })
          : null;

        const saved = await tx.workHourRecord.upsert({
          where: { employeeId_date: { employeeId: rowValidation.employeeId!, date: rowValidation.date! } },
          update: {
            scheduleId: schedule?.id ?? null,
            wbLogin: rowValidation.wbLogin,
            plannedStart: planned.start,
            plannedEnd: planned.end,
            plannedHours: planned.hours,
            actualStart: rowValidation.actualStart,
            actualEnd: rowValidation.actualEnd,
            actualHours: rowValidation.actualHours!,
            adjustedStart: null,
            adjustedEnd: null,
            adjustedHours: null,
            effectiveStart: rowValidation.actualStart,
            effectiveEnd: rowValidation.actualEnd,
            effectiveHours: rowValidation.actualHours!,
            differenceMinutes,
            status,
            source: rowValidation.source || "upload-horas",
            observation: rowValidation.observation,
            importBatchId: batch.id
          },
          create: {
            employeeId: rowValidation.employeeId!,
            scheduleId: schedule?.id ?? null,
            wbLogin: rowValidation.wbLogin,
            date: rowValidation.date!,
            plannedStart: planned.start,
            plannedEnd: planned.end,
            plannedHours: planned.hours,
            actualStart: rowValidation.actualStart,
            actualEnd: rowValidation.actualEnd,
            actualHours: rowValidation.actualHours!,
            effectiveStart: rowValidation.actualStart,
            effectiveEnd: rowValidation.actualEnd,
            effectiveHours: rowValidation.actualHours!,
            differenceMinutes,
            status,
            source: rowValidation.source || "upload-horas",
            observation: rowValidation.observation,
            importBatchId: batch.id
          }
        });

        await tx.workHourHistory.create({
          data: {
            workHourRecordId: saved.id,
            changedById: user.id,
            action: rowValidation.action === "atualizar" ? "IMPORT_UPDATE" : "IMPORT_CREATE",
            previousValue: serialize(before),
            newValue: serialize(saved),
            reason: `Importação de horas ${input.fileName}`
          }
        });
        importedRows += 1;
      }

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: AuditAction.IMPORTACAO,
          entity: "WorkHourImportBatch",
          entityId: batch.id,
          reason: `${importedRows} registro(s) de horas importado(s)`,
          newValue: { fileName: input.fileName, importedRows, totalRows: input.rows.length }
        }
      });

      return {
        id: batch.id,
        fileName: batch.fileName,
        importedRows,
        createdRows: batch.createdRows,
        updatedRows: batch.updatedRows,
        status: batch.status,
        createdAt: formatDateTime(batch.createdAt)
      };
    });

    return { data: result, preview: toImportPreview(input.rows, validation) };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "WORK_HOURS_IMPORT_ERROR", message: error instanceof Error ? error.message : "Falha ao importar horas", action: "WORK_HOURS_IMPORT", severity: "ERROR" });
    return mapPrismaError(error) ?? { error: "Não foi possível importar horas operacionais." };
  }
}

export async function requestWorkHourAdjustment(actor: Actor, input: WorkHourAdjustmentInput) {
  const user = await getUser(actor);
  if (!user || !requestAdjustmentRoles.includes(normalizeRole(user.role.name))) return createPermissionError("Você não tem permissão para solicitar ajuste de horas.");

  const fieldErrors: Record<string, string> = {};
  if (!input.workHourRecordId) fieldErrors.workHourRecordId = "Registro de horas é obrigatório.";
  if (!input.reason?.trim()) fieldErrors.reason = "Motivo do ajuste é obrigatório.";
  if (!input.justification?.trim()) fieldErrors.justification = "Justificativa é obrigatória.";
  const requestedHours = normalizeRequestedHours(input);
  if (requestedHours.error) fieldErrors.requestedActualHours = requestedHours.error;
  if (Object.keys(fieldErrors).length) return createValidationError(fieldErrors);

  try {
    const record = await prisma.workHourRecord.findUnique({
      where: { id: input.workHourRecordId },
      include: { employee: { include: { user: true, supervisor: true } }, adjustments: { where: { status: { in: ["ABERTO", "EM_ANALISE"] } } } }
    });
    if (!record) return { error: "Registro de horas não encontrado." };
    if (record.adjustments.length) return { error: "Já existe ajuste pendente para este registro." };

    const adjustment = await prisma.$transaction(async (tx) => {
      const created = await tx.workHourAdjustmentRequest.create({
        data: {
          workHourRecordId: record.id,
          employeeId: record.employeeId,
          requestedById: user.id,
          status: "EM_ANALISE",
          currentActualStart: record.effectiveStart,
          currentActualEnd: record.effectiveEnd,
          currentActualHours: record.effectiveHours,
          requestedActualStart: input.requestedActualStart || null,
          requestedActualEnd: input.requestedActualEnd || null,
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
          newValue: { status: "ADJUSTMENT_REQUESTED", adjustmentId: created.id },
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
          newValue: { requestedHours: requestedHours.hours, requestedStart: input.requestedActualStart, requestedEnd: input.requestedActualEnd }
        }
      });

      const approvers = await tx.user.findMany({ where: { status: "ACTIVE", role: { name: { in: approvalRoles } } }, select: { id: true } });
      for (const approver of approvers) {
        await tx.notification.create({
          data: {
            userId: approver.id,
            title: "Novo ajuste de horas aguardando análise",
            body: `${user.name} solicitou ajuste para ${record.employee.fullName}.`,
            category: "Horas Operacionais",
            type: "INFO",
            entity: "WorkHourAdjustmentRequest",
            entityId: created.id,
            href: "/horas-operacionais"
          }
        });
      }

      return created;
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
        include: { record: true, requestedBy: true, employee: { include: { user: true } } }
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

      const nextDifference = adjustment.record.plannedHours === null ? null : Math.round((adjustment.requestedActualHours - (adjustment.record.plannedHours ?? 0)) * 60);
      const updatedRecord = await tx.workHourRecord.update({
        where: { id: adjustment.workHourRecordId },
        data: {
          adjustedStart: adjustment.requestedActualStart,
          adjustedEnd: adjustment.requestedActualEnd,
          adjustedHours: adjustment.requestedActualHours,
          effectiveStart: adjustment.requestedActualStart,
          effectiveEnd: adjustment.requestedActualEnd,
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
  const actualStart = normalizeTime(input.actualStart);
  const actualEnd = normalizeTime(input.actualEnd);
  if (!actualStart) fieldErrors.actualStart = "Entrada real é obrigatória.";
  if (!actualEnd) fieldErrors.actualEnd = "Saída real é obrigatória.";
  const explicitHours = parseHours(input.actualHours);
  const calculatedHours = actualStart && actualEnd ? roundHours(minutesBetween(actualStart, actualEnd) / 60) : null;
  const actualHours = explicitHours ?? calculatedHours;
  if (actualHours === null) fieldErrors.actualHours = "Horas realizadas inválidas.";
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
    const planned = schedule ? plannedFromSchedule(schedule) : { start: null, end: null, hours: null };
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

    const differenceMinutes = planned.hours === null ? null : Math.round((actualHours! - planned.hours) * 60);
    const baseStatus = calculateRecordStatus(planned.hours, actualHours!, Boolean(schedule));
    const status: WorkHourRecordStatus = baseStatus === "NO_SCHEDULE" ? "NO_SCHEDULE" : existing ? "MANUALLY_CORRECTED" : baseStatus;

    const saved = await prisma.$transaction(async (tx) => {
      const record = await tx.workHourRecord.upsert({
        where: { employeeId_date: { employeeId: employee.id, date: date! } },
        update: {
          scheduleId: schedule?.id ?? null,
          wbLogin: employee.wbLogin,
          plannedStart: planned.start,
          plannedEnd: planned.end,
          plannedHours: planned.hours,
          actualStart,
          actualEnd,
          actualHours: actualHours!,
          adjustedStart: null,
          adjustedEnd: null,
          adjustedHours: null,
          effectiveStart: actualStart,
          effectiveEnd: actualEnd,
          effectiveHours: actualHours!,
          differenceMinutes,
          status,
          source: "MANUAL",
          observation: input.observation?.trim() || null,
          importBatchId: null
        },
        create: {
          employeeId: employee.id,
          scheduleId: schedule?.id ?? null,
          wbLogin: employee.wbLogin,
          date: date!,
          plannedStart: planned.start,
          plannedEnd: planned.end,
          plannedHours: planned.hours,
          actualStart,
          actualEnd,
          actualHours: actualHours!,
          effectiveStart: actualStart,
          effectiveEnd: actualEnd,
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
          reason: input.observation?.trim() || "Lançamento manual pela escala"
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
      warning: schedule ? undefined : "Este colaborador não possui escala vinculada nesta data.",
      data: formatWorkHourRecord(await getRecordWithRelations(saved.id))
    };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "WORK_HOUR_MANUAL_UPSERT_ERROR", message: error instanceof Error ? error.message : "Falha ao lançar horas", action: "WORK_HOUR_MANUAL_UPSERT", severity: "ERROR" });
    return mapPrismaError(error) ?? { error: "Não foi possível salvar as horas manuais." };
  }
}

export async function exportOperationalWorkHoursCsv(actor: Actor, query: WorkHourQuery = {}) {
  const user = await getUser(actor);
  if (!user || !["ADMIN", "GESTOR", "WFM", "SUPERVISOR"].includes(normalizeRole(user.role.name))) return createPermissionError("Você não tem permissão para exportar horas.");

  const result = await listOperationalWorkHours(actor, { ...query, page: 1, limit: 100 });
  if ("error" in result) return result;
  const headers = [
    "data",
    "nome",
    "wb_login",
    "lob",
    "supervisor",
    "turno",
    "entrada_prevista",
    "saida_prevista",
    "horas_previstas",
    "entrada_real",
    "saida_real",
    "horas_realizadas",
    "entrada_ajustada",
    "saida_ajustada",
    "horas_ajustadas",
    "horas_efetivas",
    "diferenca_minutos",
    "status",
    "ajuste_status",
    "sistema_origem",
    "observacao"
  ];
  const csvRows = result.data.map((row) => [
    row.date,
    row.employeeName,
    row.wbLogin,
    row.lob,
    row.supervisor,
    row.shift,
    row.plannedStart,
    row.plannedEnd,
    row.plannedHours,
    row.actualStart,
    row.actualEnd,
    row.actualHours,
    row.adjustedStart,
    row.adjustedEnd,
    row.adjustedHours,
    row.effectiveHours,
    row.differenceMinutes,
    row.status,
    row.adjustmentStatus,
    row.source,
    row.observation
  ]);

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: AuditAction.UPLOAD,
      entity: "WorkHourRecord",
      reason: "Exportação CSV de horas operacionais",
      newValue: { filters: query, exportedRows: result.data.length }
    }
  }).catch(() => undefined);

  return { csv: [headers, ...csvRows].map((row) => row.map(csvCell).join(";")).join("\n") };
}

async function validateWorkHourRows(rows: Array<Record<string, unknown>>) {
  const duplicateKeys = new Map<string, number>();
  const normalizedRows = rows.map((row, index) => {
    const wbLogin = text(row.wb_login).toUpperCase();
    const date = parseImportDate(row.data);
    const key = wbLogin && date ? `${wbLogin}:${formatDate(date)}` : "";
    if (key) duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1);
    return { row, rowNumber: index + 1, wbLogin, date, key };
  });

  const wbLogins = Array.from(new Set(normalizedRows.map((row) => row.wbLogin).filter(Boolean)));
  const employees = await prisma.employeeProfile.findMany({
    where: { wbLogin: { in: wbLogins }, deletedAt: null },
    include: { lob: true, supervisor: true, shift: true }
  });
  const employeeMap = new Map(employees.map((employee) => [employee.wbLogin.toUpperCase(), employee]));
  const employeeIds = employees.map((employee) => employee.id);
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

  return normalizedRows.map<ValidationRow>(({ row, rowNumber, wbLogin, date, key }) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!wbLogin) errors.push("WB/Login é obrigatório.");
    if (!date) errors.push("Data inválida.");
    if (key && (duplicateKeys.get(key) ?? 0) > 1) errors.push("Linha duplicada no arquivo para o mesmo WB/Login + data.");

    const employee = wbLogin ? employeeMap.get(wbLogin) : null;
    if (wbLogin && !employee) errors.push("WB/Login não encontrado na base de funcionários.");
    if (employee && ["Inativo", "Desligado"].includes(employee.operationalStatus)) warnings.push("Colaborador está inativo ou desligado.");

    const actualStart = normalizeTime(row.entrada_real);
    const actualEnd = normalizeTime(row.saida_real);
    const actualHours = parseHours(row.horas_realizadas);
    if (!actualStart) errors.push("Entrada real inválida.");
    if (!actualEnd) errors.push("Saída real inválida.");
    if (actualHours === null) errors.push("Horas realizadas inválidas.");
    if (actualStart && actualEnd && actualHours !== null) {
      const calculated = minutesBetween(actualStart, actualEnd) / 60;
      if (Math.abs(calculated - actualHours) > 0.1) warnings.push("Horas realizadas diferente do cálculo entre entrada_real e saida_real.");
    }

    let schedule: Schedule | undefined;
    let existingRecordId: string | undefined;
    if (employee && date) {
      schedule = scheduleMap.get(`${employee.id}:${date.getTime()}`);
      existingRecordId = recordMap.get(`${employee.id}:${date.getTime()}`)?.id;
      if (!schedule) warnings.push("Não existe escala para esse colaborador nessa data.");
      if (text(row.lob) && text(row.lob).toUpperCase() !== employee.lob.name.toUpperCase()) warnings.push("LOB no arquivo diferente da LOB do colaborador.");
      if (text(row.supervisor_wb_login) && text(row.supervisor_wb_login).toUpperCase() !== (employee.supervisor?.wbLogin ?? "").toUpperCase()) warnings.push("Supervisor no arquivo diferente do supervisor do colaborador.");
      if (existingRecordId) warnings.push("Registro já existe e será atualizado.");
    }

    return {
      rowNumber,
      wbLogin,
      employeeId: employee?.id,
      employeeName: employee?.fullName,
      date: date ?? undefined,
      dateIso: date ? formatDate(date) : undefined,
      errors,
      warnings,
      action: errors.length ? "ignorar" : existingRecordId ? "atualizar" : "criar",
      hasSchedule: Boolean(schedule),
      existingRecordId,
      actualStart: actualStart ?? undefined,
      actualEnd: actualEnd ?? undefined,
      actualHours: actualHours ?? undefined,
      source: text(row.sistema_origem) || "upload-horas",
      observation: text(row.observacao)
    };
  });
}

function toImportPreview(rows: Array<Record<string, unknown>>, validation: ValidationRow[]) {
  return {
    totalRows: rows.length,
    validRows: validation.filter((row) => !row.errors.length).length,
    errorRows: validation.filter((row) => row.errors.length).length,
    warningRows: validation.filter((row) => row.warnings.length).length,
    createdRows: validation.filter((row) => !row.errors.length && row.action === "criar").length,
    updatedRows: validation.filter((row) => !row.errors.length && row.action === "atualizar").length,
    foundEmployees: validation.filter((row) => row.employeeId).length,
    missingEmployees: validation.filter((row) => row.errors.includes("WB/Login não encontrado na base de funcionários.")).length,
    scheduleFoundRows: validation.filter((row) => row.hasSchedule).length,
    noScheduleRows: validation.filter((row) => !row.hasSchedule && !row.errors.length).length,
    rows,
    validation: validation.map((row) => ({
      rowNumber: row.rowNumber,
      wbLogin: row.wbLogin,
      employeeName: row.employeeName ?? "",
      date: row.dateIso ?? "",
      errors: row.errors,
      warnings: row.warnings,
      action: row.action,
      status: row.errors.length ? "Erro" : row.warnings.length ? "Alerta" : "Válida"
    }))
  };
}

function buildRecordWhere(user: UserWithRole, query: WorkHourQuery, period: { startDate: Date; endDate: Date }): Prisma.WorkHourRecordWhereInput {
  const role = normalizeRole(user.role.name);
  const where: Prisma.WorkHourRecordWhereInput = {
    date: { gte: period.startDate, lte: period.endDate },
    employee: { deletedAt: null }
  };
  if (role === "COLABORADOR" || query.scope === "mine") where.employeeId = user.employeeProfile?.id ?? "__none__";
  if (query.lob && query.lob !== "Todos") where.employee = { ...(where.employee as Prisma.EmployeeProfileWhereInput), lob: { name: query.lob } };
  if (query.supervisor) where.employee = { ...(where.employee as Prisma.EmployeeProfileWhereInput), supervisor: { fullName: { contains: query.supervisor, mode: "insensitive" } } };
  if (query.shift && query.shift !== "Todos") where.employee = { ...(where.employee as Prisma.EmployeeProfileWhereInput), shift: { name: query.shift } };
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
  return where;
}

async function getWorkHoursSummary(where: Prisma.WorkHourRecordWhereInput) {
  const records = await prisma.workHourRecord.findMany({
    where,
    select: { plannedHours: true, effectiveHours: true, adjustedHours: true, differenceMinutes: true, status: true }
  });
  const adjustments = await prisma.workHourAdjustmentRequest.groupBy({ by: ["status"], where: { record: { is: where } }, _count: { _all: true } }).catch(() => []);
  const adjustmentCount = (status: WorkHourAdjustmentStatus) => adjustments.find((item) => item.status === status)?._count._all ?? 0;
  const plannedHours = records.reduce((sum, row) => sum + (row.plannedHours ?? 0), 0);
  const effectiveHours = records.reduce((sum, row) => sum + row.effectiveHours, 0);
  return {
    plannedHours: roundHours(plannedHours),
    actualHours: roundHours(effectiveHours),
    differenceHours: roundHours(effectiveHours - plannedHours),
    okRecords: records.filter((row) => row.status === "OK").length,
    divergentRecords: records.filter((row) => row.status === "DIVERGENT").length,
    noScheduleRecords: records.filter((row) => row.status === "NO_SCHEDULE").length,
    pendingAdjustments: adjustmentCount("ABERTO") + adjustmentCount("EM_ANALISE"),
    approvedAdjustments: adjustmentCount("APROVADO"),
    rejectedAdjustments: adjustmentCount("RECUSADO"),
    adjustedHours: roundHours(records.reduce((sum, row) => sum + (row.adjustedHours ?? 0), 0))
  };
}

async function getRecordWithRelations(id: string) {
  return prisma.workHourRecord.findUniqueOrThrow({
    where: { id },
    include: {
      employee: { select: { id: true, fullName: true, wbLogin: true, roleTitle: true, lob: { select: { name: true } }, shift: { select: { name: true } }, supervisor: { select: { id: true, fullName: true, wbLogin: true } } } },
      adjustments: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, reason: true, createdAt: true, requestedBy: { select: { name: true } } } }
    }
  });
}

function formatWorkHourRecord(record: any) {
  const adjustment = record.adjustments?.[0];
  return {
    id: record.id,
    employeeId: record.employeeId,
    employeeName: record.employee?.fullName ?? "",
    wbLogin: record.wbLogin,
    date: formatDate(record.date),
    lob: record.employee?.lob?.name ?? "",
    supervisor: record.employee?.supervisor?.fullName ?? "",
    shift: record.employee?.shift?.name ?? "",
    plannedStart: record.plannedStart ?? "",
    plannedEnd: record.plannedEnd ?? "",
    plannedHours: record.plannedHours ?? 0,
    actualStart: record.actualStart ?? "",
    actualEnd: record.actualEnd ?? "",
    actualHours: record.actualHours,
    adjustedStart: record.adjustedStart ?? "",
    adjustedEnd: record.adjustedEnd ?? "",
    adjustedHours: record.adjustedHours ?? 0,
    effectiveStart: record.effectiveStart ?? "",
    effectiveEnd: record.effectiveEnd ?? "",
    effectiveHours: record.effectiveHours,
    differenceMinutes: record.differenceMinutes ?? 0,
    status: recordStatusLabel(record.status),
    rawStatus: record.status,
    adjustmentId: adjustment?.id ?? "",
    adjustmentStatus: adjustment ? adjustmentStatusLabel(adjustment.status) : "Sem ajuste",
    adjustmentReason: adjustment?.reason ?? "",
    source: record.source ?? "",
    observation: record.observation ?? "",
    createdAt: formatDateTime(record.createdAt),
    updatedAt: formatDateTime(record.updatedAt)
  };
}

function formatAdjustment(adjustment: { id: string; status: WorkHourAdjustmentStatus; reason: string; createdAt: Date }) {
  return { id: adjustment.id, status: adjustmentStatusLabel(adjustment.status), reason: adjustment.reason, createdAt: formatDateTime(adjustment.createdAt) };
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

function normalizeRequestedHours(input: WorkHourAdjustmentInput) {
  const start = normalizeTime(input.requestedActualStart);
  const end = normalizeTime(input.requestedActualEnd);
  const explicit = typeof input.requestedActualHours === "number" ? input.requestedActualHours : parseHours(input.requestedActualHours);
  if (explicit !== null) return { hours: explicit };
  if (start && end) return { hours: roundHours(minutesBetween(start, end) / 60) };
  return { error: "Informe nova quantidade de horas ou nova entrada e saída." };
}

function plannedFromSchedule(schedule: Schedule) {
  if (!schedule.startsAt || !schedule.endsAt) return { start: schedule.startsAt, end: schedule.endsAt, hours: null };
  return { start: schedule.startsAt, end: schedule.endsAt, hours: roundHours(minutesBetween(schedule.startsAt, schedule.endsAt) / 60) };
}

function calculateRecordStatus(plannedHours: number | null, actualHours: number, hasSchedule: boolean): WorkHourRecordStatus {
  if (!hasSchedule || plannedHours === null) return "NO_SCHEDULE";
  const difference = Math.round((actualHours - plannedHours) * 60);
  return Math.abs(difference) <= toleranceMinutes ? "OK" : "DIVERGENT";
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
    NO_SCHEDULE: "Sem escala",
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
  if (value instanceof Date && !Number.isNaN(value.getTime())) return dateOnly(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return dateOnly(date);
  }
  const raw = text(value);
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return new Date(Date.UTC(Number(br[3]), Number(br[2]) - 1, Number(br[1])));
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : dateOnly(parsed);
}

function dateOnly(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function normalizeTime(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseHours(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 24) return roundHours(value);
  const raw = text(value);
  if (!raw) return null;
  if (/^\d{1,2}:\d{2}$/.test(raw)) {
    const [hour, minute] = raw.split(":").map(Number);
    if (hour > 24 || minute > 59) return null;
    return roundHours(hour + minute / 60);
  }
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 24 ? roundHours(parsed) : null;
}

function minutesBetween(start: string, end: string) {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  let startTotal = startHour * 60 + startMinute;
  let endTotal = endHour * 60 + endMinute;
  if (endTotal < startTotal) endTotal += 24 * 60;
  return endTotal - startTotal;
}

function text(value: unknown) {
  return String(value ?? "").trim();
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

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function serialize(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null));
}
