"use client";

import { AlertTriangle, CalendarDays, CheckCircle2, Clock, FilePenLine, MonitorCog, RefreshCw, Save, Search, type LucideIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { RealtimeHoursPage } from "@/components/realtime-hours-page";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type WorkspaceTab = "MONITORING" | "ADJUSTMENTS";

type WorkHourRow = {
  id: string;
  employeeName: string;
  wbLogin: string;
  date: string;
  lob: string;
  supervisor: string;
  shift: string;
  plannedHours: number;
  effectiveHours: number;
  status: string;
  adjustmentStatus: string;
};

type WorkHoursPayload = {
  data: WorkHourRow[];
  error?: string;
  message?: string;
};

export function RealtimeHoursWorkspacePage({
  canManageMappings,
  canRequestAdjustments
}: {
  canManageMappings: boolean;
  canRequestAdjustments: boolean;
}) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("MONITORING");

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-white p-2 shadow-soft">
        <div className="flex flex-wrap items-center gap-2">
          <WorkspaceTabButton active={activeTab === "MONITORING"} onClick={() => setActiveTab("MONITORING")} icon={MonitorCog} label="Monitoramento" />
          {canRequestAdjustments ? (
            <WorkspaceTabButton active={activeTab === "ADJUSTMENTS"} onClick={() => setActiveTab("ADJUSTMENTS")} icon={FilePenLine} label="Ajustes" />
          ) : null}
        </div>
      </div>

      {activeTab === "MONITORING" ? (
        <RealtimeHoursPage canManageMappings={canManageMappings} />
      ) : (
        <RealtimeHoursAdjustmentsPanel />
      )}
    </div>
  );
}

function WorkspaceTabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-black transition",
        active ? "bg-blue-600 text-white shadow-soft" : "bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-navy-950"
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function RealtimeHoursAdjustmentsPanel() {
  const [date, setDate] = useState(todayInputDate());
  const [search, setSearch] = useState("");
  const [payload, setPayload] = useState<WorkHoursPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [requestedActualHours, setRequestedActualHours] = useState("");
  const [reason, setReason] = useState("Sistema não capturou horário");
  const [justification, setJustification] = useState("");

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ startDate: date, endDate: date, page: "1", limit: "100" });
      const response = await fetch(`/api/work-hours?${params.toString()}`, { cache: "no-store" });
      const body = await response.json() as WorkHoursPayload;
      if (!response.ok || body.error) throw new Error(body.message || body.error || "Não foi possível carregar horas operacionais.");
      setPayload(body);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar horas operacionais.");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const rows = useMemo(() => {
    const normalizedSearch = normalizeText(search);
    const baseRows = payload?.data ?? [];
    if (!normalizedSearch) return baseRows;
    return baseRows.filter((row) => normalizeText([
      row.employeeName,
      row.wbLogin,
      row.lob,
      row.supervisor,
      row.shift,
      row.status,
      row.adjustmentStatus
    ].join(" ")).includes(normalizedSearch));
  }, [payload?.data, search]);

  const selectedRow = rows.find((row) => row.id === selectedRecordId) ?? null;

  useEffect(() => {
    if (selectedRow) setRequestedActualHours(formatHoursValue(selectedRow.effectiveHours));
  }, [selectedRow]);

  async function submitAdjustment() {
    if (!selectedRow) {
      setError("Selecione um registro para solicitar ajuste.");
      return;
    }
    if (!requestedActualHours.trim() || !reason.trim() || !justification.trim()) {
      setError("Informe nova hora solicitada, motivo e justificativa.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/work-hours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workHourRecordId: selectedRow.id,
          requestedActualHours,
          reason,
          justification
        })
      });
      const body = await response.json() as { success?: boolean; message?: string; error?: string };
      if (!response.ok || body.success === false) throw new Error(body.message || body.error || "Não foi possível solicitar ajuste.");
      setSuccess("Ajuste solicitado para análise de WFM/Admin.");
      setSelectedRecordId("");
      setRequestedActualHours("");
      setJustification("");
      await loadRows();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível solicitar ajuste.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Captura de Horas"
        description="Solicitação de ajuste a partir dos registros oficiais de horas operacionais."
        icon={FilePenLine}
        actions={
          <button type="button" onClick={loadRows} disabled={loading} className="premium-button inline-flex h-9 items-center gap-2 px-3 text-sm font-extrabold disabled:cursor-wait disabled:opacity-70">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Atualizar
          </button>
        }
      />

      <Panel title="Solicitar ajuste">
        <div className="mb-4 grid gap-2.5 lg:grid-cols-[220px_minmax(0,1fr)]">
          <label className="relative block">
            <span className="sr-only">Data</span>
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-600" />
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="premium-control h-10 w-full pl-9 pr-3 text-sm font-black text-navy-950 outline-none" />
          </label>
          <label className="relative block">
            <span className="sr-only">Buscar</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="premium-control h-10 w-full pl-9 pr-3 text-sm font-bold outline-none" placeholder="Buscar por colaborador, WB, LOB, supervisor ou status" />
          </label>
        </div>

        {error ? <AlertMessage tone="red" message={error} /> : null}
        {success ? <AlertMessage tone="green" message={success} /> : null}

        {loading ? (
          <div className="grid min-h-[220px] place-items-center text-sm font-bold text-muted">
            <span className="inline-flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin text-blue-600" />Carregando registros...</span>
          </div>
        ) : !rows.length ? (
          <EmptyState title="Sem registros para ajuste" description="Não há horas operacionais para a data e filtros selecionados." />
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="overflow-x-auto rounded-xl border border-border bg-white">
              <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-slate-50 text-[11px] font-black uppercase tracking-wide text-muted">
                    <th className="w-28 px-3 py-3">Ação</th>
                    <th className="px-3 py-3">Colaborador</th>
                    <th className="px-3 py-3">LOB</th>
                    <th className="px-3 py-3">Planejado</th>
                    <th className="px-3 py-3">Realizado</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Ajuste</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {rows.map((row) => (
                    <tr key={row.id} className={cn("transition-colors hover:bg-blue-50/30", selectedRecordId === row.id && "bg-blue-50/60")}>
                      <td className="px-3 py-3">
                        <button type="button" onClick={() => setSelectedRecordId(row.id)} className={cn("rounded-lg border px-3 py-2 text-xs font-black transition", selectedRecordId === row.id ? "border-blue-600 bg-blue-600 text-white" : "border-blue-100 bg-white text-blue-700 hover:bg-blue-50")}>Selecionar</button>
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-black text-navy-950">{row.employeeName || row.wbLogin}</p>
                        <p className="text-xs font-bold text-muted">{row.wbLogin} · {row.shift || "Sem turno"}</p>
                      </td>
                      <td className="px-3 py-3 font-bold text-slate-700">{row.lob || "-"}</td>
                      <td className="px-3 py-3 font-bold text-slate-700">{formatHoursValue(row.plannedHours)}</td>
                      <td className="px-3 py-3 font-black text-navy-950">{formatHoursValue(row.effectiveHours)}</td>
                      <td className="px-3 py-3 font-bold text-slate-700">{row.status}</td>
                      <td className="px-3 py-3 font-bold text-slate-700">{row.adjustmentStatus || "Sem ajuste"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl border border-border bg-slate-50 p-3">
              <p className="text-sm font-black text-navy-950">Pedido de ajuste</p>
              {selectedRow ? (
                <div className="mt-3 space-y-3">
                  <div className="rounded-lg border border-blue-100 bg-white p-3 text-sm">
                    <p className="font-black text-navy-950">{selectedRow.employeeName || selectedRow.wbLogin}</p>
                    <p className="mt-1 text-xs font-bold text-muted">Atual: {formatHoursValue(selectedRow.effectiveHours)} · Planejado: {formatHoursValue(selectedRow.plannedHours)}</p>
                  </div>
                  <FormField label="Nova hora solicitada">
                    <input value={requestedActualHours} onChange={(event) => setRequestedActualHours(event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold outline-none" placeholder="Ex.: 7:20 ou 7.33" />
                  </FormField>
                  <FormField label="Motivo">
                    <select value={reason} onChange={(event) => setReason(event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold outline-none">
                      <option>Sistema não capturou horário</option>
                      <option>Erro de apontamento</option>
                      <option>Problema técnico</option>
                      <option>Atividade operacional fora do sistema</option>
                      <option>Ajuste manual autorizado</option>
                      <option>Outro</option>
                    </select>
                  </FormField>
                  <FormField label="Justificativa">
                    <textarea value={justification} onChange={(event) => setJustification(event.target.value)} className="premium-control min-h-[110px] w-full px-3 py-2 text-sm font-bold outline-none" placeholder="Descreva o motivo do ajuste para WFM/Admin analisar." />
                  </FormField>
                  <button type="button" onClick={submitAdjustment} disabled={saving} className="premium-button inline-flex h-10 w-full items-center justify-center gap-2 px-3 text-sm font-black disabled:cursor-wait disabled:opacity-70">
                    <Save className="h-4 w-4" />
                    {saving ? "Enviando..." : "Solicitar ajuste"}
                  </button>
                </div>
              ) : (
                <p className="mt-3 text-sm font-bold text-muted">Selecione um registro da lista para abrir o pedido.</p>
              )}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

function AlertMessage({ tone, message }: { tone: "red" | "green"; message: string }) {
  const Icon = tone === "red" ? AlertTriangle : CheckCircle2;
  return (
    <div className={cn("mb-3 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm font-bold", tone === "red" ? "border-red-100 bg-red-50 text-red-700" : "border-emerald-100 bg-emerald-50 text-emerald-700")}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}

function todayInputDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function formatHoursValue(value?: number | null) {
  if (!Number.isFinite(Number(value))) return "-";
  const totalMinutes = Math.round(Number(value) * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.abs(totalMinutes % 60);
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}
