import { randomUUID } from "crypto";
import { AttendanceStatus, Prisma, ScheduleStatus, type WorkHourRecordStatus } from "@prisma/client";

import type { Actor } from "@/lib/mock-db";
import { commitScheduleImport as commitMockScheduleImport, getAttendanceSummary as getMockAttendanceSummary, getSchedulesForActor as getMockSchedulesForActor, listAttendanceRecords as listMockAttendanceRecords, previewScheduleRows as previewMockScheduleRows, recordErrorLog, updateAttendance as updateMockAttendance } from "@/lib/mock-db";
import { hasExcelValue, normalizeExcelDate, normalizeExcelTime } from "@/lib/excel-normalization";
import { prisma } from "@/lib/prisma";
import { normalizeRole } from "@/lib/permissions";
import { cleanShiftName, isBlockedShiftName, isSelectableShiftName, shiftLookupKey } from "@/lib/shift-display";
import { calculateAbsenceRate, calculateCoverageRate, isAbsenceStatus, isPresentStatus, isScheduledStatus, normalizeOperationalStatus } from "@/lib/attendance-calculation";
import { calculateProductiveDifferenceMinutes, isProductiveDifferenceWithinTolerance, plannedProductiveHoursForSchedule } from "@/lib/work-hours-rules";

const uiToScheduleStatus: Record<string, ScheduleStatus> = {
  Escalado: "ESCALADO",
  Presente: "PRESENTE",
  Falta: "FALTA",
  Atraso: "ATRASO",
  "Saída antecipada": "SAIDA_ANTECIPADA",
  Afastado: "AFASTADO",
  Férias: "FERIAS",
  Treinamento: "TREINAMENTO",
  Nesting: "NESTING",
  Folga: "FOLGA",
  "Troca aprovada": "TROCA_APROVADA",
  "Venda de folga aprovada": "VENDA_FOLGA_APROVADA",
  "Folga aprovada": "FOLGA_APROVADA",
  "Sem escala": "SEM_ESCALA",
  "Sem cronograma": "SEM_ESCALA",
  "Erro de escala": "ERRO_ESCALA",
  "Erro de cronograma": "ERRO_ESCALA",
  Feriado: "FERIADO",
  Conflito: "CONFLITO",
  Descoberto: "DESCOBERTO",
  Desligado: "DESLIGADO"
};

const allowedScheduleImportStatusKeys = new Set([
  "ESCALADO",
  "PRESENTE",
  "FALTA",
  "ATRASO",
  "SAIDA_ANTECIPADA",
  "AFASTADO",
  "FERIAS",
  "TREINAMENTO",
  "NESTING",
  "FOLGA",
  "TROCA_APROVADA",
  "VENDA_DE_FOLGA_APROVADA",
  "VENDA_FOLGA_APROVADA",
  "FOLGA_APROVADA",
  "SEM_ESCALA",
  "SEM_CRONOGRAMA",
  "ERRO_DE_ESCALA",
  "ERRO_DE_CRONOGRAMA",
  "ERRO_ESCALA",
  "DESLIGADO"
]);

const scheduleToUiStatus: Record<string, string> = {
  ...Object.fromEntries(Object.entries(uiToScheduleStatus).map(([ui, db]) => [db, ui])),
  AUSENTE: "Falta",
  SEM_ESCALA: "Sem cronograma",
  ERRO_ESCALA: "Erro de cronograma"
};

const uiToAttendanceStatus: Record<string, AttendanceStatus> = {
  Presente: "PRESENTE",
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
  "Sem cronograma": "SEM_ESCALA",
  "Erro de escala": "ERRO_ESCALA",
  "Erro de cronograma": "ERRO_ESCALA"
};

export const statusesRequiringReason = ["Falta", "Atraso", "Saída antecipada", "Erro de escala", "Erro de cronograma"];
const supervisorJustificationStatuses = ["Falta", "Atraso", "Saída antecipada", "Erro de escala", "Erro de cronograma"];

const defaultShiftTimes: Record<string, { startsAt: string; endsAt: string }> = {
  Manhã: { startsAt: "08:00", endsAt: "14:00" },
  Tarde: { startsAt: "14:00", endsAt: "20:00" },
  Noite: { startsAt: "20:00", endsAt: "02:00" },
  Folga: { startsAt: "", endsAt: "" }
};

const allowDemoDataFallback = process.env.ALLOW_DEMO_LOGIN === "true" || process.env.ALLOW_DEMO_DATA === "true";

export type ScheduleEditInput = {
  employeeId: string;
  date: string;
  shift: string;
  startsAt?: string;
  endsAt?: string;
  status: string;
  absenceReason?: string;
  reasonCategory?: string;
  supervisorJustification?: string;
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
  supervisor?: string;
  shift?: string;
  collaborator?: string;
  status?: string;
  roleTitle?: string;
  reason?: string;
  justification?: "pending" | "justified" | string;
  includeJustified?: boolean | string;
};

