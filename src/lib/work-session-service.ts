import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { AuditAction, Prisma, UserStatus } from "@prisma/client";

import type { Actor } from "@/lib/mock-db";
import { createPermissionError } from "@/lib/api-errors";
import { canAccessWorkSessionMonitoring, canExportWorkSessionMonitoring } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { XlsxExportPayload } from "@/lib/xlsx-export";

const sessionEventTypes = ["LOGIN", "UNLOCK", "HEARTBEAT", "LOCK", "LOGOUT", "SHUTDOWN", "SLEEP", "WAKE"] as const;
const activeStartEvents = new Set(["LOGIN", "UNLOCK", "WAKE", "HEARTBEAT"]);
const activeStopEvents = new Set(["LOCK", "LOGOUT", "SHUTDOWN", "SLEEP"]);
const heartbeatTimeoutMinutes = 5;

type SessionEventType = (typeof sessionEventTypes)[number];

type AuthenticatedUser = Prisma.UserGetPayload<{
  include: {
    role: true;
    employeeProfile: true;
  };
}>;

export type WorkSessionQuery = {
  date?: string;
  startDate?: string;
  endDate?: string;
  lob?: string;
  supervisor?: string;
  roleTitle?: string;
  skill?: string;
  status?: string;
  collaborator?: string;
  wbLogin?: string;
  employeeId?: string;
  page?: string | number;
  limit?: string | number;
};

export type WorkSessionEventInput = {
  deviceId?: string;
  deviceToken?: string;
  wbLogin?: string;
  employeeId?: string;
  eventType?: string;
  eventTimestamp?: string;
  timezone?: string;
  hostname?: string;
  os?: string;
  agentVersion?: string;
};

export type WorkSessionDeviceEnrollmentInput = {
  enrollmentKey?: string;
  wbLogin?: string;
  hostname?: string;
  deviceFingerprint?: string;
  os?: string;
  agentVersion?: string;
};

export async function enrollWorkSessionDevice(input: WorkSessionDeviceEnrollmentInput) {
  const expectedKey = process.env.WORK_SESSION_AGENT_ENROLLMENT_KEY?.trim();
  if (!expectedKey) {
    await logWorkSessionError("WORK_SESSION_ENROLLMENT_NOT_CONFIGURED", "Matrícula do Agent não configurada no servidor.", { wbLogin: input.wbLogin, hostname: input.hostname });
    return { success: false, error: "Matrícula do Agent não configurada no servidor.", message: "Matrícula do Agent não configurada no servidor.", status: 503 };
  }
  if (!input.enrollmentKey || !safeEqualString(input.enrollmentKey, expectedKey)) {
    await logWorkSessionError("WORK_SESSION_ENROLLMENT_KEY_INVALID", "Chave de matrícula do Agent inválida.", { wbLogin: input.wbLogin, hostname: input.hostname });
    return { success: false, error: "Chave de matrícula do Agent inválida.", message: "Chave de matrícula do Agent inválida.", status: 403 };
  }

  const wbLogin = normalizeWbLogin(input.wbLogin);
  if (!wbLogin) return { success: false, error: "WB/Login é obrigatório.", message: "WB/Login é obrigatório.", status: 400 };

  const employee = await prisma.employeeProfile.findFirst({
    where: { deletedAt: null, wbLogin: { equals: wbLogin, mode: "insensitive" } },
    include: { user: true }
  });
  if (!employee || employee.user?.status !== UserStatus.ACTIVE || employee.user.deletedAt) {
    await logWorkSessionError("WORK_SESSION_ENROLLMENT_EMPLOYEE_NOT_FOUND", "WB/Login não encontrado ou sem usuário ativo.", { wbLogin, hostname: input.hostname });
    return { success: false, error: "WB/Login não encontrado ou sem usuário ativo.", message: "WB/Login não encontrado ou sem usuário ativo.", status: 404 };
  }

  const fingerprint = String(input.deviceFingerprint ?? "").trim();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = deviceTokenHash(token);
  const existingDevice = fingerprint
    ? await prisma.workSessionDevice.findFirst({
      where: { employeeId: employee.id, deviceFingerprint: fingerprint, revokedAt: null },
      orderBy: { updatedAt: "desc" }
    })
    : null;

  const device = existingDevice
    ? await prisma.workSessionDevice.update({
      where: { id: existingDevice.id },
      data: {
        wbLogin: employee.wbLogin,
        hostname: input.hostname || existingDevice.hostname,
        agentVersion: input.agentVersion || existingDevice.agentVersion,
        deviceTokenHash: tokenHash,
        status: "ACTIVE",
        lastSeenAt: new Date()
      }
    })
    : await prisma.workSessionDevice.create({
      data: {
        employeeId: employee.id,
        wbLogin: employee.wbLogin,
        hostname: input.hostname || null,
        deviceFingerprint: fingerprint || null,
        deviceTokenHash: tokenHash,
        agentVersion: input.agentVersion || null,
        status: "ACTIVE",
        lastSeenAt: new Date()
      }
    });

  await prisma.auditLog.create({
    data: {
      action: existingDevice ? AuditAction.EDICAO : AuditAction.CRIACAO,
      entity: "WorkSessionDevice",
      entityId: device.id,
      reason: existingDevice ? "Rematrícula de dispositivo do Agent" : "Matrícula de dispositivo do Agent",
      newValue: {
        employeeId: employee.id,
        wbLogin: employee.wbLogin,
        hostname: input.hostname ?? null,
        agentVersion: input.agentVersion ?? null
      }
    }
  }).catch(() => undefined);

  return {
    success: true,
    deviceId: device.id,
    deviceToken: token,
    employeeId: employee.id,
    wbLogin: employee.wbLogin,
    hostname: device.hostname ?? "",
    agentVersion: device.agentVersion ?? ""
  };
}

