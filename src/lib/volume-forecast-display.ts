import type { loadVolumeForecastRange } from "./volume-forecast-service";
export type ForecastPayload = {
  today: string; horizon: number; canImport: boolean; lobs: string[]; warnings: string[];
  series: Array<Awaited<ReturnType<typeof loadVolumeForecastRange>> & { lob: string }>;
};
export type ForecastView = "hour" | "day" | "week";
export type ForecastDisplayRow = { key: string; label: string; real: number | null; forecast: number | null; baseline: number | null; realComplete: boolean; lower: null; upper: null; adjustment: null; confidence: null };
const H = 3_600_000, D = 24 * H;
const label = (at: number, view: ForecastView) => new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit", ...(view === "hour" ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(at);
/** Source cycles already contain Brasil wall-clock time; never apply a second timezone offset. */
export function forecastCycleLabel(value: string | null | undefined) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})[T_\s]+(\d{2})[:-](\d{2})(?::(\d{2})(?:\.\d{1,3})?)?Z?$/);
  if (!match) return "Sem dados";
  const [, year, month, day, hour, minute, second = "00"] = match;
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return new Date(timestamp).toISOString().slice(0, 19) === `${year}-${month}-${day}T${hour}:${minute}:${second}` ? `${day}/${month} · ${hour}:${minute}` : "Sem dados";
}
/** Presentation only: aggregate server-issued points; never refit/predict in the browser. */
export function buildForecastDisplay(payload: ForecastPayload | null, horizon: number, view: ForecastView) {
  const series = payload?.series ?? [], start = payload ? Date.parse(payload.today) : 0;
  const merged = new Map<number, { real: number; realCount: number; completeCount: number; forecast: number; forecastCount: number; baseline: number; baselineCount: number }>();
  const cell = (at: number) => { const row = merged.get(at) ?? { real: 0, realCount: 0, completeCount: 0, forecast: 0, forecastCount: 0, baseline: 0, baselineCount: 0 }; merged.set(at, row); return row; };
  for (const s of series) {
    for (const p of s.points) { const row = cell(Date.parse(p.dateKey) + p.hour * H); row.forecast += p.input; row.forecastCount++; }
    for (const p of s.baselinePoints ?? s.points) { const row = cell(Date.parse(p.dateKey) + p.hour * H); row.baseline += p.input; row.baselineCount++; }
    for (const p of s.actuals) { const row = cell(Date.parse(p.at)); row.real += p.input; row.realCount++; if (p.complete !== false) row.completeCount++; }
  }
  const hourly = [...merged].sort(([a], [b]) => a - b).map(([at, p]) => ({ at, real: p.realCount === series.length ? p.real : null, realComplete: p.realCount === series.length && p.completeCount === series.length, forecast: p.forecastCount === series.length ? p.forecast : null, baseline: p.baselineCount === series.length ? p.baseline : null }));
  const future = hourly.filter((p) => p.at >= start && p.at < start + horizon * D);
  const projected = future.filter(point => point.forecast !== null);
  const sum = (rows: typeof future, expectedHours: number, field: "forecast" | "baseline" = "forecast") => rows.length === expectedHours && rows.every((r) => r[field] !== null) ? rows.reduce((s, r) => s + r[field]!, 0) : null;
  const peak = future.filter((r) => r.forecast !== null).reduce<{ value: number; at: Date | null }>((a, r) => a.at === null || r.forecast! > a.value ? { value: r.forecast!, at: new Date(r.at) } : a, { value: 0, at: null });
  const grouped = new Map<number, { real: number; forecast: number; baseline: number; realCount: number; completeCount: number; forecastCount: number; baselineCount: number; hours: number }>();
  for (const p of hourly) {
    let at = p.at;
    if (view !== "hour") { at = Math.floor(at / D) * D; if (view === "week") at -= (new Date(at).getUTCDay() + 6) % 7 * D; }
    const row = grouped.get(at) ?? { real: 0, forecast: 0, baseline: 0, realCount: 0, completeCount: 0, forecastCount: 0, baselineCount: 0, hours: 0 };
    row.hours++;
    if (p.real !== null) { row.real += p.real; row.realCount++; }
    if (p.realComplete) row.completeCount++;
    if (p.forecast !== null) { row.forecast += p.forecast; row.forecastCount++; }
    if (p.baseline !== null) { row.baseline += p.baseline; row.baselineCount++; }
    grouped.set(at, row);
  }
  const chartRows: ForecastDisplayRow[] = [...grouped].map(([at, p]) => {
    const expected = view === "day" ? 24 : p.hours;
    return { key: new Date(at).toISOString(), label: label(at, view), real: p.realCount ? p.real : null, forecast: p.forecastCount === expected ? p.forecast : null, baseline: p.baselineCount === expected ? p.baseline : null, realComplete: p.realCount === expected && p.completeCount === expected, lower: null, upper: null, adjustment: null, confidence: null };
  });
  const evaluationRows = new Map<string, { actual: number; forecast: number; count: number }>();
  for (const s of series) for (const r of s.evaluation?.rows ?? []) { const key = `${r.date}|${r.hour}`, e = evaluationRows.get(key) ?? { actual: 0, forecast: 0, count: 0 }; e.actual += r.actual; e.forecast += r.forecast; e.count++; evaluationRows.set(key, e); }
  let actual = 0, predicted = 0, error = 0, evaluatedHours = 0;
  const evaluatedDays = new Map<string, {actual:number;forecast:number}>();
  for (const [key,e] of evaluationRows) if (e.count === series.length) {
    actual += e.actual; predicted += e.forecast; error += Math.abs(e.actual - e.forecast); evaluatedHours++;
    const date=key.split("|")[0],day=evaluatedDays.get(date)??{actual:0,forecast:0};day.actual+=e.actual;day.forecast+=e.forecast;evaluatedDays.set(date,day);
  }
  const dailyError=[...evaluatedDays.values()].reduce((sum,day)=>sum+Math.abs(day.actual-day.forecast),0);
  const latest = series.map((s) => s.latestVolumeAt).filter((s): s is string => !!s).sort().at(-1);
  const ads = series.length === 1 && series[0].lob === "ADS" ? series[0] : null;
  const adaptive = ads?.adaptive?.status === "active" && ads.adaptive.info?.active ? { cycle: ads.adaptive.cycle, importedAt: ads.adaptive.importedAt, ...ads.adaptive.info } : null;
  const onlineWarnings = series.flatMap(s => {
    if (s.lob !== "ADS" || !s.adaptive || s.adaptive.status === "active" && s.adaptive.info?.active) return [];
    if (!s.points.some(point => point.dateKey === payload?.today)) return ["ADS: a previsão operacional de hoje está suspensa. A base histórica permanece somente como referência; consulte o motivo nos avisos da fonte."];
    return [s.adaptive.status === "stale"
      ? "ADS: a leitura do Real Time está desatualizada. A revisão de hoje foi suspensa; a base histórica permanece para hoje e os próximos dias."
      : "ADS: a revisão de hoje não está disponível. A base histórica foi preservada, sem tratar dados ausentes como volume zero."];
  });
  return { hasForecast: projected.length > 0, lastRealAt: latest ? new Date(latest) : null,
    projectedUntil: projected.length ? new Date(projected.at(-1)!.at) : null, next24h: sum(future.filter((r) => r.at < start + D), 24), baselineToday: sum(future.filter((r) => r.at < start + D), 24, "baseline"), horizonTotal: sum(future, horizon * 24), peak,
    adjustment: null, accuracy: actual > 0 ? Math.max(0, 1 - error / actual) : null, bias: actual > 0 ? (predicted - actual) / actual : null,
    dailyAccuracy: actual > 0 ? Math.max(0, 1 - dailyError / actual) : null,
    modelLabels: series.map(s=>s.modelLabel), adaptive, hasBaseline: series.some(s => s.lob === "ADS" && !!s.adaptive && !!s.baselinePoints?.length),
    evaluatedHours, horizonHours: horizon * 24, chartRows, tableRows: chartRows,
    warnings: [...new Set([...(payload?.warnings ?? []), ...onlineWarnings, ...series.flatMap((s) => s.warnings)])]
  };
}
