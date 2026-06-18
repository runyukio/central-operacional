"use client";

import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Database,
  Download,
  Eye,
  History,
  RefreshCw,
  Search,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

type CountItem = { label: string; count: number };

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

type RealTimeDataset = {
  totalRows: number;
  returnedRows: number;
  truncated: boolean;
  columns: string[];
  statuses: CountItem[];
  lobs: CountItem[];
  rows: RealTimeRow[];
};

type AgentMetric = {
  submit: number;
  ahtMs: number | null;
  moderationMs: number;
  timeout: number;
  refresh: number;
  queueCount: number;
  sourceRows: number;
};

type AgentRealtimeRow = {
  key: string;
  employeeId: string;
  displayName: string;
  wbLogin: string;
  rawWbLogin: string;
  crossingStatus: "Encontrado" | "Não encontrado";
  personType: "Agente" | "Staff" | "Não encontrado";
  employeeStatus: string;
  lob: string;
  supervisor: string;
  shift: string;
  skill: string;
  roleTitle: string;
  current: AgentMetric;
  previous: AgentMetric | null;
  deltas: {
    submit: number | null;
    ahtMs: number | null;
    moderationMs: number | null;
    timeout: number | null;
    refresh: number | null;
  };
  history: Array<{
    cycleDownload: string;
    submit: number;
    ahtMs: number | null;
    moderationMs: number;
    timeout: number;
    refresh: number;
  }>;
  queueBreakdown: Array<{
    queueId: string;
    queueName: string;
    submit: number;
    ahtMs: number | null;
    moderationMs: number;
    timeout: number;
    refresh: number;
  }>;
};

type AgentRealtimeView = {
  cycles: Array<{ value: string; importedAt: string; importedAtLabel: string; rows: number }>;
  selectedCycle: string;
  previousCycle: string;
  summary: {
    current: {
      recordsImported: number;
      matched: number;
      unmatched: number;
      submit: number;
      ahtMs: number | null;
      moderationMs: number;
      timeout: number;
      refresh: number;
    };
    previous: {
      recordsImported: number;
      matched: number;
      unmatched: number;
      submit: number;
      ahtMs: number | null;
      moderationMs: number;
      timeout: number;
      refresh: number;
    } | null;
  };
  cards: Array<{ label: string; value: string; previous: string; delta: string; trend: "positive" | "negative" | "neutral"; direction: "up" | "down" | "none" }>;
  filters: {
    crossingStatuses: CountItem[];
    personTypes: CountItem[];
    employeeStatuses: CountItem[];
    lobs: CountItem[];
    supervisors: CountItem[];
    shifts: CountItem[];
    skills: CountItem[];
    roleTitles: CountItem[];
  };
  rows: AgentRealtimeRow[];
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
    agents: AgentRealtimeView;
    kpis: Array<{ label: string; value: string; helper: string; tone: "blue" | "green" | "purple" | "orange" }>;
  };
};

type AgentFilters = {
  search: string;
  crossingStatus: string;
  personType: string;
  employeeStatus: string;
  lob: string;
  supervisor: string;
  shift: string;
  skill: string;
  roleTitle: string;
};

type AgentSortKey = "displayName" | "wbLogin" | "employeeStatus" | "lob" | "supervisor" | "shift" | "skill" | "submit" | "aht" | "moderation" | "timeout" | "refresh";
type AgentSortState = { key: AgentSortKey; direction: "asc" | "desc" };
type AgentKpiCard = { label: string; value: string; delta: string; hasComparison: boolean; trend: "positive" | "negative" | "neutral"; direction: "up" | "down" | "none" };

type ImportHistory = {
  id: string;
  fileName: string;
  source: string;
  status: string;
  rowsTotal: number;
  rowsValid: number;
  rowsError: number;
  rowsInserted: number;
  rowsUpdated: number;
  queueRows: number;
  agentRows: number;
  cycleDownload: string;
  matchedEmployees: number;
  unmatchedEmployees: number;
  mappedQueues: number;
  unmappedQueues: number;
  importedAtLabel: string;
  errorMessage: string;
  warnings: string[];
};

const defaultAgentFilters: AgentFilters = {
  search: "",
  crossingStatus: "Encontrado",
  personType: "Agente",
  employeeStatus: "Ativo",
  lob: "",
  supervisor: "",
  shift: "",
  skill: "",
  roleTitle: ""
};

const emptyAgentFilters: AgentFilters = {
  search: "",
  crossingStatus: "",
  personType: "",
  employeeStatus: "",
  lob: "",
  supervisor: "",
  shift: "",
  skill: "",
  roleTitle: ""
};

const defaultAgentSort: AgentSortState = { key: "submit", direction: "desc" };
const numericAgentSortKeys = new Set<AgentSortKey>(["submit", "aht", "moderation", "timeout", "refresh"]);

