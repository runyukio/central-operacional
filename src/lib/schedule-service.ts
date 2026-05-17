import { AttendanceStatus, Prisma, ScheduleStatus } from "@prisma/client";

import type { Actor } from "@/lib/mock-db";
import { commitScheduleImport as commitMockScheduleImport, getAttendanceSummary as getMockAttendanceSummary, getSchedulesForActor as getMockSchedulesForActor, listAttendanceRecords as listMockAttendanceRecords, previewScheduleRows as previewMockScheduleRows, recordErrorLog, updateAttendance as updateMockAttendance } from "@/lib/mock-db";
import { prisma } from "@/lib/prisma";
import { normalizeRole } from "@/lib/permissions";

const uiToScheduleStatus: Record<string, ScheduleStatus> = {
  Escalado: "ESCALADO",
  Presente: "PRESENTE",
  Ausente: "AUSENTE",
  Falta: "FALTA",
  Atraso: "ATRASO",
  "Saída antecipada": "SAIDA_ANTECIPADA",
  Afastado: "AFASTADO",
  Férias: "FERIAS",
  Treinamento: "TREINAMENTO",
  Folga: "FOLGA",
  "Troca aprovada": "TROCA_APROVADA",
  "Venda de folga aprovada": "VENDA_FOLGA_APROVADA",
  "Folga aprovada": "FOLGA_APROVADA",
  "Sem escala": "SEM_ESCALA",
  "Erro de escala": "ERRO_ESCALA",
  Feriado: "FERIADO",
  Conflito: "CONFLITO",
  Descoberto: "DESCOBERTO"
};

const scheduleToUiStatus: Record<string, string> = Object.fromEntries(Object.entries(uiToScheduleStatus).map(([ui, db]) => [db, ui]));

const uiToAttendanceStatus: Record<string, AttendanceStatus> = {
  Presente: "PRESENTE",
  Ausente: "AUSENTE",
  Falta: "FALTA",
  Atraso: "ATRASO",
  "Saída antecipada": "SAIDA_ANTECIPADA",
  Afastado: "AFASTADO",
  Férias: "FERIAS",
  Treinamento: "TREINAMENTO",
  Folga: "FOLGA",
  "Troca aprovada": "TROCA_APROVADA",
  "Venda de folga aprovada": "PRESENTE",
  "Folga aprovada": "FOLGA",
  "Sem escala": "SEM_ESCALA",
  "Erro de escala": "ERRO_ESCALA"
};

export const statusesRequiringReason = ["Ausente", "Falta", "Atraso", "Saída antecipada", "Afastado", "Erro de escala"];
const supervisorJustificationStatuses = ["Ausente", "Falta", "Atraso", "Saída antecipada", "Afastado", "Erro de escala"];

const defaultShiftTimes: Record<string, { startsAt: string; endsAt: string }> = {
  Manhã: { startsAt: "06:00", endsAt: "14:00" },
  Tarde: { startsAt: "14:00", endsAt: "22:00" },
  Noite: { startsAt: "22:00", endsAt: "06:00" },
  Madrugada: { startsAt: "00:00", endsAt: "06:00" },
  Backoffice: { startsAt: "08:00", endsAt: "16:00" }
};

const allowDemoDataFallback = process.env.ALLOW_DEMO_LOGIN === "true" || process.env.ALLOW_DEMO_DATA === "true";

export type ScheduleEditInput = {
  employeeId: string;
  date: string;
  shift: string;
  startsAt?: string;
  endsAt?: string;
  status: string;
  lob?: string;
  supervisor?: string;
  observation?: string;
  pendingJustification?: boolean;
  impactsAbs?: boolean;
  impactsCoverage?: boolean;
  hasEvidence?: boolean;
  evidenceUrl?: string;
};

export type ScheduleQuery = {
  startDate?: string;
  endDate?: string;
  month?: number;
  year?: number;
  collaborator?: string;
  lob?: string;
  supervisor?: string;
  shift?: string;
  status?: string;
  roleTitle?: string;
  page?: number;
  limit?: number;
};

export type ScheduleRemoveInput = {
  employeeId: string;
  month?: number;
  year?: number;
  scope?: "month" | "all";
};

export type AttendanceQuery = {
  date?: string;
  startDate?: string;
  endDate?: string;
  month?: number;
  year?: number;
  lob?: string;
};

export type AttendanceInput = {
  employeeId: string;
  date: string;
  shift: string;
  status: string;
  absenceReason?: string;
  reasonCategory?: string;
  supervisorJustification?: string;
  hasEvidence?: boolean;
  evidenceUrl?: string;
  impactsAbs?: boolean;
  impactsCoverage?: boolean;
};

export type ScheduleImportInput = {
  fileName: string;
  allowPartial?: boolean;
  rows: Array<Record<string, unknown>>;
};

