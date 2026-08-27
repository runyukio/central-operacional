import { Prisma, type EquipmentStatus, type RequestStatus, type ScheduleStatus, type UserStatus } from "@prisma/client";

import type { Actor } from "@/lib/mock-db";
import { createNotFoundError, createPermissionError, createServerError, type ApiErrorPayload } from "@/lib/api-errors";
import { DEFAULT_BILLING_REFERENCE_MONTH, getEmployeeBillingPreview } from "@/lib/billing-service";
import { getDefaultDatePeriod } from "@/lib/default-date-range";
import { getEmployeePerformanceSummary } from "@/lib/performance-service";
import {
  canAccessEmployeeMap,
  canAccessPerformance,
  canAccessPerformanceWfh,
  canViewEmployeeProfileBillingPreview,
  canViewEmployeeSensitiveData,
  normalizeRole
} from "@/lib/permissions";
import { logPerformanceMetric } from "@/lib/performance-logger";
import { prisma } from "@/lib/prisma";
import { cleanShiftName } from "@/lib/shift-display";

const profileEmployeeInclude = {
  user: { include: { role: true } },
  lob: true,
  team: true,
  supervisor: true,
  shift: true
} satisfies Prisma.EmployeeProfileInclude;

type ProfileUser = Prisma.UserGetPayload<{ include: { role: true; employeeProfile: true } }>;
type ProfileEmployee = Prisma.EmployeeProfileGetPayload<{ include: typeof profileEmployeeInclude }>;

const scheduledStatuses = new Set<ScheduleStatus>(["ESCALADO", "PRESENTE", "FALTA", "FALTA_JUSTIFICADA", "FALTA_INJUSTIFICADA", "ATRASO", "SAIDA_ANTECIPADA", "TROCA_APROVADA", "VENDA_FOLGA_APROVADA", "FOLGA_APROVADA"]);
const presentStatuses = new Set<ScheduleStatus>(["PRESENTE", "ATRASO", "SAIDA_ANTECIPADA"]);
const absenceStatuses = new Set<ScheduleStatus>(["FALTA", "FALTA_JUSTIFICADA", "FALTA_INJUSTIFICADA"]);

export async function searchEmployeeProfiles(actor: Actor, query: string, limit = 12) {
  const user = await findViewer(actor);
  if (!user) return createPermissionError("Usuário não autenticado.");
  const q = query.trim();
  if (q.length < 2) return { data: [] };

  const canSearchAll = canViewThirdPartyProfiles(user);
  if (!canSearchAll && !user.employeeProfile) return { data: [] };

  const where: Prisma.EmployeeProfileWhereInput = {
    deletedAt: null,
    ...(canSearchAll ? {} : { id: user.employeeProfile?.id }),
    OR: [
      { fullName: { contains: q, mode: "insensitive" } },
      { socialName: { contains: q, mode: "insensitive" } },
      { wbLogin: { contains: q, mode: "insensitive" } },
      { roleTitle: { contains: q, mode: "insensitive" } },
      { skill: { contains: q, mode: "insensitive" } },
      { wave: { contains: q, mode: "insensitive" } },
      { user: { email: { contains: q, mode: "insensitive" } } },
      { lob: { name: { contains: q, mode: "insensitive" } } },
      { supervisor: { fullName: { contains: q, mode: "insensitive" } } }
    ]
  };

  const employees = await prisma.employeeProfile.findMany({
    where,
    select: {
      id: true,
      fullName: true,
      socialName: true,
      wbLogin: true,
      roleTitle: true,
      operationalStatus: true,
      skill: true,
      wave: true,
      user: { select: { email: true } },
      lob: { select: { name: true } },
      supervisor: { select: { fullName: true } }
    },
    orderBy: [{ fullName: "asc" }],
    take: Math.min(20, Math.max(1, limit))
  });

  return {
    data: employees.map((employee) => ({
      type: "employee" as const,
      id: employee.id,
      name: employee.fullName,
      socialName: employee.socialName ?? "",
      wbLogin: employee.wbLogin,
      email: employee.user?.email ?? "",
      jobTitle: employee.roleTitle,
      lob: employee.lob.name,
      supervisor: employee.supervisor?.fullName ?? "Sem supervisor",
      skill: employee.skill ?? "",
      wave: employee.wave ?? "",
      status: displayEmployeeStatus(employee.operationalStatus),
      avatarInitials: initials(employee.fullName)
    }))
  };
}

