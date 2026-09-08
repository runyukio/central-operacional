"use client";

import { useEffect, useState } from "react";
import { ClipboardList, Loader2, RefreshCw } from "lucide-react";
import { FormInput, apiJson, currentOperationalMonthRange } from "@/components/modules/shared";
import { createClientRequestGate } from "@/lib/client-request-gate";
import { resolveCapturePeriod } from "@/lib/work-hours-capture-period";
import type { AdherenceSummary } from "@/lib/work-hour-adherence-summary";

export function WorkHourJustificationSummary({ active, refreshKey }: { active: boolean; refreshKey: number }) {
  const [period, setPeriod] = useState(currentOperationalMonthRange);
  const [revision, setRevision] = useState(0);
  const [requests] = useState(createClientRequestGate);
  const [state, setState] = useState<{ key: string; data: AdherenceSummary | null; error: string }>({ key: "", data: null, error: "" });
  const query = new URLSearchParams(period).toString();
  const validation = resolveCapturePeriod(period);
  const valid = !("error" in validation);
  const ready = state.key === query && state.data !== null;
  const error = state.key === query ? state.error : "";

  useEffect(() => {
    if (!active || !valid) return;
    const request = requests.begin();
    setState({ key: "", data: null, error: "" });
    apiJson<{ data: AdherenceSummary }>(`/api/work-hours/adherence/summary?${query}`, { signal: request.signal, cache: "no-store" })
      .then((payload) => {
        if (requests.isCurrent(request)) setState({ key: query, data: payload.data, error: "" });
      }).catch((cause) => {
        if (requests.isCurrent(request)) setState({ key: query, data: null, error: cause instanceof Error ? cause.message : "Não foi possível carregar o resumo de justificativas." });
      });
    return () => requests.cancel();
  }, [active, valid, query, revision, refreshKey, requests]);

  // Re-entering this slice or returning from another tab picks up answers made
  // elsewhere, without introducing continuous polling or changing the list feed.
  useEffect(() => {
    if (!active) return;
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [active]);

  if (!active) return null;
  return <section aria-label="Resumo de justificativas" className="space-y-5">
    <div className="card p-5 sm:p-6">
      <div className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] [&_input]:h-12 [&_input]:text-base">
        <FormInput label="Data inicial" type="date" value={period.startDate} onChange={(startDate) => setPeriod((current) => ({ ...current, startDate }))} />
        <FormInput label="Data final" type="date" value={period.endDate} onChange={(endDate) => setPeriod((current) => ({ ...current, endDate }))} />
        <button type="button" disabled={!valid} onClick={() => setRevision((value) => value + 1)} className="h-12 rounded-lg bg-blue-600 px-6 text-sm font-bold text-white disabled:opacity-50">Filtrar</button>
        <button type="button" onClick={() => { setPeriod(currentOperationalMonthRange()); setRevision((value) => value + 1); }} className="premium-control inline-flex h-12 items-center justify-center gap-2 px-5 text-sm font-bold"><RefreshCw className="h-4 w-4" />Limpar filtros</button>
      </div>
      <p className="mt-3 text-sm text-muted">Período inclusivo pela data do turno (Shift Date). Atualiza ao alterar as datas.</p>
      {"error" in validation ? <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{validation.error}</p> : null}
    </div>
    <div className="card overflow-hidden" aria-busy={valid && !ready && !error}>
      <header className="flex items-start gap-3 border-b border-border px-5 py-5 sm:px-6">
        <span className="rounded-xl bg-blue-50 p-2.5 text-blue-600"><ClipboardList aria-hidden="true" className="h-6 w-6" /></span>
        <div><h2 className="text-lg font-extrabold text-navy-950 sm:text-xl">Justificativas pendentes por supervisor</h2>
          <p className="mt-1 text-sm text-muted">Contagem completa do período, pelo supervisor vinculado à pendência.</p></div>
      </header>
      {valid && !ready && !error ? <p role="status" className="flex items-center justify-center gap-3 p-10 text-sm font-semibold text-muted"><Loader2 className="h-5 w-5 animate-spin" />Carregando resumo...</p> : null}
      {error ? <div role="alert" className="space-y-4 p-6 text-center"><p className="text-sm font-semibold text-red-700">{error}</p><button type="button" onClick={() => setRevision((value) => value + 1)} className="premium-control h-11 px-5 text-sm font-bold">Tentar novamente</button></div> : null}
      {valid && ready && state.data ? <AdherenceSummaryTable data={state.data} /> : null}
    </div>
  </section>;
}

export function AdherenceSummaryTable({ data }: { data: AdherenceSummary }) {
  if (!data.total) return <p role="status" className="px-6 py-12 text-center text-sm font-semibold text-muted">Nenhuma justificativa pendente encontrada no período selecionado.</p>;
  return <table className="w-full table-fixed text-left text-sm">
    <caption className="sr-only">Justificativas pendentes por dia e supervisor</caption>
    <thead className="border-b border-border bg-blue-50 text-blue-700">
      <tr><th scope="col" className="px-5 py-4 sm:px-6">Supervisor</th><th scope="col" className="w-28 px-3 py-4 text-center sm:w-44">Quantidade</th></tr>
    </thead>
      {data.days.map((day) => <tbody key={day.date}>
        <tr className="border-y border-border bg-slate-50"><th scope="rowgroup" colSpan={2} className="px-5 py-4 text-base font-extrabold text-navy-950 sm:px-6"><time dateTime={day.date}>{day.date.split("-").reverse().join("/")}</time></th></tr>
        {day.supervisors.map((supervisor) => <tr key={supervisor.id} className="border-b border-border">
          <th scope="row" className="break-words px-5 py-4 font-semibold text-navy-950 sm:px-6">{supervisor.name}</th>
          <td className="px-3 py-4 text-center font-bold tabular-nums text-navy-950">{supervisor.count.toLocaleString("pt-BR")}</td>
        </tr>)}
        <tr className="border-b border-border bg-blue-50/50 font-bold text-navy-950"><th scope="row" className="px-5 py-4 sm:px-6">Total do dia</th><td className="px-3 py-4 text-center tabular-nums">{day.total.toLocaleString("pt-BR")}</td></tr>
      </tbody>)}
    <tfoot className="border-t-2 border-blue-200 bg-blue-50 text-base font-extrabold text-blue-700"><tr><th scope="row" className="px-5 py-5 sm:px-6">Total geral do período</th><td className="px-3 py-5 text-center tabular-nums">{data.total.toLocaleString("pt-BR")}</td></tr></tfoot>
  </table>;
}
