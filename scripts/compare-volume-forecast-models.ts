/** Read-only retrospective tournament. August ranks challengers; separate validation may reject a regression. */
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import {
  VOLUME_FORECAST_LOBS,
  volumeForecastQueueIds,
} from "../src/lib/volume-forecast-service";
import {
  forecastDates,
  createVolumeForecastEngine,
  evaluateVolumeForecast,
} from "./lib/volume-forecast-v2-baseline";
import {
  completeForecastDays,
  VOLUME_CANDIDATES,
  evaluateCandidate,
} from "../src/lib/volume-forecast-models";
import { VOLUME_FORECAST_POLICIES } from "../src/lib/volume-forecast-policies";
async function main() {
  const selection = forecastDates("2026-08-03", "2026-08-30"),
    test = forecastDates("2026-08-31", "2026-09-16");
  console.log(
    JSON.stringify({
      candidates: VOLUME_CANDIDATES.length,
      selection: [selection[0], selection.at(-1)],
      test: [test[0], test.at(-1)],
      objective:
        "70% hourly WAPE + 30% daily WAPE; same complete days; choose without September results",
    }),
  );
  for (const lob of VOLUME_FORECAST_LOBS) {
    const ids = volumeForecastQueueIds(lob),
      rows = await prisma.$queryRaw<
        Array<{ at: Date; input: number }>
      >(Prisma.sql`
   SELECT date_trunc('hour',p."bzTime") AS at,SUM(p."inputCount")::double precision AS input
   FROM "PerformanceQueueVolumeRecord" p LEFT JOIN "PerformanceImportBatch" b ON b.id=p."importBatchId"
   WHERE p."queueId" IN (${Prisma.join(ids)}) AND p."bzTime">='2026-06-01' AND p."bzTime"<'2026-09-17'
     AND p."inputCount">=0 AND (p."importBatchId" IS NULL OR b.status='SUCCESS') GROUP BY 1 ORDER BY 1`);
    const days = completeForecastDays(rows),
      ranked = VOLUME_CANDIDATES.map((c) =>
        evaluateCandidate(days, selection, c),
      )
        .filter((s) => s.days === selection.length && s.objective !== null)
        .sort(
          (a, b) => a.objective! - b.objective! || a.id.localeCompare(b.id),
        );
    const best = ranked[0],
      winner = VOLUME_CANDIDATES.find((c) => c.id === best.id)!;
    const familyBest = [...new Set(ranked.map((s) => s.family))].map((family) =>
      ranked.find((s) => s.family === family),
    );
    const baseline = evaluateVolumeForecast(
      createVolumeForecastEngine(rows),
      test,
    );
    const { rows: _rows, ...baselineScore } = baseline;
    const policy = VOLUME_FORECAST_POLICIES[lob],
      deployed = VOLUME_CANDIDATES.find((c) => c.id === policy.id)!;
    console.log(
      JSON.stringify({
        lob,
        validCandidates: ranked.length,
        selectionWinner: best,
        topTen: ranked.slice(0, 10),
        familyBest,
        test: evaluateCandidate(days, test, winner),
        policy,
        policyTest: evaluateCandidate(days, test, deployed),
        horizons: [7, 14].map((lead) => ({
          lead,
          ...evaluateCandidate(days, test, deployed, lead),
        })),
        baseline: baselineScore,
      }),
    );
  }
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
