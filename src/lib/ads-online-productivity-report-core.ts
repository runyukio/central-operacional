import {
  isExecutiveAgentForLob,
  isExecutiveAgentOnlineAtCycle,
  parseAdsExecutiveCycle,
  type AdsExecutiveAgentRow,
  type ParsedExecutiveCycle
} from "@/lib/ads-executive-report-core";

const HOUR_MS = 60 * 60 * 1000;

export type AdsOnlineProductivityAgentRow = {
  name: string;
  wbLogin: string;
  skill: string | null;
  currentSubmit: number;
  previousSubmit: number;
  comparisonPercent: number | null;
  comparison: "up" | "down" | "equal" | "new";
  shiftTotal: number;
  ahtMs: number | null;
  moderationMs: number;
};

export type AdsOnlineProductivitySkillAverage = {
  skill: string;
  averageSubmit: number;
  agentCount: number;
};

export type AdsOnlineProductivityReportSnapshot = {
  selectedCycle: string;
  dateKey: string;
  dateLabel: string;
  currentHourLabel: string;
  previousHourLabel: string;
  intervalLabel: string;
  previousIntervalLabel: string;
  productiveAgentCount: number;
  averageSubmitPerHour: number;
  currentIntervalSubmit: number;
  previousIntervalSubmit: number;
  submitComparisonPercent: number | null;
  currentIntervalAhtMs: number | null;
  currentIntervalModerationMs: number;
  previousIntervalAhtMs: number | null;
  ahtDeltaMs: number | null;
  totalShiftSubmit: number;
  skillAverages: AdsOnlineProductivitySkillAverage[];
  rows: AdsOnlineProductivityAgentRow[];
};

type ParsedHistory = AdsExecutiveAgentRow["history"][number] & {
  parsed: ParsedExecutiveCycle;
};

type IntervalMetric = {
  submit: number;
  moderationMs: number;
  hasSnapshot: boolean;
};

export function buildAdsOnlineProductivityReportSnapshot(input: {
  agentRows: AdsExecutiveAgentRow[];
  selectedCycle: string;
}): AdsOnlineProductivityReportSnapshot {
  const selected = parseAdsExecutiveCycle(input.selectedCycle);
  const currentStart = startOfHour(selected.timestamp);
  const previousStart = currentStart - HOUR_MS;
  const previousTarget = previousStart + (selected.timestamp - currentStart);
  const eligibleRows = input.agentRows.filter((row) => isExecutiveAgentForLob(row, "ADS"));
  const onlineRows = eligibleRows.filter((row) => isExecutiveAgentOnlineAtCycle(row, input.selectedCycle));
  const parsedByRow = new Map(onlineRows.map((row) => [row, parseHistory(row, selected.timestamp)]));

  const measuredRows = onlineRows.map((row) => {
    const history = parsedByRow.get(row) ?? [];
    const current = intervalMetric(history, currentStart, selected.timestamp);
    const previous = intervalMetric(history, previousStart, previousTarget);
    const latest = latestAtOrBefore(history, selected.timestamp);
    const shiftTotal = Math.max(0, finite(latest?.submit));
    const shiftModerationMs = Math.max(0, finite(latest?.moderationMs));
    const ahtMs = shiftTotal > 0 && shiftModerationMs > 0
      ? shiftModerationMs / shiftTotal
      : latest?.ahtMs ?? null;
    const comparisonPercent = percentChange(current.submit, previous.submit);
    return {
      current,
      previous,
      reportRow: {
        name: row.displayName || row.wbLogin || row.rawWbLogin || "Unknown agent",
        wbLogin: row.wbLogin || row.rawWbLogin || "-",
        skill: reportableSkill(row.skill),
        currentSubmit: current.submit,
        previousSubmit: previous.submit,
        comparisonPercent,
        comparison: comparisonTone(current.submit, previous.submit, comparisonPercent),
        shiftTotal,
        ahtMs,
        moderationMs: current.moderationMs
      } satisfies AdsOnlineProductivityAgentRow
    };
  });
  const productiveRows = measuredRows.filter((row) => row.reportRow.currentSubmit > 0);
  const rows = productiveRows.map((row) => row.reportRow).sort((left, right) => (
    right.currentSubmit - left.currentSubmit
    || right.shiftTotal - left.shiftTotal
    || left.name.localeCompare(right.name)
  ));

  const currentMetrics = productiveRows.map((row) => row.current);
  const previousMetrics = productiveRows.map((row) => row.previous);
  const currentIntervalSubmit = sum(currentMetrics, (metric) => metric.submit);
  const previousIntervalSubmit = sum(previousMetrics, (metric) => metric.submit);
  const currentIntervalModeration = sum(currentMetrics, (metric) => metric.moderationMs);
  const previousIntervalModeration = sum(previousMetrics, (metric) => metric.moderationMs);
  const currentIntervalAhtMs = currentIntervalSubmit > 0
    ? weightedAverage(currentMetrics, intervalAht, (metric) => metric.submit)
    : null;
  const previousIntervalAhtMs = previousIntervalSubmit > 0
    ? weightedAverage(previousMetrics, intervalAht, (metric) => metric.submit)
    : null;
  const averageSubmitPerHour = weightedAverage(
    rows,
    (row) => row.currentSubmit,
    (row) => row.currentSubmit
  );
  const previousAverageSubmitPerHour = weightedAverage(
    rows,
    (row) => row.previousSubmit,
    (row) => row.previousSubmit
  );

  return {
    selectedCycle: input.selectedCycle,
    dateKey: selected.dateKey,
    dateLabel: formatDateLabel(selected.dateKey),
    currentHourLabel: `${String(selected.hour).padStart(2, "0")}H`,
    previousHourLabel: `${String((selected.hour + 23) % 24).padStart(2, "0")}H`,
    intervalLabel: formatInterval(currentStart, selected.timestamp),
    previousIntervalLabel: formatInterval(previousStart, previousTarget),
    productiveAgentCount: rows.length,
    averageSubmitPerHour,
    currentIntervalSubmit,
    previousIntervalSubmit,
    submitComparisonPercent: percentChange(
      averageSubmitPerHour,
      previousAverageSubmitPerHour
    ),
    currentIntervalAhtMs,
    currentIntervalModerationMs: currentIntervalModeration,
    previousIntervalAhtMs,
    ahtDeltaMs: currentIntervalAhtMs !== null && previousIntervalAhtMs !== null
      ? currentIntervalAhtMs - previousIntervalAhtMs
      : null,
    totalShiftSubmit: sum(rows, (row) => row.shiftTotal),
    skillAverages: buildSkillAverages(rows),
    rows
  };
}