export async function getOperationalSchedules(actor: Actor, query: ScheduleQuery = {}) {
  try {
    const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true, employeeProfile: true } });
    if (!user) return allowDemoDataFallback ? getMockSchedulesForActor(actor) : emptyOperationalSchedules();

    const role = normalizeRole(actor.role);
    if (role === "COLABORADOR" && !user.employeeProfile) return emptyOperationalSchedules();
    const period = resolvePeriod(query);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(25, Number(query.limit) || 75));
    const scheduleWhere: Prisma.ScheduleWhereInput = {
      deletedAt: null,
      date: { gte: period.start, lte: period.end },
      ...(query.status && query.status !== "Todos" ? { status: uiToScheduleStatus[query.status] ?? undefined } : {})
    };
    const search = query.collaborator?.trim();
    const employees = await prisma.employeeProfile.findMany({
      where:
        role === "COLABORADOR" && user.employeeProfile
          ? { id: user.employeeProfile.id, deletedAt: null }
          : {
            deletedAt: null,
            ...employeeFilters(query, search)
          },
      include: {
        user: { select: { email: true } },
        lob: { select: { name: true } },
        shift: { select: { name: true } },
        supervisor: { select: { fullName: true } },
        schedules: {
          where: scheduleWhere,
          select: {
            id: true,
            date: true,
            startsAt: true,
            endsAt: true,
            status: true,
            observation: true,
            shift: { select: { name: true } },
            attendanceRecords: {
              orderBy: { updatedAt: "desc" },
              take: 1,
              select: { status: true, absenceReason: true, isJustified: true, updatedAt: true }
            },
            workHourRecords: {
              orderBy: { updatedAt: "desc" },
              take: 1,
              select: {
                id: true,
                plannedStart: true,
                plannedEnd: true,
                plannedHours: true,
                actualStart: true,
                actualEnd: true,
                actualHours: true,
                effectiveStart: true,
                effectiveEnd: true,
                effectiveHours: true,
                differenceMinutes: true,
                status: true,
                source: true,
                observation: true,
                updatedAt: true,
                adjustments: {
                  orderBy: { createdAt: "desc" },
                  take: 1,
                  select: { id: true, status: true, reason: true, createdAt: true }
                }
              }
            }
          },
          orderBy: { date: "asc" }
        }
      },
      orderBy: { fullName: "asc" },
      skip: role === "COLABORADOR" ? 0 : (page - 1) * limit,
      take: role === "COLABORADOR" ? 1 : limit
    });

    const visibleEmployees = role === "COLABORADOR" ? employees : employees.filter((employee) => employee.schedules.length > 0);
    if (!visibleEmployees.length) return emptyOperationalSchedules(period);

    const scheduleGridRows = visibleEmployees.map((employee) => ({
      employee: {
        id: employee.id,
        name: employee.fullName,
        wb: employee.wbLogin,
        email: employee.user?.email ?? "",
        lob: employee.lob.name,
        supervisor: employee.supervisor?.fullName ?? "Sem supervisor",
        shift: employee.shift.name,
        schedule: employee.scheduleType,
        status: employee.operationalStatus,
        quality: null,
        productivity: null,
        equipment: 0,
        admission: formatDate(employee.admissionDate),
        role: employee.roleTitle
      },
      days: Array.from({ length: period.daysInMonth }).map((_, index) => {
        const day = index + 1;
        const schedule = employee.schedules.find((item) => item.date.getUTCDate() === day);
        if (!schedule) return "Sem escala";
        const attendanceLabel = attendanceDisplayLabel(schedule.attendanceRecords);
        if (attendanceLabel) return attendanceLabel;
        if (schedule.status === "ESCALADO") return schedule.shift?.name ?? "Escalado";
        return scheduleToUiStatus[schedule.status] ?? schedule.status;
      }),
      plannedTimes: Array.from({ length: period.daysInMonth }).map((_, index) => {
        const day = index + 1;
        const schedule = employee.schedules.find((item) => item.date.getUTCDate() === day);
        return schedule
          ? {
            scheduleId: schedule.id,
            startsAt: schedule.startsAt ?? "",
            endsAt: schedule.endsAt ?? "",
            observation: schedule.observation ?? ""
          }
          : null;
      }),
      workHours: Array.from({ length: period.daysInMonth }).map((_, index) => {
        const day = index + 1;
        const schedule = employee.schedules.find((item) => item.date.getUTCDate() === day);
        const record = schedule?.workHourRecords?.[0];
        if (!record) return null;
        const adjustment = record.adjustments?.[0];
        return {
          id: record.id,
          plannedStart: record.plannedStart ?? "",
          plannedEnd: record.plannedEnd ?? "",
          plannedHours: record.plannedHours ?? 0,
          actualStart: record.actualStart ?? "",
          actualEnd: record.actualEnd ?? "",
          actualHours: record.actualHours,
          effectiveStart: record.effectiveStart ?? "",
          effectiveEnd: record.effectiveEnd ?? "",
          effectiveHours: record.effectiveHours,
          differenceMinutes: record.differenceMinutes ?? 0,
          status: workHourStatusLabel(record.status),
          rawStatus: record.status,
          source: record.source ?? "",
          observation: record.observation ?? "",
          adjustmentId: adjustment?.id ?? "",
          adjustmentStatus: adjustment ? workHourAdjustmentStatusLabel(adjustment.status) : "Sem ajuste",
          updatedAt: formatDateTime(record.updatedAt)
        };
      })
    }));

    const own = user.employeeProfile ? employees.find((employee) => employee.id === user.employeeProfile?.id) : null;
    const scheduleDays = calendarCells(period.year, period.month).map(({ date, outside }) => {
      const schedule = outside ? undefined : own?.schedules.find((item) => item.date.getUTCDate() === date);
      const label = schedule
        ? attendanceDisplayLabel(schedule.attendanceRecords) ?? (schedule.status === "ESCALADO" ? schedule.shift?.name ?? "Escalado" : scheduleToUiStatus[schedule.status] ?? "Escalado")
        : "Sem escala";
      return { date, outside, shift: label, label };
    });

    const imports = await prisma.scheduleImport.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { importedBy: true } });

    return {
      scheduleDays,
      scheduleGridRows,
      ownEmployee: own
        ? {
          id: own.id,
          name: own.fullName,
          schedule: own.scheduleType,
          shift: own.shift.name,
          lob: own.lob.name
        }
        : null,
      imports: imports.map((item) => ({
        id: item.id,
        fileName: item.fileName,
        importedRows: item.validRows,
        status: item.status,
        createdAt: formatDateTime(item.createdAt),
        user: item.importedBy.name
      })),
      attendanceSummary: await getAttendanceSummaryFromDb(period, query.lob),
      month: period.month,
      year: period.year,
      daysInMonth: period.daysInMonth
    };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "SCHEDULE_LIST_DB_FALLBACK", message: error instanceof Error ? error.message : "Falha ao listar escalas", action: "SCHEDULE_LIST", severity: "WARNING" });
    return allowDemoDataFallback ? getMockSchedulesForActor(actor) : emptyOperationalSchedules();
  }
}

function emptyOperationalSchedules(period = resolvePeriod({})) {
  return {
    scheduleDays: calendarCells(period.year, period.month).map(({ date, outside }) => ({ date, outside, shift: "Sem escala", label: "Sem escala" })),
    scheduleGridRows: [],
    ownEmployee: null,
    imports: [],
    month: period.month,
    year: period.year,
    daysInMonth: period.daysInMonth,
    attendanceSummary: {
      scheduled: 0,
      present: 0,
      absent: 0,
      delays: 0,
      earlyLeaves: 0,
      unjustified: 0,
      absRate: "0%",
      presenceRate: "0%",
      reasonBreakdown: []
    }
  };
}

