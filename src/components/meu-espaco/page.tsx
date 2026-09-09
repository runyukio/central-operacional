"use client";

import { useState } from "react";
import { ArrowUpRight, ChartNoAxesCombined, ClipboardList, Clock3, LayoutDashboard, RefreshCw, UsersRound } from "lucide-react";
import type { SpacePeriod, SpaceResults, SpaceSummary } from "@/lib/meu-espaco-contract";
import { SpacePendingTab } from "./pendencias";
import { SpaceHoursTab } from "./horas";
import { SpaceResultsTab, SupervisorLatency, TeamMetricCards } from "./resultados";
import { dateLabel, number, SpaceCard, SpaceLoad, tableClass, useSpaceRead } from "./shared";
import { SpacePeriodSlicer, SpaceSupervisorSlicer } from "./slicers";
import styles from "./space.module.css";

const views = [
  { id: "overview", label: "Visão geral", icon: LayoutDashboard },
  { id: "pending", label: "Pendências", icon: ClipboardList },
  { id: "results", label: "Resultado do time", icon: ChartNoAxesCombined },
  { id: "hours", label: "Horas do time", icon: Clock3 }
];

function initialPeriod(): SpacePeriod {
  const endDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return { startDate: `${endDate.slice(0, 7)}-01`, endDate };
}
export function MeuEspacoPage() {
  const [tab, setTab] = useState("overview"), [supervisorId, setSupervisorId] = useState("");
  const [period, setPeriod] = useState(initialPeriod);
  const [revision, setRevision] = useState(0), [answeredRevision, setAnsweredRevision] = useState(0);
  const [directory, setDirectory] = useState<SpaceSummary["supervisors"]>([]);
  const [pendingKind, setPendingKind] = useState("all");
  const valid = Boolean(period.startDate && period.endDate && period.startDate <= period.endDate);
  const query = new URLSearchParams({ ...period, supervisorId });
  const summary = useSpaceRead<SpaceSummary>(`/api/meu-espaco/resumo?${query}`, valid, revision + answeredRevision);
  const results = useSpaceRead<SpaceResults>(`/api/meu-espaco/resultados?${query}`, valid && (tab === "overview" || tab === "results"), revision);
  // Keep the all-supervisor directory available while an individual space is open.
  const options = supervisorId
    ? directory.map((row) => summary.data?.supervisors.find((updated) => updated.id === row.id) || row)
    : summary.data?.supervisors || directory;
  function selectSupervisor(id: string) { if (!supervisorId && summary.data) setDirectory(summary.data.supervisors); setSupervisorId(id); }
  const currentName = options.find((row) => row.id === (supervisorId || summary.data?.selectedSupervisorId))?.name;
  const counts = summary.data?.management;
  const age = counts?.oldest ? Math.max(0, Math.round((+new Date(`${initialPeriod().endDate}T00:00:00Z`) - +new Date(`${counts.oldest}T00:00:00Z`)) / 86_400_000)) : null;
  function openPending(kind: string) { setPendingKind(kind); setTab("pending"); }
  return <div className={`${styles.root} space-y-5`}>
    <header className={styles.hero}>
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className={styles.eyebrow}><LayoutDashboard className="h-4 w-4" />Gestão do time</p><h1 className="text-3xl font-extrabold tracking-tight text-navy-950">Meu Espaço</h1><p className="mt-2 text-sm text-muted">Do panorama do time à próxima pendência. Tudo no mesmo lugar.</p></div><button type="button" onClick={() => setRevision((value) => value + 1)} className={styles.chip}><RefreshCw className="h-4 w-4" />Atualizar</button></div>
      <div className="mt-5 flex flex-wrap items-center gap-2"><span className={styles.badge}><UsersRound className="h-3.5 w-3.5" />{currentName ? `Time de ${currentName}` : summary.data?.actor.broad ? "Todos os supervisores" : "Meu time"}</span><span className="text-xs text-muted">{tab === "hours" ? "Horas consolidadas por mês" : `${dateLabel(period.startDate)} a ${dateLabel(period.endDate)}`}</span>{summary.data && !summary.data.actor.canRespond ? <span className={styles.badge}>Somente consulta</span> : null}</div>
    </header>
    {summary.data?.actor.broad || supervisorId ? <SpaceSupervisorSlicer value={supervisorId} options={options} onChange={selectSupervisor} /> : null}
    {tab !== "hours" ? <><SpacePeriodSlicer value={period} today={initialPeriod().endDate} onChange={setPeriod} />
    <p className="px-1 text-xs text-muted">O período acima filtra indicadores e respostas contabilizadas. As pendências abertas têm datas independentes e incluem meses anteriores.</p></> : null}
    {!valid ? <p role="alert" className="text-red-700">Selecione um período válido para os indicadores.</p> : null}
    <fieldset><legend className="sr-only">Visão</legend><div className={styles.views}>{views.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => { if (id === "pending") setPendingKind("all"); setTab(id); }} className={`${styles.chip} ${styles.view}`}><Icon aria-hidden className="h-5 w-5 shrink-0" /><span>{label}</span></button>)}</div></fieldset>
    <SpaceLoad {...summary} />
    {tab === "overview" && counts ? <>
      <section aria-label="Indicadores de gestão"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-extrabold">O que precisa de atenção</h2><span className="text-xs text-muted">Clique em faltas ou horas para abrir a lista</span></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><SpaceCard title="Faltas pendentes" value={number(counts.absences)} tone="amber" helper="Ainda sem resposta / classificação" onClick={() => openPending("absence")} /><SpaceCard title="Horas pendentes" value={number(counts.hours)} tone="violet" helper="Sob responsabilidade registrada" onClick={() => openPending("hours")} /><SpaceCard title="Requerido em déficit" value={number(counts.required)} tone="amber" helper="LOB + turno · até o fim do mês" onClick={() => openPending("required")} /><SpaceCard title="Pendência mais antiga" value={age === null ? "Nenhuma" : `${age} dias`} helper={counts.oldest ? `Ocorrência em ${dateLabel(counts.oldest)} · não indica SLA` : "Nenhuma pendência aberta"} /><SpaceCard title="Respondidas no período" value={number(counts.answered)} tone="teal" helper={`${dateLabel(period.startDate)} a ${dateLabel(period.endDate)}`} /></div></section>
      {summary.data?.actor.broad ? <section className="card overflow-hidden"><div className="p-4"><h2 className="font-extrabold">Acompanhamento dos supervisores</h2><p className="mt-1 text-xs text-muted">Mais pendências primeiro. Latência ponderada no período selecionado. Selecione o nome para abrir o detalhe.</p></div><div className="overflow-x-auto"><table className={tableClass}><thead><tr><th>Supervisor</th><th>Time atual</th><th>Faltas</th><th>Horas</th><th>Requerido</th><th>Mais antiga</th><th>Respondidas</th><th>Latência do time</th></tr></thead><tbody>{summary.data.supervisors.map((row) => <tr key={row.id}><td><button type="button" onClick={() => selectSupervisor(row.id)} className="inline-flex items-center gap-2 font-bold text-blue-600 underline-offset-2 hover:underline">{row.name}<ArrowUpRight aria-hidden className="h-3.5 w-3.5" /></button></td><td>{row.teamSize}</td><td>{row.absences}</td><td>{row.hours}</td><td>{number(row.required)}</td><td>{row.oldest ? dateLabel(row.oldest) : "Nenhuma"}</td><td>{row.answered}</td><td>{results.loading ? "Carregando…" : results.error ? "Indisponível" : results.data?.supervisors.find((supervisor) => supervisor.id === row.id) ? <SupervisorLatency groups={results.data.supervisors.find((supervisor) => supervisor.id === row.id)!.groups} /> : "Sem dados"}</td></tr>)}</tbody></table></div></section> : null}
      <section className="space-y-3"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-extrabold">Resultado do time atual</h2><button type="button" onClick={() => setTab("results")} className="text-sm font-bold text-blue-600">Ver detalhamento →</button></div><SpaceLoad {...results} />{results.data ? <TeamMetricCards data={results.data} compact /> : null}</section>
    </> : null}
    {tab === "pending" && summary.data ? <SpacePendingTab key={`${supervisorId}:${revision}:${pendingKind}`} initialKind={pendingKind} supervisorId={supervisorId} lobs={summary.data.lobs} canRespond={summary.data.actor.canRespond} onAnswered={() => setAnsweredRevision((value) => value + 1)} /> : null}
    {tab === "results" ? <><SpaceLoad {...results} />{results.data ? <SpaceResultsTab key={supervisorId} data={results.data} supervisorId={supervisorId} /> : null}</> : null}
    {tab === "hours" && summary.data ? <SpaceHoursTab key={`${supervisorId}:${revision}`} supervisorId={supervisorId} initialPeriod={period} /> : null}
    <p className="text-xs text-muted">Sem atualização automática contínua. As justificativas e os históricos permanecem nos fluxos originais; o Requerido mantém um histórico separado de justificativas, sem mensagens automáticas.</p>
  </div>;
}