export async function registerWorkSessionEvent(input: WorkSessionEventInput) {
  const validation = validateEventInput(input);
  if (validation) {
    await logWorkSessionError("WORK_SESSION_EVENT_VALIDATION", validation, input);
    return { success: false, error: validation, message: validation, status: 400 };
  }

  const eventType = input.eventType as SessionEventType;
  const eventTimestamp = new Date(String(input.eventTimestamp));
  const wbLogin = normalizeWbLogin(input.wbLogin);
  const employee = await prisma.employeeProfile.findFirst({
    where: {
      deletedAt: null,
      ...(input.employeeId ? { id: input.employeeId } : { wbLogin: { equals: wbLogin, mode: "insensitive" } })
    },
    include: { user: true }
  });
  if (!employee || employee.user?.status !== UserStatus.ACTIVE || employee.user.deletedAt) {
    await logWorkSessionError("WORK_SESSION_EMPLOYEE_NOT_FOUND", "WB/Login não encontrado ou sem usuário ativo.", input);
    return { success: false, error: "WB/Login não encontrado ou sem usuário ativo.", message: "WB/Login não encontrado ou sem usuário ativo.", status: 404 };
  }

  const device = await prisma.workSessionDevice.findUnique({ where: { id: String(input.deviceId) } });
  if (!device || device.employeeId !== employee.id || device.revokedAt || device.status !== "ACTIVE") {
    await logWorkSessionError("WORK_SESSION_DEVICE_INVALID", "Dispositivo inválido ou revogado.", input);
    return { success: false, error: "Dispositivo inválido ou revogado.", message: "Dispositivo inválido ou revogado.", status: 403 };
  }
  if (!device.deviceTokenHash || !verifyDeviceToken(String(input.deviceToken), device.deviceTokenHash)) {
    await logWorkSessionError("WORK_SESSION_TOKEN_INVALID", "Token do dispositivo inválido.", { deviceId: input.deviceId, wbLogin });
    return { success: false, error: "Token do dispositivo inválido.", message: "Token do dispositivo inválido.", status: 403 };
  }

  const event = await prisma.$transaction(async (tx) => {
    const saved = await tx.workSessionEvent.create({
      data: {
        employeeId: employee.id,
        deviceId: device.id,
        eventType,
        eventTimestamp,
        timezone: input.timezone || null,
        source: "agent",
        metadata: {
          hostname: input.hostname ?? null,
          os: input.os ?? null,
          agentVersion: input.agentVersion ?? null
        }
      }
    });
    await tx.workSessionDevice.update({
      where: { id: device.id },
      data: {
        wbLogin: employee.wbLogin,
        hostname: input.hostname || device.hostname,
        agentVersion: input.agentVersion || device.agentVersion,
        lastSeenAt: eventTimestamp
      }
    });
    return saved;
  });

  await recomputeDailySummary(employee.id, dateForEvent(eventTimestamp, input.timezone), input.timezone);

  return {
    success: true,
    eventId: event.id,
    employeeId: employee.id,
    wbLogin: employee.wbLogin,
    eventType,
    eventTimestamp: eventTimestamp.toISOString()
  };
}

