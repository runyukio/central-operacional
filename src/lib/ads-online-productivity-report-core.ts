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
  currentSubmit: number;
  previousSubmit: number;
  comparisonPercent: number | null;
  comparison: "up" | "down" | "equal" | "new";
  shiftTotal: number;
  ahtMs: number | null;
};

export type AdsOnlineProductivityReportSnapshot = {
  selectedCycle: string;
  dateKey: string;
  dateLabel: string;
  currentHourLabel: string;
  previousHourLabel: string;
  intervalLabel: string;
  previousIntervalLabel: string;
  onlineCount: number;
  averageSubmitPerHour: number;
  currentIntervalSubmit: number;
  previousIntervalSubmit: number;
  submitComparisonPercent: number | null;
  currentIntervalAhtMs: number | null;
  previousIntervalAhtMs: number | null;
  ahtDeltaMs: number | null;
  totalShiftSubmit: number;
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

  const rows = onlineRows.map((row): AdsOnlineProductivityAgentRow => {
    const history = parsedByRow.get(row) ?? [];
    const current = intervalMetric(history, currentStart, selected.timestamp);
    const previous = intervalMetric(history, previousStart, previousTarget);
    const latest = latestAtOrBefore(history, selected.timestamp);
    const shiftTotal = Math.max(0, finite(latest?.submit));
    const ahtMs = shiftTotal > 0 && finite(latest?.moderationMs) > 0
      ? finite(latest?.moderationMs) / shiftTotal
      : latest?.ahtMs ?? null;
    const comparisonPercent = percentChange(current.submit, previous.submit);
    return {
      name: row.displayName || row.wbLogin || row.rawWbLogin || "Unknown agent",
      wbLogin: row.wbLogin || row.rawWbLogin || "-",
      currentSubmit: current.submit,
      previousSubmit: previous.submit,
      comparisonPercent,
      comparison: comparisonTone(current.submit, previous.submit, comparisonPercent),
      shiftTotal,
      ahtMs
    };
  }).sort((left, right) => (
    right.currentSubmit - left.currentSubmit
    || right.shiftTotal - left.shiftTotal
    || left.name.localeCompare(right.name)
  ));

  const currentMetrics = onlineRows.map((row) => intervalMetric(parsedByRow.get(row) ?? [], currentStart, selected.timestamp));
  const previousMetrics = onlineRows.map((row) => intervalMetric(parsedByRow.get(row) ?? [], previousStart, previousTarget));
  const currentIntervalSubmit = sum(currentMetrics, (metric) => metric.submit);
  const previousIntervalSubmit = sum(previousMetrics, (metric) => metric.submit);
  const currentIntervalModeration = sum(currentMetrics, (metric) => metric.moderationMs);
  const previousIntervalModeration = sum(previousMetrics, (metric) => metric.moderationMs);
  const currentIntervalAhtMs = currentIntervalSubmit > 0 ? currentIntervalModeration / currentIntervalSubmit : null;
  const previousIntervalAhtMs = previousIntervalSubmit > 0 ? previousIntervalModeration / previousIntervalSubmit : null;
  const hourlyTotals = operationHourlyTotals(onlineRows, parsedByRow, selected);
  const hoursWithData = hourlyTotals.filter((hour) => hour.hasSnapshot);
  const averageSubmitPerHour = hoursWithData.length
    ? sum(hoursWithData, (hour) => hour.submit) / hoursWithData.length
    : 0;

  return {
    selectedCycle: input.selectedCycle,
    dateKey: selected.dateKey,
    dateLabel: formatDateLabel(selected.dateKey),
    currentHourLabel: `${String(selected.hour).padStart(2, "0")}H`,
    previousHourLabel: `${String((selected.hour + 23) % 24).padStart(2, "0")}H`,
    intervalLabel: formatInterval(currentStart, selected.timestamp),
    previousIntervalLabel: formatInterval(previousStart, previousTarget),
    onlineCount: rows.length,
    averageSubmitPerHour,
    currentIntervalSubmit,
    previousIntervalSubmit,
    submitComparisonPercent: percentChange(currentIntervalSubmit, previousIntervalSubmit),
    currentIntervalAhtMs,
    previousIntervalAhtMs,
    ahtDeltaMs: currentIntervalAhtMs !== null && previousIntervalAhtMs !== null
      ? currentIntervalAhtMs - previousIntervalAhtMs
      : null,
    totalShiftSubmit: sum(rows, (row) => row.shiftTotal),
    rows
  };
}

function operationHourlyTotals(
  rows: AdsExecutiveAgentRow[],
  parsedByRow: Map<AdsExecutiveAgentRow, ParsedHistory[]>,
  selected: ParsedExecutiveCycle
) {
  const dayStart = Date.UTC(
    Number(selected.dateKey.slice(0, 4)),
    Number(selected.dateKey.slice(5, 7)) - 1,
    Number(selected.dateKey.slice(8, 10))
  );
  return Array.from({ length: selected.hour + 1 }, (_, hour) => {
    const start = dayStart + hour * HOUR_MS;
    const end = hour === selected.hour ? selected.timestamp : start + HOUR_MS - 1;
    const metrics = rows.map((row) => intervalMetric(parsedByRow.get(row) ?? [], start, end));
    return {
      hour,
      submit: sum(metrics, (metric) => metric.submit),
      hasSnapshot: metrics.some((metric) => metric.hasSnapshot)
    };
  });
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

function sum<T>(rows: T[], value: (row: T) => number) {
  return rows.reduce((total, row) => total + value(row), 0);
}
