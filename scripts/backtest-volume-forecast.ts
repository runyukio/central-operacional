/** Read-only, reproducible evaluation. Supply DATABASE_URL through the existing environment.
 * Usage: node --env-file=<private env> --import tsx scripts/backtest-volume-forecast.ts 2026-09-07 2026-09-16
 * Dates are inclusive operational wall-clock dates, as stored by the Performance importer.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { volumeForecastQueueIds, VOLUME_FORECAST_LOBS } from "../src/lib/volume-forecast-service";
import { createVolumeForecastEngine, evaluateVolumeForecast, forecastDateAdd, forecastDates, FORECAST_DAY as D, isForecastDate, VOLUME_FORECAST_VERSION } from "../src/lib/volume-forecast-core";
import { calculateForecastModelWeights, predictForecastHour, type ForecastActual } from "../src/lib/performance-forecast-core";

function mean(rows: ForecastActual[], ref: number, half: number) {
  let n = 0, d = 0;
  for (const r of rows) { const w = 2 ** (-(ref - r.timestamp) / D / half); n += r.input * w; d += w; }
  return d ? n / d : null;
}
// Previous Real Time browser formula, retained only here as a comparison baseline.
function legacyRealtime(rows: ForecastActual[], target: Date, ref: number) {
  const same = rows.filter((r) => r.at.getUTCHours() === target.getUTCHours());
  const seven = mean(same.filter((r) => r.timestamp > ref - 7 * D), ref, 3.5) ?? mean(rows.filter((r) => r.timestamp > ref - 7 * D), ref, 3.5);
  if (seven === null) return null;
  const three = mean(same.filter((r) => r.timestamp > ref - 3 * D), ref, 1.5) ?? seven;
  const older = mean(same.filter((r) => r.at.getUTCDay() === target.getUTCDay() && r.timestamp <= ref - 7 * D), ref, 21) ?? seven;
  return .6 * seven + .35 * three + .05 * older;
}
async function main() {
  const [start = "2026-09-07", end = "2026-09-16"] = process.argv.slice(2);
  if (!isForecastDate(start) || !isForecastDate(end) || end < start || Date.parse(end) - Date.parse(start) > 90 * D) throw new Error("Use an inclusive period of at most 91 days.");
  console.log(JSON.stringify({ version: VOLUME_FORECAST_VERSION, start, end, queryAt: new Date().toISOString(), interpretation: "Retrospective reconstruction from the current export; not an archive of forecasts issued at the time. Only complete 24-hour days. No future observations or predictions enter training." }));
  for (const lob of VOLUME_FORECAST_LOBS) {
    const ids = volumeForecastQueueIds(lob);
    const statement = Prisma.sql`
      SELECT date_trunc('hour',p."bzTime") AS at,SUM(p."inputCount")::double precision AS input
      FROM "PerformanceQueueVolumeRecord" p LEFT JOIN "PerformanceImportBatch" b ON b.id=p."importBatchId"
      WHERE p."queueId" IN (${Prisma.join(ids)}) AND p."bzTime">=${new Date(forecastDateAdd(start, -155))}
        AND p."bzTime"<${new Date(forecastDateAdd(end, 1))} AND p."inputCount">=0
        AND (p."importBatchId" IS NULL OR b.status='SUCCESS')
      GROUP BY 1 ORDER BY 1
    `;
    if (process.argv.includes("--source-only")) { console.log(JSON.stringify({ lob, sql: statement.text, parameters: statement.values })); continue; }
    const raw = await prisma.$queryRaw<Array<{ at: Date; input: number }>>(statement);
    const engine = createVolumeForecastEngine(raw, lob);
    for (const leadDays of [1, 7, 14]) {
      const { rows, ...canonical } = evaluateVolumeForecast(engine, forecastDates(start, end), leadDays);
      const baselines = { previousReport: { predicted: 0, absoluteError: 0, dailyAbsoluteError: 0 }, previousRealtime: { predicted: 0, absoluteError: 0, dailyAbsoluteError: 0 } };
      for (const date of [...new Set(rows.map((r) => r.date))]) {
        const cut = Date.parse(forecastDateAdd(date, 1 - leadDays));
        const training = engine.actuals.filter((r) => r.timestamp < cut && r.timestamp >= cut - 120 * D);
        const ref = training.at(-1)!.timestamp, weights = calculateForecastModelWeights(training, new Date(ref));
        const dayRows = rows.filter((r) => r.date === date);
        for (const key of ["previousReport", "previousRealtime"] as const) {
          let predicted = 0, actual = 0;
          for (const r of dayRows) {
            const at = new Date(Date.parse(date) + r.hour * 3600000);
            const value = key === "previousReport" ? predictForecastHour(training, at, new Date(ref), weights).forecast : legacyRealtime(training, at, ref);
            if (value === null) throw new Error("Baseline coverage differs from canonical coverage.");
            const p = Math.round(value); predicted += p; actual += r.actual; baselines[key].absoluteError += Math.abs(p - r.actual);
          }
          baselines[key].predicted += predicted; baselines[key].dailyAbsoluteError += Math.abs(predicted - actual);
        }
      }
      console.log(JSON.stringify({ lob, leadDays, canonical, modelDays: Object.fromEntries([...new Set(rows.map(r=>r.model))].map((m) => [m, new Set(rows.filter((r) => r.model === m).map((r) => r.date)).size])), baselines: Object.fromEntries(Object.entries(baselines).map(([k, v]) => [k, { ...v, accuracy: canonical.actual > 0 ? Math.max(0, 1 - v.absoluteError / canonical.actual) : null, dailyAccuracy: canonical.actual > 0 ? Math.max(0, 1 - v.dailyAbsoluteError / canonical.actual) : null }])) }));
    }
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