export async function listCurrentWorkSessions(actor: Actor, query: WorkSessionQuery = {}) {
  const user = await requireWorkSessionUser(actor);
  if ("error" in user) return user;

  const date = parseDate(query.date) ?? todayUtc();
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(200, Math.max(10, Number(query.limit) || 100));
  const employees = await listVisibleEmployees(user, query);
  const employeeIds = employees.map((employee) => employee.id);
  const [summaries, devices] = await Promise.all([
    employeeIds.length ? prisma.workSessionDailySummary.findMany({ where: { employeeId: { in: employeeIds }, date } }) : [],
    employeeIds.length ? prisma.workSessionDevice.findMany({ where: { employeeId: { in: employeeIds }, revokedAt: null }, orderBy: { lastSeenAt: "desc" } }) : []
  ]);
  const summaryByEmployee = new Map(summaries.map((summary) => [summary.employeeId, summary]));
  const deviceByEmployee = new Map<string, (typeof devices)[number]>();
  for (const device of devices) {
    if (!deviceByEmployee.has(device.employeeId)) deviceByEmployee.set(device.employeeId, device);
  }

  let rows = employees.map((employee) => {
    const summary = summaryByEmployee.get(employee.id);
    const device = deviceByEmployee.get(employee.id);
    const currentStatus = resolveDisplayStatus(summary?.currentStatus, summary?.lastEventAt);
    return {
      employeeId: employee.id,
      employeeName: employee.fullName,
      wbLogin: employee.wbLogin,
      lob: employee.lob?.name ?? "Sem LOB",
      supervisor: employee.supervisor?.fullName ?? "Sem supervisor",
      roleTitle: employee.roleTitle,
      skill: employee.skill ?? "",
      currentStatus,
      firstLoginAt: formatDateTime(summary?.firstLoginAt),
      lastLogoutAt: formatDateTime(summary?.lastLogoutAt),
      lastEventAt: formatDateTime(summary?.lastEventAt),
      lastSyncAt: formatDateTime(device?.lastSeenAt ?? summary?.lastEventAt),
      activeMinutes: summary?.activeMinutes ?? 0,
      inactiveMinutes: summary?.inactiveMinutes ?? 0,
      activeTime: formatMinutes(summary?.activeMinutes ?? 0),
      inactiveTime: formatMinutes(summary?.inactiveMinutes ?? 0),
      deviceId: device?.id ?? "",
      device: device?.hostname ?? "Sem dispositivo",
      agentVersion: device?.agentVersion ?? "",
      lastEventType: summary?.lastEventAt ? summary.currentStatus : ""
    };
  });

  if (query.status && query.status !== "Todos") rows = rows.filter((row) => row.currentStatus === query.status);
  const total = rows.length;
  const data = rows.slice((page - 1) * limit, page * limit);
  const summary = buildCurrentSummary(rows);
  const filters = await workSessionFilterOptions(user);

  return {
    success: true,
    date: formatDateKey(date),
    summary,
    filters,
    data,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    note: "Dados capturados para monitoramento. Ainda não substituem Horas Operacionais oficiais.",
    privacy: "Este monitoramento considera apenas eventos de sessão e disponibilidade da estação. Não há captura de tela, teclado, mouse, sites ou aplicativos."
  };
}

