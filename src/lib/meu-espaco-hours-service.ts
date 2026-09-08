import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MeuEspacoError } from "@/lib/meu-espaco-access";
import { spaceDate, spaceToday } from "@/lib/meu-espaco-filters";
import { spaceHoursMonthPeriod, summarizeSpaceHours, type SpaceScheduleGroup } from "@/lib/meu-espaco-hours";
import type { SpacePeriod, SpaceHours } from "@/lib/meu-espaco-contract";
import type { MeuEspacoScope } from "@/lib/meu-espaco-scope";
import { workHourReadData } from "@/lib/work-hours-service";
import { summarizePartnerMonth } from "@/lib/meu-espaco-monthly-hours";

export function spaceHoursPeriod(query: URLSearchParams, today = spaceToday()): SpacePeriod {
  const startDate = query.get("startDate"), endDate = query.get("endDate");
  if (startDate) spaceDate(startDate);
  if (endDate) spaceDate(endDate);
  if (startDate && endDate && (startDate > endDate || startDate.slice(0, 7) !== endDate.slice(0, 7))) throw new MeuEspacoError("As horas são consolidadas por mês. Selecione somente um mês.");
  try { return spaceHoursMonthPeriod(query.get("month") || (startDate || today).slice(0, 7)); }
  catch { throw new MeuEspacoError("Selecione um mês válido."); }
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

export async function getSpaceMonthlyHours(scope: MeuEspacoScope, query: URLSearchParams, today = spaceToday()): Promise<SpaceHours> {
  const period = spaceHoursPeriod(query, today), page = Number(query.get("page") || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new MeuEspacoError("Página inválida.");
  const allowed = new Set(spaceHoursEmployeeIds(scope, query));
  const partners = scope.employees.filter((p) => allowed.has(p.id)).sort((a, b) => a.fullName.localeCompare(b.fullName, "pt-BR") || a.id.localeCompare(b.id));
  const selected = partners.slice((page - 1) * 50, page * 50), ids = selected.map((p) => p.id);
  const through = period.endDate < today ? period.endDate : today;
  const [records, schedules, summary] = await Promise.all([
    ids.length ? prisma.workHourRecord.findMany({ where: { employeeId: { in: ids }, date: { gte: spaceDate(period.startDate), lte: spaceDate(through) } },
      select: { id: true, employeeId: true, wbLogin: true, date: true, actualHours: true, adjustedHours: true, effectiveHours: true, differenceMinutes: true, status: true,
        schedule: { select: { status: true, startsAt: true, endsAt: true, deletedAt: true, shift: { select: { name: true } } } } } }) : [],
    ids.length ? prisma.schedule.findMany({ where: { employeeId: { in: ids }, deletedAt: null, date: { gte: spaceDate(period.startDate), lte: spaceDate(period.endDate) } },
      select: { employeeId: true, date: true, status: true, startsAt: true, endsAt: true, shift: { select: { name: true } } } }) : [],
    getSpaceHoursSummary(scope, query, period, today)
  ]);
  // One bounded capture lookup for the page's partners, never a call per partner/day.
  const captured = records.length ? await workHourReadData.capturedHours(records.map((r) => ({key:r.id,employeeId:r.employeeId,wbLogin:r.wbLogin,shiftDate:r.date}))) : new Map<string, number>();
  const byPartner = new Map(selected.map((p) => [p.id, { records: [] as Array<(typeof records)[number]>, schedules: [] as Array<(typeof schedules)[number]> }]));
  for (const row of records) byPartner.get(row.employeeId)!.records.push(row);
  for (const row of schedules) byPartner.get(row.employeeId)!.schedules.push(row);
  return { period, summary, pagination: { page, totalPages: Math.max(1, Math.ceil(partners.length / 50)), total: partners.length },
    data: selected.map((p) => summarizePartnerMonth(p, period, today, byPartner.get(p.id)!.records, byPartner.get(p.id)!.schedules, captured)) };
}
