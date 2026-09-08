"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { adherenceBarData, adherenceDateLabel } from "@/lib/work-hour-adherence-chart";
import type { AdherenceSummary } from "@/lib/work-hour-adherence-summary";

// Chart contract: seven fixed supervisors, recorded ownership, current pending
// IDs summed over the inclusive Shift Date period. Always horizontal blue bars,
// zero-based scale, exact end labels, fixed height. Recharts is the site's renderer.
export default function WorkHourJustificationChart({ data }: { data: AdherenceSummary }) {
  const [width, setWidth] = useState(0);
  const barData = adherenceBarData(data);
  const axisColor = "var(--muted)";
  const periodLabel = adherencePeriodLabel(data.startDate, data.endDate);
  return <div className="relative" data-chart-type="bar">
    <p className="mb-4 text-sm font-semibold text-muted">Pendências por supervisor · {periodLabel}</p>
    <div className="w-full min-w-0" style={{ height: 507 }} aria-label="Gráfico de barras de pendências">
      <ResponsiveContainer width="100%" height="100%" onResize={(nextWidth) => setWidth(nextWidth)}>
        <BarChart data={barData} layout="vertical" margin={{ top: 5, right: 42, bottom: 10, left: 0 }} accessibilityLayer>
          <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis type="number" allowDecimals={false} domain={[0, Math.max(1, ...barData.map((row) => row.count))]} tick={{ fill: axisColor, fontSize: 12 }} />
          <YAxis type="category" dataKey="name" width={width && width < 600 ? 112 : 175} interval={0} axisLine={false} tickLine={false} tick={<SupervisorTick compact={Boolean(width && width < 600)} />} />
          <Tooltip cursor={{ fill: "rgba(37,99,235,0.06)" }} content={<PendingTooltip />} />
          <Bar dataKey="count" name="Pendências" fill="#2563eb" barSize={22} radius={[0, 4, 4, 0]} isAnimationActive={false}><LabelList dataKey="count" position="right" fill={axisColor} fontSize={12} /></Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
    <p className="mt-3 text-xs text-muted">Quantidade de justificativas atualmente pendentes no período. Supervisores sem pendências = 0.</p>
    {data.supervisors.length < 7 ? <p className="mt-2 text-xs text-muted">Seu acesso permite consultar somente suas próprias pendências; os demais supervisores não entram na contagem.</p> : null}
    <div className="sr-only"><table><caption>Pendências por supervisor · {periodLabel}</caption><thead><tr><th>Supervisor</th><th>Pendências</th></tr></thead><tbody>{barData.map((supervisor) => <tr key={supervisor.id}><td>{supervisor.name}</td><td>{supervisor.count}</td></tr>)}</tbody></table></div>
  </div>;
}

function adherencePeriodLabel(startDate: string, endDate: string) {
  return startDate === endDate ? adherenceDateLabel(startDate) : `${adherenceDateLabel(startDate)} a ${adherenceDateLabel(endDate)}`;
}

function SupervisorTick({ x = 0, y = 0, payload, compact }: { x?: number; y?: number; payload?: { value?: string }; compact: boolean }) {
  const lines: string[] = [];
  for (const word of String(payload?.value ?? "").split(" ")) {
    if (lines.length && `${lines[lines.length - 1]} ${word}`.length <= (compact ? 14 : 24)) lines[lines.length - 1] += ` ${word}`;
    else lines.push(word);
  }
  return <text x={x - 8} y={y} textAnchor="end" fill="var(--ink)" fontSize={12}>{lines.map((line, index) => <tspan key={index} x={x - 8} dy={index ? 14 : 4 - (lines.length - 1) * 7}>{line}</tspan>)}</text>;
}

export function PendingTooltip({ active, payload }: { active?: boolean;
  payload?: Array<{ value?: string | number; payload?: { name?: string; startDate?: string; endDate?: string } }> }) {
  if (!active || !payload?.length) return null;
  const row = payload[0];
  const startDate = row.payload?.startDate ?? "";
  const endDate = row.payload?.endDate ?? startDate;
  return <div className="rounded-xl border border-border bg-white p-3 shadow-card" style={{ maxWidth: 310 }}>
    <p className="mb-2 font-bold text-navy-950">Shift Date: {adherencePeriodLabel(startDate, endDate)}</p>
    <p className="flex items-start justify-between gap-4 text-xs text-navy-950"><span>{row.payload?.name}</span><strong className="tabular-nums">{row.value ?? 0}</strong></p>
  </div>;
}
