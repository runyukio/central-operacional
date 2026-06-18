"use client";

import { Activity, AlertTriangle, Clock3, Database, History, RefreshCw, Search, Table2, UsersRound, Wifi } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

type RealTimeRow = {
  id: string;
  rowNumber: number;
  queueName: string;
  agentName: string;
  wbLogin: string;
  status: string;
  lob: string;
  supervisor: string;
  rawData: Record<string, unknown>;
};

type CountItem = { label: string; count: number };

type RealTimeDataset = {
  totalRows: number;
  returnedRows: number;
  truncated: boolean;
  columns: string[];
  statuses: CountItem[];
  lobs: CountItem[];
  rows: RealTimeRow[];
};

type RealTimePayload = {
  data: {
    summary: {
      hasData: boolean;
      status: string;
      fileName: string;
      source: string;
      importedAt: string;
      importedAtLabel: string;
      minutesSinceImport: number | null;
      isStale: boolean;
      staleThresholdMinutes: number;
      queueRows: number;
      agentRows: number;
      rowsTotal: number;
      warnings: string[];
    };
    queues: RealTimeDataset;
    agents: RealTimeDataset;
    kpis: Array<{ label: string; value: string; helper: string; tone: "blue" | "green" | "purple" | "orange" }>;
  };
};

type ImportHistory = {
  id: string;
  fileName: string;
  source: string;
  status: string;
  rowsTotal: number;
  queueRows: number;
  agentRows: number;
  importedAtLabel: string;
  errorMessage: string;
  warnings: string[];
};