export async function listWorkSessionDailySummary(actor: Actor, query: WorkSessionQuery = {}) {
  const user = await requireWorkSessionUser(actor);
  if ("error" in user) return user;
  const period = resolvePeriod(query);
  const employees = await listVisibleEmployees(user, query);
  const employeeIds = employees.map((employee) => employee.id);
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const summaries = employeeIds.length
    ? await prisma.workSessionDailySummary.findMany({
      where: { employeeId: { in: employeeIds }, date: { gte: period.startDate, lte: period.endDate } },
      orderBy: [{ date: "desc" }, { employee: { fullName: "asc" } }]
    })
    : [];
  const data = summaries.map((summary) => {
    const employee = employeeById.get(summary.employeeId);
    return {
      date: formatDateKey(summary.date),
      employeeId: summary.employeeId,
      employeeName: employee?.fullName ?? "-",
      wbLogin: employee?.wbLogin ?? "-",
      lob: employee?.lob?.name ?? "Sem LOB",
      supervisor: employee?.supervisor?.fullName ?? "Sem supervisor",
      activeMinutes: summary.activeMinutes,
      inactiveMinutes: summary.inactiveMinutes,
      activeTime: formatMinutes(summary.activeMinutes),
      inactiveTime: formatMinutes(summary.inactiveMinutes),
      firstLoginAt: formatDateTime(summary.firstLoginAt),
      lastLogoutAt: formatDateTime(summary.lastLogoutAt),
      lastEventAt: formatDateTime(summary.lastEventAt),
      currentStatus: resolveDisplayStatus(summary.currentStatus, summary.lastEventAt)
    };
  });
  return { success: true, period: { startDate: formatDateKey(period.startDate), endDate: formatDateKey(period.endDate) }, data };
}

export async function getWorkSessionEvents(actor: Actor, query: WorkSessionQuery = {}) {
  const user = await requireWorkSessionUser(actor);
  if ("error" in user) return user;
  if (!query.employeeId) return { success: false, error: "Informe o colaborador.", message: "Informe o colaborador.", status: 400 };

  const date = parseDate(query.date) ?? todayUtc();
  const [employee] = await listVisibleEmployees(user, { employeeId: query.employeeId });
  if (!employee) return { success: false, error: "Colaborador não encontrado ou fora da sua visão.", message: "Colaborador não encontrado ou fora da sua visão.", status: 404 };
  const events = await prisma.workSessionEvent.findMany({
    where: { employeeId: employee.id, eventTimestamp: { gte: date, lt: addDays(date, 1) } },
    include: { device: true },
    orderBy: { eventTimestamp: "asc" }
  });
  const summary = await prisma.workSessionDailySummary.findUnique({ where: { employeeId_date: { employeeId: employee.id, date } } });
  return {
    success: true,
    employee: {
      id: employee.id,
      name: employee.fullName,
      wbLogin: employee.wbLogin,
      lob: employee.lob?.name ?? "Sem LOB",
      supervisor: employee.supervisor?.fullName ?? "Sem supervisor"
    },
    summary: summary ? {
      currentStatus: resolveDisplayStatus(summary.currentStatus, summary.lastEventAt),
      activeTime: formatMinutes(summary.activeMinutes),
      inactiveTime: formatMinutes(summary.inactiveMinutes),
      firstLoginAt: formatDateTime(summary.firstLoginAt),
      lastLogoutAt: formatDateTime(summary.lastLogoutAt),
      lastEventAt: formatDateTime(summary.lastEventAt)
    } : null,
    events: events.map((event) => ({
      id: event.id,
      time: formatDateTime(event.eventTimestamp),
      eventType: event.eventType,
      resultingStatus: statusFromEvent(event.eventType, event.eventTimestamp),
      device: event.device.hostname ?? "Sem dispositivo",
      agentVersion: event.device.agentVersion ?? ""
    }))
  };
}

