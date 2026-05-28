import { AuditAction, CoverageRisk, Prisma, type ScheduleStatus } from "@prisma/client";

import { createPermissionError } from "@/lib/api-errors";
import { hasExcelValue, normalizeExcelDate } from "@/lib/excel-normalization";
import { isAgentJobTitle, normalizeComparableJobTitle } from "@/lib/job-title-normalization";
import type { Actor } from "@/lib/mock-db";
import { recordErrorLog } from "@/lib/mock-db";
import { canAccessStaffCoverage, canExportStaffCoverage, canManageStaffCoverageRequirements } from "@/lib/permissions";
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
        lob: { select: { id: true; name: true } };
        shift: { select: { id: true; name: true } };
        supervisor: { select: { id: true; fullName: true; wbLogin: true } };
      };
    };
  };
}> & { coverageLobId: string; coverageLobName: string };

type RequirementRecord = Prisma.StaffCoverageGetPayload<{ include: { lob: true; shift: true } }>;

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

export async function listStaffCoverage(actor: Actor, query: StaffCoverageQuery = {}) {
  try {
    const user = await getUser(actor);
    if (!user) return createPermissionError("Usuário não encontrado ou inativo.");
    if (!canAccessStaffCoverage(permissionUser(user))) return createPermissionError("Você não tem permissão para visualizar Staff e Cobertura.");

    const period = resolvePeriod(query);
    const requirements = await listRequirements(period, query);
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
        canExport: canExportStaffCoverage(permissionUser(user))
      }
    };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "STAFF_COVERAGE_LIST_ERROR", message: errorMessage(error), action: "STAFF_COVERAGE_LIST", severity: "ERROR" });
    return { error: "Não foi possível carregar Staff e Cobertura.", message: "Não foi possível carregar Staff e Cobertura." };
  }
}

export async function getStaffCoverageDetails(actor: Actor, query: StaffCoverageDetailQuery = {}) {
  try {
    const user = await getUser(actor);
    if (!user) return createPermissionError("Usuário não encontrado ou inativo.");
    if (!canAccessStaffCoverage(permissionUser(user))) return createPermissionError("Você não tem permissão para visualizar Staff e Cobertura.");
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
    return { error: "Não foi possível carregar os agentes da cobertura.", message: "Não foi possível carregar os agentes da cobertura." };
  }
}

