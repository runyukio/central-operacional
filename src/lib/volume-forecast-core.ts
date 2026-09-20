import {
  FORECAST_DAY,
  FORECAST_HOUR,
  forecastDateAdd,
  isForecastDate,
  type VolumeObservation,
} from "./volume-forecast-time";
import {
  completeForecastDays,
  predictCandidate,
  VOLUME_CANDIDATES,
} from "./volume-forecast-models";
import {
  VOLUME_FORECAST_POLICIES,
  type ForecastPolicyLob,
} from "./volume-forecast-policies";
export {
  FORECAST_DAY,
  FORECAST_HOUR,
  forecastDateAdd,
  forecastDates,
  isForecastDate,
  operationalForecastToday,
  type VolumeObservation,
} from "./volume-forecast-time";
export const VOLUME_FORECAST_VERSION = "volume-v3-lob-hourly-167-complete-cutoff";
export type VolumeModel = string;
export type VolumeForecastPoint = {
  dateKey: string;
  hour: number;
  input: number;
  model: VolumeModel;
  cutoff: string;
};
export type VolumeForecastEvaluation = {
  hours: number;
  days: number;
  actual: number;
  predicted: number;
  absoluteError: number;
  dailyAbsoluteError: number;
  wape: number | null;
  accuracy: number | null;
  dailyAccuracy: number | null;
  bias: number | null;
};
/** Each LOB has one official policy, reused by every consumer. No outcome from the target day enters fitting. */
export function createVolumeForecastEngine(
  observations: VolumeObservation[],
  lob: ForecastPolicyLob = "ADS",
) {
  const byHour = new Map<number, number>();
  for (const row of observations) {
    const timestamp =
      Math.floor(new Date(row.at).getTime() / FORECAST_HOUR) * FORECAST_HOUR;
    if (
      !Number.isFinite(timestamp) ||
      !Number.isFinite(row.input) ||
      row.input < 0
    )
      continue;
    byHour.set(timestamp, (byHour.get(timestamp) ?? 0) + row.input);
  }
  const actuals = [...byHour]
    .sort(([a], [b]) => a - b)
    .map(([timestamp, input]) => ({
      at: new Date(timestamp),
      timestamp,
      input,
    }));
  const days = completeForecastDays(actuals),
    policy = VOLUME_FORECAST_POLICIES[lob];
  const candidate = VOLUME_CANDIDATES.find((c) => c.id === policy.id)!;
  const cache = new Map<string, VolumeForecastPoint[]>();
  function predictDay(dateKey: string, cutoff: string): VolumeForecastPoint[] {
    if (!isForecastDate(dateKey) || !isForecastDate(cutoff) || cutoff > dateKey)
      throw new Error("Invalid forecast date or cutoff");
    const key = dateKey + "|" + cutoff,
      cached = cache.get(key);
    if (cached) return cached;
    const values = predictCandidate(days, dateKey, cutoff, candidate);
    const points =
      values?.map((input, hour) => ({
        dateKey,
        hour,
        input,
        model: policy.id,
        cutoff,
      })) ?? [];
    cache.set(key, points);
    return points;
  }
  return { actuals, predictDay, policy };
}

/** Retrospective reconstruction, not a claim that predictions were issued/stored at the time. */
export function evaluateVolumeForecast(
  engine: ReturnType<typeof createVolumeForecastEngine>,
  dates: string[],
  leadDays = 1,
) {
  const result: VolumeForecastEvaluation = {
    hours: 0,
    days: 0,
    actual: 0,
    predicted: 0,
    absoluteError: 0,
    dailyAbsoluteError: 0,
    wape: null,
    accuracy: null,
    dailyAccuracy: null,
    bias: null,
  };
  const rows: Array<{
    date: string;
    hour: number;
    actual: number;
    forecast: number;
    model: VolumeModel;
  }> = [];
  for (const date of dates) {
    const start = Date.parse(date),
      actual = engine.actuals.filter(
        (r) => r.timestamp >= start && r.timestamp < start + FORECAST_DAY,
      );
    if (actual.length !== 24) continue;
    const prediction = engine.predictDay(
      date,
      forecastDateAdd(date, 1 - leadDays),
    );
    if (prediction.length !== 24) continue;
    let dailyActual = 0,
      dailyPredicted = 0;
    for (const [hour, value] of prediction.entries()) {
      const real = actual[hour].input;
      result.hours++;
      result.absoluteError += Math.abs(real - value.input);
      dailyActual += real;
      dailyPredicted += value.input;
      rows.push({
        date,
        hour,
        actual: real,
        forecast: value.input,
        model: value.model,
      });
    }
    result.days++;
    result.actual += dailyActual;
    result.predicted += dailyPredicted;
    result.dailyAbsoluteError += Math.abs(dailyActual - dailyPredicted);
  }
  if (result.actual > 0) {
    result.wape = result.absoluteError / result.actual;
    result.accuracy = Math.max(0, 1 - result.wape);
    result.dailyAccuracy = Math.max(
      0,
      1 - result.dailyAbsoluteError / result.actual,
    );
    result.bias = (result.predicted - result.actual) / result.actual;
  }
  return { ...result, rows };
}
