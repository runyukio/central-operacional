import { randomUUID } from "crypto";
import { AuditAction, CoverageRisk, Prisma, type ScheduleStatus } from "@prisma/client";

import { buildAdsRequirementPlan } from "@/lib/ads-requirement-planning-service";
import { createPermissionError } from "@/lib/api-errors";
import { hasExcelValue, normalizeExcelDate } from "@/lib/excel-normalization";
import { isAgentJobTitle, normalizeComparableJobTitle } from "@/lib/job-title-normalization";
import type { Actor } from "@/lib/mock-db";
import { recordErrorLog } from "@/lib/mock-db";
import { canAccessStaffCoverage, canAutoUpdateAdsRequirement, canExportStaffCoverage, canManageStaffCoverageRequirements } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { shiftCategoryName, shiftLookupKey } from "@/lib/shift-display";
import { dateStamp, type XlsxExportPayload } from "@/lib/xlsx-export";

const productiveShiftCategories = ["Manhã", "Tarde", "Noite"] as const;
type ProductiveShiftCategory = (typeof productiveShiftCategories)[number];
const coverageExportLimit = 10000;

const coverageStatuses = new Set<ScheduleStatus>(["ESCALADO", "PRESENTE", "ATRASO", "SAIDA_ANTECIPADA", "VENDA_FOLGA_APROVADA"]);
const statusLabels: Record<string, string> = {
  ESCALADO: "Escalado",
  PRESENTE: "Presente",
  AUSENTE: "Falta",
  FALTA: "Falta",
  FALTA_JUSTIFICADA: "Falta Justificada",
  FALTA_INJUSTIFICADA: "Falta Injustificada",
  ATRASO: "Atraso",
  SAIDA_ANTECIPADA: "Saída antecipada",
  AFASTADO: "Afastado",
  FOLGA: "Folga",
  FERIAS: "Férias",
  TREINAMENTO: "Treinamento",
  NESTING: "Nesting",
  TROCA_APROVADA: "Troca aprovada",
  VENDA_FOLGA_APROVADA: "Venda de folga aprovada",
  FOLGA_APROVADA: "Folga aprovada",
  SEM_ESCALA: "Sem escala",
  ERRO_ESCALA: "Erro de cronograma",
  FERIADO: "Feriado",
  CONFLITO: "Conflito",
  DESCOBERTO: "Descoberto",
  DESLIGADO: "Desligado"
};

const inactiveEmployeeStatusTokens = new Set([
  "inativo",
  "inativa",
  "inactive",
  "desativado",
  "desativada",
  "disabled",
  "desligado",
  "desligada",
  "desligado em treinamento",
  "desligada em treinamento",
  "desligado treinamento",
  "desligada treinamento",
  "terminated",
  "suspenso",
  "suspensa",
  "suspended",
  "em treinamento",
  "treinamento",
  "training",
  "nesting"
]);

const columnAliases: Record<string, string> = {
  data: "data",
  date: "data",
  dia: "data",
  lob: "lob",
  linha_de_negocio: "lob",
  linhadenegocio: "lob",
  linha_negocio: "lob",
  turno: "turno",
  shift: "turno",
  requerido: "requerido",
  required: "requerido",
  required_count: "requerido",
  requiredcount: "requerido",
  qtd_requerida: "requerido",
  qtdrequerida: "requerido",
  observacao: "observacao",
  observacoes: "observacao",
  observation: "observacao",
  obs: "observacao"
};

type ActiveUser = NonNullable<Awaited<ReturnType<typeof getUser>>>;
type StaffCoverageSchedule = Prisma.ScheduleGetPayload<{
  include: {
    shift: true;
    employee: {
      select: {
        id: true;
        fullName: true;
        wbLogin: true;
        roleTitle: true;
        skill: true;
        operationalStatus: true;
        workStartTime: true;
        workEndTime: true;
        lob: { select: { id: true; name: true } };
        shift: { select: { id: true; name: true; startsAt: true; endsAt: true } };
        supervisor: { select: { id: true; fullName: true; wbLogin: true } };
      };
    };
  };
}> & { coverageLobId: string; coverageLobName: string };

type RequirementRecord = {
  id: string;
  date: Date;
  lobId: string;
  shiftId: string;
  plannedStaff: number;
  requiredStaff: number;
  coveragePercent: number;
  gap: number;
  risk: CoverageRisk;
  observation: string | null;
  lob: { id: string; name: string };
  shift: { id: string; name: string };
};

type StaffCoverageImportWriteRow = {
  id: string;
  date: Date;
  dateKey: string;
  lobId: string;
  lob: string;
  shiftId: string;
  shift: string;
  required: number;
  available: number;
  gap: number;
  coveragePercent: number;
  risk: CoverageRisk;
  observation: string;
};

let staffCoverageExtendedColumnsCache: boolean | null = null;

export type StaffCoverageQuery = {
  startDate?: string;
  endDate?: string;
  lob?: string;
  shift?: string;
  supervisor?: string;
  skill?: string;
  roleTitle?: string;
  page?: string | number;
  limit?: string | number;
  includeAgents?: boolean;
};

export type StaffCoveragePreviewRow = {
  rowNumber: number;
  date: string;
  lob: string;
  lobId?: string;
  shift: string;
  shiftId?: string;
  required: number | null;
  observation: string;
  action: "create" | "update" | "ignore";
  errors: string[];
  warnings: string[];
};

export type StaffCoverageDetailQuery = StaffCoverageQuery & {
  date?: string;
  type?: "row" | "deficit";
};

export type AdsHourlyCoverageSlot = {
  date: string;
  hour: number;
};

export async function countAdsScheduledByHour(
  period: { startDate: Date; endDate: Date },
  slots: AdsHourlyCoverageSlot[]
) {
  const employeesBySlot = await collectAdsScheduledByHour(period, slots);
  return new Map(Array.from(employeesBySlot.entries(), ([key, employees]) => [key, employees.size]));
}

export async function listAdsScheduledAgentsAtHour(date: Date, hour: number) {
  const dateKey = formatDateKey(date);
  const employeesBySlot = await collectAdsScheduledByHour(
    { startDate: date, endDate: date },
    [{ date: dateKey, hour }]
  );
  return Array.from(employeesBySlot.get(`${dateKey}|${hour}`)?.values() ?? [])
    .map(formatAgent)
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
}

