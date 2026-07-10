import { randomUUID } from "crypto";
import { AuditAction, Prisma } from "@prisma/client";

import { createPermissionError, createValidationError, mapPrismaError } from "@/lib/api-errors";
import type { Actor } from "@/lib/mock-db";
import { prisma } from "@/lib/prisma";
import { canRequestRealtimeHoursCaptureAdjustment } from "@/lib/realtime-hours-permissions";
import { getRealtimeHoursTimeline } from "@/lib/realtime-hours-service";
import { formatMinutesToHHMM, parseWorkHoursToMinutes } from "@/lib/work-hours-rules";

const adjustmentEntity = "RealTimeHoursAdjustmentRequest";
const adjustmentApproverRoles = ["ADMIN", "GESTOR", "WFM"];
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

async function getRealtimeHoursAdjustmentUser(actor: Actor) {
  if (!actor.email) return null;
  const user = await prisma.user.findUnique({
    where: { email: actor.email },
    include: { role: true }
  });
  if (!user || !canRequestRealtimeHoursCaptureAdjustment({ role: user.role.name, status: user.status, email: user.email, name: user.name })) return null;
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
