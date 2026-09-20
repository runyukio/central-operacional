import { calculateForecastModelWeights, predictForecastHour, type ForecastActual } from "@/lib/performance-forecast-core";

export type ExecutiveForecastPoint = { dateKey: string; hour: number; input: number };

/** Same training, weighting and rounding as the executive report. Never trains on predictions. */
export function buildExecutiveForecastPoints(rows: Array<{ at: Date; input: number }>, dates: string[]) {
  const actuals = rows.map<ForecastActual>((row) => {
    const at = new Date(Date.UTC(row.at.getUTCFullYear(), row.at.getUTCMonth(), row.at.getUTCDate(), row.at.getUTCHours()));
    return { at, timestamp: at.getTime(), input: Math.max(0, Number(row.input ?? 0)) };
  }).filter((row) => row.input > 0).sort((a, b) => a.timestamp - b.timestamp);
  const reference = actuals.at(-1);
  if (!reference || actuals.length < 48) return { points: [] as ExecutiveForecastPoint[], latestVolumeAt: reference?.at.toISOString() ?? null };
  const weights = calculateForecastModelWeights(actuals, reference.at);
  const points = dates.flatMap((dateKey) => Array.from({ length: 24 }, (_, hour) => ({
    dateKey, hour,
    input: Math.max(0, Math.round(predictForecastHour(actuals, new Date(`${dateKey}T${String(hour).padStart(2, "0")}:00:00Z`), reference.at, weights).forecast))
  })));
  return { points, latestVolumeAt: reference.at.toISOString() };
}