export async function editOperationalSchedule(actor: Actor, input: ScheduleEditInput) {
  const validationError = validateScheduleEdit(input);
  if (validationError) return { error: validationError };

  try {
    const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true } });
    if (!user && allowDemoDataFallback) return editMockSchedule(actor, input);
    if (!user) return { error: "Usuário ativo não encontrado para editar escala." };
    if (!["ADMIN", "GESTOR", "WFM"].includes(normalizeRole(actor.role))) return { error: "Sem permissão para editar escala." };

    const date = parseDateOnly(input.date);
    if (!date) return { error: "Data inválida." };

    const employee = await prisma.employeeProfile.findUnique({ where: { id: input.employeeId }, include: { shift: true } });
    if (!employee) return { error: "Colaborador não encontrado." };

    const shift = input.shift ? await prisma.shift.findUnique({ where: { name: input.shift } }) : null;
    const status = uiToScheduleStatus[input.status] ?? "ESCALADO";
    const before = await prisma.schedule.findUnique({ where: { employeeId_date: { employeeId: employee.id, date } }, include: { shift: true } });

    const saved = await prisma.$transaction(async (tx) => {
      const schedule = await tx.schedule.upsert({
        where: { employeeId_date: { employeeId: employee.id, date } },
        update: {
          shiftId: needsTime(input.status) ? shift?.id ?? employee.shiftId : null,
          startsAt: needsTime(input.status) ? input.startsAt || shift?.startsAt || employee.shift.startsAt : null,
          endsAt: needsTime(input.status) ? input.endsAt || shift?.endsAt || employee.shift.endsAt : null,
          status,
          lobId: employee.lobId,
          supervisorId: employee.supervisorId,
          observation: input.observation
        },
        create: {
          employeeId: employee.id,
          shiftId: needsTime(input.status) ? shift?.id ?? employee.shiftId : null,
          date,
          startsAt: needsTime(input.status) ? input.startsAt || shift?.startsAt || employee.shift.startsAt : null,
          endsAt: needsTime(input.status) ? input.endsAt || shift?.endsAt || employee.shift.endsAt : null,
          status,
          source: "manual-edit",
          lobId: employee.lobId,
          supervisorId: employee.supervisorId,
          observation: input.observation
        }
      });

      await tx.scheduleChangeHistory.create({
        data: {
          scheduleId: schedule.id,
          employeeId: employee.id,
          changedById: user.id,
          date,
          before: serialize(before),
          after: serialize(schedule),
          previousValue: serialize(before),
          newValue: serialize(schedule),
          reason: input.observation || `Edição de escala para ${input.status}`
        }
      });

      let attendanceRecord: { id: string } | null = null;
      if (uiToAttendanceStatus[input.status]) {
        attendanceRecord = (await upsertAttendance(tx, user.id, employee.id, schedule.id, date, input)) ?? null;
      }

      await tx.employeeProfile.update({ where: { id: employee.id }, data: { operationalStatus: statusToOperational(input.status) } });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "ALTERACAO_ESCALA",
          entity: "Schedule",
          entityId: schedule.id,
          reason: input.observation || `Status ${input.status}`,
          previousValue: serialize(before),
          newValue: serialize(schedule)
        }
      });

      if (attendanceRecord && isPendingJustificationInput(input)) {
        await notifyAttendanceImpact(tx, employee.id, attendanceRecord.id, input.status, input.observation);
      }

      return schedule;
    });

    return { data: saved, summary: await getAttendanceSummaryFromDb(), schedules: await getOperationalSchedules(actor) };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "SCHEDULE_EDIT_DB_FALLBACK", message: error instanceof Error ? error.message : "Falha ao editar escala", action: "SCHEDULE_EDIT", severity: "ERROR" });
    return allowDemoDataFallback ? editMockSchedule(actor, input) : { error: "Não foi possível editar a escala no banco." };
  }
}

export async function updateOperationalAttendance(actor: Actor, input: AttendanceInput) {
  const validationError = validateAttendance(input);
  if (validationError) return { error: validationError };
  const role = normalizeRole(actor.role);

  if (role === "SUPERVISOR") {
    return justifyAttendanceAsSupervisor(actor, input);
  }

  const defaultTimes = defaultShiftTimes[input.shift] ?? defaultShiftTimes.Manhã;

  const scheduleResult = await editOperationalSchedule(actor, {
    employeeId: input.employeeId,
    date: input.date,
    shift: input.shift,
    status: input.status,
    observation: input.supervisorJustification || input.absenceReason,
    startsAt: needsTime(input.status) ? defaultTimes.startsAt : "",
    endsAt: needsTime(input.status) ? defaultTimes.endsAt : "",
    impactsAbs: input.impactsAbs,
    impactsCoverage: input.impactsCoverage,
    hasEvidence: input.hasEvidence,
    evidenceUrl: input.evidenceUrl
  });

  if ("error" in scheduleResult) return scheduleResult;
  return {
    data: {
      employeeId: input.employeeId,
      date: input.date,
      shift: input.shift,
      status: input.status,
      absenceReason: input.absenceReason,
      supervisorJustification: input.supervisorJustification
    },
    summary: scheduleResult.summary
  };
}