async function collectAdsScheduledByHour(
  period: { startDate: Date; endDate: Date },
  slots: AdsHourlyCoverageSlot[]
) {
  if (!slots.length) return new Map<string, Map<string, StaffCoverageSchedule>>();

  const queryStart = new Date(period.startDate);
  queryStart.setUTCDate(queryStart.getUTCDate() - 1);
  const schedules = await listCoverageSchedules({ startDate: queryStart, endDate: period.endDate }, { lob: "ADS", roleTitle: "Agente" });
  const employeesBySlot = new Map<string, Map<string, StaffCoverageSchedule>>();
  const slotTimes = slots.map((slot) => ({
    key: `${slot.date}|${slot.hour}`,
    timestamp: hourlySlotTimestamp(slot.date, slot.hour)
  }));

  for (const schedule of schedules) {
    const window = scheduleCoverageWindow(schedule);
    if (!window) continue;
    for (const slot of slotTimes) {
      if (slot.timestamp < window.start || slot.timestamp >= window.end) continue;
      const employees = employeesBySlot.get(slot.key) ?? new Map<string, StaffCoverageSchedule>();
      employees.set(schedule.employee.id, schedule);
      employeesBySlot.set(slot.key, employees);
    }
  }

  return employeesBySlot;
}

export async function listStaffCoverage(actor: Actor, query: StaffCoverageQuery = {}) {
  try {
    const user = await getUser(actor);
    if (!user) return createPermissionError("Usuário não encontrado ou inativo.");
    if (!canAccessStaffCoverage(permissionUser(user))) return createPermissionError("Você não tem permissão para visualizar Requerido.");

    const period = resolvePeriod(query);
    const hasExtendedColumns = await hasStaffCoverageExtendedColumns();
    const requirements = await listRequirements(period, query, hasExtendedColumns);
    const schedules = await listCoverageSchedules(period, query);
    const computed = buildCoverageRows(requirements, schedules, query);

    return {
      ...computed,
      period: { startDate: formatDateKey(period.startDate), endDate: formatDateKey(period.endDate) },
      filters: {
        lobs: computed.filterOptions.lobs,
        shifts: ["Todos", ...productiveShiftCategories],
        supervisors: computed.filterOptions.supervisors,
        skills: computed.filterOptions.skills
      },
      permissions: {
        canImport: canManageStaffCoverageRequirements(permissionUser(user)),
        canExport: canExportStaffCoverage(permissionUser(user)),
        canAutoUpdate: canAutoUpdateAdsRequirement(permissionUser(user))
      }
    };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "STAFF_COVERAGE_LIST_ERROR", message: errorMessage(error), action: "STAFF_COVERAGE_LIST", severity: "ERROR" });
    return { error: "Não foi possível carregar Requerido.", message: "Não foi possível carregar Requerido." };
  }
}

export async function getStaffCoverageDetails(actor: Actor, query: StaffCoverageDetailQuery = {}) {
  try {
    const user = await getUser(actor);
    if (!user) return createPermissionError("Usuário não encontrado ou inativo.");
    if (!canAccessStaffCoverage(permissionUser(user))) return createPermissionError("Você não tem permissão para visualizar Requerido.");
    if (!query.date || !query.lob || !query.shift) return { error: "Informe data, LOB e turno.", message: "Informe data, LOB e turno.", status: 400 };

    const date = parseDate(query.date);
    const shift = normalizeProductiveShift(query.shift);
    if (!date || !shift) return { error: "Filtro de detalhe inválido.", message: "Filtro de detalhe inválido.", status: 400 };

    const schedules = await listCoverageSchedules({ startDate: date, endDate: date }, query);
    const matching = schedules.filter((schedule) => scheduleKeyFromSchedule(schedule) === `${formatDateKey(date)}|${lobIdOrFallback(schedule)}|${shift}`);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(10, Number(query.limit) || 50));
    const start = (page - 1) * limit;
    const agents = matching.slice(start, start + limit).map(formatAgent);
    const requirement = await prisma.staffCoverage.findFirst({
      where: {
        date,
        lob: { name: { equals: String(query.lob), mode: "insensitive" } },
        shift: { OR: [{ name: { equals: shift, mode: "insensitive" } }, { name: { startsWith: shift, mode: "insensitive" } }] }
      },
      include: { lob: true, shift: true }
    });
    const required = requirement?.requiredStaff ?? 0;
    const available = matching.length;

    return {
      summary: {
        date: formatDateKey(date),
        dateLabel: formatDatePtBr(date),
        lob: String(query.lob),
        shift,
        required,
        available,
        gap: available - required
      },
      data: agents,
      pagination: { page, limit, total: matching.length, totalPages: Math.max(1, Math.ceil(matching.length / limit)) }
    };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "STAFF_COVERAGE_DETAILS_ERROR", message: errorMessage(error), action: "STAFF_COVERAGE_DETAILS", severity: "ERROR" });
    return { error: "Não foi possível carregar os agentes disponíveis.", message: "Não foi possível carregar os agentes disponíveis." };
  }
}

