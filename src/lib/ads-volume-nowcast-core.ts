import type { VolumeForecastPoint } from "./volume-forecast-core";
import { isForecastDate } from "./volume-forecast-time";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export type AdsVolumeNowcastInterval = { start: number; end: number; input: number };
export type AdsVolumeNowcastReason = "invalid-date" | "invalid-snapshot" | "missing-reference" | "already-adjusted" | "invalid-observations" | "unsupported-positive-restart";
export type AdsVolumeNowcastInfo = {
  active: boolean;
  reason: AdsVolumeNowcastReason | null;
  dateKey: string;
  referenceToday: number | null;
  actualToday: number | null;
  expectedToCycle: number | null;
  baseRemainingToday: number | null;
  remainingToday: number | null;
  updatedDayEstimate: number | null;
  observedUntil: number | null;
  cumulativeRatio: number | null;
  recent1hRatio: number | null;
  recent3hRatio: number | null;
  nearRatio: number | null;
  intervalCount: number;
  observedHours: number | null;
};
export type AdsVolumeObservedPoint = { at: string; input: number; complete: boolean };
export type AdsVolumeNowcastResult = { points: VolumeForecastPoint[]; info: AdsVolumeNowcastInfo; observedPoints: AdsVolumeObservedPoint[] };

function expectedWindow(prior: number[], start: number, end: number, dayStart: number) {
  let total = 0;
  for (let at = Math.floor(start / HOUR) * HOUR; at < end; at += HOUR) {
    const hour = (at - dayStart) / HOUR;
    total += prior[hour] * (Math.min(end, at + HOUR) - Math.max(start, at)) / HOUR;
  }
  return total;
}

/** Exact observed intervals only: never distribute an actual count uniformly across an unknown hour boundary. */
function actualWindow(intervals: AdsVolumeNowcastInterval[], start: number, end: number): number | null {
  if (start === end) return 0;
  const selected = intervals.filter(interval => interval.start >= start && interval.end <= end);
  if (!selected.length || selected[0].start !== start || selected.at(-1)!.end !== end) return null;
  let previous = start, total = 0;
  for (const interval of selected) {
    if (interval.start !== previous) return null;
    total += interval.input; previous = interval.end;
  }
  return Number.isFinite(total) ? total : null;
}

