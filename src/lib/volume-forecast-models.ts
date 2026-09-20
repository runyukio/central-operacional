import {
  FORECAST_DAY as D,
  FORECAST_HOUR as H,
  type VolumeObservation,
} from "./volume-forecast-time";
import {
  calculateForecastModelWeights,
  predictForecastHour,
  type ForecastActual,
  type ForecastModelWeights,
} from "./performance-forecast-core";

type Profile = { window: number; group: "all" | "weekday" | "daytype" };
type Daily = {
  window: number;
  weekday?: boolean;
  halfLife?: number;
  alpha?: number;
  beta?: number;
  ensemble?: boolean;
};
export type ForecastCandidate = {
  id: string;
  family: string;
  kind: "naive" | "hourly" | "blend" | "profile" | "ensemble" | "recent95";
  window: number;
  halfLife?: number;
  weekday?: boolean;
  short?: number;
  weight?: number;
  daily?: Daily;
  profile?: Profile;
};
export const VOLUME_CANDIDATES: ForecastCandidate[] = [
  {
    id: "report-ensemble",
    family: "Ensemble ajustado existente",
    kind: "ensemble",
    window: 120,
  },
  {
    id: "realtime-recent",
    family: "Recente 95% existente",
    kind: "recent95",
    window: 120,
  },
  ...[1, 7, 14].map((window) => ({
    id: `naive-${window}d`,
    family: "Sazonal ingênuo",
    kind: "naive" as const,
    window,
  })),
  ...[2, 3, 7, 14, 28, 56, 84, 120].map((window) => ({
    id: `hour-mean-${window}d`,
    family: "Média móvel por hora",
    kind: "hourly" as const,
    window,
  })),
  ...[14, 28, 56, 120].flatMap((window) =>
    [1, 3, 7, 14].map((halfLife) => ({
      id: `hour-ewma-${window}d-h${halfLife}`,
      family: "Média exponencial por hora",
      kind: "hourly" as const,
      window,
      halfLife,
    })),
  ),
  ...[14, 28, 56, 84, 120].flatMap((window) =>
    [0, 7, 14, 28].map((halfLife) => ({
      id: `weekday-${window}d-h${halfLife}`,
      family: "Dia da semana e hora",
      kind: "hourly" as const,
      window,
      halfLife,
      weekday: true,
    })),
  ),
  ...[3, 7].flatMap((short) =>
    [28, 56, 84].flatMap((window) =>
      [0.5, 0.75, 0.9].map((weight) => ({
        id: `blend-${short}-${window}-${weight}`,
        family: "Curto + longo prazo",
        kind: "blend" as const,
        window,
        short,
        weight,
      })),
    ),
  ),
  ...[28, 56].flatMap((window) =>
    [0.25, 0.5, 0.75, 0.9].map((weight) => ({
      id: `seasonal-recent-${window}-${weight}`,
      family: "Recente + sazonal",
      kind: "blend" as const,
      window,
      short: 7,
      weight,
      weekday: true,
    })),
  ),
  ...(
    [
      { window: 3 },
      { window: 7 },
      { window: 14 },
      { window: 28 },
      { window: 28, halfLife: 7 },
      { window: 28, weekday: true },
      { window: 56, weekday: true },
      { window: 120, ensemble: true },
    ] as Daily[]
  ).flatMap((daily) =>
    (
      [
        { window: 7, group: "all" },
        { window: 14, group: "all" },
        { window: 28, group: "all" },
        { window: 56, group: "all" },
        { window: 84, group: "all" },
        { window: 120, group: "all" },
        { window: 28, group: "weekday" },
        { window: 56, group: "weekday" },
        { window: 14, group: "daytype" },
        { window: 28, group: "daytype" },
      ] as Profile[]
    ).map((profile) => ({
      id: `daily-${daily.window}${daily.weekday ? "wd" : ""}${daily.ensemble ? "ensemble" : ""}-h${daily.halfLife ?? 0}-profile-${profile.window}-${profile.group}`,
      family: "Total diário × curva horária",
      kind: "profile" as const,
      window: Math.max(daily.window, profile.window),
      daily,
      profile,
    })),
  ),
  ...[0.2, 0.5, 0.8].flatMap((alpha) =>
    [0.05, 0.2].flatMap((beta) =>
      (
        [
          { window: 14, group: "all" },
          { window: 28, group: "weekday" },
        ] as Profile[]
      ).map((profile) => ({
        id: `holt-${alpha}-${beta}-profile-${profile.window}-${profile.group}`,
        family: "Tendência amortecida × curva horária",
        kind: "profile" as const,
        window: 56,
        daily: { window: 56, alpha, beta },
        profile,
      })),
    ),
  ),
];
export type ForecastDay = {
  date: string;
  at: number;
  weekday: number;
  values: number[];
  total: number;
};
export function completeForecastDays(
  observations: VolumeObservation[],
): ForecastDay[] {
  const hours = new Map<number, number>();
  for (const r of observations) {
    const at = Math.floor(new Date(r.at).getTime() / H) * H;
    if (Number.isFinite(at) && Number.isFinite(r.input) && r.input >= 0)
      hours.set(at, (hours.get(at) ?? 0) + r.input);
  }
  const starts = [
    ...new Set([...hours.keys()].map((at) => Math.floor(at / D) * D)),
  ].sort((a, b) => a - b);
  return starts.flatMap((at) => {
    const values = Array.from({ length: 24 }, (_, h) => hours.get(at + h * H));
    return values.every((v): v is number => v !== undefined)
      ? [
          {
            date: new Date(at).toISOString().slice(0, 10),
            at,
            weekday: new Date(at).getUTCDay(),
            values,
            total: values.reduce((s, v) => s + v, 0),
          },
        ]
      : [];
  });
}
function average(
  rows: ForecastDay[],
  reference: number,
  value: (r: ForecastDay) => number,
  halfLife = 0,
) {
  let n = 0,
    d = 0;
  for (const r of rows) {
    const w = halfLife ? 2 ** (-(reference - r.at) / D / halfLife) : 1;
    n += w * value(r);
    d += w;
  }
  return d ? n / d : null;
}
function chooseDays(
  days: ForecastDay[],
  cut: number,
  window: number,
  weekday?: number,
) {
  return days.filter(
    (r) =>
      r.at < cut &&
      r.at >= cut - window * D &&
      (weekday === undefined || r.weekday === weekday),
  );
}
function hourly(
  rows: ForecastDay[],
  target: number,
  cut: number,
  c: Pick<ForecastCandidate, "window" | "halfLife" | "weekday">,
) {
  const selected = chooseDays(
    rows,
    cut,
    c.window,
    c.weekday ? new Date(target).getUTCDay() : undefined,
  );
  if (selected.length < 2) return null;
  return Array.from(
    { length: 24 },
    (_, h) => average(selected, cut, (r) => r.values[h], c.halfLife)!,
  );
}
function dailyTotal(
  rows: ForecastDay[],
  target: number,
  cut: number,
  c: Daily,
) {
  if (c.ensemble)
    return ensemble(rows, target, cut)?.reduce((s, v) => s + v, 0) ?? null;
  const selected = chooseDays(
    rows,
    cut,
    c.window,
    c.weekday ? new Date(target).getUTCDay() : undefined,
  );
  if (selected.length < 2) return null;
  if (c.alpha === undefined)
    return average(selected, cut, (r) => r.total, c.halfLife);
  // Damped Holt trend, fitted only to consecutive observed days. Missing dates are not synthetic zeros.
  if (
    selected.length < 7 ||
    selected.some((r, i) => i > 0 && r.at - selected[i - 1].at !== D)
  )
    return null;
  let level = selected[0].total,
    trend = 0;
  const phi = 0.8,
    alpha = c.alpha,
    beta = c.beta!;
  for (const r of selected.slice(1)) {
    const next = alpha * r.total + (1 - alpha) * (level + phi * trend);
    trend = beta * (next - level) + (1 - beta) * phi * trend;
    level = next;
  }
  const steps = (target - selected.at(-1)!.at) / D,
    damped = (phi * (1 - phi ** steps)) / (1 - phi);
  return Math.max(0, level + damped * trend);
}
const ensembleFits = new WeakMap<
  ForecastDay[],
  Map<number, { rows: ForecastActual[]; weights: ForecastModelWeights }>
