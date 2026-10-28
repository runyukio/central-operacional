"use client";

import {
  Activity,
  AppWindow,
  CalendarDays,
  Clock,
  Globe2,
  Laptop,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  WifiOff
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type ActivitySourceType = "WEB" | "APP" | "IDLE" | "LOCKED" | "PRIVATE" | "UNKNOWN";

type ActivityRow = {
  id: string;
  eventId: string;
  source: string;
  capturedAt: string;
  hostname: string;
  windowsUser: string | null;
  wbLogin: string | null;
  employeeId: string | null;
  sourceType: ActivitySourceType;
  applicationName: string | null;
  domain: string | null;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  agentVersion: string | null;
  employeeName: string;
  lob: string;
  supervisor: string;
};

type ActivitySummary = {
  rowCount: number;
  employees: number;
  totalSeconds: number;
  webSeconds: number;
  appSeconds: number;
  idleSeconds: number;
  lockedSeconds: number;
  privateSeconds: number;
  unknownSeconds: number;
  uniqueDomains: number;
};

type ActivityPayload = {
  success: boolean;
  date: string;
  window: { start: string; end: string };
  summary: ActivitySummary;
  rows: ActivityRow[];
  recordsReturned: number;
  sourceRecordsReturned: number;
  limit: number;
  truncated: boolean;
  privacy: string;
  error?: string;
  message?: string;
};

type RankedItem = { label: string; seconds: number };
const allTypes = "ALL";

export function WorkstationActivityPage() {
  const [date, setDate] = useState(todayInSaoPaulo());
  const [search, setSearch] = useState("");
  const [sourceType, setSourceType] = useState(allTypes);
  const [payload, setPayload] = useState<ActivityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({ date, limit: "5000" });
      if (search.trim()) params.set("search", search.trim());
      if (sourceType !== allTypes) params.set("sourceType", sourceType);
      const response = await fetch(`/api/realtime-hours/activity?${params.toString()}`, { cache: "no-store" });
      const body = await response.json() as ActivityPayload;
      if (!response.ok || body.success === false) {
        throw new Error(body.message || body.error || "Não foi possível carregar a atividade das estações.");
      }
      setPayload(body);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar a atividade das estações.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [date, search, sourceType]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadData(), 300);
    return () => window.clearTimeout(timeout);
  }, [loadData]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (!document.hidden) void loadData(true);
    };
    const interval = window.setInterval(refreshWhenVisible, 60_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadData]);

  const summary = payload?.summary ?? emptySummary();
  const activeSeconds = summary.webSeconds + summary.appSeconds + summary.unknownSeconds;
  const topDomains = useMemo(() => rankRows(payload?.rows ?? [], "WEB"), [payload?.rows]);
  const topApplications = useMemo(() => rankRows(payload?.rows ?? [], "APP"), [payload?.rows]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Atividades"
        description="Visão operacional dos domínios e aplicativos ativos nas estações monitoradas."
        icon={Activity}
        actions={
          <button
            type="button"
            onClick={() => void loadData(true)}
            disabled={refreshing}
            className="premium-button inline-flex h-9 items-center gap-2 px-3 text-sm font-extrabold disabled:cursor-wait disabled:opacity-70"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            Atualizar
          </button>
        }
      />

      <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
        <div>
          <p className="font-black">Coleta minimizada e restrita</p>
          <p className="mt-0.5 font-medium text-blue-800">
            A Central recebe somente domínio, aplicativo e intervalo. URL completa, conteúdo da página, texto digitado, senha e captura de tela não são coletados.
          </p>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {payload?.truncated ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
          O resumo considera o período completo, mas a tabela atingiu o limite de {payload.limit.toLocaleString("pt-BR")} registros. Refine os filtros para detalhar.
        </div>
      ) : null}

      <Panel title="Filtros operacionais">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[190px_minmax(280px,1fr)_220px]">
          <label className="relative block">
            <span className="sr-only">Data</span>
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-600" />
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="premium-control h-10 w-full pl-9 pr-3 text-sm font-black text-navy-950 outline-none"
            />
          </label>

          <label className="relative block">
            <span className="sr-only">Buscar</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="premium-control h-10 w-full pl-9 pr-3 text-sm font-bold outline-none"
              placeholder="Buscar parceiro, WB, domínio, aplicativo ou máquina"
            />
          </label>

          <select
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value)}
            className="premium-control h-10 w-full px-3 text-sm font-black text-navy-950 outline-none"
            aria-label="Tipo de atividade"
          >
            <option value={allTypes}>Todos os tipos</option>
            <option value="WEB">Sites</option>
            <option value="APP">Aplicativos</option>
            <option value="IDLE">Inatividade</option>
            <option value="LOCKED">Tela bloqueada</option>
            <option value="PRIVATE">Navegação privada</option>
            <option value="UNKNOWN">Não identificado</option>
          </select>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <MetricCard title="Tempo monitorado" value={formatDuration(summary.totalSeconds)} helper={`${summary.employees} parceiro(s)`} icon={Clock} tone="blue" />
        <MetricCard title="Atividade ativa" value={formatDuration(activeSeconds)} helper="Sites, apps e contexto ativo" icon={Activity} tone="green" />
        <MetricCard title="Sites" value={formatDuration(summary.webSeconds)} helper={`${summary.uniqueDomains} domínio(s)`} icon={Globe2} tone="purple" />
        <MetricCard title="Aplicativos" value={formatDuration(summary.appSeconds)} helper="Fora do navegador" icon={AppWindow} tone="blue" />
        <MetricCard title="Inatividade" value={formatDuration(summary.idleSeconds)} helper="Acima da tolerância" icon={Laptop} tone="orange" />
        <MetricCard title="Tela bloqueada" value={formatDuration(summary.lockedSeconds)} helper={summary.privateSeconds ? `${formatDuration(summary.privateSeconds)} em modo privado` : "Sessão bloqueada"} icon={Lock} tone="slate" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <RankingPanel title="Sites mais utilizados" items={topDomains} icon={Globe2} empty="Nenhum domínio capturado neste filtro." />
        <RankingPanel title="Aplicativos mais utilizados" items={topApplications} icon={AppWindow} empty="Nenhum aplicativo capturado neste filtro." />
      </div>

      <Panel title="Linha do tempo de atividade">
        {loading ? (
          <div className="grid min-h-[280px] place-items-center text-sm font-bold text-muted">
            <span className="inline-flex items-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
              Carregando atividade das estações...
            </span>
          </div>
        ) : !payload?.rows.length ? (
          <EmptyState title="Sem atividade neste filtro" description="Escolha outra data, ajuste os filtros ou aguarde o próximo envio dos agentes Windows." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-white">
            <table className="w-full min-w-[1180px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-[11px] font-black uppercase tracking-wide text-muted">
                  <th className="px-3 py-3">Parceiro</th>
                  <th className="w-36 px-3 py-3">Intervalo</th>
                  <th className="w-28 px-3 py-3">Duração</th>
                  <th className="w-36 px-3 py-3">Tipo</th>
                  <th className="px-3 py-3">Site ou aplicativo</th>
                  <th className="w-48 px-3 py-3">Estação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {payload.rows.map((row) => <ActivityTableRow key={`${row.eventId}-${row.startedAt}`} row={row} />)}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function ActivityTableRow({ row }: { row: ActivityRow }) {
  const displayTarget = row.sourceType === "WEB"
    ? row.domain || "Domínio não identificado"
    : row.sourceType === "APP"
      ? formatApplication(row.applicationName)
      : sourceTypeLabel(row.sourceType);

  return (
    <tr className="align-middle transition-colors hover:bg-blue-50/30">
      <td className="px-3 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-600">
            <UserRound className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="max-w-[260px] truncate text-sm font-black text-navy-950">{row.employeeName}</p>
            <p className="max-w-[280px] truncate text-xs font-bold text-muted">
              {row.wbLogin || row.windowsUser || "Sem identificação"} · {row.lob} · {row.supervisor}
            </p>
          </div>
        </div>
      </td>
      <td className="px-3 py-3 text-sm font-black text-navy-950">{formatTime(row.startedAt)} - {formatTime(row.endedAt)}</td>
      <td className="px-3 py-3 text-sm font-black text-emerald-600">{formatDuration(row.durationSeconds)}</td>
      <td className="px-3 py-3"><SourceBadge sourceType={row.sourceType} /></td>
      <td className="px-3 py-3">
        <p className="text-sm font-black text-navy-950">{displayTarget}</p>
        {row.sourceType === "WEB" && row.applicationName ? (
          <p className="text-xs font-bold text-muted">via {formatApplication(row.applicationName)}</p>
        ) : null}
      </td>
      <td className="px-3 py-3">
        <p className="text-sm font-black text-navy-950">{row.hostname}</p>
        <p className="text-xs font-bold text-muted">{row.windowsUser || "Usuário Windows não informado"}</p>
      </td>
    </tr>
  );
}

function SourceBadge({ sourceType }: { sourceType: ActivitySourceType }) {
  const styles: Record<ActivitySourceType, string> = {
    WEB: "border-violet-200 bg-violet-50 text-violet-700",
    APP: "border-blue-200 bg-blue-50 text-blue-700",
    IDLE: "border-amber-200 bg-amber-50 text-amber-700",
    LOCKED: "border-slate-200 bg-slate-100 text-slate-700",
    PRIVATE: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
    UNKNOWN: "border-red-200 bg-red-50 text-red-700"
  };
  return (
    <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-[11px] font-black", styles[sourceType])}>
      {sourceTypeLabel(sourceType)}
    </span>
  );
}

function MetricCard({ title, value, helper, icon: Icon, tone }: {
  title: string;
  value: string;
  helper: string;
  icon: LucideIcon;
  tone: "blue" | "green" | "orange" | "purple" | "slate";
}) {
  const styles = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-emerald-50 text-emerald-600",
    orange: "bg-amber-50 text-amber-600",
    purple: "bg-violet-50 text-violet-600",
    slate: "bg-slate-100 text-slate-600"
  }[tone];

  return (
    <article className="flex min-h-[112px] items-center gap-3 rounded-xl border border-border bg-white px-4 py-3 shadow-soft">
      <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", styles)}><Icon className="h-5 w-5" /></span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-black uppercase tracking-wide text-muted">{title}</span>
        <span className="mt-1 block text-xl font-black text-navy-950">{value}</span>
        <span className="mt-1 block truncate text-xs font-bold text-muted">{helper}</span>
      </span>
    </article>
  );
}

function RankingPanel({ title, items, icon: Icon, empty }: {
  title: string;
  items: RankedItem[];
  icon: LucideIcon;
  empty: string;
}) {
  const maximum = Math.max(1, ...items.map((item) => item.seconds));
  return (
    <Panel title={title}>
      {!items.length ? (
        <p className="py-8 text-center text-sm font-bold text-muted">{empty}</p>
      ) : (
        <div className="space-y-3">
          {items.slice(0, 8).map((item) => (
            <div key={item.label} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="inline-flex min-w-0 items-center gap-2 font-black text-navy-950">
                  <Icon className="h-4 w-4 shrink-0 text-blue-600" />
                  <span className="truncate">{item.label}</span>
                </span>
                <span className="shrink-0 font-black text-slate-600">{formatDuration(item.seconds)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.max(4, (item.seconds / maximum) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function rankRows(rows: ActivityRow[], sourceType: "WEB" | "APP"): RankedItem[] {
  const totals = new Map<string, RankedItem>();
  for (const row of rows) {
    if (row.sourceType !== sourceType) continue;
    const label = sourceType === "WEB" ? row.domain : formatApplication(row.applicationName);
    if (!label) continue;
    const current = totals.get(label) ?? { label, seconds: 0 };
    current.seconds += row.durationSeconds;
    totals.set(label, current);
  }
  return Array.from(totals.values()).sort((a, b) => b.seconds - a.seconds || a.label.localeCompare(b.label));
}

function sourceTypeLabel(sourceType: ActivitySourceType) {
  return {
    WEB: "Site",
    APP: "Aplicativo",
    IDLE: "Inativo",
    LOCKED: "Tela bloqueada",
    PRIVATE: "Navegação privada",
    UNKNOWN: "Não identificado"
  }[sourceType];
}

function formatApplication(value: string | null) {
  if (!value) return "Aplicativo não identificado";
  const labels: Record<string, string> = {
    chrome: "Google Chrome",
    msedge: "Microsoft Edge",
    firefox: "Mozilla Firefox",
    brave: "Brave",
    opera: "Opera",
    vivaldi: "Vivaldi",
    excel: "Microsoft Excel",
    winword: "Microsoft Word",
    outlook: "Microsoft Outlook",
    teams: "Microsoft Teams",
    msaccess: "Microsoft Access",
    powerpnt: "Microsoft PowerPoint"
  };
  return labels[value.toLowerCase()] ?? value;
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const remainingSeconds = total % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}min`;
  if (minutes) return `${minutes}min`;
  return `${remainingSeconds}s`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : new Date().toISOString().slice(0, 10);
}

function emptySummary(): ActivitySummary {
  return {
    rowCount: 0,
    employees: 0,
    totalSeconds: 0,
    webSeconds: 0,
    appSeconds: 0,
    idleSeconds: 0,
    lockedSeconds: 0,
    privateSeconds: 0,
    unknownSeconds: 0,
    uniqueDomains: 0
  };
}
