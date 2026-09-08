import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MeuEspacoError } from "@/lib/meu-espaco-access";
import { spaceDate, spaceToday } from "@/lib/meu-espaco-filters";
import { summarizeSpaceHours, type SpaceScheduleGroup } from "@/lib/meu-espaco-hours";
import type { SpacePeriod } from "@/lib/meu-espaco-contract";
import type { MeuEspacoScope } from "@/lib/meu-espaco-scope";

export function spaceHoursPeriod(query: URLSearchParams, today = spaceToday()): SpacePeriod {
  const startDate = query.get("startDate") || `${today.slice(0, 7)}-01`, endDate = query.get("endDate") || today;
  const start = spaceDate(startDate), end = spaceDate(endDate);
  if (start > end || +end - +start > 365 * 86_400_000) throw new MeuEspacoError("Selecione um período de até 366 dias para as horas.");
  return { startDate, endDate };
}

export function spaceHoursEmployeeIds(scope: MeuEspacoScope, query: URLSearchParams) {
  const search = (query.get("search") || "").trim().slice(0, 120), employeeId = query.get("employeeId"), lob = query.get("lob");
  return scope.employees.filter((employee) => (!employeeId || employee.id === employeeId) && (!lob || employee.lob.name === lob)
    && (!search || [employee.fullName, employee.wbLogin].some((value) => value.toLocaleLowerCase().includes(search.toLocaleLowerCase())))).map((employee) => employee.id);
}

export async function getSpaceHoursSummary(scope: MeuEspacoScope, query: URLSearchParams, period: SpacePeriod, today = spaceToday()) {
  const ids = spaceHoursEmployeeIds(scope, query);
  if (!ids.length) return summarizeSpaceHours(period, today, { hours: null, records: 0 }, []);
  const through = period.endDate < today ? period.endDate : today;
  const [realized, schedules] = await Promise.all([
    prisma.workHourRecord.aggregate({ where: { employeeId: { in: ids }, date: { gte: spaceDate(period.startDate), lte: spaceDate(through) } }, _sum: { effectiveHours: true }, _count: { _all: true } }),
    // Aggregate before transfer: no per-day schedule download and no per-partner query loop.
    prisma.$queryRaw<SpaceScheduleGroup[]>(Prisma.sql`SELECT s.status::text, s."startsAt", s."endsAt", sh.name AS "shiftName",
      s.date > ${spaceDate(today)} AS future, COUNT(*)::integer AS slots
      FROM "Schedule" s LEFT JOIN "Shift" sh ON sh.id=s."shiftId"
      WHERE s."employeeId" IN (${Prisma.join(ids)}) AND s."deletedAt" IS NULL
        AND s.date >= ${spaceDate(period.startDate)} AND s.date <= ${spaceDate(period.endDate)}
        AND (s.date > ${spaceDate(today)} OR (s.date < ${spaceDate(today)} AND NOT EXISTS (
          SELECT 1 FROM "WorkHourRecord" w WHERE w."employeeId"=s."employeeId" AND w.date=s.date)))
      GROUP BY 1, 2, 3, 4, 5`)
  ]);
  return summarizeSpaceHours(period, today, { hours: realized._sum.effectiveHours, records: realized._count._all }, schedules);
}
