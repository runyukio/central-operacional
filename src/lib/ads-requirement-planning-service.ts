import { Prisma } from "@prisma/client";

import { ADS_REQUIREMENT_FORECAST_DAYS, buildAdsShiftRequirements } from "@/lib/ads-requirement-calculator";
import { calculateForecastModelWeights, predictForecastHour, type ForecastActual } from "@/lib/performance-forecast-core";
import { prisma } from "@/lib/prisma";
import { QUEUE_METADATA } from "@/lib/queue-metadata";
import { QUEUE_REPORT_METADATA } from "@/lib/queue-report-metadata";

const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;
const forecastHistoryDays = 120;

export async function buildAdsRequirementPlan(startDate: Date) {
  const queueIds = adsQueueIds();
  if (!queueIds.length) throw new Error("O de/para de filas ADS está vazio.");

  const [latestVolume, latestProduction] = await Promise.all([
    prisma.performanceQueueVolumeRecord.aggregate({
      where: { queueId: { in: queueIds } },
      _max: { bzTime: true }
    }),
    prisma.productionRecord.aggregate({
      where: { queueId: { in: queueIds }, submitNum: { gt: 0 } },
      _max: { bzTime: true }
    })
  ]);
  const latestVolumeAt = latestVolume._max.bzTime;
  const latestProductionAt = latestProduction._max.bzTime;
  if (!latestVolumeAt) throw new Error("Não há volume horário ADS disponível na Performance.");
  if (!latestProductionAt) throw new Error("Não há produção ADS disponível para calcular o AHT.");

  const volumeHistoryStart = new Date(latestVolumeAt.getTime() - forecastHistoryDays * dayMs);
  const ahtEndExclusive = startOfUtcDay(latestProductionAt);
  const ahtStart = new Date(ahtEndExclusive.getTime() - 14 * dayMs);
  const [volumeRows, ahtRows] = await Promise.all([
    prisma.$queryRaw<Array<{ at: Date; input: number }>>(Prisma.sql`
      SELECT
        date_trunc('hour', "bzTime") AS "at",
        COALESCE(SUM("inputCount"), 0)::double precision AS "input"
      FROM "PerformanceQueueVolumeRecord"
      WHERE "queueId" IN (${Prisma.join(queueIds)})
        AND "bzTime" >= ${volumeHistoryStart}
        AND "bzTime" <= ${latestVolumeAt}
      GROUP BY date_trunc('hour', "bzTime")
      ORDER BY date_trunc('hour', "bzTime") ASC
    `),
    prisma.$queryRaw<Array<{ submit: number; moderationSeconds: number }>>(Prisma.sql`
      SELECT
        COALESCE(SUM("submitNum"), 0)::double precision AS "submit",
        COALESCE(SUM("moderationSeconds"), 0)::double precision AS "moderationSeconds"
      FROM "ProductionRecord"
      WHERE "queueId" IN (${Prisma.join(queueIds)})
        AND "bzTime" >= ${ahtStart}
        AND "bzTime" < ${ahtEndExclusive}
        AND "submitNum" > 0
    `)
  ]);

  const actuals = volumeRows
    .map((row) => ({ at: startOfUtcHour(row.at), input: Math.max(0, Number(row.input ?? 0)) }))
    .map<ForecastActual>((row) => ({ ...row, timestamp: row.at.getTime() }))
    .sort((a, b) => a.timestamp - b.timestamp);
  const positiveActuals = actuals.filter((row) => row.input > 0);
  const lastReal = positiveActuals.at(-1) ?? actuals.at(-1);
  if (!lastReal || positiveActuals.length < 48) {
    throw new Error("A série horária ADS não possui histórico suficiente para gerar o forecast.");
  }

  const ahtSubmit = Number(ahtRows[0]?.submit ?? 0);
  const moderationSeconds = Number(ahtRows[0]?.moderationSeconds ?? 0);
  if (ahtSubmit <= 0 || moderationSeconds <= 0) {
    throw new Error("Os 14 dias completos de produção ADS não possuem submit e moderação válidos.");
  }
  const ahtSeconds = moderationSeconds / ahtSubmit;
  const modelWeights = calculateForecastModelWeights(positiveActuals, lastReal.at);
  const actualByHour = new Map(actuals.map((row) => [row.timestamp, row.input]));
  const targetStart = startOfUtcDay(startDate);
  const targetEnd = new Date(targetStart.getTime() + ADS_REQUIREMENT_FORECAST_DAYS * dayMs + 8 * hourMs);
  const hourlyVolumes = [];
  for (let timestamp = targetStart.getTime(); timestamp <= targetEnd.getTime(); timestamp += hourMs) {
    const at = new Date(timestamp);
    const actual = actualByHour.get(timestamp);
    if (actual !== undefined && timestamp <= lastReal.timestamp) {
      hourlyVolumes.push({ at, volume: actual });
      continue;
    }
    const referenceAt = timestamp <= lastReal.timestamp ? new Date(timestamp - hourMs) : lastReal.at;
    const forecast = predictForecastHour(positiveActuals, at, referenceAt, modelWeights).forecast;
    hourlyVolumes.push({ at, volume: Math.max(0, forecast) });
  }

  return {
    requirements: buildAdsShiftRequirements({ startDate: targetStart, hourlyVolumes, ahtSeconds }),
    ahtSeconds,
    ahtPeriod: { startDate: dateKey(ahtStart), endDate: dateKey(new Date(ahtEndExclusive.getTime() - dayMs)) },
    latestVolumeAt,
    latestProductionAt
  };
}

function adsQueueIds() {
  return Array.from(new Set([
    ...Object.entries(QUEUE_METADATA).filter(([, metadata]) => metadata.lob === "ADS").map(([queueId]) => queueId),
    ...Object.entries(QUEUE_REPORT_METADATA).filter(([, metadata]) => metadata.lob === "ADS").map(([queueId]) => queueId)
  ]));
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcHour(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()));
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}
