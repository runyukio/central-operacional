"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { ClipboardList, Loader2, RefreshCw } from "lucide-react";
import { FormInput, apiJson } from "@/components/modules/shared";
import { createClientRequestGate } from "@/lib/client-request-gate";
import { resolveCapturePeriod, type CapturePeriod } from "@/lib/work-hours-capture-period";
import { adherenceDateLabel, adherenceImportTime } from "@/lib/work-hour-adherence-chart";
import type { AdherenceSummaryResponse } from "@/lib/work-hour-adherence-summary";

const Chart = lazy(() => import("./work-hour-justification-chart"));
const Loading = () => <p role="status" className="flex items-center justify-center gap-3 py-12 text-sm font-semibold text-muted"><Loader2 className="h-5 w-5 animate-spin" />Carregando resumo...</p>;

export function WorkHourJustificationSummary({ active, refreshKey }: { active: boolean; refreshKey: number }) {
  const [draft, setDraft] = useState({ startDate: "", endDate: "" });
  const [applied, setApplied] = useState<CapturePeriod | null>(null);
  const [revision, setRevision] = useState(0);
  const [requests] = useState(createClientRequestGate);
  const [state, setState] = useState<AdherenceSummaryResponse & { loading: boolean; error: string }>({ data: null, latestImport: null, loading: true, error: "" });
  const query = applied ? new URLSearchParams(applied).toString() : "";
  const validation = resolveCapturePeriod(draft);
  const valid = !("error" in validation);

  useEffect(() => {
    if (!active) return;
    const request = requests.begin();
    setState((current) => ({ ...current, loading: true, error: "" }));
    apiJson<AdherenceSummaryResponse>(`/api/work-hours/adherence/summary${query ? `?${query}` : ""}`, { signal: request.signal, cache: "no-store" })
      .then((payload) => {
        if (!requests.isCurrent(request)) return;
        setState({ ...payload, loading: false, error: "" });
        if (!query && payload.data) setDraft({ startDate: payload.data.startDate, endDate: payload.data.endDate });
      }).catch((cause) => {
        if (requests.isCurrent(request)) setState((current) => ({ ...current, data: null, loading: false,
          error: cause instanceof Error ? cause.message : "Não foi possível carregar o resumo de justificativas." }));
      });
    return () => requests.cancel();
  }, [active, query, revision, refreshKey, requests]);

  useEffect(() => {
    if (!active) return;
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [active]);

  if (!active) return null;
  const dirty = state.data && (draft.startDate !== state.data.startDate || draft.endDate !== state.data.endDate);
  return <section aria-label="Resumo de justificativas" className="card mx-auto w-full max-w-[1200px] overflow-hidden lg:w-[80%]">
    <header className="flex items-start gap-3 border-b border-border px-5 py-5 sm:px-6">
      <span className="rounded-xl bg-blue-50 p-2.5 text-blue-600"><ClipboardList aria-hidden="true" className="h-6 w-6" /></span>
      <div><h2 className="text-lg font-extrabold text-navy-950 sm:text-xl">Justificativas pendentes por supervisor</h2>
        <p className="mt-1 text-sm text-muted">{state.latestImport
          ? <>Última importação: <time dateTime={state.latestImport.importedAt}>{adherenceImportTime(state.latestImport.importedAt)}</time> (São Paulo) · Shift Date {adherenceDateLabel(state.latestImport.shiftDate)}</>
          : state.loading ? "Consultando a última importação concluída..." : "Nenhuma importação concluída da Captura de Horas encontrada."}</p>
      </div>
    </header>
    <div className="border-b border-border p-5 sm:p-6">
      <div className="grid items-end gap-3 sm:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] [&_input]:h-12">
        <FormInput label="Data inicial" type="date" disabled={state.loading} value={draft.startDate} onChange={(startDate) => setDraft((current) => ({ ...current, startDate }))} />
        <FormInput label="Data final" type="date" disabled={state.loading} value={draft.endDate} onChange={(endDate) => setDraft((current) => ({ ...current, endDate }))} />
        <button type="button" disabled={!valid || state.loading} onClick={() => { setApplied({ ...draft }); setRevision((value) => value + 1); }} className="h-12 rounded-lg bg-blue-600 px-5 text-sm font-bold text-white disabled:opacity-50">Aplicar período</button>
        <button type="button" disabled={state.loading} onClick={() => { setApplied(null); setRevision((value) => value + 1); }} className="premium-control inline-flex h-12 items-center justify-center gap-2 px-4 text-sm font-bold disabled:opacity-50"><RefreshCw className="h-4 w-4 shrink-0" />Última importação</button>
      </div>
      <p className="mt-3 text-xs text-muted">Período inclusivo pelo Shift Date. Visualização informativa, sem alteração de horas ou justificativas.</p>
      {dirty && valid ? <p role="status" className="mt-2 text-xs font-semibold text-blue-700">Clique em Aplicar período para atualizar o gráfico.</p> : null}
      {!valid && (draft.startDate || draft.endDate) ? <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{"error" in validation ? validation.error.replace("por importação", "por consulta") : ""}</p> : null}
    </div>
    <div className="min-h-[600px] p-5 sm:p-6" aria-busy={state.loading}>
      {state.loading ? <Loading /> : state.error ? <div role="alert" className="space-y-4 py-6 text-center"><p className="text-sm font-semibold text-red-700">{state.error}</p><button type="button" onClick={() => setRevision((value) => value + 1)} className="premium-control h-11 px-5 text-sm font-bold">Tentar novamente</button></div>
        : state.data ? <Suspense fallback={<Loading />}><Chart data={state.data} /></Suspense>
        : <p role="status" className="py-8 text-center text-sm text-muted">Ainda não há uma importação concluída para abrir automaticamente. Selecione um período para consultar as pendências existentes.</p>}
    </div>
  </section>;
}
