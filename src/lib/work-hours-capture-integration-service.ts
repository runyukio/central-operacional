import { Prisma, type ScheduleStatus, type WorkHourRecordStatus } from "@prisma/client";

import { createPermissionError, createServerError, createValidationError } from "@/lib/api-errors";
import type { Actor } from "@/lib/mock-db";
import { canImportWorkHours, canJustifyAbsence, normalizeRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getRealtimeHoursTimelineRange } from "@/lib/realtime-hours-service";
import { isCaptureImportEligible } from "@/lib/work-hours-capture-eligibility";
import { cancelAdherenceForDeletedWorkHours } from "@/lib/work-hours-adherence-cleanup";
import { resolveCapturePeriod } from "@/lib/work-hours-capture-period";
import { shiftCategoryName } from "@/lib/shift-display";
import {
  calculateOperationalHours,
  CAPTURE_DIVERGENCE_ACTIONS,
  captureDivergenceActionLabel,
  captureDivergenceReasonLabel,
  evaluateCaptureImport,
  reuseCaptureResolution,
  shouldCreateLowAdherence,
  type CaptureDivergenceAction,
  type CaptureDivergenceReason,
  type OperationalHourCalculation
} from "@/lib/work-hours-capture-integration-core";

export type CaptureImportFilters = {
  shiftDate?: string;
  startDate?: string;
  endDate?: string;
  employeeId?: string;
  lob?: string;
  supervisor?: string;
  shift?: string;
  collaborator?: string;
  employeeStatus?: string;
};

// Explicit I/O boundary also lets regression tests use captured fixtures without a live database.
export const captureWorkHoursData = { timelineRange: getRealtimeHoursTimelineRange };

type CaptureImportProposal = {
  reconciliationKey: string;
  slotKey: string;
  employee: CaptureImportEmployee;
  schedule: CaptureImportSchedule | null;
  date: Date;
  dateKey: string;
  scheduleStatus: string;
  capturedMs: number | null;
  calculation: OperationalHourCalculation | null;
  decision: ReturnType<typeof evaluateCaptureImport>;
  existingRecord: ExistingWorkHour | null;
  manuallyValidated?: boolean;
};

type CaptureImportEmployee = {
  id: string;
  wbLogin: string;
  fullName: string;
  operationalStatus: string;
  roleTitle: string;
  goLiveDate: Date | null;
  deletedAt?: Date | null;
  team?: { name: string } | null;
  user?: { role: { name: string } } | null;
  skill: string | null;
  lobId: string;
  supervisorId: string | null;
  shiftId: string;
  lob: { name: string };
  shift: { id: string; name: string; startsAt: string; endsAt: string };
  supervisor: { id: string; fullName: string; wbLogin: string } | null;
  skillAssignments: Array<{ isPrimary: boolean; skill: { name: string; normalizedName: string } }>;
};

type CaptureImportSchedule = {
  id: string;
  employeeId: string;
  shiftId: string | null;
  lobId: string | null;
  supervisorId: string | null;
  date: Date;
  startsAt: string | null;
  endsAt: string | null;
  status: ScheduleStatus;
  observation: string | null;
  source: string;
};

type ExistingWorkHour = {
  id: string;
  employeeId: string;
  date: Date;
  effectiveHours: number;
  actualHours: number;
  scheduleId: string | null;
  status: WorkHourRecordStatus;
};

export async function previewCaptureWorkHoursImport(actor: Actor, filters: CaptureImportFilters) {
  const authorization = await authorizeCaptureImport(actor);
  if ("error" in authorization) return authorization;
  const built = await buildCaptureImportPlan(filters);
  if ("error" in built) return built;
  return { data: formatCaptureImportPlan(built.proposals, built.period) };
}