export type AttendanceInput = {
  attendanceRecordId?: string;
  scheduleId?: string;
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

type AttendanceSummaryFilters = Partial<Pick<ScheduleQuery, "lob" | "supervisor" | "shift" | "collaborator" | "status" | "roleTitle">> & {
  employeeId?: string;
  teamSupervisorId?: string;
};

export type ScheduleImportInput = {
  fileName: string;
  allowPartial?: boolean;
  rows: Array<Record<string, unknown>>;
};

type ScheduleImportValidation = {
  rowNumber: number;
  errors: string[];
  warnings: string[];
  action: "criar" | "atualizar" | "ignorar";
  employeeId?: string;
  employeeName?: string;
  employeeLobId?: string;
  employeeSupervisorId?: string | null;
  employeeShiftId?: string | null;
  employeeShiftStartsAt?: string | null;
  employeeShiftEndsAt?: string | null;
  shiftId?: string | null;
  shiftStartsAt?: string | null;
  shiftEndsAt?: string | null;
  lobId?: string | null;
  date?: Date;
  status?: ScheduleStatus;
  startsAt?: string;
  endsAt?: string;
};

export async function getOperationalSchedules(actor: Actor, query: ScheduleQuery = {}) {
  try {
    const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true, employeeProfile: true } });
    if (!user) return allowDemoDataFallback ? getMockSchedulesForActor(actor) : emptyOperationalSchedules();

    const role = normalizeRole(actor.role);
    if (role === "COLABORADOR" && !user.employeeProfile) return emptyOperationalSchedules();
    const period = resolvePeriod(query);
    const dateColumns = datesBetween(period.start, period.end);
    const requestedPage = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(25, Number(query.limit) || 75));
    const shiftFilter = cleanShiftName(query.shift);
    const scheduleWhere: Prisma.ScheduleWhereInput = {
      deletedAt: null,
      date: { gte: period.start, lte: period.end },
      ...(query.supervisor && query.supervisor !== "Todos" && isNoSupervisorFilter(query.supervisor) ? { supervisorId: null } : {}),
      ...(shiftFilter === "Folga" && (!query.status || query.status === "Todos") ? { status: "FOLGA" } : {}),
      ...(query.status && query.status !== "Todos" ? { status: uiToScheduleStatus[query.status] ?? undefined } : {})
    };
    const search = query.collaborator?.trim();
    const employeeWhere: Prisma.EmployeeProfileWhereInput =
      role === "COLABORADOR" && user.employeeProfile
        ? { id: user.employeeProfile.id }
        : employeeFilters(query, search);
    const supervisorFilter = await scheduleSupervisorFilter(query.supervisor);
    const scheduleRows = await prisma.schedule.findMany({
      where: {
        ...scheduleWhere,
        ...(supervisorFilter ?? {}),
        employee: employeeWhere
      },
      select: {
        id: true,
        employeeId: true,
        date: true,
        startsAt: true,
        endsAt: true,
        status: true,
        observation: true,
        shift: { select: { name: true } },
        attendanceRecords: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            absenceReason: true,
            reasonCategory: true,
            supervisorJustification: true,
            isJustified: true,
            impactsAbs: true,
            impactsCoverage: true,
            registeredAt: true,
            justifiedAt: true,
            updatedAt: true,
            registeredBy: { select: { name: true } },
            justifiedBy: { select: { name: true } },
            histories: {
              orderBy: { createdAt: "desc" },
              take: 5,
              select: {
                previousStatus: true,
                newStatus: true,
                previousReason: true,
                newReason: true,
                comment: true,
                createdAt: true,
                changedBy: { select: { name: true } }
              }
            }
          }
        },
        workHourRecords: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: {
            id: true,
            plannedStart: true,
            plannedEnd: true,
            plannedHours: true,
            actualHours: true,
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
        },
        employee: {
          select: {
            id: true,
            fullName: true,
            wbLogin: true,
            scheduleType: true,
            operationalStatus: true,
            admissionDate: true,
            roleTitle: true,
            user: { select: { email: true } },
            lob: { select: { name: true } },
            shift: { select: { name: true } },
            supervisor: { select: { fullName: true } }
          }
        }
      },
      orderBy: [{ date: "asc" }, { employeeId: "asc" }]
    });
    const scheduleEmployeeIds = Array.from(new Set(scheduleRows.map((schedule) => schedule.employeeId)));
    const relatedWorkHourRecords = scheduleEmployeeIds.length
      ? await prisma.workHourRecord.findMany({
          where: {
            employeeId: { in: scheduleEmployeeIds },
            date: { gte: period.start, lte: period.end }
          },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            employeeId: true,
            date: true,
            plannedStart: true,
            plannedEnd: true,
            plannedHours: true,
            actualHours: true,
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
        })
      : [];
    const workHourByEmployeeDay = new Map(
      relatedWorkHourRecords.map((record) => [`${record.employeeId}:${record.date.getTime()}`, record])
    );

    const grouped = new Map<string, { employee: (typeof scheduleRows)[number]["employee"]; schedules: typeof scheduleRows }>();
    scheduleRows.forEach((schedule) => {
      const current = grouped.get(schedule.employeeId);
      if (current) {
        current.schedules.push(schedule);
      } else {
        grouped.set(schedule.employeeId, { employee: schedule.employee, schedules: [schedule] });
      }
    });
    const groupedEmployees = Array.from(grouped.values()).sort((a, b) => a.employee.fullName.localeCompare(b.employee.fullName, "pt-BR"));
    const totalSchedules = groupedEmployees.length;
    const totalPages = Math.max(1, Math.ceil(totalSchedules / limit));
    const page = totalSchedules > 0 && requestedPage > totalPages ? 1 : requestedPage;
    const visibleEmployees = role === "COLABORADOR" ? groupedEmployees.slice(0, 1) : groupedEmployees.slice((page - 1) * limit, page * limit);

    const scheduleGridRows = visibleEmployees.map(({ employee, schedules }) => {
      const scheduleByDate = new Map(schedules.map((item) => [dateKey(item.date), item]));
      return {
      employee: {
        id: employee.id,
        name: employee.fullName,
        wb: employee.wbLogin,
        email: employee.user?.email ?? "",
        lob: employee.lob.name,
        supervisor: employee.supervisor?.fullName ?? "Sem supervisor",
        shift: cleanShiftName(employee.shift.name) || "Sem turno",
        schedule: employee.scheduleType,
        status: employee.operationalStatus,
        quality: null,
        productivity: null,
        equipment: 0,
        admission: formatDate(employee.admissionDate),
        role: employee.roleTitle
      },
      days: dateColumns.map((date) => {
        const schedule = scheduleByDate.get(dateKey(date));
        if (!schedule) return "Sem cronograma";
        const attendanceLabel = scheduleStatusRequiresJustification(schedule.status) ? attendanceDisplayLabel(schedule.attendanceRecords) : null;
        if (attendanceLabel) return attendanceLabel;
        return scheduleToUiStatus[schedule.status] ?? schedule.status;
      }),
      dayShifts: dateColumns.map((date) => {
        const schedule = scheduleByDate.get(dateKey(date));
        return schedule ? cleanShiftName(schedule.shift?.name ?? employee.shift?.name) || "Sem turno" : "Sem turno";
      }),
      plannedTimes: dateColumns.map((date) => {
        const schedule = scheduleByDate.get(dateKey(date));
        return schedule
          ? {
            scheduleId: schedule.id,
            startsAt: schedule.startsAt ?? "",
            endsAt: schedule.endsAt ?? "",
            shiftName: cleanShiftName(schedule.shift?.name ?? employee.shift?.name) || "Sem turno",
            observation: schedule.observation ?? "",
            justification: formatScheduleJustification(schedule.status, schedule.attendanceRecords)
          }
          : null;
      }),
      workHours: dateColumns.map((date) => {
        const schedule = scheduleByDate.get(dateKey(date));
        const record = schedule?.workHourRecords?.[0] ?? (schedule ? workHourByEmployeeDay.get(`${schedule.employeeId}:${schedule.date.getTime()}`) : undefined);
        if (!record) return null;
        const adjustment = record.adjustments?.[0];
        const plannedHours = schedule ? plannedProductiveHoursForSchedule(schedule) : null;
        const differenceMinutes = plannedHours !== null ? calculateProductiveDifferenceMinutes(record.effectiveHours, plannedHours) : record.differenceMinutes;
        const effectiveRecordStatus = resolveWorkHourStatusForSchedule(record.status, differenceMinutes);
        return {
          id: record.id,
          plannedStart: record.plannedStart ?? "",
          plannedEnd: record.plannedEnd ?? "",
          plannedHours: plannedHours ?? 0,
          actualHours: record.actualHours,
          effectiveHours: record.effectiveHours,
          differenceMinutes: differenceMinutes ?? 0,
          status: workHourStatusLabel(effectiveRecordStatus),
          rawStatus: effectiveRecordStatus,
          source: record.source ?? "",
          observation: record.observation ?? "",
          adjustmentId: adjustment?.id ?? "",
          adjustmentStatus: adjustment ? workHourAdjustmentStatusLabel(adjustment.status) : "Sem ajuste",
          updatedAt: formatDateTime(record.updatedAt)
        };
      })
    };
    });

    const own = user.employeeProfile
      ? await prisma.employeeProfile.findUnique({
        where: { id: user.employeeProfile.id },
        select: {
          id: true,
          fullName: true,
          scheduleType: true,
          lob: { select: { name: true } },
          shift: { select: { name: true } },
          schedules: {
            where: scheduleWhere,
            select: {
              date: true,
              status: true,
              shift: { select: { name: true } },
              attendanceRecords: {
                orderBy: { updatedAt: "desc" },
                take: 1,
                select: { status: true, absenceReason: true, isJustified: true, updatedAt: true }
              }
            },
            orderBy: { date: "asc" }
          }
        }
      })
      : null;
    const ownScheduleByDate = new Map((own?.schedules ?? []).map((item) => [dateKey(item.date), item]));
    const scheduleDayCells = isFullMonthPeriod(period) ? calendarCells(period.year, period.month) : dateColumns.map((date) => ({ date: date.getUTCDate(), dateIso: dateKey(date), outside: false }));
    const scheduleDays = scheduleDayCells.map((day) => {
      if (day.outside) return { ...day, shift: "Sem turno", label: "Sem cronograma" };
      const schedule = ownScheduleByDate.get(day.dateIso);
      const label = schedule
        ? (scheduleStatusRequiresJustification(schedule.status) ? attendanceDisplayLabel(schedule.attendanceRecords) : null) ?? (scheduleToUiStatus[schedule.status] ?? "Escalado")
        : "Sem cronograma";
      const shift = schedule ? cleanShiftName(schedule.shift?.name ?? own?.shift.name) || "Sem turno" : "Sem turno";
      return { ...day, shift, label };
    });

    const imports = await prisma.scheduleImport.findMany({ orderBy: { createdAt: "desc" }, include: { importedBy: true } });

    return {
      scheduleDays,
      scheduleGridRows,
      ownEmployee: own
        ? {
          id: own.id,
          name: own.fullName,
          schedule: own.scheduleType,
          shift: cleanShiftName(own.shift.name) || "Sem turno",
          lob: own.lob.name
        }
        : null,
      imports: imports.map((item) => ({
        id: item.id,
        fileName: item.fileName,
        importedRows: item.validRows,
        totalRows: item.totalRows,
        errorRows: item.errorRows,
        warningRows: Array.isArray(item.warnings) ? item.warnings.length : 0,
        status: item.status,
        createdAt: formatDateTime(item.createdAt),
        user: item.importedBy.name
      })),
      attendanceSummary: await getAttendanceSummaryFromDb(period, query),
      month: period.month,
      year: period.year,
      daysInMonth: dateColumns.length,
      dateColumns: dateColumns.map(dateKey),
      pagination: {
        page,
        limit,
        total: totalSchedules,
        totalPages
      }
    };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "SCHEDULE_LIST_DB_FALLBACK", message: error instanceof Error ? error.message : "Falha ao listar cronogramas", action: "SCHEDULE_LIST", severity: "WARNING" });
    return allowDemoDataFallback ? getMockSchedulesForActor(actor) : emptyOperationalSchedules();
  }
}

function emptyOperationalSchedules(period = resolvePeriod({}), pagination = { page: 1, limit: 75, total: 0, totalPages: 1 }) {
  const dateColumns = datesBetween(period.start, period.end);
  const scheduleDayCells = isFullMonthPeriod(period) ? calendarCells(period.year, period.month) : dateColumns.map((date) => ({ date: date.getUTCDate(), dateIso: dateKey(date), outside: false }));
  return {
    scheduleDays: scheduleDayCells.map((day) => ({ ...day, shift: "Sem turno", label: "Sem cronograma" })),
    scheduleGridRows: [],
    ownEmployee: null,
    imports: [],
    month: period.month,
    year: period.year,
    daysInMonth: dateColumns.length,
    dateColumns: dateColumns.map(dateKey),
    attendanceSummary: emptyAttendanceSummary(),
    pagination
  };
}

export async function editOperationalSchedule(actor: Actor, input: ScheduleEditInput) {
  const validationError = validateScheduleEdit(input);
  if (validationError) return { error: validationError };

  try {
    const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true } });
    if (!user && allowDemoDataFallback) return editMockSchedule(actor, input);
    if (!user) return { error: "Usuário ativo não encontrado para editar cronograma." };
    if (!["ADMIN", "GESTOR", "WFM"].includes(normalizeRole(actor.role))) return { error: "Sem permissão para editar cronograma." };

    const date = parseDateOnly(input.date);
    if (!date) return { error: "Data inválida." };

    const employee = await prisma.employeeProfile.findUnique({ where: { id: input.employeeId }, include: { shift: true } });
    if (!employee) return { error: "Colaborador não encontrado." };

    const requestedShift = cleanShiftName(input.shift);
    const shift = requestedShift && isSelectableShiftName(requestedShift)
      ? await prisma.shift.findFirst({
        where: {
          OR: [
            { name: requestedShift },
            { name: { startsWith: `${requestedShift} (` } }
          ]
        }
      })
      : null;
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
          reason: input.observation || `Edição de cronograma para ${input.status}`
        }
      });

      let attendanceRecord: { id: string } | null = null;
      if (uiToAttendanceStatus[input.status]) {
        attendanceRecord = (await upsertAttendance(tx, user.id, employee.id, schedule.id, date, input)) ?? null;
      }
      if (!requiresReason(input.status)) {
        await resolveAttendanceForScheduleStatus(tx, user.id, employee.id, schedule.id, date, input.status, attendanceRecord?.id);
      }
      await syncWorkHourRecordToSchedule(tx, schedule);

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
    recordErrorLog({ userEmail: actor.email, code: "SCHEDULE_EDIT_DB_FALLBACK", message: error instanceof Error ? error.message : "Falha ao editar cronograma", action: "SCHEDULE_EDIT", severity: "ERROR" });
    return allowDemoDataFallback ? editMockSchedule(actor, input) : { error: "Não foi possível editar o cronograma no banco." };
  }
}

