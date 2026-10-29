import { buildRealtimeHoursPlannedShifts, saoPauloDateKey, type RealtimeHoursScheduleSlot } from "@/lib/realtime-hours-timeline";
import { isWorkHoursAllowedForSchedule } from "@/lib/work-hours-rules";

export type TeamWorkTotals = {
  expectedDays: number; recordedDays: number; adherenceHours: number;
  observedEntries: number; lateEntries: number; observedExits: number; earlyExits: number;
  overtimeHours: number;
};
export type TeamWorkMetric = TeamWorkTotals & { adherenceRate: number | null; lateRate: number | null; earlyRate: number | null; officialOvertimeHours: number | null };
export type WorkMetricRecord = { employeeId: string; date: Date; scheduleId: string | null; effectiveHours: number; plannedHours: number | null };
export type WorkMetricCapture = { employeeId: string; data: string; slotId: string | null; entryAt: string | null; exitAt: string | null };

export function emptyTeamWorkTotals(): TeamWorkTotals {
  return { expectedDays: 0, recordedDays: 0, adherenceHours: 0, observedEntries: 0, lateEntries: 0, observedExits: 0, earlyExits: 0, overtimeHours: 0 };
}
const rate = (numerator: number, denominator: number) => denominator ? Math.round(numerator / denominator * 10000) / 100 : null;
export function finishTeamWorkMetric(totals: TeamWorkTotals): TeamWorkMetric {
  return { ...totals, adherenceRate: rate(totals.adherenceHours, totals.recordedDays * 8),
    lateRate: rate(totals.lateEntries, totals.observedEntries), earlyRate: rate(totals.earlyExits, totals.observedExits),
    officialOvertimeHours: totals.recordedDays ? totals.overtimeHours : null };
}
export function combineTeamWorkMetrics(values: Array<TeamWorkTotals | undefined>): TeamWorkMetric {
  const totals = emptyTeamWorkTotals();
  for (const value of values) if (value) for (const key of Object.keys(totals) as Array<keyof TeamWorkTotals>) totals[key] += value[key];
  return finishTeamWorkMetric(totals);
}

// Ratios use recorded closed workdays. Missing hours/capture remain missing;
// coverage counts are returned alongside each rate. Extra hours cannot offset a deficit.
export function calculateTeamWorkMetrics(employeeIds: string[], schedules: RealtimeHoursScheduleSlot[], records: WorkMetricRecord[], capture: WorkMetricCapture[], now = new Date()) {
  const totals = new Map(employeeIds.map((id) => [id, emptyTeamWorkTotals()]));
  const recordByDay = new Map(records.map((row) => [`${row.employeeId}:${row.date.toISOString().slice(0, 10)}`, row]));
  const captureBySlot = new Map<string, WorkMetricCapture[]>();
  for (const row of capture) {
    if (!totals.has(row.employeeId) || !row.slotId) continue;
    const key = `${row.employeeId}:${row.slotId}:${row.data}`;
    const rows = captureBySlot.get(key) ?? []; rows.push(row); captureBySlot.set(key, rows);
  }
  const seen = new Set<string>();
  for (const schedule of schedules) {
    const total = totals.get(schedule.employeeId), day = schedule.date.toISOString().slice(0, 10);
    const key = `${schedule.employeeId}:${day}`;
    const slot = { ...schedule, startsAt: schedule.startsAt ?? schedule.shift?.startsAt ?? null, endsAt: schedule.endsAt ?? schedule.shift?.endsAt ?? null };
    if (!total || seen.has(key) || !isWorkHoursAllowedForSchedule(slot)) continue;
    const shift = buildRealtimeHoursPlannedShifts([slot])[0];
    if (shift ? Date.parse(shift.end) > +now : day >= saoPauloDateKey(now)) continue;
    seen.add(key); total.expectedDays++;
    const record = recordByDay.get(key);
    if (record && (!record.scheduleId || record.scheduleId === schedule.id) && Number.isFinite(record.effectiveHours) && record.effectiveHours >= 0) {
      total.recordedDays++; total.adherenceHours += Math.min(record.effectiveHours, 8);
      total.overtimeHours += Math.max(0, record.effectiveHours - (record.plannedHours != null && record.plannedHours > 0 ? record.plannedHours : 8));
    }
    if (!shift) continue;
    const rows = captureBySlot.get(`${schedule.employeeId}:${schedule.id}:${day}`) ?? [];
    const instants = (field: "entryAt" | "exitAt") => rows.flatMap((row) => {
      const value = row[field] ? Date.parse(row[field]!) : NaN;
      return Number.isFinite(value) && value <= +now ? [value] : [];
    });
    const entries = instants("entryAt"), exits = instants("exitAt");
    if (entries.length) {
      total.observedEntries++;
      if (Math.floor((Math.min(...entries) - Date.parse(shift.start)) / 1000) > 0) total.lateEntries++;
    }
    if (exits.length) {
      total.observedExits++;
      if (Math.floor((Date.parse(shift.end) - Math.max(...exits)) / 1000) > 0) total.earlyExits++;
    }
  }
  return new Map([...totals].map(([id, value]) => [id, finishTeamWorkMetric(value)]));
}
