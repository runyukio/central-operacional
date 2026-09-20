import {
  buildAdsExecutiveReportSnapshot,
  isExecutiveAgentForLob,
  isExecutiveAgentOnlineAtCycle,
  parseAdsExecutiveCycle,
  type AdsExecutiveAgentRow,
  type AdsExecutiveQueueRow
} from "@/lib/ads-executive-report-core";

import type { ExecutiveForecastPoint } from "./executive-forecast-core";
const HOUR_MS = 60 * 60 * 1000;

export type AdsBacklogPlanPoint = {
  timestamp: number;
  dateKey: string;
  hour: number;
  plannedBacklog: number;
  forecastVolume: number;
};

export type AdsBacklogHourlyReportSnapshot = {
  selectedCycle: string;
  reportHourLabel: string;
  nextHourLabel: string;
  currentBacklog: number;
  plannedBacklog: number;
  actualIncomingVolume: number;
  forecastedVolume: number;
  materialAverageSubmitPerHour: number;
  materialTotalSubmitPerHour: number;
  materialProductiveAgentCount: number;
  expectedNextHourBacklog: number;
  expectedClearanceLabel: string;
  remainingHourFraction: number;
};

// Pasta10.xlsx contains 58 consecutive hourly rows. Its date cells skip an
// extra calendar day at midnight, so the cloud plan rebuilds the timeline from
// the first valid timestamp instead of trusting the later workbook dates.
const PLAN_START = Date.UTC(2026, 7, 4, 20);
const PLAN_BACKLOG_VALUES: readonly number[] = [3863,4849,6355,6641,6907,7053,6973,7117,7025,6867,6707,6785,6879,7133,7407,7699,8027,8463,8341,8133,7837,7579,8205,8727,9351,10367,11759,11575,11301,10919,10391,10007,9413,8773,8131,7759,7275,6847,6443,6055,5705,5481,4001,4959,3273,1649,1607,1459,1389,1663,2469,2303,2029,1763,1373,803,419,0];
export const ADS_BACKLOG_PLAN = PLAN_BACKLOG_VALUES.map((plannedBacklog, index) => {
  const timestamp = PLAN_START + index * HOUR_MS;
  const date = new Date(timestamp);
  return { timestamp, dateKey: date.toISOString().slice(0, 10), hour: date.getUTCHours(), plannedBacklog };
});
export function buildAdsBacklogHourlyReportSnapshot(input: {
  selectedCycle: string;
  queueRows: AdsExecutiveQueueRow[];
  agentRows: AdsExecutiveAgentRow[];
  forecast: ExecutiveForecastPoint[];
  plan?: Array<Omit<AdsBacklogPlanPoint, "forecastVolume">>;
}): AdsBacklogHourlyReportSnapshot | null {
  // Preserve historical backlog targets, never the workbook's forecast of incoming demand.
  const forecast = new Map(input.forecast.map((p) => [`${p.dateKey}|${p.hour}`, p.input]));
  const plan = (input.plan ?? ADS_BACKLOG_PLAN).flatMap((p) => {
    const value = forecast.get(`${p.dateKey}|${p.hour}`);
    return value === undefined ? [] : [{ ...p, forecastVolume: value }];
  });
  const selected = parseAdsExecutiveCycle(input.selectedCycle);
  const currentHourTimestamp = selected.timestamp - selected.minute * 60_000;
  const planPoint = plan.find((point) => point.timestamp === currentHourTimestamp);
  if (!planPoint) return null;

  const executive = buildAdsExecutiveReportSnapshot({
    lob: "ADS",
    selectedCycle: input.selectedCycle,
    queueRows: input.queueRows,
    agentRows: input.agentRows
  });
  const currentBucket = executive.buckets.find((bucket) => bucket.hour === selected.hour);
  const currentBacklog = currentBucket?.backlog;
  const actualIncomingVolume = currentBucket?.input;
  if (typeof currentBacklog !== "number" || typeof actualIncomingVolume !== "number") return null;

  const materialProductivity = buildMaterialHourlyProductivity(
    input.agentRows,
    input.selectedCycle,
    selected.timestamp
  );
  const remainingHourFraction = Math.max(0, Math.min(1, (60 - selected.minute) / 60));
  const remainingForecastVolume = planPoint.forecastVolume * remainingHourFraction;
  const remainingMaterialOutput = materialProductivity.totalSubmitPerHour * remainingHourFraction;
  const expectedNextHourBacklog = Math.max(
    0,
    Math.round(currentBacklog + remainingForecastVolume - remainingMaterialOutput)
  );
  const nextHourTimestamp = currentHourTimestamp + HOUR_MS;
  const clearanceTimestamp = projectDynamicClearance(
    plan,
    nextHourTimestamp,
    expectedNextHourBacklog
  );

  return {
    selectedCycle: input.selectedCycle,
    reportHourLabel: formatDateTime(currentHourTimestamp),
    nextHourLabel: formatDateTime(nextHourTimestamp),
    currentBacklog: Math.round(currentBacklog),
    plannedBacklog: Math.round(planPoint.plannedBacklog),
    actualIncomingVolume: Math.round(actualIncomingVolume),
    forecastedVolume: Math.round(planPoint.forecastVolume),
    materialAverageSubmitPerHour: materialProductivity.averageSubmitPerHour,
    materialTotalSubmitPerHour: materialProductivity.totalSubmitPerHour,
    materialProductiveAgentCount: materialProductivity.agentCount,
    expectedNextHourBacklog,
    expectedClearanceLabel: clearanceTimestamp === null ? "Not available" : formatClearance(clearanceTimestamp),
    remainingHourFraction
  };
}

