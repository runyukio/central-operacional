import { randomUUID } from "crypto";
import { AuditAction, Prisma } from "@prisma/client";

import { createPermissionError, createValidationError, mapPrismaError } from "@/lib/api-errors";
import { rolesWithCapability } from "@/lib/access-control";
import type { Actor } from "@/lib/mock-db";
import { prisma } from "@/lib/prisma";
import { canApproveRealtimeHoursCaptureAdjustment, canRequestRealtimeHoursCaptureAdjustment } from "@/lib/realtime-hours-permissions";
import { getRealtimeHoursTimeline } from "@/lib/realtime-hours-service";
import { formatMinutesToHHMM, parseWorkHoursToMinutes } from "@/lib/work-hours-rules";

const adjustmentEntity = "RealTimeHoursAdjustmentRequest";
const adjustmentApproverRoles = rolesWithCapability("WORK_HOURS_EDIT");
const adjustmentListLimit = 80;

export type RealtimeHoursAdjustmentInput = {
  date?: unknown;
  rowKey?: unknown;
  employeeId?: unknown;
  wbLogin?: unknown;
  hostname?: unknown;
  windowsUser?: unknown;
  requestedActiveHours?: unknown;
  reason?: unknown;
  justification?: unknown;
};

export type RealtimeHoursAdjustmentReviewInput = {
  id?: unknown;
  action?: unknown;
  rejectionReason?: unknown;
};

type RealtimeHoursTimelineAdjustmentRow = {
  key: string;
  employeeId: string;
  wbLogin: string;
  hostname: string;
  windowsUser: string;
  activeMs: number;
  noActivityMs: number;
};

export async function listRealtimeHoursAdjustmentRequests(actor: Actor, query: { date?: string | null; search?: string | null } = {}) {
  const user = await getRealtimeHoursAdjustmentUser(actor);
  if (!user) return createPermissionError("Você não tem permissão para visualizar ajustes da captura de horas.");

  const logs = await prisma.auditLog.findMany({
    where: { entity: adjustmentEntity },
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { actor: { select: { name: true, email: true } } }
  });

  const date = normalizeDate(query.date);
  const search = normalizeText(query.search);
  const data = logs
    .map((log) => formatAdjustmentLog(log))
    .filter((row): row is NonNullable<ReturnType<typeof formatAdjustmentLog>> => Boolean(row))
    .filter((row) => !date || row.date === date)
    .filter((row) => {
      if (!search) return true;
      return normalizeText([
        row.employeeName,
        row.wbLogin,
        row.hostname,
        row.windowsUser,
        row.lob,
        row.shift,
        row.reason,
        row.justification,
        row.requestedByName,
        row.requestedByEmail
      ].join(" ")).includes(search);
    })
    .slice(0, adjustmentListLimit);

  return { success: true, data };
}