export async function previewStaffCoverageImport(actor: Actor, rows: Array<Record<string, unknown>>) {
  try {
    const user = await getUser(actor);
    if (!user) return { success: false, error: "Usuário não encontrado ou inativo.", message: "Usuário não encontrado ou inativo.", rows: [], summary: emptyPreviewSummary() };
    if (!canManageStaffCoverageRequirements(permissionUser(user))) {
      return { success: false, error: "Apenas WFM ou ADMIN podem importar Requerido.", message: "Apenas WFM ou ADMIN podem importar Requerido.", rows: [], summary: emptyPreviewSummary() };
    }

    const normalizedRows = rows.map(normalizeImportRow);
    const lobs = await prisma.lob.findMany({ select: { id: true, name: true } });
    const shifts = await prisma.shift.findMany({ select: { id: true, name: true, startsAt: true } });
    const lobByKey = new Map(lobs.map((lob) => [lookupKey(lob.name), lob]));
    const shiftByCategory = canonicalShiftByCategory(shifts);
    const seen = new Map<string, number>();

    const previewRows: StaffCoveragePreviewRow[] = normalizedRows.map((row, index) => {
      const rowNumber = index + 2;
      const errors: string[] = [];
      const warnings: string[] = [];
      const date = normalizeExcelDate(row.data);
      const lobName = text(row.lob);
      const lob = lobByKey.get(lookupKey(lobName));
      const shiftName = normalizeProductiveShift(row.turno);
      const shift = shiftName ? shiftByCategory.get(shiftName) : null;
      const required = parseRequired(row.requerido);
      const observation = text(row.observacao);

      if (!date) errors.push("Data inválida.");
      if (!lobName) errors.push("LOB é obrigatória.");
      else if (!lob) errors.push("LOB não encontrada.");
      if (!shiftName) errors.push("Turno inválido. Use Manhã, Tarde ou Noite.");
      else if (!shift) errors.push(`Turno ${shiftName} não está cadastrado.`);
      if (required === null) errors.push("Requerido inválido. Use número inteiro maior ou igual a 0.");

      const key = date && lob && shiftName ? `${formatDateKey(date)}|${lob.id}|${shiftName}` : "";
      if (key) {
        const firstRow = seen.get(key);
        if (firstRow) errors.push(`Duplicidade no arquivo para data + LOB + turno. Primeira ocorrência na linha ${firstRow}.`);
        else seen.set(key, rowNumber);
      }

      return {
        rowNumber,
        date: date ? formatDateKey(date) : text(row.data),
        lob: lob?.name ?? lobName,
        lobId: lob?.id,
        shift: shiftName ?? text(row.turno),
        shiftId: shift?.id,
        required,
        observation,
        action: errors.length ? "ignore" : "create",
        errors,
        warnings
      };
    });

    const validKeys = previewRows.filter((row) => !row.errors.length && row.lobId && row.shiftId && row.date);
    const existing = validKeys.length
      ? await prisma.staffCoverage.findMany({
          where: {
            OR: validKeys.map((row) => ({ date: parseDate(row.date)!, lobId: row.lobId!, shiftId: row.shiftId! }))
          },
          select: { id: true, date: true, lobId: true, shift: { select: { name: true } } }
        })
      : [];
    const existingKeys = new Set(existing.map((item) => `${formatDateKey(item.date)}|${item.lobId}|${shiftCategoryName(item.shift.name)}`));
    const rowsWithActions = previewRows.map((row) => {
      if (row.errors.length || !row.lobId) return row;
      const key = `${row.date}|${row.lobId}|${row.shift}`;
      return { ...row, action: existingKeys.has(key) ? "update" : "create" };
    });
    const summary = {
      totalRows: rowsWithActions.length,
      validRows: rowsWithActions.filter((row) => !row.errors.length).length,
      errorRows: rowsWithActions.filter((row) => row.errors.length).length,
      warningRows: rowsWithActions.filter((row) => row.warnings.length).length,
      createdRows: rowsWithActions.filter((row) => row.action === "create" && !row.errors.length).length,
      updatedRows: rowsWithActions.filter((row) => row.action === "update" && !row.errors.length).length
    };

    return { success: summary.errorRows === 0, rows: rowsWithActions, summary };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "STAFF_COVERAGE_PREVIEW_ERROR", message: errorMessage(error), action: "STAFF_COVERAGE_PREVIEW", severity: "ERROR" });
    return { success: false, error: "Não foi possível validar o arquivo de requerido.", message: "Não foi possível validar o arquivo de requerido.", rows: [], summary: emptyPreviewSummary() };
  }
}

export async function commitStaffCoverageImport(actor: Actor, rows: StaffCoveragePreviewRow[], fileName?: string) {
  try {
    const user = await getUser(actor);
    if (!user) return { error: "Usuário não encontrado ou inativo.", message: "Usuário não encontrado ou inativo.", status: 403 };
    if (!canManageStaffCoverageRequirements(permissionUser(user))) {
      return { error: "Apenas WFM ou ADMIN podem importar Requerido.", message: "Apenas WFM ou ADMIN podem importar Requerido.", status: 403 };
    }

    const validRows = rows.filter((row) => !row.errors?.length && row.date && row.lobId && row.shiftId && row.required !== null && row.required !== undefined);
    if (!validRows.length) return { error: "Não há linhas válidas para importar.", message: "Não há linhas válidas para importar.", status: 400 };

    const period = rowsPeriod(validRows);
    const schedules = await listCoverageSchedules(period, {});
    const availability = availabilityMap(schedules);
    const writeRows = validRows.map((row) => {
      const date = parseDate(row.date)!;
      const available = availability.get(`${row.date}|${row.lobId}|${row.shift}`)?.count ?? 0;
      const metrics = coverageMetrics(available, row.required ?? 0);
      return {
        id: randomUUID(),
        date,
        dateKey: row.date,
        lobId: row.lobId!,
        lob: row.lob,
        shiftId: row.shiftId!,
        shift: row.shift,
        required: row.required ?? 0,
        available,
        gap: metrics.gap,
        coveragePercent: metrics.coveragePercent,
        risk: metrics.risk,
        observation: row.observation
      } satisfies StaffCoverageImportWriteRow;
    });
    const existing = await prisma.staffCoverage.findMany({
      where: { OR: writeRows.map((row) => ({ date: row.date, lobId: row.lobId, shiftId: row.shiftId })) },
      select: { id: true, date: true, lobId: true, shiftId: true }
    });
    const existingKeys = new Set(existing.map((row) => `${formatDateKey(row.date)}|${row.lobId}|${row.shiftId}`));
    const createdRows = writeRows.filter((row) => !existingKeys.has(`${row.dateKey}|${row.lobId}|${row.shiftId}`)).length;
    const updatedRows = writeRows.length - createdRows;
    const hasExtendedColumns = await hasStaffCoverageExtendedColumns();

    await upsertStaffCoverageRows(writeRows, user.id, hasExtendedColumns);
    await auditStaffCoverageImport(user.id, writeRows, existingKeys, { fileName, totalRows: rows.length, createdRows, updatedRows });

    return { success: true, createdRows, updatedRows, importedRows: validRows.length };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "STAFF_COVERAGE_COMMIT_ERROR", message: errorMessage(error), action: "STAFF_COVERAGE_COMMIT", severity: "ERROR" });
    return { error: staffCoverageCommitUserMessage(error), message: staffCoverageCommitUserMessage(error), status: 500 };
  }
}