>();
function ensemble(days: ForecastDay[], target: number, cut: number) {
  const fits = ensembleFits.get(days) ?? new Map();
  ensembleFits.set(days, fits);
  if (!fits.has(cut)) {
    const rows = chooseDays(days, cut, 120).flatMap((d) =>
      d.values.map((input, hour) => ({
        input,
        at: new Date(d.at + hour * H),
        timestamp: d.at + hour * H,
      })),
    );
    if (rows.length < 48) return null;
    fits.set(cut, {
      rows,
      weights: calculateForecastModelWeights(rows, rows.at(-1)!.at),
    });
  }
  const fit = fits.get(cut)!;
  return Array.from(
    { length: 24 },
    (_, hour) =>
      predictForecastHour(
        fit.rows,
        new Date(target + hour * H),
        fit.rows.at(-1)!.at,
        fit.weights,
      ).forecast,
  );
}
function profile(rows: ForecastDay[], target: number, cut: number, c: Profile) {
  const weekday = new Date(target).getUTCDay(),
    weekend = (d: number) => d === 0 || d === 6;
  let selected = chooseDays(
    rows,
    cut,
    c.window,
    c.group === "weekday" ? weekday : undefined,
  );
  if (c.group === "daytype")
    selected = selected.filter((r) => weekend(r.weekday) === weekend(weekday));
  if (selected.length < 2) return null;
  const total = selected.reduce((s, r) => s + r.total, 0);
  return total > 0
    ? Array.from(
        { length: 24 },
        (_, h) => selected.reduce((s, r) => s + r.values[h], 0) / total,
      )
    : (Array(24).fill(1 / 24) as number[]);
}
// Match the service's fixed coverage budget for every cutoff, independently of
// extra history fetched for a wider requested range. Cache snapshots so the
// tournament and multi-day forecasts can reuse ensemble fits.
const trainingSnapshots = new WeakMap<ForecastDay[], Map<number, ForecastDay[]>>();
function trainingSnapshot(days: ForecastDay[], cutoff: number) {
  let snapshots = trainingSnapshots.get(days);
  if (!snapshots) { snapshots = new Map(); trainingSnapshots.set(days, snapshots); }
  let snapshot = snapshots.get(cutoff);
  if (!snapshot) {
    snapshot = days.filter(day => day.at < cutoff && day.at >= cutoff - 142 * D);
    snapshots.set(cutoff, snapshot);
  }
  return snapshot;
}
/** Candidate library shared by the offline tournament and the production per-LOB selector. */
export function predictCandidate(
  days: ForecastDay[],
  date: string,
  cutoff: string,
  c: ForecastCandidate,
): number[] | null {
  const target = Date.parse(date),
    requestedCut = Date.parse(cutoff);
  if (!Number.isFinite(target) || !Number.isFinite(requestedCut) || requestedCut > target)
    throw new Error("Invalid candidate cutoff");
  days = trainingSnapshot(days, requestedCut);
  // Stale imports: anchor windows to the latest complete observed day before
  // the allowed cutoff. Missing subsequent days are not zero or synthetic data.
  const lastObserved = days.findLast((day) => day.at < requestedCut);
  if (!lastObserved) return null;
  const cut = Math.min(requestedCut, lastObserved.at + D);
  let values: number[] | null = null;
  if (c.kind === "ensemble") values = ensemble(days, target, cut);
  if (c.kind === "recent95") {
    const seven = hourly(days, target, cut, { window: 7, halfLife: 3.5 }),
      three = hourly(days, target, cut, { window: 3, halfLife: 1.5 });
    const older = days.filter(
      (r) =>
        r.at < cut - 7 * D &&
        r.at >= cut - 120 * D &&
        r.weekday === new Date(target).getUTCDay(),
    );
    if (seven)
      values = seven.map(
        (v, h) =>
          0.6 * v +
          0.35 * (three?.[h] ?? v) +
          0.05 * (average(older, cut, (r) => r.values[h], 21) ?? v),
      );
  }
  if (c.kind === "naive") {
    // Repeat the last observed seasonal phase for multi-day horizons; never feed predictions back.
    const lag =
      Math.max(1, Math.ceil((target - cut + 1) / (c.window * D))) *
      c.window *
      D;
    values =
      days.find((r) => r.at === target - lag && r.at < cut)?.values ?? null;
  }
  if (c.kind === "hourly") values = hourly(days, target, cut, c);
  if (c.kind === "blend") {
    const short = hourly(days, target, cut, { window: c.short! }),
      long = hourly(days, target, cut, {
        window: c.window,
        weekday: c.weekday,
      });
    if (short && long)
      values = short.map((v, h) => v * c.weight! + long[h] * (1 - c.weight!));
  }
  if (c.kind === "profile") {
    const total = dailyTotal(days, target, cut, c.daily!),
      shape = profile(days, target, cut, c.profile!);
    if (total !== null && shape) values = shape.map((v) => total * v);
  }
  return values?.every((v) => Number.isFinite(v) && v >= 0)
    ? values.map((v) => Math.max(0, Math.round(v)))
    : null;
}
export type CandidateScore = {
  id: string;
  family: string;
  days: number;
  hours: number;
  actual: number;
  predicted: number;
  hourlyError: number;
  dailyError: number;
  shapeError: number;
  peakHourError: number;
  hourlyWape: number | null;
  dailyWape: number | null;
  shapeWape: number | null;
  peakHours: number | null;
  objective: number | null;
};
export function evaluateCandidate(
  days: ForecastDay[],
  dates: string[],
  c: ForecastCandidate,
  leadDays = 1,
): CandidateScore {
  const score: CandidateScore = {
    id: c.id,
    family: c.family,
    days: 0,
    hours: 0,
    actual: 0,
    predicted: 0,
    hourlyError: 0,
    dailyError: 0,
    shapeError: 0,
    peakHourError: 0,
    hourlyWape: null,
    dailyWape: null,
    shapeWape: null,
    peakHours: null,
    objective: null,
  };
  for (const date of dates) {
    const actual = days.find((r) => r.date === date);
    if (!actual) continue;
    const prediction = predictCandidate(
      days,
      date,
      new Date(Date.parse(date) - (leadDays - 1) * D)
        .toISOString()
        .slice(0, 10),
      c,
    );
    if (!prediction) continue;
    const total = prediction.reduce((s, v) => s + v, 0);
    score.days++;
    score.hours += 24;
    score.actual += actual.total;
    score.predicted += total;
    score.dailyError += Math.abs(total - actual.total);
    score.hourlyError += prediction.reduce(
      (s, v, h) => s + Math.abs(v - actual.values[h]),
      0,
    );
    if (actual.total > 0 && total > 0)
      score.shapeError += actual.values.reduce(
        (s, v, h) => s + Math.abs(v - (prediction[h] * actual.total) / total),
        0,
      );
    else score.shapeError += actual.total;
    const peak = (v: number[]) => v.indexOf(Math.max(...v));
    score.peakHourError += Math.abs(peak(prediction) - peak(actual.values));
  }
  if (score.actual > 0) {
    score.hourlyWape = score.hourlyError / score.actual;
    score.dailyWape = score.dailyError / score.actual;
    score.shapeWape = score.shapeError / score.actual;
    score.peakHours = score.peakHourError / score.days;
    score.objective = 0.7 * score.hourlyWape + 0.3 * score.dailyWape;
  }
  return score;
}
