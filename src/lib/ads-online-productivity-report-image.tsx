import { ImageResponse } from "next/og";
import React from "react";
import type { CSSProperties, ReactNode } from "react";

import type {
  AdsOnlineProductivityAgentRow,
  AdsOnlineProductivityReportSnapshot
} from "@/lib/ads-online-productivity-report-core";

const WIDTH = 1600;
const ROW_HEIGHT = 80;
const MIN_HEIGHT = 1400;
const FIXED_HEIGHT = 760;
const NAVY = "#0F172A";
const MUTED = "#64748B";
const BLUE = "#2563EB";
const GREEN = "#10B981";
const RED = "#EF4444";
const SOFT_BLUE = "#DBEAFE";

export async function renderAdsOnlineProductivityReportPng(report: AdsOnlineProductivityReportSnapshot) {
  const height = Math.max(MIN_HEIGHT, FIXED_HEIGHT + report.rows.length * ROW_HEIGHT);
  const response = new ImageResponse(<AdsOnlineProductivityReportImage report={report} />, {
    width: WIDTH,
    height
  });
  return Buffer.from(await response.arrayBuffer());
}

function AdsOnlineProductivityReportImage({ report }: { report: AdsOnlineProductivityReportSnapshot }) {
  const maxSubmit = Math.max(1, ...report.rows.map((row) => row.currentSubmit));
  return (
    <div style={rootStyle}>
      <header style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ color: BLUE, fontSize: 17, fontWeight: 900, letterSpacing: 3 }}>ADS · ONLINE PRODUCTIVITY</div>
          <div style={{ color: NAVY, fontSize: 58, fontWeight: 900, marginTop: 9 }}>Agent Production</div>
          <div style={{ color: MUTED, display: "flex", fontSize: 20, fontWeight: 700, marginTop: 9 }}>
            Current interval {report.intervalLabel} · compared with {report.previousIntervalLabel}
          </div>
        </div>
        <div style={{ alignItems: "flex-end", display: "flex", flexDirection: "column" }}>
          <div style={{ background: SOFT_BLUE, borderRadius: 999, color: "#1D4ED8", display: "flex", fontSize: 20, fontWeight: 900, padding: "13px 22px" }}>
            {report.dateLabel}
          </div>
          <div style={{ alignItems: "center", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 13, color: "#047857", display: "flex", fontSize: 18, fontWeight: 900, marginTop: 12, padding: "11px 18px" }}>
            <span style={{ background: GREEN, borderRadius: 999, display: "flex", height: 10, marginRight: 10, width: 10 }} />
            {formatInteger(report.onlineCount)} agents online
          </div>
        </div>
      </header>

      <section style={{ display: "flex", gap: 18, marginTop: 26, width: "100%" }}>
        <KpiCard
          label="AVG SUBMIT / HOUR"
          value={formatInteger(report.averageSubmitPerHour)}
          comparison={<SubmitComparison percent={report.submitComparisonPercent} />}
        />
        <KpiCard
          label="AVG AHT"
          value={formatDuration(report.currentIntervalAhtMs)}
          comparison={<AhtComparison deltaMs={report.ahtDeltaMs} />}
        />
        <KpiCard
          label="TOTAL SHIFT SUBMIT"
          value={formatInteger(report.totalShiftSubmit)}
          comparison={<span style={{ color: MUTED, display: "flex", fontSize: 17, fontWeight: 700 }}>shift date {report.dateLabel.slice(0, 5)}</span>}
        />
      </section>

      <section style={{ ...panelStyle, display: "flex", flexDirection: "column", marginTop: 24, overflow: "hidden", width: "100%" }}>
        <div style={{ borderBottom: "1px solid #D7E0EA", color: NAVY, display: "flex", fontSize: 28, fontWeight: 900, padding: "22px 28px" }}>
          Online agents in current interval
        </div>
        <TableHeader report={report} />
        <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
          {report.rows.length
            ? report.rows.map((row, index) => <AgentRow key={`${row.wbLogin}-${index}`} index={index} maxSubmit={maxSubmit} report={report} row={row} />)
            : <EmptyRow />}
        </div>
      </section>

      <section style={{ alignItems: "center", color: MUTED, display: "flex", fontSize: 15, fontWeight: 700, marginTop: 24, width: "100%" }}>
        <span style={{ display: "flex", marginRight: 20 }}>Comparison: current interval vs. previous interval</span>
        <LegendItem color={GREEN} icon="↑" label="Increase" />
        <LegendItem color={MUTED} icon="=" label="No change" />
        <LegendItem color={RED} icon="↓" label="Decrease" />
        <span style={{ display: "flex", marginLeft: 12 }}>( ) Previous interval submit</span>
      </section>

      <footer style={{ color: "#94A3B8", display: "flex", fontSize: 15, fontWeight: 700, justifyContent: "space-between", marginTop: 22, width: "100%" }}>
        <span>Central Operations · ADS · hourly online productivity</span>
        <span>Cycle {report.selectedCycle}</span>
      </footer>
    </div>
  );
}