export async function commitCaptureWorkHoursImport(
  actor: Actor,
  input: CaptureImportFilters & { confirmReprocessing?: boolean }
) {
  const authorization = await authorizeCaptureImport(actor);
  if ("error" in authorization) return authorization;
  const built = await buildCaptureImportPlan(input);
  if ("error" in built) return built;
  const formatted = formatCaptureImportPlan(built.proposals, built.period);
  if (formatted.overlap.count > 0 && !input.confirmReprocessing) {
    return {
      ...createValidationError({}, "Já existem horas contabilizadas no escopo selecionado. Confirme o reprocessamento antes de continuar."),
      code: "REPROCESS_CONFIRMATION_REQUIRED",
      data: formatted
    };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const freshEmployees = await tx.employeeProfile.findMany({
        where: { id: { in: Array.from(new Set(built.proposals.map((item) => item.employee.id))) } },
        include: captureEmployeeInclude
      });
      const freshById = new Map(freshEmployees.map((employee) => [employee.id, employee]));
      if (built.proposals.some((item) => {
        const fresh = freshById.get(item.employee.id);
        return !fresh || !isCaptureImportEligible(fresh, item.dateKey);
      })) {
        throw new CaptureDecisionError("A elegibilidade de um parceiro mudou. Revise a importação; nenhuma alteração foi aplicada.");
      }
      const changedPartner = built.proposals.find((item) => {
        const fresh = freshById.get(item.employee.id)!;
        return JSON.stringify(classificationInput(fresh)) !== JSON.stringify(classificationInput(item.employee))
          || fresh.supervisorId !== item.employee.supervisorId || fresh.shiftId !== item.employee.shiftId
          || fresh.shift.startsAt !== item.employee.shift.startsAt || fresh.shift.endsAt !== item.employee.shift.endsAt;
      });
      if (changedPartner) throw new CaptureDecisionError(`O cadastro de ${changedPartner.employee.fullName} (${changedPartner.employee.wbLogin}) mudou durante a consulta (classificação, supervisor ou turno). Consulte a captura novamente; nenhuma alteração foi aplicada neste lote.`);
      const affectedPairs = uniqueEmployeeDates(built.proposals);
      const freshSchedules = affectedPairs.length ? await tx.schedule.findMany({ where: {
        OR: affectedPairs, deletedAt: null
      } }) : [];
      const freshScheduleByPair = new Map(freshSchedules.map((schedule) => [employeeDateKey(schedule.employeeId, schedule.date), schedule]));
      for (const proposal of built.proposals) {
        const current = freshScheduleByPair.get(employeeDateKey(proposal.employee.id, proposal.date));
        if ((current?.id ?? null) !== (proposal.schedule?.id ?? null)
          || (current && (current.status !== proposal.scheduleStatus || current.startsAt !== proposal.schedule?.startsAt || current.endsAt !== proposal.schedule?.endsAt))) {
          throw new CaptureDecisionError("O cronograma mudou durante a consulta. Reimporte o Shift Date; nenhuma alteração foi aplicada.");
        }
      }
      const currentRecords = affectedPairs.length
        ? await tx.workHourRecord.findMany({
          where: {
            OR: affectedPairs.map((item) => ({ employeeId: item.employeeId, date: item.date }))
          }
        })
        : [];
      if (currentRecords.length > 0 && !input.confirmReprocessing) {
        throw new ReprocessConfirmationError();
      }

      const run = await tx.workHourCaptureImportRun.create({
        data: {
          startedById: authorization.user.id,
          startDate: built.period.start,
          endDate: built.period.end,
          filters: sanitizeFilters(input),
          confirmedReprocessing: Boolean(input.confirmReprocessing),
          automaticRecords: built.proposals.filter((item) => item.decision.decision === "AUTOMATIC").length,
          divergenceRecords: built.proposals.filter((item) => item.decision.decision === "DIVERGENCE").length,
          ignoredRecords: built.proposals.filter((item) => item.decision.decision === "IGNORE").length,
          overlappingRecords: currentRecords.length
        }
      });

      const currentByKey = new Map(currentRecords.map((record) => [employeeDateKey(record.employeeId, record.date), record]));
      let imported = 0;
      let unchanged = 0;
      let divergences = 0;

      for (const proposal of built.proposals) {
        if (proposal.decision.decision === "AUTOMATIC" && proposal.schedule && proposal.calculation && proposal.capturedMs) {
          const current = currentByKey.get(employeeDateKey(proposal.employee.id, proposal.date)) ?? null;
          const saved = await saveValidatedAttendance(tx, {
            proposal,
            actorId: authorization.user.id,
            actionSource: proposal.manuallyValidated ? "MANUAL" : "AUTOMATIC",
            currentRecord: current
          });
          if (saved.changed) imported += 1;
          else unchanged += 1;

          await tx.workHourCaptureDivergence.updateMany({
            where: { reconciliationKey: proposal.reconciliationKey, status: "PENDING" },
            data: { status: "RESOLVED", resolutionAction: "AUTOMATIC", resolvedById: authorization.user.id, resolvedAt: new Date() }
          });
          continue;
        }

        if (proposal.decision.decision === "DIVERGENCE") {
          divergences += 1;
          const divergence = await tx.workHourCaptureDivergence.upsert({
            where: { reconciliationKey: proposal.reconciliationKey },
            create: divergenceData(proposal, run.id),
            update: {
              importRunId: run.id,
              scheduleId: proposal.schedule?.id,
              slotKey: proposal.slotKey,
              lob: proposal.employee.lob.name,
              classification: proposal.calculation?.classificationLabel ?? classificationFor(proposal.employee).classificationLabel,
              scheduleStatus: proposal.scheduleStatus,
              plannedStart: proposal.schedule?.startsAt,
              plannedEnd: proposal.schedule?.endsAt,
              sourceDurationMs: proposal.capturedMs,
              proposedHours: proposal.calculation?.operationalHours,
              reasons: proposal.decision.reasons,
              suggestedActions: proposal.decision.actions,
              status: "PENDING",
              resolutionAction: null,
              resolvedById: null,
              resolvedAt: null
            }
          });
          await tx.auditLog.create({
            data: {
              actorId: authorization.user.id,
              action: "IMPORTACAO",
              entity: "WorkHourCaptureDivergence",
              entityId: divergence.id,
              reason: proposal.decision.reasons.map(captureDivergenceReasonLabel).join(" | "),
              newValue: {
                importRunId: run.id,
                reconciliationKey: proposal.reconciliationKey,
                period: { startDate: formatDate(built.period.start), endDate: formatDate(built.period.end) },
                capturedMs: proposal.capturedMs,
                proposedHours: proposal.calculation?.operationalHours ?? null,
                scheduleStatus: proposal.scheduleStatus,
                rule: proposal.calculation?.rule ?? null,
                action: "DIVERGENCE",
                reasons: proposal.decision.reasons,
                confirmedReprocessing: Boolean(input.confirmReprocessing)
              }
            }
          });
        }
      }

      await tx.auditLog.create({
        data: {
          actorId: authorization.user.id,
          action: "IMPORTACAO",
          entity: "WorkHourCaptureImportRun",
          entityId: run.id,
          reason: "Importação da Captura de Horas para Horas Operacionais e Cronograma.",
          newValue: {
            period: { startDate: formatDate(built.period.start), endDate: formatDate(built.period.end) },
            filters: sanitizeFilters(input),
            imported,
            unchanged,
            divergences,
            ignored: run.ignoredRecords,
            confirmedReprocessing: Boolean(input.confirmReprocessing)
          }
        }
      });

      return { runId: run.id, imported, unchanged, divergences, ignored: run.ignoredRecords };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 60_000 });

    return { data: { ...result, period: formatted.period, filters: sanitizeFilters(input) } };
  } catch (error) {
    if (error instanceof CaptureDecisionError) return createValidationError({}, error.message);
    if (error instanceof ReprocessConfirmationError) {
      return {
        ...createValidationError({}, "As horas mudaram desde a prévia. Revise e confirme novamente o reprocessamento."),
        code: "REPROCESS_CONFIRMATION_REQUIRED",
        data: formatted
      };
    }
    return createServerError(error, "A importação falhou e nenhuma alteração foi aplicada ao Cronograma ou às Horas Operacionais.");
  }
}

const captureEmployeeInclude = {
  lob: true, shift: true, team: { select: { name: true } },
  user: { select: { role: { select: { name: true } } } },
  supervisor: { select: { id: true, fullName: true, wbLogin: true } },
  skillAssignments: { include: { skill: true }, orderBy: [{ isPrimary: "desc" as const }, { skillId: "asc" as const }] }
} satisfies Prisma.EmployeeProfileInclude;

export async function listCaptureWorkHourDivergences(actor: Actor, filters: CaptureImportFilters) {
  const authorization = await authorizeCaptureImport(actor);
  if ("error" in authorization) return authorization;
  const period = parseImportPeriod(filters);
  if ("error" in period) return period;
  // Slicers are client-side only: return all eligible divergences of the selected period.
  const records = await prisma.workHourCaptureDivergence.findMany({
    where: { date: { gte: period.start, lte: period.end }, status: "PENDING" },
    include: { employee: { include: captureEmployeeInclude }, schedule: true },
    orderBy: [{ date: "asc" }, { employee: { fullName: "asc" } }]
  });
  return {
    data: records.filter((record) => isCaptureImportEligible(record.employee, formatDate(record.date))).map((record) => ({
      id: record.id,
      revision: record.updatedAt.toISOString(),
      employeeName: record.employee.fullName,
      wbLogin: record.employee.wbLogin,
      date: formatDate(record.date),
      slot: slotLabel(record.schedule?.startsAt ?? record.plannedStart, record.schedule?.endsAt ?? record.plannedEnd),
      lob: record.employee.lob.name,
      classification: classificationFor(record.employee as CaptureImportEmployee).classificationLabel,
      scheduleStatus: scheduleStatusLabel(record.schedule?.status ?? "SEM_ESCALA"),
      capturedDuration: formatDuration(record.sourceDurationMs),
      proposedHours: formatHours(calculateOperationalHours(record.sourceDurationMs ?? 0, classificationInput(record.employee as CaptureImportEmployee)).operationalHours),
      reasons: jsonStringArray(record.reasons).map((reason) => captureDivergenceReasonLabel(reason as CaptureDivergenceReason)),
      actions: CAPTURE_DIVERGENCE_ACTIONS.map((value) => ({ value, label: captureDivergenceActionLabel(value) })),
      supervisor: record.employee.supervisor?.fullName ?? "Sem supervisor",
      shift: shiftCategoryName(record.employee.shift.name) || "Sem turno"
    })),
    period: { startDate: formatDate(period.start), endDate: formatDate(period.end) },
    shiftDate: formatDate(period.start) === formatDate(period.end) ? formatDate(period.start) : null
  };
}

export type CaptureDivergenceDecisionInput = { id: string; action: CaptureDivergenceAction; revision: string };

class CaptureDecisionError extends Error {}

