"use client";

import { AlertTriangle, CalendarDays, ChevronDown, Clock, ListChecks, MonitorCog, RefreshCw, ShieldCheck, Wifi } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader, Panel, StatCard } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type TimelineSegment = {
  type: "ACTIVE" | "NO_ACTIVITY";
  start: string;
  end: string;
  durationMs: number;
};

type TimelineRow = {
  key: string;
  hostname: string;
  windowsUser: string;
  wbLogin: string;
  employeeId: string;
  employeeName: string;
  ipAddress: string;
  lastSeenAt: string;
  activeMs: number;
  noActivityMs: number;
  capturedActiveMs: number;
  consideredActiveMs: number;
  consideredNoActivityMs: number;
  sessionCount: number;
  segments: TimelineSegment[];
  approvedAdjustment?: {
    requestedActiveHours: string;
    currentActiveHours: string;
    reason: string;
    reviewedByName: string;
    reviewedAt: string;
  } | null;
};

type DaySummary = {
  users: number;
  activeMs: number;
  capturedActiveMs: number;
  noActivityMs: number;
  sessions: number;
  approvedAdjustments: number;
};

type TimelineDay = {
  date: string;
  window: { start: string; end: string; calculationEnd?: string };
  summary: DaySummary;
  rows: TimelineRow[];
};

type MyTimelinePayload = {
  success: boolean;
  range: { startDate: string; endDate: string; days: number };
  summary: DaySummary;
  days: TimelineDay[];
  employee?: { fullName: string; wbLogin: string; roleTitle: string; lob: string; shift: string };
  error?: string;
  message?: string;
};

type DateRange = { startDate: string; endDate: string };

