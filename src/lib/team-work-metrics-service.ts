import { prisma } from "@/lib/prisma";
import { getRealtimeHoursPunctualityRange } from "@/lib/realtime-hours-service";
import { calculateTeamWorkMetrics } from "@/lib/team-work-metrics";
import { buildRealtimeHoursPlannedShifts, saoPauloDateKey } from "@/lib/realtime-hours-timeline";
import { isWorkHoursAllowedForSchedule } from "@/lib/work-hours-rules";

export const teamWorkData = { punctualityRange: getRealtimeHoursPunctualityRange };

export async function loadTeamWorkMetrics(employees: Array<{ id: string; wbLogin: string }>, start: Date, end: Date, now = new Date(), includePunctuality = true) {
  const ids = employees.map((employee) => employee.id);
  if (!ids.length) return { byEmployee: calculateTeamWorkMetrics([], [], [], [], now), warnings: [] as string[] };
  const through = new Date(`${saoPauloDateKey(now)}T00:00:00Z`);
  const endDate = end < through ? end : through;
  const [schedules, records] = await Promise.all([
    prisma.schedule.findMany({ where: { employeeId: { in: ids }, date: { gte: start, lte: endDate }, deletedAt: null },
      select: { id: true, employeeId: true, date: true, startsAt: true, endsAt: true, status: true, shift: { select: { name: true, startsAt: true, endsAt: true } } } }),
    prisma.workHourRecord.findMany({ where: { employeeId: { in: ids }, date: { gte: start, lte: endDate } },
      select: { employeeId: true, date: true, scheduleId: true, effectiveHours: true, plannedHours: true } })
  ]);
  const dates = [...new Set(schedules.filter((slot) => isWorkHoursAllowedForSchedule({ ...slot, startsAt: slot.startsAt ?? slot.shift?.startsAt, endsAt: slot.endsAt ?? slot.shift?.endsAt }))
    .filter((slot) => { const shift = buildRealtimeHoursPlannedShifts([slot])[0]; return shift && Date.parse(shift.end) <= +now; })
    .map((slot) => slot.date.toISOString().slice(0, 10)))].sort();
  let capture: Awaited<ReturnType<typeof getRealtimeHoursPunctualityRange>> = { rows: [], warnings: [] };
  const warnings: string[] = [];
  try {
    if (includePunctuality && dates.length) capture = await teamWorkData.punctualityRange({ dates, eligibleEmployeeIds: ids, eligibleWbLogins: employees.map((employee) => employee.wbLogin) });
    warnings.push(...capture.warnings);
  } catch {
    warnings.push("A captura está indisponível. As taxas de atraso e saída antecipada não puderam ser calculadas.");
  }
  return { byEmployee: calculateTeamWorkMetrics(ids, schedules, records, capture.rows, now), warnings: [...new Set(warnings)] };
}
