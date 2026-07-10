"use client";

import { AlertTriangle, CalendarDays, CheckCircle2, FilePenLine, MonitorCog, RefreshCw, Save, Search, type LucideIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { RealtimeHoursPage } from "@/components/realtime-hours-page";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type WorkspaceTab = "MONITORING" | "ADJUSTMENTS";

type RealtimeHoursTimelineRow = {
  key: string;
  hostname: string;
  windowsUser: string;
  wbLogin: string;
  employeeId: string;
  employeeName: string;
  lob: string;
  shift: string;
  activeMs: number;
  noActivityMs: number;
  sessionCount: number;
};

type RealtimeHoursTimelinePayload = {
  success?: boolean;
  rows?: RealtimeHoursTimelineRow[];
  error?: string;
  message?: string;
};

type RealtimeHoursAdjustmentRow = {
  id: string;
  rowKey: string;
  employeeName: string;
  wbLogin: string;
  hostname: string;
  windowsUser: string;
  currentActiveHours: string;
  requestedActiveHours: string;
  reason: string;
  justification: string;
  requestedByName: string;
  requestedByEmail: string;
  reviewedByName: string;
  reviewedAt: string;
  rejectionReason: string;
  status: string;
  createdAt: string;
};

type RealtimeHoursAdjustmentsPayload = {
  success?: boolean;
  data?: RealtimeHoursAdjustmentRow[];
  error?: string;
  message?: string;
};

export function RealtimeHoursWorkspacePage({
  canManageMappings,
  canRequestAdjustments,
  canApproveAdjustments
}: {
  canManageMappings: boolean;
  canRequestAdjustments: boolean;
  canApproveAdjustments: boolean;
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
        <RealtimeHoursAdjustmentsPanel canApproveAdjustments={canApproveAdjustments} />
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

function RealtimeHoursAdjustmentsPanel({ canApproveAdjustments }: { canApproveAdjustments: boolean }) {
  const [date, setDate] = useState(todayInputDate());
  const [search, setSearch] = useState("");
  const [timelinePayload, setTimelinePayload] = useState<RealtimeHoursTimelinePayload | null>(null);
  const [adjustmentsPayload, setAdjustmentsPayload] = useState<RealtimeHoursAdjustmentsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reviewingId, setReviewingId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectedRowKey, setSelectedRowKey] = useState("");
  const [requestedActiveHours, setRequestedActiveHours] = useState("");
  const [reason, setReason] = useState("Sistema não capturou horário");
  const [justification, setJustification] = useState("");

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ date });
      const [timelineResponse, adjustmentsResponse] = await Promise.all([
        fetch(`/api/realtime-hours/timeline?${params.toString()}`, { cache: "no-store" }),
        fetch(`/api/realtime-hours/adjustments?${params.toString()}`, { cache: "no-store" })
      ]);
      const [timelineBody, adjustmentsBody] = await Promise.all([
        timelineResponse.json() as Promise<RealtimeHoursTimelinePayload>,
        adjustmentsResponse.json() as Promise<RealtimeHoursAdjustmentsPayload>
      ]);
      if (!timelineResponse.ok || timelineBody.error) throw new Error(timelineBody.message || timelineBody.error || "Não foi possível carregar a timeline da captura.");
      if (!adjustmentsResponse.ok || adjustmentsBody.error) throw new Error(adjustmentsBody.message || adjustmentsBody.error || "Não foi possível carregar ajustes da captura.");
      setTimelinePayload(timelineBody);
      setAdjustmentsPayload(adjustmentsBody);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar ajustes da captura.");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const latestAdjustmentByRow = useMemo(() => {
    const lookup = new Map<string, RealtimeHoursAdjustmentRow>();
    for (const adjustment of adjustmentsPayload?.data ?? []) {
      if (!lookup.has(adjustment.rowKey)) lookup.set(adjustment.rowKey, adjustment);
    }
    return lookup;
  }, [adjustmentsPayload?.data]);

  const rows = useMemo(() => {
    const normalizedSearch = normalizeText(search);
    const baseRows = timelinePayload?.rows ?? [];
    if (!normalizedSearch) return baseRows;
    return baseRows.filter((row) => normalizeText([
      row.employeeName,
      row.wbLogin,
      row.hostname,
      row.windowsUser,
      row.lob,
      row.shift
    ].join(" ")).includes(normalizedSearch));
  }, [timelinePayload?.rows, search]);

  const selectedRow = rows.find((row) => row.key === selectedRowKey) ?? null;

  useEffect(() => {
    if (selectedRow) setRequestedActiveHours(formatDurationMs(selectedRow.activeMs));
  }, [selectedRow]);

  async function submitAdjustment() {
    if (!selectedRow) {
      setError("Selecione um registro da captura para solicitar ajuste.");
      return;
    }
    if (!requestedActiveHours.trim() || !reason.trim() || !justification.trim()) {
      setError("Informe nova hora solicitada, motivo e justificativa.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/realtime-hours/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          rowKey: selectedRow.key,
          employeeId: selectedRow.employeeId,
          wbLogin: selectedRow.wbLogin,
          hostname: selectedRow.hostname,
          windowsUser: selectedRow.windowsUser,
          requestedActiveHours,
          reason,
          justification
        })
      });
      const body = await response.json() as { success?: boolean; message?: string; error?: string };
      if (!response.ok || body.success === false) throw new Error(body.message || body.error || "Não foi possível solicitar ajuste.");
      setSuccess("Ajuste solicitado na captura e registrado para análise.");
      setSelectedRowKey("");
      setRequestedActiveHours("");
      setJustification("");
      await loadRows();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível solicitar ajuste.");
    } finally {
      setSaving(false);
    }
  }

  async function reviewAdjustment(id: string, action: "APPROVE" | "REJECT") {
    const rejectionReason = action === "REJECT" ? window.prompt("Motivo da recusa")?.trim() ?? "" : "";
    if (action === "REJECT" && !rejectionReason) return;

    setReviewingId(id);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/realtime-hours/adjustments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, rejectionReason })
      });
      const body = await response.json() as { success?: boolean; message?: string; error?: string };
      if (!response.ok || body.success === false) throw new Error(body.message || body.error || "Não foi possível analisar ajuste.");
      setSuccess(action === "APPROVE" ? "Ajuste aprovado. O agente já verá a hora considerada em Minhas Horas." : "Ajuste recusado.");
      await loadRows();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Não foi possível analisar ajuste.");
    } finally {
      setReviewingId("");
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Captura de Horas"
        description="Solicitação de ajuste baseada na timeline capturada pelo servidor Windows."
        icon={FilePenLine}
        actions={
          <button type="button" onClick={loadRows} disabled={loading} className="premium-button inline-flex h-9 items-center gap-2 px-3 text-sm font-extrabold disabled:cursor-wait disabled:opacity-70">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Atualizar
          </button>
        }
      />

      <Panel title="Solicitar ajuste da captura">
        <div className="mb-4 grid gap-2.5 lg:grid-cols-[220px_minmax(0,1fr)]">
          <label className="relative block">
            <span className="sr-only">Data</span>
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-600" />
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="premium-control h-10 w-full pl-9 pr-3 text-sm font-black text-navy-950 outline-none" />
          </label>
          <label className="relative block">
            <span className="sr-only">Buscar</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="premium-control h-10 w-full pl-9 pr-3 text-sm font-bold outline-none" placeholder="Buscar por colaborador, WB, máquina, usuário Windows ou LOB" />
          </label>
        </div>

        {error ? <AlertMessage tone="red" message={error} /> : null}
        {success ? <AlertMessage tone="green" message={success} /> : null}

        {loading ? (
          <div className="grid min-h-[220px] place-items-center text-sm font-bold text-muted">
            <span className="inline-flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin text-blue-600" />Carregando captura...</span>
          </div>
        ) : !rows.length ? (
          <EmptyState title="Sem registros para ajuste" description="Não há linhas de captura para a data e filtros selecionados." />
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="overflow-x-auto rounded-xl border border-border bg-white">
              <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-slate-50 text-[11px] font-black uppercase tracking-wide text-muted">
                    <th className="w-28 px-3 py-3">Ação</th>
                    <th className="px-3 py-3">Colaborador</th>
                    <th className="px-3 py-3">Máquina</th>
                    <th className="px-3 py-3">LOB</th>
                    <th className="px-3 py-3">Tempo ativo</th>
                    <th className="px-3 py-3">Sessões</th>
                    <th className="px-3 py-3">Último ajuste</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {rows.map((row) => {
                    const adjustment = latestAdjustmentByRow.get(row.key);
                    return (
                      <tr key={row.key} className={cn("transition-colors hover:bg-blue-50/30", selectedRowKey === row.key && "bg-blue-50/60")}>
                        <td className="px-3 py-3">
                          <button type="button" onClick={() => setSelectedRowKey(row.key)} className={cn("rounded-lg border px-3 py-2 text-xs font-black transition", selectedRowKey === row.key ? "border-blue-600 bg-blue-600 text-white" : "border-blue-100 bg-white text-blue-700 hover:bg-blue-50")}>Selecionar</button>
                        </td>
                        <td className="px-3 py-3">
                          <p className="font-black text-navy-950">{row.employeeName || row.wbLogin || row.windowsUser || row.hostname}</p>
                          <p className="text-xs font-bold text-muted">{row.wbLogin || "Sem WB"} · {row.shift || "Sem turno"}</p>
                        </td>
                        <td className="px-3 py-3">
                          <p className="font-bold text-slate-700">{row.hostname || "-"}</p>
                          <p className="text-xs font-bold text-muted">{row.windowsUser || "-"}</p>
                        </td>
                        <td className="px-3 py-3 font-bold text-slate-700">{row.lob || "-"}</td>
                        <td className="px-3 py-3 font-black text-navy-950">{formatDurationMs(row.activeMs)}</td>
                        <td className="px-3 py-3 font-bold text-slate-700">{row.sessionCount}</td>
                        <td className="px-3 py-3 font-bold text-slate-700">{adjustment ? `${adjustment.requestedActiveHours} · ${adjustment.status}` : "Sem ajuste"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="space-y-3">
              <div className="rounded-xl border border-border bg-slate-50 p-3">
                <p className="text-sm font-black text-navy-950">Pedido de ajuste</p>
                {selectedRow ? (
                  <div className="mt-3 space-y-3">
                    <div className="rounded-lg border border-blue-100 bg-white p-3 text-sm">
                      <p className="font-black text-navy-950">{selectedRow.employeeName || selectedRow.wbLogin || selectedRow.hostname}</p>
                      <p className="mt-1 text-xs font-bold text-muted">Capturado: {formatDurationMs(selectedRow.activeMs)} · Sessões: {selectedRow.sessionCount}</p>
                    </div>
                    <FormField label="Nova hora solicitada">
                      <input value={requestedActiveHours} onChange={(event) => setRequestedActiveHours(event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold outline-none" placeholder="Ex.: 7:20 ou 7.33" />
                    </FormField>
                    <FormField label="Motivo">
                      <select value={reason} onChange={(event) => setReason(event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold outline-none">
                        <option>Sistema não capturou horário</option>
                        <option>Máquina ficou sem sinal</option>
                        <option>Sessão duplicada ou incorreta</option>
                        <option>Atividade operacional fora do monitoramento</option>
                        <option>Ajuste manual autorizado</option>
                        <option>Outro</option>
                      </select>
                    </FormField>
                    <FormField label="Justificativa">
                      <textarea value={justification} onChange={(event) => setJustification(event.target.value)} className="premium-control min-h-[110px] w-full px-3 py-2 text-sm font-bold outline-none" placeholder="Descreva o motivo do ajuste para análise." />
                    </FormField>
                    <button type="button" onClick={submitAdjustment} disabled={saving} className="premium-button inline-flex h-10 w-full items-center justify-center gap-2 px-3 text-sm font-black disabled:cursor-wait disabled:opacity-70">
                      <Save className="h-4 w-4" />
                      {saving ? "Enviando..." : "Solicitar ajuste"}
                    </button>
                  </div>
                ) : (
                  <p className="mt-3 text-sm font-bold text-muted">Selecione um registro da captura para abrir o pedido.</p>
                )}
              </div>

              <div className="rounded-xl border border-border bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-black text-navy-950">Pedidos recentes</p>
                  <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-black uppercase text-amber-700">
                    {(adjustmentsPayload?.data ?? []).filter((item) => item.status === "EM_ANALISE").length} pendente(s)
                  </span>
                </div>
                <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto pr-1">
                  {(adjustmentsPayload?.data ?? []).length ? (
                    adjustmentsPayload!.data!.map((adjustment) => (
                      <div key={adjustment.id} className="rounded-lg border border-border bg-slate-50 p-2.5 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-black text-navy-950">{adjustment.employeeName || adjustment.wbLogin || adjustment.hostname}</p>
                            <p className="mt-1 font-bold text-slate-600">{adjustment.currentActiveHours} para {adjustment.requestedActiveHours}</p>
                          </div>
                          <StatusBadge status={adjustment.status} />
                        </div>
                        <p className="mt-1 text-muted">{adjustment.reason}</p>
                        <p className="mt-1 text-muted">Solicitado por {adjustment.requestedByName || adjustment.requestedByEmail || "-"}</p>
                        {adjustment.status !== "EM_ANALISE" ? (
                          <p className="mt-1 font-bold text-slate-600">
                            {adjustment.status === "APROVADO" ? "Aprovado" : "Recusado"} por {adjustment.reviewedByName || "-"}
                          </p>
                        ) : null}
                        {adjustment.rejectionReason ? <p className="mt-1 font-bold text-red-700">{adjustment.rejectionReason}</p> : null}
                        {canApproveAdjustments && adjustment.status === "EM_ANALISE" ? (
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => reviewAdjustment(adjustment.id, "APPROVE")}
                              disabled={reviewingId === adjustment.id}
                              className="rounded-lg bg-emerald-600 px-2 py-2 text-xs font-black text-white disabled:cursor-wait disabled:opacity-60"
                            >
                              Aprovar
                            </button>
                            <button
                              type="button"
                              onClick={() => reviewAdjustment(adjustment.id, "REJECT")}
                              disabled={reviewingId === adjustment.id}
                              className="rounded-lg bg-red-600 px-2 py-2 text-xs font-black text-white disabled:cursor-wait disabled:opacity-60"
                            >
                              Recusar
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <p className="text-sm font-bold text-muted">Nenhum pedido registrado para a data.</p>
                  )}
                </div>
              </div>
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

function StatusBadge({ status }: { status: string }) {
  const normalized = status || "EM_ANALISE";
  const label = normalized === "APROVADO" ? "Aprovado" : normalized === "RECUSADO" ? "Recusado" : "Em análise";
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-1 text-[10px] font-black uppercase",
        normalized === "APROVADO"
          ? "bg-emerald-50 text-emerald-700"
          : normalized === "RECUSADO"
            ? "bg-red-50 text-red-700"
            : "bg-amber-50 text-amber-700"
      )}
    >
      {label}
    </span>
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

function formatDurationMs(value?: number | null) {
  if (!Number.isFinite(Number(value))) return "0:00";
  const totalMinutes = Math.round(Number(value) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.abs(totalMinutes % 60);
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}