function KpiCard({ label, value, comparison }: { label: string; value: string; comparison: ReactNode }) {
  return (
    <div style={{ ...panelStyle, display: "flex", flex: 1, flexDirection: "column", height: 205, padding: "25px 28px" }}>
      <div style={{ color: MUTED, display: "flex", fontSize: 15, fontWeight: 900, letterSpacing: 2 }}>{label}</div>
      <div style={{ color: NAVY, display: "flex", fontSize: 49, fontWeight: 900, marginTop: 20 }}>{value}</div>
      <div style={{ alignItems: "center", display: "flex", marginTop: 14 }}>{comparison}</div>
    </div>
  );
}

function SubmitComparison({ percent }: { percent: number | null }) {
  if (percent === null) {
    return <span style={{ color: BLUE, display: "flex", fontSize: 17, fontWeight: 900 }}>New activity vs. previous hour</span>;
  }
  const positive = percent >= 0;
  return (
    <span style={{ alignItems: "center", color: positive ? GREEN : RED, display: "flex", fontSize: 17, fontWeight: 900 }}>
      <span style={{ display: "flex" }}>{positive ? "↑" : "↓"}</span>
      <span style={{ display: "flex", marginLeft: 6 }}>{formatPercent(Math.abs(percent))} vs. previous hour</span>
    </span>
  );
}

function AhtComparison({ deltaMs }: { deltaMs: number | null }) {
  if (deltaMs === null) {
    return <span style={{ color: MUTED, display: "flex", fontSize: 17, fontWeight: 700 }}>No previous-hour comparison</span>;
  }
  const faster = deltaMs <= 0;
  return (
    <span style={{ alignItems: "center", color: faster ? GREEN : RED, display: "flex", fontSize: 17, fontWeight: 900 }}>
      <span style={{ display: "flex" }}>{faster ? "↓" : "↑"}</span>
      <span style={{ display: "flex", marginLeft: 6 }}>{formatShortDuration(Math.abs(deltaMs))} {faster ? "faster" : "slower"} than previous hour</span>
    </span>
  );
}

function TableHeader({ report }: { report: AdsOnlineProductivityReportSnapshot }) {
  return (
    <div style={{ alignItems: "center", background: "#F8FAFC", borderBottom: "1px solid #D7E0EA", color: MUTED, display: "flex", fontSize: 16, fontWeight: 900, height: 56, letterSpacing: 1, padding: "0 26px", width: "100%" }}>
      <div style={{ display: "flex", width: 64 }}>#</div>
      <div style={{ display: "flex", width: 410 }}>AGENT / WB</div>
      <div style={{ display: "flex", width: 305 }}>SUBMIT {report.currentHourLabel} ↓</div>
      <div style={{ display: "flex", width: 255 }}>VS. {report.previousHourLabel}</div>
      <div style={{ display: "flex", width: 220 }}>SHIFT TOTAL</div>
      <div style={{ display: "flex", width: 160 }}>AVG AHT</div>
    </div>
  );
}