export function RealTimePage() {
  const [payload, setPayload] = useState<RealTimePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"queues" | "agents">("queues");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [lobFilter, setLobFilter] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [imports, setImports] = useState<ImportHistory[]>([]);
  const [importsLoading, setImportsLoading] = useState(false);

  async function loadSnapshot(background = false) {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/realtime", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.message || json.error || "Não foi possível carregar Real Time.");
      setPayload(json as RealTimePayload);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível carregar Real Time.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function openHistory() {
    setHistoryOpen(true);
    setImportsLoading(true);
    try {
      const response = await fetch("/api/realtime/imports", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.message || json.error || "Não foi possível carregar histórico.");
      setImports(Array.isArray(json.data) ? json.data : []);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível carregar histórico.");
    } finally {
      setImportsLoading(false);
    }
  }

  useEffect(() => {
    void loadSnapshot();
    const interval = window.setInterval(() => void loadSnapshot(true), 60000);
    return () => window.clearInterval(interval);
  }, []);

  const dataset = activeTab === "queues" ? payload?.data.queues : payload?.data.agents;
  const summary = payload?.data.summary;
  const rows = useMemo(() => {
    const sourceRows = dataset?.rows ?? [];
    const normalizedSearch = normalizeSearch(search);
    return sourceRows.filter((row) => {
      if (statusFilter && row.status !== statusFilter) return false;
      if (lobFilter && row.lob !== lobFilter) return false;
      if (!normalizedSearch) return true;
      return normalizeSearch([
        row.queueName,
        row.agentName,
        row.wbLogin,
        row.status,
        row.lob,
        row.supervisor,
        ...Object.values(row.rawData).map((value) => String(value ?? ""))
      ].join(" ")).includes(normalizedSearch);
    });
  }, [dataset?.rows, lobFilter, search, statusFilter]);
  const columns = useMemo(() => buildColumns(activeTab, dataset?.columns ?? []), [activeTab, dataset?.columns]);

  const statusOptions = dataset?.statuses ?? [];
  const lobOptions = dataset?.lobs ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-black text-navy-950">Real Time</h1>
            <span className={cn("inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-black", summary?.isStale ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700")}>
              <Wifi className="h-3.5 w-3.5" />
              {summary?.hasData ? (summary.isStale ? "Atenção" : "Atualizado") : "Sem dados"}
            </span>
          </div>
          <p className="mt-1 text-sm font-bold text-muted">Snapshot operacional das bases KAP, com visão de filas e agentes.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void openHistory()} className="premium-control inline-flex h-10 items-center gap-2 px-3 text-sm font-extrabold text-navy-950">
            <History className="h-4 w-4" />
            Histórico
          </button>
          <button type="button" onClick={() => void loadSnapshot(true)} className="premium-button inline-flex h-10 items-center gap-2 px-4 text-sm font-extrabold">
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            Atualizar
          </button>
        </div>
      </div>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}

      <section className="premium-card p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Última atualização" value={summary?.importedAtLabel || "-"} helper={summary?.fileName || "Aguardando primeiro upload"} icon={Clock3} tone={summary?.isStale ? "orange" : "blue"} />
          <StatCard title="Filas" value={String(summary?.queueRows ?? 0)} helper="linhas importadas" icon={Table2} tone="purple" />
          <StatCard title="Agentes" value={String(summary?.agentRows ?? 0)} helper="linhas importadas" icon={UsersRound} tone="green" />
          <StatCard title="Snapshot" value={summary?.status || "EMPTY"} helper={summary?.source || "kap-local"} icon={Database} tone={summary?.isStale ? "orange" : "blue"} />
        </div>
        {summary?.isStale ? (
          <div className="mt-3 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Os dados estão sem atualização há {summary.minutesSinceImport} minuto(s). O limite esperado é {summary.staleThresholdMinutes} minutos.
          </div>
        ) : null}
        {summary?.warnings?.length ? (
          <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-muted">
            {summary.warnings.join(" ")}
          </div>
        ) : null}
      </section>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {(payload?.data.kpis ?? []).map((item) => (
          <StatCard key={item.label} title={item.label} value={item.value} helper={item.helper} icon={Activity} tone={item.tone} />
        ))}
      </div>

      <section className="premium-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4">
          <div className="inline-flex rounded-2xl bg-slate-100 p-1">
            <button type="button" onClick={() => setActiveTab("queues")} className={cn("rounded-xl px-4 py-2 text-sm font-black transition", activeTab === "queues" ? "bg-white text-blue-700 shadow-sm" : "text-muted")}>
              Filas
            </button>
            <button type="button" onClick={() => setActiveTab("agents")} className={cn("rounded-xl px-4 py-2 text-sm font-black transition", activeTab === "agents" ? "bg-white text-blue-700 shadow-sm" : "text-muted")}>
              Agentes
            </button>
          </div>
          <div className="flex flex-1 flex-wrap justify-end gap-2">
            <label className="premium-control flex h-10 min-w-[220px] items-center gap-2 px-3 text-sm">
              <Search className="h-4 w-4 text-muted" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar em qualquer coluna..." className="w-full bg-transparent font-bold outline-none placeholder:text-muted/70" />
            </label>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="premium-control h-10 px-3 text-sm font-bold text-navy-950 outline-none">
              <option value="">Todos status</option>
              {statusOptions.map((option) => <option key={option.label} value={option.label}>{option.label} ({option.count})</option>)}
            </select>
            <select value={lobFilter} onChange={(event) => setLobFilter(event.target.value)} className="premium-control h-10 px-3 text-sm font-bold text-navy-950 outline-none">
              <option value="">Todas LOBs</option>
              {lobOptions.map((option) => <option key={option.label} value={option.label}>{option.label} ({option.count})</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="grid gap-3 p-4">
            {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded-2xl bg-slate-100" />)}
          </div>
        ) : summary?.hasData ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs font-black uppercase tracking-wide text-muted">
              <span>{rows.length} de {dataset?.totalRows ?? 0} linha(s) exibidas</span>
              {dataset?.truncated ? <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-800">Amostra limitada a {dataset.returnedRows} linhas</span> : null}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                  <tr>
                    {columns.map((column) => <th key={column.key} className="whitespace-nowrap px-4 py-3 font-black">{column.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                      {columns.map((column) => (
                        <td key={`${row.id}-${column.key}`} className="max-w-[240px] whitespace-nowrap px-4 py-3 font-bold text-navy-950">
                          {column.key === "status" ? <StatusPill value={cellValue(row, column.key)} /> : <span title={cellValue(row, column.key)} className="block truncate">{cellValue(row, column.key) || "-"}</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {!rows.length ? (
                    <tr>
                      <td colSpan={columns.length} className="px-4 py-12 text-center text-sm font-bold text-muted">Nenhuma linha encontrada para os filtros aplicados.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="px-4 py-16 text-center">
            <Database className="mx-auto h-10 w-10 text-blue-500" />
            <h2 className="mt-3 text-lg font-black text-navy-950">Nenhum snapshot importado</h2>
            <p className="mx-auto mt-1 max-w-lg text-sm font-bold text-muted">Assim que o script local enviar o primeiro arquivo KAP, as abas Filas e Agentes aparecem aqui.</p>
          </div>
        )}
      </section>

      {historyOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/40 p-4">
          <div className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-lg font-black text-navy-950">Histórico de importações</h2>
                <p className="text-sm font-bold text-muted">Últimos snapshots recebidos pela integração local.</p>
              </div>
              <button type="button" onClick={() => setHistoryOpen(false)} className="premium-control h-9 px-3 text-sm font-extrabold text-navy-950">Fechar</button>
            </div>
            <div className="max-h-[65vh] overflow-auto p-5">
              {importsLoading ? <div className="h-28 animate-pulse rounded-2xl bg-slate-100" /> : imports.length ? (
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-3 py-2">Arquivo</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Filas</th>
                      <th className="px-3 py-2">Agentes</th>
                      <th className="px-3 py-2">Importado em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {imports.map((item) => (
                      <tr key={item.id} className="border-t border-slate-100">
                        <td className="px-3 py-3 font-bold text-navy-950">{item.fileName}</td>
                        <td className="px-3 py-3"><StatusPill value={item.status} /></td>
                        <td className="px-3 py-3 font-bold">{item.queueRows}</td>
                        <td className="px-3 py-3 font-bold">{item.agentRows}</td>
                        <td className="px-3 py-3 text-muted">{item.importedAtLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="text-sm font-bold text-muted">Nenhuma importação encontrada.</p>}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatCard({ title, value, helper, icon: Icon, tone }: { title: string; value: string; helper: string; icon: LucideIcon; tone: "blue" | "green" | "purple" | "orange" }) {
  const toneClass = {
    blue: "bg-blue-50 text-blue-700",
    green: "bg-emerald-50 text-emerald-700",
    purple: "bg-violet-50 text-violet-700",
    orange: "bg-orange-50 text-orange-700"
  }[tone];
  return (
    <div className="premium-card flex items-center justify-between gap-3 p-4">
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-muted">{title}</p>
        <p className="mt-1 text-2xl font-black text-navy-950">{value}</p>
        <p className="mt-1 text-xs font-bold text-muted">{helper}</p>
      </div>
      <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl", toneClass)}>
        <Icon className="h-5 w-5" />
      </span>
    </div>
  );
}

function StatusPill({ value }: { value: string }) {
  const normalized = normalizeSearch(value);
  const tone = normalized.includes("success") || normalized.includes("online") || normalized.includes("available") || normalized.includes("ok") || normalized.includes("ativo")
    ? "bg-emerald-100 text-emerald-700"
    : normalized.includes("error") || normalized.includes("offline") || normalized.includes("fail") || normalized.includes("crit")
      ? "bg-red-100 text-red-700"
      : normalized.includes("warn") || normalized.includes("busy") || normalized.includes("aten")
        ? "bg-amber-100 text-amber-800"
        : "bg-slate-100 text-slate-700";
  return <span className={cn("inline-flex max-w-[220px] rounded-full px-2.5 py-1 text-xs font-black", tone)} title={value}>{value || "-"}</span>;
}

function buildColumns(activeTab: "queues" | "agents", rawColumns: string[]) {
  const base = activeTab === "queues"
    ? [
        { key: "rowNumber", label: "#" },
        { key: "queueName", label: "Fila" },
        { key: "status", label: "Status" },
        { key: "lob", label: "LOB" },
        { key: "supervisor", label: "Supervisor" }
      ]
    : [
        { key: "rowNumber", label: "#" },
        { key: "agentName", label: "Agente" },
        { key: "wbLogin", label: "WB/Login" },
        { key: "status", label: "Status" },
        { key: "lob", label: "LOB" },
        { key: "supervisor", label: "Supervisor" }
      ];
  const existing = new Set(base.map((column) => normalizeSearch(column.label)).concat(base.map((column) => normalizeSearch(column.key))));
  const dynamic = rawColumns
    .filter((column) => !existing.has(normalizeSearch(column)))
    .slice(0, 14)
    .map((column) => ({ key: `raw:${column}`, label: column }));
  return [...base, ...dynamic];
}

function cellValue(row: RealTimeRow, key: string) {
  if (key === "rowNumber") return String(row.rowNumber);
  if (key === "queueName") return row.queueName;
  if (key === "agentName") return row.agentName;
  if (key === "wbLogin") return row.wbLogin;
  if (key === "status") return row.status;
  if (key === "lob") return row.lob;
  if (key === "supervisor") return row.supervisor;
  if (key.startsWith("raw:")) return formatValue(row.rawData[key.slice(4)]);
  return "";
}

function formatValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}
