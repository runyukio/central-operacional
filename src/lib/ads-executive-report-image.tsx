import { ImageResponse } from "next/og";
import React from "react";
import type { CSSProperties, ReactNode } from "react";

import type {
  AdsExecutiveHourBucket,
  AdsExecutiveKpi,
  AdsExecutiveRankingRow,
  AdsExecutiveReportSnapshot
} from "@/lib/ads-executive-report-core";

const WIDTH = 2000;
const HEIGHT = 2000;
const NAVY = "#0F172A";
const MUTED = "#64748B";
const BLUE = "#2563EB";
const GREEN = "#10B981";
const RED = "#EF4444";
const PINK = "#E94471";

export async function renderAdsExecutiveReportPng(report: AdsExecutiveReportSnapshot) {
  const response = new ImageResponse(<AdsExecutiveReportImage report={report} />, {
    width: WIDTH,
    height: HEIGHT
  });
  return Buffer.from(await response.arrayBuffer());
}

function AdsExecutiveReportImage({ report }: { report: AdsExecutiveReportSnapshot }) {
  const heatmapRows = buildHeatmapRows(report.buckets);
  return (
    <div style={rootStyle}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: BLUE, letterSpacing: 4 }}>ADS EXECUTIVE REPORT</div>
          <div style={{ marginTop: 8, fontSize: 48, fontWeight: 900, color: NAVY }}>Operational radar</div>
          <div style={{ display: "flex", marginTop: 8, fontSize: 20, fontWeight: 700, color: MUTED }}>Latest valid cycle: {report.latestHourLabel}</div>
        </div>
        <div style={{ display: "flex", padding: "14px 24px", borderRadius: 999, color: "#1D4ED8", background: "#DBEAFE", fontSize: 21, fontWeight: 900 }}>
          {report.dateLabel}
        </div>
      </header>

      <section style={{ display: "flex", width: "100%", gap: 20, marginTop: 30 }}>
        {report.cards.map((card, index) => <KpiCard key={card.label} card={card} buckets={report.buckets} index={index} />)}
      </section>

      <section style={{ ...panelStyle, display: "flex", flexDirection: "column", marginTop: 24, height: 670 }}>
        <div style={{ display: "flex", flexDirection: "column", padding: "24px 28px 18px", borderBottom: "1px solid #E2E8F0" }}>
          <div style={{ fontSize: 28, fontWeight: 900, color: NAVY }}>Hourly health map</div>
          <div style={{ marginTop: 5, fontSize: 17, fontWeight: 700, color: MUTED }}>ADS operational status by hour, using hourly deltas.</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", padding: "18px 24px 22px", flex: 1 }}>
          <Heatmap rows={heatmapRows} />
        </div>
      </section>

      <section style={{ display: "flex", width: "100%", gap: 22, marginTop: 24, height: 390 }}>
        <ChartPanel title="Input x Forecast" subtitle="Real ADS volume against hourly forecast" style={{ flex: 1.42 }}>
          <LineChart
            buckets={report.buckets}
            series={[
              { key: "forecast", color: PINK, dashed: true },
              { key: "input", color: GREEN, fill: true }
            ]}
          />
        </ChartPanel>
        <ChartPanel title="Backlog" subtitle="ADS backlog through the day" style={{ flex: 1 }}>
          <LineChart buckets={report.buckets} series={[{ key: "backlog", color: BLUE, fill: true }]} />
        </ChartPanel>
      </section>

      <section style={{ display: "flex", width: "100%", gap: 22, marginTop: 24, height: 290 }}>
        <Ranking title="Top performance · last hour" rows={report.topAgents} />
        <Ranking title="Low performance · last hour" rows={report.lowAgents} />
      </section>

      <footer style={{ display: "flex", justifyContent: "space-between", width: "100%", marginTop: 22, color: "#94A3B8", fontSize: 16, fontWeight: 700 }}>
        <span>Central Operacional · automated executive report</span>
        <span>Cycle {report.selectedCycle}</span>
      </footer>
    </div>
  );
}

