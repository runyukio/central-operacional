"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { EmptyState, StatusBadge } from "@/components/ui/primitives";
import { FormInput, apiJson, currentOperationalMonthRange, downloadFile } from "@/components/modules/shared";
import { adherenceFilterQuery, initialAdherenceFilters, reconcileAdherenceFilters, type AdherenceFilterOptions, type WorkHourAdherenceFilters } from "@/lib/work-hour-adherence-filters";
import { createAdherenceFeed, emptyAdherenceFeed, type AdherencePage, type WorkHourAdherenceRow } from "@/lib/work-hour-adherence-feed";
import { createClientRequestGate } from "@/lib/client-request-gate";
import { cn } from "@/lib/utils";

function Slicer({ label, value, options, onChange, disabled, helper }: {
  label: string; value: string; options: Array<{ id: string; name: string }>;
  onChange: (value: string) => void; disabled?: boolean; helper?: string;
}) {
  return <fieldset disabled={disabled} className="min-w-0">
    <legend className="mb-3 text-sm font-extrabold uppercase tracking-wide text-muted">{label}</legend>
    <div className="flex flex-wrap gap-2.5">
      {options.map((option) => <button key={option.id} type="button" aria-pressed={value === option.id}
        onClick={() => onChange(option.id)} className={cn("min-h-11 rounded-lg border px-4 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50",
          value === option.id ? "border-blue-600 bg-blue-600 text-white" : "border-border bg-white text-navy-950 hover:border-blue-400")}>{option.name}</button>)}
    </div>
    {helper ? <p className="mt-1.5 text-xs font-semibold text-muted">{helper}</p> : null}
  </fieldset>;
}

const optionsWithAll = (values: string[], all = "Todos") => [{ id: "Todos", name: all }, ...values.map((value) => ({ id: value, name: value }))];
const noOptions: AdherenceFilterOptions = { lobs: [], supervisors: [], shifts: [] };

