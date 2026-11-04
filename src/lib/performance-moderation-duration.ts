import {
  buildRealtimeHoursPlannedShifts,
  buildRealtimeHoursSlotAssignmentWindows,
  type RealtimeHoursScheduleSlot
} from "@/lib/realtime-hours-timeline";

export type ModerationDurationDay = {
  employeeId: string;
  shiftDate: string;
  seconds: number | null;
  duration: string;
};

export type AgentModerationDuration = {
  seconds: number | null;
  duration: string;
  byShiftDate: ModerationDurationDay[];
};

export function normalizeModerationLogin(value: string) {
  return String(value ?? "").replace(/\s+/g, "").toLowerCase();
}

/** Format a duration, never a clock. Round only the completed sum. */
export function formatModerationDuration(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "Sem dados";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return [hours, minutes, total % 60].map(value => String(value).padStart(2, "0")).join(":");
}

export type ModerationSchedule = RealtimeHoursScheduleSlot & {
  shiftId: string | null;
  supervisorId: string | null;
};

export function moderationAssignmentWindows(
  employees: Array<{ employeeId: string; wbLogin: string }>,
  schedules: ModerationSchedule[]
) {
  return employees.flatMap(employee => {
    const slots = schedules.filter(slot => slot.employeeId === employee.employeeId);
    const byId = new Map(slots.map(slot => [slot.id, slot]));
    // Reuse Capture's slot selection, overnight dates, extensions and midpoint boundaries.
    return buildRealtimeHoursSlotAssignmentWindows(buildRealtimeHoursPlannedShifts(slots)).map((window, assignmentOrder) => ({
      employeeId: employee.employeeId,
      wbLogin: normalizeModerationLogin(employee.wbLogin),
      shiftDate: window.shift.sourceDate,
      slotId: window.shift.id,
      assignmentOrder,
      slotStart: window.shift.start,
      slotEnd: window.shift.end,
      assignmentStart: new Date(window.assignmentStart).toISOString(),
      assignmentEnd: new Date(window.assignmentEnd).toISOString(),
      shiftId: byId.get(window.shift.id)?.shiftId ?? null,
      shiftName: window.shift.shift,
      supervisorId: byId.get(window.shift.id)?.supervisorId ?? null
    }));
  });
}

export type ModerationAssignmentWindow = ReturnType<typeof moderationAssignmentWindows>[number];
