import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { addCapacityDays, capacityDate, capacityDay } from "./ads-capacity-core";
import { isAbsenceStatus, isScheduledStatus, normalizeOperationalStatus } from "./attendance-calculation";
import { isAgentJobTitle } from "./job-title-normalization";

export type ObservedAdsGlideAbs = {
  rate: number | null;
  startDate: string;
  endDate: string;
  planned: number;
  absent: number;
  daysWithSchedules: number;
  unresolvedScheduled: number;
  updatedAt: string | null;
  warnings: string[];
};
export type ObservedAdsAbsStatusRow = {
  dateKey: string;
  roleTitle: string;
  status: string;
  rows: number;
  updatedAt: Date | string | null;
};

function observedPeriod(today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !Number.isFinite(capacityDay(today)) || capacityDate(capacityDay(today)) !== today) throw new Error("Data operacional inválida para ABS observado.");
  return { startDate: addCapacityDays(today, -7), endDate: addCapacityDays(today, -1), today };
}

/** Aggregate source only: caller must authorize before exposing operational planning data. */
export function observedAdsGlideAbsQuery(today: string) {
  const period = observedPeriod(today);
  return Prisma.sql`
    SELECT s.date::date::text AS "dateKey", e."roleTitle", s.status::text AS status,
      COUNT(*)::integer AS rows, MAX(s."updatedAt") AS "updatedAt"
    FROM "Schedule" s
    JOIN "EmployeeProfile" e ON e.id=s."employeeId"
    JOIN "Lob" employee_lob ON employee_lob.id=e."lobId"
    LEFT JOIN "Lob" slot_lob ON slot_lob.id=s."lobId"
    WHERE s."deletedAt" IS NULL AND employee_lob.name='ADS'
      AND (slot_lob.name='ADS' OR s."lobId" IS NULL)
      AND s.date>=${new Date(capacityDay(period.startDate))}
      AND s.date<${new Date(capacityDay(period.today))}
    GROUP BY s.date::date, e."roleTitle", s.status
    ORDER BY s.date::date, e."roleTitle", s.status
  `;
}

/** Keep zero observed absences distinct from missing or unresolved schedule history. */
export function summarizeObservedAdsGlideAbs(today: string, rows: ObservedAdsAbsStatusRow[]): ObservedAdsGlideAbs {
  const period = observedPeriod(today), dates = new Set<string>();
  let planned = 0, absent = 0, unresolvedScheduled = 0, invalidRows = false;
  let updatedAt: string | null = null;
  for (const row of rows) {
    // SQL deliberately aggregates job titles first; the existing JS classifier
    // then handles aliases, accents and repeated spaces exactly, without personal rows.
    if (!isAgentJobTitle(row.roleTitle) || row.dateKey < period.startDate || row.dateKey >= period.today) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.dateKey) || !Number.isFinite(capacityDay(row.dateKey)) || capacityDate(capacityDay(row.dateKey)) !== row.dateKey || !Number.isSafeInteger(row.rows) || row.rows <= 0 || normalizeOperationalStatus(row.status) === null) {
      invalidRows = true;
      continue;
    }
    dates.add(row.dateKey);
    if (isScheduledStatus(row.status)) planned += row.rows;
    if (isAbsenceStatus(row.status)) absent += row.rows;
    if (normalizeOperationalStatus(row.status) === "ESCALADO") unresolvedScheduled += row.rows;
    const timestamp = row.updatedAt instanceof Date ? row.updatedAt.getTime() : row.updatedAt ? Date.parse(row.updatedAt) : NaN;
    if (Number.isFinite(timestamp)) {
      const value = new Date(timestamp).toISOString();
      if (updatedAt === null || value > updatedAt) updatedAt = value;
    }
  }
  const warnings: string[] = [];
  if (dates.size !== 7) warnings.push(`ABS observado indisponível: há cronogramas em ${dates.size} dos 7 dias completos de referência. Dias ausentes não viram ABS zero.`);
  if (planned === 0) warnings.push("ABS observado indisponível: não há dias escalados elegíveis no período. A ausência de denominador não é tratada como 0%.");
  if (unresolvedScheduled > 0) warnings.push(`ABS observado indisponível: ${unresolvedScheduled} dias de cronograma ainda estão como Escalado no período encerrado.`);
  if (invalidRows || absent > planned) warnings.push("ABS observado indisponível: há contagens, status ou datas inconsistentes na base de cronogramas.");
  return { rate: warnings.length ? null : absent / planned, startDate: period.startDate, endDate: period.endDate,
    planned, absent, daysWithSchedules: dates.size, unresolvedScheduled, updatedAt, warnings };
}

/** Read only; a missing reference never restores the former fixed 7.5% assumption. */
export async function readObservedAdsGlideAbs(today: string): Promise<ObservedAdsGlideAbs> {
  const rows = await prisma.$queryRaw<ObservedAdsAbsStatusRow[]>(observedAdsGlideAbsQuery(today));
  return summarizeObservedAdsGlideAbs(today, rows);
}
