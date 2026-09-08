"use client";

import { useState } from "react";
import { LayoutDashboard, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ui/primitives";
import { FormInput } from "@/components/modules/shared";
import type { SpacePeriod, SpaceResults, SpaceSummary } from "@/lib/meu-espaco-contract";
import { SpacePendingTab } from "./pendencias";
import { SpaceHoursTab } from "./horas";
import { SpaceResultsTab, TeamMetricCards } from "./resultados";
import { dateLabel, number, SpaceButtons, SpaceCard, SpaceLoad, tableClass, useSpaceRead } from "./shared";

function initialPeriod(): SpacePeriod {
  const endDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return { startDate: `${endDate.slice(0, 7)}-01`, endDate };
}
export function MeuEspacoPage() {
  const [tab, setTab] = useState("overview"), [supervisorId, setSupervisorId] = useState("");
  const [period, setPeriod] = useState(initialPeriod);
  const [revision, setRevision] = useState(0), [answeredRevision, setAnsweredRevision] = useState(0);
  const [directory, setDirectory] = useState<SpaceSummary["supervisors"]>([]);
  const valid = Boolean(period.startDate && period.endDate && period.startDate <= period.endDate);
  const query = new URLSearchParams({ ...period, supervisorId });
  const summary = useSpaceRead<SpaceSummary>(`/api/meu-espaco/resumo?${query}`, valid, revision + answeredRevision);
  const results = useSpaceRead<SpaceResults>(`/api/meu-espaco/resultados?${query}`, valid && (tab === "overview" || tab === "results"), revision);
  // Keep the all-supervisor directory available while an individual space is open.
  const options = supervisorId ? directory : summary.data?.supervisors || directory;
  function selectSupervisor(id: string) { if (!supervisorId && summary.data) setDirectory(summary.data.supervisors); setSupervisorId(id); }
  const currentName = options.find((row) => row.id === (supervisorId || summary.data?.selectedSupervisorId))?.name;
  const counts = summary.data?.management;
  const age = counts?.oldest ? Math.max(0, Math.round((+new Date(`${initialPeriod().endDate}T00:00:00Z`) - +new Date(`${counts.oldest}T00:00:00Z`)) / 86_400_000)) : null;
  return <div className="space-y-5">
    <PageHeader title="Meu Espaço" description="Pendências, resultados e horas para acompanhar a gestão do time." icon={LayoutDashboard} actions={<button type="button" onClick={() => setRevision((value) => value + 1)} className="premium-control inline-flex items-center gap-2 px-3 py-2 text-sm font-bold"><RefreshCw className="h-4 w-4" />Atualizar</button>} />
    <div className="card flex flex-wrap items-end gap-4 p-4">
      {summary.data?.actor.broad || supervisorId ? <label className="min-w-56 flex-1 text-xs font-bold text-muted">Espaço do supervisor<select aria-label="Espaço do supervisor" className="premium-control mt-2 w-full p-2.5 text-sm" value={supervisorId} onChange={(e) => selectSupervisor(e.target.value)}><option value="">Todos os supervisores</option>{options.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label> : currentName ? <p className="flex-1 font-bold">{currentName}</p> : null}
      <FormInput label="Indicadores / respostas desde" type="date" value={period.startDate} onChange={(startDate) => setPeriod((value) => ({ ...value, startDate }))} /><FormInput label="Indicadores / respostas até" type="date" value={period.endDate} onChange={(endDate) => setPeriod((value) => ({ ...value, endDate }))} />
      <p className="w-full text-xs text-muted">Este período filtra os resultados e as respostas contabilizadas. As pendências abertas têm datas independentes e incluem meses anteriores.</p>
    </div>
    {!valid ? <p role="alert" className="text-red-700">Selecione um período válido para os indicadores.</p> : null}
    <SpaceButtons label="Visão" value={tab} onChange={setTab} options={[{ id: "overview", label: "Visão geral" }, { id: "pending", label: "Pendências" }, { id: "results", label: "Resultado do time" }, { id: "hours", label: "Horas do time" }]} />
    <SpaceLoad {...summary} />
    {tab === "overview" && counts ? <>
      <section aria-label="Indicadores de gestão"><h2 className="mb-3 text-lg font-extrabold">Gestão</h2><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><SpaceCard title="Faltas pendentes" value={number(counts.absences)} helper="Ainda sem resposta / classificação" /><SpaceCard title="Horas pendentes" value={number(counts.hours)} helper="Sob responsabilidade registrada" /><SpaceCard title="Pendência mais antiga" value={age === null ? "Nenhuma" : `${age} dias`} helper={counts.oldest ? `Ocorrência em ${dateLabel(counts.oldest)} · não indica SLA` : "Nenhuma pendência aberta"} /><SpaceCard title="Respondidas no período" value={number(counts.answered)} helper={`${dateLabel(period.startDate)} a ${dateLabel(period.endDate)}`} /></div></section>
      {summary.data?.actor.broad ? <section className="card overflow-hidden"><div className="p-4"><h2 className="font-extrabold">Acompanhamento dos supervisores</h2><p className="mt-1 text-xs text-muted">Mais pendências primeiro. Selecione o nome para abrir o detalhe.</p></div><div className="overflow-x-auto"><table className={tableClass}><thead><tr><th>Supervisor</th><th>Time atual</th><th>Faltas</th><th>Horas</th><th>Mais antiga</th><th>Respondidas</th></tr></thead><tbody>{summary.data.supervisors.map((row) => <tr key={row.id}><td><button type="button" onClick={() => selectSupervisor(row.id)} className="font-bold text-blue-600 underline-offset-2 hover:underline">{row.name}</button></td><td>{row.teamSize}</td><td>{row.absences}</td><td>{row.hours}</td><td>{row.oldest ? dateLabel(row.oldest) : "Nenhuma"}</td><td>{row.answered}</td></tr>)}</tbody></table></div></section> : null}
      <section className="space-y-3"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-extrabold">Resultado do time atual</h2><button type="button" onClick={() => setTab("results")} className="text-sm font-bold text-blue-600">Ver detalhamento →</button></div><SpaceLoad {...results} />{results.data ? <TeamMetricCards data={results.data} compact /> : null}</section>
    </> : null}
    {tab === "pending" && summary.data ? <SpacePendingTab key={`${supervisorId}:${revision}`} supervisorId={supervisorId} lobs={summary.data.lobs} canRespond={summary.data.actor.canRespond} onAnswered={() => setAnsweredRevision((value) => value + 1)} /> : null}
    {tab === "results" ? <><SpaceLoad {...results} />{results.data ? <SpaceResultsTab data={results.data} /> : null}</> : null}
    {tab === "hours" && summary.data ? <SpaceHoursTab key={`${supervisorId}:${revision}`} supervisorId={supervisorId} initialPeriod={period} /> : null}
    <p className="text-xs text-muted">Sem atualização automática contínua. As justificativas e os históricos permanecem nos fluxos originais; este espaço não cria novas tarefas ou mensagens.</p>
  </div>;
}