function KpiCard({ card, buckets, index }: { card: AdsExecutiveKpi; buckets: AdsExecutiveHourBucket[]; index: number }) {
  const positive = card.delta === null ? null : card.betterWhen === "up" ? card.delta >= 0 : card.delta <= 0;
  const color = positive === null ? BLUE : positive ? GREEN : RED;
  const key = (["output", "input", "online", "backlog"] as const)[index] ?? "input";
  const values = buckets.map((bucket) => bucket[key]).filter(isFiniteNumber);
  return (
    <div style={{ ...panelStyle, display: "flex", flex: 1, minWidth: 0, height: 190, padding: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: MUTED, letterSpacing: 2 }}>{card.label.toUpperCase()}</div>
        <div style={{ marginTop: 22, fontSize: 46, fontWeight: 900, color: NAVY }}>{formatInteger(card.value)}</div>
        <div style={{ display: "flex", alignItems: "center", marginTop: 14, color, fontSize: 18, fontWeight: 900 }}>
          {card.delta === null ? "No comparison" : `${card.delta > 0 ? "↑" : card.delta < 0 ? "↓" : "↔"} ${formatInteger(Math.abs(card.delta))}`}
        </div>
      </div>
      <div style={{ display: "flex", width: 145, alignItems: "flex-end" }}>
        <MiniSparkline values={values} color={color} />
      </div>
    </div>
  );
}

function MiniSparkline({ values, color }: { values: number[]; color: string }) {
  const points = chartPoints(values, 140, 80, 5);
  return (
    <svg width="140" height="80" viewBox="0 0 140 80">
      {points ? <path d={points.area} fill={color} opacity="0.12" /> : null}
      {points ? <path d={points.line} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /> : null}
    </svg>
  );
}

type HeatmapRow = { label: string; values: Array<{ text: string; tone: "empty" | "good" | "neutral" | "watch" | "bad" }> };