export async function updateOperationalAttendance(actor: Actor, input: AttendanceInput) {
  const validationError = validateAttendance(input);
  if (validationError) return { error: validationError };
  const role = normalizeRole(actor.role);

  if (role === "SUPERVISOR") {
    return justifyAttendanceAsSupervisor(actor, input);
  }

  const defaultTimes = defaultShiftTimes[cleanShiftName(input.shift)] ?? defaultShiftTimes.Manhã;

  const scheduleResult = await editOperationalSchedule(actor, {
    employeeId: input.employeeId,
    date: input.date,
    shift: cleanShiftName(input.shift) || input.shift,
    status: input.status,
    observation: input.supervisorJustification || input.absenceReason,
    absenceReason: input.absenceReason,
    reasonCategory: input.reasonCategory,
    supervisorJustification: input.supervisorJustification,
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
      shift: cleanShiftName(input.shift) || input.shift,
      status: input.status,
      absenceReason: input.absenceReason,
      supervisorJustification: input.supervisorJustification
    },
    summary: scheduleResult.summary
  };
}

async function justifyAttendanceAsSupervisor(actor: Actor, input: AttendanceInput) {
  if (!supervisorJustificationStatuses.includes(input.status)) {
    return { error: "Supervisor só pode justificar ocorrências. Presença, cronograma, folga, férias e treinamento são atualizados pelo WFM/Admin." };
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
      include: { shift: true, supervisor: true, lob: true }
    });
    if (!employee) return { error: "Colaborador não encontrado." };

    const status = uiToAttendanceStatus[input.status];
    if (!status) return { error: "Status de ocorrência inválido." };

    const schedule = input.scheduleId
      ? await prisma.schedule.findFirst({
          where: { id: input.scheduleId, deletedAt: null },
          include: { shift: true }
        })
      : await prisma.schedule.findUnique({
          where: { employeeId_date: { employeeId: employee.id, date } },
          include: { shift: true }
        });
    if (!schedule) return { error: "Registro de falta não encontrado." };
    if (schedule.employeeId !== employee.id) {
      return { error: "Colaborador da pendência não corresponde ao registro selecionado." };
    }
    const shift = schedule.shift ?? employee.shift;
    const existing = input.attendanceRecordId
      ? await prisma.attendanceRecord.findUnique({ where: { id: input.attendanceRecordId } })
      : await prisma.attendanceRecord.findFirst({
          where: {
            employeeId: employee.id,
            date,
            OR: [{ scheduleId: schedule.id }, { shiftId: shift.id }]
          },
          orderBy: { updatedAt: "desc" }
        });
    if (existing?.employeeId && existing.employeeId !== employee.id) {
      return { error: "Colaborador da pendência não corresponde ao registro selecionado." };
    }
    if (existing?.scheduleId && existing.scheduleId !== schedule.id) {
      return { error: "Registro de falta não encontrado para o cronograma selecionado." };
    }

    const scheduleStatus = scheduleToUiStatus[schedule.status] ?? String(schedule.status);
    const existingStatus = existing ? scheduleToUiStatus[existing.status] ?? String(existing.status) : scheduleStatus;
    if (!supervisorJustificationStatuses.includes(scheduleStatus) && !supervisorJustificationStatuses.includes(existingStatus)) {
      return { error: "Esta ocorrência não é justificável pelo Supervisor." };
    }
    const savedStatus = uiToAttendanceStatus[existingStatus] ?? status;

    const saved = await prisma.$transaction(async (tx) => {
      const record = existing
        ? await tx.attendanceRecord.update({
            where: { id: existing.id },
            data: {
              scheduleId: schedule.id,
              shiftId: shift.id,
              status: savedStatus,
              absenceReason: input.absenceReason,
              reasonCategory: input.reasonCategory,
              supervisorJustification: input.supervisorJustification,
              hasEvidence: input.hasEvidence ?? false,
              evidenceUrl: input.evidenceUrl,
              isJustified: true,
              impactsAbs: input.impactsAbs ?? impactsAbs(existingStatus, input.absenceReason),
              impactsCoverage: input.impactsCoverage ?? impactsCoverage(existingStatus),
              justifiedById: user.id,
              justifiedAt: new Date()
            }
          })
        : await tx.attendanceRecord.create({
            data: {
              employeeId: employee.id,
              scheduleId: schedule.id,
              date,
              shiftId: shift.id,
              status: savedStatus,
              absenceReason: input.absenceReason,
              reasonCategory: input.reasonCategory,
              supervisorJustification: input.supervisorJustification,
              hasEvidence: input.hasEvidence ?? false,
              evidenceUrl: input.evidenceUrl,
              isJustified: true,
              impactsAbs: input.impactsAbs ?? impactsAbs(scheduleStatus, input.absenceReason),
              impactsCoverage: input.impactsCoverage ?? impactsCoverage(scheduleStatus),
              registeredById: user.id,
              justifiedById: user.id,
              justifiedAt: new Date()
            }
          });

      await tx.attendanceHistory.create({
        data: {
          attendanceRecordId: record.id,
          changedById: user.id,
          previousStatus: existing?.status ?? null,
          newStatus: savedStatus,
          previousReason: existing?.absenceReason ?? null,
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
          previousValue: existing ? serialize(existing) : null,
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
            title: "Justificativa de ocorrência enviada",
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
        wbLogin: employee.wbLogin,
        date: formatDate(date),
        dateIso: dateKey(date),
        scheduleId: schedule.id,
        shift: cleanShiftName(shift.name) || "Sem turno",
        lob: employee.lob.name,
        supervisor: employee.supervisor?.fullName ?? "Sem supervisor",
        status: scheduleToUiStatus[saved.status] ?? input.status,
        absenceReason: saved.absenceReason ?? undefined,
        reasonCategory: saved.reasonCategory ?? undefined,
        supervisorJustification: saved.supervisorJustification ?? undefined,
        isJustified: saved.isJustified,
        impactsAbs: saved.impactsAbs,
        impactsCoverage: saved.impactsCoverage,
        registeredBy: user.name,
        registeredAt: formatDateTime(saved.registeredAt),
        justifiedBy: user.name,
        justifiedAt: saved.justifiedAt ? formatDateTime(saved.justifiedAt) : undefined,
        updatedAt: formatDateTime(saved.updatedAt)
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
    if (!user) return { error: "Usuário ativo não encontrado para remover cronograma." };
    if (!["ADMIN", "GESTOR", "WFM"].includes(normalizeRole(actor.role))) return { error: "Sem permissão para remover cronogramas." };
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
    if (!schedules.length) return { error: "Nenhum cronograma encontrado para remover." };

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.schedule.updateMany({ where, data: { deletedAt: now, observation: "Cronograma removido manualmente" } });
      for (const schedule of schedules) {
        await resolveAttendanceForScheduleStatus(tx, user.id, employee.id, schedule.id, schedule.date, "Sem cronograma");
        await tx.workHourRecord.updateMany({
          where: {
            OR: [
              { scheduleId: schedule.id },
              { employeeId: employee.id, date: schedule.date }
            ]
          },
          data: {
            scheduleId: null,
            plannedStart: null,
            plannedEnd: null,
            plannedHours: null,
            differenceMinutes: null,
            status: "NO_SCHEDULE"
          }
        });
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
            reason: input.scope === "all" ? "Remoção de todos os cronogramas do colaborador" : `Remoção de cronograma do período ${period.month}/${period.year}`
          }
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "ALTERACAO_ESCALA",
          entity: "Schedule",
          entityId: employee.id,
          reason: input.scope === "all" ? "Remoção de todos os cronogramas do colaborador" : `Remoção de cronograma do colaborador no mês ${period.month}/${period.year}`,
          previousValue: { affectedSchedules: schedules.length },
          newValue: { deletedAt: true }
        }
      });
    });

    return { success: true, message: `${schedules.length} registro(s) de cronograma removido(s).`, schedules: await getOperationalSchedules(actor, input) };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "SCHEDULE_REMOVE_DB_ERROR", message: error instanceof Error ? error.message : "Falha ao remover cronograma", action: "SCHEDULE_REMOVE", severity: "ERROR" });
    return { error: "Não foi possível remover o cronograma do colaborador." };
  }
}

export async function previewOperationalScheduleImport(actor: Actor, rows: Array<Record<string, unknown>>) {
  if (!["ADMIN", "GESTOR", "WFM"].includes(normalizeRole(actor.role))) {
    return toImportPreview(
      rows,
      rows.map((_, index) => ({
        rowNumber: index + 1,
        errors: ["Sem permissão para importar cronograma. RH visualiza; Supervisor apenas visualiza e justifica ocorrências."],
        warnings: [],
        action: "ignorar" as const
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
        warnings: [],
        action: "ignorar" as const
      }))
    );
  }
}

