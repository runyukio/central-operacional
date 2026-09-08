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

export type SpaceScheduleGroup = { status: string; startsAt: string | null; endsAt: string | null; shiftName: string | null; future: boolean; slots: number };
export function summarizeSpaceHours(period: SpacePeriod, today: string, realized: { hours: number | null; records: number }, schedules: SpaceScheduleGroup[]): SpaceHoursSummary {
  let futureHours = 0, futureSlots = 0, missingPastSlots = 0;
  for (const row of schedules) {
    const hours = plannedProductiveHoursForSchedule(row);
    if (hours === null) continue;
    if (row.future) { futureHours += hours * row.slots; futureSlots += row.slots; }
    else missingPastSlots += row.slots;
  }
  const tomorrow = new Date(+new Date(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const realizedHours = realized.records ? realized.hours ?? 0 : null;
  return { actualThrough: period.endDate < today ? period.endDate : today, projectionFrom: period.startDate > tomorrow ? period.startDate : tomorrow,
    projectionUntil: period.endDate, realizedHours, futureHours, projectedHours: realized.records || futureSlots ? (realizedHours ?? 0) + futureHours : null,
    realizedRecords: realized.records, futureSlots, missingPastSlots };
}
