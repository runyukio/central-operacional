import {
  compareRealtimeHoursPlannedShift,
  primaryRealtimeHoursPlannedShift,
  realtimeHoursOvertimeRanges,
  realtimeHoursPlannedShiftLabel,
  realtimeHoursScheduleStatusLabel,
  type RealtimeHoursTimelineFilterRow
} from "@/lib/realtime-hours-timeline";

export type RealtimeHoursExportRow = {
  data: string;
  employeeName: string;
  wbLogin: string;
  employeeId: string;
  presenceStatus: string;
  lob: string;
  supervisor: string;
  shift: string;
  scheduleStatus: string;
  plannedShiftLabel: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  entryAt: string | null;
  exitAt: string | null;
  durationMs: number;
  noActivityMs: number;
  rawDelayMs: number;
  delayMs: number;
  overtimeMs: number;
  sessionCount: number;
  hostnames: string;
  windowsUsers: string;
  ipAddress: string;
  lastSeenAt: string;
};

export function buildRealtimeHoursExportRows<T extends RealtimeHoursTimelineFilterRow>(
  rows: T[],
  calculationEnd: string
): RealtimeHoursExportRow[] {
  return rows.map((row) => {
    const plannedShift = primaryRealtimeHoursPlannedShift(row, row.data);
    const comparison = compareRealtimeHoursPlannedShift(row, row.data, calculationEnd);
    const overtimeMs = realtimeHoursOvertimeRanges(row)
      .reduce((total, range) => total + (range.end - range.start), 0);

    return {
      data: row.data,
      employeeName: row.employeeName || row.wbLogin || row.windowsUser || row.hostname,
      wbLogin: row.wbLogin,
      employeeId: row.employeeId,
      presenceStatus: realtimeHoursPresenceStatusLabel(row.currentStatus),
      lob: row.lob || "Sem LOB",
      supervisor: row.supervisor || "Sem supervisor",
      shift: row.shift || "Sem turno",
      scheduleStatus: plannedShift ? realtimeHoursScheduleStatusLabel(plannedShift.status) : "Sem escala",
      plannedShiftLabel: realtimeHoursPlannedShiftLabel(row, row.data),
      plannedStart: plannedShift?.start ?? null,
      plannedEnd: plannedShift?.end ?? null,
      entryAt: row.entryAt,
      exitAt: row.exitAt,
      durationMs: row.activeMs,
      noActivityMs: row.noActivityMs,
      rawDelayMs: row.arrivalDelayMs,
      delayMs: comparison.arrivalDelayMs,
      overtimeMs,
      sessionCount: row.sessionCount,
      hostnames: row.hostnames.join(", ") || row.hostname,
      windowsUsers: row.windowsUsers.join(", ") || row.windowsUser,
      ipAddress: row.ipAddress,
      lastSeenAt: row.lastSeenAt
    };
  });
}

export function realtimeHoursPresenceStatusLabel(status: string) {
  const labels: Record<string, string> = {
    ONLINE: "Online",
    LOCKED: "Tela bloqueada",
    IDLE: "Ocioso",
    OFFLINE: "Offline"
  };
  return labels[status] ?? status;
}
