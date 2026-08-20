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
const SKILL_CARDS_PER_ROW = 4;
const SKILL_CARD_HEIGHT = 104;
const SKILL_CARD_GAP = 14;
const NAVY = "#0F172A";
const MUTED = "#64748B";
const BLUE = "#2563EB";
const GREEN = "#10B981";
const RED = "#EF4444";
const SOFT_BLUE = "#DBEAFE";
const SKILL_BADGE_PALETTES = [
  { background: "#DBEAFE", border: "#BFDBFE", color: "#1D4ED8" },
  { background: "#EDE9FE", border: "#DDD6FE", color: "#6D28D9" },
  { background: "#CFFAFE", border: "#A5F3FC", color: "#0E7490" },
  { background: "#FEF3C7", border: "#FDE68A", color: "#B45309" },
  { background: "#E0E7FF", border: "#C7D2FE", color: "#4338CA" },
  { background: "#FCE7F3", border: "#FBCFE8", color: "#BE185D" },
  { background: "#FFEDD5", border: "#FED7AA", color: "#C2410C" }
] as const;
const UNASSIGNED_SKILL_PALETTE = { background: "#F1F5F9", border: "#E2E8F0", color: "#475569" } as const;
// Rasterized directly from the Lucide ArrowUp, ArrowDown, and Minus icons.
const ICONS = {
  upGreen: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAABCUlEQVR4nO2VQQrCMBBFA7qf9AKK19ALeYtO6AG8g9KFs3aR0YUrvYIrEe8gbpUpFKWtbdA0G/NhoEzT+S+ZoVEqKuoHJVszl1DBRTQAxpNm85CQZ8mFNM9L8zeIvH8IogFYXFXNX4FrtU+HQXeug5wEuZn3A0Fdx95nO6jZHKy51gytOfuFoM/mwNmkmk926cgfBLWby5LqO8l5g4Dmnl/0JhuXa5oAivwmGxdra4Nplk7miU2nXeZtAG0QUvsbgEvVvAvgE4QTgEgzLsDiDRiPTeYuAOVMAJuD1JKayqe0A0Cv0hGAYwvMnw8hWLy/7gi8BwfQjIu3y8bvT8ZVCZuZhPMHUVGqric+KdyOuiSScAAAAABJRU5ErkJggg==",
  upBlue: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAABBUlEQVR4nO2VQQrCMBBFA3oJIVP1GrpwL2Zc5Q7exjsoXXgKV3oCJbMR8Q7SbWWQtmDTNmKajfkwUNJp3mtSUiFiYn4IoNlwieDR+UCiMYCUc/E1jwWDg6K0gJelKO1fQucDQLOvwauVOIjFcRj2zTHESmhHeC8Sun3Z+90O3Qh/WIA3vxK6GZ4omn6Oj1aXxJ+Ebodzy+c9HvMmARa4VHSfLK/jqqcuwOEe7rVI7JzgydrMuuBtAm0SPPfXAtIC7xJoknAS4Eg0W0B6AtLZBncRKL8JRSeei+cUPgMOAr0GogDGLaB//wiVyar/v8mCC8j3YVWc834PGdckiuZczg/ExIh6Xs2q1XJi/e+bAAAAAElFTkSuQmCC",
  downGreen: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAABA0lEQVR4nO2UQQrCMBBFA7pPcgEFj6EX8had4AF6B8WFXbtI7MKVXsGViHcQt5WxKNWmdlrTCJIHA6Vk5r8kpYwFAl8gjZpgsV8gDMTCqCwviL0LcA3XhwA+excQz93nFQRYuALfiL/+CIWBmGu4cAN7sZ4N2wrINBpwo3Y4i/yzkjoavw0/2STqBLDn3ltYg7PbCGQ2iU8CtnCyAMI1LOokqgSqwrlRc0YmSXrYUBqi1Zmn0ahKAO9caHUsy8OKbaM+XYAgUTpep+EEiVKQ8/AaifpyEf4iAUtqOK7FHuaUhCbRTTj5Olwee8OT6HbndolDIfzgL7yA3KgpVvFdIMAacgNn9NyRwM768QAAAABJRU5ErkJggg==",
  downRed: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAA/UlEQVR4nO2UTQrCMBBGA3oOBY+hi1Lm6xF6B2/jHZQuPIheoSsRD9DEhbiNzEJI7d+0xhYkDwZC6cz3kpQqFQh8QZEkGy41BZpoZwDLxevRBQzwfAvwegoB61YQUOEKxsb89Ueo+SdD9DDAWcfxcqiABhYGOPEs8c+qiOO1O1gTXeskugS4h3vdd3h2bwHTINEmUBcuFmAM0aFLokmgKdwQ7ZUUm6YzbqgMAW53olWTAN+5Bi418kcbRXOxgESiEuIzXCJRI+A3XCDRWl7CSxJA1kMg4x7lEyuX8B8uvQ6vxz7gJH638084SBPlzs7z0cJdCmDLVXoYCKh+vADEkwbEYSSWYAAAAABJRU5ErkJggg==",
  minus: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAASUlEQVR4nGNgGAWjYBSMglEwCkYBFpBc3N2fXNL1LaWk+z81MMgskJkMxIDUoh4ralmMjkFmD34HDHgUjIJRMApGwSgYBSMOAAAICdYxboF7uQAAAABJRU5ErkJggg=="
} as const;