export function MyRealtimeHoursPage() {
  const initialRange = useMemo(() => currentMonthRange(), []);
  const [payload, setPayload] = useState<MyTimelinePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [range, setRange] = useState<DateRange>(initialRange);
  const [draftRange, setDraftRange] = useState<DateRange>(initialRange);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  const loadData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    if (!showRefreshing) setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ startDate: range.startDate, endDate: range.endDate });
      const response = await fetch(`/api/realtime-hours/me/timeline?${params.toString()}`, { cache: "no-store" });
      const body = await response.json() as MyTimelinePayload;
      if (!response.ok || body.success === false) throw new Error(body.message || body.error || "Não foi possível carregar suas horas.");
      setPayload(body);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar suas horas.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [range.endDate, range.startDate]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const days = payload?.days ?? [];
  const lastSeenAt = days.flatMap((day) => day.rows).reduce<string | null>((latest, row) => {
    if (!latest) return row.lastSeenAt;
    return new Date(row.lastSeenAt).getTime() > new Date(latest).getTime() ? row.lastSeenAt : latest;
  }, null);
  const pendingRange = draftRange.startDate !== range.startDate || draftRange.endDate !== range.endDate;

  function applyRange() {
    if (!draftRange.startDate || !draftRange.endDate) {
      setError("Informe a data inicial e a data final do período.");
      return;
    }
    if (draftRange.startDate > draftRange.endDate) {
      setError("A data inicial não pode ser posterior à data final.");
      return;
    }
    setError("");
    setExpandedDate(null);
    setRange(draftRange);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Minhas Horas"
        description="Acompanhe suas horas por dia e consulte qualquer período de até 93 dias."
        icon={Clock}
        actions={
          <button type="button" onClick={() => void loadData(true)} disabled={refreshing || loading} className="premium-button inline-flex h-9 items-center gap-2 px-3 text-sm font-extrabold disabled:cursor-wait disabled:opacity-70">
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            Atualizar
          </button>
        }
      />

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-sm font-bold text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <StatCard title="Total considerado" value={formatDurationMs(payload?.summary.activeMs ?? 0)} helper={formatRangeLabel(payload?.range)} icon={Wifi} tone="green" />
        <StatCard title="Total capturado" value={formatDurationMs(payload?.summary.capturedActiveMs ?? 0)} helper="sinal bruto do computador" icon={MonitorCog} tone="blue" />
        <StatCard title="Total sem atividade" value={formatDurationMs(payload?.summary.noActivityMs ?? 0)} helper="intervalos sem sinal ativo" icon={Clock} tone="orange" />
        <StatCard title="Total de sessões" value={payload?.summary.sessions ?? 0} helper={`${payload?.summary.users ?? 0} dia(s) com captura`} icon={ListChecks} tone="cyan" />
        <StatCard title="Ajustes aprovados" value={payload?.summary.approvedAdjustments ?? 0} helper={lastSeenAt ? `último sinal ${formatDateTime(lastSeenAt)}` : "sem captura no período"} icon={ShieldCheck} tone="purple" />
      </div>

      <Panel title="Extrato diário de horas">
        <div className="mb-4 rounded-xl border border-border bg-slate-50/70 p-3">
          <div className="grid gap-3 lg:grid-cols-[minmax(180px,240px)_minmax(180px,240px)_auto_minmax(180px,1fr)] lg:items-end">
            <label className="block">
              <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-muted">Data inicial</span>
              <span className="relative block">
                <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-600" />
                <input type="date" value={draftRange.startDate} onChange={(event) => setDraftRange((current) => ({ ...current, startDate: event.target.value }))} className="premium-control h-10 w-full pl-9 pr-3 text-sm font-black text-navy-950 outline-none" />
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-muted">Data final</span>
              <span className="relative block">
                <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-600" />
                <input type="date" value={draftRange.endDate} onChange={(event) => setDraftRange((current) => ({ ...current, endDate: event.target.value }))} className="premium-control h-10 w-full pl-9 pr-3 text-sm font-black text-navy-950 outline-none" />
              </span>
            </label>
            <button type="button" onClick={applyRange} disabled={!pendingRange || loading} className="premium-button h-10 px-4 text-sm font-extrabold disabled:cursor-not-allowed disabled:opacity-50">
              Aplicar período
            </button>
            <p className="pb-2 text-xs font-bold text-muted lg:text-right">
              Exibindo {payload?.range.days ?? days.length} dia(s) · {formatRangeLabel(payload?.range)}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="grid min-h-[280px] place-items-center text-sm font-bold text-muted">
            <span className="inline-flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin text-blue-600" />Montando o extrato do período...</span>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-white">
            <table className="w-full min-w-[1120px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-[11px] font-black uppercase tracking-wide text-muted">
                  <th className="w-14 px-3 py-3">Ação</th>
                  <th className="w-52 px-3 py-3">Data</th>
                  <th className="w-36 px-3 py-3">Considerado</th>
                  <th className="w-36 px-3 py-3">Capturado</th>
                  <th className="w-36 px-3 py-3">Sem atividade</th>
                  <th className="w-24 px-3 py-3">Sessões</th>
                  <th className="px-3 py-3">Timeline 24h</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {days.map((day) => (
                  <DailyTimelineRow
                    key={day.date}
                    day={day}
                    expanded={expandedDate === day.date}
                    onToggle={() => setExpandedDate((current) => current === day.date ? null : day.date)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function DailyTimelineRow({ day, expanded, onToggle }: { day: TimelineDay; expanded: boolean; onToggle: () => void }) {
  const segments = day.rows.flatMap((row) => row.segments);
  const hasCapture = day.rows.length > 0;
  const lastSeenAt = day.rows.reduce<string | null>((latest, row) => {
    if (!latest) return row.lastSeenAt;
    return new Date(row.lastSeenAt).getTime() > new Date(latest).getTime() ? row.lastSeenAt : latest;
  }, null);

  return (
    <>
      <tr className={cn("align-middle transition-colors hover:bg-blue-50/30", !hasCapture && "bg-slate-50/30")}>
        <td className="px-3 py-3">
          <button type="button" onClick={onToggle} disabled={!segments.length} className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-white text-blue-600 shadow-soft transition hover:bg-blue-50 disabled:cursor-default disabled:text-slate-300 disabled:shadow-none" title={segments.length ? (expanded ? "Ocultar sessões" : "Ver sessões") : "Sem sessões neste dia"}>
            <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
          </button>
        </td>
        <td className="px-3 py-3">
          <p className="text-sm font-black capitalize text-navy-950">{formatDateLabel(day.date)}</p>
          <p className={cn("mt-0.5 text-xs font-bold", hasCapture ? "text-emerald-600" : "text-muted")}>
            {hasCapture ? `Último sinal às ${formatTimeOnly(lastSeenAt)}` : "Sem captura"}
          </p>
        </td>
        <td className="px-3 py-3 text-sm font-black text-emerald-600">{formatDurationMs(day.summary.activeMs)}</td>
        <td className="px-3 py-3 text-sm font-black text-blue-600">{formatDurationMs(day.summary.capturedActiveMs)}</td>
        <td className="px-3 py-3 text-sm font-black text-orange-600">{formatDurationMs(day.summary.noActivityMs)}</td>
        <td className="px-3 py-3">
          <p className="text-sm font-black text-navy-950">{day.summary.sessions}</p>
          {day.summary.approvedAdjustments ? <p className="text-[11px] font-black text-violet-600">{day.summary.approvedAdjustments} ajuste(s)</p> : null}
        </td>
        <td className="px-3 py-3"><TimelineBar segments={segments} windowStart={day.window.start} windowEnd={day.window.end} /></td>
      </tr>
      {expanded && segments.length ? (
        <tr>
          <td colSpan={7} className="bg-slate-50/70 px-3 py-4">
            <div className="space-y-2">
              {segments.map((segment, index) => (
                <div key={`${segment.start}-${index}`} className={cn("grid grid-cols-[minmax(130px,1fr)_180px_90px] items-center gap-3 rounded-lg border px-3 py-2 text-sm font-bold", segment.type === "ACTIVE" ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500")}>
                  <span>{segment.type === "ACTIVE" ? "Ativo" : "Sem atividade"}</span>
                  <span className="text-center text-slate-600">{formatTimeOnly(segment.start)} - {formatTimeOnly(segment.end)}</span>
                  <span className="text-right text-navy-950">{formatDurationMs(segment.durationMs)}</span>
                </div>
              ))}
              {day.rows.flatMap((row) => row.approvedAdjustment ? [row.approvedAdjustment] : []).map((adjustment, index) => (
                <div key={`${adjustment.reviewedAt}-${index}`} className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">
                  Ajuste aprovado: {adjustment.currentActiveHours} para {adjustment.requestedActiveHours}{adjustment.reviewedByName ? ` por ${adjustment.reviewedByName}` : ""}.
                </div>
              ))}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function TimelineBar({ segments, windowStart, windowEnd }: { segments: TimelineSegment[]; windowStart: string; windowEnd: string }) {
  const startMs = new Date(windowStart).getTime();
  const endMs = new Date(windowEnd).getTime();
  const totalMs = Math.max(1, endMs - startMs);
  return (
    <div className="relative pt-5">
      <div className="absolute inset-x-0 top-0 grid grid-cols-6 text-center text-[11px] font-bold text-slate-400"><span>02h</span><span>06h</span><span>10h</span><span>14h</span><span>18h</span><span>22h</span></div>
      <div className="relative h-8 overflow-hidden rounded-md border-2 border-slate-700 bg-slate-100 shadow-inner">
        {segments.filter((segment) => segment.type === "ACTIVE").map((segment, index) => {
          const segmentStart = new Date(segment.start).getTime();
          const segmentEnd = new Date(segment.end).getTime();
          const left = ((segmentStart - startMs) / totalMs) * 100;
          const width = Math.max(0.2, ((segmentEnd - segmentStart) / totalMs) * 100);
          return <span key={`${segment.start}-${index}`} className="absolute bottom-1 top-1 rounded bg-emerald-500" style={{ left: `${Math.max(0, left)}%`, width: `${Math.min(100 - Math.max(0, left), width)}%` }} title={`${formatTimeOnly(segment.start)} - ${formatTimeOnly(segment.end)} | ${formatDurationMs(segment.durationMs)}`} />;
        })}
      </div>
    </div>
  );
}

function currentMonthRange(): DateRange {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [year, month] = today.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    startDate: `${year}-${String(month).padStart(2, "0")}-01`,
    endDate: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
  };
}

function formatDurationMs(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0m";
  const totalMinutes = Math.floor(value / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}m`;
}

function formatTimeOnly(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatDateLabel(value: string) {
  const date = new Date(`${value}T12:00:00-03:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function formatRangeLabel(range?: { startDate: string; endDate: string } | null) {
  if (!range) return "período selecionado";
  return `${formatShortDate(range.startDate)} a ${formatShortDate(range.endDate)}`;
}

function formatShortDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}