export async function commitOperationalScheduleImport(actor: Actor, input: ScheduleImportInput) {
  try {
    const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true } });
    if (!user && allowDemoDataFallback) return commitMockScheduleImport(actor, { ...input, allowPartial: Boolean(input.allowPartial) });
    if (!user) return { error: "Usuário ativo não encontrado para importar cronograma." };
    if (!["ADMIN", "GESTOR", "WFM"].includes(normalizeRole(actor.role))) return { error: "Sem permissão para importar cronograma." };

    const validation = await validateImportRowsInDb(input.rows);
    const hasErrors = validation.some((row) => row.errors.length);
    if (hasErrors && !input.allowPartial) {
      return {
        error: `Existem erros na importação do cronograma. ${summarizeImportErrors(validation)}`,
        preview: toImportPreview(input.rows, validation)
      };
    }

    const validRows = validation.filter((row) => !row.errors.length && row.employeeId && row.date && row.status);
    if (!validRows.length) {
      return {
        error: `Nenhuma linha válida para importar cronograma. ${summarizeImportErrors(validation)}`,
        preview: toImportPreview(input.rows, validation)
      };
    }
    const importRecord = await prisma.scheduleImport.create({
      data: {
        fileName: input.fileName,
        importedById: user.id,
        status: hasErrors ? "Atenção" : "Sucesso",
        totalRows: input.rows.length,
        validRows: validRows.length,
        errorRows: validation.filter((row) => row.errors.length).length,
        warnings: validation.filter((row) => row.warnings.length).map((row) => ({ row: row.rowNumber, warnings: row.warnings }))
      }
    });

    for (const chunk of chunkArray(validation, 500)) {
      await prisma.scheduleImportRow.createMany({
        data: chunk.map((rowValidation) => {
          const row = input.rows[rowValidation.rowNumber - 1] ?? {};
          return {
            importId: importRecord.id,
            rowNumber: rowValidation.rowNumber,
            wbLogin: text(row.wb_login),
            name: rowValidation.employeeName ?? "",
            lob: text(row.lob),
            supervisor: text(row.supervisor_wb_login),
            date: rowValidation.date ?? null,
            shift: cleanShiftName(text(row.turno)) || text(row.turno),
            startsAt: rowValidation.startsAt ?? text(row.entrada),
            endsAt: rowValidation.endsAt ?? text(row.saida),
            status: rowValidation.status ? scheduleToUiStatus[rowValidation.status] ?? text(row.status) : text(row.status),
            observation: text(row.observacao),
            validation: {
              rowNumber: rowValidation.rowNumber,
              errors: rowValidation.errors,
              warnings: rowValidation.warnings,
              action: rowValidation.action
            }
          };
        })
      });
    }

    let importedRows = 0;
    for (const chunk of chunkArray(validRows, 500)) {
      const values = chunk.map((rowValidation) => {
        const row = input.rows[rowValidation.rowNumber - 1] ?? {};
        const startsAt = rowValidation.startsAt ?? normalizeTime(row.entrada);
        const endsAt = rowValidation.endsAt ?? normalizeTime(row.saida);
        const shiftId = rowValidation.shiftId ?? null;
        return Prisma.sql`(
          ${randomUUID()},
          ${rowValidation.employeeId!},
          ${shiftId},
          ${rowValidation.lobId ?? null},
          ${rowValidation.employeeSupervisorId ?? null},
          ${rowValidation.date!},
          ${startsAt},
          ${endsAt},
          ${rowValidation.status!}::"ScheduleStatus",
          ${text(row.observacao) || null},
          ${"excel-import"},
          NOW(),
          NOW()
        )`;
      });
      const saved = await prisma.$queryRaw<Array<{ id: string; employeeId: string; date: Date }>>(Prisma.sql`
        INSERT INTO "Schedule" (
          "id", "employeeId", "shiftId", "lobId", "supervisorId", "date", "startsAt", "endsAt", "status", "observation", "source", "createdAt", "updatedAt"
        )
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("employeeId", "date") DO UPDATE SET
          "shiftId" = EXCLUDED."shiftId",
          "lobId" = EXCLUDED."lobId",
          "supervisorId" = EXCLUDED."supervisorId",
          "startsAt" = EXCLUDED."startsAt",
          "endsAt" = EXCLUDED."endsAt",
          "status" = EXCLUDED."status",
          "observation" = EXCLUDED."observation",
          "source" = EXCLUDED."source",
          "updatedAt" = NOW(),
          "deletedAt" = NULL
        RETURNING "id", "employeeId", "date"
      `);
      importedRows += saved.length;
      if (saved.length) {
        await prisma.scheduleChangeHistory.createMany({
          data: saved.map((schedule) => ({
            scheduleId: schedule.id,
            employeeId: schedule.employeeId,
            changedById: user.id,
            date: schedule.date,
            before: {},
            after: { importId: importRecord.id, fileName: input.fileName },
            previousValue: {},
            newValue: { scheduleId: schedule.id, importId: importRecord.id },
            reason: `Importação de cronograma ${input.fileName}`
          }))
        });
      }
    }

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "IMPORTACAO",
        entity: "ScheduleImport",
        entityId: importRecord.id,
        reason: `${importedRows} linhas importadas de ${input.fileName}`,
        newValue: { fileName: input.fileName, importedRows, totalRows: input.rows.length, chunks: Math.ceil(validRows.length / 500) }
      }
    });

    const result = {
      id: importRecord.id,
      fileName: importRecord.fileName,
      importedRows,
      status: importRecord.status,
      createdAt: formatDateTime(importRecord.createdAt),
      user: user.name
    };

    return { data: result, preview: toImportPreview(input.rows, validation) };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "SCHEDULE_IMPORT_DB_FALLBACK", message: error instanceof Error ? error.message : "Falha ao importar cronograma", action: "SCHEDULE_IMPORT", severity: "ERROR" });
    if (allowDemoDataFallback) return commitMockScheduleImport(actor, { ...input, allowPartial: Boolean(input.allowPartial) });
    return { error: error instanceof Error ? `Não foi possível importar o cronograma no banco: ${error.message}` : "Não foi possível importar o cronograma no banco." };
  }
}