export async function exportStaffCoverageXlsxData(actor: Actor, query: StaffCoverageQuery = {}): Promise<XlsxExportPayload | ReturnType<typeof createPermissionError>> {
  const user = await getUser(actor);
  if (!user) return createPermissionError("Usuário não encontrado ou inativo.");
  if (!canExportStaffCoverage(permissionUser(user))) return createPermissionError("Você não tem permissão para exportar Requerido.");

  const result = await listStaffCoverage(actor, { ...query, page: 1, limit: coverageExportLimit, includeAgents: true });
  if ("error" in result) return result as ReturnType<typeof createPermissionError>;
  const rows = result.data.map((row) => [
    formatDatePtBr(parseDate(row.date)!),
    row.weekday,
    row.lob,
    row.shift,
    row.required,
    row.available,
    row.gap,
    row.status,
    row.observation
  ]);
  const agents = result.data.flatMap((row) => row.availableAgents.map((agent) => [
    formatDatePtBr(parseDate(row.date)!),
    row.lob,
    row.shift,
    agent.name,
    agent.wbLogin,
    agent.supervisor,
    agent.skill,
    agent.scheduleStatus
  ]));

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: AuditAction.UPLOAD,
      entity: "StaffCoverageExport",
      entityId: `staff-coverage-export-${Date.now()}`,
      reason: "Exportação XLSX de Requerido",
      newValue: { filters: query, rows: result.data.length, agents: agents.length }
    }
  });

  return {
    fileName: fileNameForPeriod("requerido", result.period.startDate, result.period.endDate),
    sheetName: "requerido",
    headers: ["data", "dia_semana", "lob", "turno", "requerido", "disponivel", "gap", "status", "observacao"],
    rows,
    sheets: [
      {
        sheetName: "agentes_disponiveis",
        headers: ["data", "lob", "turno", "nome", "wb_login", "supervisor", "skill", "status_cronograma"],
        rows: agents
      }
    ]
  };
}

export async function refreshAdsStaffCoverageFromForecast(actor: Actor, startDateRaw?: string) {
  try {
    const user = await getUser(actor);
    if (!user) return { error: "Usuário não encontrado ou inativo.", message: "Usuário não encontrado ou inativo.", status: 403 };
    if (!canAutoUpdateAdsRequirement(permissionUser(user))) {
      return { error: "Apenas ADMIN pode atualizar automaticamente a necessidade ADS.", message: "Apenas ADMIN pode atualizar automaticamente a necessidade ADS.", status: 403 };
    }

    const startDate = parseDate(startDateRaw ?? "");
    if (!startDate) return { error: "Informe uma data inicial válida.", message: "Informe uma data inicial válida.", status: 400 };

    const plan = await buildAdsRequirementPlan(startDate);
    const endDate = new Date(startDate.getTime() + 13 * 24 * 60 * 60 * 1000);
    const [adsLob, shifts, schedules, hasExtendedColumns] = await Promise.all([
      prisma.lob.findFirst({ where: { name: { equals: "ADS", mode: "insensitive" } }, select: { id: true, name: true } }),
      prisma.shift.findMany({ select: { id: true, name: true, startsAt: true } }),
      listCoverageSchedules({ startDate, endDate }, { lob: "ADS" }),
      hasStaffCoverageExtendedColumns()
    ]);
    if (!adsLob) throw new Error("LOB ADS não encontrada no cadastro.");

    const shiftsByCategory = canonicalShiftByCategory(shifts);
    const missingShifts = productiveShiftCategories.filter((shift) => !shiftsByCategory.has(shift));
    if (missingShifts.length) throw new Error(`Turno(s) não encontrado(s): ${missingShifts.join(", ")}.`);

    const availability = availabilityMap(schedules);
    const rows = plan.requirements.map<StaffCoverageImportWriteRow>((requirement) => {
      const shift = shiftsByCategory.get(requirement.shift)!;
      const date = parseDate(requirement.date)!;
      const available = availability.get(`${requirement.date}|${adsLob.id}|${requirement.shift}`)?.count ?? 0;
      const metrics = coverageMetrics(available, requirement.required);
      return {
        id: randomUUID(),
        date,
        dateKey: requirement.date,
        lobId: adsLob.id,
        lob: adsLob.name,
        shiftId: shift.id,
        shift: requirement.shift,
        required: requirement.required,
        available,
        gap: metrics.gap,
        coveragePercent: metrics.coveragePercent,
        risk: metrics.risk,
        observation: `Forecast automático ADS · média das 3 maiores janelas de 2h ${formatDecimal(requirement.planningVolume)} · AHT ${formatDecimal(plan.ahtSeconds)}s`
      };
    });

    await prisma.$transaction(async (tx) => {
      await upsertStaffCoverageRows(rows, user.id, hasExtendedColumns, tx);
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: AuditAction.EDICAO,
          entity: "StaffCoverageRequirement",
          entityId: `ads-auto-${formatDateKey(startDate)}-${formatDateKey(endDate)}`,
          reason: "Atualização automática da necessidade ADS por forecast",
          newValue: serialize({
            startDate: formatDateKey(startDate),
            endDate: formatDateKey(endDate),
            updatedRows: rows.length,
            ahtSeconds: plan.ahtSeconds,
            ahtPeriod: plan.ahtPeriod,
            latestVolumeAt: plan.latestVolumeAt,
            latestProductionAt: plan.latestProductionAt,
            formula: "ceil((media_top_3_janelas_moveis_2h * aht_segundos / 3600) * 1.0625 + 3)",
            requirements: rows.map((row, index) => ({
              date: row.dateKey,
              shift: row.shift,
              required: row.required,
              available: row.available,
              referenceHours: plan.requirements[index].referenceHours,
              planningVolume: plan.requirements[index].planningVolume
            }))
          })
        }
      });
    });

    return {
      success: true,
      updatedRows: rows.length,
      period: { startDate: formatDateKey(startDate), endDate: formatDateKey(endDate) },
      ahtSeconds: Math.round(plan.ahtSeconds * 100) / 100,
      ahtPeriod: plan.ahtPeriod,
      latestVolumeAt: plan.latestVolumeAt.toISOString(),
      latestProductionAt: plan.latestProductionAt.toISOString()
    };
  } catch (error) {
    recordErrorLog({
      userEmail: actor.email,
      code: "ADS_REQUIREMENT_AUTO_UPDATE_ERROR",
      message: errorMessage(error),
      action: "ADS_REQUIREMENT_AUTO_UPDATE",
      severity: "ERROR"
    });
    const detail = errorMessage(error);
    const message = /não há|não possui|ausente|não encontrada|não encontrado/i.test(detail)
      ? detail
      : "Não foi possível atualizar automaticamente a necessidade ADS.";
    return { error: message, message, status: 500 };
  }
}

