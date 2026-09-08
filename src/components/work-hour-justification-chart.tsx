"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { adherenceBarData, adherenceChartSeries, adherenceDateLabel, adherenceLineData } from "@/lib/work-hour-adherence-chart";
import type { AdherenceSummary } from "@/lib/work-hour-adherence-summary";

// Chart contract: current pending IDs by recorded supervisor and Shift Date.
// One date: zero-based ranked horizontal bars. Multiple dates: non-cumulative,
// zero-filled lines, explicit colors/dashes/dots. Recharts is the site's renderer.
export default function WorkHourJustificationChart({ data }: { data: AdherenceSummary }) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const series = adherenceChartSeries(data);
  const isSingleDay = data.startDate === data.endDate;
  const barData = adherenceBarData(data);
  const lineData = adherenceLineData(data);
  const visible = series.filter((supervisor) => !hidden.has(supervisor.id));
  const axisColor = "var(--muted)";
  if (!series.length) return <p role="status" className="py-10 text-center text-sm text-muted">Nenhum supervisor cadastrado disponível para esta consulta.</p>;
  return <div className="relative" data-chart-type={isSingleDay ? "bar" : "line"}>
    <p className="mb-4 text-sm font-semibold text-muted">{isSingleDay ? `Pendências por supervisor · ${adherenceDateLabel(data.startDate)}`
      : `Pendências por Shift Date · ${adherenceDateLabel(data.startDate)} a ${adherenceDateLabel(data.endDate)}`}</p>
    {!data.total ? <p role="status" className="mb-4 text-sm text-muted">Nenhuma justificativa pendente encontrada no período selecionado. Os supervisores permanecem representados com zero.</p> : null}
    {!isSingleDay ? <>
      <div aria-label="Legenda de supervisores" className="mb-3 flex flex-wrap gap-2">
        {series.map((supervisor) => <button key={supervisor.id} type="button" aria-pressed={!hidden.has(supervisor.id)} aria-label={`${hidden.has(supervisor.id) ? "Mostrar" : "Ocultar"} ${supervisor.name}`}
          onClick={() => setHidden((current) => { const next = new Set(current); if (next.has(supervisor.id)) next.delete(supervisor.id); else next.add(supervisor.id); return next; })}
          onMouseEnter={() => setHighlighted(supervisor.id)} onMouseLeave={() => setHighlighted(null)} onFocus={() => setHighlighted(supervisor.id)} onBlur={() => setHighlighted(null)}
          className={`inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-xs font-semibold text-navy-950 ${hidden.has(supervisor.id) ? "opacity-50 line-through" : "bg-white"}`}>
          <svg width="24" height="12" aria-hidden="true" className="shrink-0"><line x1="0" x2="24" y1="6" y2="6" stroke={supervisor.color} strokeWidth="2" strokeDasharray={supervisor.dash} /><circle cx="12" cy="6" r="3" fill={supervisor.color} /></svg>{supervisor.name}
        </button>)}
      </div>
      <p className="mb-5 text-xs text-muted">Clique na legenda para ocultar ou mostrar. Passe o cursor ou use Tab para destacar. Valores por dia, sem soma acumulada.</p>
      {!visible.length ? <div role="status" className="mb-5 text-sm text-muted">Todos os supervisores estão ocultos. <button type="button" className="font-bold text-blue-600 underline" onClick={() => setHidden(new Set())}>Mostrar todos</button></div> : null}
    </> : null}
    <div className="w-full min-w-0" style={{ height: isSingleDay ? Math.max(300, barData.length * 66 + 45) : 380 }} aria-label={isSingleDay ? "Gráfico de barras de pendências" : "Gráfico de linhas de pendências"}>
      <ResponsiveContainer width="100%" height="100%" onResize={(nextWidth) => setWidth(nextWidth)}>
        {isSingleDay ? <BarChart data={barData} layout="vertical" margin={{ top: 5, right: 30, bottom: 10, left: 0 }} accessibilityLayer>
          <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis type="number" allowDecimals={false} domain={[0, Math.max(1, ...barData.map((row) => row.count))]} tick={{ fill: axisColor, fontSize: 12 }} />
          <YAxis type="category" dataKey="name" width={width && width < 600 ? 132 : 230} interval={0} axisLine={false} tickLine={false} tick={<SupervisorTick compact={Boolean(width && width < 600)} />} />
          <Tooltip cursor={{ fill: "rgba(37,99,235,0.06)" }} content={<PendingTooltip singleDay />} />
          <Bar dataKey="count" name="Pendências" fill="#2563eb" barSize={22} radius={[0, 4, 4, 0]} isAnimationActive={false}><LabelList dataKey="count" position="right" fill={axisColor} fontSize={12} /></Bar>
        </BarChart> : <LineChart data={lineData} margin={{ top: 16, right: 18, bottom: 22, left: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="date" tickFormatter={(date: string) => adherenceDateLabel(date).slice(0, 5)} minTickGap={20} tick={{ fill: axisColor, fontSize: 12 }} label={{ value: "Shift Date", position: "insideBottom", offset: -15, fill: axisColor, fontSize: 12 }} />
          <YAxis allowDecimals={false} domain={[0, (max: number) => Math.max(1, max)]} width={40} tick={{ fill: axisColor, fontSize: 12 }} />
          <Tooltip content={<PendingTooltip />} />
          {visible.map((supervisor) => <Line key={supervisor.id} dataKey={supervisor.key} name={supervisor.name} type="linear" stroke={supervisor.color} strokeWidth={2} strokeDasharray={supervisor.dash} strokeOpacity={highlighted && highlighted !== supervisor.id ? 0.18 : 1}
            dot={{ r: 3.5, fill: supervisor.color, fillOpacity: highlighted && highlighted !== supervisor.id ? 0.18 : 1 }} activeDot={{ r: 5 }} isAnimationActive={false} />)}
        </LineChart>}
      </ResponsiveContainer>
    </div>
    <p className="mt-3 text-xs text-muted">Quantidade de justificativas atualmente pendentes. Supervisores sem pendências = 0.</p>
    <div className="sr-only"><table><caption>Dados do gráfico por supervisor e Shift Date</caption><thead><tr><th>Shift Date</th><th>Supervisor</th><th>Pendências</th></tr></thead><tbody>{data.days.flatMap((day) => day.supervisors.map((supervisor) => <tr key={`${day.date}:${supervisor.id}`}><td>{adherenceDateLabel(day.date)}</td><td>{supervisor.name}</td><td>{supervisor.count}</td></tr>))}</tbody></table></div>
  </div>;
}

function SupervisorTick({ x = 0, y = 0, payload, compact }: { x?: number; y?: number; payload?: { value?: string }; compact: boolean }) {
  const lines: string[] = [];
  for (const word of String(payload?.value ?? "").split(" ")) {
    if (lines.length && `${lines[lines.length - 1]} ${word}`.length <= (compact ? 19 : 31)) lines[lines.length - 1] += ` ${word}`;
    else lines.push(word);
  }
  return <text x={x - 8} y={y} textAnchor="end" fill="var(--ink)" fontSize={12}>{lines.map((line, index) => <tspan key={index} x={x - 8} dy={index ? 14 : 4 - (lines.length - 1) * 7}>{line}</tspan>)}</text>;
}

export function PendingTooltip({ active, payload, label, singleDay }: { active?: boolean; singleDay?: boolean; label?: string | number;
  payload?: Array<{ name?: string | number; value?: string | number; color?: string; dataKey?: string | number; payload?: { name?: string; date?: string } }> }) {
  if (!active || !payload?.length) return null;
  const date = payload[0].payload?.date ?? String(label ?? "");
  return <div className="rounded-xl border border-border bg-white p-3 shadow-card" style={{ maxWidth: 310 }}><p className="mb-2 font-bold text-navy-950">Shift Date: {adherenceDateLabel(date)}</p>
    <ul className="space-y-1.5 text-xs text-navy-950">{payload.map((item, index) => <li key={item.dataKey ?? index} className="flex items-start justify-between gap-4"><span>{singleDay ? item.payload?.name : item.name}</span><strong className="tabular-nums">{item.value ?? 0}</strong></li>)}</ul>
  </div>;
}