export async function exportOperationalSchedulesCsv(actor: Actor, query: ScheduleQuery = {}) {
  try {
    const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true, employeeProfile: true } });
    if (!user) return { error: "Usuário ativo não encontrado para exportar cronograma." };
    const role = normalizeRole(actor.role);
    if (!["ADMIN", "GESTOR", "WFM", "SUPERVISOR", "RH"].includes(role)) return { error: "Sem permissão para baixar Cronogramas Consolidados." };

    const period = resolvePeriod(query);
    const search = query.collaborator?.trim();
    const supervisorFilter = await scheduleSupervisorFilter(query.supervisor);
    const where: Prisma.ScheduleWhereInput = {
      deletedAt: null,
      date: { gte: period.start, lte: period.end },
      ...(query.status && query.status !== "Todos" ? { status: uiToScheduleStatus[query.status] ?? undefined } : {}),
      ...(query.supervisor && query.supervisor !== "Todos" && isNoSupervisorFilter(query.supervisor) ? { supervisorId: null } : {}),
      ...(supervisorFilter ?? {}),
      employee: {
        deletedAt: null,
        ...employeeFilters(query, search)
      }
    };

    const schedules = await prisma.schedule.findMany({
      where,
      include: {
        employee: {
          include: {
            user: { select: { email: true } },
            lob: { select: { name: true } },
            shift: { select: { name: true } },
            supervisor: { select: { fullName: true } }
          }
        },
        shift: { select: { name: true } },
        workHourRecords: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: { effectiveHours: true, actualHours: true, updatedAt: true }
        }
      },
      orderBy: [{ date: "asc" }, { employee: { fullName: "asc" } }]
    });

    const employeeIds = Array.from(new Set(schedules.map((schedule) => schedule.employeeId)));
    const fallbackWorkHours = employeeIds.length
      ? await prisma.workHourRecord.findMany({
          where: {
            employeeId: { in: employeeIds },
            date: { gte: period.start, lte: period.end }
          },
          orderBy: { updatedAt: "desc" },
          select: { employeeId: true, date: true, effectiveHours: true, actualHours: true, updatedAt: true }
        })
      : [];
    const fallbackWorkHourByEmployeeDay = new Map<string, (typeof fallbackWorkHours)[number]>();
    fallbackWorkHours.forEach((record) => {
      const key = `${record.employeeId}:${record.date.getTime()}`;
      if (!fallbackWorkHourByEmployeeDay.has(key)) fallbackWorkHourByEmployeeDay.set(key, record);
    });

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "UPLOAD",
        entity: "Schedule",
        reason: "Exportação CSV de Cronogramas Consolidados",
        newValue: { filters: query, exportedRows: schedules.length }
      }
    }).catch(() => undefined);

    const headers = ["wb_login", "nome", "email", "data", "status", "turno", "entrada", "saida", "lob", "supervisor", "horas_realizadas", "observacao", "atualizado_em"];
    const rows = schedules.map((schedule) => {
      const workHour = schedule.workHourRecords[0] ?? fallbackWorkHourByEmployeeDay.get(`${schedule.employeeId}:${schedule.date.getTime()}`);
      return [
        schedule.employee.wbLogin,
        schedule.employee.fullName,
        schedule.employee.user?.email ?? "",
        dateKey(schedule.date),
        scheduleToUiStatus[schedule.status] ?? schedule.status,
        cleanShiftName(schedule.shift?.name ?? schedule.employee.shift?.name) || "",
        schedule.startsAt ?? "",
        schedule.endsAt ?? "",
        schedule.employee.lob.name,
        schedule.employee.supervisor?.fullName ?? "Sem supervisor",
        workHour ? String(workHour.effectiveHours ?? workHour.actualHours) : "Não lançado",
        schedule.observation ?? "",
        formatDateTime(schedule.updatedAt)
      ];
    });

    return { csv: [headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\n") };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "SCHEDULE_EXPORT_ERROR", message: error instanceof Error ? error.message : "Falha ao exportar cronogramas", action: "SCHEDULE_EXPORT", severity: "ERROR" });
    return { error: "Não foi possível baixar Cronogramas Consolidados." };
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
    const supervisorFilter = query.supervisor?.trim();
    const collaboratorFilter = query.collaborator?.trim();
    const shiftFilter = cleanShiftName(query.shift);
    const statusFilter = query.status && query.status !== "Todos" ? uiToScheduleStatus[query.status] : undefined;
    const roleTitleFilter = query.roleTitle?.trim();
    const reasonFilter = query.reason?.trim();
    const justificationFilter = query.justification?.trim().toLowerCase();
    const includeJustified = query.includeJustified === true || query.includeJustified === "true";
    const extraFilters: Prisma.ScheduleWhereInput[] = [];
    if (lobFilter) extraFilters.push({ employee: { lob: { name: lobFilter } } });
    if (roleTitleFilter && roleTitleFilter !== "Todos") extraFilters.push({ employee: { roleTitle: { contains: roleTitleFilter, mode: "insensitive" } } });
    const supervisorWhere = await scheduleSupervisorFilter(supervisorFilter);
    if (supervisorWhere) extraFilters.push(supervisorWhere);
    if (statusFilter) extraFilters.push({ status: statusFilter });
    if (collaboratorFilter) {
      extraFilters.push({
        OR: [
          { employee: { fullName: { contains: collaboratorFilter, mode: "insensitive" } } },
          { employee: { wbLogin: { contains: collaboratorFilter, mode: "insensitive" } } },
          { employee: { user: { email: { contains: collaboratorFilter, mode: "insensitive" } } } }
        ]
      });
    }
    if (shiftFilter && shiftFilter !== "Todos") {
      extraFilters.push({
        OR: [
          { shift: { name: { startsWith: shiftFilter, mode: "insensitive" } } },
          { employee: { shift: { name: { startsWith: shiftFilter, mode: "insensitive" } } } }
        ]
      });
    }
    const baseWhere: Prisma.ScheduleWhereInput = {
      deletedAt: null,
      ...(period ? { date: { gte: period.start, lte: period.end } } : {}),
      ...(extraFilters.length ? { AND: extraFilters } : {})
    };
    const scheduleWhere: Prisma.ScheduleWhereInput =
      role === "COLABORADOR" && user.employeeProfile
        ? { ...baseWhere, employeeId: user.employeeProfile.id }
        : baseWhere;
    const schedules = await prisma.schedule.findMany({
      where: scheduleWhere,
      include: {
        shift: true,
        employee: { include: { shift: true, lob: true, supervisor: true, user: { select: { email: true } } } },
        attendanceRecords: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          include: {
            registeredBy: true,
            justifiedBy: true
          }
        }
      },
      orderBy: [{ date: "desc" }, { employee: { fullName: "asc" } }],
      take: includeJustified || reasonFilter ? 5000 : 5000
    });
    const supervisorNameById = await supervisorNameMap(schedules.map((schedule) => schedule.supervisorId));
    const activeSchedules = schedules.filter((schedule) => {
      const record = schedule.attendanceRecords[0];
      if (includeJustified || reasonFilter || justificationFilter) {
        if (!isAbsenceStatus(schedule.status)) return false;
        if (reasonFilter && attendanceReasonForSchedule(schedule.status, record) !== reasonFilter) return false;
        if (justificationFilter === "pending") return isPendingJustificationForSchedule(schedule.status, record);
        if (justificationFilter === "justified") return hasValidJustification(record);
        return true;
      }
      return isPendingJustificationForSchedule(schedule.status, record);
    });

    return {
      data: activeSchedules.map((schedule) => {
        const record = schedule.attendanceRecords[0];
        const status = scheduleToUiStatus[schedule.status] ?? schedule.status;
        const validJustification = hasValidJustification(record);
        return {
          id: record?.id ?? `schedule:${schedule.id}`,
          attendanceRecordId: record?.id,
          employeeId: schedule.employeeId,
          employeeName: schedule.employee.fullName,
          wbLogin: schedule.employee.wbLogin,
          date: formatDate(schedule.date),
          dateIso: dateKey(schedule.date),
          scheduleId: schedule.id,
          shift: cleanShiftName(schedule.shift?.name ?? schedule.employee.shift.name) || "Sem turno",
          lob: schedule.employee.lob.name,
          supervisor: resolveSupervisorName(schedule, supervisorNameById),
          status,
          absenceReason: attendanceReasonForSchedule(schedule.status, record),
          reasonCategory: validJustification ? record?.reasonCategory ?? undefined : undefined,
          supervisorJustification: validJustification ? record?.supervisorJustification ?? undefined : undefined,
          isJustified: validJustification,
          impactsAbs: isAbsenceStatus(schedule.status),
          impactsCoverage: impactsCoverage(status),
          registeredBy: record?.registeredBy?.name ?? "Sistema",
          registeredAt: record ? formatDateTime(record.registeredAt) : formatDateTime(schedule.updatedAt),
          justifiedBy: validJustification ? record?.justifiedBy?.name ?? undefined : undefined,
          justifiedAt: validJustification && record?.justifiedAt ? formatDateTime(record.justifiedAt) : undefined,
          updatedAt: formatDateTime(record?.updatedAt ?? schedule.updatedAt)
        };
      }),
      summary: await getAttendanceSummaryFromDb(period, {
        lob: lobFilter,
        supervisor: query.supervisor,
        shift: query.shift,
        collaborator: query.collaborator,
        roleTitle: query.roleTitle,
        employeeId: role === "COLABORADOR" && user.employeeProfile ? user.employeeProfile.id : undefined,
        teamSupervisorId: undefined
      })
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
    shift: cleanShiftName(input.shift) || input.shift,
    status: input.status,
    absenceReason: input.observation,
    reasonCategory: "Cronograma",
    supervisorJustification: input.observation
  });
  if ("error" in attendance) return attendance;
  return { data: attendance.data, summary: attendance.summary, schedules: getMockSchedulesForActor(actor) };
}

