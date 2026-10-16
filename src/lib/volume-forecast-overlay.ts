import type { AdsForecastRealtimeSource } from "./ads-forecast-realtime-source";
import { buildAdsVolumeNowcast, type AdsVolumeNowcastInfo, type AdsVolumeNowcastReason } from "./ads-volume-nowcast-core";
import type { VolumeForecastPoint } from "./volume-forecast-core";

export type ForecastActual = { at: string; input: number; complete: boolean; source: "Performance" | "Real Time" };
export type AdsForecastAdaptive = {
  status: "active" | "unavailable" | "stale";
  cycle: string | null;
  importedAt: string | null;
  info: AdsVolumeNowcastInfo | null;
  snapshotIntegrity?: "verified" | "incomplete" | "unknown";
};

const reasonMessage: Record<AdsVolumeNowcastReason, string> = {
  "invalid-date": "A data operacional não permite revisar o forecast.",
  "invalid-snapshot": "O horário do ciclo não permite revisar o forecast.",
  "missing-reference": "Falta uma base histórica completa para revisar o dia.",
  "already-adjusted": "A revisão intradia exige a base histórica original.",
  "invalid-observations": "As entradas observadas não cobrem os intervalos necessários para revisar o dia.",
  "unsupported-positive-restart": "Foram recebidas entradas após um histórico zerado. A projeção operacional e a previsão de limpeza ficam suspensas até haver uma referência válida; a base histórica continua visível.",
};

/** Pure overlay, applied after the historical cache. Never train on its own output. */
export function applyAdsForecastOverlay(input: {
  dateKey: string;
  baselinePoints: VolumeForecastPoint[];
  actuals: ForecastActual[];
  source: AdsForecastRealtimeSource;
}) {
  const { source, baselinePoints, dateKey } = input;
  const revised = source.status === "active" && source.snapshotTimestamp !== null
    ? buildAdsVolumeNowcast({ basePoints: baselinePoints, dateKey, snapshotTimestamp: source.snapshotTimestamp, intervals: source.intervals }) : null;
  const active = revised?.info.active === true;
  const actuals = new Map(input.actuals.map(row => [row.at, row]));
  if (active && revised) for (const row of revised.observedPoints) {
    // Real Time complements missing hours; official imported actuals retain precedence.
    if (!actuals.has(row.at)) actuals.set(row.at, { ...row, source: "Real Time" });
  }
  const unsupportedRestart = revised?.info.reason === "unsupported-positive-restart";
  return {
    // A known positive restart cannot become a zero-demand clearance scenario.
    points: active && revised ? revised.points : unsupportedRestart ? baselinePoints.filter(point => point.dateKey < dateKey) : baselinePoints,
    baselinePoints,
    actuals: [...actuals.values()].sort((a, b) => a.at.localeCompare(b.at)),
    adaptive: {
      status: active ? "active" : source.status === "stale" ? "stale" : "unavailable",
      cycle: source.cycle, importedAt: source.importedAt, info: revised?.info ?? null, snapshotIntegrity: source.snapshotIntegrity,
    } as AdsForecastAdaptive,
    warnings: [...source.warnings, ...source.snapshotWarnings, ...(!active && revised?.info.reason ? [reasonMessage[revised.info.reason]] : [])],
  };
}
