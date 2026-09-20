import { calculateForecastModelWeights, predictForecastHour, type ForecastActual } from "./performance-forecast-core";

export const VOLUME_FORECAST_VERSION = "volume-v2-daily-cutoff";
export const FORECAST_CALIBRATION_DAYS = 14;
export const FORECAST_HOUR = 3_600_000;
export const FORECAST_DAY = 24 * FORECAST_HOUR;
export type VolumeObservation = { at: Date | string; input: number };
export type VolumeModel = "ensemble" | "recent" | "seasonal";
export type VolumeForecastPoint = { dateKey: string; hour: number; input: number; model: VolumeModel; cutoff: string };
export type VolumeForecastEvaluation = { hours: number; days: number; actual: number; predicted: number; absoluteError: number; dailyAbsoluteError: number; wape: number | null; accuracy: number | null; dailyAccuracy: number | null; bias: number | null };
const models: VolumeModel[] = ["ensemble", "recent", "seasonal"];
/** Prefer recency-aware models unless weekly seasonality has a material error advantage. */
export function selectVolumeModel(errors: ReadonlyMap<VolumeModel, number>, days: number): VolumeModel {
  if (days < 7) return "ensemble";
  const baseline = errors.get("ensemble")! <= errors.get("recent")! ? "ensemble" : "recent";
  return errors.get("seasonal")! < errors.get(baseline)! * .85 ? "seasonal" : baseline;
}
export function operationalForecastToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function forecastDateAdd(day: string, days: number) { return new Date(Date.parse(day) + days * FORECAST_DAY).toISOString().slice(0, 10); }
export function forecastDates(start: string, end: string) {
  const dates: string[] = [];
  for (let d = start; d <= end; d = forecastDateAdd(d, 1)) dates.push(d);
  return dates;
}
export function isForecastDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function average(rows: ForecastActual[], reference: number, halfLife: number) {
  let numerator = 0, denominator = 0;
  for (const row of rows) { const weight = 2 ** (-(reference - row.timestamp) / FORECAST_DAY / halfLife); numerator += row.input * weight; denominator += weight; }
  return denominator ? numerator / denominator : null;
}

