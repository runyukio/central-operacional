import { loadVolumeForecastRange, volumeForecastQueueIds } from "./volume-forecast-service";
export const executiveQueueIds = volumeForecastQueueIds;

// Compatibility adapter only: reports and planning consume the same daily forecast as Performance.
export async function loadExecutiveForecastRange(lob: "ADS" | "VIDEO", dates: string[]) {
  return loadVolumeForecastRange(lob, dates);
}
export async function loadExecutiveForecast(lob: "ADS" | "VIDEO", dateKey: string) {
  return (await loadVolumeForecastRange(lob, [dateKey])).points;
}
