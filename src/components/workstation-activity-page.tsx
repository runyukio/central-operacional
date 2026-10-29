"use client";

import { Activity, AppWindow, ArrowLeft, ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Clock, Globe2, Lock, RefreshCw, Search, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type SourceType = "WEB" | "APP" | "IDLE" | "LOCKED" | "PRIVATE" | "UNKNOWN";
type Summary = { rowCount: number; employees: number; totalSeconds: number; webSeconds: number; appSeconds: number; idleSeconds: number; lockedSeconds: number; privateSeconds: number; unknownSeconds: number; uniqueDomains: number };
type Agent = { agentKey: string; employeeId: string | null; employeeName: string; wbLogin: string | null; windowsUser: string | null; lob: string; supervisor: string; hostnames: string[]; totalSeconds: number; webSeconds: number; appSeconds: number; idleSeconds: number; lockedSeconds: number; uniqueDomains: number; lastActivityAt: string };
type Row = { id: string; eventId: string; sourceType: SourceType; applicationName: string | null; domain: string | null; startedAt: string; endedAt: string; durationSeconds: number; hostname: string };
type Ranking = { label: string; seconds: number };
type Payload = { success: boolean; date: string; agentKey: string | null; summary: Summary; agents: Agent[]; agentsFound: number; agentsTruncated: boolean; topDomains: Ranking[]; topApplications: Ranking[]; rows: Row[]; limit: number; truncated: boolean; error?: string; message?: string };
type DetailTab = "WEB" | "APP" | "TIMELINE";
const emptySummary: Summary = { rowCount: 0, employees: 0, totalSeconds: 0, webSeconds: 0, appSeconds: 0, idleSeconds: 0, lockedSeconds: 0, privateSeconds: 0, unknownSeconds: 0, uniqueDomains: 0 };

export function WorkstationActivityPage() {
  const [date, setDate] = useState(todayInSaoPaulo);
  const [search, setSearch] = useState("");
  const [agentSearch, setAgentSearch] = useState("");
  const [selected, setSelected] = useState<Agent | null>(null);
  const [overview, setOverview] = useState<Payload | null>(null);
  const [detail, setDetail] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [tab, setTab] = useState<DetailTab>("WEB");
  const [page, setPage] = useState(0);
  const selectedKey = selected?.agentKey ?? null;

  useEffect(() => {
    const timer = window.setTimeout(() => setAgentSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (selectedKey) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    const params = new URLSearchParams({ date, view: "overview" });
    if (agentSearch.trim()) params.set("agentSearch", agentSearch.trim());
    void fetchActivity(params, controller.signal).then((body) => {
      if (!controller.signal.aborted) setOverview(body);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Não foi possível carregar os agentes.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [date, agentSearch, selectedKey, refresh]);

  useEffect(() => {
    if (!selectedKey) return;
    const controller = new AbortController();
    setDetailLoading(true); setDetailError("");
    const params = new URLSearchParams({ date, view: "agent", agentKey: selectedKey, limit: "5000" });
    void fetchActivity(params, controller.signal).then((body) => {
      if (!controller.signal.aborted) setDetail(body);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setDetailError(reason instanceof Error ? reason.message : "Não foi possível carregar o agente.");
    }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [date, selectedKey, refresh]);

  useEffect(() => {
    const refreshVisible = () => { if (!document.hidden) setRefresh((value) => value + 1); };
    const interval = window.setInterval(refreshVisible, 60_000);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", refreshVisible); };
  }, []);

  const data = selected ? detail?.date === date && detail.agentKey === selectedKey ? detail : null : overview?.date === date ? overview : null;
  const summary = data?.summary ?? emptySummary;
  const busy = selected ? detailLoading : loading;
  const currentError = selected ? detailError : error;
  const pages = Math.max(1, Math.ceil((data?.rows.length ?? 0) / 50));
  const currentPage = Math.min(page, pages - 1);
  const pageRows = useMemo(() => data?.rows.slice(currentPage * 50, (currentPage + 1) * 50) ?? [], [data?.rows, currentPage]);

  function openAgent(agent: Agent) {
    setSelected(agent); setDetail(null); setTab("WEB"); setPage(0); setDetailError("");
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Atividades" description="Uma visão geral da equipe. Os detalhes aparecem ao selecionar um agente." icon={Activity}
        actions={<div className="flex flex-wrap items-center gap-2">
          <label className="relative"><span className="sr-only">Data das atividades</span><CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-600" />
            <input type="date" aria-label="Data das atividades" value={date} onChange={(event) => { setDate(event.target.value || todayInSaoPaulo()); setPage(0); }} className="premium-control h-10 pl-9 pr-3 text-sm font-bold text-navy-950" />
          </label>
          <button type="button" onClick={() => setRefresh((value) => value + 1)} disabled={busy} className="premium-button inline-flex h-10 items-center gap-2 px-3 text-sm font-bold disabled:opacity-60"><RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />Atualizar</button>
        </div>} />

      {currentError ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{currentError}</div> : null}

      {selected ? <div className="space-y-4">
        <button type="button" onClick={() => { setSelected(null); setPage(0); }} className="inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:text-blue-800"><ArrowLeft className="h-4 w-4" />Voltar à visão geral</button>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-white p-5">
          <div className="flex min-w-0 items-center gap-3"><Avatar /><div className="min-w-0"><h2 className="break-words text-xl font-extrabold tracking-tight text-navy-950">{selected.employeeName}</h2><p className="mt-1 text-sm text-muted">{selected.employeeId ? `${selected.wbLogin || selected.windowsUser || ""} · ${selected.lob}` : "Estação sem vínculo com um agente"}</p><p className="mt-1 text-xs text-muted">{selected.hostnames.join(" · ")}{selected.supervisor !== "Sem supervisor" ? ` · ${selected.supervisor}` : ""}</p></div></div>
          <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700">Visão individual</span>
        </div>
      </div> : <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-extrabold text-navy-950">Visão geral da equipe</h2><p className="mt-0.5 text-sm text-muted">Resumo de todos os agentes disponíveis para o seu perfil.</p></div><span className="hidden rounded-full border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted sm:block">Atualização a cada minuto</span></div>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy={busy}>
        <Metric title={selected ? "Tempo monitorado" : "Agentes e estações"} value={data ? selected ? formatDuration(summary.totalSeconds) : String(summary.employees) : "—"} icon={selected ? Clock : UsersRound} />
        <Metric title={selected ? "Em sites" : "Tempo monitorado"} value={data ? formatDuration(selected ? summary.webSeconds : summary.totalSeconds) : "—"} icon={selected ? Globe2 : Clock} />
        <Metric title={selected ? "Em aplicativos" : "Em sites"} value={data ? formatDuration(selected ? summary.appSeconds : summary.webSeconds) : "—"} icon={selected ? AppWindow : Globe2} />
        <Metric title="Inatividade e bloqueio" value={data ? formatDuration(summary.idleSeconds + summary.lockedSeconds) : "—"} icon={Lock} />
      </div>

      {!selected ? <>
        <Panel title="Distribuição do tempo"><TimeDistribution summary={summary} /></Panel>
        <Panel title="Selecione um agente">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted">Abra um agente para ver os sites e aplicativos utilizados.</p><label className="relative w-full sm:w-80"><span className="sr-only">Buscar agente</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input aria-label="Buscar agente" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar agente, WB ou estação" className="premium-control h-10 w-full pl-9 pr-3 text-sm" /></label></div>
          {loading && !data ? <Loading label="Carregando agentes..." /> : !data?.agents.length ? <EmptyState title={agentSearch ? "Nenhum agente encontrado" : "Ainda não há registros nessa data"} description={agentSearch ? "Tente outro nome, WB ou estação." : "Os agentes aparecerão aqui após o envio das atividades."} /> : <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[700px] text-left"><thead><tr className="border-b border-border bg-slate-50 text-xs font-bold text-muted"><th className="px-4 py-3">Agente</th><th className="px-4 py-3">Tempo monitorado</th><th className="px-4 py-3">Em sites</th><th className="px-4 py-3">Último registro</th><th className="px-4 py-3"><span className="sr-only">Abrir agente</span></th></tr></thead>
              <tbody className="divide-y divide-border">{data.agents.map((agent) => <tr key={agent.agentKey} className="group hover:bg-blue-50/40"><td className="px-4 py-4"><button type="button" onClick={() => openAgent(agent)} className="flex max-w-full items-center gap-3 text-left font-bold text-navy-950 hover:text-blue-600"><Avatar small /><span className="min-w-0"><span className="block break-words text-sm">{agent.employeeName}</span><span className="mt-1 block text-xs font-medium text-muted">{agent.employeeId ? `${agent.wbLogin || ""} · ${agent.lob}` : `Sem vínculo · ${agent.hostnames.join(", ")}`}</span></span></button></td><td className="px-4 py-4 text-sm font-bold text-navy-950">{formatDuration(agent.totalSeconds)}</td><td className="px-4 py-4 text-sm text-muted">{formatDuration(agent.webSeconds)}</td><td className="px-4 py-4 text-sm text-muted">{formatTime(agent.lastActivityAt)}</td><td className="px-4 py-4 text-right"><button type="button" onClick={() => openAgent(agent)} aria-label={`Ver atividades de ${agent.employeeName}`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 text-xs font-bold text-blue-700 hover:bg-blue-100">Ver atividade<ArrowRight className="h-3.5 w-3.5" /></button></td></tr>)}</tbody>
            </table>
          </div>}
          {data?.agentsTruncated ? <p className="mt-3 text-xs text-amber-700">Mostrando {data.agents.length} de {data.agentsFound} agentes. Use a busca para encontrar outro agente.</p> : null}
        </Panel>
      </> : <>
        <div role="group" aria-label="Detalhamento do agente" className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-white p-1">
          {([{ key: "WEB", label: "Sites", icon: Globe2 }, { key: "APP", label: "Aplicativos", icon: AppWindow }, { key: "TIMELINE", label: "Linha do tempo", icon: Clock }] as const).map(({ key, label, icon: Icon }) => <button key={key} type="button" aria-pressed={tab === key} aria-controls="activity-detail-content" onClick={() => { setTab(key); setPage(0); }} className={cn("inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold transition-colors", tab === key ? "bg-blue-600 text-white" : "text-muted hover:bg-slate-50 hover:text-navy-950")}><Icon className="h-4 w-4" />{label}</button>)}
        </div>
        <div id="activity-detail-content" role="region" aria-label={tab === "WEB" ? "Sites do agente" : tab === "APP" ? "Aplicativos do agente" : "Histórico do agente"}>
          {detailLoading && !data ? <Loading label="Carregando atividade do agente..." /> : tab !== "TIMELINE" ? <RankingPanel title={tab === "WEB" ? "Sites utilizados" : "Aplicativos utilizados"} items={tab === "WEB" ? data?.topDomains ?? [] : data?.topApplications ?? []} total={tab === "WEB" ? summary.webSeconds : summary.appSeconds} applications={tab === "APP"} count={tab === "WEB" ? summary.uniqueDomains : undefined} /> : <Panel title="Linha do tempo">
            {!data?.rows.length ? <EmptyState title="Sem atividade para este agente" description="Escolha outra data para consultar o histórico." /> : <>
              <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[650px] text-left"><thead><tr className="border-b border-border bg-slate-50 text-xs font-bold text-muted"><th className="px-4 py-3">Intervalo</th><th className="px-4 py-3">Atividade</th><th className="px-4 py-3">Duração</th><th className="px-4 py-3">Estação</th></tr></thead><tbody className="divide-y divide-border">{pageRows.map((row) => <tr key={`${row.eventId}-${row.startedAt}`}><td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-muted">{formatTime(row.startedAt, true)} – {formatTime(row.endedAt, true)}</td><td className="px-4 py-3"><span className="block text-sm font-bold text-navy-950">{row.sourceType === "WEB" ? row.domain || "Domínio não identificado" : row.sourceType === "APP" ? formatApplication(row.applicationName) : sourceLabel(row.sourceType)}</span><span className="mt-0.5 block text-xs text-muted">{sourceLabel(row.sourceType)}</span></td><td className="px-4 py-3 text-sm font-semibold text-navy-950">{formatDuration(row.durationSeconds)}</td><td className="px-4 py-3 text-xs text-muted">{row.hostname}</td></tr>)}</tbody></table></div>
              <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted"><span>Página {currentPage + 1} de {pages}</span><div className="flex gap-2"><button type="button" aria-label="Página anterior" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="rounded-lg border border-border p-2 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button><button type="button" aria-label="Próxima página" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)} className="rounded-lg border border-border p-2 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button></div></div>
              {data.truncated ? <p className="mt-3 text-xs text-amber-700">O histórico exibe até {data.limit.toLocaleString("pt-BR")} registros. Os totais e rankings consideram o dia completo.</p> : null}
            </>}
          </Panel>}
        </div>
      </>}
      <p className="flex items-center gap-2 px-1 text-xs text-muted"><ShieldCheck className="h-3.5 w-3.5 shrink-0" />Somente domínio, aplicativo e intervalo são coletados.</p>
    </div>
  );
}

async function fetchActivity(params: URLSearchParams, signal: AbortSignal): Promise<Payload> {
  const response = await fetch(`/api/realtime-hours/activity?${params}`, { cache: "no-store", signal });
  const body = await response.json().catch(() => null) as Payload | null;
  if (!response.ok || !body?.success) throw new Error(body?.message || body?.error || "Não foi possível carregar as atividades. Tente atualizar novamente.");
  return body;
}

function Avatar({ small = false }: { small?: boolean }) {
  return <span className={cn("grid shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600", small ? "h-9 w-9" : "h-12 w-12")}><UserRound className={small ? "h-4 w-4" : "h-6 w-6"} /></span>;
}
function Metric({ title, value, icon: Icon }: { title: string; value: string; icon: LucideIcon }) {
  return <article className="flex min-h-[94px] min-w-0 items-center gap-3 rounded-xl border border-border bg-white px-4 py-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-50 text-slate-500"><Icon className="h-4 w-4" /></span><div className="min-w-0"><p className="text-xs font-semibold text-muted">{title}</p><p className="mt-1 text-xl font-extrabold tracking-tight text-navy-950">{value}</p></div></article>;
}
function Loading({ label }: { label: string }) {
  return <div role="status" className="grid min-h-48 place-items-center text-sm font-semibold text-muted"><span className="inline-flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin text-blue-600" />{label}</span></div>;
}
function TimeDistribution({ summary }: { summary: Summary }) {
  const items = [
    { label: "Sites", seconds: summary.webSeconds, color: "bg-blue-500" },
    { label: "Aplicativos", seconds: summary.appSeconds, color: "bg-indigo-400" },
    { label: "Inatividade", seconds: summary.idleSeconds, color: "bg-amber-400" },
    { label: "Bloqueio", seconds: summary.lockedSeconds, color: "bg-slate-400" },
    { label: "Privado", seconds: summary.privateSeconds, color: "bg-violet-300" },
    { label: "Não identificado", seconds: summary.unknownSeconds, color: "bg-slate-200" }
  ].filter((item) => item.seconds > 0);
  if (!summary.totalSeconds) return <p className="py-3 text-sm text-muted">O resumo será preenchido quando houver atividade nessa data.</p>;
  return <><div className="flex h-3 overflow-hidden rounded-full bg-slate-100" aria-label="Distribuição do tempo monitorado">{items.map((item) => <span key={item.label} className={item.color} style={{ width: `${(item.seconds / summary.totalSeconds) * 100}%` }} title={`${item.label}: ${formatDuration(item.seconds)}`} />)}</div><div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">{items.map((item) => <span key={item.label} className="inline-flex items-center gap-2 text-xs text-muted"><span className={cn("h-2 w-2 rounded-full", item.color)} />{item.label}<span className="font-bold text-navy-950">{formatDuration(item.seconds)}</span></span>)}</div></>;
}
function RankingPanel({ title, items, total, applications, count }: { title: string; items: Ranking[]; total: number; applications: boolean; count?: number }) {
  return <Panel title={title}>{!items.length ? <EmptyState title={applications ? "Nenhum aplicativo registrado" : "Nenhum site registrado"} description="Não há registros desse tipo para o agente e a data selecionados." /> : <>
    <p className="mb-4 text-sm text-muted">{count !== undefined ? `${count} domínio${count === 1 ? "" : "s"} registrado${count === 1 ? "" : "s"}` : `${items.length} aplicativo${items.length === 1 ? "" : "s"}`} · {formatDuration(total)} no total{count && count > items.length ? ` · ${items.length} mais utilizados` : ""}</p>
    <div className="overflow-hidden rounded-xl border border-border"><table className="w-full text-left"><thead><tr className="border-b border-border bg-slate-50 text-xs font-bold text-muted"><th className="px-4 py-3">{applications ? "Aplicativo" : "Domínio"}</th><th className="px-4 py-3 text-right">Tempo</th><th className="hidden w-52 px-4 py-3 sm:table-cell">Participação</th></tr></thead><tbody className="divide-y divide-border">{items.map((item) => { const percent = total ? Math.min(100, (item.seconds / total) * 100) : 0; return <tr key={item.label}><td className="px-4 py-4"><span className="inline-flex items-center gap-2.5 text-sm font-bold text-navy-950">{applications ? <AppWindow className="h-4 w-4 shrink-0 text-indigo-500" /> : <Globe2 className="h-4 w-4 shrink-0 text-blue-500" />}<span className="break-all">{applications ? formatApplication(item.label) : item.label}</span></span></td><td className="whitespace-nowrap px-4 py-4 text-right text-sm font-semibold text-navy-950">{formatDuration(item.seconds)}</td><td className="hidden px-4 py-4 sm:table-cell"><div className="flex items-center gap-3"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-400" style={{ width: `${percent}%` }} /></div><span className="w-10 text-right text-xs text-muted">{percent.toFixed(1)}%</span></div></td></tr>; })}</tbody></table></div>
  </>}</Panel>;
}
function sourceLabel(type: SourceType) { return { WEB: "Site", APP: "Aplicativo", IDLE: "Inatividade", LOCKED: "Tela bloqueada", PRIVATE: "Navegação privada", UNKNOWN: "Não identificado" }[type]; }
function formatApplication(value: string | null) {
  if (!value) return "Aplicativo não identificado";
  const labels: Record<string, string> = { chrome: "Google Chrome", msedge: "Microsoft Edge", firefox: "Mozilla Firefox", brave: "Brave", excel: "Microsoft Excel", winword: "Microsoft Word", outlook: "Microsoft Outlook", teams: "Microsoft Teams", powerpnt: "Microsoft PowerPoint", code: "Visual Studio Code", explorer: "Explorador de Arquivos" };
  return labels[value.toLowerCase()] ?? value;
}
function formatDuration(seconds: number) { const total = Math.max(0, Math.round(seconds)); const h = Math.floor(total / 3600); const m = Math.floor((total % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, "0")}min` : m ? `${m}min` : `${total % 60}s`; }
function formatTime(value: string, seconds = false) { return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) }).format(new Date(value)); }
function todayInSaoPaulo() { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}-${parts.find((p) => p.type === "day")?.value}`; }
