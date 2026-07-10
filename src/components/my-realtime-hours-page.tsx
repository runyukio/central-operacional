"use client";

import { AlertTriangle, CalendarDays, ChevronDown, Clock, MonitorCog, RefreshCw, Search, ShieldCheck, UserRound, Wifi } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState, PageHeader, Panel, StatCard } from "@/components/ui/primitives";
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
  sessionCount: number;
  segments: TimelineSegment[];
};

type MyTimelinePayload = {
  success: boolean;
  date: string;
  window: { start: string; end: string };
  summary: { users: number; activeMs: number; noActivityMs: number; sessions: number };
  rows: TimelineRow[];
  employee?: { fullName: string; wbLogin: string; roleTitle: string; lob: string; shift: string };
  error?: string;
  message?: string;
};

export function MyRealtimeHoursPage() {
  const [payload, setPayload] = useState<MyTimelinePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [date, setDate] = useState(todayInputDate());
  const [search, setSearch] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const loadData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    if (!showRefreshing) setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/realtime-hours/me/timeline?date=${encodeURIComponent(date)}&search=${encodeURIComponent(search)}`, { cache: "no-store" });
      const body = await response.json() as MyTimelinePayload;
      if (!response.ok || body.success === false) throw new Error(body.message || body.error || "Não foi possível carregar suas horas.");
      setPayload(body);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar suas horas.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [date, search]);

  useEffect(() => {
    loadData();
    const interval = window.setInterval(() => loadData(true), 60_000);
    return () => window.clearInterval(interval);
  }, [loadData]);

  const rows = useMemo(() => payload?.rows ?? [], [payload?.rows]);
  const lastSeenAt = rows.reduce<string | null>((latest, row) => {
    if (!latest) return row.lastSeenAt;
    return new Date(row.lastSeenAt).getTime() > new Date(latest).getTime() ? row.lastSeenAt : latest;
  }, null);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Minhas Horas"
        description="Sua timeline diária e sessões capturadas pelo computador vinculado."
        icon={Clock}
        actions={
          <button type="button" onClick={() => loadData(true)} disabled={refreshing} className="premium-button inline-flex h-9 items-center gap-2 px-3 text-sm font-extrabold disabled:cursor-wait disabled:opacity-70">
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

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Tempo ativo" value={formatDurationMs(payload?.summary.activeMs ?? 0)} helper={payload?.employee?.fullName || "capturado no dia"} icon={Wifi} tone="green" />
        <StatCard title="Sem atividade" value={formatDurationMs(payload?.summary.noActivityMs ?? 0)} helper="intervalos sem sinal ativo" icon={Clock} tone="orange" />
        <StatCard title="Sessões" value={payload?.summary.sessions ?? 0} helper={`${payload?.summary.users ?? 0} vínculo(s)`} icon={MonitorCog} tone="blue" />
        <StatCard title="Último sinal" value={formatTimeOnly(lastSeenAt)} helper={lastSeenAt ? formatDateTime(lastSeenAt) : "sem captura"} icon={ShieldCheck} tone="purple" />
      </div>

      <Panel title="Minha timeline diária">
        <div className="mb-4 grid gap-2.5 lg:grid-cols-[220px_minmax(0,1fr)]">
          <label className="relative block">
            <span className="sr-only">Data</span>
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-600" />
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="premium-control h-10 w-full pl-9 pr-3 text-sm font-black text-navy-950 outline-none" />
          </label>
          <label className="relative block">
            <span className="sr-only">Buscar</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="premium-control h-10 w-full pl-9 pr-3 text-sm font-bold outline-none" placeholder="Buscar por máquina, usuário Windows ou IP" />
          </label>
        </div>

        {loading ? (
          <div className="grid min-h-[260px] place-items-center text-sm font-bold text-muted">
            <span className="inline-flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin text-blue-600" />Montando linha do tempo...</span>
          </div>
        ) : !rows.length ? (
          <EmptyState title="Sem captura para esta data" description="Escolha outra data ou peça ao supervisor para conferir seu vínculo." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-white">
            <table className="w-full min-w-[980px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-[11px] font-black uppercase tracking-wide text-muted">
                  <th className="w-14 px-3 py-3">Ação</th>
                  <th className="w-[270px] px-3 py-3">Vínculo</th>
                  <th className="w-32 px-3 py-3">Data</th>
                  <th className="w-28 px-3 py-3">Duração</th>
                  <th className="px-3 py-3">Timeline 24h</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {rows.map((row) => (
                  <TimelineRowView key={row.key} row={row} date={date} windowStart={payload?.window.start ?? ""} windowEnd={payload?.window.end ?? ""} expanded={expandedKey === row.key} onToggle={() => setExpandedKey((current) => current === row.key ? null : row.key)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function TimelineRowView({ row, date, windowStart, windowEnd, expanded, onToggle }: { row: TimelineRow; date: string; windowStart: string; windowEnd: string; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="align-middle transition-colors hover:bg-blue-50/30">
        <td className="px-3 py-3">
          <button type="button" onClick={onToggle} className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-white text-blue-600 shadow-soft transition hover:bg-blue-50" title={expanded ? "Ocultar sessões" : "Ver sessões"}>
            <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
          </button>
        </td>
        <td className="px-3 py-3">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-600"><UserRound className="h-4 w-4" /></span>
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-navy-950">{row.employeeName || row.wbLogin || row.windowsUser || row.hostname}</p>
              <p className="truncate text-xs font-bold text-muted">{row.wbLogin || "Sem WB"} · {row.windowsUser || "Sem usuário Windows"} · {row.hostname}</p>
            </div>
          </div>
        </td>
        <td className="px-3 py-3"><p className="text-sm font-black text-navy-950">{formatDateLabel(date)}</p><p className="text-xs font-bold text-muted">{row.sessionCount} sessão(ões)</p></td>
        <td className="px-3 py-3 text-sm font-black text-emerald-600">{formatDurationMs(row.activeMs)}</td>
        <td className="px-3 py-3"><TimelineBar row={row} windowStart={windowStart} windowEnd={windowEnd} /></td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={5} className="bg-slate-50/70 px-3 py-4">
            <div className="space-y-2">
              {row.segments.map((segment, index) => (
                <div key={`${segment.start}-${index}`} className={cn("grid grid-cols-[minmax(130px,1fr)_180px_90px] items-center gap-3 rounded-lg border px-3 py-2 text-sm font-bold", segment.type === "ACTIVE" ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500")}>
                  <span>{segment.type === "ACTIVE" ? "Ativo" : "Sem atividade"}</span>
                  <span className="text-center text-slate-600">{formatTimeOnly(segment.start)} - {formatTimeOnly(segment.end)}</span>
                  <span className="text-right text-navy-950">{formatDurationMs(segment.durationMs)}</span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function TimelineBar({ row, windowStart, windowEnd }: { row: TimelineRow; windowStart: string; windowEnd: string }) {
  const startMs = new Date(windowStart).getTime();
  const endMs = new Date(windowEnd).getTime();
  const totalMs = Math.max(1, endMs - startMs);
  return (
    <div className="relative pt-5">
      <div className="absolute inset-x-0 top-0 grid grid-cols-6 text-center text-[11px] font-bold text-slate-400"><span>02:00</span><span>06:00</span><span>10:00</span><span>14:00</span><span>18:00</span><span>22:00</span></div>
      <div className="relative h-8 overflow-hidden rounded-md border-2 border-slate-700 bg-slate-100 shadow-inner">
        {row.segments.filter((segment) => segment.type === "ACTIVE").map((segment, index) => {
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

function todayInputDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
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
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function formatDateLabel(value: string) {
  const date = new Date(`${value}T12:00:00-03:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}
