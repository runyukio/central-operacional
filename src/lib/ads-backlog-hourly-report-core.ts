import {
  buildAdsExecutiveReportSnapshot,
  parseAdsExecutiveCycle,
  type AdsExecutiveAgentRow,
  type AdsExecutiveQueueRow
} from "@/lib/ads-executive-report-core";
import { buildAdsOnlineProductivityReportSnapshot } from "@/lib/ads-online-productivity-report-core";

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
const PLAN_VALUES: ReadonlyArray<readonly [plannedBacklog: number, forecastVolume: number]> = [
  [3863, 561], [4849, 737], [6355, 997], [6641, 630], [6907, 620], [7053, 560],
  [6973, 447], [7117, 559], [7025, 441], [6867, 408], [6707, 407], [6785, 526],
  [6879, 536], [7133, 565], [7407, 575], [7699, 584], [8027, 602], [8463, 656],
  [8341, 670], [8133, 627], [7837, 583], [7579, 602], [8205, 605], [8727, 553],
  [9351, 556], [10367, 752], [11759, 940], [11575, 639], [11301, 594], [10919, 540],
  [10391, 467], [10007, 539], [9413, 434], [8773, 411], [8131, 410], [7759, 545],
  [7275, 538], [6847, 566], [6443, 578], [6055, 586], [5705, 605], [5481, 668],
  [4001, 673], [4959, 629], [3273, 570], [1649, 601], [1607, 612], [1459, 559],
  [1389, 550], [1663, 722], [2469, 988], [2303, 648], [2029, 594], [1763, 598],
  [1373, 536], [803, 446], [419, 539], [0, 438]
];

export const ADS_BACKLOG_PLAN: AdsBacklogPlanPoint[] = PLAN_VALUES.map(([plannedBacklog, forecastVolume], index) => {
  const timestamp = PLAN_START + index * HOUR_MS;
  const date = new Date(timestamp);
  return {
    timestamp,
    dateKey: date.toISOString().slice(0, 10),
    hour: date.getUTCHours(),
    plannedBacklog,
    forecastVolume
  };
});

export function buildAdsBacklogHourlyReportSnapshot(input: {
  selectedCycle: string;
  queueRows: AdsExecutiveQueueRow[];
  agentRows: AdsExecutiveAgentRow[];
  plan?: AdsBacklogPlanPoint[];
}): AdsBacklogHourlyReportSnapshot | null {
  const plan = input.plan ?? ADS_BACKLOG_PLAN;
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

  const productivity = buildAdsOnlineProductivityReportSnapshot({
    selectedCycle: input.selectedCycle,
    agentRows: input.agentRows
  });
  const materialRows = productivity.rows.filter((row) => isMaterialQueuesSkill(row.skill));
  const materialSubmit = materialRows.reduce((total, row) => total + row.currentSubmit, 0);
  const elapsedHourFraction = Math.max(1 / 60, selected.minute / 60);
  const materialTotalSubmitPerHour = Math.round(materialSubmit / elapsedHourFraction);
  const materialAverageSubmitPerHour = materialRows.length
    ? Math.round(materialSubmit / elapsedHourFraction / materialRows.length)
    : 0;
  const remainingHourFraction = Math.max(0, Math.min(1, (60 - selected.minute) / 60));
  const remainingForecastVolume = planPoint.forecastVolume * remainingHourFraction;
  const remainingMaterialOutput = materialTotalSubmitPerHour * remainingHourFraction;
  const expectedNextHourBacklog = Math.max(
    0,
    Math.round(currentBacklog + remainingForecastVolume - remainingMaterialOutput)
  );
  const nextHourTimestamp = currentHourTimestamp + HOUR_MS;
  const clearance = plan.find((point) => point.timestamp >= currentHourTimestamp && point.plannedBacklog <= 0);

  return {
    selectedCycle: input.selectedCycle,
    reportHourLabel: formatDateTime(currentHourTimestamp),
    nextHourLabel: formatDateTime(nextHourTimestamp),
    currentBacklog: Math.round(currentBacklog),
    plannedBacklog: Math.round(planPoint.plannedBacklog),
    actualIncomingVolume: Math.round(actualIncomingVolume),
    forecastedVolume: Math.round(planPoint.forecastVolume),
    materialAverageSubmitPerHour,
    materialTotalSubmitPerHour,
    materialProductiveAgentCount: materialRows.length,
    expectedNextHourBacklog,
    expectedClearanceLabel: clearance ? formatClearance(clearance.timestamp) : "Not available",
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
