import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

const adjustmentEntity = "RealTimeHoursAdjustmentRequest";

type RealtimeHoursTimelineAdjustmentRow = {
  key: string;
  employeeId: string;
  wbLogin: string;
  hostname: string;
  windowsUser: string;
  activeMs: number;
  noActivityMs: number;
};

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