export async function applyCaptureWorkHourDivergenceDecisions(
  actor: Actor,
  input: CaptureImportFilters & { decisions: CaptureDivergenceDecisionInput[]; confirmed: boolean }
) {
  const authorization = await authorizeCaptureImport(actor);
  if ("error" in authorization) return authorization;
  if (!input.confirmed) return createValidationError({}, "Clique em Aplicar alterações para confirmar as decisões.");
  const period = parseImportPeriod(input);
  if ("error" in period) return period;
  const ids = input.decisions.map((item) => item.id);
  if (!ids.length || ids.length > 1000 || new Set(ids).size !== ids.length) {
    return createValidationError({}, "Selecione decisões válidas, sem registros duplicados.");
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const records = await tx.workHourCaptureDivergence.findMany({
        where: { id: { in: ids } },
        include: { employee: { include: captureEmployeeInclude }, schedule: true }
      });
      const byId = new Map(records.map((record) => [record.id, record]));
      // Validate the complete batch before the first write. Any stale/ineligible row aborts it.
      for (const decision of input.decisions) {
        const record = byId.get(decision.id);
        if (!record || record.status !== "PENDING" || record.updatedAt.toISOString() !== decision.revision
          || record.date < period.start || record.date > period.end) {
          throw new CaptureDecisionError("Uma divergência mudou ou já foi resolvida. Atualize a tela e revise as decisões; nenhuma alteração foi aplicada.");
        }
        if (!isCaptureImportEligible(record.employee, formatDate(record.date))) {
          throw new CaptureDecisionError("Um parceiro deixou de ser agente ativo em produção. Atualize a tela; nenhuma alteração foi aplicada.");
        }
        if (!CAPTURE_DIVERGENCE_ACTIONS.includes(decision.action)) throw new CaptureDecisionError("Decisão inválida.");
        const schedule = record.schedule;
        const currentSlot = await tx.schedule.findUnique({ where: { employeeId_date: { employeeId: record.employeeId, date: record.date } } });
        if ((schedule && (schedule.deletedAt || schedule.status !== record.scheduleStatus
          || schedule.startsAt !== record.plannedStart || schedule.endsAt !== record.plannedEnd))
          || (!schedule && (record.scheduleId || (currentSlot && !currentSlot.deletedAt)))) {
          throw new CaptureDecisionError("O cronograma mudou desde a importação. Reimporte o Shift Date antes de aplicar as decisões.");
        }
        if (record.lob !== record.employee.lob.name || record.classification !== classificationFor(record.employee).classificationLabel) {
          throw new CaptureDecisionError("A classificação de um agente mudou. Reimporte o Shift Date antes de aplicar as decisões.");
        }
      }

      const results: Array<{ id: string; status: string; action: CaptureDivergenceAction; revision: string }> = [];
      for (const decision of input.decisions) {
        const divergence = byId.get(decision.id)!;
        const employee = divergence.employee as CaptureImportEmployee;
        let schedule = divergence.schedule as CaptureImportSchedule | null;
        const previousStatus = schedule?.status ?? "SEM_ESCALA";
        const current = await tx.workHourRecord.findUnique({ where: { employeeId_date: { employeeId: employee.id, date: divergence.date } } });
        let newHours = current?.effectiveHours ?? null;
        let newStatus = previousStatus;
        const isPending = decision.action === "KEEP_PENDING";
        const keeping = decision.action === "KEEP_SCHEDULE" || isPending;

        if (!keeping) {
          if (!schedule) {
            // Manual attendance outcomes may establish the missing slot, never an automatic import.
            schedule = await tx.schedule.upsert({
              where: { employeeId_date: { employeeId: employee.id, date: divergence.date } },
              create: { employeeId: employee.id, shiftId: employee.shiftId, lobId: employee.lobId,
                supervisorId: employee.supervisorId, date: divergence.date, startsAt: employee.shift.startsAt,
                endsAt: employee.shift.endsAt, status: "ESCALADO", source: "captura-horas-confirmacao" },
              update: { deletedAt: null }
            });
          }
          if (decision.action === "CONFIRM_ABSENCE" || decision.action === "CONFIRM_DAY_OFF") {
            const target = decision.action === "CONFIRM_ABSENCE" ? "FALTA" : "FOLGA";
            const reason = captureDivergenceActionLabel(decision.action) + " na Tela de Divergências";
            await updateScheduleWithHistory(tx, schedule, target, authorization.user.id, reason);
            if (target === "FALTA") await upsertPendingAbsence(tx, authorization.user.id, employee.id, schedule);
            else await resolveAttendanceState(tx, authorization.user.id, employee.id, schedule, target);
            await removeOperationalHoursForOutcome(tx, employee.id, divergence.date, authorization.user.id, reason);
            await cancelLowAdherence(tx, divergence.reconciliationKey);
            newHours = null;
            newStatus = target;
          } else {
            const calculation = calculateOperationalHours(divergence.sourceDurationMs ?? 0, classificationInput(employee));
            const proposal = proposalFromDivergence(divergence, employee, schedule, calculation, "PRESENTE");
            await saveValidatedAttendance(tx, { proposal, actorId: authorization.user.id, actionSource: "MANUAL", currentRecord: current });
            await resolveAttendanceState(tx, authorization.user.id, employee.id, schedule, "PRESENTE");
            newHours = calculation.operationalHours;
            newStatus = "PRESENTE";
          }
        }

        const updated = await tx.workHourCaptureDivergence.update({
            where: { id: divergence.id },
            data: isPending ? { updatedAt: new Date() } : {
              status: "RESOLVED", resolutionAction: decision.action, resolvedById: authorization.user.id, resolvedAt: new Date(),
              reconciliationKey: schedule ? reconciliationKey(employee.id, formatDate(divergence.date), schedule.id) : divergence.reconciliationKey,
              slotKey: schedule?.id ?? divergence.slotKey, scheduleId: schedule?.id ?? null,
              plannedStart: schedule?.startsAt ?? null, plannedEnd: schedule?.endsAt ?? null,
              scheduleStatus: newStatus, lob: employee.lob.name,
              classification: classificationFor(employee).classificationLabel
            }
          });
        await tx.auditLog.create({
          data: {
            actorId: authorization.user.id, action: "APROVACAO", entity: "WorkHourCaptureDivergence", entityId: divergence.id,
            reason: decision.action === "KEEP_SCHEDULE"
              ? "Divergência revisada e encerrada sem alteração do Cronograma ou das Horas Operacionais."
              : captureDivergenceActionLabel(decision.action),
            previousValue: { shiftDate: formatDate(divergence.date), employeeId: employee.id, wbLogin: employee.wbLogin,
              scheduleStatus: previousStatus, effectiveHours: current?.effectiveHours ?? null,
              capturedMs: divergence.sourceDurationMs, reasons: divergence.reasons, status: divergence.status },
            newValue: { shiftDate: formatDate(divergence.date), employeeId: employee.id, wbLogin: employee.wbLogin,
              decision: decision.action, scheduleStatus: newStatus, effectiveHours: newHours,
              status: isPending ? "PENDING" : "RESOLVED", appliedAt: new Date().toISOString() }
          }
        });
        results.push({ id: divergence.id, status: isPending ? "PENDING" : "RESOLVED", action: decision.action, revision: updated.updatedAt.toISOString() });
      }
      return { data: { results, resolved: results.filter((item) => item.status === "RESOLVED").length, pending: results.filter((item) => item.status === "PENDING").length } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 60_000 });
  } catch (error) {
    if (error instanceof CaptureDecisionError) return createValidationError({}, error.message);
    return createServerError(error, "As decisões não foram aplicadas. Nenhuma alteração foi persistida no Cronograma ou nas Horas Operacionais.");
  }
}