export async function renderAdsOnlineProductivityReportPng(report: AdsOnlineProductivityReportSnapshot) {
  const skillCardRows = Math.ceil(report.skillAverages.length / SKILL_CARDS_PER_ROW);
  const skillSectionHeight = skillCardRows
    ? 49 + skillCardRows * SKILL_CARD_HEIGHT + Math.max(0, skillCardRows - 1) * SKILL_CARD_GAP
    : 0;
  const height = Math.max(MIN_HEIGHT, FIXED_HEIGHT + skillSectionHeight + report.rows.length * ROW_HEIGHT);
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
            {formatInteger(report.productiveAgentCount)} agents with submit
          </div>
        </div>
      </header>

      <section style={{ display: "flex", gap: 18, marginTop: 26, width: "100%" }}>
        <KpiCard
          label="AVG SUBMIT / HOUR / AGENT"
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

      {report.skillAverages.length ? <SkillAverageCards report={report} /> : null}

      <section style={{ ...panelStyle, display: "flex", flexDirection: "column", marginTop: 24, overflow: "hidden", width: "100%" }}>
        <div style={{ borderBottom: "1px solid #D7E0EA", color: NAVY, display: "flex", fontSize: 28, fontWeight: 900, padding: "22px 28px" }}>
          Agents with submit in current interval
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
        <LegendItem icon={ICONS.upGreen} label="Increase" />
        <LegendItem icon={ICONS.minus} label="No change" />
        <LegendItem icon={ICONS.downRed} label="Decrease" />
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

function SkillAverageCards({ report }: { report: AdsOnlineProductivityReportSnapshot }) {
  const availableWidth = WIDTH - 96;
  const cardWidth = Math.floor((availableWidth - SKILL_CARD_GAP * (SKILL_CARDS_PER_ROW - 1)) / SKILL_CARDS_PER_ROW);
  return (
    <section style={{ display: "flex", flexDirection: "column", marginTop: 22, width: "100%" }}>
      <div style={{ color: MUTED, display: "flex", fontSize: 15, fontWeight: 900, letterSpacing: 2, marginBottom: 12 }}>
        AVG SUBMIT BY SKILL
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: SKILL_CARD_GAP, width: "100%" }}>
        {report.skillAverages.map((item) => (
          <div key={item.skill} style={{ ...panelStyle, display: "flex", flexDirection: "column", height: SKILL_CARD_HEIGHT, justifyContent: "space-between", padding: "14px 18px", width: cardWidth }}>
            <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", width: "100%" }}>
              <SkillBadge skill={item.skill} />
              <span style={{ color: MUTED, display: "flex", fontSize: 13, fontWeight: 800 }}>
                {formatInteger(item.agentCount)} {item.agentCount === 1 ? "agent" : "agents"}
              </span>
            </div>
            <div style={{ alignItems: "baseline", display: "flex" }}>
              <span style={{ color: NAVY, display: "flex", fontSize: 33, fontWeight: 900 }}>{formatAverage(item.averageSubmit)}</span>
              <span style={{ color: MUTED, display: "flex", fontSize: 14, fontWeight: 800, marginLeft: 8 }}>avg submit</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SubmitComparison({ percent }: { percent: number | null }) {
  if (percent === null) {
    return <span style={{ color: BLUE, display: "flex", fontSize: 17, fontWeight: 900 }}>New activity vs. previous hour</span>;
  }
  const positive = percent >= 0;
  return (
    <span style={{ alignItems: "center", color: positive ? GREEN : RED, display: "flex", fontSize: 17, fontWeight: 900 }}>
      <Icon src={positive ? ICONS.upGreen : ICONS.downRed} />
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
      <Icon src={faster ? ICONS.downGreen : ICONS.upBlue} />
      <span style={{ display: "flex", marginLeft: 6 }}>{formatShortDuration(Math.abs(deltaMs))} {faster ? "faster" : "slower"} than previous hour</span>
    </span>
  );
}

function TableHeader({ report }: { report: AdsOnlineProductivityReportSnapshot }) {
  return (
    <div style={{ alignItems: "center", background: "#F8FAFC", borderBottom: "1px solid #D7E0EA", color: MUTED, display: "flex", fontSize: 16, fontWeight: 900, height: 56, letterSpacing: 1, padding: "0 26px", width: "100%" }}>
      <div style={{ display: "flex", width: 64 }}>#</div>
      <div style={{ display: "flex", width: 350 }}>AGENT / WB</div>
      <div style={{ alignItems: "center", display: "flex", width: 280 }}>
        <span style={{ display: "flex" }}>SUBMIT {report.currentHourLabel}</span>
        <span style={{ display: "flex", marginLeft: 6 }}><Icon size={17} src={ICONS.downRed} /></span>
      </div>
      <div style={{ display: "flex", width: 230 }}>VS. {report.previousHourLabel}</div>
      <div style={{ display: "flex", width: 180 }}>SHIFT TOTAL</div>
      <div style={{ display: "flex", width: 145 }}>AVG AHT</div>
      <div style={{ display: "flex", width: 170 }}>MODERATION (MIN)</div>
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
      <div style={{ display: "flex", flexDirection: "column", width: 350 }}>
        <div style={{ color: NAVY, display: "flex", fontSize: 21, fontWeight: 900 }}>{truncate(row.name, 30)}</div>
        <div style={{ alignItems: "center", color: MUTED, display: "flex", fontSize: 16, fontWeight: 700, marginTop: 3 }}>
          <span style={{ display: "flex" }}>{truncate(row.wbLogin, row.skill ? 20 : 34)}</span>
          {row.skill ? <SkillBadge marginLeft={9} skill={row.skill} /> : null}
        </div>
      </div>
      <div style={{ alignItems: "center", display: "flex", width: 280 }}>
        <div style={{ color: NAVY, display: "flex", fontSize: 24, fontWeight: 900, width: 55 }}>{formatInteger(row.currentSubmit)}</div>
        <div style={{ background: "#E2E8F0", borderRadius: 999, display: "flex", height: 5, overflow: "hidden", width: 190 }}>
          <div style={{ background: BLUE, borderRadius: 999, display: "flex", height: 5, width: `${Math.max(2, (row.currentSubmit / maxSubmit) * 100)}%` }} />
        </div>
      </div>
      <div style={{ alignItems: "center", display: "flex", width: 230 }}>
        <div style={{ alignItems: "center", background: comparison.background, borderRadius: 10, color: comparison.color, display: "flex", fontSize: 18, fontWeight: 900, justifyContent: "center", minWidth: 96, padding: "8px 10px" }}>
          <Icon size={17} src={comparison.icon} />
          <span style={{ display: "flex", marginLeft: 5 }}>{comparison.label}</span>
        </div>
        <span style={{ color: MUTED, display: "flex", fontSize: 16, fontWeight: 700, marginLeft: 12 }}>({formatInteger(row.previousSubmit)})</span>
      </div>
      <div style={{ color: NAVY, display: "flex", fontSize: 22, fontWeight: 900, width: 180 }}>{formatInteger(row.shiftTotal)}</div>
      <div style={{ color: NAVY, display: "flex", fontSize: 21, fontWeight: 900, width: 145 }}>{formatDuration(row.ahtMs)}</div>
      <div style={{ color: NAVY, display: "flex", fontSize: 21, fontWeight: 900, width: 170 }}>{formatMinutes(row.moderationMs)}</div>
    </div>
  );
}

function SkillBadge({ skill, marginLeft = 0 }: { skill: string; marginLeft?: number }) {
  const palette = skillBadgePalette(skill);
  return (
    <span style={{
      background: palette.background,
      border: `1px solid ${palette.border}`,
      borderRadius: 999,
      color: palette.color,
      display: "flex",
      fontSize: 12,
      fontWeight: 900,
      letterSpacing: 0.5,
      marginLeft,
      padding: "3px 8px",
      textTransform: "uppercase"
    }}>
      {truncate(skill, 22)}
    </span>
  );
}

function skillBadgePalette(skill: string) {
  const normalized = skill.trim().toLowerCase();
  if (normalized === "unassigned") return UNASSIGNED_SKILL_PALETTE;
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(index)) | 0;
  }
  return SKILL_BADGE_PALETTES[Math.abs(hash) % SKILL_BADGE_PALETTES.length];
}

function EmptyRow() {
  return (
    <div style={{ alignItems: "center", color: MUTED, display: "flex", fontSize: 19, fontWeight: 800, height: 130, justifyContent: "center", width: "100%" }}>
      No ADS agents recorded submit in the current interval.
    </div>
  );
}

function LegendItem({ icon, label }: { icon: string; label: string }) {
  return (
    <span style={{ alignItems: "center", display: "flex", marginRight: 18 }}>
      <Icon size={18} src={icon} />
      <span style={{ display: "flex", marginLeft: 5 }}>{label}</span>
    </span>
  );
}

function comparisonPresentation(row: AdsOnlineProductivityAgentRow) {
  if (row.comparison === "new") {
    return {
      background: "#DBEAFE",
      color: "#1D4ED8",
      icon: ICONS.upBlue,
      label: "NEW"
    };
  }
  if (row.comparison === "equal") {
    return {
      background: "#F1F5F9",
      color: MUTED,
      icon: ICONS.minus,
      label: "0%"
    };
  }
  const up = row.comparison === "up";
  return {
    background: up ? "#D1FAE5" : "#FEE2E2",
    color: up ? "#047857" : "#DC2626",
    icon: up ? ICONS.upGreen : ICONS.downRed,
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

function formatAverage(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
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

function formatMinutes(value: number) {
  if (!Number.isFinite(value)) return "-";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(Math.max(0, value) / 60_000)} min`;
}

function truncate(value: string, length: number) {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function Icon({ src, size = 20 }: { src: string; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt="" height={size} src={src} width={size} />;
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
