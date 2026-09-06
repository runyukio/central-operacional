import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";
const CEC_HOURLY_SOURCE = "freshdesk-cec-cpd-hourly";
const KIM_WEBHOOK_HOST = "kim-robot.kwaitalk.com";
const MAX_KIM_IMAGE_BYTES = 2 * 1024 * 1024;

export class CecHourlyDataUnavailableError extends Error {
  constructor(readonly dateKey: string) {
    super(`No real CEC hourly data is available for ${dateKey}.`);
    this.name = "CecHourlyDataUnavailableError";
  }
}

const cecFontRegistrations = [
  GlobalFonts.registerFromPath(
    join(process.cwd(), "node_modules", "@fontsource", "inter", "files", "inter-latin-400-normal.woff"),
    "CEC Inter Regular"
  ),
  GlobalFonts.registerFromPath(
    join(process.cwd(), "node_modules", "@fontsource", "inter", "files", "inter-latin-600-normal.woff"),
    "CEC Inter SemiBold"
  ),
  GlobalFonts.registerFromPath(
    join(process.cwd(), "node_modules", "@fontsource", "inter", "files", "inter-latin-700-normal.woff"),
    "CEC Inter Bold"
  ),
  GlobalFonts.registerFromPath(
    join(process.cwd(), "node_modules", "@fontsource", "inter", "files", "inter-latin-800-normal.woff"),
    "CEC Inter ExtraBold"
  )
];

type RawTicket = {
  ticket?: unknown;
  agentName?: unknown;
  status?: unknown;
};

type RawCecHourlyData = {
  tickets?: RawTicket[];
};

export type CecHourlySnapshotInput = {
  cycleDownload: string;
  fileName: string;
  generatedDate: string | null;
  importedAt: Date;
  rawData: Prisma.JsonValue;
};

export type CecResolvedAgentRow = {
  key: string;
  name: string;
  skill: string;
  total: number;
  hourly: number[];
};

export type CecResolvedHourlyReport = {
  dateKey: string;
  dateLabel: string;
  previousDateKey: string;
  updatedThroughHour: number;
  generatedAt: Date;
  totalResolved: number;
  previousTotalResolved: number | null;
  lastHourResolved: number;
  previousLastHourResolved: number | null;
  activeAgents: number;
  previousActiveAgents: number | null;
  averagePerAgent: number;
  previousAveragePerAgent: number | null;
  hourlyResolved: number[];
  previousHourlyResolved: Array<number | null>;
  previousCoverageHours: number[];
  agents: CecResolvedAgentRow[];
  topDay: CecResolvedAgentRow[];
  topLastHour: CecResolvedAgentRow[];
  source: "Freshdesk CEC hourly export";
};

function parseDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("The report date must use YYYY-MM-DD.");
  }
  const date = new Date(`${value}T12:00:00-03:00`);
  if (Number.isNaN(date.getTime())) throw new Error("The report date is invalid.");
  return date;
}

