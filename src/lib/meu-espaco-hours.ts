import { plannedProductiveHoursForSchedule } from "@/lib/work-hours-rules";
import type { SpaceHoursSummary, SpacePeriod } from "@/lib/meu-espaco-contract";

export function spaceHoursDefaultPeriod(period: SpacePeriod, today: string): SpacePeriod {
  return spaceHoursMonthPeriod((period.startDate || today).slice(0, 7));
}

export function spaceHoursMonthPeriod(month: string): SpacePeriod {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Selecione um mês válido.");
  const year = Number(month.slice(0, 4));
  if (year < 1900 || year > 9999) throw new Error("Selecione um mês válido.");
  return { startDate: `${month}-01`, endDate: new Date(Date.UTC(year, Number(month.slice(5)), 0)).toISOString().slice(0, 10) };
}

export function spaceHoursClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return { today: `${part("year")}-${part("month")}-${part("day")}`, minuteOfDay: Number(part("hour")) * 60 + Number(part("minute")) };
}

function clockMinutes(value: string | null) {
  const match = /^(\d{1,2}):(\d{2})(?::00)?$/.exec(value?.trim() ?? "");
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function spaceShiftInProgress(schedule: { date: Date; startsAt: string | null; endsAt: string | null }, today: string, minuteOfDay: number) {
  const start = clockMinutes(schedule.startsAt), end = clockMinutes(schedule.endsAt);
  if (start === null || end === null || start === end) return false;
  // Schedule dates identify the day a shift starts, including overnight/month-end shifts.
  const day = schedule.date.toISOString().slice(0, 10);
  const offset = (+new Date(`${today}T00:00:00Z`) - +new Date(`${day}T00:00:00Z`)) / 60_000 + minuteOfDay;
  return offset >= start && offset < end + (end < start ? 1440 : 0);
}

export type SpaceScheduleGroup = { status: string; startsAt: string | null; endsAt: string | null; shiftName: string | null; future: boolean; slots: number; date?: Date; effectiveHours?: number | null };
export function summarizeSpaceHours(period: SpacePeriod, today: string, realized: { hours: number | null; records: number }, schedules: SpaceScheduleGroup[], minuteOfDay = 0): SpaceHoursSummary {
  let futureHours = 0, futureSlots = 0, missingPastSlots = 0, inProgressHours = 0;
  for (const row of schedules) {
    const hours = plannedProductiveHoursForSchedule(row);
    if (hours === null) continue;
    if (row.future) { futureHours += hours * row.slots; futureSlots += row.slots; }
    else if (row.date && spaceShiftInProgress({ ...row, date: row.date }, today, minuteOfDay)) {
      inProgressHours += Math.max(0, hours - (row.effectiveHours ?? 0)) * row.slots;
    } else if ((!row.date || row.date.toISOString().slice(0, 10) < today) && row.effectiveHours == null) missingPastSlots += row.slots;
  }
  const tomorrow = new Date(+new Date(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const realizedHours = realized.records ? realized.hours ?? 0 : null;
  return { actualThrough: period.endDate < today ? period.endDate : today, projectionFrom: period.startDate > tomorrow ? period.startDate : tomorrow,
    projectionUntil: period.endDate, realizedHours, futureHours, inProgressHours, projectedHours: realized.records || futureSlots || inProgressHours > 0 ? (realizedHours ?? 0) + futureHours + inProgressHours : null,
    realizedRecords: realized.records, futureSlots, missingPastSlots };
}
