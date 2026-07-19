export type ForecastActual = { at: Date; timestamp: number; input: number };

type ForecastModelName = "seasonalSlot" | "sameHourRecent" | "recentProfile" | "shortMomentum";
export type ForecastModelWeights = Record<ForecastModelName, number>;
type ForecastCandidate = { name: ForecastModelName; value: number; samples: number; confidence: number };

const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;
const forecastModelNames: ForecastModelName[] = ["seasonalSlot", "sameHourRecent", "recentProfile", "shortMomentum"];
const defaultForecastModelWeights: ForecastModelWeights = {
  seasonalSlot: 0.34,
  sameHourRecent: 0.24,
  recentProfile: 0.26,
  shortMomentum: 0.16
};

export function predictForecastHour(
  actuals: ForecastActual[],
  targetAt: Date,
  referenceAt: Date,
  modelWeights: ForecastModelWeights = defaultForecastModelWeights
) {
  const referenceTime = referenceAt.getTime();
  const targetHour = targetAt.getUTCHours();
  const training = actuals.filter((row) => row.timestamp <= referenceTime && row.input > 0);
  const candidates = buildForecastCandidates(training, targetAt, referenceAt);
  const fallbackRows = training.filter((row) => row.timestamp >= referenceTime - 14 * dayMs);
  const fallback = weightedAverage(fallbackRows.length ? fallbackRows : training, referenceAt);
  let total = 0;
  let weight = 0;
  let sampleCount = 0;
  for (const candidate of candidates) {
    const candidateWeight = (modelWeights[candidate.name] ?? 0) * clamp(candidate.confidence, 0.12, 1.25);
    total += candidate.value * candidateWeight;
    weight += candidateWeight;
    sampleCount += candidate.samples;
  }
  const blended = weight > 0 ? total / weight : fallback;
  const adjustment = calculateRecentAdjustment(training, targetAt, referenceAt);
  const forecast = Math.max(0, blended * adjustment);
  const dispersionRows = training.filter((row) => row.at.getUTCHours() === targetHour && row.timestamp >= referenceTime - 28 * dayMs);
  const stats = statsFor(dispersionRows.length ? dispersionRows : candidates.map((candidate) => ({ input: candidate.value })));
  const spread = stats.mean > 0 ? stats.stdDev / stats.mean : 0.45;
  const band = clamp(0.18 + spread * 0.42 + Math.abs(adjustment - 1) * 0.16 + (sampleCount < 8 ? 0.16 : 0), 0.2, 1.05);
  const confidence = clamp(0.92 - spread * 0.22 - Math.abs(adjustment - 1) * 0.16 + Math.min(sampleCount, 36) * 0.006, 0.34, 0.96);
  return { forecast, lower: forecast * (1 - band), upper: forecast * (1 + band), adjustment, confidence, samples: sampleCount };
}

export function calculateForecastModelWeights(actuals: ForecastActual[], referenceAt: Date): ForecastModelWeights {
  const referenceTime = referenceAt.getTime();
  const testRows = actuals.filter((row) => row.timestamp >= referenceTime - 7 * dayMs && row.input > 0).slice(-168);
  const errors = new Map<ForecastModelName, { total: number; weight: number }>();
  for (const row of testRows) {
    const history = actuals.filter((item) => item.timestamp < row.timestamp && item.input > 0);
    if (history.length < 48) continue;
    const candidates = buildForecastCandidates(history, row.at, new Date(row.timestamp - hourMs));
    const recencyWeight = Math.pow(0.5, Math.max(0, (referenceTime - row.timestamp) / dayMs) / 3);
    for (const candidate of candidates) {
      const current = errors.get(candidate.name) ?? { total: 0, weight: 0 };
      const errorRatio = Math.abs(row.input - candidate.value) / Math.max(1, row.input);
      const rowWeight = Math.max(1, row.input) * recencyWeight * clamp(candidate.confidence, 0.25, 1.15);
      current.total += errorRatio * rowWeight;
      current.weight += rowWeight;
      errors.set(candidate.name, current);
    }
  }

  const scores = forecastModelNames.reduce<Record<ForecastModelName, number>>((acc, name) => {
    const error = errors.get(name);
    const averageError = error && error.weight > 0 ? error.total / error.weight : null;
    acc[name] = averageError === null ? defaultForecastModelWeights[name] : 1 / (averageError + 0.08);
    return acc;
  }, { ...defaultForecastModelWeights });
  const scoreTotal = forecastModelNames.reduce((total, name) => total + scores[name], 0);
  if (!scoreTotal) return defaultForecastModelWeights;
  return forecastModelNames.reduce<ForecastModelWeights>((acc, name) => {
    const learned = scores[name] / scoreTotal;
    acc[name] = learned * 0.72 + defaultForecastModelWeights[name] * 0.28;
    return acc;
  }, { ...defaultForecastModelWeights });
}