function Heatmap({ rows }: { rows: HeatmapRow[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", gap: 6 }}>
      <div style={{ display: "flex", width: "100%", height: 34 }}>
        <div style={{ display: "flex", alignItems: "center", width: 220, paddingLeft: 12, fontSize: 14, fontWeight: 900, color: MUTED }}>METRIC / HOUR</div>
        {Array.from({ length: 24 }, (_, hour) => (
          <div key={hour} style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, fontSize: 13, fontWeight: 900, color: MUTED }}>{String(hour).padStart(2, "0")}h</div>
        ))}
      </div>
      {rows.map((row) => (
        <div key={row.label} style={{ display: "flex", width: "100%", height: 47, gap: 5 }}>
          <div style={{ display: "flex", alignItems: "center", width: 215, paddingLeft: 12, borderRadius: 9, background: "#F1F5F9", fontSize: 15, fontWeight: 900, color: NAVY }}>{row.label}</div>
          {row.values.map((value, hour) => {
            const tone = heatmapTone(value.tone);
            return (
              <div key={`${row.label}-${hour}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, borderRadius: 8, background: tone.background, color: tone.color, fontSize: 13, fontWeight: 900 }}>
                {value.text}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ChartPanel({ title, subtitle, children, style }: { title: string; subtitle: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ ...panelStyle, ...style, display: "flex", flexDirection: "column", padding: 24, minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 25, fontWeight: 900, color: NAVY }}>{title}</div>
        <div style={{ marginTop: 4, fontSize: 16, fontWeight: 700, color: MUTED }}>{subtitle}</div>
      </div>
      <div style={{ display: "flex", flex: 1, marginTop: 16 }}>
        {children}
      </div>
    </div>
  );
}

type ChartKey = "input" | "forecast" | "backlog";

function LineChart({ buckets, series }: { buckets: AdsExecutiveHourBucket[]; series: Array<{ key: ChartKey; color: string; dashed?: boolean; fill?: boolean }> }) {
  const width = 1000;
  const height = 210;
  const allValues = series.flatMap((item) => buckets.map((bucket) => bucket[item.key])).filter(isFiniteNumber);
  const max = Math.max(1, ...allValues);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
      <svg width="100%" height="210" viewBox={`0 0 ${width} ${height}`}>
        {[0, 1, 2, 3].map((line) => <line key={line} x1="42" x2="982" y1={18 + line * 52} y2={18 + line * 52} stroke="#E2E8F0" strokeDasharray="6 8" />)}
        {series.map((item) => {
          const points = bucketChartPoints(buckets, item.key, width, height, max);
          return points ? (
            <g key={item.key}>
              {item.fill ? <path d={points.area} fill={item.color} opacity="0.1" /> : null}
              <path d={points.line} fill="none" stroke={item.color} strokeWidth="4" strokeDasharray={item.dashed ? "12 9" : undefined} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          ) : null;
        })}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", width: "100%", padding: "0 16px 0 22px", color: MUTED, fontSize: 15, fontWeight: 700 }}>
        {[0, 4, 8, 12, 16, 20, 23].map((hour) => <span key={hour}>{String(hour).padStart(2, "0")}h</span>)}
      </div>
    </div>
  );
}

function Ranking({ title, rows }: { title: string; rows: AdsExecutiveRankingRow[] }) {
  return (
    <div style={{ ...panelStyle, display: "flex", flexDirection: "column", flex: 1, minWidth: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", padding: "18px 24px", fontSize: 22, fontWeight: 900, color: NAVY, borderBottom: "1px solid #E2E8F0" }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        {(rows.length ? rows : [{ name: "No production in the last hour", wbLogin: "-", submit: 0, ahtMs: null }]).slice(0, 5).map((row, index) => (
          <div key={`${row.wbLogin}-${index}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flex: 1, padding: "0 24px", background: index % 2 ? "#F8FAFC" : "#FFFFFF" }}>
            <div style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 999, background: "#DBEAFE", color: BLUE, fontSize: 14, fontWeight: 900 }}>{index + 1}</div>
              <div style={{ display: "flex", flexDirection: "column", marginLeft: 12, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: NAVY }}>{truncate(row.name, 34)}</div>
                <div style={{ display: "flex", fontSize: 13, fontWeight: 700, color: MUTED }}>{truncate(row.wbLogin, 28)} · AHT {formatDuration(row.ahtMs)}</div>
              </div>
            </div>
            <div style={{ display: "flex", fontSize: 20, fontWeight: 900, color: NAVY }}>{formatInteger(row.submit)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildHeatmapRows(buckets: AdsExecutiveHourBucket[]): HeatmapRow[] {
  return [
    metricRow("Input", buckets, (bucket) => integerCell(bucket.input)),
    metricRow("Output", buckets, (bucket) => integerCell(bucket.output)),
    metricRow("AHT", buckets, (bucket) => durationCell(bucket.ahtMs, bucket.ahtMs === null ? "empty" : bucket.ahtMs <= 120_000 ? "good" : "watch")),
    metricRow("Input x Forecast", buckets, (bucket) => ratioCell(bucket.input, bucket.forecast)),
    metricRow("Required HC", buckets, (bucket) => integerCell(bucket.required)),
    metricRow("Online HC", buckets, (bucket) => integerCell(bucket.online)),
    metricRow("HC Gap", buckets, (bucket) => gapCell(bucket.online, bucket.required)),
    metricRow("Backlog", buckets, (bucket) => integerCell(bucket.backlog, bucket.backlog === null ? "empty" : bucket.backlog > 0 ? "watch" : "good")),
    metricRow("Max Latency", buckets, (bucket) => durationCell(bucket.maxLatencyMs, bucket.maxLatencyMs === null ? "empty" : bucket.maxLatencyMs <= 7_200_000 ? "good" : "bad"))
  ];
}

function metricRow(label: string, buckets: AdsExecutiveHourBucket[], formatter: (bucket: AdsExecutiveHourBucket) => HeatmapRow["values"][number]): HeatmapRow {
  return { label, values: buckets.map(formatter) };
}

function integerCell(value: number | null, tone: HeatmapRow["values"][number]["tone"] = "neutral") {
  return value === null ? { text: "-", tone: "empty" as const } : { text: formatInteger(value), tone };
}

function durationCell(value: number | null, tone: HeatmapRow["values"][number]["tone"]) {
  return value === null ? { text: "-", tone: "empty" as const } : { text: formatDuration(value), tone };
}

function ratioCell(input: number | null, forecast: number | null) {
  if (input === null || forecast === null || forecast <= 0) return { text: "-", tone: "empty" as const };
  const ratio = input / forecast;
  return { text: `${Math.round(ratio * 100)}%`, tone: ratio <= 1.1 ? "good" as const : ratio <= 1.25 ? "watch" as const : "bad" as const };
}

function gapCell(online: number | null, required: number | null) {
  if (online === null || required === null) return { text: "-", tone: "empty" as const };
  const gap = online - required;
  return { text: gap > 0 ? `+${gap}` : String(gap), tone: gap >= 0 ? "good" as const : "bad" as const };
}

function bucketChartPoints(buckets: AdsExecutiveHourBucket[], key: ChartKey, width: number, height: number, max: number) {
  const points = buckets
    .map((bucket, index) => ({ value: bucket[key], x: 42 + (index / 23) * (width - 60) }))
    .filter((point): point is { value: number; x: number } => isFiniteNumber(point.value));
  if (points.length < 2) return null;
  const baseline = height - 18;
  const plotted = points.map((point) => ({ x: point.x, y: baseline - (point.value / max) * (height - 42) }));
  const line = `M ${plotted.map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" L ")}`;
  const area = `${line} L ${plotted.at(-1)?.x.toFixed(1)} ${baseline} L ${plotted[0].x.toFixed(1)} ${baseline} Z`;
  return { line, area };
}

function chartPoints(values: number[], width: number, height: number, padding: number) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const points = values.map((value, index) => ({
    x: padding + (index / (values.length - 1)) * (width - padding * 2),
    y: height - padding - ((value - min) / range) * (height - padding * 2)
  }));
  const line = `M ${points.map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" L ")}`;
  return { line, area: `${line} L ${points.at(-1)?.x.toFixed(1)} ${height - padding} L ${points[0].x.toFixed(1)} ${height - padding} Z` };
}

function heatmapTone(tone: HeatmapRow["values"][number]["tone"]) {
  if (tone === "good") return { background: "#D1FAE5", color: "#047857" };
  if (tone === "watch") return { background: "#FEF3C7", color: "#B45309" };
  if (tone === "bad") return { background: "#FEE2E2", color: "#DC2626" };
  if (tone === "neutral") return { background: "#DBEAFE", color: "#1D4ED8" };
  return { background: "#F1F5F9", color: "#94A3B8" };
}

function formatInteger(value: number | null) {
  return value === null || !Number.isFinite(value) ? "-" : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);
}

function formatDuration(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  const seconds = Math.max(0, Math.round(value / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}h`;
  if (minutes > 0) return `${minutes}:${String(remainder).padStart(2, "0")}m`;
  return `0:${String(remainder).padStart(2, "0")}s`;
}

function truncate(value: string, length: number) {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const panelStyle: CSSProperties = {
  background: "#FFFFFF",
  border: "1px solid #D7E0EA",
  borderRadius: 22,
  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.04)"
};

const rootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "100%",
  height: "100%",
  padding: 44,
  background: "#F4F7FB",
  fontFamily: "Arial, sans-serif"
};
