import { prisma } from "@/lib/prisma";
import { getRealtimeHoursTimelineRange } from "@/lib/realtime-hours-service";
import { calculateTeamWorkMetrics } from "@/lib/team-work-metrics";
import { saoPauloDateKey } from "@/lib/realtime-hours-timeline";

export const teamWorkData = { timelineRange: getRealtimeHoursTimelineRange };

export async function loadTeamWorkMetrics(employees: Array<{ id: string; wbLogin: string }>, start: Date, end: Date, now = new Date()) {
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
  const dates = [...new Set(schedules.map((slot) => slot.date.toISOString().slice(0, 10)))].sort();
  let timelines: Awaited<ReturnType<typeof getRealtimeHoursTimelineRange>> = [];
  const warnings: string[] = [];
  try {
    timelines = await teamWorkData.timelineRange({ dates, eligibleEmployeeIds: ids, eligibleWbLogins: employees.map((employee) => employee.wbLogin) });
    for (const timeline of timelines) if (timeline.archiveWarning) warnings.push(`${timeline.date}: ${timeline.archiveWarning}`);
  } catch {
    warnings.push("A captura está indisponível. As taxas de atraso e saída antecipada não puderam ser calculadas.");
  }
  return { byEmployee: calculateTeamWorkMetrics(ids, schedules, records, timelines.flatMap((timeline) => timeline.rows), now), warnings: [...new Set(warnings)] };
}
