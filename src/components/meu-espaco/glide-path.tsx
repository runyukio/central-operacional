"use client";
import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SpaceGlide } from "@/lib/meu-espaco-glide";
import { isSpaceMaterialSkill, spaceTargets } from "@/lib/meu-espaco-targets";
import type { SpaceResults } from "@/lib/meu-espaco-contract";
import { FormInput } from "@/components/modules/shared";
import { dateLabel, number, SpaceButtons, SpaceCard, SpaceLoad, tableClass, useSpaceRead } from "./shared";
import styles from "./space.module.css";

// Chart contract: one monthly KPI, daily observed and cumulative weighted actuals,
// projected cumulative close and required path. Native site Recharts, brand blue +
// amber with solid/dashed distinction, sparse observations retained as gaps.
export function SpaceGlideTab({ supervisorId, lobs, partners, employeeId, onEmployeeChange, teamLabel }: { supervisorId: string; lobs: string[]; partners: SpaceResults["partners"]; employeeId: string; onEmployeeChange: (id: string) => void; teamLabel: string }) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const selected = partners.find((row) => row.id === employeeId);
  const [month, setMonth] = useState(today.slice(0, 7)), [selectedLob, setLob] = useState(selected?.lob || lobs[0] || "ADS"), [metric, setMetric] = useState("quality");
  const [input, setInput] = useState(""), [override, setOverride] = useState<string | null>(null);
  const [chartOpen, setChartOpen] = useState(false);
  const lob = lobs.includes(selectedLob) ? selectedLob : lobs[0] || "ADS";
  const options = spaceTargets(lob).filter((row) => !selected || row.id !== "materialDaily" || isSpaceMaterialSkill(selected.skill)), active = options.some((row) => row.id === metric) ? metric : "quality";
  const query = new URLSearchParams({ month, lob, metric: active, supervisorId });
  if (employeeId) query.set("employeeId", employeeId);
  if (override !== null) query.set("remainingWeight", override);
  const read = useSpaceRead<SpaceGlide>(`/api/meu-espaco/glide?${query}`);
  const data = read.data;
  function reset() { setInput(""); setOverride(null); }
  return <div className="space-y-4">
    <section className="card space-y-4 p-4"><div className="flex flex-wrap items-end gap-4"><FormInput label="Mês" type="month" value={month} onChange={(value) => { setMonth(value); reset(); }} />
      <label className="min-w-0 flex-1 text-sm font-bold text-muted">Parceiro (opcional)<select className="premium-control mt-1 block w-full p-3" value={employeeId} onChange={(event) => { const id = event.target.value; onEmployeeChange(id); setLob(partners.find((row) => row.id === id)?.lob || lob); reset(); }}><option value="">{teamLabel}</option>{[...partners].filter((row) => lobs.includes(row.lob)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((row) => <option key={row.id} value={row.id}>{row.name} · {row.wbLogin}</option>)}</select></label></div>
      {lobs.length > 1 ? <SpaceButtons label="Operação" value={lob} onChange={(value) => { setLob(value); onEmployeeChange(""); reset(); }} options={lobs.map((id) => ({ id, label: id }))} /> : null}
      <SpaceButtons label="Indicador" value={active} onChange={(value) => { setMetric(value); reset(); }} options={options.map((row) => ({ id: row.id, label: row.label }))} />
    </section>
    <SpaceLoad {...read} />
    {!read.loading && !read.error && data ? <>
      <p className="text-sm font-bold">{selected ? `${selected.name} · ${selected.wbLogin}` : teamLabel} <span className="font-normal text-muted">· {lob} · corte em {dateLabel(data.cutoff)}</span></p>
      {data.warning ? <p role="status" className="card p-4 text-sm text-muted">{data.warning}</p> : null}
      {!data.closed ? <section className={`card p-5 ${styles.glideHero}`} aria-label="Resultado necessário até o fim do mês"><h3 className="text-sm font-bold text-muted">Para atingir a meta até {dateLabel(data.points.at(-1)?.date)}</h3><p className="mt-2 text-3xl font-extrabold">{data.impossible ? "Meta inviável neste cenário" : number(data.requiredValue, ` ${data.target.unit}`)}</p><p className="mt-2 text-sm">{data.target.direction === "min" ? "Mínimo necessário" : "Máximo permitido"} no restante do mês.{data.simulated ? " Cenário simulado." : " Com o volume restante estimado."}</p>
        {!data.impossible && data.requiredNumerator !== null && ["quality", "abs", "normalFrt", "urgentFrt", "materialDaily", "cpd"].includes(data.target.id) ? <p className="mt-1 text-sm font-bold">{number(data.requiredNumerator)} {data.target.id === "abs" ? "faltas permitidas" : data.target.id === "quality" ? "avaliações corretas necessárias" : ["normalFrt", "urgentFrt"].includes(data.target.id) ? "respostas no prazo necessárias" : data.target.id === "cpd" ? "tickets necessários" : "submits necessários"}</p> : null}
      </section> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <SpaceCard title={data.closed ? "Resultado final · base disponível" : "Realizado no mês"} value={number(data.overall, ` ${data.target.unit}`)} helper="Acumulado ponderado até o corte" />
        <SpaceCard title="Meta do mês" value={`${data.target.direction === "min" ? "≥" : "≤"} ${number(data.target.target)} ${data.target.unit}`} />
      </div>
      {!data.closed ? <details className="card space-y-3 p-4" aria-label="Simulação do volume restante"><summary className="cursor-pointer text-sm font-bold">Ver premissas ou ajustar cenário</summary>
        <p className="text-sm">Fechamento projetado mantendo o ritmo recente: <strong>{number(data.forecast, ` ${data.target.unit}`)}</strong>.</p>
        <p className="text-sm text-muted">Últimos 7 dias corridos até o corte: {dateLabel(data.recentStart)} a {dateLabel(data.cutoff)} · {data.recentDays} dias com base · {number(data.recentScheduled)} dias-parceiro com escala e dado válido. Escala após o corte: {number(data.futureScheduled)} dias-parceiro elegíveis. Parceiros sem base não entram como produtividade zero no ritmo observado.</p>
        <p className="text-sm">Volume restante automático: <strong>{number(data.automaticWeight)}</strong> {data.target.weightLabel}. Ausência de base não é zero.</p>
        <div className="flex flex-wrap items-end gap-3"><FormInput label={`Simular volume restante · ${data.target.weightLabel}`} type="number" value={input} onChange={setInput} /><button type="button" className={styles.chip} disabled={!input.trim()} onClick={() => setOverride(input)}>Aplicar simulação</button><button type="button" className={styles.chip} onClick={reset}>Restaurar automático</button></div>
        <p className="text-xs text-muted">A simulação muda apenas este cenário. As metas, bases, escalas e horas permanecem iguais.</p>
      </details> : null}
      <details className="card p-4" aria-label="Evolução mensal e caminho da meta" onToggle={(event) => setChartOpen(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-bold">Ver evolução e projeção · {data.target.label}</summary><p className="mt-2 text-xs text-muted">Valores em {data.target.unit}. Linhas interrompidas indicam ausência de dados; projeções não são resultados realizados. Atualização: {data.updatedAt ? new Date(data.updatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "Sem dados"}.</p>
        {data.cutoff && chartOpen ? <div className="mt-4 h-80 w-full min-w-0"><ResponsiveContainer width="100%" height="100%"><LineChart data={data.points} margin={{ top: 15, right: 25, bottom: 10, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.12} vertical={false} />
          <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(8)} tick={{ fill: "currentColor", fontSize: 12 }} minTickGap={12} />
          <YAxis tickFormatter={(value: number) => number(value)} tick={{ fill: "currentColor", fontSize: 12 }} width={65} />
          <Tooltip content={({ active, payload, label }) => active && payload?.length ? <div className="card p-3 text-xs"><strong>{dateLabel(String(label))}</strong>{payload.map((p) => <p key={String(p.dataKey)}>{p.name}: {number(typeof p.value === "number" ? p.value : null)} {data.target.unit}</p>)}</div> : null} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine y={data.target.target} stroke="currentColor" strokeDasharray="2 4" label={{ value: `Meta ${number(data.target.target)}`, fill: "currentColor", fontSize: 11, position: "insideTopRight" }} />
          <Line type="linear" dataKey="daily" name="Realizado diário" stroke="#94a3b8" strokeWidth={1.5} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
          <Line type="linear" dataKey="overall" name="Overall ponderado" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
          <Line type="linear" dataKey="forecast" name="Projeção de fechamento" stroke="#2563eb" strokeWidth={2} strokeDasharray="7 5" dot={false} isAnimationActive={false} />
          <Line type="linear" dataKey="path" name="Caminho necessário" stroke="#d97706" strokeWidth={2} strokeDasharray="2 4" dot={false} isAnimationActive={false} />
        </LineChart></ResponsiveContainer></div> : !data.cutoff ? <p className="py-8 text-center text-muted">Sem dados válidos para desenhar a evolução.</p> : null}
        <details className="mt-4 text-sm"><summary className="cursor-pointer font-bold">Ver valores por dia</summary><div className="overflow-x-auto"><table className={tableClass}><thead><tr><th>Data</th><th>Realizado diário</th><th>Overall</th><th>Projeção</th><th>Caminho necessário</th></tr></thead><tbody>{data.points.map((row) => <tr key={row.date}><td>{dateLabel(row.date)}</td><td>{number(row.daily)}</td><td>{number(row.overall)}</td><td>{number(row.forecast)}</td><td>{number(row.path)}</td></tr>)}</tbody></table></div></details>
      </details>
    </> : null}
  </div>;
}