export async function requestRealtimeHoursAdjustment(actor: Actor, input: RealtimeHoursAdjustmentInput) {
  const user = await getRealtimeHoursAdjustmentUser(actor);
  if (!user) return createPermissionError("Você não tem permissão para solicitar ajuste da captura de horas.");

  const date = normalizeDate(input.date);
  const reason = text(input.reason);
  const justification = text(input.justification);
  const requestedActiveMinutes = parseWorkHoursToMinutes(input.requestedActiveHours);
  const fieldErrors: Record<string, string> = {};

  if (!date) fieldErrors.date = "Data é obrigatória.";
  if (!text(input.rowKey) && !text(input.employeeId) && !text(input.wbLogin) && !text(input.hostname)) {
    fieldErrors.rowKey = "Selecione um registro da captura.";
  }
  if (requestedActiveMinutes === null) fieldErrors.requestedActiveHours = "Horas solicitadas inválidas. Use HH:mm, como 7:20, ou decimal, como 7,33.";
  if (!reason) fieldErrors.reason = "Motivo é obrigatório.";
  if (!justification) fieldErrors.justification = "Justificativa é obrigatória.";
  if (Object.keys(fieldErrors).length) return createValidationError(fieldErrors);

  try {
    const timeline = await getRealtimeHoursTimeline({ date });
    const row = findTimelineRow(timeline.rows, input);
    if (!row) {
      return createValidationError({ rowKey: "Registro não encontrado na timeline da captura para esta data." }, "Registro da captura não encontrado.");
    }

    const requestId = randomUUID();
    const currentActiveMinutes = Math.round(row.activeMs / 60_000);
    const payload = {
      requestId,
      status: "EM_ANALISE",
      date,
      rowKey: row.key,
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      wbLogin: row.wbLogin,
      hostname: row.hostname,
      windowsUser: row.windowsUser,
      lob: row.lob,
      shift: row.shift,
      currentActiveMinutes,
      currentActiveHours: formatMinutesToHHMM(currentActiveMinutes),
      requestedActiveMinutes,
      requestedActiveHours: formatMinutesToHHMM(requestedActiveMinutes!),
      differenceMinutes: requestedActiveMinutes! - currentActiveMinutes,
      reason,
      justification,
      requestedById: user.id,
      requestedByName: user.name,
      requestedByEmail: user.email
    };

    const created = await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: AuditAction.CRIACAO,
        entity: adjustmentEntity,
        entityId: requestId,
        reason,
        previousValue: {
          activeMinutes: currentActiveMinutes,
          activeHours: formatMinutesToHHMM(currentActiveMinutes)
        },
        newValue: payload as Prisma.JsonObject
      }
    });

    await notifyRealtimeHoursAdjustmentApprovers({
      requestId,
      requesterName: user.name,
      employeeName: row.employeeName || row.wbLogin || row.windowsUser || row.hostname,
      date
    });

    return {
      success: true,
      message: "Ajuste solicitado na captura de horas.",
      data: formatAdjustmentLog({ ...created, actor: { name: user.name, email: user.email } })
    };
  } catch (error) {
    return mapPrismaError(error) ?? { error: "Não foi possível solicitar ajuste da captura de horas." };
  }
}

export async function reviewRealtimeHoursAdjustment(actor: Actor, input: RealtimeHoursAdjustmentReviewInput) {
  const user = await getRealtimeHoursApprovalUser(actor);
  if (!user) return createPermissionError("Você não tem permissão para aprovar ajuste da captura de horas.");

  const id = text(input.id);
  const action = text(input.action).toUpperCase();
  const rejectionReason = text(input.rejectionReason);
  const fieldErrors: Record<string, string> = {};
  if (!id) fieldErrors.id = "Ajuste é obrigatório.";
  if (!["APPROVE", "REJECT"].includes(action)) fieldErrors.action = "Ação inválida.";
  if (action === "REJECT" && !rejectionReason) fieldErrors.rejectionReason = "Motivo da recusa é obrigatório.";
  if (Object.keys(fieldErrors).length) return createValidationError(fieldErrors);

  try {
    const log = await prisma.auditLog.findFirst({
      where: { entity: adjustmentEntity, OR: [{ id }, { entityId: id }] },
      include: { actor: { select: { name: true, email: true } } }
    });
    const payload = log && isRecord(log.newValue) ? log.newValue : null;
    if (!log || !payload) return createValidationError({ id: "Ajuste não encontrado." }, "Ajuste não encontrado.");
    if (text(payload.status) !== "EM_ANALISE") {
      return createValidationError({ id: "Este ajuste já foi analisado." }, "Este ajuste já foi analisado.");
    }

    const nextStatus = action === "APPROVE" ? "APROVADO" : "RECUSADO";
    const reviewedAt = new Date().toISOString();
    const nextPayload = {
      ...payload,
      status: nextStatus,
      reviewedAt,
      reviewedById: user.id,
      reviewedByName: user.name,
      reviewedByEmail: user.email,
      rejectionReason: action === "REJECT" ? rejectionReason : ""
    };

    const updated = await prisma.auditLog.update({
      where: { id: log.id },
      data: {
        action: action === "APPROVE" ? AuditAction.APROVACAO : AuditAction.RECUSA,
        reason: action === "REJECT" ? rejectionReason : text(payload.reason || log.reason),
        newValue: nextPayload as Prisma.JsonObject
      },
      include: { actor: { select: { name: true, email: true } } }
    });

    await notifyRealtimeHoursAdjustmentResult({
      payload: nextPayload,
      requestId: text(log.entityId || log.id),
      approved: action === "APPROVE"
    });

    return {
      success: true,
      message: action === "APPROVE" ? "Ajuste aprovado e refletido em Minhas Horas." : "Ajuste recusado.",
      data: formatAdjustmentLog(updated)
    };
  } catch (error) {
    return mapPrismaError(error) ?? { error: "Não foi possível analisar ajuste da captura de horas." };
  }
}