export async function getEmployeeProfileDashboard(actor: Actor, employeeId?: string) {
  const startedAt = Date.now();
  try {
    const viewer = await findViewer(actor);
    if (!viewer) return createPermissionError("Usuário não autenticado.");

    const targetId = employeeId ?? viewer.employeeProfile?.id;
    if (!targetId) return createNotFoundError("Seu usuário não está vinculado a um cadastro de parceiro. Contate o administrador.");

    const employee = await prisma.employeeProfile.findFirst({
      where: { id: targetId, deletedAt: null },
      include: profileEmployeeInclude
    });
    if (!employee) return createNotFoundError("Parceiro não encontrado.");
    if (!canViewProfile(viewer, employee)) return createPermissionError("Você não tem permissão para visualizar este perfil.");

    const period = currentMonthPeriod();
    const viewerRole = normalizeRole(viewer.role.name);
    const isOwnProfile = viewer.employeeProfile?.id === employee.id;
    const canViewDiversityData = isOwnProfile || canViewEmployeeSensitiveData({ role: viewer.role.name, status: viewer.status });
    const canViewBillingPreview = canViewEmployeeProfileBillingPreview(viewer.employeeProfile?.id, employee.id);
    const [schedule, workHours, requests, equipments, mood, performance, billing, anonymousFeedbacks] = await Promise.all([
      profileSection("schedule", employee.id, buildScheduleSummary(employee.id, period)),
      profileSection("work_hours", employee.id, buildWorkHoursSummary(employee.id, period)),
      profileSection("requests", employee.id, buildRequestsSummary(employee)),
      profileSection("equipment", employee.id, buildEquipmentSummary(employee.id)),
      profileSection("mood", employee.id, buildMoodSummary(employee.id, period)),
      profileSection("performance", employee.id, buildPerformanceSummary(viewer, employee, period)),
      canViewBillingPreview
        ? profileSection("billing_preview", employee.id, getEmployeeBillingPreview(employee.id, DEFAULT_BILLING_REFERENCE_MONTH))
        : Promise.resolve(null),
      isOwnProfile
        ? profileSection("anonymous_feedback", employee.id, buildOwnAnonymousFeedbackSummary(viewer.id))
        : Promise.resolve(null)
    ]);

    const response = {
      data: {
        viewer: {
          role: viewerRole,
          isOwnProfile,
          canViewDiversityData,
          canViewSensitiveData: canViewDiversityData
        },
        employee: mapProfileEmployee(employee, canViewDiversityData),
        schedule,
        workHours,
        performance,
        requests,
        equipments,
        mood,
        billing,
        anonymousFeedbacks,
        updatedAt: formatDateTime(new Date())
      }
    };
    logPerformanceMetric("profile.summary", startedAt, {
      viewerRole,
      isOwnProfile,
      employeeId: employee.id,
      sections: isOwnProfile ? 8 : 6
    });
    return response;
  } catch (error) {
    return createServerError(error, "Não foi possível carregar o perfil do parceiro.");
  }
}

async function profileSection<T>(label: string, employeeId: string, promise: Promise<T>) {
  const startedAt = Date.now();
  try {
    return await promise;
  } finally {
    logPerformanceMetric(`profile.section.${label}`, startedAt, { employeeId });
  }
}

function findViewer(actor: Actor) {
  return prisma.user.findUnique({
    where: { email: actor.email },
    include: { role: true, employeeProfile: true }
  });
}

function canViewProfile(viewer: ProfileUser, employee: ProfileEmployee) {
  if (viewer.status !== "ACTIVE") return false;
  if (viewer.employeeProfile?.id === employee.id || employee.userId === viewer.id) return true;
  return canViewThirdPartyProfiles(viewer);
}