async function justifyAttendanceAsSupervisor(actor: Actor, input: AttendanceInput) {
  if (!supervisorJustificationStatuses.includes(input.status)) {
    return { error: "Supervisor só pode justificar ocorrências. Presença, escala, folga, férias e treinamento são atualizados pelo WFM/Admin." };
  }
  if (!input.absenceReason?.trim()) return { error: "Motivo obrigatório para justificar a ocorrência." };
  if (!input.supervisorJustification?.trim()) return { error: "Justificativa obrigatória para encerrar a pendência." };

  try {
    const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true, employeeProfile: true } });
    if (!user) return { error: "Usuário ativo não encontrado para justificar ocorrência." };
    if (!user.employeeProfile) return { error: "Supervisor sem perfil de funcionário vinculado." };

    const date = parseDateOnly(input.date);
    if (!date) return { error: "Data inválida." };

    const employee = await prisma.employeeProfile.findFirst({
      where: { id: input.employeeId, deletedAt: null },
      include: { shift: true, supervisor: true }
    });
    if (!employee) return { error: "Colaborador não encontrado." };
    if (employee.supervisorId && employee.supervisorId !== user.employeeProfile.id) {
      return { error: "Supervisor só pode justificar colaboradores vinculados ao seu time." };
    }

    const status = uiToAttendanceStatus[input.status];
    if (!status) return { error: "Status de ocorrência inválido." };

    const schedule = await prisma.schedule.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date } },
      include: { shift: true }
    });
    if (!schedule) return { error: "Ocorrência de escala não encontrada para esta data. WFM/Admin precisa registrar a ocorrência antes da justificativa." };
    const shift = schedule.shift ?? employee.shift;
    const existing = await prisma.attendanceRecord.findFirst({
      where: {
        employeeId: employee.id,
        date,
        OR: [{ scheduleId: schedule.id }, { shiftId: shift.id }]
      }
    });
    if (!existing) return { error: "Nenhuma pendência de justificativa foi registrada para este colaborador/data." };
    const existingStatus = scheduleToUiStatus[existing.status] ?? String(existing.status);
    if (!supervisorJustificationStatuses.includes(existingStatus)) return { error: "Esta ocorrência não é uma ausência justificável pelo Supervisor." };
    if (existing.isJustified) return { error: "Esta ocorrência já foi justificada." };

    const saved = await prisma.$transaction(async (tx) => {
      const record = await tx.attendanceRecord.update({
        where: { id: existing.id },
        data: {
          scheduleId: schedule.id,
          status,
          absenceReason: input.absenceReason,
          reasonCategory: input.reasonCategory,
          supervisorJustification: input.supervisorJustification,
          hasEvidence: input.hasEvidence ?? false,
          evidenceUrl: input.evidenceUrl,
          isJustified: true,
          impactsAbs: input.impactsAbs ?? impactsAbs(input.status, input.absenceReason),
          impactsCoverage: input.impactsCoverage ?? impactsCoverage(input.status),
          justifiedById: user.id,
          justifiedAt: new Date()
        }
      });

      await tx.attendanceHistory.create({
        data: {
          attendanceRecordId: record.id,
          changedById: user.id,
          previousStatus: existing?.status,
          newStatus: status,
          previousReason: existing?.absenceReason,
          newReason: input.absenceReason,
          comment: input.supervisorJustification || input.absenceReason
        }
      });

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "EDICAO",
          entity: "AttendanceRecord",
          entityId: record.id,
          reason: "Justificativa de ocorrência registrada pelo Supervisor",
          previousValue: serialize(existing),
          newValue: serialize(record)
        }
      });

      const reviewers = await tx.user.findMany({
        where: {
          status: "ACTIVE",
          deletedAt: null,
          id: { not: user.id },
          role: { name: { in: ["ADMIN", "WFM", "GESTOR"] } }
        },
        select: { id: true }
      });
      if (reviewers.length) {
        await tx.notification.createMany({
          data: reviewers.map((reviewer) => ({
            userId: reviewer.id,
            title: "Justificativa de ausência enviada",
            body: `${user.name} justificou uma ocorrência de ${employee.fullName}.`,
            category: "Presença",
            type: "INFO",
            entity: "AttendanceRecord",
            entityId: record.id,
            href: "/escalas"
          }))
        });
      }

      return record;
    });

    return {
      data: {
        id: saved.id,
        employeeId: employee.id,
        employeeName: employee.fullName,
        date: formatDate(date),
        dateIso: date.toISOString().slice(0, 10),
        shift: shift.name,
        status: input.status,
        absenceReason: saved.absenceReason ?? undefined,
        reasonCategory: saved.reasonCategory ?? undefined,
        supervisorJustification: saved.supervisorJustification ?? undefined,
        isJustified: saved.isJustified,
        impactsAbs: saved.impactsAbs,
        impactsCoverage: saved.impactsCoverage,
        registeredBy: user.name,
        registeredAt: formatDateTime(saved.registeredAt)
      },
      summary: await getAttendanceSummaryFromDb(resolveAttendancePeriod({ month: date.getUTCMonth() + 1, year: date.getUTCFullYear() }))
    };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "SUPERVISOR_ATTENDANCE_JUSTIFICATION_ERROR", message: error instanceof Error ? error.message : "Falha ao justificar ocorrência", action: "ATTENDANCE_JUSTIFY", severity: "ERROR" });
    return { error: "Não foi possível salvar a justificativa da ocorrência." };
  }
}

export async function removeOperationalSchedules(actor: Actor, input: ScheduleRemoveInput) {
  try {
    const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true } });
    if (!user) return { error: "Usuário ativo não encontrado para remover escala." };
    if (!["ADMIN", "GESTOR", "WFM"].includes(normalizeRole(actor.role))) return { error: "Sem permissão para remover escalas." };
    if (!input.employeeId) return { error: "Informe o colaborador." };

    const employee = await prisma.employeeProfile.findUnique({ where: { id: input.employeeId } });
    if (!employee) return { error: "Colaborador não encontrado." };
    const period = resolvePeriod(input);
    const where: Prisma.ScheduleWhereInput = {
      employeeId: input.employeeId,
      deletedAt: null,
      ...(input.scope === "all" ? {} : { date: { gte: period.start, lte: period.end } })
    };
    const schedules = await prisma.schedule.findMany({ where });
    if (!schedules.length) return { error: "Nenhuma escala encontrada para remover." };

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.schedule.updateMany({ where, data: { deletedAt: now, observation: "Escala removida manualmente" } });
      for (const schedule of schedules) {
        await tx.scheduleChangeHistory.create({
          data: {
            scheduleId: schedule.id,
            employeeId: employee.id,
            changedById: user.id,
            date: schedule.date,
            before: serialize(schedule),
            after: { deletedAt: now.toISOString() },
            previousValue: serialize(schedule),
            newValue: { deletedAt: now.toISOString() },
            reason: input.scope === "all" ? "Remoção de todas as escalas do colaborador" : `Remoção de escala do período ${period.month}/${period.year}`
          }
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "ALTERACAO_ESCALA",
          entity: "Schedule",
          entityId: employee.id,
          reason: input.scope === "all" ? "Remoção de todas as escalas do colaborador" : `Remoção de escala do colaborador no mês ${period.month}/${period.year}`,
          previousValue: { affectedSchedules: schedules.length },
          newValue: { deletedAt: true }
        }
      });
    });

    return { success: true, message: `${schedules.length} registro(s) de escala removido(s).`, schedules: await getOperationalSchedules(actor, input) };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "SCHEDULE_REMOVE_DB_ERROR", message: error instanceof Error ? error.message : "Falha ao remover escala", action: "SCHEDULE_REMOVE", severity: "ERROR" });
    return { error: "Não foi possível remover a escala do colaborador." };
  }
}