export async function applyApprovedRealtimeHoursAdjustments<T extends RealtimeHoursTimelineAdjustmentRow>(date: string, rows: T[]) {
  const adjustments = await getApprovedRealtimeHoursAdjustments(date);
  return applyApprovedAdjustmentsToRows(rows, adjustments);
}

export async function applyApprovedRealtimeHoursAdjustmentsForRange<T extends RealtimeHoursTimelineAdjustmentRow>(days: Array<{ date: string; rows: T[] }>) {
  const selectedDates = new Set(days.map((day) => day.date));
  const adjustments = (await getApprovedRealtimeHoursAdjustments()).filter((adjustment) => selectedDates.has(adjustment.date));
  return days.map((day) => ({
    ...day,
    rows: applyApprovedAdjustmentsToRows(day.rows, adjustments.filter((adjustment) => adjustment.date === day.date))
  }));
}

function applyApprovedAdjustmentsToRows<T extends RealtimeHoursTimelineAdjustmentRow>(rows: T[], adjustments: NonNullable<ReturnType<typeof formatAdjustmentLog>>[]) {
  return rows.map((row) => {
    const adjustment = findAdjustmentForRow(adjustments, row);
    if (!adjustment) {
      return {
        ...row,
        capturedActiveMs: row.activeMs,
        consideredActiveMs: row.activeMs,
        consideredNoActivityMs: row.noActivityMs,
        approvedAdjustment: null
      };
    }

    const consideredActiveMs = Math.max(0, adjustment.requestedActiveMinutes * 60_000);
    return {
      ...row,
      capturedActiveMs: row.activeMs,
      consideredActiveMs,
      consideredNoActivityMs: Math.max(0, row.noActivityMs + row.activeMs - consideredActiveMs),
      approvedAdjustment: adjustment
    };
  });
}

async function getRealtimeHoursAdjustmentUser(actor: Actor) {
  if (!actor.email) return null;
  const user = await prisma.user.findUnique({
    where: { email: actor.email },
    include: { role: true }
  });
  if (!user || !canRequestRealtimeHoursCaptureAdjustment({ role: user.role.name, status: user.status, email: user.email, name: user.name })) return null;
  return user;
}

async function getRealtimeHoursApprovalUser(actor: Actor) {
  if (!actor.email) return null;
  const user = await prisma.user.findUnique({
    where: { email: actor.email },
    include: { role: true }
  });
  if (!user || !canApproveRealtimeHoursCaptureAdjustment({ role: user.role.name, status: user.status, email: user.email, name: user.name })) return null;
  return user;
}

async function notifyRealtimeHoursAdjustmentApprovers(input: { requestId: string; requesterName: string; employeeName: string; date: string }) {
  const approvers = await prisma.user.findMany({
    where: { status: "ACTIVE", role: { name: { in: adjustmentApproverRoles } } },
    select: { id: true }
  });
  if (!approvers.length) return;

  await prisma.notification.createMany({
    data: approvers.map((approver) => ({
      userId: approver.id,
      title: "Novo ajuste de captura de horas",
      body: `${input.requesterName} solicitou ajuste para ${input.employeeName} em ${formatDateLabel(input.date)}.`,
      category: "Captura de Horas",
      type: "INFO",
      entity: adjustmentEntity,
      entityId: input.requestId,
      href: "/captura-horas"
    }))
  });
}

async function notifyRealtimeHoursAdjustmentResult(input: { payload: Record<string, unknown>; requestId: string; approved: boolean }) {
  const userIds = [text(input.payload.requestedById)];
  const employeeId = text(input.payload.employeeId);
  if (employeeId) {
    const employee = await prisma.employeeProfile.findUnique({ where: { id: employeeId }, select: { userId: true } });
    if (employee?.userId) userIds.push(employee.userId);
  }
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  if (!uniqueUserIds.length) return;

  await prisma.notification.createMany({
    data: uniqueUserIds.map((userId) => ({
      userId,
      title: input.approved ? "Ajuste de captura aprovado" : "Ajuste de captura recusado",
      body: input.approved
        ? `O ajuste de ${text(input.payload.currentActiveHours)} para ${text(input.payload.requestedActiveHours)} foi aprovado e já aparece em Minhas Horas.`
        : `O ajuste de captura foi recusado${text(input.payload.rejectionReason) ? `: ${text(input.payload.rejectionReason)}` : "."}`,
      category: "Captura de Horas",
      type: input.approved ? "SUCCESS" : "WARNING",
      entity: adjustmentEntity,
      entityId: input.requestId,
      href: "/minhas-horas"
    }))
  });
}