async function upsertStaffCoverageRows(
  rows: StaffCoverageImportWriteRow[],
  userId: string,
  hasExtendedColumns: boolean,
  database: Prisma.TransactionClient | typeof prisma = prisma
) {
  for (const chunk of chunkArray(rows, 100)) {
    if (hasExtendedColumns) {
      await database.$executeRaw(Prisma.sql`
        INSERT INTO "StaffCoverage" (
          "id", "date", "lobId", "shiftId", "plannedStaff", "requiredStaff", "coveragePercent", "gap", "risk",
          "observation", "createdById", "updatedById", "createdAt", "updatedAt"
        )
        VALUES ${Prisma.join(chunk.map((row) => Prisma.sql`
          (
            ${row.id},
            ${row.date},
            ${row.lobId},
            ${row.shiftId},
            ${row.available},
            ${row.required},
            ${row.coveragePercent},
            ${row.gap},
            ${row.risk}::"CoverageRisk",
            ${row.observation || null},
            ${userId},
            ${userId},
            NOW(),
            NOW()
          )
        `))}
        ON CONFLICT ("date", "lobId", "shiftId") DO UPDATE SET
          "plannedStaff" = EXCLUDED."plannedStaff",
          "requiredStaff" = EXCLUDED."requiredStaff",
          "coveragePercent" = EXCLUDED."coveragePercent",
          "gap" = EXCLUDED."gap",
          "risk" = EXCLUDED."risk",
          "observation" = EXCLUDED."observation",
          "updatedById" = EXCLUDED."updatedById",
          "updatedAt" = NOW()
      `);
      continue;
    }

    await database.$executeRaw(Prisma.sql`
      INSERT INTO "StaffCoverage" (
        "id", "date", "lobId", "shiftId", "plannedStaff", "requiredStaff", "coveragePercent", "gap", "risk"
      )
      VALUES ${Prisma.join(chunk.map((row) => Prisma.sql`
        (
          ${row.id},
          ${row.date},
          ${row.lobId},
          ${row.shiftId},
          ${row.available},
          ${row.required},
          ${row.coveragePercent},
          ${row.gap},
          ${row.risk}::"CoverageRisk"
        )
      `))}
      ON CONFLICT ("date", "lobId", "shiftId") DO UPDATE SET
        "plannedStaff" = EXCLUDED."plannedStaff",
        "requiredStaff" = EXCLUDED."requiredStaff",
        "coveragePercent" = EXCLUDED."coveragePercent",
        "gap" = EXCLUDED."gap",
        "risk" = EXCLUDED."risk"
    `);
  }
}

async function auditStaffCoverageImport(userId: string, rows: StaffCoverageImportWriteRow[], existingKeys: Set<string>, summary: { fileName?: string; totalRows: number; createdRows: number; updatedRows: number }) {
  try {
    await prisma.auditLog.createMany({
      data: rows.map((row) => {
        const existing = existingKeys.has(`${row.dateKey}|${row.lobId}|${row.shiftId}`);
        return {
          actorId: userId,
          action: existing ? AuditAction.EDICAO : AuditAction.CRIACAO,
          entity: "StaffCoverageRequirement",
          entityId: `${row.dateKey}-${row.lobId}-${row.shiftId}`,
          reason: `Importação de Requerido${summary.fileName ? ` (${summary.fileName})` : ""}`,
          previousValue: {},
          newValue: serialize({
            date: row.dateKey,
            lob: row.lob,
            shift: row.shift,
            requiredStaff: row.required,
            plannedStaff: row.available,
            gap: row.gap,
            observation: row.observation
          })
        };
      })
    });
    await prisma.auditLog.create({
      data: {
        actorId: userId,
        action: AuditAction.IMPORTACAO,
        entity: "StaffCoverageRequirement",
        entityId: `staff-coverage-import-${Date.now()}`,
        reason: `Importação de requerido semanal: ${summary.createdRows} criado(s), ${summary.updatedRows} atualizado(s)`,
        newValue: { fileName: summary.fileName, totalRows: summary.totalRows, importedRows: rows.length, createdRows: summary.createdRows, updatedRows: summary.updatedRows }
      }
    });
  } catch (error) {
    console.error("[staff-coverage] Falha ao gerar AuditLog da importação", error);
  }
}