export async function previewStaffCoverageImport(actor: Actor, rows: Array<Record<string, unknown>>) {
  try {
    const user = await getUser(actor);
    if (!user) return { success: false, error: "Usuário não encontrado ou inativo.", message: "Usuário não encontrado ou inativo.", rows: [], summary: emptyPreviewSummary() };
    if (!canManageStaffCoverageRequirements(permissionUser(user))) {
      return { success: false, error: "Apenas WFM ou ADMIN podem importar requerido de Staff e Cobertura.", message: "Apenas WFM ou ADMIN podem importar requerido de Staff e Cobertura.", rows: [], summary: emptyPreviewSummary() };
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
      return { error: "Apenas WFM ou ADMIN podem importar requerido de Staff e Cobertura.", message: "Apenas WFM ou ADMIN podem importar requerido de Staff e Cobertura.", status: 403 };
    }

    const validRows = rows.filter((row) => !row.errors?.length && row.date && row.lobId && row.shiftId && row.required !== null && row.required !== undefined);
    if (!validRows.length) return { error: "Não há linhas válidas para importar.", message: "Não há linhas válidas para importar.", status: 400 };

    const period = rowsPeriod(validRows);
    const schedules = await listCoverageSchedules(period, {});
    const availability = availabilityMap(schedules);
    let createdRows = 0;
    let updatedRows = 0;

    await prisma.$transaction(async (tx) => {
      for (const row of validRows) {
        const date = parseDate(row.date)!;
        const available = availability.get(`${row.date}|${row.lobId}|${row.shift}`)?.count ?? 0;
        const metrics = coverageMetrics(available, row.required ?? 0);
        const before = await tx.staffCoverage.findUnique({
          where: { date_lobId_shiftId: { date, lobId: row.lobId!, shiftId: row.shiftId! } },
          select: { id: true, requiredStaff: true, plannedStaff: true, gap: true, observation: true }
        });
        const saved = await tx.staffCoverage.upsert({
          where: { date_lobId_shiftId: { date, lobId: row.lobId!, shiftId: row.shiftId! } },
          create: {
            date,
            lobId: row.lobId!,
            shiftId: row.shiftId!,
            requiredStaff: row.required ?? 0,
            plannedStaff: available,
            coveragePercent: metrics.coveragePercent,
            gap: metrics.gap,
            risk: metrics.risk,
            observation: row.observation || null,
            createdById: user.id,
            updatedById: user.id
          },
          update: {
            requiredStaff: row.required ?? 0,
            plannedStaff: available,
            coveragePercent: metrics.coveragePercent,
            gap: metrics.gap,
            risk: metrics.risk,
            observation: row.observation || null,
            updatedById: user.id
          }
        });
        if (before) updatedRows += 1;
        else createdRows += 1;
        await tx.auditLog.create({
          data: {
            actorId: user.id,
            action: before ? AuditAction.EDICAO : AuditAction.CRIACAO,
            entity: "StaffCoverageRequirement",
            entityId: saved.id,
            reason: `Importação de requerido de Staff e Cobertura${fileName ? ` (${fileName})` : ""}`,
            previousValue: serialize(before),
            newValue: serialize({
              date: row.date,
              lob: row.lob,
              shift: row.shift,
              requiredStaff: row.required,
              plannedStaff: available,
              gap: metrics.gap,
              observation: row.observation
            })
          }
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: AuditAction.IMPORTACAO,
          entity: "StaffCoverageRequirement",
          entityId: `staff-coverage-import-${Date.now()}`,
          reason: `Importação de requerido semanal: ${createdRows} criado(s), ${updatedRows} atualizado(s)`,
          newValue: { fileName, totalRows: rows.length, importedRows: validRows.length, createdRows, updatedRows }
        }
      });
    });

    return { success: true, createdRows, updatedRows, importedRows: validRows.length };
  } catch (error) {
    recordErrorLog({ userEmail: actor.email, code: "STAFF_COVERAGE_COMMIT_ERROR", message: errorMessage(error), action: "STAFF_COVERAGE_COMMIT", severity: "ERROR" });
    return { error: "Não foi possível importar o requerido de Staff e Cobertura.", message: "Não foi possível importar o requerido de Staff e Cobertura.", status: 500 };
  }
}

export async function exportStaffCoverageXlsxData(actor: Actor, query: StaffCoverageQuery = {}): Promise<XlsxExportPayload | ReturnType<typeof createPermissionError>> {
  const user = await getUser(actor);
  if (!user) return createPermissionError("Usuário não encontrado ou inativo.");
  if (!canExportStaffCoverage(permissionUser(user))) return createPermissionError("Você não tem permissão para exportar Staff e Cobertura.");

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
      reason: "Exportação XLSX de Staff e Cobertura",
      newValue: { filters: query, rows: result.data.length, agents: agents.length }
    }
  });

  return {
    fileName: fileNameForPeriod("staff_cobertura", result.period.startDate, result.period.endDate),
    sheetName: "cobertura",
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

async function listRequirements(period: { startDate: Date; endDate: Date }, query: StaffCoverageQuery) {
  const where: Prisma.StaffCoverageWhereInput = {
    date: { gte: period.startDate, lte: period.endDate }
  };
  if (query.lob && query.lob !== "Todos") where.lob = { name: { equals: query.lob, mode: "insensitive" } };
  const shift = normalizeProductiveShift(query.shift);
  if (shift) where.shift = { OR: [{ name: { equals: shift, mode: "insensitive" } }, { name: { startsWith: shift, mode: "insensitive" } }] };
  return prisma.staffCoverage.findMany({ where, include: { lob: true, shift: true }, orderBy: [{ date: "asc" }, { lob: { name: "asc" } }, { shift: { name: "asc" } }] });
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
          lob: { select: { id: true, name: true } },
          shift: { select: { id: true, name: true } },
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
  if (!isCoverageEmployeeActive(schedule.employee.operationalStatus)) return false;
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
  return schedule.status === "TROCA_APROVADA" && isProductiveShift(shift);
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function emptyPreviewSummary() {
  return { totalRows: 0, validRows: 0, errorRows: 0, warningRows: 0, createdRows: 0, updatedRows: 0 };
}