export async function previewOperationalScheduleImport(actor: Actor, rows: Array<Record<string, unknown>>) {
  if (!["ADMIN", "GESTOR", "WFM"].includes(normalizeRole(actor.role))) {
    return toImportPreview(
      rows,
      rows.map((_, index) => ({
        rowNumber: index + 1,
        errors: ["Sem permissão para importar escala. Supervisor apenas visualiza e justifica ocorrências."],
        warnings: []
      }))
    );
  }
  try {
    const validation = await validateImportRowsInDb(rows);
    return toImportPreview(rows, validation);
  } catch {
    if (allowDemoDataFallback) return previewMockScheduleRows(rows);
    return toImportPreview(
      rows,
      rows.map((_, index) => ({
        rowNumber: index + 1,
        errors: ["Não foi possível validar no banco. Verifique a conexão antes de importar."],
        warnings: []
      }))
    );
  }
}

export async function commitOperationalScheduleImport(actor: Actor, input: ScheduleImportInput) {
  try {
    const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true } });
    if (!user && allowDemoDataFallback) return commitMockScheduleImport(actor, { ...input, allowPartial: Boolean(input.allowPartial) });
    if (!user) return { error: "Usuário ativo não encontrado para importar escala." };
    if (!["ADMIN", "GESTOR", "WFM"].includes(normalizeRole(actor.role))) return { error: "Sem permissão para importar escala." };

    const validation = await validateImportRowsInDb(input.rows);
    const hasErrors = validation.some((row) => row.errors.length);
    if (hasErrors && !input.allowPartial) return { error: "Existem erros na importação. Corrija ou confirme importação parcial.", preview: toImportPreview(input.rows, validation) };

    const result = await prisma.$transaction(async (tx) => {
      const importRecord = await tx.scheduleImport.create({
        data: {
          fileName: input.fileName,
          importedById: user.id,
          status: hasErrors ? "Atenção" : "Sucesso",
          totalRows: input.rows.length,
          validRows: validation.filter((row) => !row.errors.length).length,
          errorRows: validation.filter((row) => row.errors.length).length,
          warnings: validation.filter((row) => row.warnings.length).map((row) => ({ row: row.rowNumber, warnings: row.warnings }))
        }
      });

      let importedRows = 0;
      for (const rowValidation of validation) {
        const row = input.rows[rowValidation.rowNumber - 1] ?? {};
        const parsedDate = parseImportDate(row.data);
        await tx.scheduleImportRow.create({
          data: {
            importId: importRecord.id,
            rowNumber: rowValidation.rowNumber,
            wbLogin: text(row.wb_login),
            name: "",
            lob: text(row.lob),
            supervisor: text(row.supervisor_wb_login),
            date: parsedDate,
            shift: text(row.turno),
            startsAt: text(row.entrada),
            endsAt: text(row.saida),
            status: text(row.status),
            observation: text(row.observacao),
            validation: rowValidation
          }
        });

        if (rowValidation.errors.length || !parsedDate) continue;

        const employee = await findEmployeeForImport(tx, row);
        if (!employee) continue;
        const shift = text(row.turno) ? await tx.shift.findUnique({ where: { name: text(row.turno) } }) : null;
        const status = uiToScheduleStatus[text(row.status)] ?? "ESCALADO";
        const before = await tx.schedule.findUnique({ where: { employeeId_date: { employeeId: employee.id, date: parsedDate } }, include: { shift: true } });

        const saved = await tx.schedule.upsert({
          where: { employeeId_date: { employeeId: employee.id, date: parsedDate } },
          update: {
            shiftId: needsTime(text(row.status)) ? shift?.id ?? employee.shiftId : null,
            startsAt: needsTime(text(row.status)) ? text(row.entrada) || shift?.startsAt || employee.shift.startsAt : null,
            endsAt: needsTime(text(row.status)) ? text(row.saida) || shift?.endsAt || employee.shift.endsAt : null,
            status,
            lobId: employee.lobId,
            supervisorId: employee.supervisorId,
            observation: text(row.observacao),
            source: "excel-import"
          },
          create: {
            employeeId: employee.id,
            shiftId: needsTime(text(row.status)) ? shift?.id ?? employee.shiftId : null,
            date: parsedDate,
            startsAt: needsTime(text(row.status)) ? text(row.entrada) || shift?.startsAt || employee.shift.startsAt : null,
            endsAt: needsTime(text(row.status)) ? text(row.saida) || shift?.endsAt || employee.shift.endsAt : null,
            status,
            source: "excel-import",
            lobId: employee.lobId,
            supervisorId: employee.supervisorId,
            observation: text(row.observacao)
          }
        });

        await tx.scheduleChangeHistory.create({
          data: {
            scheduleId: saved.id,
            employeeId: employee.id,
            changedById: user.id,
            date: parsedDate,
            before: serialize(before),
            after: serialize(saved),
            previousValue: serialize(before),
            newValue: serialize(saved),
            reason: `Importação de escala ${input.fileName}`
          }
        });
        importedRows += 1;
      }

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "IMPORTACAO",
          entity: "ScheduleImport",
          entityId: importRecord.id,
          reason: `${importedRows} linhas importadas de ${input.fileName}`,
          newValue: { fileName: input.fileName, importedRows, totalRows: input.rows.length }
        }
      });

      return {
        id: importRecord.id,
        fileName: importRecord.fileName,
        importedRows,
        status: importRecord.status,
        createdAt: formatDateTime(importRecord.createdAt),
        user: user.name
      };
    });

    return { data: result, preview: toImportPreview(input.rows, validation) };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "SCHEDULE_IMPORT_DB_FALLBACK", message: error instanceof Error ? error.message : "Falha ao importar escala", action: "SCHEDULE_IMPORT", severity: "ERROR" });
    if (allowDemoDataFallback) return commitMockScheduleImport(actor, { ...input, allowPartial: Boolean(input.allowPartial) });
    return { error: "Não foi possível importar a escala no banco." };
  }
}

