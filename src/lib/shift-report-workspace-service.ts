import { FollowUpStatus, GeneralMood, Prisma, ShiftReportImportance } from "@prisma/client";

import { normalizeAccessRole, roleHasCapability } from "@/lib/access-control";
import type { Actor } from "@/lib/mock-db";
import { prisma } from "@/lib/prisma";
import { cleanShiftName } from "@/lib/shift-display";

export type ShiftReportAbsenceInput = {
  wbLogin: string;
  reason: string;
};

export type ShiftReportWorkspaceInput = {
  reportDate: string;
  shiftId: string;
  lobId: string;
  responsibleId: string;
  importance: "REPORT" | "ATTENTION" | "CRITICAL";
  onlineAgents: number;
  absences: ShiftReportAbsenceInput[];
  queueStatusStart: "ON_TARGET" | "OVER_TARGET";
  queueStatusEnd: "ON_TARGET" | "OVER_TARGET";
  occurrence?: string;
  pendingTasks?: string;
  generalMood: "HAPPY" | "NEUTRAL" | "SAD";
  leaderIds: string[];
};

export type ShiftReportWorkspaceQuery = {
  startDate?: string;
  endDate?: string;
  shift?: string;
  lob?: string;
  responsible?: string;
  importance?: string;
  mood?: string;
  search?: string;
};

const importanceByInput: Record<ShiftReportWorkspaceInput["importance"], ShiftReportImportance> = {
  REPORT: "BAIXA",
  ATTENTION: "ALTA",
  CRITICAL: "CRITICA"
};

const importanceLabel: Record<ShiftReportImportance, string> = {
  BAIXA: "Report",
  MEDIA: "Report",
  ALTA: "Atenção",
  CRITICA: "Crítico"
};

const moodByInput: Record<ShiftReportWorkspaceInput["generalMood"], GeneralMood> = {
  HAPPY: "BOM",
  NEUTRAL: "NEUTRO",
  SAD: "RUIM"
};

const moodLabel: Record<GeneralMood, string> = {
  MUITO_BOM: "Feliz",
  BOM: "Feliz",
  NEUTRO: "Normal",
  RUIM: "Triste",
  CRITICO: "Triste"
};

const queueStatusLabel = {
  ON_TARGET: "Latência no target",
  OVER_TARGET: "Latência estourada"
} as const;