function canViewThirdPartyProfiles(viewer: ProfileUser) {
  return canAccessEmployeeMap({ role: viewer.role.name, status: viewer.status });
}

function mapProfileEmployee(employee: ProfileEmployee, canViewDiversityData: boolean) {
  return {
    id: employee.id,
    name: employee.fullName,
    socialName: employee.socialName ?? "",
    initials: initials(employee.fullName),
    wbLogin: employee.wbLogin,
    email: employee.user?.email ?? "",
    roleTitle: employee.roleTitle,
    lob: employee.lob.name,
    lobId: employee.lobId,
    team: employee.team.name,
    supervisor: employee.supervisor?.fullName ?? "Sem supervisor",
    supervisorId: employee.supervisorId ?? "",
    shift: cleanShiftName(employee.shift.name) || "Sem turno",
    shiftId: employee.shiftId,
    skill: employee.skill ?? "Sem skill",
    wave: employee.wave ?? "Sem wave",
    status: displayEmployeeStatus(employee.operationalStatus),
    statusRaw: employee.operationalStatus,
    userStatus: displayUserStatus(employee.user?.status),
    systemRole: employee.user?.role?.name ?? "",
    admissionDate: formatDate(employee.admissionDate),
    admissionDateIso: formatDateInput(employee.admissionDate),
    terminationDate: employee.terminationDate ? formatDate(employee.terminationDate) : "",
    terminationDateIso: employee.terminationDate ? formatDateInput(employee.terminationDate) : "",
    terminationType: employee.terminationType ?? "",
    terminationReason: employee.terminationReason ?? "",
    contractType: employee.contractType ?? "",
    primaryPhone: employee.primaryPhone ?? "",
    city: employee.city ?? "",
    stateUf: employee.stateUf ?? "",
    workStartTime: employee.workStartTime ?? "",
    workEndTime: employee.workEndTime ?? "",
    nestingStartDate: employee.nestingStartDate ? formatDate(employee.nestingStartDate) : "",
    goLiveDate: employee.goLiveDate ? formatDate(employee.goLiveDate) : "",
    additionalDataCompletedAt: employee.additionalDataCompletedAt ? formatDateTime(employee.additionalDataCompletedAt) : "",
    additionalData: canViewDiversityData
      ? {
        ethnicity: employee.ethnicity ?? "",
        sexualOrientation: employee.sexualOrientation ?? "",
        isPcd: employee.isPcd ?? "",
        pcdDisabilityType: employee.pcdDisabilityType ?? "",
        pcdDisabilityOther: employee.pcdDisabilityOther ?? "",
        firstJob: employee.firstJob ?? "",
        hasTelemarketingExperience: employee.hasTelemarketingExperience ?? "",
        telemarketingWhere: employee.telemarketingWhere ?? "",
        pixKeyType: employee.pixKeyType ?? "",
        pixKey: employee.pixKey ?? ""
      }
      : null
  };
}

async function buildScheduleSummary(employeeId: string, period: Period) {
  const [schedules, nextSchedule] = await Promise.all([
    prisma.schedule.findMany({
      where: { employeeId, deletedAt: null, date: { gte: period.start, lte: period.end } },
      include: { shift: true },
      orderBy: { date: "asc" }
    }),
    prisma.schedule.findFirst({
      where: { employeeId, deletedAt: null, date: { gte: startOfTodayUtc() } },
      include: { shift: true },
      orderBy: { date: "asc" }
    })
  ]);

  return {
    periodLabel: monthLabel(period.start),
    referenceMonth: formatDateInput(period.start).slice(0, 7),
    scheduledDays: schedules.filter((item) => scheduledStatuses.has(item.status)).length,
    presentDays: schedules.filter((item) => presentStatuses.has(item.status)).length,
    absenceDays: schedules.filter((item) => absenceStatuses.has(item.status)).length,
    nextShift: nextSchedule
      ? {
        date: formatDate(nextSchedule.date),
        status: displayScheduleStatus(nextSchedule.status),
        shift: cleanShiftName(nextSchedule.shift?.name) || "Sem turno",
        startsAt: nextSchedule.startsAt ?? nextSchedule.shift?.startsAt ?? "",
        endsAt: nextSchedule.endsAt ?? nextSchedule.shift?.endsAt ?? ""
      }
      : null,
    days: schedules.slice(0, 14).map((item) => ({
      id: item.id,
      date: formatDate(item.date),
      day: String(item.date.getUTCDate()).padStart(2, "0"),
      weekday: shortWeekday(item.date),
      status: displayScheduleStatus(item.status),
      shift: cleanShiftName(item.shift?.name) || "Sem turno"
    }))
  };
}