export async function getOperationalAttendance(actor: Actor, query: AttendanceQuery = {}) {
  try {
    const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true, employeeProfile: true } });
    if (!user) {
      return allowDemoDataFallback
        ? { data: listMockAttendanceRecords(actor), summary: getMockAttendanceSummary(actor) }
        : { data: [], summary: emptyAttendanceSummary() };
    }

    const role = normalizeRole(actor.role);
    const period = resolveAttendancePeriod(query);
    const lobFilter = query.lob && query.lob !== "Todos" ? query.lob : undefined;
    const baseWhere: Prisma.AttendanceRecordWhereInput = {
      ...(period ? { date: { gte: period.start, lte: period.end } } : {}),
      ...(lobFilter ? { employee: { lob: { name: lobFilter } } } : {})
    };
    let attendanceWhere: Prisma.AttendanceRecordWhereInput =
      role === "COLABORADOR" && user.employeeProfile
        ? { ...baseWhere, employeeId: user.employeeProfile.id }
        : baseWhere;
    if (role === "SUPERVISOR" && user.employeeProfile) {
      const ownTeamRecords = await prisma.attendanceRecord.count({
        where: { ...baseWhere, employee: { supervisorId: user.employeeProfile.id, ...(lobFilter ? { lob: { name: lobFilter } } : {}) } }
      });
      attendanceWhere = ownTeamRecords
        ? { ...baseWhere, employee: { supervisorId: user.employeeProfile.id, ...(lobFilter ? { lob: { name: lobFilter } } : {}) } }
        : baseWhere;
    }
    const records = await prisma.attendanceRecord.findMany({
      where: attendanceWhere,
      include: { employee: { include: { shift: true } }, registeredBy: true },
      orderBy: { registeredAt: "desc" },
      take: 100
    });

    return {
      data: records.map((record) => ({
        id: record.id,
        employeeId: record.employeeId,
        employeeName: record.employee.fullName,
        date: formatDate(record.date),
        dateIso: record.date.toISOString().slice(0, 10),
        shift: record.employee.shift.name,
        status: scheduleToUiStatus[record.status] ?? record.status,
        absenceReason: record.absenceReason ?? undefined,
        reasonCategory: record.reasonCategory ?? undefined,
        supervisorJustification: record.supervisorJustification ?? undefined,
        isJustified: record.isJustified,
        impactsAbs: record.impactsAbs,
        impactsCoverage: record.impactsCoverage,
        registeredBy: record.registeredBy?.name ?? "Sistema",
        registeredAt: formatDateTime(record.registeredAt)
      })),
      summary: await getAttendanceSummaryFromDb(period, lobFilter)
    };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "ATTENDANCE_LIST_DB_FALLBACK", message: error instanceof Error ? error.message : "Falha ao listar presença", action: "ATTENDANCE_LIST", severity: "WARNING" });
    return allowDemoDataFallback ? { data: listMockAttendanceRecords(actor), summary: getMockAttendanceSummary(actor) } : { data: [], summary: emptyAttendanceSummary() };
  }
}

function editMockSchedule(actor: Actor, input: ScheduleEditInput) {
  const attendance = updateMockAttendance(actor, {
    employeeId: input.employeeId,
    date: input.date,
    shift: input.shift,
    status: input.status,
    absenceReason: input.observation,
    reasonCategory: "Escala",
    supervisorJustification: input.observation
  });
  if ("error" in attendance) return attendance;
  return { data: attendance.data, summary: attendance.summary, schedules: getMockSchedulesForActor(actor) };
}

function validateScheduleEdit(input: ScheduleEditInput) {
  if (!input.employeeId) return "Colaborador obrigatório.";
  if (!input.date) return "Data obrigatória.";
  if (!input.status) return "Status obrigatório.";
  if (needsTime(input.status) && (!input.shift || !input.startsAt || !input.endsAt)) return "Turno, entrada e saída são obrigatórios para Escalado ou Presente.";
  if (requiresReason(input.status) && !input.observation?.trim() && !input.pendingJustification) return "Motivo ou observação obrigatório para este status, exceto quando marcado como sem justificativa.";
  return "";
}

function isPendingJustificationInput(input: ScheduleEditInput) {
  const observation = input.observation?.trim() ?? "";
  return requiresReason(input.status) && (Boolean(input.pendingJustification) || !observation || /^sem justificativa/i.test(observation));
}

function attendanceDisplayLabel(records: Array<{ status: AttendanceStatus | string; isJustified: boolean; updatedAt: Date }>) {
  const latest = [...records].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  if (!latest) return null;
  const status = scheduleToUiStatus[String(latest.status)] ?? String(latest.status);
  if (!requiresReason(status)) return null;
  return latest.isJustified ? `${status} justificada` : `${status} sem justificativa`;
}

async function validateImportRowsInDb(rows: Array<Record<string, unknown>>) {
  const validations = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const errors: string[] = [];
    const warnings: string[] = [];
    const rowNumber = index + 1;

    if (!text(row.wb_login)) errors.push("WB/Login obrigatório para importar escala.");
    const parsedDate = parseImportDate(row.data);
    if (!parsedDate) errors.push("Data obrigatória ou inválida.");
    if (parsedDate && (parsedDate.getUTCFullYear() !== 2026 || parsedDate.getUTCMonth() !== 4)) {
      warnings.push("Data fora de maio de 2026. A linha será preservada, mas não aparecerá no filtro inicial de teste.");
    }
    if (!text(row.status)) errors.push("Status obrigatório.");

    const status = text(row.status);
    if ((status === "Escalado" || status === "Presente") && !text(row.turno)) errors.push("Turno obrigatório para Escalado/Presente.");
    if ((status === "Escalado" || status === "Presente") && !text(row.entrada)) errors.push("Entrada obrigatória para Escalado/Presente.");
    if ((status === "Escalado" || status === "Presente") && !text(row.saida)) errors.push("Saída obrigatória para Escalado/Presente.");
    if (text(row.turno)) {
      const shift = await prisma.shift.findUnique({ where: { name: text(row.turno) } });
      if (!shift) errors.push(`Turno ${text(row.turno)} não cadastrado.`);
    }
    if (text(row.lob)) {
      const lob = await prisma.lob.findUnique({ where: { name: text(row.lob) } });
      if (!lob) warnings.push(`LOB ${text(row.lob)} não cadastrado; será usado o LOB do colaborador existente.`);
    }
    if (status && !(uiToScheduleStatus[status] ?? null)) errors.push(`Status inválido: ${status}.`);

    const employee = await findEmployeeForImport(prisma, row);
    if (!employee) errors.push("WB/Login não encontrado na base de funcionários. Cadastre/aprove o funcionário antes de importar escala.");

    validations.push({ rowNumber, errors, warnings });
  }
  return validations;
}