function buildCoverageRows(requirements: RequirementRecord[], schedules: StaffCoverageSchedule[], query: StaffCoverageQuery) {
  const availability = availabilityMap(schedules);
  const rowsByKey = new Map<string, StaffCoverageRow>();
  const includeAgents = query.includeAgents === true;

  for (const requirement of requirements) {
    const shift = shiftCategoryName(requirement.shift.name);
    if (!isProductiveShift(shift)) continue;
    const date = formatDateKey(requirement.date);
    const key = `${date}|${requirement.lobId}|${shift}`;
    const available = availability.get(key)?.count ?? 0;
    const agents = availability.get(key)?.agents ?? [];
    rowsByKey.set(key, buildRow({ date: requirement.date, lobId: requirement.lobId, lob: requirement.lob.name, shift, required: requirement.requiredStaff, available, observation: requirement.observation ?? "", agents: includeAgents ? agents : [] }));
  }

  for (const [key, value] of availability) {
    if (rowsByKey.has(key)) continue;
    const [dateKeyValue, lobId, shift] = key.split("|");
    const first = value.agents[0];
    if (!first) continue;
    rowsByKey.set(key, buildRow({
      date: parseDate(dateKeyValue)!,
      lobId,
      lob: first.lob,
      shift: shift as ProductiveShiftCategory,
      required: 0,
      available: value.count,
      observation: "",
      agents: includeAgents ? value.agents : []
    }));
  }

  const allRows = Array.from(rowsByKey.values()).sort((a, b) => `${a.date}|${a.lob}|${a.shift}`.localeCompare(`${b.date}|${b.lob}|${b.shift}`));
  const page = Math.max(1, Number(query.page) || 1);
  const requestedLimit = Number(query.limit) || 50;
  const limit = Math.min(requestedLimit > 100 ? coverageExportLimit : 100, Math.max(10, requestedLimit));
  const pagedRows = allRows.slice((page - 1) * limit, page * limit);
  const deficitRows = allRows.filter((row) => row.gap < 0);
  const scheduleAgents = schedules.map(formatAgent);

  return {
    data: pagedRows,
    summary: {
      totalRequired: allRows.reduce((sum, row) => sum + row.required, 0),
      totalAvailable: allRows.reduce((sum, row) => sum + row.available, 0),
      totalGap: allRows.reduce((sum, row) => sum + row.gap, 0),
      deficitDays: new Set(deficitRows.map((row) => row.date)).size,
      deficitShifts: deficitRows.length,
      biggestDeficit: deficitRows.reduce((min, row) => Math.min(min, row.gap), 0)
    },
    byDay: summarize(allRows, "date"),
    byLob: summarize(allRows, "lob"),
    byShift: summarize(allRows, "shift"),
    matrix: buildMatrix(allRows),
    filterOptions: {
      lobs: ["Todos", ...Array.from(new Set([...allRows.map((row) => row.lob), ...scheduleAgents.map((agent) => agent.lob)])).filter(Boolean).sort()],
      supervisors: ["Todos", "Sem supervisor", ...Array.from(new Set(scheduleAgents.map((agent) => agent.supervisor).filter((value) => value && value !== "Sem supervisor"))).sort()],
      skills: ["Todas", "Sem skill", ...Array.from(new Set(scheduleAgents.map((agent) => agent.skill).filter(Boolean))).sort()]
    },
    pagination: { page, limit, total: allRows.length, totalPages: Math.max(1, Math.ceil(allRows.length / limit)) }
  };
}

type StaffCoverageRow = {
  date: string;
  dateLabel: string;
  weekday: string;
  lobId: string;
  lob: string;
  shift: ProductiveShiftCategory;
  required: number;
  available: number;
  gap: number;
  coveragePercent: number;
  risk: CoverageRisk;
  status: string;
  observation: string;
  availableAgents: Array<ReturnType<typeof formatAgent>>;
};

function buildRow(input: { date: Date; lobId: string; lob: string; shift: ProductiveShiftCategory; required: number; available: number; observation: string; agents: Array<ReturnType<typeof formatAgent>> }): StaffCoverageRow {
  const metrics = coverageMetrics(input.available, input.required);
  return {
    date: formatDateKey(input.date),
    dateLabel: formatDatePtBr(input.date),
    weekday: weekdayLabel(input.date),
    lobId: input.lobId,
    lob: input.lob,
    shift: input.shift,
    required: input.required,
    available: input.available,
    gap: metrics.gap,
    coveragePercent: metrics.coveragePercent,
    risk: metrics.risk,
    status: coverageStatus(input.required, input.available),
    observation: input.observation,
    availableAgents: input.agents
  };
}

function availabilityMap(schedules: StaffCoverageSchedule[]) {
  const map = new Map<string, { count: number; agents: Array<ReturnType<typeof formatAgent>> }>();
  for (const schedule of schedules) {
    const key = scheduleKeyFromSchedule(schedule);
    if (!key) continue;
    const current = map.get(key) ?? { count: 0, agents: [] };
    current.count += 1;
    current.agents.push(formatAgent(schedule));
    map.set(key, current);
  }
  return map;
}

async function listRequirements(period: { startDate: Date; endDate: Date }, query: StaffCoverageQuery, hasExtendedColumns: boolean) {
  const where: Prisma.StaffCoverageWhereInput = {
    date: { gte: period.startDate, lte: period.endDate }
  };
  if (query.lob && query.lob !== "Todos") where.lob = { name: { equals: query.lob, mode: "insensitive" } };
  const shift = normalizeProductiveShift(query.shift);
  if (shift) where.shift = { OR: [{ name: { equals: shift, mode: "insensitive" } }, { name: { startsWith: shift, mode: "insensitive" } }] };
  const baseSelect = {
    id: true,
    date: true,
    lobId: true,
    shiftId: true,
    plannedStaff: true,
    requiredStaff: true,
    coveragePercent: true,
    gap: true,
    risk: true,
    lob: { select: { id: true, name: true } },
    shift: { select: { id: true, name: true } }
  } satisfies Prisma.StaffCoverageSelect;
  if (hasExtendedColumns) {
    return prisma.staffCoverage.findMany({
      where,
      select: { ...baseSelect, observation: true },
      orderBy: [{ date: "asc" }, { lob: { name: "asc" } }, { shift: { name: "asc" } }]
    }) as Promise<RequirementRecord[]>;
  }
  const rows = await prisma.staffCoverage.findMany({
    where,
    select: baseSelect,
    orderBy: [{ date: "asc" }, { lob: { name: "asc" } }, { shift: { name: "asc" } }]
  });
  return rows.map((row) => ({ ...row, observation: null }));
}