export function buildAdsBacklogKwaiTalkPayload(report: AdsBacklogHourlyReportSnapshot) {
  const nextHourTime = report.nextHourLabel.slice(-5);
  return {
    msgtype: "markdown",
    markdown: {
      content: [
        `### ADS Backlog Update — ${report.reportHourLabel.slice(-5)}`,
        `- **Current backlog:** ${formatInteger(report.currentBacklog)}`,
        `- **Planned backlog:** ${formatInteger(report.plannedBacklog)}`,
        `- **Actual incoming volume:** ${formatInteger(report.actualIncomingVolume)}`,
        `- **Forecasted volume:** ${formatInteger(report.forecastedVolume)}`,
        `- **Current productivity:** ${formatInteger(report.materialAverageSubmitPerHour)} submits/hour/agent (Material only)`,
        `- **Expected backlog at ${nextHourTime}:** ${formatInteger(report.expectedNextHourBacklog)}`,
        `- **Expected clearance:** ${report.expectedClearanceLabel}`,
        "",
        "The team remains focused on the productivity campaign, queue prioritization, and floor task force. "
          + `Based on current Material productivity and forecasted incoming volume, we expect the backlog to reach approximately **${formatInteger(report.expectedNextHourBacklog)} tasks by ${nextHourTime}**.`
      ].join("\n")
    }
  };
}

export function isMaterialQueuesSkill(value: string | null | undefined) {
  return normalize(value) === "material queues";
}

function buildMaterialHourlyProductivity(
  rows: AdsExecutiveAgentRow[],
  selectedCycle: string,
  selectedTimestamp: number
) {
  const rates = rows
    .filter((row) => (
      isExecutiveAgentForLob(row, "ADS")
      && isExecutiveAgentOnlineAtCycle(row, selectedCycle)
      && isMaterialQueuesSkill(row.skill)
    ))
    .flatMap((row) => {
      const history = row.history.flatMap((item) => {
        try {
          const parsed = parseAdsExecutiveCycle(item.cycleDownload);
          return parsed.timestamp <= selectedTimestamp ? [{ ...item, timestamp: parsed.timestamp }] : [];
        } catch {
          return [];
        }
      }).sort((left, right) => left.timestamp - right.timestamp);
      const current = history.at(-1);
      const baseline = history.filter((item) => item.timestamp <= selectedTimestamp - HOUR_MS).at(-1);
      if (!current || !baseline || current.timestamp <= baseline.timestamp) return [];
      const currentSubmit = Math.max(0, Number(current.submit ?? 0));
      const baselineSubmit = Math.max(0, Number(baseline.submit ?? 0));
      const submit = currentSubmit >= baselineSubmit ? currentSubmit - baselineSubmit : currentSubmit;
      const observedHours = (current.timestamp - baseline.timestamp) / HOUR_MS;
      const submitPerHour = observedHours > 0 ? submit / observedHours : 0;
      return submitPerHour > 0 && Number.isFinite(submitPerHour) ? [submitPerHour] : [];
    });
  const totalSubmitPerHour = rates.reduce((total, rate) => total + rate, 0);
  return {
    averageSubmitPerHour: rates.length ? Math.round(totalSubmitPerHour / rates.length) : 0,
    totalSubmitPerHour: Math.round(totalSubmitPerHour),
    agentCount: rates.length
  };
}

function projectDynamicClearance(
  plan: AdsBacklogPlanPoint[],
  nextHourTimestamp: number,
  expectedNextHourBacklog: number
) {
  if (expectedNextHourBacklog <= 0) return nextHourTimestamp;
  const ordered = [...plan].sort((left, right) => left.timestamp - right.timestamp);
  const nextPlanIndex = ordered.findIndex((point) => point.timestamp === nextHourTimestamp);
  if (nextPlanIndex < 0) return null;
  const liveOffset = expectedNextHourBacklog - ordered[nextPlanIndex].plannedBacklog;
  for (let index = nextPlanIndex; index < ordered.length; index += 1) {
    if (ordered[index].plannedBacklog + liveOffset <= 0) return ordered[index].timestamp;
  }

  const last = ordered.at(-1);
  if (!last) return null;
  const burnWindowStartIndex = Math.max(nextPlanIndex, ordered.length - 7);
  const burnWindowStart = ordered[burnWindowStartIndex];
  const burnWindowHours = (last.timestamp - burnWindowStart.timestamp) / HOUR_MS;
  const plannedBurnPerHour = burnWindowHours > 0
    ? (burnWindowStart.plannedBacklog - last.plannedBacklog) / burnWindowHours
    : 0;
  const remainingBacklog = Math.max(0, last.plannedBacklog + liveOffset);
  if (plannedBurnPerHour <= 0 || remainingBacklog <= 0) return null;
  return last.timestamp + Math.ceil(remainingBacklog / plannedBurnPerHour) * HOUR_MS;
}

function normalize(value: unknown) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatDateTime(timestamp: number) {
  const date = new Date(timestamp);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  return `${day}/${month} ${hour}:00`;
}

function formatClearance(timestamp: number) {
  const date = new Date(timestamp);
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date);
  const day = date.getUTCDate();
  const hour = date.getUTCHours();
  const hour12 = hour % 12 || 12;
  return `${month} ${day} at ${hour12}:00 ${hour < 12 ? "AM" : "PM"}`;
}
