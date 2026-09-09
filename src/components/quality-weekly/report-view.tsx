"use client";

import { useState } from "react";
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import { CheckCircle2, Files, Target, TrendingUp } from "lucide-react";
import { Panel, StatCard } from "@/components/ui/primitives";
import { change, number, rate, SECTION_NAMES, sectionName } from "@/lib/quality-weekly/domain";
import type { MetricRow, Section, Snapshot } from "@/lib/quality-weekly/domain";
import { chartMinimum, chartSpec } from "@/lib/quality-weekly/charts";

export function MetricTable({ rows, label = "Queue / Agent" }: { rows: MetricRow[]; label?: string }) {
  return <div className="max-w-full overflow-x-auto rounded-lg border border-border">
    <table className="w-full min-w-[1080px] text-left text-xs">
      <thead className="bg-slate-50 text-muted"><tr>{[label, "Sampling (N)", "Correct", "Allow", "Labeled", "Leakage", "False Positive", "Mislabeled", "Leakage rate", "False Positive rate", "Mislabeled rate", "Accuracy incl. mislabeled", "Accuracy excl. mislabeled"].map(h => <th key={h} className="px-3 py-3 font-extrabold">{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-border">{rows.map(row => <tr key={row.id} className="text-navy-950 hover:bg-blue-50/40">
        <td className="min-w-[180px] max-w-[300px] break-words px-3 py-3 font-bold">{row.name}</td>
        {[row.n, row.correct, row.allow, row.labeled, row.leakage, row.falsePositive, row.mislabeled].map((v, i) => <td key={i} className="px-3 py-3 text-right tabular-nums">{number(v)}</td>)}
        {[row.leakageRate, row.falsePositiveRate, row.mislabeledRate, row.accuracy, row.adjustedAccuracy].map((v, i) => <td key={i} className="px-3 py-3 text-right tabular-nums">{rate(v)}</td>)}
      </tr>)}</tbody>
    </table>
    {!rows.length && <p className="p-6 text-center text-sm text-muted">No samples in this section.</p>}
  </div>;
}

function Trend({ snapshot, section }: { snapshot: Snapshot; section: "CD" | "ACCOUNTS" }) {
  const spec = chartSpec(snapshot, section);
  const series = spec.series.slice(0, -1);
  const [hidden, setHidden] = useState<string[]>([]);
  const data = spec.labels.map((label, i) => ({ label, ...Object.fromEntries(series.map(s => [s.label, s.values[i] == null ? null : s.values[i]! * 100])) }));
  return <div className="space-y-3">
    <p className="text-xs text-muted">Current moderation week and {snapshot.trend.length - 1} previous weeks · Accuracy (%) · Gaps mean no validated data · Focused percentage scale</p>
    <div className="flex flex-wrap gap-2" aria-label="Chart legend">{series.map(s => <button type="button" key={s.label} aria-pressed={!hidden.includes(s.label)} onClick={() => setHidden(values => values.includes(s.label) ? values.filter(v => v !== s.label) : [...values, s.label])} className={`rounded-lg border border-border px-3 py-1.5 text-xs font-bold ${hidden.includes(s.label) ? "opacity-40" : "text-navy-950"}`}><span aria-hidden="true" className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />{s.label}</button>)}<span className="self-center text-xs text-muted">— Target 95%</span></div>
    <div className="h-[280px] min-w-0" role="img" aria-label={`${SECTION_NAMES[section]} accuracy over ${snapshot.trend.length} weeks. Exact values are in the weekly comparison below.`}>
      <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 16, right: 20, bottom: 12, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#7c879a" }} tickLine={false} />
        <YAxis domain={[chartMinimum(spec), 100]} tickFormatter={value => `${value}%`} tick={{ fontSize: 11, fill: "#7c879a" }} width={48} tickLine={false} />
        <Tooltip contentStyle={{ borderRadius: 12, background: "var(--surface)", borderColor: "var(--border)", color: "var(--ink)" }} formatter={(value: number) => `${Number(value).toFixed(2)}%`} />
        <ReferenceLine y={95} stroke="#94a3b8" strokeDasharray="5 5" />
        {series.filter(s => !hidden.includes(s.label)).map((s, i) => <Line key={s.label} type="linear" dataKey={s.label} stroke={s.color} strokeWidth={2.5} strokeDasharray={i === 1 ? "6 3" : undefined} dot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />)}
      </LineChart></ResponsiveContainer>
    </div>
  </div>;
}

export function QualityReportView({ snapshot, initialSection = "CD", initialView = "queues" }: { snapshot: Snapshot; initialSection?: Section; initialView?: string }) {
  const [section, setSection] = useState<Section>(snapshot.sections[initialSection] ? initialSection : "CD");
  const [view, setView] = useState(initialView);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50);
  const current = snapshot.sections[section] || snapshot.sections.CD;
  const previous = snapshot.trend.at(-2)?.[section];
  const rows = view === "agents" ? snapshot.agents.filter(a => a.section === section).map(a => ({ ...a, name: `${a.name} · ${a.queueName}` }))
    : view === "industry" ? current.rows : view === "categories" ? current.categories || [] : current.queues || current.rows;
  const filtered = rows.filter(r => `${r.name} ${r.id}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard title="Sampling Amount" value={number(snapshot.metrics.n)} helper="Distinct validated case keys" icon={Files} />
      <StatCard title="Accuracy including mislabeled cases" value={rate(snapshot.metrics.accuracy)} helper="Correct ÷ Sampling Amount" icon={Target} />
      <StatCard title="Accuracy not including mislabeled cases" value={rate(snapshot.metrics.adjustedAccuracy)} helper="(Correct + Mislabeled) ÷ Sampling Amount" icon={CheckCircle2} tone="green" />
      <StatCard title="Moderation period" value={`Week ${snapshot.weekNumber}`} helper={`${snapshot.start} → ${snapshot.end}`} icon={TrendingUp} tone="purple" />
    </div>
    <div className="flex flex-wrap gap-2" aria-label="Report sections">{(Object.keys(SECTION_NAMES) as Section[]).filter(key => snapshot.sections[key]).map(key => <button type="button" key={key} aria-pressed={section === key} onClick={() => { setSection(key); setLimit(50); setSearch(""); setView("queues"); }} className={`${section === key ? "premium-button" : "premium-control text-navy-950"} px-4 py-2 text-sm font-extrabold`}>{sectionName(snapshot, key)} <span className="ml-2 opacity-70">{number(snapshot.sections[key]!.metrics.n)}</span></button>)}</div>
    <Panel title={sectionName(snapshot, section)}>
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-navy-950"><span>Accuracy: <strong>{rate(current.metrics.accuracy)}</strong></span><span>Weekly change: <strong>{change(current.metrics.accuracy, previous?.accuracy)}</strong></span><span className="text-xs text-muted">{number(current.metrics.n)} distinct cases · Totals recalculated from counts</span></div>
      {(section === "CD" || section === "ACCOUNTS") && <Trend key={section} snapshot={snapshot} section={section} />}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {[["queues", "By queue"], ...(current.categories?.length ? [["categories", "By category"]] : []), ...(section === "ACCOUNTS" ? [["industry", "By industry"]] : []), ["agents", "By agent"]].map(([key, title]) => <button type="button" key={key} aria-pressed={view === key} className={`${view === key ? "premium-button" : "premium-control text-navy-950"} px-3 py-2 text-xs font-bold`} onClick={() => { setView(key); setLimit(50); }}>{title}</button>)}
        <input aria-label="Search report detail" placeholder="Search queue or agent" className="premium-control min-w-0 flex-1 px-3 py-2 text-sm md:ml-auto md:max-w-xs" value={search} onChange={e => { setSearch(e.target.value); setLimit(50); }} />
      </div>
      <div className="mt-3"><MetricTable rows={filtered.slice(0, limit)} label={view === "agents" ? "Agent · Queue" : view === "industry" ? "Industry" : view === "categories" ? "Category" : "Queue"} /></div>
      {filtered.length > limit && <button type="button" className="premium-control mt-3 px-4 py-2 text-sm font-bold" onClick={() => setLimit(n => n + 50)}>Show 50 more ({filtered.length - limit} remaining)</button>}
      <div className="mt-3"><MetricTable rows={[{ id: "total", name: "Section total", ...current.metrics }]} /></div>
    </Panel>
    <Panel title="Weekly comparison">
      <div className="overflow-x-auto"><table className="w-full min-w-[880px] text-left text-xs text-navy-950"><thead className="bg-slate-50 text-muted"><tr><th className="p-3">Accuracy · {sectionName(snapshot, section)}</th>{snapshot.trend.map(t => <th className="p-3" key={t.start}>{t.weekNumber !== null ? `Week ${t.weekNumber}` : t.source === "upload" ? "From upload" : "Missing week"}<span className="mt-1 block font-normal">{t.start}{t.end ? ` → ${t.end}` : ""}</span>{t.observedDays && <span className="mt-1 block font-normal">{t.observedDays.length}/5 days with cases</span>}</th>)}<th className="p-3">Weekly change</th></tr></thead>
        <tbody>{[["accuracy", "Including mislabeled cases"], ["adjustedAccuracy", "Not including mislabeled cases"]].map(([metric, label]) => <tr key={metric} className="border-t border-border"><th className="p-3">{label}</th>{snapshot.trend.map(t => <td className="p-3 tabular-nums" key={t.start}>{rate(t[section]?.[metric as "accuracy" | "adjustedAccuracy"])}</td>)}<td className="p-3 tabular-nums">{change(current.metrics[metric as "accuracy" | "adjustedAccuracy"], previous?.[metric as "accuracy" | "adjustedAccuracy"])}</td></tr>)}</tbody></table></div>
      <p className="mt-3 text-xs text-muted">N/A means no validated data or a zero denominator. Weekly change is a difference in percentage points, not a relative percentage.</p>
      {snapshot.trend.some(t => t.source) && <p className="mt-2 text-xs text-muted">All seven Monday–Friday periods use this report&apos;s preserved upload and section mapping, without requiring separate saved reports. Days without cases are not proof of an incomplete export; check source coverage before confirming.</p>}
    </Panel>
  </div>;
}
