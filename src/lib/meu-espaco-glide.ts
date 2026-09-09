import { addMetricWeights, assessSpaceTarget, type MetricWeight, type SpaceTarget } from "@/lib/meu-espaco-targets";

export type GlidePoint = { date: string; daily: number | null; overall: number | null; forecast: number | null; path: number | null };
export type SpaceGlide = {
  target: SpaceTarget; month: string; cutoff: string | null; closed: boolean; overall: number | null;
  automaticWeight: number | null; remainingWeight: number | null; simulated: boolean;
  requiredValue: number | null; requiredNumerator: number | null; forecast: number | null; impossible: boolean;
  recentStart: string | null; recentDays: number; recentScheduled: number; futureScheduled: number;
  warning: string | null; points: GlidePoint[]; updatedAt?: string | null;
};
export const moveSpaceDay = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export function spaceMonthEnd(month: string) { const [year, m] = month.split("-").map(Number); return new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10); }

/** Raw weights are additive. Neither projections nor target checks use rounded KPI displays. */
export function projectSpaceGlide(input: { target: SpaceTarget; month: string; today: string; daily: Array<{ date: string; weight: MetricWeight }>; scheduled: Map<string, number>; matchedDenominators?: Map<string, number>; override?: number }): SpaceGlide {
  const { target, month, today, scheduled } = input;
  const start = `${month}-01`, end = spaceMonthEnd(month), closed = end < today;
  const validSource = input.daily.filter((row) => row.date <= end && row.date < today && row.weight.denominator > 0).sort((a, b) => a.date.localeCompare(b.date));
  const observed = validSource.filter((row) => row.date >= start);
  const cutoff = observed.at(-1)?.date ?? null;
  const totals = addMetricWeights(observed.map((row) => row.weight));
  const overall = assessSpaceTarget(target, totals).value;
  const recentStart = cutoff ? moveSpaceDay(cutoff, -6) : null;
  const recent = cutoff ? validSource.filter((row) => row.date >= recentStart! && row.date <= cutoff) : [];
  const recentTotals = addMetricWeights(recent.map((row) => row.weight));
  // Count schedules only on dates actually represented in the source, not missing source days.
  const recentScheduled = recent.reduce((sum, row) => sum + (scheduled.get(row.date) ?? 0), 0);
  const futureDates: string[] = [];
  if (cutoff && !closed) for (let day = moveSpaceDay(cutoff, 1); day <= end; day = moveSpaceDay(day, 1)) futureDates.push(day);
  const futureScheduled = futureDates.reduce((sum, day) => sum + (scheduled.get(day) ?? 0), 0);
  const matchedDenominator = input.matchedDenominators ? recent.reduce((sum, row) => sum + (input.matchedDenominators!.get(row.date) ?? 0), 0) : recentTotals.denominator;
  let ratio = recentScheduled > 0 && matchedDenominator > 0 ? matchedDenominator / recentScheduled : null;
  if (target.id === "abs") ratio = 1;
  if (ratio !== null && ["materialDaily", "cpd"].includes(target.id)) ratio = Math.min(1, ratio);
  const automaticWeight = cutoff && !closed && ratio !== null && futureScheduled > 0 ? ratio * futureScheduled : null;
  const remainingWeight = closed ? null : input.override ?? automaticWeight;
  const recentRate = recentTotals.denominator > 0 ? recentTotals.numerator / recentTotals.denominator : null;
  let requiredNumerator: number | null = null, requiredValue: number | null = null, forecast: number | null = null, impossible = false;
  if (overall !== null && remainingWeight !== null && remainingWeight > 0 && !closed) {
    const budget = target.target / target.scale * (totals.denominator + remainingWeight) - totals.numerator;
    const discrete = ["quality", "abs", "normalFrt", "urgentFrt", "materialDaily", "cpd"].includes(target.id);
    requiredNumerator = discrete ? target.direction === "min" ? Math.ceil(budget - 1e-9) : Math.floor(budget + 1e-9) : budget;
    impossible = (target.direction === "max" && requiredNumerator < -1e-9) || (target.direction === "min" && target.bounded === true && requiredNumerator > remainingWeight + 1e-9);
    if (!impossible) {
      requiredNumerator = Math.max(0, requiredNumerator);
      if (target.bounded) requiredNumerator = Math.min(remainingWeight, requiredNumerator);
      requiredValue = requiredNumerator / remainingWeight * target.scale;
    }
    if (recentRate !== null) forecast = (totals.numerator + recentRate * remainingWeight) / (totals.denominator + remainingWeight) * target.scale;
  }
  const byDay = new Map(observed.map((row) => [row.date, row.weight]));
  let actualN = 0, actualD = 0, projectedD = 0;
  const points: GlidePoint[] = [];
  for (let day = start; day <= end; day = moveSpaceDay(day, 1)) {
    const weight = byDay.get(day);
    if (weight) { actualN += weight.numerator; actualD += weight.denominator; }
    const atCutoff = day === cutoff;
    const future = cutoff !== null && day > cutoff && !closed && remainingWeight !== null && remainingWeight > 0;
    if (future) projectedD += remainingWeight * (futureScheduled > 0 ? (scheduled.get(day) ?? 0) / futureScheduled : 1 / futureDates.length);
    points.push({ date: day, daily: weight ? weight.numerator / weight.denominator * target.scale : null,
      overall: weight ? actualN / actualD * target.scale : null,
      forecast: atCutoff ? overall : future && recentRate !== null ? (totals.numerator + recentRate * projectedD) / (totals.denominator + projectedD) * target.scale : null,
      path: atCutoff ? overall : future && requiredValue !== null ? (totals.numerator + requiredValue / target.scale * projectedD) / (totals.denominator + projectedD) * target.scale : null });
  }
  const warning = !cutoff ? "Sem dados válidos anteriores a hoje para este indicador." : closed ? "Mês encerrado: resultado da base disponível, sem projeção futura." : remainingWeight === null ? "Sem base ou escala suficiente para estimar o volume restante. Você pode informar um cenário manual." : remainingWeight === 0 ? "Não há volume restante neste cenário; o esforço futuro não pode ser calculado." : cutoff < moveSpaceDay(today, -1) ? "Base defasada: a projeção inclui datas após o corte ainda não importadas. Não são valores realizados." : null;
  return { target, month, cutoff, closed, overall, automaticWeight, remainingWeight, simulated: input.override !== undefined && !closed, requiredValue, requiredNumerator, forecast, impossible, recentStart,
    recentDays: recent.length, recentScheduled, futureScheduled, warning, points };
}
