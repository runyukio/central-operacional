// Shared transport type retained for the existing report/capacity consumers.
export type ExecutiveForecastPoint = {
  dateKey: string;
  hour: number;
  input: number;
  /** Current-day estimates may include an already observed part of the hour. */
  remainingInput?: number;
  /** Operational Brasil wall clock encoded as UTC, not a genuine UTC instant. */
  observedUntil?: number;
};

/** Integrate future demand only; an observed part is already included in live backlog. */
export function forecastRemainingInInterval(point: ExecutiveForecastPoint, start: number, end: number): number | null {
  const hourStart = Date.parse(point.dateKey) + point.hour * 3_600_000, hourEnd = hourStart + 3_600_000;
  if (!Number.isFinite(point.input) || point.input < 0 || !Number.isFinite(hourStart) || end < start) return null;
  if (point.remainingInput === undefined && point.observedUntil === undefined) return point.input * Math.max(0, Math.min(end, hourEnd) - Math.max(start, hourStart)) / 3_600_000;
  if (point.remainingInput === undefined || point.observedUntil === undefined || !Number.isFinite(point.remainingInput) || point.remainingInput < 0 || !Number.isFinite(point.observedUntil) || point.observedUntil < hourStart || point.observedUntil > hourEnd) return null;
  if (point.observedUntil === hourEnd) return point.remainingInput === 0 ? 0 : null;
  const duration = hourEnd - point.observedUntil;
  return point.remainingInput * Math.max(0, Math.min(end, hourEnd) - Math.max(start, point.observedUntil)) / duration;
}
