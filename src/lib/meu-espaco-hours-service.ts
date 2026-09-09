import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MeuEspacoError } from "@/lib/meu-espaco-access";
import { spaceDate, spaceToday } from "@/lib/meu-espaco-filters";
import { spaceHoursClock, spaceHoursMonthPeriod, summarizeSpaceHours, type SpaceScheduleGroup } from "@/lib/meu-espaco-hours";
import type { SpacePeriod, SpaceHours } from "@/lib/meu-espaco-contract";
import type { MeuEspacoScope } from "@/lib/meu-espaco-scope";
import { workHourReadData } from "@/lib/work-hours-service";
import { summarizePartnerMonth } from "@/lib/meu-espaco-monthly-hours";
import { compareSpaceValues, spaceHoursSortKeys, type SpaceHoursSortKey } from "@/lib/meu-espaco-order";

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

export async function getSpaceHoursSummary(scope: MeuEspacoScope, query: URLSearchParams, period: SpacePeriod, now = new Date()) {
  const { today, minuteOfDay } = spaceHoursClock(now);
  const ids = spaceHoursEmployeeIds(scope, query);
  if (!ids.length) return summarizeSpaceHours(period, today, { hours: null, records: 0 }, []);
  const through = period.endDate < today ? period.endDate : today;
  const yesterday = new Date(+spaceDate(today) - 86_400_000);
  const [realized, schedules] = await Promise.all([
    prisma.workHourRecord.aggregate({ where: { employeeId: { in: ids }, date: { gte: spaceDate(period.startDate), lte: spaceDate(through) } }, _sum: { effectiveHours: true }, _count: { _all: true } }),
    // Aggregate before transfer: no per-day schedule download and no per-partner query loop.
    prisma.$queryRaw<SpaceScheduleGroup[]>(Prisma.sql`SELECT s.status::text, s."startsAt", s."endsAt", sh.name AS "shiftName",
      s.date > ${spaceDate(today)} AS future, s.date, w."effectiveHours", COUNT(*)::integer AS slots
      FROM "Schedule" s LEFT JOIN "Shift" sh ON sh.id=s."shiftId"
      LEFT JOIN "WorkHourRecord" w ON w."employeeId"=s."employeeId" AND w.date=s.date
      WHERE s."employeeId" IN (${Prisma.join(ids)}) AND s."deletedAt" IS NULL
        AND s.date >= ${spaceDate(period.startDate)} AND s.date <= ${spaceDate(period.endDate)}
        AND (s.date > ${spaceDate(today)} OR w.id IS NULL OR s.date >= ${yesterday})
      GROUP BY 1, 2, 3, 4, 5, 6, 7`)
  ]);
  return summarizeSpaceHours(period, today, { hours: realized._sum.effectiveHours, records: realized._count._all }, schedules, minuteOfDay);
}

export async function getSpaceMonthlyHours(scope: MeuEspacoScope, query: URLSearchParams, now = new Date()): Promise<SpaceHours> {
  const { today, minuteOfDay } = spaceHoursClock(now);
  const period = spaceHoursPeriod(query, today), page = Number(query.get("page") || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new MeuEspacoError("Página inválida.");
  const allowed = new Set(spaceHoursEmployeeIds(scope, query));
  const sort = (query.get("sort") || "employeeName") as SpaceHoursSortKey, direction = query.get("direction") || "asc";
  if (!spaceHoursSortKeys.includes(sort) || !["asc", "desc"].includes(direction)) throw new MeuEspacoError("Ordenação de horas inválida.");
  const dir = direction === "desc" ? "desc" : "asc";
  const partners = scope.employees.filter((p) => allowed.has(p.id)).sort((a, b) => compareSpaceValues(a.fullName, b.fullName, dir) || a.id.localeCompare(b.id));
  // Numeric ordering must see every filtered partner, before the page is sliced.
  const selected = sort === "employeeName" ? partners.slice((page - 1) * 50, page * 50) : partners, ids = selected.map((p) => p.id);
  const through = period.endDate < today ? period.endDate : today;
  const [records, schedules, summary] = await Promise.all([
    ids.length ? prisma.workHourRecord.findMany({ where: { employeeId: { in: ids }, date: { gte: spaceDate(period.startDate), lte: spaceDate(through) } },
      select: { id: true, employeeId: true, wbLogin: true, date: true, actualHours: true, adjustedHours: true, effectiveHours: true, differenceMinutes: true, status: true,
        schedule: { select: { status: true, startsAt: true, endsAt: true, deletedAt: true, shift: { select: { name: true } } } } } }) : [],
    ids.length ? prisma.schedule.findMany({ where: { employeeId: { in: ids }, deletedAt: null, date: { gte: spaceDate(period.startDate), lte: spaceDate(period.endDate) } },
      select: { employeeId: true, date: true, status: true, startsAt: true, endsAt: true, shift: { select: { name: true } } } }) : [],
    getSpaceHoursSummary(scope, query, period, now)
  ]);
  const captured = sort === "capturedHours" && records.length ? await workHourReadData.capturedHours(records.map((r) => ({key:r.id,employeeId:r.employeeId,wbLogin:r.wbLogin,shiftDate:r.date}))) : new Map<string, number>();
  const byPartner = new Map(selected.map((p) => [p.id, { records: [] as Array<(typeof records)[number]>, schedules: [] as Array<(typeof schedules)[number]> }]));
  for (const row of records) byPartner.get(row.employeeId)!.records.push(row);
  for (const row of schedules) byPartner.get(row.employeeId)!.schedules.push(row);
  let data = selected.map((p) => summarizePartnerMonth(p, period, today, byPartner.get(p.id)!.records, byPartner.get(p.id)!.schedules, captured, minuteOfDay));
  if (sort !== "employeeName") data = data.sort((a, b) => {
    const value = (row: typeof a) => ["capturedHours", "effectiveHours", "differenceMinutes"].includes(sort) && !row.realizedRecords ? null : row[sort];
    return compareSpaceValues(value(a), value(b), dir) || a.employeeName.localeCompare(b.employeeName, "pt-BR") || a.id.localeCompare(b.id);
  }).slice((page - 1) * 50, page * 50);
  if (sort !== "capturedHours") {
    const pageIds = new Set(data.map((row) => row.employeeId));
    const pageRecords = records.filter((row) => pageIds.has(row.employeeId));
    const pageCapture = pageRecords.length ? await workHourReadData.capturedHours(pageRecords.map((r) => ({key:r.id,employeeId:r.employeeId,wbLogin:r.wbLogin,shiftDate:r.date}))) : new Map<string, number>();
    data = data.map((row) => ({ ...row, capturedHours: byPartner.get(row.employeeId)!.records.reduce((sum, r) => sum + (pageCapture.get(r.id) ?? 0), 0) }));
  }
  return { period, summary, pagination: { page, totalPages: Math.max(1, Math.ceil(partners.length / 50)), total: partners.length }, data };
}