function toImportPreview(rows: Array<Record<string, unknown>>, validation: Array<{ rowNumber: number; errors: string[]; warnings: string[] }>) {
  return {
    rows,
    totalRows: rows.length,
    validRows: validation.filter((row) => !row.errors.length).length,
    errorRows: validation.filter((row) => row.errors.length).length,
    validation
  };
}

function validateAttendance(input: AttendanceInput) {
  if (requiresReason(input.status) && !input.absenceReason?.trim() && !input.supervisorJustification?.trim()) {
    return "Motivo/observação obrigatório para ausência, falta, atraso, saída antecipada, afastado ou erro de escala.";
  }
  return "";
}

function requiresReason(status: string) {
  return statusesRequiringReason.includes(status);
}

function needsTime(status: string) {
  return ["Escalado", "Presente", "Venda de folga aprovada"].includes(status);
}

function impactsAbs(status: string, reason?: string) {
  if (["Falta", "Ausente"].includes(status)) return true;
  if (status === "Atraso" || status === "Saída antecipada") return false;
  if (/falta de equipamento|problema técnico|internet/i.test(reason ?? "")) return false;
  return false;
}

function impactsCoverage(status: string) {
  return ["Ausente", "Falta", "Atraso", "Saída antecipada", "Afastado", "Sem escala"].includes(status);
}

async function upsertAttendance(tx: Prisma.TransactionClient, userId: string, employeeId: string, scheduleId: string, date: Date, input: ScheduleEditInput) {
  const status = uiToAttendanceStatus[input.status];
  if (!status) return;
  const existing = await tx.attendanceRecord.findFirst({ where: { employeeId, scheduleId } });
  const pendingJustification = isPendingJustificationInput(input);
  const observation = input.observation?.trim();
  const savedReason = pendingJustification ? "Sem justificativa" : observation || undefined;
  const absImpact = input.impactsAbs ?? impactsAbs(input.status, savedReason);
  const coverageImpact = input.impactsCoverage ?? impactsCoverage(input.status);
  const saved = existing
    ? await tx.attendanceRecord.update({
        where: { id: existing.id },
        data: {
          status,
          absenceReason: savedReason,
          reasonCategory: requiresReason(input.status) ? "Escala" : undefined,
          supervisorJustification: pendingJustification ? null : observation || null,
          isJustified: !requiresReason(input.status) || !pendingJustification,
          impactsAbs: absImpact,
          impactsCoverage: coverageImpact,
          hasEvidence: input.hasEvidence ?? false,
          evidenceUrl: input.evidenceUrl,
          registeredById: userId,
          justifiedById: !pendingJustification && observation ? userId : null,
          justifiedAt: !pendingJustification && observation ? new Date() : null
        }
      })
    : await tx.attendanceRecord.create({
        data: {
          employeeId,
          scheduleId,
          date,
          status,
          absenceReason: savedReason,
          reasonCategory: requiresReason(input.status) ? "Escala" : undefined,
          supervisorJustification: pendingJustification ? null : observation || null,
          isJustified: !requiresReason(input.status) || !pendingJustification,
          impactsAbs: absImpact,
          impactsCoverage: coverageImpact,
          hasEvidence: input.hasEvidence ?? false,
          evidenceUrl: input.evidenceUrl,
          registeredById: userId,
          justifiedById: !pendingJustification && observation ? userId : undefined,
          justifiedAt: !pendingJustification && observation ? new Date() : undefined
        }
      });

  await tx.attendanceHistory.create({
    data: {
      attendanceRecordId: saved.id,
      changedById: userId,
      previousStatus: existing?.status,
      newStatus: status,
      previousReason: existing?.absenceReason,
      newReason: savedReason,
      comment: pendingJustification ? "Ocorrência marcada sem justificativa; pendente de supervisor." : observation
    }
  });

  return saved;
}

async function notifyAttendanceImpact(tx: Prisma.TransactionClient, employeeId: string, attendanceRecordId: string, status: string, observation?: string) {
  const employee = await tx.employeeProfile.findUnique({ where: { id: employeeId }, include: { supervisor: { include: { user: true } } } });
  if (!employee?.supervisor?.userId) return;
  const duplicate = await tx.notification.findFirst({
    where: {
      userId: employee.supervisor.userId,
      entity: "AttendanceRecord",
      entityId: attendanceRecordId,
      readAt: null
    }
  });
  if (duplicate) return;
  await tx.notification.create({
    data: {
      userId: employee.supervisor.userId,
      title: "Falta pendente de justificativa",
      body: `${employee.fullName} foi marcado como ${status} sem justificativa. ${observation ?? "Supervisor deve justificar a ocorrência."}`,
      category: "Presença",
      type: "WARNING",
      entity: "AttendanceRecord",
      entityId: attendanceRecordId,
      href: "/escalas"
    }
  });
}

