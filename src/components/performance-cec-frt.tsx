"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, Download, Gauge, ShieldCheck } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { StatCard } from "@/components/ui/primitives";
import { cecDateLabel, cecOperationalPoints, cecViewLabels, type CecOperationalPoint } from "@/lib/cec-operational-chart";
import type { CecFrtDashboard } from "@/lib/cec-frt";

const number = (value: number | null | undefined, suffix = "") => value == null ? "Sem dados" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}${suffix}`;
const day = (value: string | null | undefined) => value ? cecDateLabel(value) : "Sem dados";
const button = "inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-white px-3 text-xs font-black text-navy-950 hover:bg-slate-50 disabled:opacity-40";
const dateControl = "h-9 min-w-0 rounded-lg border border-border bg-white px-3 text-xs font-black text-navy-950 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
// Match the existing queue dashboard palette; the dashed Normal line also distinguishes it without color.
const colors = { urgent: "#2563EB", normal: "#06B6D4", cpd: "#F97316" };
const tick = { fontSize: 11, fontWeight: 700, fill: "var(--muted)" };

async function readCecDashboard(url: string, signal: AbortSignal): Promise<CecFrtDashboard> {
  const response = await fetch(url, { signal, cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(body?.error || "Não foi possível carregar os indicadores CEC. Tente atualizar a tela.");
  return body as CecFrtDashboard;
}

export function CecFrtPanel({ refreshToken = 0 }: { refreshToken?: number }) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const [startDate, setStart] = useState(`${today.slice(0, 7)}-01`), [endDate, setEnd] = useState(today);
  const [view, setView] = useState<CecFrtDashboard["view"]>("daily");
  const [data, setData] = useState<CecFrtDashboard | null>(null), [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const params = new URLSearchParams({ startDate, endDate, view }).toString();
  useEffect(() => {
    const controller = new AbortController();
    setError(""); setData(null);
    if (!startDate || !endDate || startDate > endDate) {
      setLoading(false); setError("Selecione uma data inicial e final válidas.");
      return () => controller.abort();
    }
    setLoading(true);
    readCecDashboard(`/api/performance/cec-frt?${params}`, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setData(value); })
      .catch((e) => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [params, startDate, endDate, refreshToken]);
  const currentData = data && data.period.startDate === startDate && data.period.endDate === endDate && data.view === view ? data : null;
  return <div className="space-y-4" aria-label="Visão operacional CEC">
    <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="w-full text-[11px] font-black uppercase tracking-wide text-muted">Data</span>
          <input aria-label="Data inicial CEC" type="date" className={dateControl} max={endDate || undefined} value={startDate} onChange={(e) => setStart(e.target.value)} />
          <input aria-label="Data final CEC" type="date" className={dateControl} min={startDate || undefined} value={endDate} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div role="group" aria-label="Visão CEC" className="flex flex-wrap gap-2">
          <span className="w-full text-[11px] font-black uppercase tracking-wide text-muted">Visão</span>
          {(Object.entries(cecViewLabels) as Array<[CecFrtDashboard["view"], string]>).map(([id, label]) => <button key={id} type="button" className={`h-9 rounded-lg border px-3 text-xs font-black transition ${view === id ? "border-blue-600 bg-blue-600 text-white" : "border-border bg-white text-navy-950 hover:bg-slate-50"}`} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}
        </div>
      </div>
      <a aria-disabled={!currentData || loading} className={`${button} ${!currentData || loading ? "pointer-events-none opacity-40" : ""}`} href={currentData && !loading ? `/api/performance/cec-frt?${params}&export=xlsx` : undefined}><Download className="h-4 w-4" />Exportar XLSX</a>
    </div>
    {loading ? <p role="status" className="p-6 text-center text-sm font-bold text-muted">Carregando indicadores da operação CEC...</p> : error ? <p role="alert" className="rounded-xl border border-red-300 p-4 text-red-600">{error}</p> : currentData ? <CecOperationalResults data={currentData} /> : null}
  </div>;
}

export function CecOperationalResults({ data }: { data: CecFrtDashboard }) {
  const points = useMemo(() => cecOperationalPoints(data), [data]);
  const hasSla = points.some((row) => row.urgentSla != null || row.normalSla != null);
  const hasCpd = points.some((row) => row.cpd != null);
  return <div className="space-y-4">
    <div className="grid gap-3 md:grid-cols-3">
      <StatCard title="SLA · P0 + HM" value={number(data.summary.urgentSla, "%")} helper={`Primeira resposta em até 4h · ${number(data.summary.urgentTotal)} tickets`} icon={Clock} tone="blue" />
      <StatCard title="SLA · Normal" value={number(data.summary.normalSla, "%")} helper={`Primeira resposta em até 24h · ${number(data.summary.normalTotal)} tickets`} icon={ShieldCheck} tone="cyan" />
      <StatCard title="CPD da operação" value={number(data.cpd)} helper={`${number(data.output)} tickets / ${number(data.agentDays)} dias-parceiro produtivos`} icon={Gauge} tone="orange" />
    </div>
    <p className="text-xs font-semibold text-muted">{day(data.period.startDate)} – {day(data.period.endDate)} · Base SLA até {day(data.coverage.latestDay)} · Base CPD até {day(data.coverage.latestCpdDay)}.</p>

    <div className="grid gap-4 xl:grid-cols-2">
      <section aria-label="Evolução do SLA CEC" className="min-w-0 rounded-xl border border-border bg-white p-4">
        <ChartHeading title="SLA · P0 + HM e Normal" subtitle={`CEC · ${cecViewLabels[data.view]} · % dentro do prazo, por criação do ticket`} />
        {hasSla ? <div className="h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 12, right: 14, left: -12, bottom: 0 }} accessibilityLayer>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={tick} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}%`} />
              <Tooltip content={<CecOperationalTooltip metric="sla" />} />
              <Legend wrapperStyle={{ fontSize: 12, fontWeight: 800 }} />
              <Line type="linear" dataKey="urgentSla" name="P0 + HM · 4h" stroke={colors.urgent} strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
              <Line type="linear" dataKey="normalSla" name="Normal · 24h" stroke={colors.normal} strokeWidth={3} strokeDasharray="6 4" dot={{ r: 3, fill: "var(--surface)" }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div> : <ChartEmpty label="Sem dados de SLA para o período selecionado." />}
      </section>
      <section aria-label="Evolução do CPD CEC" className="min-w-0 rounded-xl border border-border bg-white p-4">
        <ChartHeading title="CPD da operação" subtitle={`CEC · ${cecViewLabels[data.view]} · tickets por dia-parceiro produtivo`} />
        {hasCpd ? <div className="h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={points} margin={{ top: 12, right: 14, left: -12, bottom: 0 }} accessibilityLayer>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis domain={[0, "auto"]} tick={tick} tickLine={false} axisLine={false} tickFormatter={(value) => number(Number(value))} />
              <Tooltip content={<CecOperationalTooltip metric="cpd" />} cursor={{ fill: "var(--surface)" }} />
              <Legend wrapperStyle={{ fontSize: 12, fontWeight: 800 }} />
              <Bar dataKey="cpd" name="CPD" fill={colors.cpd} radius={[5, 5, 0, 0]} maxBarSize={34} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div> : <ChartEmpty label="Sem dados de CPD para o período selecionado." />}
      </section>
    </div>

    <section className="overflow-hidden rounded-xl border border-border bg-white">
      <div className="border-b border-border px-4 py-3"><h3 className="text-sm font-black text-navy-950">Indicadores da operação por período</h3><p className="mt-1 text-xs font-bold text-muted">{day(data.period.startDate)} – {day(data.period.endDate)} · {cecViewLabels[data.view]} · Todos os períodos selecionados.</p></div>
      <div className="max-h-[440px] overflow-auto"><table className="w-full min-w-[620px] text-left text-sm">
        <thead className="sticky top-0 bg-slate-50 text-xs font-black uppercase tracking-wide text-muted"><tr><th className="px-4 py-3">Período</th><th className="px-4 py-3 text-right">SLA P0 + HM</th><th className="px-4 py-3 text-right">SLA Normal</th><th className="px-4 py-3 text-right">CPD</th></tr></thead>
        <tbody className="divide-y divide-border/70">{points.map((row) => <tr key={row.period} className="hover:bg-blue-50/40"><th scope="row" className="whitespace-nowrap px-4 py-3 font-bold text-navy-950">{row.periodLabel}</th><td className="px-4 py-3 text-right font-bold text-navy-950">{number(row.urgentSla, "%")}</td><td className="px-4 py-3 text-right font-bold text-navy-950">{number(row.normalSla, "%")}</td><td className="px-4 py-3 text-right font-bold text-navy-950">{number(row.cpd)}</td></tr>)}</tbody>
      </table></div>
    </section>

    <details className="rounded-xl border border-border bg-white px-4 py-3 text-xs text-muted">
      <summary className="cursor-pointer font-bold">Bases e regras dos indicadores</summary>
      <div className="mt-3 space-y-2 leading-6">
        <p>SLA P0 + HM: 1 − soma das primeiras respostas acima de 240 minutos / soma das primeiras respostas &gt;0, apenas P0 e HM. Normal: 1 − soma acima de 1.440 minutos / soma &gt;0, apenas Normal. Os percentuais são ponderados pelo volume, não pela média dos parceiros.</p>
        <p>CPD: tickets produzidos / dias-parceiro com produção positiva, conforme a base CPD existente. SLA usa a data de criação do ticket; CPD usa a data da produção. A base SLA é diária, sem visão por hora. Períodos sem base aparecem como “Sem dados”, sem assumir zero.</p>
        <p>Último upload SLA: {data.lastImport ? new Date(data.lastImport.importedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "Sem dados"} · SLA até {day(data.coverage.latestDay)} · CPD até {day(data.coverage.latestCpdDay)}.</p>
        {data.coverage.unmatchedRows ? <p>{number(data.coverage.unmatchedRows)} registros de SLA sem vínculo no cadastro estão incluídos no total operacional.</p> : null}
      </div>
    </details>
  </div>;
}

function ChartHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return <div className="mb-4"><h3 className="text-sm font-black text-navy-950">{title}</h3><p className="mt-1 text-xs font-bold text-muted">{subtitle}</p></div>;
}
function ChartEmpty({ label }: { label: string }) {
  return <div className="grid h-[320px] place-items-center rounded-xl border border-dashed border-border p-6 text-center text-sm font-bold text-muted">{label}</div>;
}
function CecOperationalTooltip({ active, payload, metric }: { active?: boolean; payload?: Array<{ payload: CecOperationalPoint }>; metric: "sla" | "cpd" }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return <div className="max-w-[280px] rounded-xl border border-border bg-white p-3 text-xs font-bold text-navy-950 shadow-lg">
    <p className="mb-2 text-sm font-black">{row.periodLabel}</p>
    {metric === "sla" ? <div className="space-y-2">
      <p>P0 + HM: {number(row.urgentSla, "%")}<span className="block font-medium text-muted">{number(row.urgentOver)} acima de 4h / {number(row.urgentTotal)} tickets</span></p>
      <p>Normal: {number(row.normalSla, "%")}<span className="block font-medium text-muted">{number(row.normalOver)} acima de 24h / {number(row.normalTotal)} tickets</span></p>
    </div> : <div className="space-y-1"><p>CPD: {number(row.cpd)}</p><p className="font-medium text-muted">Tickets produzidos: {number(row.output)}</p></div>}
  </div>;
}
