"use client";

import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { resolveCapturePeriod, type CapturePeriod } from "@/lib/work-hours-capture-period";
import { CAPTURE_DIVERGENCE_ACTIONS, captureDivergenceActionLabel } from "@/lib/work-hours-capture-integration-core";
import {
  EMPTY_CAPTURE_REVIEW_FILTERS, captureReviewDecisions, captureReviewOptions, filterCaptureReviewRows,
  type CaptureReviewChoices, type CaptureReviewFilters, type CaptureReviewRow, type CaptureRegistrationWarning
} from "@/lib/work-hours-capture-review";

type DivergenceRow = CaptureReviewRow & {
  employeeName: string; wbLogin: string; date: string; slot: string; classification: string;
  scheduleStatus: string; capturedDuration: string; proposedHours: string; reasons: string[];
};

export function WorkHoursDivergencesPage() {
  const [rows, setRows] = useState<DivergenceRow[]>([]);
  const [registrationWarnings, setRegistrationWarnings] = useState<CaptureRegistrationWarning[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [period, setPeriod] = useState<CapturePeriod | null>(null);
  const [returnQuery, setReturnQuery] = useState("");
  const [filters, setFilters] = useState<CaptureReviewFilters>(EMPTY_CAPTURE_REVIEW_FILTERS);
  const [choices, setChoices] = useState<CaptureReviewChoices>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resolved = resolveCapturePeriod({ shiftDate: params.get("shiftDate") ?? undefined,
      startDate: params.get("startDate") ?? undefined, endDate: params.get("endDate") ?? undefined });
    setReturnQuery(new URLSearchParams(params.get("returnQuery") ?? "").toString());
    if ("error" in resolved) {
      setMessage(`${resolved.error} Volte para Horas Operacionais e selecione o período da importação.`);
      setLoading(false);
      return;
    }
    setPeriod(resolved.period);
    const controller = new AbortController();
    void loadRows(resolved.period, controller.signal);
    return () => controller.abort();
  }, []);

  async function loadRows(selectedPeriod: CapturePeriod, signal?: AbortSignal) {
    setLoading(true);
    setLoadFailed(false);
    setMessage("");
    try {
      const response = await fetch(`/api/work-hours/capture-import/divergences?${new URLSearchParams(selectedPeriod)}`, { cache: "no-store", signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar as divergências.");
      if (!signal?.aborted) {
        setRows(payload.data ?? []);
        setRegistrationWarnings(payload.registrationWarnings ?? []);
      }
    } catch (error) {
      if (!signal?.aborted) {
        setLoadFailed(true);
        setMessage(error instanceof Error ? error.message : "Não foi possível carregar as divergências.");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  const visible = useMemo(() => filterCaptureReviewRows(rows, filters), [rows, filters]);
  const visibleWarnings = useMemo(() => filterCaptureReviewRows(registrationWarnings, filters), [registrationWarnings, filters]);
  const options = useMemo(() => {
    const allRows = [...rows, ...registrationWarnings];
    return { lob: captureReviewOptions(allRows, "lob"), supervisor: captureReviewOptions(allRows, "supervisor"), shift: captureReviewOptions(allRows, "shift") };
  }, [rows, registrationWarnings]);
  const decisions = useMemo(() => captureReviewDecisions(rows, choices), [rows, choices]);
  const hiddenDecisions = decisions.length - visible.filter((row) => choices[row.id]).length;
  const returnUrl = `/horas-operacionais${returnQuery ? `?${returnQuery}` : ""}`;

  async function applyDecisions() {
    if (!decisions.length || saving || !period) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/work-hours/capture-import/divergences", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...period, decisions, confirmed: true })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível aplicar as decisões.");
      const resolved = new Set<string>(payload.data.results.filter((item: { status: string }) => item.status === "RESOLVED").map((item: { id: string }) => item.id));
      const revisions = new Map<string, string>(payload.data.results.map((item: { id: string; revision: string }) => [item.id, item.revision]));
      setRows((current) => current.filter((row) => !resolved.has(row.id)).map((row) => ({ ...row, revision: revisions.get(row.id) ?? row.revision })));
      setChoices({});
      setMessage(`${payload.data.resolved} divergência(s) encerrada(s); ${payload.data.pending} mantida(s) pendente(s). Todas as decisões foram registradas.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível aplicar as decisões.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="Divergências da Captura de Horas" description={`Período (Shift Date): ${period ? `${period.startDate} até ${period.endDate}` : "não selecionado"} · Confira bloqueios de cadastro e divergências de presença.`} icon={AlertTriangle} actions={
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={loading || saving || !period || decisions.length > 0} onClick={() => { if (period) void loadRows(period); }}
            title={decisions.length ? "Aplique suas decisões antes de atualizar." : "Atualizar divergências"}
            className="flex h-11 items-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-bold text-navy-950 disabled:opacity-50">
            <RefreshCw className="h-4 w-4" /> Atualizar
          </button>
          <Link href={returnUrl} className="flex h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white">
            <ArrowLeft className="h-4 w-4" /> Voltar para Horas Operacionais
          </Link>
        </div>
      } />
      {message ? <div role="status" className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-800">{message}</div> : null}
      <section className="card mb-4 space-y-3 p-4" aria-label="Filtros de visualização">
        {(["lob", "supervisor", "shift"] as const).map((key) => (
          <Slicer key={key} label={{ lob: "LOB", supervisor: "Supervisor", shift: "Turno" }[key]} options={options[key]} value={filters[key]}
            onChange={(value) => setFilters((current) => ({ ...current, [key]: value }))} />
        ))}
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3 text-sm">
          <span className="text-muted">{loading ? "Carregando..." : `${visible.length} de ${rows.length} divergência(s) · ${visibleWarnings.length} de ${registrationWarnings.length} bloqueio(s) de cadastro`}</span>
          <button type="button" onClick={() => setFilters(EMPTY_CAPTURE_REVIEW_FILTERS)} className="font-bold text-blue-600">Limpar filtros</button>
        </div>
      </section>
      {!loading && !loadFailed && registrationWarnings.length > 0 ? <section className="mb-4 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4" aria-label="Bloqueios de cadastro">
        <div className="flex items-start gap-3" role="status">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div>
            <h2 className="font-extrabold text-amber-950">Atenção: parceiro(s) não processado(s)</h2>
            <p className="mt-1 text-sm text-amber-900">Estes cadastros impedem a verificação e importação de horas nas datas abaixo. Isso não significa ausência e não altera horas já salvas.</p>
            <p className="mt-1 text-sm font-semibold text-amber-900">Corrija a data real de Go Live em Mapa de Parceiros → Detalhes → Editar. Depois, volte e importe novamente o período em Horas Operacionais. O botão Atualizar apenas consulta os bloqueios.</p>
          </div>
        </div>
        {!visibleWarnings.length ? <p className="text-sm font-semibold text-amber-900">Os bloqueios estão ocultos pelos filtros selecionados. Limpe os filtros para conferi-los.</p> : null}
        {visibleWarnings.map((warning) => <article key={warning.id} className="card p-4" style={{ contentVisibility: "auto", containIntrinsicSize: "0 190px" }}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h3 className="font-extrabold text-navy-950">{warning.employeeName} <span className="text-sm font-semibold text-muted">· {warning.wbLogin}</span></h3>
            <Link href={`/mapa-funcionarios?${new URLSearchParams({ search: warning.wbLogin })}`} target="_blank" rel="noopener noreferrer"
              aria-label={`Abrir cadastro de ${warning.wbLogin} em nova aba`}
              className="rounded-lg border border-border px-3 py-2 text-sm font-bold text-blue-600">Abrir cadastro ↗</Link>
          </div>
          <p className="mt-2 text-sm font-bold text-amber-800">Não processado: {warning.reason}</p>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <CompactField label="Shift Date" value={warning.date} />
            <CompactField label="Slot previsto" value={warning.slot} />
            <CompactField label="LOB" value={warning.lob} />
            <CompactField label="Supervisor" value={warning.supervisor} />
            <CompactField label="Turno" value={warning.shift} />
          </dl>
        </article>)}
      </section> : null}
      <section className="space-y-3" aria-label="Divergências do período">
        {!loading && !loadFailed && period && !visible.length ? <div className="card p-8 text-center">
          {registrationWarnings.length ? <AlertTriangle className="mx-auto h-8 w-8 text-amber-600" /> : <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />}
          <p className="mt-2 font-bold text-navy-950">{rows.length ? "Nenhuma divergência de presença nos filtros selecionados." : "Nenhuma divergência de presença pendente neste período."}</p>
          {registrationWarnings.length ? <p className="mt-1 text-sm text-muted">Ainda existem bloqueios de cadastro para corrigir acima.</p> : null}
        </div> : null}
        {visible.map((row) => (
          <article key={row.id} className="card p-4" style={{ contentVisibility: "auto", containIntrinsicSize: "0 290px" }}>
            <h2 className="font-extrabold text-navy-950">{row.employeeName} <span className="text-sm font-semibold text-muted">· {row.wbLogin}</span></h2>
            <dl className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
              <CompactField label="Shift Date" value={row.date} />
              <CompactField label="Slot previsto" value={row.slot} />
              <CompactField label="LOB / classificação" value={`${row.lob} · ${row.classification}`} />
              <CompactField label="Supervisor" value={row.supervisor} />
              <CompactField label="Turno" value={row.shift} />
              <CompactField label="Status atual" value={row.scheduleStatus} />
              <CompactField label="Captura original" value={row.capturedDuration} />
              <CompactField label="Horas Operacionais propostas" value={row.proposedHours} />
            </dl>
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
              <span className="font-bold">Motivo: </span>{row.reasons.join(" ")}
            </p>
            <fieldset disabled={saving} className="mt-3 flex flex-wrap gap-2">
              <legend className="sr-only">Decisão para {row.employeeName}</legend>
              {CAPTURE_DIVERGENCE_ACTIONS.map((action) => {
                const selected = (choices[row.id]?.action ?? "KEEP_PENDING") === action;
                return <label key={action} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold",
                  selected ? "border-blue-500 bg-blue-50 text-blue-800" : "border-border text-navy-950")}>
                  <input type="radio" name={`decision-${row.id}`} value={action} checked={selected}
                    onChange={() => setChoices((current) => ({ ...current, [row.id]: { action, revision: row.revision } }))}
                    onClick={() => { if (selected && !choices[row.id]) setChoices((current) => ({ ...current, [row.id]: { action, revision: row.revision } })); }}
                    className="accent-blue-600" />
                  {captureDivergenceActionLabel(action)}
                </label>;
              })}
            </fieldset>
          </article>
        ))}
      </section>
      <div className="card sticky bottom-3 mt-4 flex flex-wrap items-center justify-between gap-3 p-4 shadow-lg">
        <p className="text-sm font-semibold text-muted">{decisions.length} decisão(ões) selecionada(s){hiddenDecisions ? ` · ${hiddenDecisions} oculta(s) pelos filtros, também serão aplicadas` : ""}</p>
        <button type="button" disabled={saving || loading || !decisions.length} onClick={() => void applyDecisions()}
          className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{saving ? "Aplicando..." : "Aplicar alterações"}</button>
      </div>
    </div>
  );
}

function Slicer({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (value: string) => void }) {
  return <fieldset className="flex flex-wrap items-center gap-1.5">
    <legend className="mb-1 text-xs font-extrabold uppercase tracking-wide text-muted">{label}</legend>
    {[{ value: "", label: "Todos" }, ...options.map((item) => ({ value: item, label: item }))].map((option) => (
      <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}
        className={cn("rounded-md px-3 py-1.5 text-xs font-bold", value === option.value ? "bg-blue-600 text-white" : "bg-slate-100 text-navy-950")}>{option.label}</button>
    ))}
  </fieldset>;
}

function CompactField({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[11px] font-bold uppercase tracking-wide text-muted">{label}</dt><dd className="mt-1 text-sm font-semibold text-navy-950">{value}</dd></div>;
}