export function RealTimePage() {
  const [payload, setPayload] = useState<RealTimePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"agents" | "queues">("agents");
  const [selectedCycle, setSelectedCycle] = useState("");
  const [queueSearch, setQueueSearch] = useState("");
  const [queueStatusFilter, setQueueStatusFilter] = useState("");
  const [queueLobFilter, setQueueLobFilter] = useState("");
  const [agentFilters, setAgentFilters] = useState<AgentFilters>(defaultAgentFilters);
  const [agentSort, setAgentSort] = useState<AgentSortState>(defaultAgentSort);
  const [selectedAgent, setSelectedAgent] = useState<AgentRealtimeRow | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [imports, setImports] = useState<ImportHistory[]>([]);
  const [importsLoading, setImportsLoading] = useState(false);

  async function loadSnapshot(cycle = selectedCycle, background = false) {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (cycle) params.set("cycleDownload", cycle);
      const response = await fetch(`/api/realtime${params.size ? `?${params.toString()}` : ""}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.message || json.error || "Não foi possível carregar Real Time.");
      const nextPayload = json as RealTimePayload;
      setPayload(nextPayload);
      if (!cycle && nextPayload.data.agents.selectedCycle) setSelectedCycle(nextPayload.data.agents.selectedCycle);
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
    setError("");
    try {
      const response = await fetch("/api/realtime/imports", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.message || json.error || "Não foi possível carregar histórico de importações.");
      setImports(Array.isArray(json.data) ? json.data : []);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Não foi possível carregar histórico de importações.");
    } finally {
      setImportsLoading(false);
    }
  }

  function exportXlsx() {
    const params = buildAgentQueryParams(selectedCycle || agentView?.selectedCycle || "", agentFilters);
    params.set("sortBy", `${agentSort.key}_${agentSort.direction}`);
    window.location.assign(`/api/realtime/export?${params.toString()}`);
  }

  useEffect(() => {
    void loadSnapshot(selectedCycle);
    const interval = window.setInterval(() => void loadSnapshot(selectedCycle, true), 60000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCycle]);

  const summary = payload?.data.summary;
  const queueDataset = payload?.data.queues;
  const agentView = payload?.data.agents;
  const queueRows = useMemo(() => {
    const sourceRows = queueDataset?.rows ?? [];
    const normalizedSearch = normalizeSearch(queueSearch);
    return sourceRows.filter((row) => {
      if (queueStatusFilter && row.status !== queueStatusFilter) return false;
      if (queueLobFilter && row.lob !== queueLobFilter) return false;
      if (!normalizedSearch) return true;
      return normalizeSearch([
        row.queueName,
        row.agentName,
        row.wbLogin,
        row.status,
        row.lob,
        row.supervisor,
        ...Object.values(safeRawData(row.rawData)).map((value) => String(value ?? ""))
      ].join(" ")).includes(normalizedSearch);
    });
  }, [queueDataset?.rows, queueLobFilter, queueSearch, queueStatusFilter]);

  const agentRows = useMemo(() => {
    const normalizedSearch = normalizeSearch(agentFilters.search);
    return (agentView?.rows ?? []).filter((row) => {
      if (agentFilters.crossingStatus && row.crossingStatus !== agentFilters.crossingStatus) return false;
      if (agentFilters.personType && row.personType !== agentFilters.personType) return false;
      if (agentFilters.employeeStatus && !matchesEmployeeStatus(row.employeeStatus, agentFilters.employeeStatus)) return false;
      if (agentFilters.lob && row.lob !== agentFilters.lob) return false;
      if (agentFilters.supervisor && row.supervisor !== agentFilters.supervisor) return false;
      if (agentFilters.shift && row.shift !== agentFilters.shift) return false;
      if (agentFilters.skill && row.skill !== agentFilters.skill) return false;
      if (agentFilters.roleTitle && row.roleTitle !== agentFilters.roleTitle) return false;
      if (!normalizedSearch) return true;
      return normalizeSearch([
        row.displayName,
        row.wbLogin,
        row.rawWbLogin,
        row.employeeStatus,
        row.lob,
        row.supervisor,
        row.shift,
        row.skill,
        row.roleTitle
      ].join(" ")).includes(normalizedSearch);
    }).sort((a, b) => compareAgentRows(a, b, agentSort));
  }, [agentFilters, agentSort, agentView?.rows]);

  const filteredAgentCards = useMemo(() => buildFilteredAgentCards(agentRows), [agentRows]);

  const queueColumns = useMemo(() => buildQueueColumns(queueDataset?.columns ?? []), [queueDataset?.columns]);
  const cycles = agentView?.cycles ?? [];
  const selectedCycleValue = selectedCycle || agentView?.selectedCycle || "";
  const selectedCycleIndex = cycles.findIndex((cycle) => cycle.value === selectedCycleValue);
  const olderCycle = selectedCycleIndex >= 0 ? cycles[selectedCycleIndex + 1]?.value ?? "" : "";
  const newerCycle = selectedCycleIndex > 0 ? cycles[selectedCycleIndex - 1]?.value ?? "" : "";
  const latestCycle = cycles[0]?.value ?? "";

  function updateAgentFilter(key: keyof AgentFilters, value: string) {
    setAgentFilters((current) => ({ ...current, [key]: value }));
  }

  function toggleAgentSort(key: AgentSortKey) {
    setAgentSort((current) => {
      if (current.key === key) return { key, direction: current.direction === "desc" ? "asc" : "desc" };
      return { key, direction: numericAgentSortKeys.has(key) ? "desc" : "asc" };
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-black text-navy-950">Real Time</h1>
            <span className={cn("inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-black", summary?.isStale ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700")}>
              {summary?.hasData ? (summary.isStale ? "Atenção" : "Atualizado") : "Sem dados"}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void openHistory()} className="premium-control inline-flex h-10 items-center gap-2 px-3 text-sm font-extrabold text-navy-950">
            <History className="h-4 w-4" />
            Histórico
          </button>
          <button type="button" onClick={exportXlsx} className="premium-control inline-flex h-10 items-center gap-2 px-3 text-sm font-extrabold text-navy-950">
            <Download className="h-4 w-4" />
            Exportar XLSX
          </button>
          <button type="button" onClick={() => void loadSnapshot(selectedCycle, true)} className="premium-button inline-flex h-10 items-center gap-2 px-4 text-sm font-extrabold">
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            Atualizar
          </button>
        </div>
      </div>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}

      <section className="premium-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-[260px] flex-1 text-xs font-black uppercase tracking-wide text-muted">
            ciclo_download
            <select value={selectedCycle || agentView?.selectedCycle || ""} onChange={(event) => setSelectedCycle(event.target.value)} className="premium-control mt-1 h-11 w-full px-3 text-sm font-extrabold text-navy-950 outline-none">
              {(agentView?.cycles ?? []).map((cycle) => <option key={cycle.value} value={cycle.value}>{cycle.value} · {cycle.rows} linha(s)</option>)}
            </select>
          </label>
          <button type="button" onClick={() => setSelectedCycle(olderCycle)} disabled={!olderCycle} className="premium-control h-11 px-4 text-sm font-extrabold text-navy-950 disabled:cursor-not-allowed disabled:opacity-50">
            Ciclo anterior
          </button>
          <button type="button" onClick={() => setSelectedCycle(newerCycle)} disabled={!newerCycle} className="premium-control h-11 px-4 text-sm font-extrabold text-navy-950 disabled:cursor-not-allowed disabled:opacity-50">
            Próximo ciclo
          </button>
          <button type="button" onClick={() => setSelectedCycle(latestCycle)} disabled={!latestCycle || selectedCycleValue === latestCycle} className="premium-control h-11 px-4 text-sm font-extrabold text-navy-950 disabled:cursor-not-allowed disabled:opacity-50">
            Ciclo atual
          </button>
          <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-muted">
            Comparação: {agentView?.previousCycle || "Sem ciclo anterior"}
          </div>
        </div>
      </section>

      {activeTab === "agents" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {filteredAgentCards.map((card) => (
            <CompareCard key={card.label} card={card} />
          ))}
        </div>
      ) : null}

      <section className="premium-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4">
          <div className="inline-flex rounded-2xl bg-slate-100 p-1">
            <button type="button" onClick={() => setActiveTab("agents")} className={cn("rounded-xl px-4 py-2 text-sm font-black transition", activeTab === "agents" ? "bg-white text-blue-700 shadow-sm" : "text-muted")}>
              Agentes
            </button>
            <button type="button" onClick={() => setActiveTab("queues")} className={cn("rounded-xl px-4 py-2 text-sm font-black transition", activeTab === "queues" ? "bg-white text-blue-700 shadow-sm" : "text-muted")}>
              Filas
            </button>
          </div>
          {activeTab === "agents" ? (
            <div className="flex flex-1 flex-wrap justify-end gap-2">
              <SearchBox value={agentFilters.search} onChange={(value) => updateAgentFilter("search", value)} placeholder="Buscar agente ou WB..." />
              <FilterSelect value={agentFilters.crossingStatus} onChange={(value) => updateAgentFilter("crossingStatus", value)} label="Cruzamento" empty="Todos" options={agentView?.filters.crossingStatuses ?? []} />
              <FilterSelect value={agentFilters.personType} onChange={(value) => updateAgentFilter("personType", value)} label="Tipo" empty="Todos" options={agentView?.filters.personTypes ?? []} />
              <FilterSelect value={agentFilters.employeeStatus} onChange={(value) => updateAgentFilter("employeeStatus", value)} label="Status" empty="Todos" options={agentView?.filters.employeeStatuses ?? []} />
              <FilterSelect value={agentFilters.lob} onChange={(value) => updateAgentFilter("lob", value)} label="LOB" empty="Todas" options={agentView?.filters.lobs ?? []} />
              <FilterSelect value={agentFilters.supervisor} onChange={(value) => updateAgentFilter("supervisor", value)} label="Supervisor" empty="Todos" options={agentView?.filters.supervisors ?? []} />
              <FilterSelect value={agentFilters.shift} onChange={(value) => updateAgentFilter("shift", value)} label="Turno" empty="Todos" options={agentView?.filters.shifts ?? []} />
              <FilterSelect value={agentFilters.skill} onChange={(value) => updateAgentFilter("skill", value)} label="Skill" empty="Todas" options={agentView?.filters.skills ?? []} />
              <FilterSelect value={agentFilters.roleTitle} onChange={(value) => updateAgentFilter("roleTitle", value)} label="Cargo" empty="Todos" options={agentView?.filters.roleTitles ?? []} />
              <button type="button" onClick={() => setAgentFilters(defaultAgentFilters)} className="premium-control h-10 px-3 text-sm font-extrabold text-navy-950">Padrão</button>
              <button type="button" onClick={() => setAgentFilters(emptyAgentFilters)} className="premium-control h-10 px-3 text-sm font-extrabold text-navy-950">Ver todos</button>
            </div>
          ) : (
            <div className="flex flex-1 flex-wrap justify-end gap-2">
              <SearchBox value={queueSearch} onChange={setQueueSearch} placeholder="Buscar em filas..." />
              <FilterSelect value={queueStatusFilter} onChange={setQueueStatusFilter} label="Status" empty="Todos" options={queueDataset?.statuses ?? []} />
              <FilterSelect value={queueLobFilter} onChange={setQueueLobFilter} label="LOB" empty="Todas" options={queueDataset?.lobs ?? []} />
            </div>
          )}
        </div>

        {loading ? (
          <div className="grid gap-3 p-4">
            {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded-2xl bg-slate-100" />)}
          </div>
        ) : summary?.hasData ? (
          activeTab === "agents" ? (
            <AgentTable rows={agentRows} totalRows={agentView?.rows.length ?? 0} sort={agentSort} onSort={toggleAgentSort} onSelect={setSelectedAgent} />
          ) : (
            <QueueTable rows={queueRows} totalRows={queueDataset?.totalRows ?? 0} columns={queueColumns} truncated={Boolean(queueDataset?.truncated)} returnedRows={queueDataset?.returnedRows ?? 0} />
          )
        ) : (
          <div className="px-4 py-16 text-center">
            <Database className="mx-auto h-10 w-10 text-blue-500" />
            <h2 className="mt-3 text-lg font-black text-navy-950">Nenhum snapshot importado</h2>
            <p className="mx-auto mt-1 max-w-lg text-sm font-bold text-muted">Assim que o script local enviar o primeiro arquivo KAP, os dados aparecem aqui.</p>
          </div>
        )}
      </section>

      {selectedAgent ? <AgentDetailDrawer row={selectedAgent} onClose={() => setSelectedAgent(null)} /> : null}
      {historyOpen ? <ImportHistoryModal imports={imports} loading={importsLoading} onClose={() => setHistoryOpen(false)} /> : null}
    </div>
  );
}

function AgentTable({
  rows,
  totalRows,
  sort,
  onSort,
  onSelect
}: {
  rows: AgentRealtimeRow[];
  totalRows: number;
  sort: AgentSortState;
  onSort: (key: AgentSortKey) => void;
  onSelect: (row: AgentRealtimeRow) => void;
}) {
  const columns: Array<{ label: string; sortKey?: AgentSortKey }> = [
    { label: "Agente", sortKey: "displayName" },
    { label: "WB/Login", sortKey: "wbLogin" },
    { label: "Cruzamento" },
    { label: "Status", sortKey: "employeeStatus" },
    { label: "LOB", sortKey: "lob" },
    { label: "Supervisor", sortKey: "supervisor" },
    { label: "Turno", sortKey: "shift" },
    { label: "Skill", sortKey: "skill" },
    { label: "Submit", sortKey: "submit" },
    { label: "AHT", sortKey: "aht" },
    { label: "Moderação", sortKey: "moderation" },
    { label: "Timeout", sortKey: "timeout" },
    { label: "Refresh", sortKey: "refresh" },
    { label: "Ações" }
  ];
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs font-black uppercase tracking-wide text-muted">
        <span>{rows.length} de {totalRows} agente(s) exibidos</span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[1220px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
            <tr>
              {columns.map((column) => (
                <th key={column.label} className="whitespace-nowrap px-4 py-3 font-black">
                  {column.sortKey ? (
                    <button type="button" onClick={() => onSort(column.sortKey!)} className="inline-flex items-center gap-1 rounded-lg px-1 py-0.5 text-left font-black transition hover:bg-blue-50 hover:text-blue-700">
                      {column.label}
                      <SortIndicator active={sort.key === column.sortKey} direction={sort.direction} />
                    </button>
                  ) : column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-slate-100 hover:bg-slate-50/70">
                <td className="px-4 py-3 font-extrabold text-navy-950">{row.displayName}</td>
                <td className="px-4 py-3 font-bold text-navy-950">{row.wbLogin || row.rawWbLogin || "-"}</td>
                <td className="px-4 py-3"><StatusPill value={row.crossingStatus} /></td>
                <td className="px-4 py-3 font-bold text-muted">{row.employeeStatus}</td>
                <td className="px-4 py-3 font-bold">{row.lob}</td>
                <td className="px-4 py-3 font-bold">{row.supervisor}</td>
                <td className="px-4 py-3 font-bold">{row.shift}</td>
                <td className="px-4 py-3 font-bold">{row.skill}</td>
                <td className="px-4 py-3 font-black text-navy-950">{formatInteger(row.current.submit)}</td>
                <td className="px-4 py-3 font-black text-navy-950">{formatDurationFromMs(row.current.ahtMs)}</td>
                <td className="px-4 py-3 font-black text-navy-950">{formatDurationFromMs(row.current.moderationMs)}</td>
                <td className="px-4 py-3 font-black text-navy-950">{formatInteger(row.current.timeout)}</td>
                <td className="px-4 py-3 font-black text-navy-950">{formatInteger(row.current.refresh)}</td>
                <td className="px-4 py-3">
                  <button type="button" onClick={() => onSelect(row)} className="premium-control inline-flex h-9 items-center gap-2 px-3 text-xs font-extrabold text-navy-950">
                    <Eye className="h-4 w-4" />
                    Detalhe
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-sm font-bold text-muted">
                  Nenhum agente ativo encontrado neste ciclo. Altere os filtros ou selecione outro ciclo para consultar os dados.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SortIndicator({ active, direction }: { active: boolean; direction: "asc" | "desc" }) {
  if (!active) return <span className="text-slate-300">↕</span>;
  return <span className="text-blue-700">{direction === "asc" ? "↑" : "↓"}</span>;
}

function QueueTable({ rows, totalRows, columns, truncated, returnedRows }: { rows: RealTimeRow[]; totalRows: number; columns: Array<{ key: string; label: string }>; truncated: boolean; returnedRows: number }) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs font-black uppercase tracking-wide text-muted">
        <span>{rows.length} de {totalRows} linha(s) exibidas</span>
        {truncated ? <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-800">Amostra limitada a {returnedRows} linhas</span> : null}
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
  );
}

function AgentDetailDrawer({ row, onClose }: { row: AgentRealtimeRow; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-navy-950/40">
      <div className="h-full w-full max-w-5xl overflow-y-auto bg-white p-5 shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-black text-navy-950">{row.displayName}</h2>
              <StatusPill value={row.crossingStatus} />
              <StatusPill value={row.personType} />
            </div>
            <p className="mt-1 text-sm font-bold text-muted">{row.wbLogin || row.rawWbLogin} · {row.lob} · {row.supervisor}</p>
          </div>
          <button type="button" onClick={onClose} className="premium-control inline-flex h-10 items-center gap-2 px-3 text-sm font-extrabold text-navy-950">
            <X className="h-4 w-4" />
            Fechar
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <SmallMetric title="Submit" value={formatInteger(row.current.submit)} previous={row.previous ? formatInteger(row.previous.submit) : "Sem comparação"} />
          <SmallMetric title="AHT" value={formatDurationFromMs(row.current.ahtMs)} previous={row.previous ? formatDurationFromMs(row.previous.ahtMs) : "Sem comparação"} />
          <SmallMetric title="Moderação" value={formatDurationFromMs(row.current.moderationMs)} previous={row.previous ? formatDurationFromMs(row.previous.moderationMs) : "Sem comparação"} />
          <SmallMetric title="Timeout" value={formatInteger(row.current.timeout)} previous={row.previous ? formatInteger(row.previous.timeout) : "Sem comparação"} />
          <SmallMetric title="Refresh" value={formatInteger(row.current.refresh)} previous={row.previous ? formatInteger(row.previous.refresh) : "Sem comparação"} />
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <div className="premium-card p-4">
            <h3 className="text-sm font-black uppercase tracking-wide text-muted">Cadastro</h3>
            <InfoLine label="Status" value={row.employeeStatus} />
            <InfoLine label="Cargo/Função" value={row.roleTitle} />
            <InfoLine label="Skill" value={row.skill} />
            <InfoLine label="Turno" value={row.shift} />
            <InfoLine label="LOB" value={row.lob} />
            <InfoLine label="Supervisor" value={row.supervisor} />
          </div>
          <div className="premium-card overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-3">
              <h3 className="font-black text-navy-950">Filas do ciclo</h3>
              <p className="text-xs font-bold text-muted">Detalhe consolidado por fila no ciclo selecionado.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                  <tr>{["Fila ID", "Nome da fila", "Submit", "AHT", "Moderação", "Timeout", "Refresh"].map((column) => <th key={column} className="px-3 py-2 font-black">{column}</th>)}</tr>
                </thead>
                <tbody>
                  {row.queueBreakdown.map((queue) => (
                    <tr key={`${queue.queueId || "sem-id"}-${queue.queueName}`} className="border-t border-slate-100">
                      <td className="px-3 py-3 font-extrabold">{queue.queueId || "Sem Fila ID"}</td>
                      <td className="px-3 py-3 font-extrabold">{queue.queueName}</td>
                      <td className="px-3 py-3 font-bold">{formatInteger(queue.submit)}</td>
                      <td className="px-3 py-3 font-bold">{formatDurationFromMs(queue.ahtMs)}</td>
                      <td className="px-3 py-3 font-bold">{formatDurationFromMs(queue.moderationMs)}</td>
                      <td className="px-3 py-3 font-bold">{formatInteger(queue.timeout)}</td>
                      <td className="px-3 py-3 font-bold">{formatInteger(queue.refresh)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="premium-card mt-5 overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3">
            <h3 className="font-black text-navy-950">Histórico por ciclo_download</h3>
            <p className="text-xs font-bold text-muted">Evolução do agente em todos os ciclos importados disponíveis.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                <tr>{["Ciclo", "Submit", "AHT", "Moderação", "Timeout", "Refresh"].map((column) => <th key={column} className="px-3 py-2 font-black">{column}</th>)}</tr>
              </thead>
              <tbody>
                {row.history.map((item) => (
                  <tr key={item.cycleDownload} className="border-t border-slate-100">
                    <td className="px-3 py-3 font-extrabold">{item.cycleDownload}</td>
                    <td className="px-3 py-3 font-bold">{formatInteger(item.submit)}</td>
                    <td className="px-3 py-3 font-bold">{formatDurationFromMs(item.ahtMs)}</td>
                    <td className="px-3 py-3 font-bold">{formatDurationFromMs(item.moderationMs)}</td>
                    <td className="px-3 py-3 font-bold">{formatInteger(item.timeout)}</td>
                    <td className="px-3 py-3 font-bold">{formatInteger(item.refresh)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="premium-control flex h-10 min-w-[220px] items-center gap-2 px-3 text-sm">
      <Search className="h-4 w-4 text-muted" />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full bg-transparent font-bold outline-none placeholder:text-muted/70" />
    </label>
  );
}

function FilterSelect({ value, onChange, label, empty, options }: { value: string; onChange: (value: string) => void; label: string; empty: string; options: CountItem[] }) {
  const hasCurrentValue = value && !options.some((option) => option.label === value);
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} className="premium-control h-10 max-w-[190px] px-3 text-sm font-bold text-navy-950 outline-none">
      <option value="">{empty}</option>
      {hasCurrentValue ? <option value={value}>{value}</option> : null}
      {options.map((option) => <option key={option.label} value={option.label}>{option.label} ({option.count})</option>)}
    </select>
  );
}

function ImportHistoryModal({ imports, loading, onClose }: { imports: ImportHistory[]; loading: boolean; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-navy-950/40">
      <div className="h-full w-full max-w-6xl overflow-y-auto bg-white p-5 shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-xl font-black text-navy-950">Histórico de importações</h2>
            <p className="mt-1 text-sm font-bold text-muted">Uploads diretos do Real Time, com resumo de WBs e Fila IDs.</p>
          </div>
          <button type="button" onClick={onClose} className="premium-control inline-flex h-10 items-center gap-2 px-3 text-sm font-extrabold text-navy-950">
            <X className="h-4 w-4" />
            Fechar
          </button>
        </div>
        {loading ? (
          <div className="grid gap-3 py-5">
            {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded-2xl bg-slate-100" />)}
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-[1180px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                <tr>{["Arquivo", "Ciclo", "Upload", "Linhas", "Válidas", "Erros", "Criados", "Atualizados", "WBs OK", "WBs não encontrados", "Filas OK", "Filas não mapeadas", "Status"].map((column) => <th key={column} className="px-3 py-2 font-black">{column}</th>)}</tr>
              </thead>
              <tbody>
                {imports.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="max-w-[220px] px-3 py-3 font-extrabold"><span title={item.fileName} className="block truncate">{item.fileName}</span></td>
                    <td className="px-3 py-3 font-bold">{item.cycleDownload || "-"}</td>
                    <td className="px-3 py-3 font-bold">{item.importedAtLabel}</td>
                    <td className="px-3 py-3 font-bold">{formatInteger(item.rowsTotal)}</td>
                    <td className="px-3 py-3 font-bold">{formatInteger(item.rowsValid)}</td>
                    <td className="px-3 py-3 font-bold">{formatInteger(item.rowsError)}</td>
                    <td className="px-3 py-3 font-bold">{formatInteger(item.rowsInserted)}</td>
                    <td className="px-3 py-3 font-bold">{formatInteger(item.rowsUpdated)}</td>
                    <td className="px-3 py-3 font-bold">{formatInteger(item.matchedEmployees)}</td>
                    <td className="px-3 py-3 font-bold">{formatInteger(item.unmatchedEmployees)}</td>
                    <td className="px-3 py-3 font-bold">{formatInteger(item.mappedQueues)}</td>
                    <td className="px-3 py-3 font-bold">{formatInteger(item.unmappedQueues)}</td>
                    <td className="px-3 py-3"><StatusPill value={item.status} /></td>
                  </tr>
                ))}
                {!imports.length ? (
                  <tr>
                    <td colSpan={13} className="px-3 py-12 text-center text-sm font-bold text-muted">Nenhuma importação encontrada.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function CompareCard({ card }: { card: AgentKpiCard }) {
  const tone = card.trend === "positive" ? "green" : card.trend === "negative" ? "orange" : "blue";
  const Icon = card.trend === "positive" ? CheckCircle2 : card.trend === "negative" ? AlertCircle : Activity;
  return (
    <div className="premium-card flex items-start justify-between gap-3 p-4">
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-muted">{card.label}</p>
        <p className="mt-1 text-2xl font-black text-navy-950">{card.value}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-black">
          {card.hasComparison ? <TrendBadge trend={card.trend} direction={card.direction} value={card.delta || "0"} /> : <span className="text-muted">Sem comparação</span>}
        </div>
      </div>
      <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl", toneClass(tone))}>
        <Icon className="h-5 w-5" />
      </span>
    </div>
  );
}

function buildFilteredAgentCards(rows: AgentRealtimeRow[]): AgentKpiCard[] {
  const current = summarizeMetrics(rows.map((row) => row.current));
  const previousMetrics = rows.map((row) => row.previous).filter((metric): metric is AgentMetric => Boolean(metric));
  const previous = previousMetrics.length ? summarizeMetrics(previousMetrics) : null;
  return [
    buildAgentKpiCard("Submit total", current.submit, previous?.submit ?? null, "number", "up"),
    buildAgentKpiCard("AHT médio", current.ahtMs, previous?.ahtMs ?? null, "duration", "down"),
    buildAgentKpiCard("Moderação total", current.moderationMs, previous?.moderationMs ?? null, "duration", "neutral"),
    buildAgentKpiCard("Timeout", current.timeout, previous?.timeout ?? null, "number", "down"),
    buildAgentKpiCard("Refresh", current.refresh, previous?.refresh ?? null, "number", "down")
  ];
}

function summarizeMetrics(metrics: AgentMetric[]) {
  const submit = metrics.reduce((sum, metric) => sum + metric.submit, 0);
  const weightedAht = metrics.reduce((sum, metric) => sum + (metric.ahtMs !== null ? metric.ahtMs * metric.submit : 0), 0);
  const simpleAhtMetrics = metrics.filter((metric) => metric.submit === 0 && metric.ahtMs !== null);
  const simpleAht = simpleAhtMetrics.reduce((sum, metric) => sum + (metric.ahtMs ?? 0), 0);
  return {
    submit,
    ahtMs: submit > 0 ? weightedAht / submit : simpleAhtMetrics.length ? simpleAht / simpleAhtMetrics.length : null,
    moderationMs: metrics.reduce((sum, metric) => sum + metric.moderationMs, 0),
    timeout: metrics.reduce((sum, metric) => sum + metric.timeout, 0),
    refresh: metrics.reduce((sum, metric) => sum + metric.refresh, 0)
  };
}

function buildAgentKpiCard(label: string, current: number | null, previous: number | null, format: "number" | "duration", positiveDirection: "up" | "down" | "neutral"): AgentKpiCard {
  const delta = current !== null && previous !== null ? current - previous : null;
  const isPositive = delta === null || delta === 0 || positiveDirection === "neutral" ? null : positiveDirection === "up" ? delta > 0 : delta < 0;
  return {
    label,
    value: format === "duration" ? formatDurationFromMs(current) : formatInteger(current ?? 0),
    delta: delta === null ? "" : format === "duration" ? formatDurationFromMs(Math.abs(delta)) : formatInteger(Math.abs(delta)),
    hasComparison: delta !== null,
    trend: isPositive === null ? "neutral" : isPositive ? "positive" : "negative",
    direction: delta === null || delta === 0 ? "none" : delta > 0 ? "up" : "down"
  };
}

function SmallMetric({ title, value, previous }: { title: string; value: string; previous: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-3">
      <p className="text-xs font-black uppercase tracking-wide text-muted">{title}</p>
      <p className="mt-1 text-xl font-black text-navy-950">{value}</p>
      <p className="mt-1 truncate text-xs font-bold text-muted" title={previous}>{previous}</p>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-black uppercase tracking-wide text-muted">{label}</p>
      <p className="text-sm font-extrabold text-navy-950">{value || "-"}</p>
    </div>
  );
}

function TrendBadge({ trend, direction, value }: { trend: "positive" | "negative" | "neutral"; direction: "up" | "down" | "none"; value: string }) {
  const Icon = direction === "up" ? ArrowUp : direction === "down" ? ArrowDown : Activity;
  const classes = trend === "positive" ? "bg-emerald-100 text-emerald-700" : trend === "negative" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700";
  return (
    <span className={cn("mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-black", classes)}>
      <Icon className="h-3 w-3" />
      {value}
    </span>
  );
}

function StatusPill({ value }: { value: string }) {
  const normalized = normalizeSearch(value);
  const tone = normalized.includes("encontrado") && !normalized.includes("nao")
    ? "bg-emerald-100 text-emerald-700"
    : normalized.includes("nao encontrado") || normalized.includes("offline") || normalized.includes("crit")
      ? "bg-red-100 text-red-700"
      : normalized.includes("staff") || normalized.includes("pausa") || normalized.includes("aten")
        ? "bg-amber-100 text-amber-800"
        : "bg-slate-100 text-slate-700";
  return <span className={cn("inline-flex max-w-[220px] rounded-full px-2.5 py-1 text-xs font-black", tone)} title={value}>{value || "-"}</span>;
}

function buildQueueColumns(rawColumns: string[]) {
  const rawSet = new Set(rawColumns.map(normalizeSearch));
  const known = (label: string) => rawSet.has(normalizeSearch(label));
  const base = [
    { key: "rowNumber", label: "#" },
    { key: "queueName", label: "Fila" },
    { key: "status", label: "Status" },
    ...["Recebidos", "Recebidos 30min", "Dentro SLA", "AHT médio", "Backlog", "Backlog timeout", "Aguardando coleta", "Agentes revisando", "Revisados", "Latência média", "Latência máx.", "Grupo"]
      .filter(known)
      .map((label) => ({ key: `raw:${label}`, label }))
  ].slice(0, 15);
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
  if (key.startsWith("raw:")) return formatValue(safeRawData(row.rawData)[key.slice(4)]);
  return "";
}

function safeRawData(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function formatValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatInteger(value: number) {
  return Math.round(value).toLocaleString("pt-BR");
}

function formatDurationFromMs(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  const totalSeconds = Math.max(0, Math.round(value / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}h`;
  if (minutes > 0) return `${minutes}:${String(seconds).padStart(2, "0")}m`;
  return `0:${String(seconds).padStart(2, "0")}s`;
}

function buildAgentQueryParams(cycleDownload: string, filters: AgentFilters) {
  const params = new URLSearchParams();
  if (cycleDownload) params.set("cycleDownload", cycleDownload);
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params;
}

function matchesEmployeeStatus(value: string, filter: string) {
  const normalizedValue = normalizeSearch(value);
  const normalizedFilter = normalizeSearch(filter);
  if (normalizedFilter === "ativo") return normalizedValue === "ativo" || normalizedValue === "active";
  return normalizedValue === normalizedFilter;
}

function compareAgentRows(a: AgentRealtimeRow, b: AgentRealtimeRow, sort: AgentSortState) {
  const textValue = (row: AgentRealtimeRow) => {
    if (sort.key === "displayName") return row.displayName;
    if (sort.key === "wbLogin") return row.wbLogin || row.rawWbLogin;
    if (sort.key === "employeeStatus") return row.employeeStatus;
    if (sort.key === "lob") return row.lob;
    if (sort.key === "supervisor") return row.supervisor;
    if (sort.key === "shift") return row.shift;
    if (sort.key === "skill") return row.skill;
    return row.displayName;
  };
  const numericValue = (row: AgentRealtimeRow) => {
    if (sort.key === "submit") return row.current.submit;
    if (sort.key === "aht") return row.current.ahtMs;
    if (sort.key === "moderation") return row.current.moderationMs;
    if (sort.key === "timeout") return row.current.timeout;
    if (sort.key === "refresh") return row.current.refresh;
    return null;
  };

  if (numericAgentSortKeys.has(sort.key)) {
    const left = numericValue(a);
    const right = numericValue(b);
    if (left === null && right === null) return a.displayName.localeCompare(b.displayName);
    if (left === null) return 1;
    if (right === null) return -1;
    const diff = sort.direction === "asc" ? left - right : right - left;
    return diff || a.displayName.localeCompare(b.displayName);
  }

  const diff = textValue(a).localeCompare(textValue(b), "pt-BR", { sensitivity: "base" });
  return (sort.direction === "asc" ? diff : -diff) || a.displayName.localeCompare(b.displayName);
}

function toneClass(tone: "blue" | "green" | "purple" | "orange") {
  return {
    blue: "bg-blue-50 text-blue-700",
    green: "bg-emerald-50 text-emerald-700",
    purple: "bg-violet-50 text-violet-700",
    orange: "bg-orange-50 text-orange-700"
  }[tone];
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}
