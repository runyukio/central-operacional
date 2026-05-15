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
  impactsAbs?: boolean;
  impactsCoverage?: boolean;
  hasEvidence?: boolean;
  evidenceUrl?: string;
};

export type ScheduleQuery = {
  month?: number;
  year?: number;
  collaborator?: string;
  lob?: string;
  supervisor?: string;
  shift?: string;
  status?: string;
  roleTitle?: string;
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
          : role === "SUPERVISOR" && user.employeeProfile
            ? {
              supervisorId: user.employeeProfile.id,
              deletedAt: null,
              ...employeeFilters(query, search)
            }
            : {
              deletedAt: null,
              ...employeeFilters(query, search)
            },
      include: {
        user: true,
        lob: true,
        shift: true,
        supervisor: true,
        schedules: { where: scheduleWhere, include: { shift: true }, orderBy: { date: "asc" } }
      },
      orderBy: { fullName: "asc" },
      take: 200
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
        if (schedule.status === "ESCALADO") return schedule.shift?.name ?? "Escalado";
        return scheduleToUiStatus[schedule.status] ?? schedule.status;
      })
    }));

    const own = user.employeeProfile ? employees.find((employee) => employee.id === user.employeeProfile?.id) : null;
    const scheduleDays = calendarCells(period.year, period.month).map(({ date, outside }) => {
      const schedule = outside ? undefined : own?.schedules.find((item) => item.date.getUTCDate() === date);
      const label = schedule ? (schedule.status === "ESCALADO" ? schedule.shift?.name ?? "Escalado" : scheduleToUiStatus[schedule.status] ?? "Escalado") : "Sem escala";
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

      if (uiToAttendanceStatus[input.status]) {
        await upsertAttendance(tx, user.id, employee.id, schedule.id, date, input);
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

      if (requiresReason(input.status)) {
        await notifyAttendanceImpact(tx, employee.id, input.status, input.observation);
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

export async function previewOperationalScheduleImport(rows: Array<Record<string, unknown>>) {
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
            name: text(row.nome),
            lob: text(row.lob),
            supervisor: text(row.supervisor),
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
    const records = await prisma.attendanceRecord.findMany({
      where:
        role === "COLABORADOR" && user.employeeProfile
          ? { ...baseWhere, employeeId: user.employeeProfile.id }
          : role === "SUPERVISOR" && user.employeeProfile
            ? { ...baseWhere, employee: { supervisorId: user.employeeProfile.id, ...(lobFilter ? { lob: { name: lobFilter } } : {}) } }
            : baseWhere,
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
        shift: record.employee.shift.name,
        status: scheduleToUiStatus[record.status] ?? record.status,
        absenceReason: record.absenceReason ?? undefined,
        supervisorJustification: record.supervisorJustification ?? undefined,
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
  if (requiresReason(input.status) && !input.observation?.trim()) return "Motivo ou observação obrigatório para este status.";
  return "";
}

async function validateImportRowsInDb(rows: Array<Record<string, unknown>>) {
  const validations = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const errors: string[] = [];
    const warnings: string[] = [];
    const rowNumber = index + 1;

    if (!text(row.wb_login) && !text(row.email)) errors.push("Informe wb_login ou email.");
    if (!text(row.nome)) errors.push("Nome obrigatório.");
    const parsedDate = parseImportDate(row.data);
    if (!parsedDate) errors.push("Data obrigatória ou inválida.");
    if (parsedDate && (parsedDate.getUTCFullYear() !== 2026 || parsedDate.getUTCMonth() !== 4)) {
      warnings.push("Data fora de maio de 2026. A linha será preservada, mas não aparecerá no filtro inicial de teste.");
    }
    if (!text(row.status)) errors.push("Status obrigatório.");

    const status = text(row.status);
    if ((status === "Escalado" || status === "Presente") && !text(row.turno)) errors.push("Turno obrigatório para Escalado/Presente.");
    if (text(row.turno)) {
      const shift = await prisma.shift.findUnique({ where: { name: text(row.turno) } });
      if (!shift) errors.push(`Turno ${text(row.turno)} não cadastrado.`);
    }
    if (text(row.lob)) {
      const lob = await prisma.lob.findUnique({ where: { name: text(row.lob) } });
      if (!lob) warnings.push(`LOB ${text(row.lob)} não cadastrado; será usado o LOB do colaborador existente.`);
    }
    if (!(uiToScheduleStatus[status] ?? null)) warnings.push(`Status ${status || "-"} será tratado como Escalado.`);

    const employee = await findEmployeeForImport(prisma, row);
    if (!employee) errors.push("Colaborador não encontrado por wb_login ou email. Cadastre/aprove o login antes de importar esta linha.");

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
  const absImpact = input.impactsAbs ?? impactsAbs(input.status, input.observation);
  const coverageImpact = input.impactsCoverage ?? impactsCoverage(input.status);
  const saved = existing
    ? await tx.attendanceRecord.update({
        where: { id: existing.id },
        data: {
          status,
          absenceReason: input.observation,
          reasonCategory: requiresReason(input.status) ? "Escala" : undefined,
          supervisorJustification: input.observation,
          isJustified: !requiresReason(input.status) || Boolean(input.observation),
          impactsAbs: absImpact,
          impactsCoverage: coverageImpact,
          hasEvidence: input.hasEvidence ?? false,
          evidenceUrl: input.evidenceUrl,
          registeredById: userId,
          justifiedById: input.observation ? userId : undefined,
          justifiedAt: input.observation ? new Date() : undefined
        }
      })
    : await tx.attendanceRecord.create({
        data: {
          employeeId,
          scheduleId,
          date,
          status,
          absenceReason: input.observation,
          reasonCategory: requiresReason(input.status) ? "Escala" : undefined,
          supervisorJustification: input.observation,
          isJustified: !requiresReason(input.status) || Boolean(input.observation),
          impactsAbs: absImpact,
          impactsCoverage: coverageImpact,
          hasEvidence: input.hasEvidence ?? false,
          evidenceUrl: input.evidenceUrl,
          registeredById: userId,
          justifiedById: input.observation ? userId : undefined,
          justifiedAt: input.observation ? new Date() : undefined
        }
      });

  await tx.attendanceHistory.create({
    data: {
      attendanceRecordId: saved.id,
      changedById: userId,
      previousStatus: existing?.status,
      newStatus: status,
      previousReason: existing?.absenceReason,
      newReason: input.observation,
      comment: input.observation
    }
  });
}

async function notifyAttendanceImpact(tx: Prisma.TransactionClient, employeeId: string, status: string, observation?: string) {
  const employee = await tx.employeeProfile.findUnique({ where: { id: employeeId }, include: { supervisor: { include: { user: true } } } });
  if (!employee?.supervisor?.userId) return;
  await tx.notification.create({
    data: {
      userId: employee.supervisor.userId,
      title: "Ausência pendente de acompanhamento",
      body: `${employee.fullName} foi marcado como ${status}. ${observation ?? "Validar justificativa."}`,
      category: "Presença",
      type: "WARNING",
      entity: "AttendanceRecord",
      entityId: employeeId,
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
    include: { attendanceRecords: true, shift: true }
  });
  const plannedStatuses: ScheduleStatus[] = ["ESCALADO", "PRESENTE", "ATRASO", "SAIDA_ANTECIPADA", "AUSENTE", "FALTA", "VENDA_FOLGA_APROVADA"];
  const presentStatuses: ScheduleStatus[] = ["PRESENTE", "VENDA_FOLGA_APROVADA"];
  const absentStatuses: ScheduleStatus[] = ["AUSENTE", "FALTA", "AFASTADO", "SAIDA_ANTECIPADA"];
  const planned = schedules.filter((schedule) => plannedStatuses.includes(schedule.status)).length;
  const present = schedules.filter((schedule) => presentStatuses.includes(schedule.status)).length;
  const absent = schedules.filter((schedule) => absentStatuses.includes(schedule.status)).length;
  const denominator = planned || 1;
  const coverageRate = Math.round((present / denominator) * 1000) / 10;
  const absRate = Math.round((absent / denominator) * 1000) / 10;
  const attendanceRecords = schedules.flatMap((schedule) => schedule.attendanceRecords);
  const byShift = schedules.reduce<Record<string, { planned: number; present: number; absent: number; gap: number }>>((acc, schedule) => {
    const shiftName = schedule.shift?.name ?? "Sem turno";
    acc[shiftName] ??= { planned: 0, present: 0, absent: 0, gap: 0 };
    if (plannedStatuses.includes(schedule.status)) acc[shiftName].planned += 1;
    if (presentStatuses.includes(schedule.status)) acc[shiftName].present += 1;
    if (absentStatuses.includes(schedule.status)) acc[shiftName].absent += 1;
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
    late: schedules.filter((schedule) => schedule.status === "ATRASO").length,
    earlyLeave: schedules.filter((schedule) => schedule.status === "SAIDA_ANTECIPADA").length,
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

function resolvePeriod(query: ScheduleQuery | ScheduleRemoveInput) {
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
  const email = text(row.email).toLowerCase();
  if (!wbLogin && !email) return null;
  return client.employeeProfile.findFirst({
    where: {
      OR: [
        wbLogin ? { wbLogin } : undefined,
        email ? { user: { email } } : undefined
      ].filter(Boolean) as Prisma.EmployeeProfileWhereInput[]
    },
    include: { shift: true }
  });
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