export async function exportWorkSessionXlsxData(actor: Actor, query: WorkSessionQuery = {}): Promise<XlsxExportPayload | ReturnType<typeof createPermissionError>> {
  const user = await requireWorkSessionUser(actor);
  if ("error" in user) return user;
  if (!canExportWorkSessionMonitoring(permissionUser(user))) return createPermissionError("Você não tem permissão para exportar Monitoramento de Jornada.");

  const result = await listCurrentWorkSessions(actor, query);
  if ("error" in result) return result as ReturnType<typeof createPermissionError>;

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: AuditAction.UPLOAD,
      entity: "WorkSessionDailySummary",
      entityId: `work-session-export-${Date.now()}`,
      reason: "Exportação XLSX de Monitoramento de Jornada",
      newValue: { filters: query, rows: result.data.length }
    }
  }).catch(() => undefined);

  return {
    fileName: `monitoramento_jornada_${result.date}.xlsx`,
    sheetName: "monitoramento_jornada",
    headers: ["data", "colaborador", "wb_login", "lob", "supervisor", "cargo_funcao", "status_atual", "primeiro_login", "ultimo_logout", "ultimo_evento", "tempo_ativo", "tempo_inativo", "dispositivo", "agent_version"],
    rows: result.data.map((row) => [
      result.date,
      row.employeeName,
      row.wbLogin,
      row.lob,
      row.supervisor,
      row.roleTitle,
      row.currentStatus,
      row.firstLoginAt,
      row.lastLogoutAt,
      row.lastEventAt,
      row.activeTime,
      row.inactiveTime,
      row.device,
      row.agentVersion
    ])
  };
}

async function recomputeDailySummary(employeeId: string, date: Date, timezone?: string | null) {
  const events = await prisma.workSessionEvent.findMany({
    where: { employeeId, eventTimestamp: { gte: date, lt: addDays(date, 1) } },
    orderBy: { eventTimestamp: "asc" }
  });
  const metrics = calculateDailyMetrics(events, date);
  await prisma.workSessionDailySummary.upsert({
    where: { employeeId_date: { employeeId, date } },
    update: metrics,
    create: { employeeId, date, ...metrics }
  });
}

function calculateDailyMetrics(events: Array<{ eventType: string; eventTimestamp: Date }>, date: Date) {
  let activeStart: Date | null = null;
  let previous: Date | null = null;
  let activeMs = 0;
  let firstLoginAt: Date | null = null;
  let lastLogoutAt: Date | null = null;

  for (const event of events) {
    const timestamp = event.eventTimestamp;
    if (activeStart && previous && timestamp.getTime() - previous.getTime() > heartbeatTimeoutMinutes * 60_000) {
      activeMs += Math.max(0, previous.getTime() + heartbeatTimeoutMinutes * 60_000 - activeStart.getTime());
      activeStart = null;
    }
    if (activeStartEvents.has(event.eventType)) {
      if (!activeStart) activeStart = timestamp;
      if (!firstLoginAt && event.eventType === "LOGIN") firstLoginAt = timestamp;
    }
    if (activeStopEvents.has(event.eventType)) {
      if (activeStart) {
        activeMs += Math.max(0, timestamp.getTime() - activeStart.getTime());
        activeStart = null;
      }
      if (["LOGOUT", "SHUTDOWN"].includes(event.eventType)) lastLogoutAt = timestamp;
    }
    previous = timestamp;
  }

  if (activeStart && previous) {
    const endOfActive = new Date(Math.min(Date.now(), addDays(date, 1).getTime(), previous.getTime() + heartbeatTimeoutMinutes * 60_000));
    activeMs += Math.max(0, endOfActive.getTime() - activeStart.getTime());
  }

  const lastEvent = events.at(-1);
  const fallbackFirst = events.find((event) => activeStartEvents.has(event.eventType))?.eventTimestamp ?? null;
  const first = firstLoginAt ?? fallbackFirst;
  const lastEventAt = lastEvent?.eventTimestamp ?? null;
  const elapsedMs = first && lastEventAt ? Math.max(0, lastEventAt.getTime() - first.getTime()) : 0;
  const activeMinutes = Math.round(activeMs / 60_000);
  const inactiveMinutes = Math.max(0, Math.round(elapsedMs / 60_000) - activeMinutes);

  return {
    activeMinutes,
    inactiveMinutes,
    firstLoginAt: firstLoginAt ?? fallbackFirst,
    lastLogoutAt,
    lastEventAt,
    currentStatus: lastEvent ? statusFromEvent(lastEvent.eventType, lastEvent.eventTimestamp) : "Desconhecido"
  };
}