async function buildWorkHoursSummary(employeeId: string, period: Period) {
  const [records, pendingAdjustments] = await Promise.all([
    prisma.workHourRecord.findMany({
      where: { employeeId, date: { gte: period.start, lte: period.end } },
      select: { plannedHours: true, actualHours: true, effectiveHours: true, differenceMinutes: true, updatedAt: true },
      orderBy: { date: "desc" }
    }),
    prisma.workHourAdjustmentRequest.count({
      where: { employeeId, status: { in: ["ABERTO", "EM_ANALISE"] } }
    })
  ]);

  const plannedHours = records.reduce((sum, item) => sum + Number(item.plannedHours ?? 0), 0);
  const actualHours = records.reduce((sum, item) => sum + Number(item.effectiveHours ?? item.actualHours ?? 0), 0);
  const differenceMinutes = records.reduce((sum, item) => sum + Number(item.differenceMinutes ?? 0), 0);

  return {
    periodLabel: monthLabel(period.start),
    plannedHours: formatDecimalHours(plannedHours),
    actualHours: formatDecimalHours(actualHours),
    difference: formatSignedMinutes(differenceMinutes),
    pendingAdjustments,
    lastRecordAt: records[0]?.updatedAt ? formatDateTime(records[0].updatedAt) : ""
  };
}

async function buildRequestsSummary(employee: ProfileEmployee) {
  const where: Prisma.RequestWhereInput = {
    deletedAt: null,
    OR: [
      { employeeId: employee.id },
      ...(employee.userId ? [{ requesterId: employee.userId }] : [])
    ]
  };
  const [open, inAnalysis, recent] = await Promise.all([
    prisma.request.count({ where: { ...where, status: "ABERTO" } }),
    prisma.request.count({ where: { ...where, status: { in: ["EM_ANALISE", "AGUARDANDO_APROVACAO"] } } }),
    prisma.request.findMany({
      where,
      include: { type: true },
      orderBy: { createdAt: "desc" },
      take: 5
    })
  ]);

  return {
    open,
    inAnalysis,
    recent: recent.map((item) => ({
      id: item.id,
      code: item.code,
      title: item.title,
      type: item.type.name,
      status: displayRequestStatus(item.status),
      createdAt: formatDate(item.createdAt)
    }))
  };
}

