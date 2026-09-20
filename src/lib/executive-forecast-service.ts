import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { QUEUE_METADATA } from "@/lib/queue-metadata";
import { QUEUE_REPORT_METADATA } from "@/lib/queue-report-metadata";
import { buildExecutiveForecastPoints } from "@/lib/executive-forecast-core";

export function executiveQueueIds(lob: "ADS" | "VIDEO") {
  return Array.from(new Set([
    ...Object.entries(QUEUE_METADATA).filter(([, value]) => value.lob === lob).map(([id]) => id),
    ...Object.entries(QUEUE_REPORT_METADATA).filter(([, value]) => value.lob === lob).map(([id]) => id)
  ]));
}

/** The existing report uses its target day's midnight as cutoff. Planning fixes the same cutoff for all future days. */
export async function loadExecutiveForecastRange(lob: "ADS" | "VIDEO", dates: string[], cutoff: string) {
  const queueIds = executiveQueueIds(lob);
  if (!queueIds.length) return { points: [], latestVolumeAt: null, updatedAt: null };
  const end = new Date(`${cutoff}T00:00:00Z`);
  const start = new Date(end.getTime() - 120 * 86400000);
  const [source] = await prisma.$queryRaw<Array<{ rows: string; updated: string | null; input: string }>>(Prisma.sql`
    SELECT COUNT(*)::text AS "rows", MAX("updatedAt")::text AS "updated", COALESCE(SUM("inputCount"), 0)::text AS "input"
    FROM "PerformanceQueueVolumeRecord"
    WHERE "queueId" IN (${Prisma.join(queueIds)}) AND "bzTime" >= ${start} AND "bzTime" < ${end}
  `);
  const version = createHash("sha256").update(JSON.stringify({ source, queueIds: [...queueIds].sort() })).digest("hex");
  const result = await unstable_cache(async () => {
    const rows = await prisma.$queryRaw<Array<{ at: Date; input: number }>>(Prisma.sql`
      SELECT date_trunc('hour', "bzTime") AS "at", COALESCE(SUM("inputCount"), 0)::double precision AS "input"
      FROM "PerformanceQueueVolumeRecord"
      WHERE "queueId" IN (${Prisma.join(queueIds)}) AND "bzTime" >= ${start} AND "bzTime" < ${end}
      GROUP BY date_trunc('hour', "bzTime") ORDER BY date_trunc('hour', "bzTime") ASC
    `);
    return buildExecutiveForecastPoints(rows, dates);
  }, ["executive-forecast-range-v1", lob, cutoff, dates.join(","), version], { revalidate: 86400 })();
  return { ...result, updatedAt: source?.updated ? new Date(source.updated).toISOString() : null };
}

export async function loadExecutiveForecast(lob: "ADS" | "VIDEO", dateKey: string) {
  return (await loadExecutiveForecastRange(lob, [dateKey], dateKey)).points;
}
