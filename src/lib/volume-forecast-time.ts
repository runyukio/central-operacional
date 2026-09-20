export const FORECAST_HOUR = 3_600_000;
export const FORECAST_DAY = 24 * FORECAST_HOUR;
export type VolumeObservation = { at: Date | string; input: number };
export function operationalForecastToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function forecastDateAdd(day: string, days: number) {
  return new Date(Date.parse(day) + days * FORECAST_DAY)
    .toISOString()
    .slice(0, 10);
}
export function forecastDates(start: string, end: string) {
  const dates: string[] = [];
  for (let d = start; d <= end; d = forecastDateAdd(d, 1)) dates.push(d);
  return dates;
}
export function isForecastDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
