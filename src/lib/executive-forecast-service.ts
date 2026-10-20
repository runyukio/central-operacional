import { loadVolumeForecastRange, volumeForecastQueueIds } from "./volume-forecast-service";
import { forecastComparisonPoints } from "./volume-forecast-comparison";
export const executiveQueueIds = volumeForecastQueueIds;

// Compatibility adapter only: fixed comparisons and operational planning share one source.
export async function loadExecutiveForecastRange(lob: "ADS" | "VIDEO", dates: string[], options: { asOfCycle?: string } = {}) {
  return loadVolumeForecastRange(lob, dates, new Date(), false, options);
}
export async function loadExecutiveForecast(lob: "ADS" | "VIDEO", dateKey: string, options: { asOfCycle?: string } = {}) {
  return forecastComparisonPoints(await loadExecutiveForecastRange(lob, [dateKey], options));
}