async function requireWorkSessionUser(actor: Actor) {
  const user = await prisma.user.findUnique({ where: { email: actor.email }, include: { role: true, employeeProfile: true } });
  if (!user || user.status !== UserStatus.ACTIVE || user.deletedAt) return createPermissionError("Usuário sem acesso ativo.");
  if (!canAccessWorkSessionMonitoring(permissionUser(user))) return createPermissionError("Você não tem permissão para acessar Monitoramento de Jornada.");
  return user;
}

function permissionUser(user: AuthenticatedUser) {
  return {
    role: user.role.name,
    email: user.email,
    name: user.name,
    status: user.status,
    roleTitle: user.employeeProfile?.roleTitle
  };
}

async function listVisibleEmployees(user: AuthenticatedUser, query: WorkSessionQuery) {
  const where: Prisma.EmployeeProfileWhereInput = {
    deletedAt: null,
    userId: { not: null },
    user: { status: UserStatus.ACTIVE, deletedAt: null }
  };
  if (query.lob && query.lob !== "Todos") where.lob = { name: { equals: query.lob, mode: "insensitive" } };
  if (query.supervisor && query.supervisor !== "Todos") where.supervisorId = query.supervisor === "SEM_SUPERVISOR" ? null : query.supervisor;
  if (query.roleTitle && query.roleTitle !== "Todos") where.roleTitle = { equals: query.roleTitle, mode: "insensitive" };
  if (query.skill && query.skill !== "Todos") where.skill = query.skill === "SEM_SKILL" ? null : { equals: query.skill, mode: "insensitive" };
  if (query.employeeId && query.employeeId !== "Todos") where.id = query.employeeId;
  if (query.wbLogin) where.wbLogin = { contains: query.wbLogin, mode: "insensitive" };
  if (query.collaborator) {
    const search = query.collaborator;
    where.OR = [
      { fullName: { contains: search, mode: "insensitive" } },
      { wbLogin: { contains: search, mode: "insensitive" } },
      { user: { email: { contains: search, mode: "insensitive" } } }
    ];
  }
  return prisma.employeeProfile.findMany({
    where,
    include: { user: true, lob: true, supervisor: true },
    orderBy: { fullName: "asc" }
  });
}

async function workSessionFilterOptions(_user: AuthenticatedUser) {
  const employees = await prisma.employeeProfile.findMany({
    where: {
      deletedAt: null,
      userId: { not: null },
      user: { status: UserStatus.ACTIVE, deletedAt: null }
    },
    include: { lob: true, supervisor: true },
    orderBy: { fullName: "asc" }
  });
  const supervisors = new Map<string, string>();
  for (const employee of employees) {
    if (employee.supervisorId && employee.supervisor?.fullName) supervisors.set(employee.supervisorId, employee.supervisor.fullName);
  }
  return {
    lobs: ["Todos", ...unique(employees.map((employee) => employee.lob?.name).filter(Boolean) as string[])],
    supervisors: [
      { id: "Todos", name: "Todos os supervisores" },
      { id: "SEM_SUPERVISOR", name: "Sem supervisor" },
      ...Array.from(supervisors.entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => ({ id, name }))
    ],
    roles: ["Todos", ...unique(employees.map((employee) => employee.roleTitle).filter(Boolean) as string[])],
    skills: ["Todos", "SEM_SKILL", ...unique(employees.map((employee) => employee.skill).filter(Boolean) as string[])],
    statuses: ["Todos", "Ativo", "Bloqueado", "Offline", "Suspenso", "Desconhecido"],
    employees: [
      { id: "Todos", name: "Todos os colaboradores", wbLogin: "" },
      ...employees.map((employee) => ({ id: employee.id, name: employee.fullName, wbLogin: employee.wbLogin }))
    ]
  };
}