async function buildEquipmentSummary(employeeId: string) {
  const equipments = await prisma.equipment.findMany({
    where: { employeeId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 5
  });
  return {
    total: equipments.length,
    items: equipments.map((item) => ({
      id: item.id,
      type: item.type,
      model: item.model ?? "",
      serial: item.serial ?? "",
      status: displayEquipmentStatus(item.status),
      deliveredAt: item.deliveredAt ? formatDate(item.deliveredAt) : ""
    }))
  };
}

async function buildMoodSummary(employeeId: string, period: Period) {
  const [summary, last] = await Promise.all([
    prisma.employeeMoodRecord.aggregate({
      where: { employeeId, date: { gte: period.start, lte: period.end } },
      _avg: { moodScore: true },
      _count: { id: true }
    }),
    prisma.employeeMoodRecord.findFirst({
      where: { employeeId, date: { gte: period.start, lte: period.end } },
      orderBy: { date: "desc" }
    })
  ]);
  const average = summary._avg.moodScore ? Number(summary._avg.moodScore.toFixed(1)) : 0;
  return {
    average,
    responses: summary._count.id,
    label: moodLabel(average),
    lastResponseAt: last ? formatDate(last.date) : "",
    lastLabel: last?.moodLabel ?? ""
  };
}

async function buildOwnAnonymousFeedbackSummary(userId: string) {
  const where: Prisma.AnonymousFeedbackWhereInput = {
    OR: [
      { submitterUserId: userId },
      { submitterUserId: null, allowContact: true, contactUserId: userId }
    ]
  };
  const [total, answered, items] = await Promise.all([
    prisma.anonymousFeedback.count({ where }),
    prisma.anonymousFeedback.count({ where: { ...where, adminResponse: { not: null } } }),
    prisma.anonymousFeedback.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        category: true,
        urgency: true,
        message: true,
        status: true,
        allowContact: true,
        adminResponse: true,
        respondedAt: true,
        createdAt: true
      }
    })
  ]);

  return {
    total,
    answered,
    waiting: Math.max(0, total - answered),
    items: items.map((item) => ({
      id: item.id,
      category: item.category,
      urgency: displayAnonymousFeedbackUrgency(item.urgency),
      comment: item.message,
      status: displayAnonymousFeedbackStatus(item.status),
      identified: item.allowContact,
      response: item.adminResponse ?? "",
      respondedAt: item.respondedAt ? formatDateTime(item.respondedAt) : "",
      respondedBy: item.adminResponse ? "East River" : "",
      createdAt: formatDateTime(item.createdAt)
    }))
  };
}

async function buildPerformanceSummary(viewer: ProfileUser, employee: ProfileEmployee, period: Period) {
  try {
    const isOwnProfile = viewer.employeeProfile?.id === employee.id;
    const permissionUser = {
      role: viewer.role.name,
      status: viewer.status,
      roleTitle: viewer.employeeProfile?.roleTitle
    };
    const canViewPerformance = isOwnProfile
      ? canAccessPerformance(permissionUser)
      : canAccessPerformanceWfh(permissionUser);
    if (!canViewPerformance) return null;

    const employeeSummary = await getEmployeePerformanceSummary(employee.id, period);
    let summary = employeeSummary ? mapPerformanceRow(employeeSummary) : null;

    if (employee.lob.name.trim().toUpperCase() !== "CEC") return summary;

    const cpdWhere: Prisma.PerformanceCecCpdRecordWhereInput = {
      performanceDay: { gte: period.start, lte: period.end },
      OR: [
        { employeeId: employee.id },
        { wbLogin: { equals: employee.wbLogin, mode: "insensitive" } }
      ]
    };
    const [cpdTotal, activeDays] = await Promise.all([
      prisma.performanceCecCpdRecord.aggregate({
        where: cpdWhere,
        _sum: { ticketCount: true }
      }),
      prisma.performanceCecCpdRecord.groupBy({
        by: ["performanceDay"],
        where: { ...cpdWhere, ticketCount: { gt: 0 } },
        _sum: { ticketCount: true }
      })
    ]);
    const outputTotal = cpdTotal._sum.ticketCount ?? 0;
    if (outputTotal <= 0 && !summary) return null;

    return {
      ...(summary ?? emptyPerformanceRow()),
      submit: activeDays.length > 0 ? outputTotal / activeDays.length : 0,
      outputTotal,
      outputLabel: "CPD médio",
      ahtAvailable: false
    };
  } catch {
    return null;
  }
}

function mapPerformanceRow(row: {
  quality: number;
  submit: number;
  ahtSeconds: number;
  abs: number;
  wfhStatusLabel?: string;
  wfhStatus?: string;
  qualityRule?: string;
}) {
  return {
    quality: row.quality,
    submit: row.submit,
    outputTotal: null as number | null,
    outputLabel: "Submit/dia",
    ahtSeconds: row.ahtSeconds,
    ahtAvailable: true,
    abs: row.abs,
    wfhStatus: row.wfhStatus ?? "",
    wfhStatusLabel: row.wfhStatusLabel ?? "",
    qualityRule: row.qualityRule ?? ""
  };
}

