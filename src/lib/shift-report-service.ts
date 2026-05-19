import { FollowUpStatus, GeneralMood, Prisma, ShiftReportImportance } from "@prisma/client";

import type { Actor } from "@/lib/mock-db";
import { normalizeRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { cleanShiftName } from "@/lib/shift-display";

export type ShiftReportInput = {
  reportDate: string;
  shift: string;
  lob: string;
  operation: string;
  rta: string;
  importance: string;
  plannedHeadcount: number;
  actualHeadcount: number;
  onlineAgents: number;
  absCount: number;
  absJustification?: string;
  absentEmployees?: Array<{ employeeId: string; absenceReason: string; observation?: string; impactsAbs?: boolean; impactsCoverage?: boolean }>;
  queueStatusStart: string;
  queueStatusEnd: string;
  backlogStart?: number;
  backlogEnd?: number;
  latencyStart?: string;
  latencyEnd?: string;
  occurrenceCategory: string;
  impactLevel: string;
  occurrences?: string;
  pendingTasks?: string;
  generalMood: string;
  leadersPresent?: string;
  mainRisks?: string;
  actionsTaken?: string;
  nextShiftAttentionPoints?: string;
  requiresFollowUp?: boolean;
  followUpOwner?: string;
  followUpDueDate?: string;
  followUpStatus?: string;
  additionalComments?: string;
  timeBlocks?: Array<{ startTime: string; endTime: string; category: string; description?: string }>;
};

export type ShiftReportQuery = {
  startDate?: string;
  endDate?: string;
  shift?: string;
  supervisor?: string;
  rta?: string;
  importance?: string;
  mood?: string;
  search?: string;
};

const importanceMap: Record<string, ShiftReportImportance> = {
  BAIXA: "BAIXA",
  MEDIA: "MEDIA",
  MÉDIA: "MEDIA",
  ALTA: "ALTA",
  CRITICA: "CRITICA",
  CRÍTICA: "CRITICA"
};

const moodMap: Record<string, GeneralMood> = {
  "MUITO BOM": "MUITO_BOM",
  MUITO_BOM: "MUITO_BOM",
  BOM: "BOM",
  NEUTRO: "NEUTRO",
  RUIM: "RUIM",
  CRITICO: "CRITICO",
  CRÍTICO: "CRITICO"
};

const followUpMap: Record<string, FollowUpStatus> = {
  ABERTO: "ABERTO",
  "EM ANDAMENTO": "EM_ANDAMENTO",
  EM_ANDAMENTO: "EM_ANDAMENTO",
  CONCLUIDO: "CONCLUIDO",
  CONCLUÍDO: "CONCLUIDO",
  CANCELADO: "CANCELADO"
};

const labelImportance: Record<ShiftReportImportance, string> = { BAIXA: "Baixa", MEDIA: "Média", ALTA: "Alta", CRITICA: "Crítica" };
const labelMood: Record<GeneralMood, string> = { MUITO_BOM: "Muito bom", BOM: "Bom", NEUTRO: "Neutro", RUIM: "Ruim", CRITICO: "Crítico" };
const labelFollowUp: Record<FollowUpStatus, string> = { ABERTO: "Aberto", EM_ANDAMENTO: "Em andamento", CONCLUIDO: "Concluído", CANCELADO: "Cancelado" };
const timeBlockCategories = new Set([
  "Administrativo",
  "Desenvolvimento",
  "Acompanhamento de operação",
  "Feedback",
  "Reunião",
  "Treinamento",
  "Suporte ao time",
  "Análise de indicadores",
  "Escalonamento / Ocorrência",
  "Pausa",
  "Outros"
]);

async function getActorUser(actor: Actor) {
  return prisma.user.findUnique({ where: { email: actor.email }, include: { role: true, employeeProfile: true } });
}

function canViewShiftReportRole(role: string) {
  return ["ADMIN", "GESTOR", "WFM", "SUPERVISOR"].includes(normalizeRole(role));
}

function normalizeKey(value?: string | null) {
  return String(value ?? "").trim().toUpperCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function parseDate(value?: string | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00.000Z`) : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(date);
}

function serialize(value: unknown) {
  return JSON.parse(JSON.stringify(value, (_key, current) => current instanceof Date ? current.toISOString() : current));
}

function parseTimeToMinutes(value?: string | null) {
  const match = String(value ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function minutesBetween(startTime: string, endTime: string) {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start === null || end === null || start === end) return null;
  return end > start ? end - start : end + 24 * 60 - start;
}

function minutesFromShiftStart(time: string, shiftStart: number) {
  const minutes = parseTimeToMinutes(time);
  if (minutes === null) return null;
  return minutes >= shiftStart ? minutes - shiftStart : minutes + 24 * 60 - shiftStart;
}

function validateTimeBlocks(inputBlocks: ShiftReportInput["timeBlocks"], shift?: { startsAt: string; endsAt: string } | null) {
  const blocks = inputBlocks ?? [];
  const normalized: Array<{ startTime: string; endTime: string; category: string; description?: string; durationMinutes: number; startOffset: number; endOffset: number }> = [];
  const shiftStart = parseTimeToMinutes(shift?.startsAt);
  const shiftDuration = shift?.startsAt && shift?.endsAt ? minutesBetween(shift.startsAt, shift.endsAt) : null;

  for (const [index, block] of blocks.entries()) {
    const label = `Bloco ${index + 1}`;
    const startTime = String(block.startTime ?? "").trim();
    const endTime = String(block.endTime ?? "").trim();
    const category = String(block.category ?? "").trim();
    if (!startTime) return { error: `${label}: Informe a hora inicial.` };
    if (!endTime) return { error: `${label}: Informe a hora final.` };
    if (!category) return { error: `${label}: Selecione uma categoria.` };
    if (!timeBlockCategories.has(category)) return { error: `${label}: Categoria de atividade inválida.` };
    const durationMinutes = minutesBetween(startTime, endTime);
    if (durationMinutes === null) return { error: `${label}: A hora final deve ser maior que a hora inicial.` };
    const startOffset = shiftStart === null ? parseTimeToMinutes(startTime) ?? 0 : minutesFromShiftStart(startTime, shiftStart);
    if (startOffset === null) return { error: `${label}: Hora inicial inválida.` };
    const endOffset = startOffset + durationMinutes;
    if (shiftStart !== null && shiftDuration !== null && shiftDuration > 0 && (startOffset < 0 || endOffset > shiftDuration)) {
      return { error: `${label}: Este bloco está fora do horário do turno.` };
    }
    normalized.push({
      startTime,
      endTime,
      category,
      description: String(block.description ?? "").trim() || undefined,
      durationMinutes,
      startOffset,
      endOffset
    });
  }

  const sorted = [...normalized].sort((a, b) => a.startOffset - b.startOffset);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].startOffset < sorted[index - 1].endOffset) {
      return { error: "Existe sobreposição com outro bloco de tempo." };
    }
  }

  return { data: normalized };
}

async function findShiftId(value: string) {
  const name = cleanShiftName(value);
  if (!name) return null;
  const shift = await prisma.shift.findFirst({ where: { name: { startsWith: name, mode: "insensitive" } }, select: { id: true } });
  return shift?.id ?? null;
}

async function findShift(value: string) {
  const name = cleanShiftName(value);
  if (!name) return null;
  return prisma.shift.findFirst({
    where: { name: { startsWith: name, mode: "insensitive" } },
    select: { id: true, startsAt: true, endsAt: true }
  });
}

async function findLobId(value: string) {
  const lob = await prisma.lob.findFirst({ where: { name: { equals: value.trim(), mode: "insensitive" } }, select: { id: true } });
  return lob?.id ?? null;
}

async function findEmployeeByText(value?: string | null) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return prisma.employeeProfile.findFirst({
    where: {
      deletedAt: null,
      OR: [
        { fullName: { contains: text, mode: "insensitive" } },
        { wbLogin: { contains: text, mode: "insensitive" } },
        { user: { email: { contains: text, mode: "insensitive" } } }
      ]
    }
  });
}

async function reportLabels(reports: Array<{ shiftId: string | null; lobId: string | null; supervisorId: string | null; rtaId: string | null }>) {
  const shiftIds = [...new Set(reports.map((report) => report.shiftId).filter(Boolean) as string[])];
  const lobIds = [...new Set(reports.map((report) => report.lobId).filter(Boolean) as string[])];
  const employeeIds = [...new Set(reports.flatMap((report) => [report.supervisorId, report.rtaId]).filter(Boolean) as string[])];
  const [shifts, lobs, employees] = await Promise.all([
    prisma.shift.findMany({ where: { id: { in: shiftIds } }, select: { id: true, name: true } }),
    prisma.lob.findMany({ where: { id: { in: lobIds } }, select: { id: true, name: true } }),
    prisma.employeeProfile.findMany({ where: { id: { in: employeeIds } }, include: { user: true } })
  ]);
  return {
    shifts: new Map(shifts.map((shift) => [shift.id, cleanShiftName(shift.name) || shift.name])),
    lobs: new Map(lobs.map((lob) => [lob.id, lob.name])),
    employees: new Map(employees.map((employee) => [employee.id, employee]))
  };
}

function occurrenceFrom(report: { occurrences: Prisma.JsonValue | null }) {
  if (!report.occurrences || typeof report.occurrences !== "object" || Array.isArray(report.occurrences)) {
    return { category: "Outros", impactLevel: "Sem impacto", description: "" };
  }
  const occurrence = report.occurrences as { category?: string; impactLevel?: string; description?: string };
  return { category: occurrence.category ?? "Outros", impactLevel: occurrence.impactLevel ?? "Sem impacto", description: occurrence.description ?? "" };
}

export async function listShiftReports(actor: Actor, query: ShiftReportQuery = {}) {
  const user = await getActorUser(actor);
  if (!user || !canViewShiftReportRole(user.role.name)) return { data: [], dashboard: emptyDashboard() };

  const startDate = parseDate(query.startDate);
  const endDate = parseDate(query.endDate);
  const shiftId = query.shift && query.shift !== "Todos" ? await findShiftId(query.shift) : null;
  const rta = query.rta ? await findEmployeeByText(query.rta) : null;
  const supervisor = query.supervisor ? await findEmployeeByText(query.supervisor) : null;
  const importance = query.importance && query.importance !== "Todos" ? importanceMap[normalizeKey(query.importance)] : null;
  const mood = query.mood && query.mood !== "Todos" ? moodMap[normalizeKey(query.mood)] : null;
  const search = query.search?.trim();
  const filters: Prisma.ShiftReportWhereInput[] = [];
  if (startDate || endDate) filters.push({ reportDate: { ...(startDate ? { gte: startDate } : {}), ...(endDate ? { lte: endDate } : {}) } });
  if (shiftId) filters.push({ shiftId });
  if (supervisor) filters.push({ supervisorId: supervisor.id });
  if (rta) filters.push({ rtaId: rta.id });
  if (importance) filters.push({ importance });
  if (mood) filters.push({ generalMood: mood });
  if (search) {
    filters.push({
      OR: [
        { operation: { contains: search, mode: "insensitive" } },
        { pendingTasks: { contains: search, mode: "insensitive" } },
        { mainRisks: { contains: search, mode: "insensitive" } },
        { additionalComments: { contains: search, mode: "insensitive" } }
      ]
    });
  }
  if (normalizeRole(user.role.name) === "SUPERVISOR" && user.employeeProfile) filters.push({ supervisorId: user.employeeProfile.id });

  const reports = await prisma.shiftReport.findMany({
    where: { deletedAt: null, ...(filters.length ? { AND: filters } : {}) },
    include: { absences: true, timeBlocks: { orderBy: { startTime: "asc" } } },
    orderBy: { reportDate: "desc" },
    take: 300
  });
  const labels = await reportLabels(reports);
  const formatted = reports.map((report) => formatReport(report, labels));
  return { data: formatted, dashboard: buildDashboard(formatted) };
}

export async function createShiftReport(actor: Actor, input: ShiftReportInput) {
  const user = await getActorUser(actor);
  if (!user || !["ADMIN", "GESTOR", "WFM", "SUPERVISOR"].includes(normalizeRole(user.role.name))) return { error: "Você não tem permissão para criar report de turno." };
  const reportDate = parseDate(input.reportDate);
  if (!reportDate) return { error: "Data do report inválida." };
  const importance = importanceMap[normalizeKey(input.importance)];
  if (!importance) return { error: "Importância do report inválida." };
  const generalMood = moodMap[normalizeKey(input.generalMood)];
  if (!generalMood) return { error: "Humor geral do turno inválido." };
  const followUpStatus = followUpMap[normalizeKey(input.followUpStatus)] ?? "ABERTO";
  const shift = await findShift(input.shift);
  const shiftId = shift?.id ?? null;
  const lobId = await findLobId(input.lob);
  if (!shiftId) return { error: "Turno não encontrado em Configurações." };
  if (!lobId) return { error: "LOB não encontrada em Configurações." };
  const timeBlocks = validateTimeBlocks(input.timeBlocks, shift);
  if ("error" in timeBlocks) return { error: timeBlocks.error };
  const rta = await findEmployeeByText(input.rta);
  const followUpOwner = await findEmployeeByText(input.followUpOwner);
  const supervisorId = user.employeeProfile?.id ?? null;

  const report = await prisma.$transaction(async (tx) => {
    const saved = await tx.shiftReport.create({
      data: {
        reportDate,
        shiftId,
        lobId,
        operation: input.operation,
        supervisorId,
        rtaId: rta?.id ?? null,
        importance,
        plannedHeadcount: input.plannedHeadcount,
        actualHeadcount: input.actualHeadcount,
        onlineAgents: input.onlineAgents,
        absCount: input.absCount,
        absJustification: input.absJustification,
        queueStatusStart: input.queueStatusStart,
        queueStatusEnd: input.queueStatusEnd,
        backlogStart: input.backlogStart,
        backlogEnd: input.backlogEnd,
        latencyStart: input.latencyStart,
        latencyEnd: input.latencyEnd,
        occurrences: {
          category: input.occurrenceCategory,
          impactLevel: input.impactLevel,
          description: input.occurrences ?? ""
        },
        pendingTasks: input.pendingTasks,
        generalMood,
        leadersPresent: input.leadersPresent,
        mainRisks: input.mainRisks,
        actionsTaken: input.actionsTaken,
        nextShiftAttentionPoints: input.nextShiftAttentionPoints,
        requiresFollowUp: Boolean(input.requiresFollowUp),
        followUpOwnerId: followUpOwner?.id ?? null,
        followUpDueDate: parseDate(input.followUpDueDate),
        followUpStatus,
        additionalComments: input.additionalComments,
        absences: {
          create: (input.absentEmployees ?? []).map((absence) => ({
            employeeId: absence.employeeId,
            absenceReason: absence.absenceReason,
            observation: absence.observation,
            impactsAbs: absence.impactsAbs ?? true,
            impactsCoverage: absence.impactsCoverage ?? true
          }))
        },
        timeBlocks: {
          create: (timeBlocks.data ?? []).map((block) => ({
            startTime: block.startTime,
            endTime: block.endTime,
            category: block.category,
            description: block.description,
            durationMinutes: block.durationMinutes
          }))
        }
      },
      include: { absences: true, timeBlocks: { orderBy: { startTime: "asc" } } }
    });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: "CRIACAO",
        entity: "ShiftReport",
        entityId: saved.id,
        reason: "Report de turno criado",
        newValue: serialize(saved)
      }
    });
    return saved;
  });
  const labels = await reportLabels([report]);
  const data = formatReport(report, labels);
  return { data, briefing: buildDashboard([data]).briefing };
}

export async function deleteShiftReport(actor: Actor, id: string) {
  const user = await getActorUser(actor);
  if (!user) return { error: "Usuário ativo não encontrado." };
  const existing = await prisma.shiftReport.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return { error: "Report de turno não encontrado." };
  const role = normalizeRole(user.role.name);
  const canDelete = role === "ADMIN" || (role === "SUPERVISOR" && user.employeeProfile?.id === existing.supervisorId);
  if (!canDelete) return { error: "Você não tem permissão para excluir este report." };
  await prisma.$transaction(async (tx) => {
    await tx.shiftReport.update({ where: { id }, data: { deletedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: "EXCLUSAO",
        entity: "ShiftReport",
        entityId: id,
        reason: "Report de turno excluído",
        previousValue: serialize(existing),
        newValue: { deletedAt: true }
      }
    });
  });
  return { success: true, message: "Report de turno excluído." };
}

export async function exportShiftReports(actor: Actor, query: ShiftReportQuery = {}) {
  const payload = await listShiftReports(actor, query);
  const headers = ["id", "data", "turno", "lob", "supervisor", "rta", "importancia", "hc_previsto", "hc_real", "online", "abs", "humor", "categoria", "impacto", "follow_up", "tempo_total_minutos", "tempo_por_categoria", "blocos_tempo"];
  const rows = payload.data.map((report) => [
    report.id,
    report.reportDate,
    report.shift,
    report.lob,
    report.supervisor,
    report.rta,
    report.importance,
    report.plannedHeadcount,
    report.actualHeadcount,
    report.onlineAgents,
    report.absCount,
    report.generalMood,
    report.occurrenceCategory,
    report.impactLevel,
    report.followUpStatus,
    report.totalTimeMinutes,
    Object.entries(report.timeSummary).map(([category, minutes]) => `${category}: ${minutes}min`).join("; "),
    report.timeBlocks.map((block) => `${block.startTime}-${block.endTime} ${block.category}${block.description ? ` (${block.description})` : ""}`).join("; ")
  ]);
  return { csv: [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n"), data: payload.data, dashboard: payload.dashboard };
}

function formatReport(
  report: Prisma.ShiftReportGetPayload<{ include: { absences: true; timeBlocks: true } }>,
  labels: Awaited<ReturnType<typeof reportLabels>>
) {
  const occurrence = occurrenceFrom(report);
  const supervisor = report.supervisorId ? labels.employees.get(report.supervisorId) : null;
  const rta = report.rtaId ? labels.employees.get(report.rtaId) : null;
  const timeBlocks = [...report.timeBlocks].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const timeSummary = timeBlocks.reduce<Record<string, number>>((acc, block) => {
    acc[block.category] = (acc[block.category] ?? 0) + block.durationMinutes;
    return acc;
  }, {});
  return {
    id: report.id,
    reportDate: formatDate(report.reportDate),
    reportDateIso: report.reportDate.toISOString().slice(0, 10),
    submittedAt: report.submittedAt.toISOString(),
    shift: report.shiftId ? labels.shifts.get(report.shiftId) ?? "Sem turno" : "Sem turno",
    lob: report.lobId ? labels.lobs.get(report.lobId) ?? "Sem LOB" : "Sem LOB",
    operation: report.operation,
    supervisor: supervisor?.fullName ?? "Sem supervisor",
    supervisorId: report.supervisorId ?? "",
    rta: rta?.fullName ?? "",
    importance: labelImportance[report.importance],
    plannedHeadcount: report.plannedHeadcount,
    actualHeadcount: report.actualHeadcount,
    onlineAgents: report.onlineAgents,
    absCount: report.absCount,
    absJustification: report.absJustification ?? "",
    queueStatusStart: report.queueStatusStart,
    queueStatusEnd: report.queueStatusEnd,
    backlogStart: report.backlogStart ?? 0,
    backlogEnd: report.backlogEnd ?? 0,
    latencyStart: report.latencyStart ?? "",
    latencyEnd: report.latencyEnd ?? "",
    occurrenceCategory: occurrence.category,
    impactLevel: occurrence.impactLevel,
    occurrences: occurrence.description,
    pendingTasks: report.pendingTasks ?? "",
    generalMood: labelMood[report.generalMood],
    leadersPresent: report.leadersPresent ?? "",
    mainRisks: report.mainRisks ?? "",
    actionsTaken: report.actionsTaken ?? "",
    nextShiftAttentionPoints: report.nextShiftAttentionPoints ?? "",
    requiresFollowUp: report.requiresFollowUp,
    followUpOwner: report.followUpOwnerId ? labels.employees.get(report.followUpOwnerId)?.fullName ?? "" : "",
    followUpStatus: labelFollowUp[report.followUpStatus],
    additionalComments: report.additionalComments ?? "",
    timeBlocks: timeBlocks.map((block) => ({
      id: block.id,
      startTime: block.startTime,
      endTime: block.endTime,
      category: block.category,
      description: block.description ?? "",
      durationMinutes: block.durationMinutes
    })),
    timeSummary,
    totalTimeMinutes: timeBlocks.reduce((sum, block) => sum + block.durationMinutes, 0),
    createdAt: report.createdAt.toISOString()
  };
}

function buildDashboard(reports: ReturnType<typeof formatReport>[]) {
  const critical = reports.filter((report) => report.importance === "Crítica").length;
  const absTotal = reports.reduce((sum, report) => sum + report.absCount, 0);
  const pendingFollowUps = reports.filter((report) => report.requiresFollowUp && !["Concluído", "Cancelado"].includes(report.followUpStatus)).length;
  const byCategory = reports.reduce<Record<string, number>>((acc, report) => {
    acc[report.occurrenceCategory] = (acc[report.occurrenceCategory] ?? 0) + 1;
    return acc;
  }, {});
  const byShift = reports.reduce<Record<string, number>>((acc, report) => {
    acc[report.shift] = (acc[report.shift] ?? 0) + 1;
    return acc;
  }, {});
  const timeByCategory = reports.reduce<Record<string, number>>((acc, report) => {
    Object.entries(report.timeSummary).forEach(([category, minutes]) => {
      acc[category] = (acc[category] ?? 0) + minutes;
    });
    return acc;
  }, {});
  const mainRisks = reports.flatMap((report) => splitText(report.mainRisks)).slice(0, 5);
  return {
    total: reports.length,
    byShift,
    critical,
    absTotal,
    pendingFollowUps,
    overdueFollowUps: 0,
    byCategory,
    timeByCategory,
    totalTimeMinutes: reports.reduce((sum, report) => sum + report.totalTimeMinutes, 0),
    recent: reports.slice(0, 5),
    briefing: {
      title: "Resumo gerencial do turno",
      generatedAt: new Date().toLocaleString("pt-BR"),
      whatHappened: reports[0]?.occurrences || "Nenhum report de turno enviado.",
      mainRisks,
      worstImpacts: reports.filter((report) => ["Alto", "Crítico"].includes(report.impactLevel)).map((report) => `${report.occurrenceCategory}: ${report.impactLevel}`),
      decisionsNeeded: reports.filter((report) => report.requiresFollowUp).map((report) => report.pendingTasks || "Follow-up pendente"),
      abs: `${absTotal} ausência(s) reportada(s).`,
      mood: reports[0]?.generalMood ?? "Sem dados",
      queueStatus: reports[0] ? `${reports[0].queueStatusStart} → ${reports[0].queueStatusEnd}` : "Sem dados",
      actionsTaken: reports.flatMap((report) => splitText(report.actionsTaken)).slice(0, 5),
      recommendations: pendingFollowUps ? ["Acompanhar follow-ups abertos e responsáveis definidos."] : ["Sem follow-up pendente no período."]
    }
  };
}

function emptyDashboard() {
  return buildDashboard([]);
}

function splitText(value?: string) {
  return String(value ?? "").split(/[;\n]/).map((item) => item.trim()).filter(Boolean);
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}