function buildCurrentSummary(rows: Array<{ currentStatus: string; activeMinutes: number; lastEventAt: string }>) {
  const count = (status: string) => rows.filter((row) => row.currentStatus === status).length;
  const syncedRows = rows.filter((row) => row.lastEventAt);
  return {
    activeNow: count("Ativo"),
    locked: count("Bloqueado"),
    offline: count("Offline"),
    suspended: count("Suspenso"),
    unknown: count("Desconhecido"),
    totalActiveMinutes: rows.reduce((sum, row) => sum + row.activeMinutes, 0),
    totalActiveTime: formatMinutes(rows.reduce((sum, row) => sum + row.activeMinutes, 0)),
    averageLastSync: syncedRows.length ? `${syncedRows.length} colaborador(es) com sincronização` : "Sem sincronização"
  };
}

function validateEventInput(input: WorkSessionEventInput) {
  if (!input.deviceId) return "deviceId é obrigatório.";
  if (!input.deviceToken) return "deviceToken é obrigatório.";
  if (!input.employeeId && !normalizeWbLogin(input.wbLogin)) return "employeeId ou wbLogin é obrigatório.";
  if (!sessionEventTypes.includes(input.eventType as SessionEventType)) return "eventType inválido.";
  const date = new Date(String(input.eventTimestamp));
  if (!input.eventTimestamp || Number.isNaN(date.getTime())) return "eventTimestamp inválido.";
  return "";
}

function verifyDeviceToken(token: string, expectedHash: string) {
  const actual = deviceTokenHash(token);
  const expected = expectedHash.trim();
  if (!/^[a-f0-9]{64}$/i.test(expected)) return false;
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function safeEqualString(actual: string, expected: string) {
  const actualHash = deviceTokenHash(actual);
  const expectedHash = deviceTokenHash(expected);
  return timingSafeEqual(Buffer.from(actualHash, "hex"), Buffer.from(expectedHash, "hex"));
}

export function deviceTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function statusFromEvent(eventType: string, eventTimestamp?: Date | null) {
  if (["LOGIN", "UNLOCK", "WAKE", "HEARTBEAT"].includes(eventType)) {
    return eventTimestamp && Date.now() - eventTimestamp.getTime() > heartbeatTimeoutMinutes * 60_000 ? "Offline" : "Ativo";
  }
  if (eventType === "LOCK") return "Bloqueado";
  if (eventType === "SLEEP") return "Suspenso";
  if (["LOGOUT", "SHUTDOWN"].includes(eventType)) return "Offline";
  return "Desconhecido";
}

function resolveDisplayStatus(status?: string | null, lastEventAt?: Date | null) {
  if (!status) return "Desconhecido";
  if (status === "Ativo" && lastEventAt && Date.now() - lastEventAt.getTime() > heartbeatTimeoutMinutes * 60_000) return "Offline";
  return status;
}

function resolvePeriod(query: WorkSessionQuery) {
  const startDate = parseDate(query.startDate) ?? parseDate(query.date) ?? todayUtc();
  const endDate = parseDate(query.endDate) ?? parseDate(query.date) ?? startDate;
  return { startDate, endDate };
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dateForEvent(value: Date, timezone?: string | null) {
  return parseDate(formatDateKeyInTimezone(value, timezone)) ?? todayUtc();
}

function formatDateKeyInTimezone(value: Date, timezone?: string | null) {
  if (!timezone) return formatDateKey(value);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    return year && month && day ? `${year}-${month}-${day}` : formatDateKey(value);
  } catch {
    return formatDateKey(value);
  }
}

function todayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(date: Date, days: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDateTime(date?: Date | null) {
  if (!date) return "";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatMinutes(minutes: number) {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}

function normalizeWbLogin(value?: string | null) {
  return String(value ?? "").trim().toLowerCase();
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

async function logWorkSessionError(code: string, message: string, input: unknown) {
  await prisma.errorLog.create({
    data: {
      code,
      message,
      action: "WORK_SESSION_EVENT",
      severity: "WARNING",
      metadata: sanitizeEventLogInput(input)
    }
  }).catch(() => undefined);
}

function sanitizeEventLogInput(input: unknown): Prisma.InputJsonObject {
  if (!input || typeof input !== "object") return {};
  const clone: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (key === "deviceToken" || typeof value === "undefined") continue;
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      clone[key] = value as string | number | boolean | null;
    } else if (value instanceof Date) {
      clone[key] = value.toISOString();
    } else {
      clone[key] = String(value);
    }
  }
  return clone as Prisma.InputJsonObject;
}
