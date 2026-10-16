import { loadVolumeForecastRange, volumeForecastQueueIds } from "./volume-forecast-service";
export const executiveQueueIds = volumeForecastQueueIds;

// Compatibility adapter only: reports and planning consume the same daily forecast as Performance.
export async function loadExecutiveForecastRange(lob: "ADS" | "VIDEO", dates: string[], options: { asOfCycle?: string } = {}) {
  return loadVolumeForecastRange(lob, dates, new Date(), false, options);
}
export async function loadExecutiveForecast(lob: "ADS" | "VIDEO", dateKey: string, options: { asOfCycle?: string } = {}) {
  return (await loadExecutiveForecastRange(lob, [dateKey], options)).points;
}
