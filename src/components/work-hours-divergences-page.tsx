"use client";

import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader, StatusBadge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type DivergenceAction = {
  value: "CONFIRM_PRESENCE" | "CONFIRM_ATTENDANCE" | "CONFIRM_ABSENCE" | "CONFIRM_DAY_OFF" | "KEEP_PENDING";
  label: string;
};

type DivergenceRow = {
  id: string;
  employeeName: string;
  wbLogin: string;
  date: string;
  slot: string;
  lob: string;
  classification: string;
  scheduleStatus: string;
  capturedDuration: string;
  proposedHours: string;
  reasons: string[];
  actions: DivergenceAction[];
  supervisor: string;
};

export function WorkHoursDivergencesPage() {
  const [rows, setRows] = useState<DivergenceRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState<{ id: string; action: DivergenceAction } | null>(null);
  const [saving, setSaving] = useState(false);
  const loadRows = useCallback(async (value: string) => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/work-hours/capture-import/divergences?${value}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar as divergências.");
      setRows(payload.data ?? []);
    } catch (error) {
      setRows([]);
      setMessage(error instanceof Error ? error.message : "Não foi possível carregar as divergências.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get("startDate") || !params.get("endDate")) {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      params.set("startDate", `${year}-${String(month + 1).padStart(2, "0")}-01`);
      params.set("endDate", `${year}-${String(month + 1).padStart(2, "0")}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, "0")}`);
    }
    setQuery(params.toString());
  }, []);

  useEffect(() => {
    if (!query) return;
    void loadRows(query);
  }, [loadRows, query]);

  const returnUrl = useMemo(() => `/horas-operacionais${query ? `?${query}` : ""}`, [query]);

  async function resolveDivergence() {
    if (!confirming || confirming.action.value === "KEEP_PENDING") {
      setConfirming(null);
      setMessage("A divergência foi mantida pendente e continuará aparecendo nas próximas consultas.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/work-hours/capture-import/divergences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: confirming.id, action: confirming.action.value, confirmed: true })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível resolver a divergência.");
      setRows((current) => current.filter((row) => row.id !== confirming.id));
      setConfirming(null);
      setMessage(`${confirming.action.label} registrada com sucesso. Cronograma e Horas Operacionais foram atualizados juntos.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível resolver a divergência.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Divergências da Captura de Horas"
        description="Revise somente os casos que não puderam ser processados com segurança. Abrir esta tela não altera nenhum dado."
        icon={AlertTriangle}
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => loadRows(query)} className="flex h-11 items-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-bold text-navy-950 shadow-soft">
              <RefreshCw className="h-4 w-4" /> Atualizar
            </button>
            <Link href={returnUrl} className="flex h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white shadow-soft">
              <ArrowLeft className="h-4 w-4" /> Voltar para Horas Operacionais
            </Link>
          </div>
        }
      />

      {message ? <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-800">{message}</div> : null}

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-extrabold text-navy-950">Pendências do período</h2>
            <p className="text-sm font-semibold text-muted">{loading ? "Carregando..." : `${rows.length} divergência(s) aguardando decisão explícita`}</p>
          </div>
          <StatusBadge status={rows.length ? "Revisão necessária" : "Sem divergências"} />
        </div>

        <div className="max-h-[calc(100vh-280px)] space-y-4 overflow-y-auto bg-slate-50/60 p-5">
          {!loading && !rows.length ? (
            <div className="grid min-h-56 place-items-center rounded-xl border border-dashed border-border bg-white p-8 text-center">
              <div>
                <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
                <p className="mt-3 text-lg font-extrabold text-navy-950">Nenhuma divergência pendente</p>
                <p className="mt-1 text-sm font-semibold text-muted">Todos os casos do período foram resolvidos ou processados automaticamente.</p>
              </div>
            </div>
          ) : null}

          {rows.map((row) => (
            <article key={row.id} className="rounded-xl border border-border bg-white p-5 shadow-soft" style={{ contentVisibility: "auto", containIntrinsicSize: "0 420px" }}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-extrabold text-navy-950">{row.employeeName}</h3>
                  <p className="text-sm font-semibold text-muted">{row.wbLogin}</p>
                </div>
                <StatusBadge status={row.scheduleStatus} />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <CompactField label="Data" value={row.date} />
                <CompactField label="Slot previsto" value={row.slot} />
                <CompactField label="LOB / classificação" value={`${row.lob} · ${row.classification}`} />
                <CompactField label="Status no Cronograma" value={row.scheduleStatus} />
                <CompactField label="Duração original" value={row.capturedDuration} emphasis />
                <CompactField label="Horas propostas" value={row.proposedHours} emphasis />
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-xs font-black uppercase tracking-wide text-red-700">Motivo da divergência</p>
                  <ul className="mt-2 space-y-1 text-sm font-semibold text-red-900">
                    {row.reasons.map((reason) => <li key={reason}>• {reason}</li>)}
                  </ul>
                </div>
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                  <p className="text-xs font-black uppercase tracking-wide text-blue-700">Ação sugerida</p>
                  <p className="mt-2 text-sm font-semibold text-blue-900">{row.actions.map((action) => action.label).join(" ou ")}</p>
                </div>
              </div>

              {confirming?.id === row.id ? (
                <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
                  <p className="font-extrabold text-amber-950">Confirmar “{confirming.action.label}”?</p>
                  <p className="mt-1 text-sm font-semibold text-amber-900">A alteração será aplicada de forma atômica ao Cronograma e às Horas Operacionais.</p>
                  <div className="mt-3 flex gap-2">
                    <button disabled={saving} onClick={resolveDivergence} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{saving ? "Salvando..." : "Confirmar ação"}</button>
                    <button disabled={saving} onClick={() => setConfirming(null)} className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-bold">Cancelar</button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  {row.actions.map((action) => (
                    <button
                      key={action.value}
                      onClick={() => action.value === "KEEP_PENDING"
                        ? setMessage("A divergência permanece pendente e continuará aparecendo nas próximas consultas.")
                        : setConfirming({ id: row.id, action })}
                      className={cn(
                        "rounded-lg px-4 py-2.5 text-sm font-bold",
                        action.value === "KEEP_PENDING" ? "border border-border bg-white text-navy-950" : "bg-blue-600 text-white"
                      )}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function CompactField({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-slate-50 px-3 py-2.5">
      <p className="text-[11px] font-black uppercase tracking-wide text-muted">{label}</p>
      <p className={cn("mt-1 text-sm font-bold text-navy-950", emphasis && "text-base")}>{value}</p>
    </div>
  );
}