async function getAttendanceSummaryFromDb(period?: ReturnType<typeof resolvePeriod>, lob?: string) {
  const schedules = await prisma.schedule.findMany({
    where: {
      deletedAt: null,
      ...(period ? { date: { gte: period.start, lte: period.end } } : {}),
      ...(lob && lob !== "Todos" ? { employee: { lob: { name: lob } } } : {})
    },
    select: {
      status: true,
      shift: { select: { name: true } },
      attendanceRecords: {
        select: {
          status: true,
          absenceReason: true,
          impactsAbs: true,
          isJustified: true,
          updatedAt: true
        }
      }
    }
  });
  const plannedStatuses: ScheduleStatus[] = ["ESCALADO", "PRESENTE", "ATRASO", "SAIDA_ANTECIPADA", "AUSENTE", "FALTA", "VENDA_FOLGA_APROVADA"];
  const presentStatuses = ["PRESENTE", "VENDA_FOLGA_APROVADA"];
  const absentStatuses = ["AUSENTE", "FALTA", "AFASTADO", "SAIDA_ANTECIPADA"];
  const effectiveStatus = (schedule: (typeof schedules)[number]) => {
    const latest = [...schedule.attendanceRecords].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    return latest?.status ?? schedule.status;
  };
  const planned = schedules.filter((schedule) => plannedStatuses.includes(schedule.status)).length;
  const present = schedules.filter((schedule) => presentStatuses.includes(String(effectiveStatus(schedule)))).length;
  const absent = schedules.filter((schedule) => absentStatuses.includes(String(effectiveStatus(schedule)))).length;
  const denominator = planned || 1;
  const coverageRate = Math.round((present / denominator) * 1000) / 10;
  const absRate = Math.round((absent / denominator) * 1000) / 10;
  const attendanceRecords = schedules.flatMap((schedule) => schedule.attendanceRecords);
  const byShift = schedules.reduce<Record<string, { planned: number; present: number; absent: number; gap: number }>>((acc, schedule) => {
    const shiftName = schedule.shift?.name ?? "Sem turno";
    acc[shiftName] ??= { planned: 0, present: 0, absent: 0, gap: 0 };
    if (plannedStatuses.includes(schedule.status)) acc[shiftName].planned += 1;
    if (presentStatuses.includes(String(effectiveStatus(schedule)))) acc[shiftName].present += 1;
    if (absentStatuses.includes(String(effectiveStatus(schedule)))) acc[shiftName].absent += 1;
    acc[shiftName].gap = acc[shiftName].present - acc[shiftName].planned;
    return acc;
  }, {});
  const byReason = attendanceRecords.filter((record) => record.absenceReason).reduce<Record<string, number>>((acc, record) => {
    const key = record.absenceReason ?? "Outros";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  return {
    planned,
    present,
    absent,
    absRate,
    late: schedules.filter((schedule) => effectiveStatus(schedule) === "ATRASO").length,
    earlyLeave: schedules.filter((schedule) => effectiveStatus(schedule) === "SAIDA_ANTECIPADA").length,
    unjustified: attendanceRecords.filter((record) => record.impactsAbs && !record.isJustified).length,
    coverageRate,
    gap: present - planned,
    riskLevel: coverageRate >= 95 ? "Excelente" : coverageRate >= 90 ? "Adequado" : coverageRate >= 85 ? "Atenção" : "Crítico",
    byReason,
    byShift
  };
}

function emptyAttendanceSummary() {
  return {
    planned: 0,
    present: 0,
    absent: 0,
    absRate: 0,
    late: 0,
    earlyLeave: 0,
    unjustified: 0,
    coverageRate: 0,
    gap: 0,
    riskLevel: "Adequado",
    byReason: {},
    byShift: {}
  };
}

function statusToOperational(status: string) {
  if (status === "Presente") return "Online";
  if (status === "Atraso" || status === "Saída antecipada") return "Em Atendimento";
  if (["Ausente", "Falta", "Afastado"].includes(status)) return "Offline";
  return status;
}

function workHourStatusLabel(status: string) {
  const labels: Record<string, string> = {
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

function workHourAdjustmentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    ABERTO: "Aberto",
    EM_ANALISE: "Em análise",
    APROVADO: "Aprovado",
    RECUSADO: "Recusado",
    CANCELADO: "Cancelado"
  };
  return labels[status] ?? status;
}

function resolvePeriod(query: ScheduleQuery | ScheduleRemoveInput) {
  if ("startDate" in query || "endDate" in query) {
    const startDate = parseDateOnly(query.startDate || query.endDate || "");
    const endDate = parseDateOnly(query.endDate || query.startDate || "");
    if (startDate && endDate) {
      const start = startDate <= endDate ? startDate : endDate;
      const endBase = startDate <= endDate ? endDate : startDate;
      const end = new Date(Date.UTC(endBase.getUTCFullYear(), endBase.getUTCMonth(), endBase.getUTCDate(), 23, 59, 59, 999));
      return { year: start.getUTCFullYear(), month: start.getUTCMonth() + 1, start, end, daysInMonth: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate() };
    }
  }
  const year = Number(query.year) || 2026;
  const month = Number(query.month) || 5;
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { year, month, start, end, daysInMonth: end.getUTCDate() };
}

function resolveAttendancePeriod(query: AttendanceQuery) {
  if (query.startDate || query.endDate) {
    const startDate = parseDateOnly(query.startDate || query.endDate || "");
    const endDate = parseDateOnly(query.endDate || query.startDate || "");
    if (!startDate || !endDate) return undefined;
    const start = startDate <= endDate ? startDate : endDate;
    const endBase = startDate <= endDate ? endDate : startDate;
    const end = new Date(Date.UTC(endBase.getUTCFullYear(), endBase.getUTCMonth(), endBase.getUTCDate(), 23, 59, 59, 999));
    return {
      year: start.getUTCFullYear(),
      month: start.getUTCMonth() + 1,
      start,
      end,
      daysInMonth: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate()
    };
  }
  if (query.date) {
    const date = parseDateOnly(query.date);
    if (!date) return undefined;
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      start: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0)),
      end: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999)),
      daysInMonth: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
    };
  }
  if (query.month || query.year) return resolvePeriod(query);
  return undefined;
}

function employeeFilters(query: ScheduleQuery, search?: string): Prisma.EmployeeProfileWhereInput {
  return {
    ...(search ? {
      OR: [
        { fullName: { contains: search, mode: "insensitive" } },
        { wbLogin: { contains: search, mode: "insensitive" } },
        { user: { email: { contains: search, mode: "insensitive" } } }
      ]
    } : {}),
    ...(query.lob && query.lob !== "Todos" ? { lob: { name: query.lob } } : {}),
    ...(query.supervisor && query.supervisor !== "Todos" ? { supervisor: { fullName: { contains: query.supervisor, mode: "insensitive" } } } : {}),
    ...(query.shift && query.shift !== "Todos" ? { shift: { name: query.shift } } : {}),
    ...(query.roleTitle && query.roleTitle !== "Todos" ? { roleTitle: { contains: query.roleTitle, mode: "insensitive" } } : {})
  };
}

function calendarCells(year: number, month: number) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const leading = first.getUTCDay();
  const previousMonthDays = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  return Array.from({ length: 42 }).map((_, index) => {
    const dayNumber = index - leading + 1;
    const outside = dayNumber < 1 || dayNumber > daysInMonth;
    const date = outside ? (dayNumber < 1 ? previousMonthDays + dayNumber : dayNumber - daysInMonth) : dayNumber;
    return { date, outside };
  });
}

function parseDateOnly(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseImportDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000);
  }
  return parseDateOnly(String(value));
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

async function findEmployeeForImport(client: Prisma.TransactionClient | typeof prisma, row: Record<string, unknown>) {
  const wbLogin = text(row.wb_login);
  if (!wbLogin) return null;
  return client.employeeProfile.findFirst({ where: { wbLogin, deletedAt: null }, include: { shift: true } });
}

function serialize(value: unknown) {
  return value ? JSON.parse(JSON.stringify(value)) : {};
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("pt-BR").format(date);
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