function validateScheduleEdit(input: ScheduleEditInput) {
  if (!input.employeeId) return "Colaborador obrigatório.";
  if (!input.date) return "Data obrigatória.";
  if (!input.status) return "Status obrigatório.";
  if (needsTime(input.status) && (!input.shift || !input.startsAt || !input.endsAt)) return "Turno, entrada e saída são obrigatórios para Escalado, Presente ou Nesting.";
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

type AttendanceJustificationRecord = {
  id: string;
  status: AttendanceStatus | string;
  absenceReason: string | null;
  reasonCategory: string | null;
  supervisorJustification: string | null;
  isJustified: boolean;
  impactsAbs: boolean;
  impactsCoverage: boolean;
  registeredAt: Date;
  justifiedAt: Date | null;
  updatedAt: Date;
  registeredBy?: { name: string } | null;
  justifiedBy?: { name: string } | null;
  histories?: Array<{
    previousStatus: AttendanceStatus | null;
    newStatus: AttendanceStatus;
    previousReason: string | null;
    newReason: string | null;
    comment: string | null;
    createdAt: Date;
    changedBy?: { name: string } | null;
  }>;
};

function formatScheduleJustification(status: ScheduleStatus | AttendanceStatus | string, records: AttendanceJustificationRecord[]) {
  if (!scheduleStatusRequiresJustification(status)) return null;
  const latest = [...records].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  if (!latest) {
    return {
      status: scheduleToUiStatus[String(status)] ?? String(status),
      justificationStatus: "Justificativa pendente",
      isJustified: false,
      absenceReason: "Sem justificativa",
      impactsAbs: true,
      impactsCoverage: true
    };
  }
  return {
    id: latest.id,
    status: scheduleToUiStatus[String(latest.status)] ?? String(latest.status),
    justificationStatus: latest.isJustified ? "Justificado" : "Justificativa pendente",
    absenceReason: latest.absenceReason ?? "Sem justificativa",
    reasonCategory: latest.reasonCategory ?? undefined,
    supervisorJustification: latest.supervisorJustification ?? undefined,
    isJustified: latest.isJustified,
    impactsAbs: latest.impactsAbs,
    impactsCoverage: latest.impactsCoverage,
    registeredBy: latest.registeredBy?.name ?? "Sistema",
    registeredAt: formatDateTime(latest.registeredAt),
    justifiedBy: latest.justifiedBy?.name ?? undefined,
    justifiedAt: latest.justifiedAt ? formatDateTime(latest.justifiedAt) : undefined,
    updatedAt: formatDateTime(latest.updatedAt),
    history: latest.histories?.map((history) => ({
      previousStatus: history.previousStatus ? scheduleToUiStatus[String(history.previousStatus)] ?? String(history.previousStatus) : undefined,
      newStatus: scheduleToUiStatus[String(history.newStatus)] ?? String(history.newStatus),
      previousReason: history.previousReason ?? undefined,
      newReason: history.newReason ?? undefined,
      comment: history.comment ?? undefined,
      changedBy: history.changedBy?.name ?? "Sistema",
      createdAt: formatDateTime(history.createdAt)
    }))
  };
}

function scheduleStatusRequiresJustification(status: ScheduleStatus | AttendanceStatus | string) {
  const label = scheduleToUiStatus[String(status)] ?? String(status);
  return requiresReason(label);
}

function isActiveJustificationRecord(record: { status: AttendanceStatus | string; schedule?: { status: ScheduleStatus | string; deletedAt: Date | null } | null }) {
  if (!scheduleStatusRequiresJustification(record.status)) return false;
  if (record.schedule?.deletedAt) return false;
  if (record.schedule && !scheduleStatusRequiresJustification(record.schedule.status)) return false;
  return true;
}

function isActivePendingJustificationRecord(record: { status: AttendanceStatus | string; isJustified: boolean; schedule?: { status: ScheduleStatus | string; deletedAt: Date | null } | null }) {
  if (record.isJustified) return false;
  return isActiveJustificationRecord(record);
}

function hasValidJustification(record?: { isJustified: boolean; absenceReason: string | null } | null) {
  if (!record?.isJustified) return false;
  return attendanceReasonLabel(record) !== "Sem justificativa";
}

function isPendingJustificationForSchedule(status: ScheduleStatus | AttendanceStatus | string, record?: { isJustified: boolean; absenceReason: string | null } | null) {
  if (!scheduleStatusRequiresJustification(status)) return false;
  return !hasValidJustification(record);
}

function attendanceReasonLabel(record?: { absenceReason: string | null } | null) {
  const reason = record?.absenceReason?.trim();
  return reason && reason !== "Sem justificativa" ? reason : "Sem justificativa";
}

function attendanceReasonForSchedule(status: ScheduleStatus | AttendanceStatus | string, record?: { isJustified: boolean; absenceReason: string | null } | null) {
  if (!isAbsenceStatus(status)) return attendanceReasonLabel(record);
  return hasValidJustification(record) ? attendanceReasonLabel(record) : "Sem justificativa";
}

async function validateImportRowsInDb(rows: Array<Record<string, unknown>>): Promise<ScheduleImportValidation[]> {
  const duplicateKeys = new Map<string, number>();
  const normalizedRows = rows.map((row, index) => {
    const wbLogin = text(row.wb_login).toUpperCase();
    const parsedDate = parseImportDate(row.data);
    const key = wbLogin && parsedDate ? `${wbLogin}:${parsedDate.getTime()}` : "";
    if (key) duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1);
    return { row, rowNumber: index + 1, wbLogin, parsedDate, key };
  });
  const wbLogins = Array.from(new Set(normalizedRows.map((row) => row.wbLogin).filter(Boolean)));
  const dates = Array.from(new Set(normalizedRows.map((row) => row.parsedDate?.getTime()).filter((value): value is number => Boolean(value)))).map((value) => new Date(value));
  const [employees, shifts, lobs] = await Promise.all([
    wbLogins.length
      ? prisma.employeeProfile.findMany({
        where: { deletedAt: null },
        include: { shift: true, lob: true, supervisor: { select: { id: true, wbLogin: true, fullName: true } } }
      })
      : Promise.resolve([]),
    prisma.shift.findMany(),
    prisma.lob.findMany({ select: { id: true, name: true } })
  ]);
  const employeeMap = new Map(employees.map((employee) => [employee.wbLogin.toUpperCase(), employee]));
  const employeeIds = employees.map((employee) => employee.id);
  const existingSchedules = employeeIds.length && dates.length
    ? await prisma.schedule.findMany({
      where: {
        employeeId: { in: employeeIds },
        date: { gte: new Date(Math.min(...dates.map((date) => date.getTime()))), lte: new Date(Math.max(...dates.map((date) => date.getTime()))) },
        deletedAt: null
      },
      select: { id: true, employeeId: true, date: true }
    })
    : [];
  const scheduleMap = new Map(existingSchedules.map((schedule) => [`${schedule.employeeId}:${schedule.date.getTime()}`, schedule]));
  const shiftMap = new Map(shifts
    .filter((shift) => isSelectableShiftName(shift.name))
    .flatMap((shift) => {
      const cleanName = cleanShiftName(shift.name);
      return [
        [normalizeImportKey(shift.name), shift],
        [normalizeImportKey(cleanName), shift]
      ] as const;
    }));
  const lobMap = new Map(lobs.map((lob) => [normalizeImportKey(lob.name), lob]));

  return normalizedRows.map<ScheduleImportValidation>(({ row, rowNumber, wbLogin, parsedDate, key }) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!hasExcelValue(row.wb_login)) errors.push("WB/Login obrigatório para importar cronograma.");
    if (!hasExcelValue(row.data)) errors.push("Data é obrigatória.");
    else if (!parsedDate) errors.push("Data inválida. Use DD/MM/AAAA ou AAAA-MM-DD.");
    if (!hasExcelValue(row.status)) errors.push("Status obrigatório.");
    if (!hasExcelValue(row.turno)) errors.push("Turno obrigatório.");
    if (!hasExcelValue(row.entrada)) errors.push("Entrada é obrigatória.");
    if (!hasExcelValue(row.saida)) errors.push("Saída é obrigatória.");
    if (!hasExcelValue(row.lob)) errors.push("LOB é obrigatória.");

    const status = scheduleStatusFromImport(row.status);
    if (hasExcelValue(row.status) && !status) {
      errors.push(`Status inválido: ${text(row.status)}. Use um status de cronograma válido.`);
    }
    if (normalizeImportKey(text(row.status)) === "AUSENTE") {
      warnings.push("Status Ausente foi convertido para Falta conforme regra atual.");
    }
    const startsAt = normalizeTime(row.entrada);
    const endsAt = normalizeTime(row.saida);
    if (hasExcelValue(row.entrada) && !startsAt) errors.push("Entrada inválida. Use 06:00, 06:00:00 ou decimal do Excel como 0,25.");
    if (hasExcelValue(row.saida) && !endsAt) errors.push("Saída inválida. Use 06:00, 06:00:00 ou decimal do Excel como 0,25.");

    const receivedShift = text(row.turno);
    const normalizedShift = cleanShiftName(receivedShift);
    const shift = normalizedShift && normalizedShift !== "Folga" ? shiftMap.get(normalizeImportKey(normalizedShift)) : null;
    if (receivedShift && isBlockedShiftName(receivedShift)) {
      const blockedKey = shiftLookupKey(normalizedShift);
      errors.push(blockedKey === "PLANTAO" ? "Plantão não é um turno ativo." : "Férias deve ser usada como status de cronograma, não como turno.");
    } else if (receivedShift && !isSelectableShiftName(receivedShift)) {
      errors.push(`Turno ${receivedShift} não é uma opção padrão válida.`);
    } else if (normalizedShift && normalizedShift !== "Folga" && !shift) {
      errors.push(`Turno ${receivedShift} não cadastrado.`);
    }
    const lob = text(row.lob) ? lobMap.get(normalizeImportKey(text(row.lob))) : null;
    if (text(row.lob) && !lob) errors.push(`LOB ${text(row.lob)} não cadastrada.`);

    const employee = wbLogin ? employeeMap.get(wbLogin) : null;
    if (wbLogin && !employee) errors.push("WB/Login não encontrado na base de funcionários.");
    if (employee && text(row.lob) && normalizeImportKey(text(row.lob)) !== normalizeImportKey(employee.lob.name)) warnings.push("LOB no arquivo diferente da LOB do colaborador.");
    if (employee && text(row.supervisor_wb_login) && normalizeImportKey(text(row.supervisor_wb_login)) !== normalizeImportKey(employee.supervisor?.wbLogin ?? "")) warnings.push("Supervisor no arquivo diferente do supervisor do colaborador.");
    if (key && (duplicateKeys.get(key) ?? 0) > 1) errors.push("Linha duplicada no arquivo para o mesmo WB/Login + data.");
    const existingSchedule = employee && parsedDate ? scheduleMap.get(`${employee.id}:${parsedDate.getTime()}`) : null;
    if (existingSchedule) warnings.push("Cronograma já existe para este colaborador/data e será atualizado.");

    return {
      rowNumber,
      errors,
      warnings,
      action: errors.length ? "ignorar" : existingSchedule ? "atualizar" : "criar",
      employeeId: employee?.id,
      employeeName: employee?.fullName,
      employeeLobId: employee?.lobId,
      employeeSupervisorId: employee?.supervisorId,
      employeeShiftId: employee?.shiftId,
      employeeShiftStartsAt: employee?.shift.startsAt,
      employeeShiftEndsAt: employee?.shift.endsAt,
      shiftId: shift?.id,
      shiftStartsAt: shift?.startsAt,
      shiftEndsAt: shift?.endsAt,
      lobId: lob?.id,
      date: parsedDate ?? undefined,
      status: status ?? undefined,
      startsAt: startsAt ?? undefined,
      endsAt: endsAt ?? undefined
    };
  });
}

function toImportPreview(rows: Array<Record<string, unknown>>, validation: ScheduleImportValidation[]) {
  return {
    rows: rows.map((row, index) => {
      const result = validation[index];
      return {
        ...row,
        data: result?.date ? formatDate(result.date) : row.data,
        entrada: result?.startsAt ?? row.entrada,
        saida: result?.endsAt ?? row.saida,
        status: result?.status ? scheduleToUiStatus[result.status] ?? row.status : row.status
      };
    }),
    totalRows: rows.length,
    validRows: validation.filter((row) => !row.errors.length).length,
    errorRows: validation.filter((row) => row.errors.length).length,
    warningRows: validation.filter((row) => row.warnings.length).length,
    createdRows: validation.filter((row) => !row.errors.length && row.action === "criar").length,
    updatedRows: validation.filter((row) => !row.errors.length && row.action === "atualizar").length,
    foundEmployees: validation.filter((row) => row.employeeId).length,
    missingEmployees: validation.filter((row) => row.errors.some((error) => error.includes("WB/Login não encontrado"))).length,
    validation: validation.map((row) => ({
      rowNumber: row.rowNumber,
      errors: row.errors,
      warnings: row.warnings,
      action: row.action,
      employeeName: row.employeeName ?? "",
      status: row.errors.length ? "Erro" : row.warnings.length ? "Alerta" : "Válida"
    }))
  };
}

function summarizeImportErrors(validation: ScheduleImportValidation[]) {
  const issues = validation
    .filter((row) => row.errors.length)
    .slice(0, 8)
    .map((row) => `Linha ${row.rowNumber}: ${row.errors.join(" ")}`);
  if (!issues.length) return "Revise os alertas do preview.";
  const remaining = validation.filter((row) => row.errors.length).length - issues.length;
  return `${issues.join(" | ")}${remaining > 0 ? ` | +${remaining} linha(s) com erro.` : ""}`;
}

function validateAttendance(input: AttendanceInput) {
  if (requiresReason(input.status) && !input.absenceReason?.trim() && !input.supervisorJustification?.trim()) {
    return "Motivo/observação obrigatório para falta, atraso, saída antecipada ou erro de cronograma.";
  }
  return "";
}

function requiresReason(status: string) {
  return statusesRequiringReason.includes(status);
}

function needsTime(status: string) {
  return ["Escalado", "Presente", "Nesting", "Venda de folga aprovada"].includes(status);
}