function buildForecastCandidates(actuals: ForecastActual[], targetAt: Date, referenceAt: Date): ForecastCandidate[] {
  const referenceTime = referenceAt.getTime();
  const targetDay = targetAt.getUTCDay();
  const targetHour = targetAt.getUTCHours();
  const candidates: ForecastCandidate[] = [];
  const seasonalSlot = actuals.filter((row) => row.at.getUTCDay() === targetDay && row.at.getUTCHours() === targetHour);
  const sameHourRecent = actuals.filter((row) => row.at.getUTCHours() === targetHour && row.timestamp >= referenceTime - 35 * dayMs);
  const profileValue = recentHourlyProfileForecast(actuals, targetAt, referenceAt);
  const momentumValue = shortMomentumForecast(actuals, targetAt, referenceAt);

  if (seasonalSlot.length) {
    candidates.push({
      name: "seasonalSlot",
      value: weightedAverage(seasonalSlot, referenceAt),
      samples: seasonalSlot.length,
      confidence: clamp(seasonalSlot.length / 8, 0.25, 1)
    });
  }
  if (sameHourRecent.length) {
    candidates.push({
      name: "sameHourRecent",
      value: weightedAverage(sameHourRecent, referenceAt, 10),
      samples: sameHourRecent.length,
      confidence: clamp(sameHourRecent.length / 10, 0.28, 1.05)
    });
  }
  if (profileValue.value > 0) {
    candidates.push({
      name: "recentProfile",
      value: profileValue.value,
      samples: profileValue.samples,
      confidence: clamp(profileValue.samples / 24, 0.25, 1.1)
    });
  }
  if (momentumValue.value > 0) {
    candidates.push({
      name: "shortMomentum",
      value: momentumValue.value,
      samples: momentumValue.samples,
      confidence: clamp(momentumValue.samples / 8, 0.25, 1)
    });
  }
  return candidates.filter((candidate) => Number.isFinite(candidate.value) && candidate.value > 0);
}

function recentHourlyProfileForecast(actuals: ForecastActual[], targetAt: Date, referenceAt: Date) {
  const referenceTime = referenceAt.getTime();
  const targetHour = targetAt.getUTCHours();
  const recent = actuals.filter((row) => row.timestamp >= referenceTime - 7 * dayMs);
  const broader = actuals.filter((row) => row.timestamp >= referenceTime - 28 * dayMs);
  const recentTotal = sum(recent.map((row) => row.input));
  const broaderTotal = sum(broader.map((row) => row.input));
  const recentDays = new Set(recent.map((row) => utcDayKey(row.at))).size;
  const broaderDays = new Set(broader.map((row) => utcDayKey(row.at))).size;
  const recentHourShare = recentTotal > 0 ? sum(recent.filter((row) => row.at.getUTCHours() === targetHour).map((row) => row.input)) / recentTotal : 0;
  const broaderHourShare = broaderTotal > 0 ? sum(broader.filter((row) => row.at.getUTCHours() === targetHour).map((row) => row.input)) / broaderTotal : 0;
  const share = recentHourShare && broaderHourShare ? recentHourShare * 0.72 + broaderHourShare * 0.28 : recentHourShare || broaderHourShare;
  const recentDailyAverage = recentDays > 0 ? recentTotal / recentDays : 0;
  const broaderDailyAverage = broaderDays > 0 ? broaderTotal / broaderDays : 0;
  const dailyAverage = recentDailyAverage && broaderDailyAverage ? recentDailyAverage * 0.72 + broaderDailyAverage * 0.28 : recentDailyAverage || broaderDailyAverage;
  return { value: dailyAverage * share, samples: recent.length || broader.length };
}

