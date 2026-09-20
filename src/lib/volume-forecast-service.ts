import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";
import { prisma } from "./prisma";
import { allPerformanceQueueIds, getPerformanceQueueMetadataById } from "./performance-service";
import { createVolumeForecastEngine, evaluateVolumeForecast, forecastDateAdd, forecastDates, isForecastDate, operationalForecastToday, VOLUME_FORECAST_VERSION } from "./volume-forecast-core";
export const VOLUME_FORECAST_LOBS = ["ADS", "VIDEO", "COMMENTS"] as const;
export type VolumeForecastLob = typeof VOLUME_FORECAST_LOBS[number];
export function volumeForecastQueueIds(lob: string) { return allPerformanceQueueIds().filter((id) => getPerformanceQueueMetadataById(id).lob === lob).sort(); }

/** Internal read-only source. Public entry points must check their existing permissions first. */
export async function loadVolumeForecastRange(lob: VolumeForecastLob, requestedDates: string[], now = new Date(), withEvaluation = false) {
  const dates = [...new Set(requestedDates)].sort();
  if (!dates.length || dates.length > 40 || dates.some((d) => !isForecastDate(d))) throw new Error("Período inválido para forecast.");
  const today = operationalForecastToday(now), lastCutoff = dates.at(-1)! < today ? dates.at(-1)! : today;
  const firstCutoff = dates[0] < today ? dates[0] : today;
  // 120 training days + evaluation/coverage buffer, independent of requested range.
  const start = new Date(forecastDateAdd(firstCutoff, -142));
  const end = new Date(forecastDateAdd(lastCutoff, 1));
  const queueIds = volumeForecastQueueIds(lob);
  if (!queueIds.length) throw new Error("LOB sem de/para para forecast de volume.");
  const predicate = Prisma.sql`p."queueId" IN (${Prisma.join(queueIds)}) AND p."bzTime">=${start} AND p."bzTime"<${end} AND p."inputCount">=0 AND (p."importBatchId" IS NULL OR b.status='SUCCESS')`;
  const [source] = await prisma.$queryRaw<Array<{ rows: string; updated: string | null; input: string }>>(Prisma.sql`
    SELECT COUNT(*)::text AS rows,MAX(p."updatedAt")::text AS updated,COALESCE(SUM(p."inputCount"),0)::text AS input
    FROM "PerformanceQueueVolumeRecord" p LEFT JOIN "PerformanceImportBatch" b ON b.id=p."importBatchId" WHERE ${predicate}
  `);
  const version = createHash("sha256").update(JSON.stringify({ source, queueIds, model: VOLUME_FORECAST_VERSION })).digest("hex");
  return unstable_cache(async () => {
    const rows = await prisma.$queryRaw<Array<{ at: Date; input: number }>>(Prisma.sql`
      SELECT date_trunc('hour',p."bzTime") AS at,SUM(p."inputCount")::double precision AS input
      FROM "PerformanceQueueVolumeRecord" p LEFT JOIN "PerformanceImportBatch" b ON b.id=p."importBatchId" WHERE ${predicate}
      GROUP BY 1 ORDER BY 1
    `);
    const engine = createVolumeForecastEngine(rows, lob);
    const points = dates.flatMap((date) => engine.predictDay(date, date < today ? date : today));
    const latest = engine.actuals.at(-1);
    const lastComplete = latest ? Math.min(Date.parse(today) - 86400000, Date.parse(latest.at.toISOString().slice(0, 10)) - (latest.at.getUTCHours() < 23 ? 86400000 : 0)) : null;
    const evaluation = withEvaluation && lastComplete !== null ? evaluateVolumeForecast(engine, forecastDates(new Date(lastComplete - 6 * 86400000).toISOString().slice(0, 10), new Date(lastComplete).toISOString().slice(0, 10))) : null;
    return {
      points, actuals: engine.actuals.filter((r) => dates.includes(r.at.toISOString().slice(0, 10))).map((r) => ({ at: r.at.toISOString(), input: r.input })),
      latestVolumeAt: latest?.at.toISOString() ?? null, updatedAt: source?.updated ? new Date(source.updated).toISOString() : null,
      version, modelVersion: VOLUME_FORECAST_VERSION, modelLabel: engine.policy.label, cutoff: lastCutoff, evaluation,
      warnings: [
        ...(points.length < dates.length * 24 ? ["Histórico insuficiente para parte do período nesta LOB. São necessários dias completos; ausência não é considerada zero."] : []),
        ...(latest && Date.parse(today) - latest.timestamp > 86400000 ? ["A base de volume está desatualizada. O forecast utiliza somente o último realizado disponível, sem inventar observações."] : [])
      ]
    };
  }, ["volume-forecast", VOLUME_FORECAST_VERSION, lob, today, dates.join(","), version, String(withEvaluation)], { revalidate: 86400 })();
}
