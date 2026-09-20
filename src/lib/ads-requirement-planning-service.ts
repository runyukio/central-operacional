import { Prisma } from "@prisma/client";
import { ADS_REQUIREMENT_FORECAST_DAYS, buildAdsShiftRequirements } from "./ads-requirement-calculator";
import { prisma } from "./prisma";
import { loadVolumeForecastRange, volumeForecastQueueIds } from "./volume-forecast-service";
import { forecastDateAdd, forecastDates } from "./volume-forecast-core";

const dayMs = 86400000;
export async function buildAdsRequirementPlan(startDate: Date) {
  const queueIds = volumeForecastQueueIds("ADS");
  const start = startOfUtcDay(startDate), startKey = dateKey(start);
  const [forecast, latestProduction] = await Promise.all([
    loadVolumeForecastRange("ADS", forecastDates(startKey, forecastDateAdd(startKey, ADS_REQUIREMENT_FORECAST_DAYS))),
    prisma.productionRecord.aggregate({ where: { queueId: { in: queueIds }, submitNum: { gt: 0 } }, _max: { bzTime: true } })
  ]);
  const latestProductionAt = latestProduction._max.bzTime;
  if (!forecast.points.length || !forecast.latestVolumeAt) throw new Error("Não há histórico suficiente para gerar o forecast único ADS.");
  if (!latestProductionAt) throw new Error("Não há produção ADS disponível para calcular o AHT.");
  const ahtEndExclusive = startOfUtcDay(latestProductionAt);
  const ahtStart = new Date(ahtEndExclusive.getTime() - 14 * dayMs);
  const ahtRows = await prisma.$queryRaw<Array<{ submit: number; moderationSeconds: number }>>(Prisma.sql`
    SELECT COALESCE(SUM("submitNum"),0)::double precision AS submit,
      COALESCE(SUM("moderationSeconds"),0)::double precision AS "moderationSeconds"
    FROM "ProductionRecord"
    WHERE "queueId" IN (${Prisma.join(queueIds)}) AND "bzTime">=${ahtStart} AND "bzTime"<${ahtEndExclusive} AND "submitNum">0
  `);
  const submit = Number(ahtRows[0]?.submit ?? 0), seconds = Number(ahtRows[0]?.moderationSeconds ?? 0);
  if (submit <= 0 || seconds <= 0) throw new Error("Os 14 dias completos de produção ADS não possuem submit e moderação válidos.");
  const ahtSeconds = seconds / submit;
  const hourlyVolumes = forecast.points.map((p) => ({ at: new Date(Date.parse(p.dateKey) + p.hour * 3600000), volume: p.input }));
  return {
    requirements: buildAdsShiftRequirements({ startDate: start, hourlyVolumes, ahtSeconds }),
    ahtSeconds,
    ahtPeriod: { startDate: dateKey(ahtStart), endDate: dateKey(new Date(ahtEndExclusive.getTime() - dayMs)) },
    latestVolumeAt: new Date(forecast.latestVolumeAt),
    latestProductionAt, forecastVersion: forecast.modelVersion, forecastCutoff: forecast.cutoff
  };
}
function startOfUtcDay(date: Date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); }
function dateKey(date: Date) { return date.toISOString().slice(0, 10); }