export async function listWorkHourAdherenceJustifications(actor: Actor, filters: CaptureImportFilters = {}) {
  const user = await getActiveUser(actor);
  if (!user || !canJustifyAbsence({ role: user.role.name, status: user.status })) {
    return createPermissionError("Você não tem permissão para acompanhar pendências de aderência.");
  }
  const period = parsePeriod(filters);
  if ("error" in period) return period;
  const role = normalizeRole(user.role.name);
  const supervisorScope = role === "SUPERVISOR" ? user.employeeProfile?.id ?? "__none__" : null;
  const statusFilter = normalizeEmployeeStatusFilter(filters.employeeStatus);
  const records = await prisma.workHourAdherenceJustification.findMany({
    where: {
      date: { gte: period.start, lte: period.end },
      status: { not: "CANCELLED" },
      ...(supervisorScope ? { supervisorId: supervisorScope } : {}),
      ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
      ...(filters.lob && filters.lob !== "Todos" ? { lob: filters.lob } : {}),
      ...(filters.supervisor && filters.supervisor !== "Todos" ? {
        supervisor: { fullName: { contains: filters.supervisor, mode: "insensitive" } }
      } : {}),
      ...(statusFilter ? { employee: { operationalStatus: statusFilter } } : {}),
      ...(filters.collaborator ? {
        OR: [
          { employee: { fullName: { contains: filters.collaborator, mode: "insensitive" } } },
          { wbLogin: { contains: filters.collaborator, mode: "insensitive" } }
        ]
      } : {})
    },
    include: {
      employee: { include: captureEmployeeInclude },
      supervisor: { select: { fullName: true } },
      answeredBy: { select: { name: true } }
    },
    orderBy: [{ status: "desc" }, { date: "desc" }, { employee: { fullName: "asc" } }]
  });
  // Older deletions may have left orphaned justifications. Never ask a supervisor
  // to justify a removed record; preserve the old entry for audit/reprocessing.
  const hours = records.length ? await prisma.workHourRecord.findMany({
    where: { OR: records.map((record) => ({ employeeId: record.employeeId, date: record.date })) },
    select: { employeeId: true, date: true }
  }) : [];
  const existingDays = new Set(hours.map((record) => `${record.employeeId}:${record.date.toISOString()}`));
  return {
    data: records.filter((record) => (
      existingDays.has(`${record.employeeId}:${record.date.toISOString()}`)
      && isCaptureImportEligible(record.employee, formatDate(record.date))
      && (!filters.shift || filters.shift === "Todos" || shiftCategoryName(record.employee.shift.name) === shiftCategoryName(filters.shift))
    )).map((record) => ({
      id: record.id,
      employeeName: record.employee.fullName,
      wbLogin: record.wbLogin,
      date: formatDate(record.date),
      lob: record.lob,
      classification: record.classification,
      supervisor: record.supervisor?.fullName ?? "Sem supervisor",
      plannedSlot: slotLabel(record.plannedStart, record.plannedEnd),
      capturedDuration: formatDuration(record.sourceDurationMs),
      status: record.status === "JUSTIFIED" ? "Justificado" : "Pendente",
      justification: record.justification ?? "",
      answeredBy: record.answeredBy?.name ?? "",
      answeredAt: record.answeredAt ? formatDateTime(record.answeredAt) : ""
    }))
  };
}

export async function exportWorkHourAdherenceJustifications(actor: Actor, filters: CaptureImportFilters = {}) {
  const result = await listWorkHourAdherenceJustifications(actor, filters);
  if ("error" in result) return result;
  const period = parsePeriod(filters);
  if ("error" in period) return period;
  return {
    fileName: `justificativas_aderencia_${formatDate(period.start)}_${formatDate(period.end)}.xlsx`,
    sheetName: "Justificativas",
    autoFilter: true,
    headers: ["Data do turno", "Parceiro", "WB/Login", "LOB", "Classificação", "Supervisor", "Horário planejado", "Horas capturadas", "Status", "Justificativa", "Respondido por", "Respondido em (São Paulo)"],
    rows: result.data.map((row) => [row.date, row.employeeName, row.wbLogin, row.lob, row.classification, row.supervisor,
      row.plannedSlot, row.capturedDuration, row.status, row.justification, row.answeredBy, row.answeredAt])
  };
}