function normalizeKey(value?: string | null) {
  return String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function parseDate(value?: string | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00.000Z`) : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function endOfUtcDay(value?: string | null) {
  const parsed = parseDate(value);
  if (!parsed) return null;
  parsed.setUTCHours(23, 59, 59, 999);
  return parsed;
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(value);
}

function serialize(value: unknown) {
  return JSON.parse(JSON.stringify(value, (_key, current) => current instanceof Date ? current.toISOString() : current));
}

function parseLeaderIds(value?: string | null) {
  if (!value) return [] as string[];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

async function actorUser(actor: Actor) {
  return prisma.user.findUnique({
    where: { email: actor.email },
    include: { role: true, employeeProfile: true }
  });
}

function permissionsForRole(role?: string | null) {
  return {
    canSubmit: roleHasCapability(role, "SHIFT_REPORT_SUBMIT"),
    canViewPanel: roleHasCapability(role, "SHIFT_REPORT_VIEW")
  };
}

export async function getShiftReportWorkspaceOptions(actor: Actor) {
  const user = await actorUser(actor);
  if (!user) return { error: "Usuário ativo não encontrado." };
  const permissions = permissionsForRole(user.role.name);
  if (!permissions.canSubmit && !permissions.canViewPanel) return { error: "Você não tem acesso ao Report de Turno." };

  const [lobs, shifts, people] = await Promise.all([
    prisma.lob.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.shift.findMany({ orderBy: { startsAt: "asc" }, select: { id: true, name: true, startsAt: true, endsAt: true } }),
    prisma.employeeProfile.findMany({
      where: { deletedAt: null, user: { is: { deletedAt: null, status: "ACTIVE" } } },
      select: {
        id: true,
        fullName: true,
        wbLogin: true,
        roleTitle: true,
        user: { select: { role: { select: { name: true, label: true } } } }
      },
      orderBy: { fullName: "asc" }
    })
  ]);

  const normalizedPeople = people.map((person) => ({
    id: person.id,
    name: person.fullName,
    wbLogin: person.wbLogin,
    role: normalizeAccessRole(person.user?.role.name),
    roleLabel: person.user?.role.label ?? person.roleTitle
  }));

  return {
    permissions,
    currentEmployeeId: user.employeeProfile?.id ?? null,
    lobs,
    shifts: shifts
      .map((shift) => ({ ...shift, name: cleanShiftName(shift.name) || shift.name }))
      .filter((shift) => ["manha", "tarde", "noite"].includes(normalizeKey(shift.name))),
    responsibles: normalizedPeople.filter((person) => person.role === "RTA" || person.role === "SUPERVISOR"),
    leaders: normalizedPeople.filter((person) => ["GESTOR", "SUPERVISOR", "RTA", "POC"].includes(person.role))
  };
}

type ReportWithRelations = Prisma.ShiftReportGetPayload<{
  include: { absences: true; timeBlocks: true };
}>;

async function loadLabels(reports: ReportWithRelations[]) {
  const shiftIds = [...new Set(reports.flatMap((report) => report.shiftId ? [report.shiftId] : []))];
  const lobIds = [...new Set(reports.flatMap((report) => report.lobId ? [report.lobId] : []))];
  const employeeIds = [...new Set(reports.flatMap((report) => [
    report.supervisorId,
    report.rtaId,
    ...parseLeaderIds(report.leadersPresent),
    ...report.absences.map((absence) => absence.employeeId)
  ].filter((id): id is string => Boolean(id))))];

  const [shifts, lobs, employees] = await Promise.all([
    prisma.shift.findMany({ where: { id: { in: shiftIds } }, select: { id: true, name: true } }),
    prisma.lob.findMany({ where: { id: { in: lobIds } }, select: { id: true, name: true } }),
    prisma.employeeProfile.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, fullName: true, wbLogin: true, roleTitle: true }
    })
  ]);

  return {
    shifts: new Map(shifts.map((shift) => [shift.id, cleanShiftName(shift.name) || shift.name])),
    lobs: new Map(lobs.map((lob) => [lob.id, lob.name])),
    employees: new Map(employees.map((employee) => [employee.id, employee]))
  };
}

function occurrenceDescription(value: Prisma.JsonValue | null) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return typeof value.description === "string" ? value.description : "";
}

function formatReport(report: ReportWithRelations, labels: Awaited<ReturnType<typeof loadLabels>>) {
  const leaderIds = parseLeaderIds(report.leadersPresent);
  return {
    id: report.id,
    reportDate: formatDate(report.reportDate),
    reportDateIso: report.reportDate.toISOString().slice(0, 10),
    submittedAt: report.submittedAt.toISOString(),
    submittedBy: report.supervisorId ? labels.employees.get(report.supervisorId)?.fullName ?? "Não identificado" : "Não identificado",
    shift: report.shiftId ? labels.shifts.get(report.shiftId) ?? "Sem turno" : "Sem turno",
    lob: report.lobId ? labels.lobs.get(report.lobId) ?? "Sem LOB" : "Sem LOB",
    responsibleId: report.rtaId ?? "",
    responsible: report.rtaId ? labels.employees.get(report.rtaId)?.fullName ?? "Não identificado" : "Não identificado",
    importance: importanceLabel[report.importance],
    onlineAgents: report.onlineAgents,
    absCount: report.absences.length || report.absCount,
    absences: report.absences.map((absence) => ({
      id: absence.id,
      wbLogin: labels.employees.get(absence.employeeId)?.wbLogin ?? "WB não encontrado",
      employee: labels.employees.get(absence.employeeId)?.fullName ?? "Não encontrado",
      reason: absence.observation || absence.absenceReason
    })),
    queueStatusStart: report.queueStatusStart,
    queueStatusEnd: report.queueStatusEnd,
    occurrence: occurrenceDescription(report.occurrences),
    pendingTasks: report.pendingTasks ?? "",
    generalMood: moodLabel[report.generalMood],
    leaders: leaderIds.map((id) => labels.employees.get(id)).filter(Boolean).map((leader) => ({
      id: leader!.id,
      name: leader!.fullName,
      role: leader!.roleTitle
    })),
    createdAt: report.createdAt.toISOString()
  };
}

export async function listShiftReportWorkspace(actor: Actor, query: ShiftReportWorkspaceQuery = {}) {
  const user = await actorUser(actor);
  if (!user) return { error: "Usuário ativo não encontrado." };
  const permissions = permissionsForRole(user.role.name);
  if (!permissions.canSubmit && !permissions.canViewPanel) return { error: "Você não tem acesso ao Report de Turno." };

  const filters: Prisma.ShiftReportWhereInput[] = [{ deletedAt: null }];
  const startDate = parseDate(query.startDate);
  const endDate = endOfUtcDay(query.endDate);
  if (startDate || endDate) filters.push({ reportDate: { ...(startDate ? { gte: startDate } : {}), ...(endDate ? { lte: endDate } : {}) } });
  if (query.shift && query.shift !== "Todos") filters.push({ shiftId: query.shift });
  if (query.lob && query.lob !== "Todos") filters.push({ lobId: query.lob });
  if (query.responsible && query.responsible !== "Todos") filters.push({ rtaId: query.responsible });
  if (query.importance && query.importance !== "Todos") {
    const value = importanceByInput[query.importance as keyof typeof importanceByInput];
    if (value) filters.push({ importance: value });
  }
  if (query.mood && query.mood !== "Todos") {
    const value = moodByInput[query.mood as keyof typeof moodByInput];
    if (value) filters.push({ generalMood: value });
  }
  if (query.search?.trim()) {
    const search = query.search.trim();
    filters.push({
      OR: [
        { pendingTasks: { contains: search, mode: "insensitive" } },
        { additionalComments: { contains: search, mode: "insensitive" } },
        { absences: { some: { observation: { contains: search, mode: "insensitive" } } } }
      ]
    });
  }
  if (!permissions.canViewPanel) {
    if (!user.employeeProfile?.id) return { data: [], summary: buildSummary([]), permissions };
    filters.push({ supervisorId: user.employeeProfile.id });
  }

  const reports = await prisma.shiftReport.findMany({
    where: { AND: filters },
    include: { absences: true, timeBlocks: true },
    orderBy: [{ reportDate: "desc" }, { submittedAt: "desc" }],
    take: permissions.canViewPanel ? 500 : 25
  });
  const labels = await loadLabels(reports);
  const data = reports.map((report) => formatReport(report, labels));
  return { data, summary: buildSummary(data), permissions };
}

export async function createShiftReportWorkspace(actor: Actor, input: ShiftReportWorkspaceInput) {
  const user = await actorUser(actor);
  if (!user || !roleHasCapability(user.role.name, "SHIFT_REPORT_SUBMIT")) return { error: "Você não tem permissão para enviar report de turno." };
  const reportDate = parseDate(input.reportDate);
  if (!reportDate) return { error: "Data do turno inválida." };

  const [shift, lob, responsible, leaders] = await Promise.all([
    prisma.shift.findUnique({ where: { id: input.shiftId }, select: { id: true } }),
    prisma.lob.findUnique({ where: { id: input.lobId }, select: { id: true } }),
    prisma.employeeProfile.findFirst({
      where: { id: input.responsibleId, deletedAt: null, user: { is: { deletedAt: null, status: "ACTIVE" } } },
      select: { id: true, user: { select: { role: { select: { name: true } } } } }
    }),
    prisma.employeeProfile.findMany({
      where: { id: { in: [...new Set(input.leaderIds)] }, deletedAt: null },
      select: { id: true }
    })
  ]);
  if (!shift) return { error: "Turno não encontrado." };
  if (!lob) return { error: "LOB não encontrada." };
  if (!responsible || !["RTA", "SUPERVISOR"].includes(normalizeAccessRole(responsible.user?.role.name))) {
    return { error: "Selecione um RTA ou Supervisor ativo como responsável." };
  }
  if (!Number.isInteger(input.onlineAgents) || input.onlineAgents < 0) return { error: "Agentes online deve ser um número inteiro maior ou igual a zero." };
  if (leaders.length !== new Set(input.leaderIds).size) return { error: "Um ou mais líderes selecionados não estão disponíveis." };

  const normalizedAbsences = input.absences.map((absence) => ({
    wbLogin: absence.wbLogin.trim(),
    key: normalizeKey(absence.wbLogin),
    reason: absence.reason.trim()
  })).filter((absence) => absence.wbLogin || absence.reason);
  if (normalizedAbsences.some((absence) => !absence.wbLogin || !absence.reason)) return { error: "Informe WB/Login e motivo em todas as ausências." };
  if (new Set(normalizedAbsences.map((absence) => absence.key)).size !== normalizedAbsences.length) return { error: "O mesmo WB/Login foi informado mais de uma vez em ABS." };

  const absenceEmployees = normalizedAbsences.length ? await prisma.employeeProfile.findMany({
    where: {
      deletedAt: null,
      OR: normalizedAbsences.map((absence) => ({ wbLogin: { equals: absence.wbLogin, mode: "insensitive" as const } }))
    },
    select: { id: true, wbLogin: true, fullName: true }
  }) : [];
  const absenceByWb = new Map(absenceEmployees.map((employee) => [normalizeKey(employee.wbLogin), employee]));
  const invalidAbsences = normalizedAbsences.filter((absence) => !absenceByWb.has(absence.key));
  if (invalidAbsences.length) return { error: `WB/Login não encontrado: ${invalidAbsences.map((absence) => absence.wbLogin).join(", ")}.` };

  const savedId = await prisma.$transaction(async (tx) => {
    const saved = await tx.shiftReport.create({
      data: {
        reportDate,
        shiftId: shift.id,
        lobId: lob.id,
        operation: "Report de turno",
        supervisorId: user.employeeProfile?.id ?? null,
        rtaId: responsible.id,
        importance: importanceByInput[input.importance],
        plannedHeadcount: 0,
        actualHeadcount: input.onlineAgents,
        onlineAgents: input.onlineAgents,
        absCount: normalizedAbsences.length,
        absJustification: normalizedAbsences.map((absence) => `${absence.wbLogin}: ${absence.reason}`).join("; ") || null,
        queueStatusStart: queueStatusLabel[input.queueStatusStart],
        queueStatusEnd: queueStatusLabel[input.queueStatusEnd],
        occurrences: { description: input.occurrence?.trim() ?? "" },
        pendingTasks: input.pendingTasks?.trim() || null,
        generalMood: moodByInput[input.generalMood],
        leadersPresent: JSON.stringify(input.leaderIds),
        requiresFollowUp: Boolean(input.pendingTasks?.trim()),
        followUpStatus: (input.pendingTasks?.trim() ? "ABERTO" : "CANCELADO") as FollowUpStatus,
        absences: {
          create: normalizedAbsences.map((absence) => ({
            employeeId: absenceByWb.get(absence.key)!.id,
            absenceReason: absence.reason,
            observation: absence.reason
          }))
        }
      },
      include: { absences: true, timeBlocks: true }
    });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: "CRIACAO",
        entity: "ShiftReport",
        entityId: saved.id,
        reason: "Report de turno enviado",
        newValue: serialize(saved)
      }
    });
    return saved.id;
  });

  const saved = await prisma.shiftReport.findUniqueOrThrow({ where: { id: savedId }, include: { absences: true, timeBlocks: true } });
  const labels = await loadLabels([saved]);
  return { data: formatReport(saved, labels), message: "Report de turno enviado com sucesso." };
}

export async function deleteShiftReportWorkspace(actor: Actor, id: string) {
  const user = await actorUser(actor);
  if (!user) return { error: "Usuário ativo não encontrado." };
  const existing = await prisma.shiftReport.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return { error: "Report de turno não encontrado." };
  const canDelete = normalizeAccessRole(user.role.name) === "ADMIN" || (roleHasCapability(user.role.name, "SHIFT_REPORT_SUBMIT") && user.employeeProfile?.id === existing.supervisorId);
  if (!canDelete) return { error: "Você não tem permissão para excluir este report." };
  await prisma.$transaction(async (tx) => {
    await tx.shiftReport.update({ where: { id }, data: { deletedAt: new Date() } });
    await tx.auditLog.create({
      data: { actorId: user.id, action: "EXCLUSAO", entity: "ShiftReport", entityId: id, reason: "Report de turno excluído", previousValue: serialize(existing), newValue: { deletedAt: true } }
    });
  });
  return { success: true, message: "Report de turno excluído." };
}

export async function exportShiftReportWorkspace(actor: Actor, query: ShiftReportWorkspaceQuery = {}) {
  const payload = await listShiftReportWorkspace(actor, query);
  if ("error" in payload) return payload;
  const headers = ["data_turno", "turno", "lob", "importancia", "responsavel", "enviado_por", "agentes_online", "abs_total", "abs_detalhes", "filas_inicio", "filas_final", "humor", "lideres_presentes", "ocorrencia", "tarefas_pendentes", "enviado_em"];
  const rows = payload.data.map((report) => [
    report.reportDateIso,
    report.shift,
    report.lob,
    report.importance,
    report.responsible,
    report.submittedBy,
    report.onlineAgents,
    report.absCount,
    report.absences.map((absence) => `${absence.wbLogin} - ${absence.reason}`).join("; "),
    report.queueStatusStart,
    report.queueStatusEnd,
    report.generalMood,
    report.leaders.map((leader) => leader.name).join("; "),
    report.occurrence,
    report.pendingTasks,
    report.submittedAt
  ]);
  return { headers, rows, sheetName: "Reports de turno", fileName: `report_turno_${new Date().toISOString().slice(0, 10)}.xlsx` };
}

function buildSummary(reports: Array<ReturnType<typeof formatReport>>) {
  return {
    total: reports.length,
    onlineAgents: reports.reduce((sum, report) => sum + report.onlineAgents, 0),
    absTotal: reports.reduce((sum, report) => sum + report.absCount, 0),
    attention: reports.filter((report) => report.importance === "Atenção").length,
    critical: reports.filter((report) => report.importance === "Crítico").length
  };
}