function formatDateKey(value: Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: SAO_PAULO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function previousDateKey(dateKey: string) {
  const date = parseDateKey(dateKey);
  date.setUTCDate(date.getUTCDate() - 1);
  return formatDateKey(date);
}

function currentDateKey() {
  return formatDateKey(new Date());
}

function cycleHour(cycleDownload: string) {
  const match = cycleDownload.match(/^\d{4}-\d{2}-\d{2} (\d{2}):\d{2}$/);
  return match ? Number(match[1]) : -1;
}

function normalizedStatus(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizedAgentKey(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

function displayAgentLogin(value: unknown) {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  return name.match(/\bwb_[^\s]+/i)?.[0].toLowerCase() ?? "";
}

function rawHourlyData(value: Prisma.JsonValue): RawCecHourlyData {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  return value as RawCecHourlyData;
}

function buildDateMetrics(snapshots: CecHourlySnapshotInput[], dateKey: string, throughHour: number) {
  const hourlyResolved = Array.from({ length: 24 }, () => 0);
  const coverageHours = new Set<number>();
  const agentRows = new Map<string, CecResolvedAgentRow>();
  const seenTickets = new Set<string>();
  const seenFiles = new Set<string>();

  snapshots
    .filter((snapshot) => snapshot.cycleDownload.startsWith(`${dateKey} `))
    .sort((left, right) => left.cycleDownload.localeCompare(right.cycleDownload))
    .forEach((snapshot) => {
      const hour = cycleHour(snapshot.cycleDownload);
      if (hour < 0 || hour > throughHour) return;

      coverageHours.add(hour);
      if (snapshot.fileName && seenFiles.has(snapshot.fileName)) return;
      if (snapshot.fileName) seenFiles.add(snapshot.fileName);

      const tickets = rawHourlyData(snapshot.rawData).tickets;
      if (!Array.isArray(tickets)) return;

      tickets.forEach((ticket, index) => {
        if (normalizedStatus(ticket.status) !== "resolved") return;
        const ticketId = String(ticket.ticket ?? "").trim();
        const dedupeKey = ticketId || `${snapshot.cycleDownload}:${index}`;
        if (seenTickets.has(dedupeKey)) return;
        seenTickets.add(dedupeKey);

        const agentName = displayAgentLogin(ticket.agentName);
        if (!agentName) return;

        hourlyResolved[hour] += 1;
        const key = normalizedAgentKey(agentName);
        const row = agentRows.get(key) ?? {
          key,
          name: agentName,
          skill: "No skill",
          total: 0,
          hourly: Array.from({ length: 24 }, () => 0)
        };
        row.total += 1;
        row.hourly[hour] += 1;
        agentRows.set(key, row);
      });
    });

  const agents = Array.from(agentRows.values())
    .sort((left, right) => right.total - left.total || left.name.localeCompare(right.name, "en", { sensitivity: "base" }));

  return {
    hourlyResolved,
    coverageHours: Array.from(coverageHours).sort((left, right) => left - right),
    agents,
    totalResolved: hourlyResolved.slice(0, throughHour + 1).reduce((sum, value) => sum + value, 0)
  };
}

export function buildCecResolvedHourlyReport(
  snapshots: CecHourlySnapshotInput[],
  requestedDateKey = currentDateKey()
): CecResolvedHourlyReport {
  parseDateKey(requestedDateKey);
  const currentSnapshots = snapshots.filter((snapshot) => snapshot.cycleDownload.startsWith(`${requestedDateKey} `));
  if (!currentSnapshots.length) {
    throw new CecHourlyDataUnavailableError(requestedDateKey);
  }

  const updatedThroughHour = Math.max(...currentSnapshots.map((snapshot) => cycleHour(snapshot.cycleDownload)));
  if (updatedThroughHour < 0) throw new Error("The CEC hourly data has an invalid cycle.");

  const priorDateKey = previousDateKey(requestedDateKey);
  const current = buildDateMetrics(snapshots, requestedDateKey, updatedThroughHour);
  const previous = buildDateMetrics(snapshots, priorDateKey, updatedThroughHour);
  const previousSameHourAvailable = previous.coverageHours.includes(updatedThroughHour);
  const generatedAt = currentSnapshots.reduce((latest, snapshot) => {
    const generated = snapshot.generatedDate ? new Date(snapshot.generatedDate) : snapshot.importedAt;
    return generated > latest ? generated : latest;
  }, new Date(0));

  const topLastHour = current.agents
    .filter((agent) => agent.hourly[updatedThroughHour] > 0)
    .sort((left, right) =>
      right.hourly[updatedThroughHour] - left.hourly[updatedThroughHour] ||
      right.total - left.total ||
      left.name.localeCompare(right.name, "en", { sensitivity: "base" })
    );

  return {
    dateKey: requestedDateKey,
    dateLabel: new Intl.DateTimeFormat("en-US", {
      timeZone: SAO_PAULO_TIME_ZONE,
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    }).format(parseDateKey(requestedDateKey)),
    previousDateKey: priorDateKey,
    updatedThroughHour,
    generatedAt,
    totalResolved: current.totalResolved,
    previousTotalResolved: previousSameHourAvailable ? previous.totalResolved : null,
    lastHourResolved: current.hourlyResolved[updatedThroughHour],
    previousLastHourResolved: previousSameHourAvailable ? previous.hourlyResolved[updatedThroughHour] : null,
    activeAgents: current.agents.length,
    previousActiveAgents: previousSameHourAvailable ? previous.agents.length : null,
    averagePerAgent: current.agents.length ? current.totalResolved / current.agents.length : 0,
    previousAveragePerAgent:
      previousSameHourAvailable && previous.agents.length ? previous.totalResolved / previous.agents.length : null,
    hourlyResolved: current.hourlyResolved,
    previousHourlyResolved: previous.hourlyResolved.map((value, hour) =>
      previous.coverageHours.includes(hour) ? value : null
    ),
    previousCoverageHours: previous.coverageHours,
    agents: current.agents,
    topDay: current.agents.slice(0, 5),
    topLastHour: topLastHour.slice(0, 5),
    source: "Freshdesk CEC hourly export"
  };
}

export async function getCecResolvedHourlyReport(dateKey = currentDateKey()) {
  const priorDateKey = previousDateKey(dateKey);
  const snapshots = await prisma.realTimeCecSnapshot.findMany({
    where: {
      source: CEC_HOURLY_SOURCE,
      cycleDownload: {
        gte: `${priorDateKey} 00:00`,
        lte: `${dateKey} 23:59`
      }
    },
    orderBy: { cycleDownload: "asc" },
    select: {
      cycleDownload: true,
      fileName: true,
      generatedDate: true,
      importedAt: true,
      rawData: true
    }
  });
  const report = buildCecResolvedHourlyReport(snapshots, dateKey);
  if (!report.agents.length) return report;

  const profiles = await prisma.employeeProfile.findMany({
    where: {
      OR: report.agents.map((agent) => ({
        wbLogin: { equals: agent.name, mode: "insensitive" as const }
      }))
    },
    select: {
      wbLogin: true,
      skill: true
    }
  });
  const skillsByLogin = new Map(
    profiles.map((profile) => [
      profile.wbLogin.trim().toLowerCase(),
      profile.skill?.trim() || "No skill"
    ])
  );
  report.agents.forEach((agent) => {
    agent.skill = skillsByLogin.get(agent.key) ?? "No skill";
  });
  return report;
}

function hourLabel(hour: number) {
  const normalized = ((hour % 24) + 24) % 24;
  if (normalized === 0) return "12 AM";
  if (normalized === 12) return "12 PM";
  return normalized < 12 ? `${normalized} AM` : `${normalized - 12} PM`;
}

function compactHourLabel(hour: number) {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

function roundedRect(context: SKRSContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.closePath();
}

function fillRoundedRect(
  context: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
  stroke?: string
) {
  roundedRect(context, x, y, width, height, radius);
  context.fillStyle = fill;
  context.fill();
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = 1;
    context.stroke();
  }
}

function setFont(context: SKRSContext2D, size: number, weight = 400) {
  const family =
    weight >= 800
      ? "CEC Inter ExtraBold"
      : weight >= 700
        ? "CEC Inter Bold"
        : weight >= 550
          ? "CEC Inter SemiBold"
          : "CEC Inter Regular";
  context.font = `400 ${size}px "${family}"`;
}

function assertReportFontsAvailable(context: SKRSContext2D) {
  if (cecFontRegistrations.some((registered) => !registered)) {
    throw new Error("The CEC report fonts could not be loaded.");
  }
  setFont(context, 36, 800);
  if (context.measureText("CEC RADAR").width < 100) {
    throw new Error("The CEC report font is unavailable in the rendering environment.");
  }
}

function assertReportTextRasterized(context: SKRSContext2D) {
  const pixels = context.getImageData(20, 15, 1160, 100).data;
  let darkPixels = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    if (alpha > 200 && red < 110 && green < 130 && blue < 170) darkPixels += 1;
  }
  if (darkPixels < 500) {
    throw new Error("The CEC report text was not rasterized; the Kim message was not sent.");
  }
}

function truncateText(context: SKRSContext2D, value: string, maxWidth: number) {
  if (context.measureText(value).width <= maxWidth) return value;
  let text = value;
  while (text.length > 1 && context.measureText(`${text}…`).width > maxWidth) {
    text = text.slice(0, -1);
  }
  return `${text}…`;
}

function skillBadgePalette(skill: string) {
  const normalized = skill.trim().toUpperCase();
  if (normalized.includes("POC")) return { background: "#fff1dc", foreground: "#a85000" };
  if (normalized.includes("L2")) return { background: "#f0eaff", foreground: "#6842b8" };
  if (normalized.includes("CREDIT")) return { background: "#dff7f2", foreground: "#0b725f" };
  if (normalized.includes("L1")) return { background: "#e7f0ff", foreground: "#1765c1" };
  return { background: "#edf1f5", foreground: "#52637a" };
}

function drawSkillBadge(
  context: SKRSContext2D,
  x: number,
  y: number,
  maxWidth: number,
  skill: string
) {
  if (maxWidth < 38) return;
  const palette = skillBadgePalette(skill);
  const label = truncateText(context, skill || "No skill", Math.max(20, maxWidth - 16));
  const width = Math.min(maxWidth, Math.max(38, context.measureText(label).width + 16));
  fillRoundedRect(context, x, y, width, 24, 12, palette.background);
  context.fillStyle = palette.foreground;
  context.textAlign = "center";
  context.fillText(label, x + width / 2, y + 17);
  context.textAlign = "left";
}

function percentChange(current: number, previous: number | null) {
  if (previous === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function deltaLabel(current: number, previous: number | null, suffix = "") {
  const change = percentChange(current, previous);
  if (change === null) return "No prior-day baseline";
  const sign = change > 0 ? "+" : "";
  return `${sign}${change.toFixed(0)}% vs previous day${suffix}`;
}

function drawMetricCard(
  context: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string,
  note: string,
  accent: string
) {
  fillRoundedRect(context, x, y, width, 188, 15, "#ffffff", "#d5dfeb");
  context.fillStyle = "#0b234a";
  setFont(context, 17, 700);
  context.fillText(label, x + 22, y + 40);
  fillRoundedRect(context, x + width - 76, y + 22, 54, 28, 14, "#dff4e1");
  context.fillStyle = "#168129";
  setFont(context, 12, 800);
  context.textAlign = "center";
  context.fillText("LIVE", x + width - 49, y + 41);
  context.textAlign = "left";
  context.fillStyle = "#082452";
  setFont(context, 58, 800);
  context.fillText(value, x + 22, y + 113);
  context.fillStyle = note.startsWith("+") ? accent : "#60738f";
  setFont(context, 15, 600);
  context.fillText(truncateText(context, note, width - 44), x + 22, y + 158);
}

function heatColor(value: number, maximum: number) {
  if (value <= 0 || maximum <= 0) return "#f1f7f2";
  const ratio = Math.min(1, value / maximum);
  if (ratio < 0.25) return "#e3f4e4";
  if (ratio < 0.5) return "#bfe5c1";
  if (ratio < 0.75) return "#84cb88";
  return "#42a84d";
}

export function renderCecResolvedKimReport(
  report: CecResolvedHourlyReport,
  options: { deliveryLabel?: string } = {}
) {
  const width = 1200;
  const height = 1900;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  assertReportFontsAvailable(context);
  context.fillStyle = "#f7faff";
  context.fillRect(0, 0, width, height);
  context.textBaseline = "alphabetic";

  context.fillStyle = "#082452";
  setFont(context, 36, 800);
  context.fillText("CEC RADAR · RESOLVED BY HOUR", 32, 66);
  context.fillStyle = "#60738f";
  setFont(context, 18, 500);
  context.fillText("Freshdesk · automatic update", 34, 103);
  context.textAlign = "right";
  context.fillStyle = "#1262d7";
  setFont(context, 22, 800);
  const displayDate = new Intl.DateTimeFormat("en-US", {
    timeZone: SAO_PAULO_TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
    year: "numeric"
  }).format(parseDateKey(report.dateKey));
  const previousDisplayDate = new Intl.DateTimeFormat("en-US", {
    timeZone: SAO_PAULO_TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
    year: "numeric"
  }).format(parseDateKey(report.previousDateKey));
  context.fillText(displayDate, 1166, 54);
  context.fillStyle = "#60738f";
  setFont(context, 17, 600);
  context.fillText(`Updated through ${hourLabel(report.updatedThroughHour)}`, 1166, 88);
  context.textAlign = "left";

  const deliveryLabel = options.deliveryLabel?.trim();
  if (deliveryLabel) {
    fillRoundedRect(context, 590, 78, 212, 34, 17, "#e1f3e3");
    context.fillStyle = "#177c29";
    context.textAlign = "center";
    setFont(context, 13, 800);
    context.fillText(deliveryLabel, 696, 101);
    context.textAlign = "left";
  }

  const metricGap = 22;
  const metricWidth = (1134 - metricGap * 3) / 4;
  drawMetricCard(
    context,
    32,
    133,
    metricWidth,
    "Resolved today",
    String(report.totalResolved),
    deltaLabel(report.totalResolved, report.previousTotalResolved),
    "#168129"
  );
  drawMetricCard(
    context,
    32 + (metricWidth + metricGap),
    133,
    metricWidth,
    "Last hour",
    String(report.lastHourResolved),
    deltaLabel(report.lastHourResolved, report.previousLastHourResolved),
    "#168129"
  );
  drawMetricCard(
    context,
    32 + (metricWidth + metricGap) * 2,
    133,
    metricWidth,
    "Resolving agents",
    String(report.activeAgents),
    deltaLabel(report.activeAgents, report.previousActiveAgents),
    "#168129"
  );
  drawMetricCard(
    context,
    32 + (metricWidth + metricGap) * 3,
    133,
    metricWidth,
    "Average per agent",
    report.averagePerAgent.toFixed(1),
    deltaLabel(report.averagePerAgent, report.previousAveragePerAgent),
    "#168129"
  );

  const chartX = 32;
  const chartY = 348;
  const chartWidth = 1134;
  const chartHeight = 645;
  fillRoundedRect(context, chartX, chartY, chartWidth, chartHeight, 15, "#ffffff", "#d5dfeb");
  context.fillStyle = "#0b234a";
  setFont(context, 29, 800);
  context.fillText("Resolved by hour", chartX + 28, chartY + 52);
  context.fillStyle = "#2aaa10";
  context.fillRect(chartX + 28, chartY + 85, 42, 6);
  context.fillStyle = "#60738f";
  setFont(context, 15, 600);
  context.fillText(`Today (${displayDate})`, chartX + 82, chartY + 94);
  context.strokeStyle = "#8ca1bd";
  context.lineWidth = 2;
  context.setLineDash([8, 6]);
  context.beginPath();
  context.moveTo(chartX + 254, chartY + 88);
  context.lineTo(chartX + 296, chartY + 88);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = "#60738f";
  context.fillText(`Previous day (${previousDisplayDate})`, chartX + 307, chartY + 94);

  const plot = { x: chartX + 70, y: chartY + 135, width: chartWidth - 104, height: 430 };
  const chartHours = Array.from({ length: 24 }, (_, hour) => hour);
  const maxValue = Math.max(
    1,
    ...chartHours.map((hour) => hour <= report.updatedThroughHour ? report.hourlyResolved[hour] : 0),
    ...chartHours.map((hour) => report.previousHourlyResolved[hour] ?? 0)
  );
  const tickMax = Math.ceil(maxValue / 20) * 20;
  for (let index = 0; index <= 4; index += 1) {
    const y = plot.y + (plot.height / 4) * index;
    const value = Math.round(tickMax - (tickMax / 4) * index);
    context.strokeStyle = "#dbe4ed";
    context.lineWidth = 1;
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(plot.x, y);
    context.lineTo(plot.x + plot.width, y);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "#60738f";
    setFont(context, 14, 500);
    context.textAlign = "right";
    context.fillText(String(value), plot.x - 12, y + 4);
  }
  context.textAlign = "left";

  const slot = plot.width / Math.max(1, chartHours.length);
  const barWidth = Math.max(9, Math.min(28, slot * 0.62));
  const peakHour = report.hourlyResolved
    .slice(0, report.updatedThroughHour + 1)
    .reduce((peak, value, hour, values) => value > values[peak] ? hour : peak, 0);
  chartHours.forEach((hour, index) => {
    const value = hour <= report.updatedThroughHour ? report.hourlyResolved[hour] : 0;
    const barHeight = (value / tickMax) * plot.height;
    const x = plot.x + index * slot + (slot - barWidth) / 2;
    const y = plot.y + plot.height - barHeight;
    if (value > 0) {
      fillRoundedRect(context, x, y, barWidth, barHeight, 3, "#2aaa10");
      context.fillStyle = "#167524";
      setFont(context, 14, 800);
      context.textAlign = "center";
      context.fillText(String(value), x + barWidth / 2, Math.max(plot.y + 14, y - 9));
    }
    context.fillStyle = "#60738f";
    setFont(context, 13, 600);
    context.textAlign = "center";
    context.fillText(`${String(hour).padStart(2, "0")}h`, x + barWidth / 2, plot.y + plot.height + 27);
  });
  context.textAlign = "left";

  const comparableHours = chartHours.filter((hour) => report.previousHourlyResolved[hour] !== null);
  if (comparableHours.length) {
    context.strokeStyle = "#8ca1bd";
    context.lineWidth = 3;
    context.setLineDash([8, 6]);
    context.beginPath();
    comparableHours.forEach((hour, index) => {
      const chartIndex = chartHours.indexOf(hour);
      const value = report.previousHourlyResolved[hour] ?? 0;
      const x = plot.x + chartIndex * slot + slot / 2;
      const y = plot.y + plot.height - (value / tickMax) * plot.height;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
    context.setLineDash([]);
  } else {
    context.fillStyle = "#60738f";
    setFont(context, 15, 600);
    const coverage = report.previousCoverageHours.length
      ? `Previous-day coverage starts at ${hourLabel(report.previousCoverageHours[0])}.`
      : "Previous-day data is not available.";
    context.fillText(coverage, plot.x + 12, plot.y + 25);
  }

  if (report.hourlyResolved[peakHour] > 0) {
    const peakSlotX = plot.x + peakHour * slot + slot / 2;
    fillRoundedRect(context, peakSlotX - 45, plot.y + 10, 90, 32, 6, "#11762a");
    context.fillStyle = "#ffffff";
    context.textAlign = "center";
    setFont(context, 13, 800);
    context.fillText(`Peak: ${report.hourlyResolved[peakHour]}`, peakSlotX, plot.y + 32);
    context.textAlign = "left";
  }

  const heatmapX = 32;
  const heatmapY = 1023;
  const heatmapWidth = 1134;
  const heatmapHeight = 740;
  fillRoundedRect(context, heatmapX, heatmapY, heatmapWidth, heatmapHeight, 15, "#ffffff", "#d5dfeb");
  context.fillStyle = "#0b234a";
  setFont(context, 28, 800);
  context.fillText("Hourly distribution", heatmapX + 26, heatmapY + 52);
  const displayStartHour = 0;
  const heatHours = Array.from({ length: report.updatedThroughHour - displayStartHour + 1 }, (_, index) => displayStartHour + index);
  const heatAgents = report.agents.slice(0, 10);
  const nameWidth = 270;
  const totalWidth = 78;
  const gridX = heatmapX + 24 + nameWidth;
  const gridWidth = heatmapWidth - 48 - nameWidth - totalWidth;
  const cellWidth = gridWidth / Math.max(1, heatHours.length);
  const rowHeight = 48;
  const tableY = heatmapY + 108;
  const heatMaximum = Math.max(1, ...heatAgents.flatMap((agent) => heatHours.map((hour) => agent.hourly[hour])));

  context.fillStyle = "#0b234a";
  setFont(context, 13, 700);
  context.fillText("AGENT", heatmapX + 26, tableY - 20);
  heatHours.forEach((hour, index) => {
    context.textAlign = "center";
    context.fillText(`${String(hour).padStart(2, "0")}h`, gridX + index * cellWidth + cellWidth / 2, tableY - 20);
  });
  context.textAlign = "right";
  context.fillText("TOTAL", heatmapX + heatmapWidth - 26, tableY - 20);
  context.textAlign = "left";

  heatAgents.forEach((agent, rowIndex) => {
    const rowY = tableY + rowIndex * rowHeight;
    context.strokeStyle = "#e2e9f0";
    context.beginPath();
    context.moveTo(heatmapX + 24, rowY + rowHeight - 4);
    context.lineTo(heatmapX + heatmapWidth - 24, rowY + rowHeight - 4);
    context.stroke();
    context.fillStyle = "#0b234a";
    setFont(context, 16, 600);
    const agentX = heatmapX + 26;
    const agentLabel = truncateText(context, agent.name, nameWidth - 116);
    context.fillText(agentLabel, agentX, rowY + 30);
    const agentLabelWidth = context.measureText(agentLabel).width;
    setFont(context, 11, 800);
    const badgeX = agentX + agentLabelWidth + 10;
    drawSkillBadge(context, badgeX, rowY + 11, gridX - badgeX - 8, agent.skill);
    heatHours.forEach((hour, columnIndex) => {
      const value = agent.hourly[hour];
      const cellX = gridX + columnIndex * cellWidth + 1;
      fillRoundedRect(context, cellX, rowY + 4, Math.max(2, cellWidth - 2), 38, 2, heatColor(value, heatMaximum));
      if (value > 0) {
        context.fillStyle = value / heatMaximum >= 0.75 ? "#ffffff" : "#0c5420";
        setFont(context, 13, 800);
        context.textAlign = "center";
        context.fillText(String(value), cellX + (cellWidth - 2) / 2, rowY + 29);
      }
    });
    context.fillStyle = "#0b234a";
    setFont(context, 17, 800);
    context.textAlign = "right";
    context.fillText(String(agent.total), heatmapX + heatmapWidth - 26, rowY + 30);
    context.textAlign = "left";
  });

  const totalsY = tableY + heatAgents.length * rowHeight + 20;
  context.fillStyle = "#0b234a";
  setFont(context, 16, 800);
  context.fillText("Hourly total", heatmapX + 26, totalsY);
  heatHours.forEach((hour, index) => {
    context.textAlign = "center";
    context.fillText(String(report.hourlyResolved[hour]), gridX + index * cellWidth + cellWidth / 2, totalsY);
  });
  context.textAlign = "right";
  context.fillText(String(report.totalResolved), heatmapX + heatmapWidth - 26, totalsY);
  context.textAlign = "left";

  context.strokeStyle = "#cfd9e5";
  context.beginPath();
  context.moveTo(32, 1810);
  context.lineTo(1166, 1810);
  context.stroke();
  context.fillStyle = "#60738f";
  setFont(context, 15, 550);
  context.fillText(
    `Generated automatically from Freshdesk · CEC · Unique ticket IDs with status Resolved`,
    34,
    1860
  );
  context.textAlign = "right";
  context.fillText(
    `${displayDate} ${new Intl.DateTimeFormat("en-US", {
      timeZone: SAO_PAULO_TIME_ZONE,
      hour: "numeric",
      minute: "2-digit"
    }).format(report.generatedAt)}`,
    1166,
    1860
  );
  context.textAlign = "left";

  assertReportTextRasterized(context);
  const buffer = canvas.toBuffer("image/png");
  if (buffer.length > MAX_KIM_IMAGE_BYTES) {
    throw new Error(`The generated report is ${(buffer.length / 1024 / 1024).toFixed(2)} MB; Kim accepts up to 2 MB.`);
  }
  return buffer;
}

export type KimSendResult = {
  success: true;
  status: number;
  code: number | string;
  message: string;
};

function validateKimWebhook(value: string) {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.hostname !== KIM_WEBHOOK_HOST || url.pathname !== "/api/robot/send") {
    throw new Error("CEC_KIM_WEBHOOK_URL must be the official HTTPS Kim robot endpoint.");
  }
  if (!url.searchParams.get("key")) throw new Error("CEC_KIM_WEBHOOK_URL is missing the robot key.");
  return url;
}

function formatKimGeneratedAt(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: SAO_PAULO_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(value);
}

export function buildCecKwaiTalkMarkdownPayload(
  report: Pick<CecResolvedHourlyReport, "dateKey" | "updatedThroughHour">,
  imageUrl: string,
  generatedAt = new Date()
) {
  const cycle = `${report.dateKey} ${String(report.updatedThroughHour).padStart(2, "0")}:00`;
  return {
    msgtype: "markdown",
    markdown: {
      content: [
        "### CEC Resolved Report",
        `**Cycle:** ${cycle}`,
        `**Generated:** ${formatKimGeneratedAt(generatedAt)}`,
        `![CEC Resolved Report](${imageUrl})`
      ].join("\n\n")
    }
  };
}

type CecKimImagePublisher = (
  image: Buffer,
  report: Pick<CecResolvedHourlyReport, "dateKey" | "updatedThroughHour">
) => Promise<string>;

async function publishCecKimImage(
  image: Buffer,
  report: Pick<CecResolvedHourlyReport, "dateKey" | "updatedThroughHour">
) {
  const { uploadPublicObject } = await import("@/lib/supabase-storage");
  const cycle = `${report.dateKey}-${String(report.updatedThroughHour).padStart(2, "0")}-00`;
  const fileName = `cec_resolved_${cycle}_${randomUUID()}.png`;
  const file = new File([Uint8Array.from(image)], fileName, { type: "image/png" });
  const uploaded = await uploadPublicObject("mural-media", `automation/cec-resolved/${fileName}`, file);
  return uploaded.publicUrl;
}

async function validatePublishedKimImage(imageUrl: string, fetcher: typeof fetch) {
  const url = new URL(imageUrl);
  if (url.protocol !== "https:") {
    throw new Error("The CEC report image must have a public HTTPS URL.");
  }
  const response = await fetcher(url, {
    method: "GET",
    headers: { Accept: "image/png" },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) {
    throw new Error(`The public CEC report image responded HTTP ${response.status}.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 10_000 || bytes.subarray(1, 4).toString() !== "PNG") {
    throw new Error("The public CEC report image is empty or invalid.");
  }
}

export async function sendCecResolvedReportToKim(
  image: Buffer,
  report: Pick<CecResolvedHourlyReport, "dateKey" | "updatedThroughHour">,
  webhookUrl = process.env.CEC_KIM_WEBHOOK_URL?.trim() ?? "",
  fetcher: typeof fetch = fetch,
  imagePublisher: CecKimImagePublisher = publishCecKimImage
): Promise<KimSendResult> {
  if (!webhookUrl) throw new Error("CEC_KIM_WEBHOOK_URL is not configured.");
  if (!image.length) throw new Error("The report image is empty.");
  if (image.length > MAX_KIM_IMAGE_BYTES) throw new Error("The report image exceeds Kim's 2 MB limit.");

  const sendUrl = validateKimWebhook(webhookUrl);
  const imageUrl = await imagePublisher(image, report);
  await validatePublishedKimImage(imageUrl, fetcher);

  const response = await fetcher(sendUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildCecKwaiTalkMarkdownPayload(report, imageUrl)),
    signal: AbortSignal.timeout(30_000)
  });

  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    payload = {};
  }
  const code = payload.errcode ?? payload.code ?? payload.status ?? response.status;
  const message = String(payload.errmsg ?? payload.message ?? (response.ok ? "ok" : `HTTP ${response.status}`));
  const rejected =
    !response.ok ||
    payload.success === false ||
    (typeof payload.errcode === "number" && payload.errcode !== 0) ||
    (typeof payload.code === "number" && payload.code !== 0);
  if (rejected) throw new Error(`Kim rejected the report (${String(code)}): ${message}`);

  return {
    success: true,
    status: response.status,
    code: typeof code === "string" || typeof code === "number" ? code : 0,
    message
  };
}