async function getApprovedRealtimeHoursAdjustments(date?: string) {
  const logs = await prisma.auditLog.findMany({
    where: { entity: adjustmentEntity },
    orderBy: { createdAt: "desc" },
    take: 1000,
    include: { actor: { select: { name: true, email: true } } }
  });
  return logs
    .map((log) => formatAdjustmentLog(log))
    .filter((row): row is NonNullable<ReturnType<typeof formatAdjustmentLog>> => Boolean(row))
    .filter((row) => (!date || row.date === date) && row.status === "APROVADO");
}

function findTimelineRow(rows: Awaited<ReturnType<typeof getRealtimeHoursTimeline>>["rows"], input: RealtimeHoursAdjustmentInput) {
  const rowKey = text(input.rowKey);
  const employeeId = text(input.employeeId);
  const wbLogin = normalizeIdentity(input.wbLogin);
  const hostname = normalizeIdentity(input.hostname);
  const windowsUser = normalizeIdentity(input.windowsUser);

  return rows.find((row) => {
    if (rowKey && row.key === rowKey) return true;
    if (employeeId && row.employeeId === employeeId) return true;
    if (wbLogin && normalizeIdentity(row.wbLogin) === wbLogin) return true;
    if (hostname && windowsUser && normalizeIdentity(row.hostname) === hostname && normalizeIdentity(row.windowsUser) === windowsUser) return true;
    if (hostname && normalizeIdentity(row.hostname) === hostname) return true;
    return false;
  });
}

function findAdjustmentForRow(adjustments: NonNullable<ReturnType<typeof formatAdjustmentLog>>[], row: RealtimeHoursTimelineAdjustmentRow) {
  return adjustments.find((adjustment) => {
    if (adjustment.rowKey && adjustment.rowKey === row.key) return true;
    if (adjustment.employeeId && adjustment.employeeId === row.employeeId) return true;
    if (adjustment.wbLogin && normalizeIdentity(adjustment.wbLogin) === normalizeIdentity(row.wbLogin)) return true;
    if (adjustment.hostname && adjustment.windowsUser && normalizeIdentity(adjustment.hostname) === normalizeIdentity(row.hostname) && normalizeIdentity(adjustment.windowsUser) === normalizeIdentity(row.windowsUser)) return true;
    return false;
  });
}

function formatAdjustmentLog(log: {
  id: string;
  entityId: string | null;
  reason: string | null;
  newValue: Prisma.JsonValue | null;
  createdAt: Date;
  actor?: { name: string | null; email: string | null } | null;
}) {
  const payload = isRecord(log.newValue) ? log.newValue : null;
  if (!payload) return null;
  return {
    id: log.entityId || log.id,
    auditLogId: log.id,
    status: text(payload.status) || "EM_ANALISE",
    date: text(payload.date),
    rowKey: text(payload.rowKey),
    employeeId: text(payload.employeeId),
    employeeName: text(payload.employeeName),
    wbLogin: text(payload.wbLogin),
    hostname: text(payload.hostname),
    windowsUser: text(payload.windowsUser),
    lob: text(payload.lob),
    shift: text(payload.shift),
    currentActiveMinutes: numberValue(payload.currentActiveMinutes),
    currentActiveHours: text(payload.currentActiveHours),
    requestedActiveMinutes: numberValue(payload.requestedActiveMinutes),
    requestedActiveHours: text(payload.requestedActiveHours),
    differenceMinutes: numberValue(payload.differenceMinutes),
    reason: text(payload.reason || log.reason),
    justification: text(payload.justification),
    requestedByName: text(payload.requestedByName || log.actor?.name),
    requestedByEmail: text(payload.requestedByEmail || log.actor?.email),
    reviewedByName: text(payload.reviewedByName),
    reviewedByEmail: text(payload.reviewedByEmail),
    reviewedAt: text(payload.reviewedAt),
    rejectionReason: text(payload.rejectionReason),
    createdAt: log.createdAt.toISOString()
  };
}

function normalizeDate(value: unknown) {
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return "";
}

function formatDateLabel(value: string) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeText(value: unknown) {
  return text(value).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function normalizeIdentity(value: unknown) {
  return normalizeText(value).replace(/\s+/g, "");
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