async function listCoverageSchedules(period: { startDate: Date; endDate: Date }, query: StaffCoverageQuery) {
  const schedules = await prisma.schedule.findMany({
    where: {
      date: { gte: period.startDate, lte: period.endDate },
      deletedAt: null,
      employee: { deletedAt: null }
    },
    include: {
      shift: true,
      employee: {
        select: {
          id: true,
          fullName: true,
          wbLogin: true,
          roleTitle: true,
          skill: true,
          operationalStatus: true,
          workStartTime: true,
          workEndTime: true,
          lob: { select: { id: true, name: true } },
          shift: { select: { id: true, name: true, startsAt: true, endsAt: true } },
          supervisor: { select: { id: true, fullName: true, wbLogin: true } }
        }
      }
    }
  });
  const lobIds = Array.from(new Set(schedules.map((schedule) => schedule.lobId).filter(Boolean) as string[]));
  const lobs = lobIds.length ? await prisma.lob.findMany({ where: { id: { in: lobIds } }, select: { id: true, name: true } }) : [];
  const lobNameById = new Map(lobs.map((lob) => [lob.id, lob.name]));
  return schedules
    .map((schedule) => ({
      ...schedule,
      coverageLobId: schedule.lobId ?? schedule.employee.lob.id,
      coverageLobName: schedule.lobId ? lobNameById.get(schedule.lobId) ?? schedule.employee.lob.name : schedule.employee.lob.name
    }))
    .filter((schedule) => scheduleMatchesFilters(schedule, query));
}

function scheduleMatchesFilters(schedule: StaffCoverageSchedule, query: StaffCoverageQuery) {
  if (!isAgentJobTitle(schedule.employee.roleTitle)) return false;
  if (!scheduleEmployeeCountsAsActive(schedule)) return false;
  if (!scheduleCountsAsCoverage(schedule)) return false;

  const lob = schedule.coverageLobName;
  if (query.lob && query.lob !== "Todos" && lookupKey(lob) !== lookupKey(query.lob)) return false;

  const shift = scheduleShiftCategory(schedule);
  const shiftFilter = normalizeProductiveShift(query.shift);
  if (shiftFilter && shift !== shiftFilter) return false;

  if (query.supervisor && query.supervisor !== "Todos") {
    const supervisor = schedule.employee.supervisor;
    if (query.supervisor === "Sem supervisor") {
      if (supervisor) return false;
    } else {
      const target = lookupKey(query.supervisor);
      if (!supervisor || (lookupKey(supervisor.fullName) !== target && lookupKey(supervisor.wbLogin) !== target)) return false;
    }
  }

  if (query.skill && !["Todas", "Todos"].includes(query.skill)) {
    const skill = String(schedule.employee.skill ?? "").trim();
    if (query.skill === "Sem skill") {
      if (skill) return false;
    } else if (lookupKey(skill) !== lookupKey(query.skill)) {
      return false;
    }
  }

  return true;
}

function scheduleCountsAsCoverage(schedule: StaffCoverageSchedule) {
  const shift = scheduleShiftCategory(schedule);
  if (!isProductiveShift(shift)) return false;
  if (coverageStatuses.has(schedule.status)) return true;
  if (schedule.status === "NESTING") return isVideoOrCommentsSchedule(schedule);
  return schedule.status === "TROCA_APROVADA" && isProductiveShift(shift);
}

function scheduleEmployeeCountsAsActive(schedule: StaffCoverageSchedule) {
  if (isCoverageEmployeeActive(schedule.employee.operationalStatus)) return true;
  return isOperationalNesting(schedule.employee.operationalStatus) && isVideoOrCommentsSchedule(schedule) && scheduleCountsAsCoverage(schedule);
}

function isVideoOrCommentsSchedule(schedule: StaffCoverageSchedule) {
  const key = lookupKey([
    schedule.employee.skill,
    schedule.coverageLobName,
    schedule.employee.lob.name
  ].filter(Boolean).join(" "));
  return key.includes("VIDEO") || key.includes("COMMENT") || key.includes("TNS");
}

function isOperationalNesting(status?: string | null) {
  return normalizeComparableJobTitle(status) === "nesting";
}

function scheduleKeyFromSchedule(schedule: StaffCoverageSchedule) {
  const shift = scheduleShiftCategory(schedule);
  if (!isProductiveShift(shift)) return "";
  const lobId = lobIdOrFallback(schedule);
  if (!lobId) return "";
  return `${formatDateKey(schedule.date)}|${lobId}|${shift}`;
}

function lobIdOrFallback(schedule: StaffCoverageSchedule) {
  return schedule.coverageLobId;
}

function scheduleShiftCategory(schedule: StaffCoverageSchedule) {
  return shiftCategoryName(schedule.shift?.name ?? schedule.employee.shift?.name);
}

function formatAgent(schedule: StaffCoverageSchedule) {
  return {
    id: schedule.employee.id,
    name: schedule.employee.fullName,
    wbLogin: schedule.employee.wbLogin,
    supervisor: schedule.employee.supervisor?.fullName ?? "Sem supervisor",
    skill: schedule.employee.skill ?? "",
    lob: schedule.coverageLobName,
    shift: scheduleShiftCategory(schedule),
    scheduleStatus: statusLabels[schedule.status] ?? schedule.status
  };
}

function scheduleCoverageWindow(schedule: StaffCoverageSchedule) {
  const startTime = schedule.startsAt ?? schedule.shift?.startsAt ?? schedule.employee.workStartTime ?? schedule.employee.shift?.startsAt;
  const endTime = schedule.endsAt ?? schedule.shift?.endsAt ?? schedule.employee.workEndTime ?? schedule.employee.shift?.endsAt;
  const startMinutes = minutesFromClock(startTime);
  const endMinutes = minutesFromClock(endTime);
  if (startMinutes === null || endMinutes === null) return null;

  const dateKey = formatDateKey(schedule.date);
  const dayStart = hourlySlotTimestamp(dateKey, 0);
  const start = dayStart + startMinutes * 60_000;
  let end = dayStart + endMinutes * 60_000;
  if (end <= start) end += 24 * 60 * 60_000;
  return { start, end };
}

function hourlySlotTimestamp(dateKey: string, hour: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, 0, 0, 0);
}

function minutesFromClock(value?: string | null) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function coverageMetrics(available: number, required: number) {
  const gap = available - required;
  const coveragePercent = required > 0 ? Math.round((available / required) * 1000) / 10 : available > 0 ? 100 : 0;
  let risk: CoverageRisk = "EXCELENTE";
  if (gap < 0 && coveragePercent < 80) risk = "CRITICO";
  else if (gap < 0 && coveragePercent < 95) risk = "ATENCAO";
  else if (gap < 0) risk = "ADEQUADO";
  return { gap, coveragePercent, risk };
}