function needsTimeDb(status: ScheduleStatus) {
  return ["ESCALADO", "PRESENTE", "NESTING", "VENDA_FOLGA_APROVADA"].includes(status);
}

function scheduleStatusFromImport(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const key = normalizeImportKey(raw);
  if (key === "AUSENTE") return "FALTA";
  if (!allowedScheduleImportStatusKeys.has(key)) return null;
  return uiToScheduleStatus[raw] ?? uiToScheduleStatusByKey[key] ?? null;
}

const uiToScheduleStatusByKey = Object.fromEntries(
  Object.entries(uiToScheduleStatus).flatMap(([label, status]) => [
    [normalizeImportKey(label), status],
    [normalizeImportKey(status), status]
  ])
) as Record<string, ScheduleStatus>;

function impactsAbs(status: string, _reason?: string) {
  return isAbsenceStatus(status);
}

function impactsCoverage(status: string) {
  return ["Falta", "Atraso", "Saída antecipada", "Sem escala", "Sem cronograma"].includes(status);
}

async function upsertAttendance(tx: Prisma.TransactionClient, userId: string, employeeId: string, scheduleId: string, date: Date, input: ScheduleEditInput) {
  const status = uiToAttendanceStatus[input.status];
  if (!status) return;
  const existing = await tx.attendanceRecord.findFirst({
    where: {
      employeeId,
      date,
      OR: [{ scheduleId }, { scheduleId: null }]
    },
    orderBy: { updatedAt: "desc" }
  });
  const pendingJustification = isPendingJustificationInput(input);
  const observation = input.observation?.trim();
  const explicitReason = input.absenceReason?.trim();
  const explicitCategory = input.reasonCategory?.trim();
  const explicitJustification = input.supervisorJustification?.trim();
  const requiresJustification = requiresReason(input.status);
  const savedReason = pendingJustification ? "Sem justificativa" : requiresJustification ? explicitReason || observation || null : null;
  const savedJustification = pendingJustification ? null : explicitJustification || observation || null;
  const absImpact = input.impactsAbs ?? impactsAbs(input.status, savedReason ?? undefined);
  const coverageImpact = input.impactsCoverage ?? impactsCoverage(input.status);
  const saved = existing
    ? await tx.attendanceRecord.update({
        where: { id: existing.id },
        data: {
          scheduleId,
          status,
          absenceReason: savedReason,
          reasonCategory: requiresJustification ? explicitCategory || "Cronograma" : null,
          supervisorJustification: savedJustification,
          isJustified: !requiresJustification || !pendingJustification,
          impactsAbs: absImpact,
          impactsCoverage: coverageImpact,
          hasEvidence: input.hasEvidence ?? false,
          evidenceUrl: input.evidenceUrl,
          registeredById: userId,
          justifiedById: !pendingJustification && savedJustification ? userId : null,
          justifiedAt: !pendingJustification && savedJustification ? new Date() : null
        }
      })
    : await tx.attendanceRecord.create({
        data: {
          employeeId,
          scheduleId,
          date,
          status,
          absenceReason: savedReason,
          reasonCategory: requiresJustification ? explicitCategory || "Cronograma" : undefined,
          supervisorJustification: savedJustification,
          isJustified: !requiresJustification || !pendingJustification,
          impactsAbs: absImpact,
          impactsCoverage: coverageImpact,
          hasEvidence: input.hasEvidence ?? false,
          evidenceUrl: input.evidenceUrl,
          registeredById: userId,
          justifiedById: !pendingJustification && savedJustification ? userId : undefined,
          justifiedAt: !pendingJustification && savedJustification ? new Date() : undefined
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
      comment: pendingJustification ? "Ocorrência marcada sem justificativa; pendente de supervisor." : savedJustification
    }
  });

  return saved;
}

async function resolveAttendanceForScheduleStatus(tx: Prisma.TransactionClient, userId: string, employeeId: string, scheduleId: string, date: Date, scheduleStatus: string, keepRecordId?: string) {
  const resolvedStatus = uiToAttendanceStatus[scheduleStatus] ?? "SEM_ESCALA";
  const records = await tx.attendanceRecord.findMany({
    where: {
      employeeId,
      date,
      ...(keepRecordId ? { id: { not: keepRecordId } } : {})
    }
  });
  if (!records.length) return;

  for (const record of records) {
    const alreadyResolved =
      record.status === resolvedStatus &&
      !record.absenceReason &&
      !record.reasonCategory &&
      !record.supervisorJustification &&
      record.isJustified &&
      !record.impactsAbs &&
      !record.impactsCoverage;
    if (alreadyResolved) continue;

    const before = serialize(record);
    const saved = await tx.attendanceRecord.update({
      where: { id: record.id },
      data: {
        scheduleId,
        status: resolvedStatus,
        absenceReason: null,
        reasonCategory: null,
        supervisorJustification: null,
        isJustified: true,
        impactsAbs: false,
        impactsCoverage: false,
        justifiedById: userId,
        justifiedAt: new Date()
      }
    });

    await tx.attendanceHistory.create({
      data: {
        attendanceRecordId: saved.id,
        changedById: userId,
        previousStatus: record.status,
        newStatus: saved.status,
        previousReason: record.absenceReason,
        newReason: null,
        comment: `Pendência encerrada por alteração do cronograma para ${scheduleStatus}.`
      }
    });

    await tx.notification.updateMany({
      where: { entity: "AttendanceRecord", entityId: record.id, readAt: null },
      data: { readAt: new Date(), isRead: true }
    });

    await tx.auditLog.create({
      data: {
        actorId: userId,
        action: "ALTERACAO_ESCALA",
        entity: "AttendanceRecord",
        entityId: record.id,
        reason: `Pendência de justificativa encerrada por alteração do cronograma para ${scheduleStatus}.`,
        previousValue: before,
        newValue: serialize(saved)
      }
    });
  }
}

async function syncWorkHourRecordToSchedule(
  tx: Prisma.TransactionClient,
  schedule: { id: string; employeeId: string; date: Date; startsAt: string | null; endsAt: string | null; status: ScheduleStatus }
) {
  const record = await tx.workHourRecord.findFirst({
    where: {
      employeeId: schedule.employeeId,
      date: schedule.date,
      OR: [{ scheduleId: schedule.id }, { scheduleId: null }]
    },
    orderBy: { updatedAt: "desc" }
  });
  if (!record) return;

  const plannedHours = plannedProductiveHoursForSchedule(schedule);
  const effectiveHours = record.effectiveHours ?? record.actualHours;
  const differenceMinutes = plannedHours !== null && Number.isFinite(effectiveHours)
    ? calculateProductiveDifferenceMinutes(effectiveHours, plannedHours)
    : null;

  await tx.workHourRecord.update({
    where: { id: record.id },
    data: {
      scheduleId: schedule.id,
      plannedStart: schedule.startsAt,
      plannedEnd: schedule.endsAt,
      plannedHours,
      differenceMinutes,
      status: resolveWorkHourStatusForSchedule(record.status, differenceMinutes)
    }
  });
}

