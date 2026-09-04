"use client";

import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { CAPTURE_DIVERGENCE_ACTIONS, captureDivergenceActionLabel } from "@/lib/work-hours-capture-integration-core";
import {
  EMPTY_CAPTURE_REVIEW_FILTERS, captureReviewDecisions, captureReviewOptions, filterCaptureReviewRows,
  type CaptureReviewChoices, type CaptureReviewFilters, type CaptureReviewRow
} from "@/lib/work-hours-capture-review";

type DivergenceRow = CaptureReviewRow & {
  employeeName: string; wbLogin: string; date: string; slot: string; classification: string;
  scheduleStatus: string; capturedDuration: string; proposedHours: string; reasons: string[];
};

export function WorkHoursDivergencesPage() {
  const [rows, setRows] = useState<DivergenceRow[]>([]);
  const [shiftDate, setShiftDate] = useState("");
  const [returnQuery, setReturnQuery] = useState("");
  const [filters, setFilters] = useState<CaptureReviewFilters>(EMPTY_CAPTURE_REVIEW_FILTERS);
  const [choices, setChoices] = useState<CaptureReviewChoices>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const date = params.get("shiftDate") || (params.get("startDate") === params.get("endDate") ? params.get("startDate") : "");
    setReturnQuery(new URLSearchParams(params.get("returnQuery") ?? "").toString());
    if (!date) {
      setMessage("Volte para Horas Operacionais e selecione o Shift Date da importação.");
      setLoading(false);
      return;
    }
    setShiftDate(date);
    const controller = new AbortController();
    void loadRows(date, controller.signal);
    return () => controller.abort();
  }, []);

  async function loadRows(date: string, signal?: AbortSignal) {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/work-hours/capture-import/divergences?shiftDate=${encodeURIComponent(date)}`, { cache: "no-store", signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar as divergências.");
      if (!signal?.aborted) setRows(payload.data ?? []);
    } catch (error) {
      if (!signal?.aborted) setMessage(error instanceof Error ? error.message : "Não foi possível carregar as divergências.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  const visible = useMemo(() => filterCaptureReviewRows(rows, filters), [rows, filters]);
  const options = useMemo(() => ({
    lob: captureReviewOptions(rows, "lob"), supervisor: captureReviewOptions(rows, "supervisor"), shift: captureReviewOptions(rows, "shift")
  }), [rows]);
  const decisions = useMemo(() => captureReviewDecisions(rows, choices), [rows, choices]);
  const hiddenDecisions = decisions.length - visible.filter((row) => choices[row.id]).length;
  const returnUrl = `/horas-operacionais${returnQuery ? `?${returnQuery}` : ""}`;

  async function applyDecisions() {
    if (!decisions.length || saving) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/work-hours/capture-import/divergences", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftDate, decisions, confirmed: true })
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
      <PageHeader title="Divergências da Captura de Horas" description={`Shift Date: ${shiftDate || "não selecionado"} · Selecione as decisões e aplique ao final.`} icon={AlertTriangle} actions={
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={loading || saving || !shiftDate || decisions.length > 0} onClick={() => void loadRows(shiftDate)}
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
          <span className="text-muted">{loading ? "Carregando..." : `${visible.length} de ${rows.length} divergência(s)`}</span>
          <button type="button" onClick={() => setFilters(EMPTY_CAPTURE_REVIEW_FILTERS)} className="font-bold text-blue-600">Limpar filtros</button>
        </div>
      </section>
      <section className="space-y-3" aria-label="Divergências do Shift Date">
        {!loading && !visible.length ? <div className="card p-8 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
          <p className="mt-2 font-bold text-navy-950">{rows.length ? "Nenhuma divergência nos filtros selecionados." : "Nenhuma divergência pendente neste Shift Date."}</p>
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