function coverageStatus(required: number, available: number) {
  if (required === 0 && available > 0) return "Sem requerido";
  if (required > 0 && available === 0) return "Sem cobertura";
  const gap = available - required;
  if (gap < 0) return "Déficit";
  if (gap === 0) return "OK";
  return "Sobra";
}

function summarize(rows: StaffCoverageRow[], field: "date" | "lob" | "shift") {
  const map = new Map<string, { label: string; required: number; available: number; gap: number }>();
  for (const row of rows) {
    const label = field === "date" ? `${row.dateLabel} (${row.weekday})` : row[field];
    const current = map.get(label) ?? { label, required: 0, available: 0, gap: 0 };
    current.required += row.required;
    current.available += row.available;
    current.gap += row.gap;
    map.set(label, current);
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function buildMatrix(rows: StaffCoverageRow[]) {
  const map = new Map<string, { date: string; label: string; Manhã: number; Tarde: number; Noite: number; total: number }>();
  for (const row of rows) {
    const current = map.get(row.date) ?? { date: row.date, label: `${row.dateLabel} ${row.weekday}`, Manhã: 0, Tarde: 0, Noite: 0, total: 0 };
    current[row.shift] += row.gap;
    current.total += row.gap;
    map.set(row.date, current);
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeImportRow(row: Record<string, unknown>) {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const mapped = columnAliases[normalizeHeader(key)] ?? normalizeHeader(key);
    normalized[mapped] = value;
  }
  return normalized;
}

function canonicalShiftByCategory(shifts: Array<{ id: string; name: string; startsAt?: string | null }>) {
  const map = new Map<ProductiveShiftCategory, { id: string; name: string }>();
  for (const category of productiveShiftCategories) {
    const exact = shifts.find((shift) => shiftCategoryName(shift.name) === category && lookupKey(shift.name) === lookupKey(category));
    const fallback = shifts.find((shift) => shiftCategoryName(shift.name) === category);
    const selected = exact ?? fallback;
    if (selected) map.set(category, selected);
  }
  return map;
}

function normalizeProductiveShift(value?: unknown): ProductiveShiftCategory | null {
  const category = shiftCategoryName(String(value ?? ""));
  return isProductiveShift(category) ? category : null;
}

function isProductiveShift(value?: string | null): value is ProductiveShiftCategory {
  return productiveShiftCategories.includes(value as ProductiveShiftCategory);
}

function parseRequired(value: unknown) {
  if (!hasExcelValue(value)) return null;
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? value : null;
  const raw = String(value ?? "").trim();
  if (!/^\d+(?:[,.]0+)?$/.test(raw)) return null;
  const parsed = Number(raw.replace(",", "."));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function hasStaffCoverageExtendedColumns() {
  if (staffCoverageExtendedColumnsCache !== null) return staffCoverageExtendedColumnsCache;
  try {
    const result = await prisma.$queryRaw<Array<{ count: number | bigint }>>(Prisma.sql`
      SELECT COUNT(*)::int AS count
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'StaffCoverage'
        AND column_name IN ('observation', 'createdById', 'updatedById', 'createdAt', 'updatedAt')
    `);
    staffCoverageExtendedColumnsCache = Number(result[0]?.count ?? 0) === 5;
  } catch {
    staffCoverageExtendedColumnsCache = false;
  }
  return staffCoverageExtendedColumnsCache;
}

function resolvePeriod(query: StaffCoverageQuery) {
  const today = new Date();
  const startDate = parseDate(query.startDate ?? "") ?? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const endDate = parseDate(query.endDate ?? "") ?? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  return startDate <= endDate ? { startDate, endDate } : { startDate: endDate, endDate: startDate };
}

function rowsPeriod(rows: StaffCoveragePreviewRow[]) {
  const dates = rows.map((row) => parseDate(row.date)).filter(Boolean) as Date[];
  const sorted = dates.sort((a, b) => a.getTime() - b.getTime());
  return { startDate: sorted[0], endDate: sorted[sorted.length - 1] };
}

function parseDate(value: unknown) {
  return normalizeExcelDate(value);
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDatePtBr(date: Date) {
  const [year, month, day] = formatDateKey(date).split("-");
  return `${day}/${month}/${year}`;
}

function formatDecimal(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
}

function weekdayLabel(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(date).replace(".", "");
}

function fileNameForPeriod(prefix: string, startDate: string, endDate: string) {
  if (startDate && endDate && startDate !== endDate) return `${prefix}_${startDate}_a_${endDate}.xlsx`;
  return `${prefix}_${startDate || dateStamp()}.xlsx`;
}

function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function lookupKey(value: unknown) {
  return shiftLookupKey(String(value ?? ""));
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function isCoverageEmployeeActive(status?: string | null) {
  return !inactiveEmployeeStatusTokens.has(normalizeComparableJobTitle(status));
}

function permissionUser(user: ActiveUser) {
  return { role: user.role.name, email: user.email, name: user.name, status: user.status };
}

async function getUser(actor: Actor) {
  if (!actor.email) return null;
  return prisma.user.findUnique({ where: { email: actor.email }, include: { role: true, employeeProfile: true } });
}

function serialize(value: unknown) {
  return value ? JSON.parse(JSON.stringify(value)) : {};
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function staffCoverageCommitUserMessage(error: unknown) {
  const message = errorMessage(error);
  if (/transaction already closed|timeout|P2028/i.test(message)) {
    return "A importação demorou mais do que o banco permitiu. O processamento em lote foi ajustado; tente importar novamente.";
  }
  if (/column .*does not exist|createdById|updatedById|observation|createdAt|updatedAt/i.test(message)) {
    return "A migration de Requerido ainda não foi aplicada no banco online. Rode npx prisma migrate deploy e tente novamente.";
  }
  return "Não foi possível importar o Requerido.";
}

function emptyPreviewSummary() {
  return { totalRows: 0, validRows: 0, errorRows: 0, warningRows: 0, createdRows: 0, updatedRows: 0 };
}