function AgentRow({
  row,
  index,
  maxSubmit,
  report
}: {
  row: AdsOnlineProductivityAgentRow;
  index: number;
  maxSubmit: number;
  report: AdsOnlineProductivityReportSnapshot;
}) {
  const comparison = comparisonPresentation(row);
  return (
    <div style={{ alignItems: "center", background: index % 2 ? "#F8FAFC" : "#FFFFFF", borderBottom: "1px solid #E8EEF5", display: "flex", height: ROW_HEIGHT, padding: "0 26px", width: "100%" }}>
      <div style={{ display: "flex", width: 64 }}>
        <div style={{ alignItems: "center", background: SOFT_BLUE, borderRadius: 999, color: "#1D4ED8", display: "flex", fontSize: 18, fontWeight: 900, height: 38, justifyContent: "center", width: 38 }}>
          {index + 1}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", width: 410 }}>
        <div style={{ color: NAVY, display: "flex", fontSize: 21, fontWeight: 900 }}>{truncate(row.name, 36)}</div>
        <div style={{ color: MUTED, display: "flex", fontSize: 16, fontWeight: 700, marginTop: 3 }}>{truncate(row.wbLogin, 34)}</div>
      </div>
      <div style={{ alignItems: "center", display: "flex", width: 305 }}>
        <div style={{ color: NAVY, display: "flex", fontSize: 24, fontWeight: 900, width: 55 }}>{formatInteger(row.currentSubmit)}</div>
        <div style={{ background: "#E2E8F0", borderRadius: 999, display: "flex", height: 5, overflow: "hidden", width: 210 }}>
          <div style={{ background: BLUE, borderRadius: 999, display: "flex", height: 5, width: `${Math.max(2, (row.currentSubmit / maxSubmit) * 100)}%` }} />
        </div>
      </div>
      <div style={{ alignItems: "center", display: "flex", width: 255 }}>
        <div style={{ alignItems: "center", background: comparison.background, borderRadius: 10, color: comparison.color, display: "flex", fontSize: 18, fontWeight: 900, justifyContent: "center", minWidth: 96, padding: "8px 10px" }}>
          {comparison.icon}
          <span style={{ display: "flex", marginLeft: 5 }}>{comparison.label}</span>
        </div>
        <span style={{ color: MUTED, display: "flex", fontSize: 16, fontWeight: 700, marginLeft: 12 }}>({formatInteger(row.previousSubmit)})</span>
      </div>
      <div style={{ color: NAVY, display: "flex", fontSize: 22, fontWeight: 900, width: 220 }}>{formatInteger(row.shiftTotal)}</div>
      <div style={{ color: NAVY, display: "flex", fontSize: 21, fontWeight: 900, width: 160 }}>{formatDuration(row.ahtMs)}</div>
    </div>
  );
}

function EmptyRow() {
  return (
    <div style={{ alignItems: "center", color: MUTED, display: "flex", fontSize: 19, fontWeight: 800, height: 130, justifyContent: "center", width: "100%" }}>
      No ADS agents are online in the current interval.
    </div>
  );
}

function LegendItem({ icon, label, color }: { icon: string; label: string; color: string }) {
  return (
    <span style={{ alignItems: "center", display: "flex", marginRight: 18 }}>
      <span style={{ color, display: "flex", fontSize: 18, fontWeight: 900 }}>{icon}</span>
      <span style={{ display: "flex", marginLeft: 5 }}>{label}</span>
    </span>
  );
}

function comparisonPresentation(row: AdsOnlineProductivityAgentRow) {
  if (row.comparison === "new") {
    return {
      background: "#DBEAFE",
      color: "#1D4ED8",
      icon: "↑",
      label: "NEW"
    };
  }
  if (row.comparison === "equal") {
    return {
      background: "#F1F5F9",
      color: MUTED,
      icon: "=",
      label: "0%"
    };
  }
  const up = row.comparison === "up";
  return {
    background: up ? "#D1FAE5" : "#FEE2E2",
    color: up ? "#047857" : "#DC2626",
    icon: up ? "↑" : "↓",
    label: formatPercent(Math.abs(row.comparisonPercent ?? 0))
  };
}

function formatInteger(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? "-"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(value));
}

function formatPercent(value: number) {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatDuration(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  const seconds = Math.max(0, Math.round(value / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
}

function formatShortDuration(value: number) {
  const seconds = Math.max(0, Math.round(value / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}

function truncate(value: string, length: number) {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

const panelStyle: CSSProperties = {
  background: "#FFFFFF",
  border: "1px solid #D7E0EA",
  borderRadius: 20,
  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.04)"
};

const rootStyle: CSSProperties = {
  background: "#F4F7FB",
  display: "flex",
  flexDirection: "column",
  fontFamily: "Arial, sans-serif",
  height: "100%",
  padding: 48,
  width: "100%"
};