export function WorkHourJustifications({ active, refreshKey, actorName, onMessage, onAnswered }: {
  active: boolean; refreshKey: number; actorName: string; onMessage: (message: string) => void; onAnswered?: () => void;
}) {
  const [filters, setFilters] = useState(() => ({ ...initialAdherenceFilters(currentOperationalMonthRange()), collaborator: "" }));
  const [search, setSearch] = useState("");
  const [optionState, setOptionState] = useState({ key: "", data: noOptions, error: "" });
  const [optionRetry, setOptionRetry] = useState(0);
  const [optionRequests] = useState(createClientRequestGate);
  const [state, setState] = useState(emptyAdherenceFeed);
  const [feed] = useState(() => createAdherenceFeed(async (next, cursor, signal) => {
    const query = new URLSearchParams(adherenceFilterQuery(next));
    if (cursor) query.set("cursor", cursor);
    return apiJson<AdherencePage>(`/api/work-hours/adherence?${query}`, { signal });
  }, setState));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState("");
  const [exporting, setExporting] = useState(false);
  const listStart = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const validPeriod = Boolean(filters.startDate && filters.endDate && filters.startDate <= filters.endDate);
  const optionQuery = adherenceFilterQuery({ startDate: filters.startDate, endDate: filters.endDate, lob: filters.lob });
  const optionsReady = optionState.key === optionQuery && !optionState.error;
  const applied = useMemo(() => ({ ...filters, collaborator: search }), [filters, search]);
  const ready = validPeriod && optionsReady && search === filters.collaborator.trim();
  const options = optionsReady ? optionState.data : noOptions;

  useEffect(() => {
    const timer = setTimeout(() => setSearch(filters.collaborator.trim()), 300);
    return () => clearTimeout(timer);
  }, [filters.collaborator]);

  useEffect(() => {
    if (!active || !validPeriod) return;
    const request = optionRequests.begin();
    setOptionState({ key: "", data: noOptions, error: "" });
    apiJson<{ data: AdherenceFilterOptions }>(`/api/work-hours/adherence/filters?${optionQuery}`, { signal: request.signal })
      .then((payload) => {
        if (!optionRequests.isCurrent(request)) return;
        setOptionState({ key: optionQuery, data: payload.data, error: "" });
        setFilters((current) => {
          const next = reconcileAdherenceFilters(current, payload.data);
          return next.lob === current.lob && next.supervisorId === current.supervisorId && next.shift === current.shift
            ? current : { ...current, ...next };
        });
      }).catch((error) => {
        if (optionRequests.isCurrent(request)) setOptionState({ key: optionQuery, data: noOptions,
          error: error instanceof Error ? error.message : "Não foi possível carregar os filtros." });
      });
    return () => optionRequests.cancel();
  }, [active, validPeriod, optionQuery, optionRetry, optionRequests, refreshKey]);

  useEffect(() => {
    if (!active || !ready) { feed.invalidate(); return; }
    void feed.reset(applied);
    return () => feed.dispose();
  }, [active, ready, applied, feed, refreshKey]);

  useEffect(() => {
    if (!active || !ready || !state.hasMore || state.loading || state.loadingMore || state.error || !sentinel.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void feed.loadMore();
    }, { rootMargin: "600px 0px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [active, ready, state.hasMore, state.loading, state.loadingMore, state.error, state.nextCursor, feed]);

  function changeFilters(patch: Partial<WorkHourAdherenceFilters>) {
    feed.invalidate();
    const dimensionsChanged = (patch.startDate !== undefined && patch.startDate !== filters.startDate)
      || (patch.endDate !== undefined && patch.endDate !== filters.endDate)
      || (patch.lob !== undefined && patch.lob !== filters.lob);
    if (dimensionsChanged) {
      optionRequests.cancel();
      setOptionState({ key: "", data: noOptions, error: "" });
    }
    setFilters((current) => ({ ...current, ...patch, collaborator: patch.collaborator ?? current.collaborator }));
    // Use the page's normal scrolling; do not trap navigation in a short inner pane.
    if (listStart.current && listStart.current.getBoundingClientRect().top < 0) listStart.current.scrollIntoView({ block: "start" });
  }

  async function submit(row: WorkHourAdherenceRow) {
    const justification = (drafts[row.id] ?? row.justification).trim();
    if (justification.length < 5) { onMessage("Informe uma justificativa de aderência com pelo menos 5 caracteres."); return; }
    setSavingId(row.id);
    onMessage("");
    try {
      const response = await apiJson<{ data: { id: string; status: string; answeredAt: string } }>("/api/work-hours/adherence", {
        method: "POST", body: JSON.stringify({ id: row.id, justification })
      });
      feed.update({ ...row, ...response.data, justification, answeredBy: actorName });
      onMessage("Justificativa de aderência enviada.");
      onAnswered?.();
    } catch (error) { onMessage(error instanceof Error ? error.message : "Não foi possível enviar a justificativa."); }
    finally { setSavingId(""); }
  }

  async function exportRows() {
    if (exporting || !ready || !state.initialized) return;
    setExporting(true);
    try {
      await downloadFile(`/api/work-hours/adherence/export?${adherenceFilterQuery(applied)}`, `justificativas_aderencia_${applied.startDate}_${applied.endDate}.xlsx`);
    } catch (error) { onMessage(error instanceof Error ? error.message : "Não foi possível exportar as justificativas."); }
    finally { setExporting(false); }
  }

  // Preserve the stable server date/id order while extending the current day.
  const days = useMemo(() => {
    const groups = new Map<string, WorkHourAdherenceRow[]>();
    for (const row of state.rows) {
      const rows = groups.get(row.date) ?? [];
      rows.push(row);
      groups.set(row.date, rows);
    }
    return Array.from(groups, ([date, rows]) => ({ date, rows }));
  }, [state.rows]);

  if (!active) return null;
  return <>
    <section className="card mb-5 space-y-6 p-5 sm:p-6" aria-label="Filtros de justificativas">
      <div className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)_auto] [&_input]:h-12 [&_input]:text-base">
        <FormInput label="Data inicial" type="date" value={filters.startDate} onChange={(startDate) => changeFilters({ startDate })} />
        <FormInput label="Data final" type="date" value={filters.endDate} onChange={(endDate) => changeFilters({ endDate })} />
        <FormInput label="Parceiro" value={filters.collaborator} placeholder="Pesquisar por nome ou WB"
          onChange={(collaborator) => changeFilters({ collaborator })} />
        <button type="button" onClick={() => changeFilters({ ...initialAdherenceFilters(currentOperationalMonthRange()), collaborator: "" })}
          className="premium-control inline-flex h-12 items-center justify-center gap-2 px-5 text-sm font-bold"><RefreshCw className="h-4 w-4" />Limpar filtros</button>
      </div>
      <div className="grid items-start gap-6 border-t border-border pt-5 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <Slicer label="LOB" value={filters.lob} options={optionsWithAll(options.lobs, "Todas")} disabled={!optionsReady}
        onChange={(lob) => changeFilters({ lob })} />
      <Slicer label="Supervisor" value={filters.supervisorId} options={[{ id: "Todos", name: "Todos" }, ...options.supervisors]}
        disabled={filters.lob === "Todos" || !optionsReady} helper={filters.lob === "Todos" ? "Selecione uma LOB" : undefined}
        onChange={(supervisorId) => changeFilters({ supervisorId })} />
      <Slicer label="Turno" value={filters.shift} options={optionsWithAll(options.shifts)} disabled={!optionsReady}
        onChange={(shift) => changeFilters({ shift })} />
      <Slicer label="Status da justificativa" value={filters.justificationStatus} options={optionsWithAll(["Pendentes", "Justificados"])}
        onChange={(justificationStatus) => changeFilters({ justificationStatus })} />
      </div>
      {!validPeriod ? <p role="alert" className="text-sm font-semibold text-red-700">Informe um período válido: a data inicial deve ser anterior ou igual à data final.</p>
        : optionState.error ? <p role="alert" className="text-sm font-semibold text-red-700">{optionState.error} <button type="button" className="underline" onClick={() => setOptionRetry((value) => value + 1)}>Tentar novamente</button></p>
        : !optionsReady ? <p role="status" className="text-xs font-semibold text-muted">Atualizando filtros...</p> : null}
    </section>
    <div ref={listStart} />
    <section className="card mb-5 overflow-hidden" aria-label="Lista de justificativas">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div><h2 className="text-lg font-extrabold text-navy-950">Pendências de justificativa</h2>
          <p className="text-sm font-semibold text-muted">Capturas originais ou horas lançadas manualmente abaixo de 7:25 para agentes elegíveis.</p></div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-muted">{state.rows.length} carregada(s)</span>
          <StatusBadge status={`${state.rows.filter((row) => row.status === "Pendente").length} pendente(s)`} />
          <StatusBadge status={`${state.rows.filter((row) => row.status === "Justificado").length} justificado(s)`} />
          <button type="button" onClick={() => void exportRows()} disabled={exporting || !ready || !state.initialized}
            className="premium-control inline-flex h-10 items-center gap-2 px-4 text-sm font-bold text-navy-950 disabled:opacity-50"><Download className="h-4 w-4" />{exporting ? "Exportando..." : "Exportar justificativas"}</button>
        </div>
      </div>
      {state.rows.length ? <div className="overflow-x-auto">
        <table className="w-full min-w-[1320px] text-left text-sm">
          <thead className="border-b border-border bg-slate-50 text-xs font-bold uppercase tracking-wide text-muted"><tr>
            {["Parceiro / WB", "Data", "LOB / classificação", "Supervisor", "Escala prevista", "Duração de referência", "Status", "Justificativa", "Resposta"].map((column) => <th key={column} className="px-4 py-3">{column}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-border bg-white">{days.map((day) => <Fragment key={day.date}>
            <tr className="bg-slate-50"><th scope="rowgroup" colSpan={9} className="px-4 py-3 font-extrabold text-navy-950">{day.date.split("-").reverse().join("/")} <span className="ml-2 text-xs font-semibold text-muted">{day.rows.length} registro(s) carregado(s)</span></th></tr>
            {day.rows.map((row) => <tr key={row.id} data-justification-id={row.id}>
              <td className="px-4 py-3"><p className="font-bold text-navy-950">{row.employeeName}</p><p className="text-xs font-semibold text-muted">{row.wbLogin}</p></td>
              <td className="px-4 py-3 font-bold">{row.date}</td>
              <td className="px-4 py-3">{row.lob} · {row.classification}</td>
              <td className="px-4 py-3">{row.supervisor}</td>
              <td className="px-4 py-3">{row.plannedSlot}</td>
              <td className="px-4 py-3 font-extrabold text-amber-700">{row.capturedDuration}<p className="text-xs font-semibold text-muted">{row.durationSource}</p></td>
              <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
              <td className="px-4 py-3">{row.status === "Pendente" ? <textarea
                aria-label={`Justificativa de aderência de ${row.employeeName}`} value={drafts[row.id] ?? row.justification}
                onChange={(event) => setDrafts((current) => ({ ...current, [row.id]: event.target.value }))}
                placeholder="Explique a baixa aderência ao Cronograma"
                className="min-h-20 w-80 rounded-lg border border-border p-2.5 text-sm outline-none focus:border-blue-400" />
                : <p className="max-w-sm whitespace-pre-wrap font-semibold">{row.justification}</p>}</td>
              <td className="px-4 py-3">{row.status === "Pendente" ? <button type="button" disabled={savingId === row.id} onClick={() => void submit(row)}
                className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-60">{savingId === row.id ? "Enviando..." : "Enviar justificativa"}</button>
                : <p className="text-xs font-semibold text-muted">{row.answeredBy}<br />{row.answeredAt}</p>}</td>
            </tr>)}
          </Fragment>)}</tbody>
        </table>
      </div> : state.initialized && !state.hasMore && !state.error ? <div className="p-6"><EmptyState title="Nenhuma justificativa encontrada" description="Não há justificativas pendentes ou respondidas para o período e os filtros selecionados." /></div> : null}
      <div ref={sentinel} className="flex min-h-16 items-center justify-center gap-2 px-5 py-4 text-sm font-semibold text-muted" aria-live="polite">
        {state.error ? <div role="alert">{state.error} <button type="button" onClick={() => void feed.loadMore()} className="ml-2 font-bold text-blue-600 underline">Tentar novamente</button></div>
          : state.loading || (validPeriod && !optionState.error && !state.initialized) ? <><Loader2 className="h-4 w-4 animate-spin" />Carregando justificativas...</>
          : state.loadingMore ? <><Loader2 className="h-4 w-4 animate-spin" />Carregando mais justificativas...</>
          : state.initialized && !state.hasMore ? "Todas as justificativas foram carregadas"
          : ready && state.hasMore ? <button type="button" onClick={() => void feed.loadMore()} className="text-blue-600">Carregar mais</button> : null}
      </div>
    </section>
  </>;
}