/** Online current-day estimate. Historical/future-day reference points are never refitted or recursively fed back. */
export function buildAdsVolumeNowcast(input: {
  basePoints: VolumeForecastPoint[];
  dateKey: string;
  snapshotTimestamp: number;
  intervals: AdsVolumeNowcastInterval[];
}): AdsVolumeNowcastResult {
  const info: AdsVolumeNowcastInfo = {
    active: false, reason: null, dateKey: input.dateKey, referenceToday: null, actualToday: null,
    expectedToCycle: null, baseRemainingToday: null, remainingToday: null, updatedDayEstimate: null,
    observedUntil: null, cumulativeRatio: null, recent1hRatio: null, recent3hRatio: null, nearRatio: null,
    intervalCount: input.intervals.length, observedHours: null,
  };
  const inactive = (reason: AdsVolumeNowcastReason): AdsVolumeNowcastResult => ({ points: input.basePoints, info: { ...info, active: false, reason }, observedPoints: [] });
  if (!isForecastDate(input.dateKey)) return inactive("invalid-date");
  const dayStart = Date.parse(`${input.dateKey}T00:00:00Z`), dayEnd = dayStart + DAY;
  const snapshot = input.snapshotTimestamp;
  if (!Number.isSafeInteger(snapshot) || snapshot < dayStart || snapshot > dayEnd) return inactive("invalid-snapshot");
  info.observedUntil = snapshot;
  const today = input.basePoints.filter(point => point.dateKey === input.dateKey);
  if (today.length !== 24 || today.some(point => !Number.isInteger(point.hour) || point.hour < 0 || point.hour > 23 || !Number.isFinite(point.input) || point.input < 0) || new Set(today.map(point => point.hour)).size !== 24) return inactive("missing-reference");
  if (today.some(point => point.remainingInput !== undefined || point.observedUntil !== undefined)) return inactive("already-adjusted");
  const prior = [...today].sort((a, b) => a.hour - b.hour).map(point => point.input);
  const referenceToday = prior.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(referenceToday)) return inactive("missing-reference");
  info.referenceToday = referenceToday;
  info.expectedToCycle = expectedWindow(prior, dayStart, snapshot, dayStart);
  info.baseRemainingToday = expectedWindow(prior, snapshot, dayEnd, dayStart);
  const intervals = [...input.intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  let previous = dayStart;
  for (const interval of intervals) {
    if (!Number.isSafeInteger(interval.start) || !Number.isSafeInteger(interval.end) || interval.start !== previous || interval.end <= interval.start || interval.end > snapshot || !Number.isFinite(interval.input) || interval.input < 0) return inactive("invalid-observations");
    previous = interval.end;
  }
  if (previous !== snapshot) return inactive("invalid-observations");
  const actualToday = actualWindow(intervals, dayStart, snapshot);
  if (actualToday === null) return inactive("invalid-observations");
  info.actualToday = actualToday;
  info.observedHours = (snapshot - dayStart) / HOUR;
  if (referenceToday === 0 && actualToday > 0) return inactive("unsupported-positive-restart");
  const cumulativeSupport = referenceToday * 3 / 24;
  const cumulativeRatio = referenceToday === 0 ? 1 : (actualToday + cumulativeSupport) / (info.expectedToCycle + cumulativeSupport);
  const recentRatio = (hours: number) => {
    const width = Math.min(hours, (snapshot - dayStart) / HOUR);
    if (width === 0) return 1;
    const start = snapshot - width * HOUR, actual = actualWindow(intervals, start, snapshot);
    if (actual === null) return null;
    if (referenceToday === 0) return 1;
    const support = referenceToday * width / 24 / 2;
    return (actual + support) / (expectedWindow(prior, start, snapshot, dayStart) + support);
  };
  const recent1hRatio = recentRatio(1), recent3hRatio = recentRatio(3);
  if (recent1hRatio === null || recent3hRatio === null) return inactive("invalid-observations");
  const nearRatio = 0.5 * cumulativeRatio + 0.25 * recent1hRatio + 0.25 * recent3hRatio;
  if (![cumulativeRatio, recent1hRatio, recent3hRatio, nearRatio].every(Number.isFinite)) return inactive("invalid-observations");
  const adjusted = new Map<number, VolumeForecastPoint>();
  const observedPoints: AdsVolumeObservedPoint[] = [];
  let remainingToday = 0;
  for (const point of today) {
    const hourStart = dayStart + point.hour * HOUR, hourEnd = hourStart + HOUR;
    const observedEnd = Math.min(snapshot, hourEnd);
    const observed = snapshot > hourStart ? actualWindow(intervals, hourStart, observedEnd) : 0;
    if (observed === null) return inactive("invalid-observations");
    if (snapshot >= hourEnd) {
      adjusted.set(point.hour, { ...point, input: observed, remainingInput: 0, observedUntil: hourEnd });
    } else {
      const futureStart = Math.max(snapshot, hourStart), duration = (hourEnd - futureStart) / HOUR;
      const leadHours = ((futureStart + hourEnd) / 2 - snapshot) / HOUR;
      const multiplier = cumulativeRatio + (nearRatio - cumulativeRatio) * Math.max(0, 1 - leadHours / 6);
      const remaining = point.input * duration * multiplier;
      if (!Number.isFinite(remaining)) return inactive("invalid-observations");
      remainingToday += remaining;
      adjusted.set(point.hour, snapshot > hourStart ? { ...point, input: observed + remaining, remainingInput: remaining, observedUntil: snapshot } : { ...point, input: remaining });
    }
    if (snapshot > hourStart) observedPoints.push({ at: new Date(hourStart).toISOString(), input: observed, complete: snapshot >= hourEnd });
  }
  if (!Number.isFinite(remainingToday) || !Number.isFinite(actualToday + remainingToday)) return inactive("invalid-observations");
  return {
    points: input.basePoints.map(point => point.dateKey === input.dateKey ? adjusted.get(point.hour)! : point),
    info: { ...info, active: true, reason: null, remainingToday, updatedDayEstimate: actualToday + remainingToday, cumulativeRatio, recent1hRatio, recent3hRatio, nearRatio },
    observedPoints: observedPoints.sort((a, b) => a.at.localeCompare(b.at)),
  };
}
