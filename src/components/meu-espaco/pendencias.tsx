"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { apiJson, FormInput } from "@/components/modules/shared";
import { officialAbsenceReasons } from "@/lib/absence-reasons";
import { createSpacePendingFeed, emptySpaceFeed, type SpacePendingPage } from "@/lib/meu-espaco-feed";
import type { SpacePending } from "@/lib/meu-espaco-contract";
import { formatMinutesToHHMM } from "@/lib/work-hours-rules";
import { dateLabel, SpaceButtons, SpaceLoad, useSpaceRead } from "./shared";

function PendingDetail({ row, supervisorId, canRespond, onAnswered }: { row: SpacePending; supervisorId: string; canRespond: boolean; onAnswered: (row: SpacePending) => void }) {
  const endpoint = `/api/meu-espaco/pendencias/${row.kind}/${encodeURIComponent(row.id)}?${new URLSearchParams({ supervisorId })}`;
  const history = useSpaceRead<{ history: Array<{ id: string; date: string; actor: string; text: string }> }>(endpoint);
  const [reason, setReason] = useState("");
  const [reasonCategory, setReasonCategory] = useState("Operacional");
  const [justification, setJustification] = useState("");
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (saving) return;
    setSaving(true); setError("");
    try {
      const result = await apiJson<{ data: SpacePending }>(endpoint, { method: "POST", body: JSON.stringify({ justification, ...(row.kind === "absence" ? { reason, reasonCategory } : {}) }) });
      onAnswered(result.data);
    } catch (error) { setError(error instanceof Error ? error.message : "Não foi possível salvar. Sua resposta foi mantida."); }
    finally { setSaving(false); }
  }
  return <div className="mt-4 border-t border-border pt-4">
    {row.kind === "hours" ? <p className="mb-3 text-sm text-muted">Classificação: {row.reason} · Previsto: {row.plannedStart || "—"}–{row.plannedEnd || "—"} · Captura na ocorrência: {row.capturedMinutes == null ? "Sem dados" : formatMinutesToHHMM(row.capturedMinutes).padStart(5, "0")}</p> : null}
    {canRespond && row.pending ? <form onSubmit={submit} className="space-y-3">
      {row.kind === "absence" ? <label className="block text-sm font-bold">Motivo<select required value={reason} onChange={(e) => setReason(e.target.value)} className="premium-control mt-2 w-full p-2"><option value="">Selecione o motivo</option>{officialAbsenceReasons.map((value) => <option key={value}>{value}</option>)}</select></label> : null}
      {row.kind === "absence" ? <label className="block text-sm font-bold">Categoria<select value={reasonCategory} onChange={(e) => setReasonCategory(e.target.value)} className="premium-control mt-2 w-full p-2">{["Cronograma", "Operacional", "Saúde", "Infraestrutura", "Equipamentos", "Internet", "Outros"].map((value) => <option key={value}>{value}</option>)}</select></label> : null}
      <label className="block text-sm font-bold">{row.kind === "absence" ? "Descrição da ocorrência" : "Justificativa de aderência"}<textarea required minLength={row.kind === "hours" ? 5 : 1} maxLength={10000} value={justification} onChange={(e) => setJustification(e.target.value)} className="premium-control mt-2 min-h-24 w-full p-3 font-normal" /></label>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Check className="h-4 w-4" />{saving ? "Salvando…" : "Enviar justificativa"}</button>
    </form> : <div className="space-y-2 text-sm"><p>{row.pending ? "Seu perfil acompanha esta pendência em modo de consulta." : `Motivo: ${row.reason || "—"}`}</p>{row.justification ? <p className="whitespace-pre-wrap">{row.justification}</p> : null}{/^https?:\/\//i.test(row.evidenceUrl) ? <a href={row.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">Abrir evidência</a> : null}</div>}
    <details className="mt-4 text-sm"><summary className="cursor-pointer font-bold">Histórico original</summary><SpaceLoad {...history} />{history.data?.history.length ? <ol className="mt-3 space-y-3">{history.data.history.map((entry) => <li key={entry.id} className="border-l-2 border-border pl-3"><p className="text-xs text-muted">{new Date(entry.date).toLocaleString("pt-BR")} · {entry.actor}</p><p className="whitespace-pre-wrap">{entry.text}</p></li>)}</ol> : !history.loading && !history.error ? <p className="mt-2 text-muted">Nenhuma resposta registrada.</p> : null}<p className="mt-2 text-xs text-muted">Até 30 registros mais recentes do fluxo original.</p></details>
  </div>;
}

export function SpacePendingTab({ supervisorId, lobs, canRespond, onAnswered, initialKind = "all" }: { supervisorId: string; lobs: string[]; canRespond: boolean; onAnswered: () => void; initialKind?: string }) {
  const [filters, setFilters] = useState({ kind: initialKind, state: "pending", search: "", lob: "", startDate: "", endDate: "" });
  const [search, setSearch] = useState("");
  const [opened, setOpened] = useState("");
  const [message, setMessage] = useState("");
  const [state, setState] = useState(emptySpaceFeed);
  const [feed] = useState(() => createSpacePendingFeed(async (query, cursor, signal) => {
    const params = new URLSearchParams(query); if (cursor) params.set("cursor", cursor);
    return apiJson<SpacePendingPage>(`/api/meu-espaco/pendencias?${params}`, { signal });
  }, setState));
  const query = new URLSearchParams({ ...filters, search, supervisorId }).toString();
  const valid = !filters.startDate || !filters.endDate || filters.startDate <= filters.endDate;
  useEffect(() => { const timer = setTimeout(() => setSearch(filters.search.trim()), 300); return () => clearTimeout(timer); }, [filters.search]);
  useEffect(() => {
    setOpened("");
    if (!valid || search !== filters.search.trim()) { feed.invalidate(); return; }
    void feed.reset(query); return () => feed.invalidate();
  }, [query, valid, search, filters.search, feed]);
  function change(patch: Partial<typeof filters>) { feed.invalidate(); setFilters((value) => ({ ...value, ...patch })); }
  return <div className="space-y-4">
    <section className="card space-y-4 p-4" aria-label="Filtros de pendências">
      <div className="flex flex-wrap gap-5"><SpaceButtons label="Tipo" value={filters.kind} onChange={(kind) => change({ kind })} options={[{ id: "all", label: "Todas" }, { id: "absence", label: "Faltas" }, { id: "hours", label: "Horas" }]} /><SpaceButtons label="Situação" value={filters.state} onChange={(state) => change({ state })} options={[{ id: "pending", label: "Pendentes" }, { id: "answered", label: "Respondidas" }]} /></div>
      <SpaceButtons label="LOB das pendências" value={filters.lob} onChange={(lob) => change({ lob })} options={[{ id: "", label: "Todas as LOBs" }, ...lobs.map((lob) => ({ id: lob, label: lob }))]} />
      <div className="grid gap-3 sm:grid-cols-3"><FormInput label="Parceiro" value={filters.search} onChange={(search) => change({ search })} placeholder="Nome ou WB" /><FormInput label="Ocorrências desde (opcional)" type="date" value={filters.startDate} onChange={(startDate) => change({ startDate })} /><FormInput label="Ocorrências até (opcional)" type="date" value={filters.endDate} onChange={(endDate) => change({ endDate })} /></div>
      <button type="button" onClick={() => change({ kind: "all", state: "pending", search: "", lob: "", startDate: "", endDate: "" })} className="text-xs font-bold text-blue-600 underline underline-offset-4">Limpar filtros de pendências</button>
      <p className="text-xs text-muted">Sem datas: todas as ocorrências até hoje, inclusive de meses anteriores. Ordem da mais antiga para a mais recente. Horas mantêm o responsável registrado na ocorrência.</p>
      {!valid ? <p role="alert" className="text-sm text-red-700">A data inicial deve ser anterior ou igual à final.</p> : null}
    </section>
    {message ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p> : null}
    <SpaceLoad loading={state.loading || search !== filters.search.trim()} error={state.error} retry={() => void feed.retry()} />
    {valid && !state.loading && search === filters.search.trim() ? <>
      {!state.rows.length && state.initialized && !state.error ? <div className="card p-8 text-center text-muted">Nenhuma ocorrência encontrada para estes filtros.</div> : null}
      {state.rows.map((row) => { const key = `${row.kind}:${row.id}`; return <article key={key} className="card p-4">
        <button type="button" onClick={() => setOpened(opened === key ? "" : key)} aria-expanded={opened === key} className="flex w-full flex-wrap items-center justify-between gap-3 text-left">
          <div><p className="font-bold text-navy-950">{row.employeeName} <span className="text-xs font-medium text-muted">{row.wbLogin}</span></p><p className="mt-1 text-xs text-muted">{dateLabel(row.date)} · {row.lob} · Responsável: {row.supervisor}</p></div>
          <div className="flex items-center gap-3"><span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold">{row.kind === "hours" ? "Horas" : "Falta / ocorrência"}</span><span className="text-xs text-muted">{row.pending ? "Pendente" : row.status === "FALTA_INJUSTIFICADA" ? "Classificada como injustificada" : "Respondida"}</span><ChevronDown className="h-4 w-4" /></div>
        </button>
        {opened === key ? <PendingDetail row={row} supervisorId={supervisorId} canRespond={canRespond} onAnswered={(updated) => { feed.answer(updated); setOpened(""); setMessage("Justificativa salva no fluxo original."); onAnswered(); }} /> : null}
      </article>; })}
      {state.hasMore ? <button type="button" onClick={() => void feed.more()} disabled={state.loadingMore || Boolean(state.error)} className="premium-control w-full p-3 text-sm font-bold disabled:opacity-50">{state.loadingMore ? "Carregando…" : "Carregar mais 50"}</button> : null}
      {state.initialized ? <p className="text-center text-xs text-muted">{state.rows.length} ocorrências carregadas{state.hasMore ? " · Há mais resultados" : " · Fim da lista"}</p> : null}
    </> : null}
  </div>;
}