function emptyPerformanceRow(): ReturnType<typeof mapPerformanceRow> {
  return mapPerformanceRow({ quality: 0, submit: 0, ahtSeconds: 0, abs: 0 });
}

type Period = {
  start: Date;
  end: Date;
};

function currentMonthPeriod(): Period {
  const period = getDefaultDatePeriod();
  return { start: period.start, end: period.end };
}

function startOfTodayUtc() {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(date);
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function monthLabel(date: Date) {
  const label = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function shortWeekday(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short" }).format(date).replace(".", "");
}

function formatDecimalHours(value: number) {
  const minutes = Math.max(0, Math.round(value * 60));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

function formatSignedMinutes(value: number) {
  const sign = value < 0 ? "-" : value > 0 ? "+" : "";
  const absolute = Math.abs(Math.round(value));
  return `${sign}${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, "0")}`;
}

function displayEmployeeStatus(value?: string | null) {
  return value?.trim() || "Não informado";
}

function displayUserStatus(value?: UserStatus | null) {
  const labels: Record<UserStatus, string> = {
    ACTIVE: "Ativo",
    BLOCKED: "Bloqueado",
    INACTIVE: "Inativo"
  };
  return value ? labels[value] : "Sem usuário";
}

function displayScheduleStatus(value: ScheduleStatus) {
  const labels: Record<ScheduleStatus, string> = {
    ESCALADO: "Escalado",
    PRESENTE: "Presente",
    AUSENTE: "Ausente",
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
    SEM_ESCALA: "Sem cronograma",
    ERRO_ESCALA: "Erro de cronograma",
    FERIADO: "Feriado",
    CONFLITO: "Conflito",
    DESCOBERTO: "Descoberto",
    DESLIGADO: "Desligado"
  };
  return labels[value] ?? value;
}

function displayRequestStatus(value: RequestStatus) {
  const labels: Record<RequestStatus, string> = {
    ABERTO: "Aberto",
    EM_ANALISE: "Em análise",
    AGUARDANDO_APROVACAO: "Aguardando aprovação",
    APROVADO: "Aprovado",
    RECUSADO: "Recusado",
    AJUSTE_SOLICITADO: "Ajuste solicitado",
    CONCLUIDO: "Concluído",
    CANCELADO: "Cancelado"
  };
  return labels[value] ?? value;
}

function displayEquipmentStatus(value: EquipmentStatus) {
  const labels: Record<EquipmentStatus, string> = {
    DISPONIVEL: "Disponível",
    ENTREGUE: "Entregue",
    FUNCIONANDO: "Funcionando",
    EM_ATENCAO: "Em atenção",
    EM_MANUTENCAO: "Em manutenção",
    INOPERANTE: "Inoperante",
    DEVOLVIDO: "Devolvido",
    PERDIDO: "Perdido",
    BLOQUEADO: "Bloqueado",
    SUBSTITUIDO: "Substituído"
  };
  return labels[value] ?? value;
}

function displayAnonymousFeedbackStatus(value: string) {
  const labels: Record<string, string> = {
    RECEBIDO: "Novo",
    EM_ANALISE: "Em análise",
    PLANO_DE_ACAO: "Em análise",
    CONCLUIDO: "Resolvido",
    ARQUIVADO: "Arquivado"
  };
  return labels[value] ?? value;
}

function displayAnonymousFeedbackUrgency(value: string) {
  const labels: Record<string, string> = {
    BAIXA: "Baixa",
    MEDIA: "Média",
    ALTA: "Alta",
    CRITICA: "Crítica"
  };
  return labels[value] ?? value;
}

function moodLabel(value: number) {
  if (!value) return "Sem respostas";
  if (value <= 2) return "Crítico";
  if (value <= 3) return "Atenção";
  if (value <= 4) return "Estável";
  return "Positivo";
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "U";
}

export function isApiProfileError(result: unknown): result is ApiErrorPayload {
  return Boolean(result && typeof result === "object" && "error" in result);
}
