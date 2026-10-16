import { parseAdsExecutiveCycle } from "./ads-executive-report-core";
import type { ExecutiveForecastPoint } from "./executive-forecast-core";

const HOUR = 3_600_000;
const HALF_HOUR = HOUR / 2;
const DAY = 24 * HOUR;
// KAP counters follow the China calendar day: midnight there is 13:00 São Paulo.
// Existing source contract: docs/ads-productivity-alerts.md and
// ads-online-productivity-report-core.ts (operational shift accumulation).
const UPSTREAM_RESET_HOUR_BR = 13;
export type GlideDemandHistoryPoint = { cycleDownload: string; input: number };
export type GlideDemandContext = {
  referenceToday: number | null;
  actualToday: number | null;
  expectedToCycle: number | null;
  remainingToday: number | null;
  updatedDayEstimate: number | null;
  observedUntil: number;
  actualRecent3h: number | null;
  expectedRecent3h: number | null;
};

function cycleTimestamp(cycle: string) {
  try {
    const parsed = parseAdsExecutiveCycle(cycle);
    const date = new Date(parsed.timestamp);
    return Number.isFinite(parsed.timestamp) && date.toISOString().slice(0, 10) === parsed.dateKey && date.getUTCHours() === parsed.hour && date.getUTCMinutes() === parsed.minute
      ? parsed.timestamp : null;
  } catch { return null; }
}

/** Cumulative counters are observations, not amounts to sum. Ambiguous duplicates remain unavailable. */
function indexHistory(history: GlideDemandHistoryPoint[], snapshotTimestamp: number) {
  const values = new Map<number, number | null>();
  for (const point of history) {
    const at = cycleTimestamp(point.cycleDownload);
    if (at === null) return null;
    if (at > snapshotTimestamp) continue;
    const value = Number.isFinite(point.input) && point.input >= 0 ? point.input : null;
    if (values.has(at) && values.get(at) !== value) values.set(at, null);
    else if (!values.has(at)) values.set(at, value);
  }
  return [...values].sort(([a], [b]) => a - b);
}

function observedWindow(histories: ReturnType<typeof indexHistory>[], start: number, end: number): number | null {
  if (!histories.length) return null;
  let total = 0;
  for (const history of histories) {
    if (history === null) return null;
    const rows = history.filter(([at]) => at >= start && at <= end);
    if (!rows.length || rows[0][0] !== start || rows.at(-1)![0] !== end || rows.some(([, value]) => value === null)) return null;
    for (let index = 1; index < rows.length; index++) {
      const [at, value] = rows[index], [previousAt, previous] = rows[index - 1];
      if (at - previousAt > HALF_HOUR) return null;
      const clock = new Date(at);
      const knownReset = clock.getUTCHours() === UPSTREAM_RESET_HOUR_BR && clock.getUTCMinutes() === 0;
      // The daily reset can be invisible in small queues (for example 1 -> 2).
      // Other decreases are corrections/inconsistencies, not invented arrivals.
      if (!knownReset && value! < previous!) return null;
      total += knownReset ? value! : value! - previous!;
    }
  }
  return total;
}

function forecastKey(dateKey: string, hour: number) { return `${dateKey}|${hour}`; }

/** A missing/invalid hourly input never becomes zero, including at partial-hour boundaries. */
function expectedWindow(forecast: Map<string, number | null>, start: number, end: number): number | null {
  let total = 0;
  for (let at = Math.floor(start / HOUR) * HOUR; at < end; at += HOUR) {
    const date = new Date(at), value = forecast.get(forecastKey(date.toISOString().slice(0, 10), date.getUTCHours()));
    if (value === undefined || value === null) return null;
    total += value * (Math.min(end, at + HOUR) - Math.max(start, at)) / HOUR;
  }
  return total;
}

/** Read-only context: compares the canonical forecast with observed arrivals without changing any projection. */
export function buildGlideDemandContext(input: {
  snapshotTimestamp: number;
  queueHistories: GlideDemandHistoryPoint[][];
  forecast: ExecutiveForecastPoint[];
}): GlideDemandContext {
  const snapshotDate = new Date(input.snapshotTimestamp);
  if (!Number.isFinite(snapshotDate.getTime())) throw new Error("Ciclo inválido para o contexto de demanda ADS.");
  const dateKey = snapshotDate.toISOString().slice(0, 10);
  const dayStart = Math.floor(input.snapshotTimestamp / DAY) * DAY;
  const dayEnd = dayStart + DAY;
  const byHour = new Map<string, number | null>();
  for (const point of input.forecast) {
    if (!Number.isInteger(point.hour) || point.hour < 0 || point.hour > 23) continue;
    const key = forecastKey(point.dateKey, point.hour);
    const value = Number.isFinite(point.input) && point.input >= 0 ? point.input : null;
    if (byHour.has(key)) byHour.set(key, null);
    else byHour.set(key, value);
  }
  const todayPoints = input.forecast.filter(point => point.dateKey === dateKey);
  const todayComplete = todayPoints.length === 24 && todayPoints.every(point => Number.isInteger(point.hour) && point.hour >= 0 && point.hour <= 23 && byHour.get(forecastKey(dateKey, point.hour)) != null);
  const referenceToday = todayComplete ? expectedWindow(byHour, dayStart, dayEnd) : null;
  const expectedToCycle = todayComplete ? expectedWindow(byHour, dayStart, input.snapshotTimestamp) : null;
  const remainingToday = todayComplete ? expectedWindow(byHour, input.snapshotTimestamp, dayEnd) : null;
  const histories = input.queueHistories.map(history => indexHistory(history, input.snapshotTimestamp));
  const actualToday = observedWindow(histories, dayStart, input.snapshotTimestamp);
  return {
    referenceToday, actualToday, expectedToCycle, remainingToday,
    updatedDayEstimate: actualToday !== null && remainingToday !== null ? actualToday + remainingToday : null,
    observedUntil: input.snapshotTimestamp,
    actualRecent3h: observedWindow(histories, input.snapshotTimestamp - 3 * HOUR, input.snapshotTimestamp),
    expectedRecent3h: expectedWindow(byHour, input.snapshotTimestamp - 3 * HOUR, input.snapshotTimestamp),
  };
}