function resolveWorkHourStatusForSchedule(status: WorkHourRecordStatus, differenceMinutes: number | null): WorkHourRecordStatus {
  if (["ADJUSTMENT_REQUESTED", "ADJUSTMENT_APPROVED", "ADJUSTMENT_REJECTED", "MANUALLY_CORRECTED"].includes(status)) return status;
  if (differenceMinutes === null) return "NO_SCHEDULE";
  return isProductiveDifferenceWithinTolerance(differenceMinutes) ? "OK" : "DIVERGENT";
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

async function getAttendanceSummaryFromDb(period?: ReturnType<typeof resolvePeriod>, filters: AttendanceSummaryFilters = {}) {
  const shiftFilter = cleanShiftName(filters.shift);
  const search = filters.collaborator?.trim();
  const statusFilter = filters.status && filters.status !== "Todos" ? uiToScheduleStatus[filters.status] : undefined;
  const supervisorFilter = await scheduleSupervisorFilter(filters.supervisor);
  const employeeWhere: Prisma.EmployeeProfileWhereInput = {
    ...(filters.employeeId ? { id: filters.employeeId } : {}),
    ...(filters.teamSupervisorId ? { supervisorId: filters.teamSupervisorId } : {}),
    ...(filters.lob && filters.lob !== "Todos" ? { lob: { name: filters.lob } } : {}),
    ...(search ? {
      OR: [
        { fullName: { contains: search, mode: "insensitive" } },
        { wbLogin: { contains: search, mode: "insensitive" } },
        { user: { email: { contains: search, mode: "insensitive" } } }
      ]
    } : {}),
    ...(filters.roleTitle && filters.roleTitle !== "Todos" ? { roleTitle: { contains: filters.roleTitle, mode: "insensitive" } } : {})
  };
  const scheduleShiftWhere: Prisma.ScheduleWhereInput =
    shiftFilter && shiftFilter !== "Todos" && shiftFilter !== "Folga"
      ? {
          OR: [
            { shift: { name: shiftFilter } },
            { shift: { name: { startsWith: `${shiftFilter} (` } } },
            { shiftId: null, employee: { shift: { OR: [{ name: shiftFilter }, { name: { startsWith: `${shiftFilter} (` } }] } } }
          ]
        }
      : {};
  const schedules = await prisma.schedule.findMany({
    where: {
      deletedAt: null,
      ...(period ? { date: { gte: period.start, lte: period.end } } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(supervisorFilter ?? {}),
      ...(shiftFilter === "Folga" && !statusFilter ? { status: "FOLGA" } : {}),
      ...scheduleShiftWhere,
      employee: employeeWhere
    },
    select: {
      status: true,
      shift: { select: { name: true } },
      supervisorId: true,
      employee: { select: { shift: { select: { name: true } }, supervisor: { select: { fullName: true } } } },
      attendanceRecords: {
        orderBy: { updatedAt: "desc" },
        take: 1,
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
  const supervisorNameById = await supervisorNameMap(schedules.map((schedule) => schedule.supervisorId));
  const statusFor = (schedule: (typeof schedules)[number]) => normalizeOperationalStatus(schedule.status);
  const planned = schedules.filter((schedule) => isScheduledStatus(statusFor(schedule))).length;
  const present = schedules.filter((schedule) => isPresentStatus(statusFor(schedule))).length;
  const absent = schedules.filter((schedule) => isAbsenceStatus(statusFor(schedule))).length;
  const coverageRate = calculateCoverageRate(planned, present);
  const absRate = calculateAbsenceRate(planned, absent);
  const absenceSchedules = schedules
    .filter((schedule) => isAbsenceStatus(statusFor(schedule)))
    .map((schedule) => ({ schedule, record: schedule.attendanceRecords[0] }));
  const byShift = schedules.reduce<Record<string, { planned: number; present: number; absent: number; gap: number }>>((acc, schedule) => {
    const shiftName = cleanShiftName(schedule.shift?.name ?? schedule.employee.shift?.name) || "Sem turno";
    const status = statusFor(schedule);
    acc[shiftName] ??= { planned: 0, present: 0, absent: 0, gap: 0 };
    if (isScheduledStatus(status)) acc[shiftName].planned += 1;
    if (isPresentStatus(status)) acc[shiftName].present += 1;
    if (isAbsenceStatus(status)) acc[shiftName].absent += 1;
    acc[shiftName].gap = acc[shiftName].present - acc[shiftName].planned;
    return acc;
  }, {});
  const byReason = absenceSchedules.reduce<Record<string, number>>((acc, item) => {
    const key = attendanceReasonForSchedule(item.schedule.status, item.record);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const bySupervisor = schedules.reduce<Record<string, { planned: number; present: number; absent: number; unjustified: number; justified: number; absRate: number }>>((acc, schedule) => {
    const supervisorName = resolveSupervisorName(schedule, supervisorNameById);
    const status = statusFor(schedule);
    const record = schedule.attendanceRecords[0];
    acc[supervisorName] ??= { planned: 0, present: 0, absent: 0, unjustified: 0, justified: 0, absRate: 0 };
    if (isScheduledStatus(status)) acc[supervisorName].planned += 1;
    if (isPresentStatus(status)) acc[supervisorName].present += 1;
    if (isAbsenceStatus(status)) {
      acc[supervisorName].absent += 1;
      if (isPendingJustificationForSchedule(schedule.status, record)) {
        acc[supervisorName].unjustified += 1;
      } else if (hasValidJustification(record)) {
        acc[supervisorName].justified += 1;
      }
    }
    acc[supervisorName].absRate = calculateAbsenceRate(acc[supervisorName].planned, acc[supervisorName].absent);
    return acc;
  }, {});
  const unjustified = absenceSchedules.filter((item) => isPendingJustificationForSchedule(item.schedule.status, item.record)).length;
  const justified = absenceSchedules.filter((item) => hasValidJustification(item.record)).length;
  return {
    planned,
    present,
    absent,
    absRate,
    late: schedules.filter((schedule) => statusFor(schedule) === "ATRASO").length,
    earlyLeave: schedules.filter((schedule) => statusFor(schedule) === "SAIDA_ANTECIPADA").length,
    unjustified,
    justified,
    coverageRate,
    gap: present - planned,
    riskLevel: coverageRate >= 95 ? "Excelente" : coverageRate >= 90 ? "Adequado" : coverageRate >= 85 ? "Atenção" : "Crítico",
    byReason,
    byShift,
    bySupervisor
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
    justified: 0,
    coverageRate: 0,
    gap: 0,
    riskLevel: "Adequado",
    byReason: {},
    byShift: {},
    bySupervisor: {}
  };
}

function resolveSupervisorName(schedule: { supervisorId?: string | null; employee?: { supervisor?: { fullName: string } | null } | null }, supervisorNameById?: Map<string, string>) {
  return (schedule.supervisorId ? supervisorNameById?.get(schedule.supervisorId) : "") || schedule.employee?.supervisor?.fullName?.trim() || "Sem supervisor";
}

function statusToOperational(status: string) {
  if (status === "Presente") return "Online";
  if (status === "Atraso" || status === "Saída antecipada") return "Em Atendimento";
  if (["Falta", "Afastado"].includes(status)) return "Offline";
  return status;
}

function workHourStatusLabel(status: string) {
  const labels: Record<string, string> = {
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
    const rawStartDate = parseDateOnly(query.startDate || "");
    const rawEndDate = parseDateOnly(query.endDate || "");
    if (rawStartDate || rawEndDate) {
      const startDate = rawStartDate ?? new Date(Date.UTC(rawEndDate!.getUTCFullYear(), rawEndDate!.getUTCMonth(), 1));
      const endDate = rawEndDate ?? new Date(Date.UTC(rawStartDate!.getUTCFullYear(), rawStartDate!.getUTCMonth() + 1, 0));
      const start = startDate <= endDate ? startDate : endDate;
      const endBase = startDate <= endDate ? endDate : startDate;
      const end = new Date(Date.UTC(endBase.getUTCFullYear(), endBase.getUTCMonth(), endBase.getUTCDate(), 23, 59, 59, 999));
      return { year: start.getUTCFullYear(), month: start.getUTCMonth() + 1, start, end, daysInMonth: datesBetween(start, end).length };
    }
  }
  const year = Number(query.year) || 2026;
  const month = Number(query.month) || 5;
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { year, month, start, end, daysInMonth: end.getUTCDate() };
}

function datesBetween(start: Date, end: Date) {
  const dates: Date[] = [];
  const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (current <= last) {
    dates.push(new Date(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function dateInputFromParts(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateKey(date: Date) {
  return dateInputFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function isFullMonthPeriod(period: ReturnType<typeof resolvePeriod>) {
  const lastDay = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate();
  return (
    period.start.getUTCFullYear() === period.year &&
    period.start.getUTCMonth() === period.month - 1 &&
    period.start.getUTCDate() === 1 &&
    period.end.getUTCFullYear() === period.year &&
    period.end.getUTCMonth() === period.month - 1 &&
    period.end.getUTCDate() === lastDay
  );
}

function resolveAttendancePeriod(query: AttendanceQuery) {
  if (query.startDate || query.endDate) {
    const rawStartDate = parseDateOnly(query.startDate || "");
    const rawEndDate = parseDateOnly(query.endDate || "");
    if (!rawStartDate && !rawEndDate) return undefined;
    const startDate = rawStartDate ?? new Date(Date.UTC(rawEndDate!.getUTCFullYear(), rawEndDate!.getUTCMonth(), 1));
    const endDate = rawEndDate ?? new Date(Date.UTC(rawStartDate!.getUTCFullYear(), rawStartDate!.getUTCMonth() + 1, 0));
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
  const shiftFilter = cleanShiftName(query.shift);
  return {
    ...(search ? {
      OR: [
        { fullName: { contains: search, mode: "insensitive" } },
        { wbLogin: { contains: search, mode: "insensitive" } },
        { user: { email: { contains: search, mode: "insensitive" } } }
      ]
    } : {}),
    ...(query.lob && query.lob !== "Todos" ? { lob: { name: query.lob } } : {}),
    ...(shiftFilter && shiftFilter !== "Todos" && shiftFilter !== "Folga" ? { shift: { OR: [{ name: shiftFilter }, { name: { startsWith: `${shiftFilter} (` } }] } } : {}),
    ...(query.roleTitle && query.roleTitle !== "Todos" ? { roleTitle: { contains: query.roleTitle, mode: "insensitive" } } : {})
  };
}

function isNoSupervisorFilter(value: string) {
  return /^(sem\s*supervisor|sem_supervisor|none|no_supervisor|null)$/i.test(value.trim());
}

async function supervisorNameMap(supervisorIds: Array<string | null | undefined>) {
  const ids = Array.from(new Set(supervisorIds.filter((id): id is string => Boolean(id))));
  if (!ids.length) return new Map<string, string>();
  const supervisors = await prisma.employeeProfile.findMany({
    where: { id: { in: ids } },
    select: { id: true, fullName: true }
  });
  return new Map(supervisors.map((supervisor) => [supervisor.id, supervisor.fullName]));
}

async function scheduleSupervisorFilter(value?: string | null): Promise<Prisma.ScheduleWhereInput | null> {
  const raw = value?.trim();
  if (!raw || raw === "Todos") return null;
  if (isNoSupervisorFilter(raw)) return { supervisorId: null, employee: { supervisorId: null } };

  const supervisors = await prisma.employeeProfile.findMany({
    where: { fullName: { contains: raw, mode: "insensitive" } },
    select: { id: true }
  });
  const ids = supervisors.map((supervisor) => supervisor.id);
  return {
    OR: [
      ...(ids.length ? [{ supervisorId: { in: ids } }] : []),
      { employee: { supervisor: { fullName: { contains: raw, mode: "insensitive" } } } }
    ]
  };
}

function calendarCells(year: number, month: number) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const leading = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }).map((_, index) => {
    const dayNumber = index - leading + 1;
    const outside = dayNumber < 1 || dayNumber > daysInMonth;
    const actualDate = new Date(Date.UTC(year, month - 1, dayNumber));
    return { date: actualDate.getUTCDate(), dateIso: dateKey(actualDate), outside };
  });
}

function parseDateOnly(value: string) {
  const raw = text(value);
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return new Date(Date.UTC(Number(br[3]), Number(br[2]) - 1, Number(br[1])));
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  const date = new Date(`${raw.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseImportDate(value: unknown) {
  return normalizeExcelDate(value);
}

function normalizeTime(value: unknown) {
  return normalizeExcelTime(value);
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeImportKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase().replace(/[\s/-]+/g, "_");
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
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
  const [year, month, day] = dateKey(date).split("-");
  return `${day}/${month}/${year}`;
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

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}