function parseHistory(row: AdsExecutiveAgentRow, maxTimestamp: number): ParsedHistory[] {
  return row.history.flatMap((item) => {
    try {
      const parsed = parseAdsExecutiveCycle(item.cycleDownload);
      return parsed.timestamp <= maxTimestamp ? [{ ...item, parsed }] : [];
    } catch {
      return [];
    }
  }).sort((left, right) => left.parsed.timestamp - right.parsed.timestamp);
}

function intervalMetric(history: ParsedHistory[], start: number, end: number): IntervalMetric {
  const snapshot = latestBetween(history, start, end);
  if (!snapshot) return { submit: 0, moderationMs: 0, hasSnapshot: false };
  const baseline = latestBefore(history, start);
  return {
    submit: cumulativeDelta(snapshot.submit, baseline?.submit),
    moderationMs: cumulativeDelta(snapshot.moderationMs, baseline?.moderationMs),
    hasSnapshot: true
  };
}

function latestBetween(history: ParsedHistory[], start: number, end: number) {
  return history.filter((item) => item.parsed.timestamp >= start && item.parsed.timestamp <= end).at(-1) ?? null;
}

function latestBefore(history: ParsedHistory[], timestamp: number) {
  return history.filter((item) => item.parsed.timestamp < timestamp).at(-1) ?? null;
}

function latestAtOrBefore(history: ParsedHistory[], timestamp: number) {
  return history.filter((item) => item.parsed.timestamp <= timestamp).at(-1) ?? null;
}

function cumulativeDelta(current: number | null | undefined, previous: number | null | undefined) {
  const currentValue = finite(current);
  if (!Number.isFinite(previous)) return currentValue;
  const previousValue = finite(previous);
  return currentValue >= previousValue ? currentValue - previousValue : currentValue;
}

function percentChange(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 1_000) / 10;
}

function comparisonTone(current: number, previous: number, percent: number | null): AdsOnlineProductivityAgentRow["comparison"] {
  if (previous <= 0 && current > 0) return "new";
  if (percent === null || Math.abs(percent) < 0.05) return "equal";
  return percent > 0 ? "up" : "down";
}

function startOfHour(timestamp: number) {
  return timestamp - (timestamp % HOUR_MS);
}

function formatInterval(start: number, end: number) {
  return `${formatTime(start)}–${formatTime(end)}`;
}

function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function formatDateLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-");
  return `${day}/${month}/${year}`;
}

function finite(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function reportableSkill(value: string | null | undefined) {
  const skill = String(value ?? "").trim();
  if (!skill || /^(?:-|n\/?a|n[aã]o encontrado)$/i.test(skill)) return null;
  return skill;
}

function buildSkillAverages(rows: AdsOnlineProductivityAgentRow[]): AdsOnlineProductivitySkillAverage[] {
  const grouped = new Map<string, { skill: string; weightedSubmit: number; submitWeight: number; agentCount: number }>();
  for (const row of rows) {
    const skill = row.skill ?? "Unassigned";
    const key = comparableSkill(skill);
    const current = grouped.get(key) ?? { skill, weightedSubmit: 0, submitWeight: 0, agentCount: 0 };
    current.weightedSubmit += row.currentSubmit * row.currentSubmit;
    current.submitWeight += row.currentSubmit;
    current.agentCount += 1;
    grouped.set(key, current);
  }
  return [...grouped.values()].map((group) => ({
    skill: group.skill,
    averageSubmit: group.submitWeight > 0 ? group.weightedSubmit / group.submitWeight : 0,
    agentCount: group.agentCount
  })).sort((left, right) => (
    right.averageSubmit - left.averageSubmit
    || left.skill.localeCompare(right.skill)
  ));
}

function comparableSkill(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function sum<T>(rows: T[], value: (row: T) => number) {
  return rows.reduce((total, row) => total + value(row), 0);
}

function weightedAverage<T>(rows: T[], value: (row: T) => number, weight: (row: T) => number) {
  let weightedTotal = 0;
  let totalWeight = 0;
  for (const row of rows) {
    const rowWeight = Math.max(0, finite(weight(row)));
    if (rowWeight <= 0) continue;
    weightedTotal += finite(value(row)) * rowWeight;
    totalWeight += rowWeight;
  }
  return totalWeight > 0 ? weightedTotal / totalWeight : 0;
}

function intervalAht(metric: IntervalMetric) {
  return metric.submit > 0 ? metric.moderationMs / metric.submit : 0;
}