/** One fitted engine per source snapshot. Fits and calibration only see data strictly before each cutoff. */
export function createVolumeForecastEngine(observations: VolumeObservation[]) {
  const byHour = new Map<number, number>();
  for (const row of observations) {
    const timestamp = Math.floor(new Date(row.at).getTime() / FORECAST_HOUR) * FORECAST_HOUR;
    if (!Number.isFinite(timestamp) || !Number.isFinite(row.input) || row.input < 0) continue;
    byHour.set(timestamp, (byHour.get(timestamp) ?? 0) + row.input);
  }
  const actuals: ForecastActual[] = [...byHour].sort(([a], [b]) => a - b).map(([timestamp, input]) => ({ at: new Date(timestamp), timestamp, input }));
  const fits = new Map<string, ReturnType<typeof fit>>();
  const choices = new Map<string, VolumeModel>();
  function fit(cutoff: string) {
    const end = Date.parse(cutoff), start = end - 120 * FORECAST_DAY;
    const rows = actuals.filter((r) => r.timestamp >= start && r.timestamp < end);
    const reference = rows.at(-1)?.timestamp;
    if (reference === undefined || rows.length < 48) return null;
    const weights = calculateForecastModelWeights(rows, new Date(reference));
    return (model: VolumeModel, target: Date): number | null => {
      // Explicit all-zero histories are observed zeros, not missing input.
      if (rows.every((r) => r.input === 0)) return 0;
      if (model === "ensemble") return Math.max(0, predictForecastHour(rows, target, new Date(reference), weights).forecast);
      const sameHour = rows.filter((r) => r.at.getUTCHours() === target.getUTCHours());
      const recent = average(sameHour.filter((r) => r.timestamp > reference - 7 * FORECAST_DAY), reference, 3.5)
        ?? average(rows.filter((r) => r.timestamp > reference - 7 * FORECAST_DAY), reference, 3.5);
      if (recent === null) return null;
      const seasonal = sameHour.filter((r) => r.at.getUTCDay() === target.getUTCDay());
      if (model === "seasonal") return average(seasonal.filter((r) => r.timestamp > reference - 28 * FORECAST_DAY), reference, 7) ?? recent;
      const three = average(sameHour.filter((r) => r.timestamp > reference - 3 * FORECAST_DAY), reference, 1.5) ?? recent;
      const older = average(seasonal.filter((r) => r.timestamp <= reference - 7 * FORECAST_DAY), reference, 21) ?? recent;
      return .6 * recent + .35 * three + .05 * older;
    };
  }
  function fitted(cutoff: string) { if (!fits.has(cutoff)) fits.set(cutoff, fit(cutoff)); return fits.get(cutoff)!; }
  function choose(cutoff: string): VolumeModel {
    const cached = choices.get(cutoff); if (cached) return cached;
    const end = Date.parse(cutoff), errors = new Map(models.map((m) => [m, 0]));
    let days = 0;
    // Compare whole days with a fixed midnight cutoff, not easier one-hour-ahead tests.
    for (let day = end - FORECAST_CALIBRATION_DAYS * FORECAST_DAY; day < end; day += FORECAST_DAY) {
      const daily = actuals.filter((r) => r.timestamp >= day && r.timestamp < day + FORECAST_DAY);
      if (daily.length !== 24) continue;
      const predict = fitted(new Date(day).toISOString().slice(0, 10)); if (!predict) continue;
      days++;
      for (const model of models) for (const row of daily) errors.set(model, errors.get(model)! + Math.abs(row.input - Math.round(predict(model, row.at) ?? 0)));
    }
    const selected = selectVolumeModel(errors, days);
    choices.set(cutoff, selected); return selected;
  }
  function predictDay(dateKey: string, cutoff: string): VolumeForecastPoint[] {
    if (!isForecastDate(dateKey) || !isForecastDate(cutoff) || cutoff > dateKey) throw new Error("Invalid forecast date or cutoff");
    const prediction = fitted(cutoff); if (!prediction) return [];
    const model = choose(cutoff);
    return Array.from({ length: 24 }, (_, hour) => ({ dateKey, hour, input: Math.round(Math.max(0, prediction(model, new Date(Date.parse(dateKey) + hour * FORECAST_HOUR)) ?? 0)), model, cutoff }));
  }
  return { actuals, predictDay };
}

/** Retrospective reconstruction, not a claim that predictions were issued/stored at the time. */
export function evaluateVolumeForecast(engine: ReturnType<typeof createVolumeForecastEngine>, dates: string[], leadDays = 1) {
  const result: VolumeForecastEvaluation = { hours: 0, days: 0, actual: 0, predicted: 0, absoluteError: 0, dailyAbsoluteError: 0, wape: null, accuracy: null, dailyAccuracy: null, bias: null };
  const rows: Array<{ date: string; hour: number; actual: number; forecast: number; model: VolumeModel }> = [];
  for (const date of dates) {
    const start = Date.parse(date), actual = engine.actuals.filter((r) => r.timestamp >= start && r.timestamp < start + FORECAST_DAY);
    if (actual.length !== 24) continue;
    const prediction = engine.predictDay(date, forecastDateAdd(date, 1 - leadDays)); if (prediction.length !== 24) continue;
    let dailyActual = 0, dailyPredicted = 0;
    for (const [hour, value] of prediction.entries()) {
      const real = actual[hour].input; result.hours++; result.absoluteError += Math.abs(real - value.input);
      dailyActual += real; dailyPredicted += value.input;
      rows.push({ date, hour, actual: real, forecast: value.input, model: value.model });
    }
    result.days++; result.actual += dailyActual; result.predicted += dailyPredicted;
    result.dailyAbsoluteError += Math.abs(dailyActual - dailyPredicted);
  }
  if (result.actual > 0) {
    result.wape = result.absoluteError / result.actual; result.accuracy = Math.max(0, 1 - result.wape);
    result.dailyAccuracy = Math.max(0, 1 - result.dailyAbsoluteError / result.actual);
    result.bias = (result.predicted - result.actual) / result.actual;
  }
  return { ...result, rows };
}