export async function answerWorkHourAdherenceJustification(actor: Actor, input: { id: string; justification: string }) {
  const user = await getActiveUser(actor);
  if (!user || !canJustifyAbsence({ role: user.role.name, status: user.status })) {
    return createPermissionError("Você não tem permissão para justificar esta pendência.");
  }
  const justification = input.justification.trim();
  if (justification.length < 5) return createValidationError({}, "Informe uma justificativa com pelo menos 5 caracteres.");
  const role = normalizeRole(user.role.name);
  try {
    const saved = await prisma.$transaction(async (tx) => {
      const record = await tx.workHourAdherenceJustification.findUnique({ where: { id: input.id }, include: { employee: { include: captureEmployeeInclude } } });
      if (!record || record.status === "CANCELLED") return createValidationError({}, "Pendência não encontrada ou já excluída.");
      if (!isCaptureImportEligible(record.employee, formatDate(record.date))) return createValidationError({}, "Este parceiro não é elegível para a integração da Captura de Horas.");
      if (role === "SUPERVISOR" && record.supervisorId !== user.employeeProfile?.id) {
        return createPermissionError("Supervisores só podem justificar pendências de seus próprios agentes.");
      }
      const hours = await tx.workHourRecord.findUnique({
        where: { employeeId_date: { employeeId: record.employeeId, date: record.date } }, select: { id: true }
      });
      if (!hours) return createValidationError({}, "As horas deste dia foram excluídas. Atualize a tela; não há mais justificativa a enviar.");
      const updated = await tx.workHourAdherenceJustification.update({
        where: { id: record.id },
        data: { status: "JUSTIFIED", justification, answeredById: user.id, answeredAt: new Date() }
      });
      await tx.notification.updateMany({
        where: { entity: "WorkHourAdherenceJustification", entityId: record.id, readAt: null },
        data: { isRead: true, readAt: new Date() }
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "EDICAO",
          entity: "WorkHourAdherenceJustification",
          entityId: record.id,
          reason: "Justificativa de baixa aderência enviada.",
          previousValue: { status: record.status, justification: record.justification },
          newValue: { status: updated.status, justification, answeredAt: updated.answeredAt }
        }
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if ("error" in saved) return saved;
    return { data: { id: saved.id, status: "Justificado", answeredAt: formatDateTime(saved.answeredAt!) } };
  } catch (error) {
    return createServerError(error, "Não foi possível salvar a justificativa. Atualize a tela e tente novamente.");
  }
}

async function buildCaptureImportPlan(filters: CaptureImportFilters) {
  const period = parseImportPeriod(filters);
  if ("error" in period) return period;
  const dateKeys = enumerateDateKeys(period.start, period.end);
  const employeeWhere: Prisma.EmployeeProfileWhereInput = { deletedAt: null };
  if (filters.employeeId) employeeWhere.id = filters.employeeId;
  if (filters.lob && filters.lob !== "Todos") employeeWhere.lob = { name: filters.lob };
  if (filters.supervisor && filters.supervisor !== "Todos") {
    employeeWhere.supervisor = { fullName: { contains: filters.supervisor, mode: "insensitive" } };
  }
  if (filters.collaborator) {
    employeeWhere.OR = [
      { fullName: { contains: filters.collaborator, mode: "insensitive" } },
      { wbLogin: { contains: filters.collaborator, mode: "insensitive" } }
    ];
  }
  const statusFilter = normalizeEmployeeStatusFilter(filters.employeeStatus);
  if (statusFilter) employeeWhere.operationalStatus = statusFilter;

  const employeesRaw = await prisma.employeeProfile.findMany({
    where: employeeWhere,
    include: captureEmployeeInclude
  });
  const employees = employeesRaw.filter((employee) => {
    if (!isCaptureImportEligible(employee, formatDate(period.end))) return false;
    if (!filters.shift || filters.shift === "Todos") return true;
    return shiftCategoryName(employee.shift.name) === shiftCategoryName(filters.shift);
  }) as CaptureImportEmployee[];
  if (!employees.length) return { proposals: [] as CaptureImportProposal[], period };

  const employeeIds = employees.map((employee) => employee.id);
  // Check existing operational hours before crossing capture and schedule data.
  const existing = await prisma.workHourRecord.findMany({
    where: { employeeId: { in: employeeIds }, date: { gte: period.start, lte: period.end } },
    select: { id: true, employeeId: true, date: true, effectiveHours: true, actualHours: true, scheduleId: true, status: true }
  });
  const [schedules, timelines] = await Promise.all([
    prisma.schedule.findMany({
      where: {
        employeeId: { in: employeeIds },
        date: { gte: period.start, lte: period.end },
        deletedAt: null
      },
      orderBy: [{ date: "asc" }, { employeeId: "asc" }]
    }) as Promise<CaptureImportSchedule[]>,
    captureWorkHoursData.timelineRange({
      dates: dateKeys,
      eligibleEmployeeIds: employeeIds,
      eligibleWbLogins: employees.map((employee) => employee.wbLogin)
    })
  ]);
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const employeeByWb = new Map(employees.map((employee) => [normalizeWb(employee.wbLogin), employee]));
  const scheduleById = new Map(schedules.map((schedule) => [schedule.id, schedule]));
  const scheduleByEmployeeDate = new Map(schedules.map((schedule) => [employeeDateKey(schedule.employeeId, schedule.date), schedule]));
  const captures = new Map<string, { employee: CaptureImportEmployee; schedule: CaptureImportSchedule | null; date: Date; activeMs: number; slotKey: string }>();

  for (const timeline of timelines) {
    for (const row of timeline.rows) {
      const employee = employeeById.get(row.employeeId) ?? employeeByWb.get(normalizeWb(row.wbLogin));
      if (!employee || row.activeMs <= 0 || !dateKeys.includes(row.data) || !isCaptureImportEligible(employee, row.data)) continue;
      const date = dateFromKey(row.data);
      const captureSlot = row.slotId ? scheduleById.get(row.slotId) : null;
      const schedule = (captureSlot?.employeeId === employee.id && formatDate(captureSlot.date) === row.data ? captureSlot : null)
        ?? scheduleByEmployeeDate.get(employeeDateKey(employee.id, date))
        ?? null;
      const slotKey = schedule?.id ?? fallbackSlotKey(row.data, schedule?.startsAt ?? null, schedule?.endsAt ?? null);
      const key = reconciliationKey(employee.id, row.data, slotKey);
      const current = captures.get(key);
      if (!current || row.activeMs > current.activeMs) {
        captures.set(key, { employee, schedule, date, activeMs: row.activeMs, slotKey });
      }
    }
  }

  const proposals: CaptureImportProposal[] = [];
  const captureKeysByScheduleId = new Set<string>();
  for (const capture of captures.values()) {
    if (capture.schedule) captureKeysByScheduleId.add(capture.schedule.id);
    proposals.push(buildProposal(capture.employee, capture.schedule, capture.date, capture.slotKey, capture.activeMs));
  }
  for (const schedule of schedules) {
    if (captureKeysByScheduleId.has(schedule.id)) continue;
    const employee = employeeById.get(schedule.employeeId);
    if (!employee || !isCaptureImportEligible(employee, formatDate(schedule.date))) continue;
    proposals.push(buildProposal(employee, schedule, schedule.date, schedule.id, null));
  }

  const pairs = uniqueEmployeeDates(proposals);
  const existingByKey = new Map(existing.map((record) => [employeeDateKey(record.employeeId, record.date), record]));
  const resolved = pairs.length ? await prisma.workHourCaptureDivergence.findMany({
    where: {
      status: "RESOLVED",
      reconciliationKey: { in: proposals.map((proposal) => proposal.reconciliationKey) }
    },
    select: { reconciliationKey: true, status: true, scheduleId: true, plannedStart: true, plannedEnd: true, sourceDurationMs: true, resolutionAction: true, scheduleStatus: true, lob: true, classification: true }
  }) : [];
  const resolvedByKey = new Map(resolved.map((item) => [item.reconciliationKey, item]));
  for (const proposal of proposals) {
    proposal.existingRecord = existingByKey.get(employeeDateKey(proposal.employee.id, proposal.date)) ?? null;
    const reused = reuseCaptureResolution({
      scheduleId: proposal.schedule?.id ?? null,
      scheduleStatus: proposal.scheduleStatus,
      plannedStart: proposal.schedule?.startsAt ?? null,
      plannedEnd: proposal.schedule?.endsAt ?? null,
      capturedMs: proposal.capturedMs,
      lob: proposal.employee.lob.name,
      classification: classificationFor(proposal.employee).classificationLabel
    }, resolvedByKey.get(proposal.reconciliationKey));
    if (reused) {
      proposal.decision = reused;
      proposal.manuallyValidated = true;
    }
  }
  proposals.sort((left, right) => left.date.getTime() - right.date.getTime() || left.employee.fullName.localeCompare(right.employee.fullName));
  return { proposals, period };
}

function buildProposal(
  employee: CaptureImportEmployee,
  schedule: CaptureImportSchedule | null,
  date: Date,
  slotKey: string,
  capturedMs: number | null
): CaptureImportProposal {
  const decision = evaluateCaptureImport({ scheduleExists: Boolean(schedule), scheduleStatus: schedule?.status, capturedMs });
  const calculation = calculateOperationalHours(capturedMs ?? 0, classificationInput(employee));
  const dateKey = formatDate(date);
  return {
    reconciliationKey: reconciliationKey(employee.id, dateKey, slotKey),
    slotKey,
    employee,
    schedule,
    date,
    dateKey,
    scheduleStatus: schedule?.status ?? "SEM_ESCALA",
    capturedMs,
    calculation,
    decision,
    existingRecord: null
  };
}

function formatCaptureImportPlan(proposals: CaptureImportProposal[], period: { start: Date; end: Date }) {
  const automatic = proposals.filter((item) => item.decision.decision === "AUTOMATIC");
  const divergences = proposals.filter((item) => item.decision.decision === "DIVERGENCE");
  const ignored = proposals.filter((item) => item.decision.decision === "IGNORE");
  const overlapping = proposals.filter((item) => item.existingRecord);
  return {
    period: { startDate: formatDate(period.start), endDate: formatDate(period.end) },
    summary: { automatic: automatic.length, divergences: divergences.length, ignored: ignored.length },
    overlap: {
      count: overlapping.length,
      dates: Array.from(new Set(overlapping.map((item) => item.dateKey))),
      agents: Array.from(new Map(overlapping.map((item) => [item.employee.id, {
        id: item.employee.id,
        name: item.employee.fullName,
        wbLogin: item.employee.wbLogin
      }])).values()),
      currentHours: roundHours(overlapping.reduce((sum, item) => sum + (item.existingRecord?.effectiveHours ?? 0), 0)),
      proposedHours: roundHours(overlapping.reduce((sum, item) => sum + (item.calculation?.operationalHours ?? 0), 0))
    }
  };
}

async function saveValidatedAttendance(
  tx: Prisma.TransactionClient,
  input: {
    proposal: CaptureImportProposal;
    actorId: string;
    actionSource: "AUTOMATIC" | "MANUAL";
    currentRecord: ExistingWorkHour | null;
  }
) {
  const { proposal } = input;
  if (!proposal.schedule || !proposal.calculation || proposal.capturedMs === null) throw new Error("Proposta validada incompleta.");
  const targetStatus = (proposal.decision.targetScheduleStatus ?? proposal.schedule.status) as ScheduleStatus;
  const previousSchedule = { ...proposal.schedule };
  if (proposal.schedule.status !== targetStatus) {
    await updateScheduleWithHistory(tx, proposal.schedule, targetStatus, input.actorId, input.actionSource === "AUTOMATIC"
      ? "Presença reconhecida automaticamente pela Captura de Horas"
      : "Comparecimento confirmado na Tela de Divergências");
    proposal.schedule.status = targetStatus;
  }

  const hours = proposal.calculation.operationalHours;
  const differenceMinutes = Math.round((hours - 8) * 60);
  const status: WorkHourRecordStatus = Math.abs(differenceMinutes) <= 5 ? "OK" : "DIVERGENT";
  const current = input.currentRecord;
  const unchanged = Boolean(current
    && current.scheduleId === proposal.schedule.id
    && Math.abs(current.effectiveHours - hours) < 0.000001
    && current.status === status
    && previousSchedule.status === targetStatus);
  const saved = await tx.workHourRecord.upsert({
    where: { employeeId_date: { employeeId: proposal.employee.id, date: proposal.date } },
    create: {
      captureReconciliationKey: proposal.reconciliationKey,
      employeeId: proposal.employee.id,
      scheduleId: proposal.schedule.id,
      wbLogin: proposal.employee.wbLogin,
      date: proposal.date,
      plannedStart: proposal.schedule.startsAt,
      plannedEnd: proposal.schedule.endsAt,
      plannedHours: 8,
      breakMinutes: 0,
      actualHours: hours,
      effectiveBreakMinutes: 0,
      effectiveHours: hours,
      differenceMinutes,
      status,
      source: "captura-horas",
      observation: proposal.calculation.ruleLabel
    },
    update: {
      captureReconciliationKey: proposal.reconciliationKey,
      scheduleId: proposal.schedule.id,
      wbLogin: proposal.employee.wbLogin,
      plannedStart: proposal.schedule.startsAt,
      plannedEnd: proposal.schedule.endsAt,
      plannedHours: 8,
      actualStart: null,
      actualEnd: null,
      breakMinutes: 0,
      actualHours: hours,
      adjustedStart: null,
      adjustedEnd: null,
      adjustedBreakMinutes: null,
      adjustedHours: null,
      effectiveStart: null,
      effectiveEnd: null,
      effectiveBreakMinutes: 0,
      effectiveHours: hours,
      differenceMinutes,
      status,
      source: "captura-horas",
      observation: proposal.calculation.ruleLabel,
      importBatchId: null
    }
  });
  if (current) {
    await tx.workHourAdjustmentRequest.updateMany({
      where: { workHourRecordId: saved.id, status: { in: ["ABERTO", "EM_ANALISE", "APROVADO"] } },
      data: { status: "CANCELADO" }
    });
  }

  if (!unchanged) {
    await tx.workHourHistory.create({
      data: {
        workHourRecordId: saved.id,
        changedById: input.actorId,
        action: input.actionSource === "AUTOMATIC" ? "IMPORT_CAPTURE" : "RESOLVE_CAPTURE_DIVERGENCE",
        reason: proposal.calculation.ruleLabel,
        previousValue: current ? {
          effectiveHours: current.effectiveHours,
          actualHours: current.actualHours,
          status: current.status,
          scheduleId: current.scheduleId
        } : Prisma.JsonNull,
        newValue: {
          capturedMs: proposal.capturedMs,
          effectiveHours: hours,
          overtimeHours: proposal.calculation.overtimeHours,
          status,
          scheduleStatus: targetStatus,
          rule: proposal.calculation.rule,
          action: input.actionSource
        }
      }
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.actionSource === "AUTOMATIC" ? "IMPORTACAO" : "APROVACAO",
        entity: "WorkHourRecord",
        entityId: saved.id,
        reason: proposal.calculation.ruleLabel,
        previousValue: current ? {
          effectiveHours: current.effectiveHours,
          actualHours: current.actualHours,
          status: current.status,
          scheduleId: current.scheduleId,
          scheduleStatus: previousSchedule.status
        } : Prisma.JsonNull,
        newValue: {
          reconciliationKey: proposal.reconciliationKey,
          date: proposal.dateKey,
          capturedMs: proposal.capturedMs,
          effectiveHours: hours,
          overtimeHours: proposal.calculation.overtimeHours,
          status,
          scheduleStatus: targetStatus,
          rule: proposal.calculation.rule,
          action: input.actionSource
        }
      }
    });
  }
  await upsertLowAdherence(tx, proposal, input.actorId, Boolean(current));
  return { record: saved, changed: !unchanged };
}

async function upsertLowAdherence(tx: Prisma.TransactionClient, proposal: CaptureImportProposal, actorId: string, hadOperationalHours: boolean) {
  if (!proposal.schedule || proposal.capturedMs === null || !proposal.calculation) return;
  if (!hadOperationalHours) {
    // Also repair justifications left by deletions predating the cleanup rule.
    await cancelAdherenceForDeletedWorkHours(tx, {
      employeeId: proposal.employee.id, date: proposal.date, actorId, reason: "Reimportação após ausência do registro de horas"
    });
  }
  if (!shouldCreateLowAdherence(proposal.capturedMs)) {
    await cancelLowAdherence(tx, proposal.reconciliationKey);
    return;
  }
  const existing = await tx.workHourAdherenceJustification.findUnique({
    where: { reconciliationKey: proposal.reconciliationKey }
  });
  const sameValidatedCapture = Boolean(
    existing
    && existing.status !== "CANCELLED"
    && existing.sourceDurationMs === proposal.capturedMs
    && existing.scheduleId === proposal.schedule.id
    && existing.supervisorId === proposal.employee.supervisorId
  );
  if (sameValidatedCapture && existing?.status === "JUSTIFIED") return;
  const saved = await tx.workHourAdherenceJustification.upsert({
    where: { reconciliationKey: proposal.reconciliationKey },
    create: {
      reconciliationKey: proposal.reconciliationKey,
      employeeId: proposal.employee.id,
      scheduleId: proposal.schedule.id,
      supervisorId: proposal.employee.supervisorId,
      date: proposal.date,
      slotKey: proposal.slotKey,
      wbLogin: proposal.employee.wbLogin,
      lob: proposal.employee.lob.name,
      classification: proposal.calculation.classificationLabel,
      plannedStart: proposal.schedule.startsAt,
      plannedEnd: proposal.schedule.endsAt,
      sourceDurationMs: proposal.capturedMs
    },
    update: {
      scheduleId: proposal.schedule.id,
      supervisorId: proposal.employee.supervisorId,
      lob: proposal.employee.lob.name,
      classification: proposal.calculation.classificationLabel,
      plannedStart: proposal.schedule.startsAt,
      plannedEnd: proposal.schedule.endsAt,
      sourceDurationMs: proposal.capturedMs,
      ...(sameValidatedCapture ? {} : {
        status: "PENDING",
        justification: null,
        answeredById: null,
        answeredAt: null
      })
    }
  });
  if (proposal.employee.supervisorId) {
    const supervisor = await tx.employeeProfile.findUnique({ where: { id: proposal.employee.supervisorId }, select: { userId: true } });
    if (supervisor?.userId) {
      const duplicate = await tx.notification.findFirst({
        where: { userId: supervisor.userId, entity: "WorkHourAdherenceJustification", entityId: saved.id, readAt: null }
      });
      if (!duplicate) {
        await tx.notification.create({
          data: {
            userId: supervisor.userId,
            title: "Justificativa de aderência pendente",
            body: `${proposal.employee.fullName} registrou ${formatDuration(proposal.capturedMs)} na Captura de Horas em ${proposal.dateKey}.`,
            category: "Horas Operacionais",
            type: "WARNING",
            entity: "WorkHourAdherenceJustification",
            entityId: saved.id,
            href: `/horas-operacionais?startDate=${proposal.dateKey}&endDate=${proposal.dateKey}`
          }
        });
      }
    }
  }
  if (!sameValidatedCapture) {
    await tx.auditLog.create({
      data: {
        actorId,
        action: existing ? "EDICAO" : "CRIACAO",
        entity: "WorkHourAdherenceJustification",
        entityId: saved.id,
        reason: "Captura original inferior a 7:25 após comparecimento validado.",
        previousValue: existing ? { capturedMs: existing.sourceDurationMs, status: existing.status } : Prisma.JsonNull,
        newValue: { reconciliationKey: proposal.reconciliationKey, capturedMs: proposal.capturedMs, status: saved.status }
      }
    });
  }
}

async function cancelLowAdherence(tx: Prisma.TransactionClient, reconciliationKeyValue: string) {
  await tx.workHourAdherenceJustification.updateMany({
    where: { reconciliationKey: reconciliationKeyValue, status: "PENDING" },
    data: { status: "CANCELLED", justification: null, answeredById: null, answeredAt: null }
  });
}

async function updateScheduleWithHistory(
  tx: Prisma.TransactionClient,
  schedule: CaptureImportSchedule,
  status: ScheduleStatus,
  actorId: string,
  reason: string
) {
  if (schedule.status === status) return schedule;
  const saved = await tx.schedule.update({ where: { id: schedule.id }, data: { status } });
  await tx.scheduleChangeHistory.create({
    data: {
      scheduleId: schedule.id,
      employeeId: schedule.employeeId,
      changedById: actorId,
      date: schedule.date,
      before: { status: schedule.status, startsAt: schedule.startsAt, endsAt: schedule.endsAt },
      after: { status, startsAt: schedule.startsAt, endsAt: schedule.endsAt },
      previousValue: { status: schedule.status },
      newValue: { status },
      reason
    }
  });
  return saved;
}

async function upsertPendingAbsence(
  tx: Prisma.TransactionClient,
  actorId: string,
  employeeId: string,
  schedule: CaptureImportSchedule
) {
  const existing = await tx.attendanceRecord.findFirst({
    where: { employeeId, date: schedule.date, OR: [{ scheduleId: schedule.id }, { scheduleId: null }] },
    orderBy: { updatedAt: "desc" }
  });
  const saved = existing
    ? await tx.attendanceRecord.update({
      where: { id: existing.id },
      data: {
        scheduleId: schedule.id,
        shiftId: schedule.shiftId,
        status: "FALTA",
        absenceReason: "Sem justificativa",
        reasonCategory: "Cronograma",
        reasonClassification: null,
        supervisorJustification: null,
        isJustified: false,
        impactsAbs: true,
        impactsCoverage: true,
        registeredById: actorId,
        justifiedById: null,
        justifiedAt: null
      }
    })
    : await tx.attendanceRecord.create({
      data: {
        employeeId,
        scheduleId: schedule.id,
        date: schedule.date,
        shiftId: schedule.shiftId,
        status: "FALTA",
        absenceReason: "Sem justificativa",
        reasonCategory: "Cronograma",
        isJustified: false,
        impactsAbs: true,
        impactsCoverage: true,
        registeredById: actorId
      }
    });
  await tx.attendanceHistory.create({
    data: {
      attendanceRecordId: saved.id,
      changedById: actorId,
      previousStatus: existing?.status,
      newStatus: "FALTA",
      previousReason: existing?.absenceReason,
      newReason: "Sem justificativa",
      comment: "Falta confirmada na Tela de Divergências; justificativa pendente de supervisor."
    }
  });
  const employee = await tx.employeeProfile.findUnique({
    where: { id: employeeId },
    select: { fullName: true, supervisor: { select: { userId: true } } }
  });
  if (employee?.supervisor?.userId) {
    const duplicate = await tx.notification.findFirst({
      where: { userId: employee.supervisor.userId, entity: "AttendanceRecord", entityId: saved.id, readAt: null }
    });
    if (!duplicate) {
      await tx.notification.create({
        data: {
          userId: employee.supervisor.userId,
          title: "Falta pendente de justificativa",
          body: `${employee.fullName} teve a falta confirmada pela conciliação da Captura de Horas.`,
          category: "Presença",
          type: "WARNING",
          entity: "AttendanceRecord",
          entityId: saved.id,
          href: "/escalas"
        }
      });
    }
  }
  return saved;
}

async function resolveAttendanceState(
  tx: Prisma.TransactionClient,
  actorId: string,
  employeeId: string,
  schedule: CaptureImportSchedule,
  status: "PRESENTE" | "FOLGA" | "VENDA_FOLGA_APROVADA"
) {
  const records = await tx.attendanceRecord.findMany({ where: { employeeId, date: schedule.date } });
  for (const record of records) {
    const attendanceStatus = status === "FOLGA" ? "FOLGA" : "PRESENTE";
    const saved = await tx.attendanceRecord.update({
      where: { id: record.id },
      data: {
        scheduleId: schedule.id,
        shiftId: schedule.shiftId,
        status: attendanceStatus,
        absenceReason: null,
        reasonCategory: null,
        reasonClassification: null,
        supervisorJustification: null,
        isJustified: true,
        impactsAbs: false,
        impactsCoverage: false,
        justifiedById: actorId,
        justifiedAt: new Date()
      }
    });
    await tx.attendanceHistory.create({
      data: {
        attendanceRecordId: saved.id,
        changedById: actorId,
        previousStatus: record.status,
        newStatus: attendanceStatus,
        previousReason: record.absenceReason,
        newReason: null,
        comment: `Pendência encerrada pela confirmação de ${status === "FOLGA" ? "folga" : "comparecimento"}.`
      }
    });
  }
}

async function removeOperationalHoursForOutcome(
  tx: Prisma.TransactionClient,
  employeeId: string,
  date: Date,
  actorId: string,
  reason: string
) {
  await cancelAdherenceForDeletedWorkHours(tx, { employeeId, date, actorId, reason });
  const record = await tx.workHourRecord.findUnique({ where: { employeeId_date: { employeeId, date } } });
  if (!record) return;
  await tx.auditLog.create({
    data: {
      actorId,
      action: "EXCLUSAO",
      entity: "WorkHourRecord",
      entityId: record.id,
      reason,
      previousValue: { actualHours: record.actualHours, effectiveHours: record.effectiveHours, status: record.status },
      newValue: Prisma.JsonNull
    }
  });
  await tx.workHourRecord.delete({ where: { id: record.id } });
}

function divergenceData(proposal: CaptureImportProposal, importRunId: string): Prisma.WorkHourCaptureDivergenceUncheckedCreateInput {
  return {
    reconciliationKey: proposal.reconciliationKey,
    importRunId,
    employeeId: proposal.employee.id,
    scheduleId: proposal.schedule?.id,
    date: proposal.date,
    slotKey: proposal.slotKey,
    wbLogin: proposal.employee.wbLogin,
    lob: proposal.employee.lob.name,
    classification: proposal.calculation?.classificationLabel ?? classificationFor(proposal.employee).classificationLabel,
    scheduleStatus: proposal.scheduleStatus,
    plannedStart: proposal.schedule?.startsAt,
    plannedEnd: proposal.schedule?.endsAt,
    sourceDurationMs: proposal.capturedMs,
    proposedHours: proposal.calculation?.operationalHours,
    reasons: proposal.decision.reasons,
    suggestedActions: proposal.decision.actions
  };
}

function proposalFromDivergence(
  divergence: {
    reconciliationKey: string;
    slotKey: string;
    date: Date;
    sourceDurationMs: number | null;
    scheduleStatus: string;
  },
  employee: CaptureImportEmployee,
  schedule: CaptureImportSchedule,
  calculation: OperationalHourCalculation,
  targetStatus: string
): CaptureImportProposal {
  return {
    reconciliationKey: reconciliationKey(employee.id, formatDate(divergence.date), schedule.id),
    slotKey: schedule.id,
    employee,
    schedule,
    date: divergence.date,
    dateKey: formatDate(divergence.date),
    scheduleStatus: divergence.scheduleStatus,
    capturedMs: divergence.sourceDurationMs ?? 0,
    calculation,
    decision: { decision: "AUTOMATIC", targetScheduleStatus: targetStatus, reasons: [], actions: [] },
    existingRecord: null
  };
}

function classificationInput(employee: CaptureImportEmployee) {
  return {
    lob: employee.lob.name,
    legacySkill: employee.skill,
    // Classification depends on the set of skills, never the database relation order.
    skillNames: Array.from(new Set(employee.skillAssignments.map((assignment) => assignment.skill.name))).sort()
  };
}

function classificationFor(employee: CaptureImportEmployee) {
  return calculateOperationalHours(0, classificationInput(employee));
}

async function authorizeCaptureImport(actor: Actor) {
  const user = await getActiveUser(actor);
  if (!user || !canImportWorkHours({ role: user.role.name, status: user.status })) {
    return createPermissionError("Você não tem permissão para importar horas da Captura de Horas.");
  }
  return { user };
}

function getActiveUser(actor: Actor) {
  return prisma.user.findFirst({
    where: { email: actor.email, status: "ACTIVE", deletedAt: null },
    include: { role: true, employeeProfile: true }
  });
}

function parsePeriod(filters: CaptureImportFilters): { start: Date; end: Date } | ReturnType<typeof createValidationError> {
  const start = dateFromKey(filters.startDate ?? "");
  const end = dateFromKey(filters.endDate ?? "");
  if (!filters.startDate || !filters.endDate || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
    || formatDate(start) !== filters.startDate || formatDate(end) !== filters.endDate) {
    return createValidationError({}, "Informe uma data inicial e uma data final válidas.");
  }
  if (end < start) return createValidationError({}, "A data final não pode ser anterior à data inicial.");
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days > 62) return createValidationError({}, "Selecione um período de até 62 dias por importação.");
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

function parseImportPeriod(filters: CaptureImportFilters) {
  const resolved = resolveCapturePeriod(filters);
  if ("error" in resolved) return createValidationError({}, resolved.error);
  return parsePeriod(resolved.period);
}

function normalizeEmployeeStatusFilter(value?: string) {
  if (!value || value === "Todos") return undefined;
  if (value === "Ativos") return { notIn: ["Inativo", "Desligado", "INACTIVE", "TERMINATED"] } as Prisma.StringFilter;
  if (value === "Desligados/Inativos") return { in: ["Inativo", "Desligado", "INACTIVE", "TERMINATED"] } as Prisma.StringFilter;
  return { equals: value, mode: "insensitive" as const };
}

function sanitizeFilters(filters: CaptureImportFilters) {
  return {
    shiftDate: filters.shiftDate ?? "",
    startDate: filters.shiftDate ?? filters.startDate ?? "",
    endDate: filters.shiftDate ?? filters.endDate ?? "",
    employeeId: filters.employeeId ?? "",
    lob: filters.lob ?? "Todos",
    supervisor: filters.supervisor ?? "",
    shift: filters.shift ?? "Todos",
    collaborator: filters.collaborator ?? "",
    employeeStatus: filters.employeeStatus ?? "Todos"
  };
}

function enumerateDateKeys(start: Date, end: Date) {
  const keys: string[] = [];
  const cursor = new Date(start);
  const last = new Date(end);
  last.setUTCHours(0, 0, 0, 0);
  while (cursor <= last) {
    keys.push(formatDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

function uniqueEmployeeDates(proposals: CaptureImportProposal[]) {
  return Array.from(new Map(proposals.map((proposal) => [employeeDateKey(proposal.employee.id, proposal.date), {
    employeeId: proposal.employee.id,
    date: proposal.date
  }])).values());
}

function employeeDateKey(employeeId: string, date: Date) {
  return `${employeeId}:${formatDate(date)}`;
}

function reconciliationKey(employeeId: string, date: string, slotKey: string) {
  return `${employeeId}:${date}:${slotKey}`;
}

function fallbackSlotKey(date: string, startsAt: string | null, endsAt: string | null) {
  return `fallback:${date}:${startsAt ?? "sem-inicio"}:${endsAt ?? "sem-fim"}`;
}

function dateFromKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(Number.NaN);
  return new Date(`${value}T00:00:00.000Z`);
}

function normalizeWb(value: string) {
  return value.trim().toLowerCase();
}

function slotLabel(startsAt?: string | null, endsAt?: string | null) {
  return startsAt && endsAt ? `${startsAt} - ${endsAt}` : "Sem slot previsto";
}

function scheduleStatusLabel(value: string) {
  const labels: Record<string, string> = {
    ESCALADO: "Escalado",
    PRESENTE: "Presente",
    TROCA_APROVADA: "Troca aprovada",
    VENDA_FOLGA_APROVADA: "Venda de folga",
    FOLGA: "Folga",
    FOLGA_APROVADA: "Folga aprovada",
    FALTA: "Falta",
    FALTA_JUSTIFICADA: "Falta justificada",
    FALTA_INJUSTIFICADA: "Falta injustificada",
    SEM_ESCALA: "Não escalado"
  };
  return labels[value] ?? value.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}

function formatDuration(value?: number | null) {
  if (value === null || value === undefined) return "Sem captura";
  const seconds = Math.floor(value / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatHours(value?: number | null) {
  if (value === null || value === undefined) return "Não calculado";
  const totalSeconds = Math.round(value * 3600);
  return formatDuration(totalSeconds * 1000);
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(date);
}

function jsonStringArray(value: Prisma.JsonValue) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function roundHours(value: number) {
  return Math.round(value * 100) / 100;
}

class ReprocessConfirmationError extends Error {}