function shortMomentumForecast(actuals: ForecastActual[], targetAt: Date, referenceAt: Date) {
  const referenceTime = referenceAt.getTime();
  const targetHour = targetAt.getUTCHours();
  const recentSameHour = actuals.filter((row) => row.at.getUTCHours() === targetHour && row.timestamp >= referenceTime - 10 * dayMs);
  const last72h = actuals.filter((row) => row.timestamp >= referenceTime - 72 * hourMs);
  const last24h = actuals.filter((row) => row.timestamp >= referenceTime - 24 * hourMs);
  const sameHourValue = recentSameHour.length ? weightedAverage(recentSameHour, referenceAt, 5) : 0;
  const hourlyMomentum = last72h.length ? sum(last72h.map((row) => row.input)) / Math.max(1, Math.min(72, Math.ceil((referenceTime - last72h[0].timestamp) / hourMs))) : 0;
  const hotNow = last24h.length ? sum(last24h.map((row) => row.input)) / Math.max(1, Math.min(24, Math.ceil((referenceTime - last24h[0].timestamp) / hourMs))) : 0;
  const value = sameHourValue > 0 ? sameHourValue * 0.62 + (hotNow || hourlyMomentum) * 0.38 : hotNow || hourlyMomentum;
  return { value, samples: recentSameHour.length + last24h.length };
}

function calculateRecentAdjustment(actuals: ForecastActual[], targetAt: Date, referenceAt: Date) {
  const referenceTime = referenceAt.getTime();
  const targetHour = targetAt.getUTCHours();
  const ratios: Array<{ ratio: number; weight: number }> = [];
  addWindowRatio(ratios, actuals, referenceTime, 24 * hourMs, 0.36, 3.4);
  addWindowRatio(ratios, actuals, referenceTime, 72 * hourMs, 0.3, 3);
  addWindowRatio(ratios, actuals, referenceTime, 7 * dayMs, 0.18, 2.6);
  const sameHour = actuals.filter((row) => row.at.getUTCHours() === targetHour);
  const recentSameHour = sum(sameHour.filter((row) => row.timestamp > referenceTime - 10 * dayMs).map((row) => row.input));
  const previousSameHour = sum(sameHour.filter((row) => row.timestamp <= referenceTime - 10 * dayMs && row.timestamp > referenceTime - 50 * dayMs).map((row) => row.input)) / 4;
  if (previousSameHour > 0) ratios.push({ ratio: clamp(recentSameHour / previousSameHour, 0.35, 3.4), weight: 0.24 });
  if (!ratios.length) return 1;
  const raw = ratios.reduce((total, item) => total + item.ratio * item.weight, 0) / ratios.reduce((total, item) => total + item.weight, 0);
  return clamp(1 + (raw - 1) * 0.94, 0.45, 3.1);
}

function addWindowRatio(ratios: Array<{ ratio: number; weight: number }>, actuals: ForecastActual[], referenceTime: number, windowMs: number, weight: number, maxRatio: number) {
  const recent = sum(actuals.filter((row) => row.timestamp > referenceTime - windowMs).map((row) => row.input));
  const previous = sum(actuals.filter((row) => row.timestamp <= referenceTime - windowMs && row.timestamp > referenceTime - windowMs * 2).map((row) => row.input));
  if (previous > 0) ratios.push({ ratio: clamp(recent / previous, 0.35, maxRatio), weight });
}

function weightedAverage(rows: Array<{ timestamp: number; input: number }>, referenceAt: Date, halfLifeDays = 21) {
  const reference = referenceAt.getTime();
  let total = 0;
  let weight = 0;
  for (const row of rows) {
    const ageDays = Math.max(0, (reference - row.timestamp) / dayMs);
    const rowWeight = Math.pow(0.5, ageDays / halfLifeDays);
    total += row.input * rowWeight;
    weight += rowWeight;
  }
  return weight > 0 ? total / weight : 0;
}

function statsFor(rows: Array<{ input: number }>) {
  if (!rows.length) return { mean: 0, stdDev: 0 };
  const mean = sum(rows.map((row) => row.input)) / rows.length;
  const variance = rows.reduce((total, row) => total + (row.input - mean) ** 2, 0) / rows.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

function utcDayKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
