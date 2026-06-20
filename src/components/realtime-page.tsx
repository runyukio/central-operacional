"use client";

import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CheckCircle2,
  Database,
  Download,
  Eye,
  History,
  RefreshCw,
  Search,
  X,
  XCircle
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip as RechartsTooltip, YAxis } from "recharts";

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

type QueueStatus = "OK" | "Estável" | "Risco" | "Estourado" | "N/A";
type LatencyAdherenceStatus = "OK" | "Alerta" | "Estourado" | "N/A";

type QueueMetric = {
  input: number;
  output: number;
  ahtMs: number | null;
  latencyMs: number | null;
  maxLatencyMs: number | null;
  maxLatencyRowNumber?: number;
  backlog: number;
  sourceRows: number;
};

type QueueRealtimeRow = {
  key: string;
  queueId: string;
  queueName: string;
  lob: "ADS" | "VIDEO" | "COMMENTS" | "N/A";
  slaTargetMinutes: number | null;
  status: QueueStatus;
  current: QueueMetric;
  previous: QueueMetric | null;
  deltas: {
    input: number | null;
    output: number | null;
    ahtMs: number | null;
    latencyMs: number | null;
    maxLatencyMs: number | null;
    backlog: number | null;
  };
  history: Array<{
    cycleDownload: string;
    status: QueueStatus;
    input: number;
    output: number;
    ahtMs: number | null;
    latencyMs: number | null;
    maxLatencyMs: number | null;
    maxLatencyRowNumber?: number;
    backlog: number;
  }>;
};

type QueueRealtimeView = {
  cycles: Array<{ value: string; batchId?: string; importedAt: string; importedAtLabel: string; rows: number }>;
  selectedCycle: string;
  previousCycle: string;
  filters: {
    lobs: CountItem[];
    statuses: CountItem[];
    slaTargets: CountItem[];
    queueIds: CountItem[];
  };
  rows: QueueRealtimeRow[];
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
    queueIds: string[];
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
  cycles: Array<{ value: string; batchId?: string; importedAt: string; importedAtLabel: string; rows: number }>;
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
    queueView: QueueRealtimeView;
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
type MetricFormat = "number" | "duration";
type TrendPoint = { label: string; value: number | null; delta: number | null };
type AgentKpiCard = {
  label: string;
  value: string;
  delta: string;
  hasComparison: boolean;
  trend: "positive" | "negative" | "neutral";
  direction: "up" | "down" | "none";
  format: MetricFormat;
  history: TrendPoint[];
};

type QueueFilters = {
  search: string;
  lob: string;
  status: string;
  slaTarget: string;
  queueId: string;
};

type QueueSortKey = "status" | "lob" | "queueId" | "input" | "output" | "aht" | "latency" | "maxLatency" | "slaTarget" | "latencyAdherence" | "backlog";
type QueueSortState = { key: QueueSortKey; direction: "asc" | "desc" };
type QueueLobCardData = {
  lob: "ADS" | "VIDEO" | "COMMENTS";
  adherenceCounts: {
    ok: number;
    alerta: number;
    estourado: number;
  };
  backlog: AgentKpiCard;
  latency: AgentKpiCard;
  maxLatency: AgentKpiCard;
  aht: AgentKpiCard;
};

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
const defaultQueueFilters: QueueFilters = { search: "", lob: "MAPPED", status: "", slaTarget: "", queueId: "" };
const defaultQueueSort: QueueSortState = { key: "backlog", direction: "desc" };
const numericQueueSortKeys = new Set<QueueSortKey>(["input", "output", "aht", "latency", "maxLatency", "slaTarget", "backlog"]);

export function RealTimePage() {
  const [payload, setPayload] = useState<RealTimePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"agents" | "queues">("agents");
  const [selectedCycle, setSelectedCycle] = useState("");
  const [queueFilters, setQueueFilters] = useState<QueueFilters>(defaultQueueFilters);
  const [queueSort, setQueueSort] = useState<QueueSortState>(defaultQueueSort);
  const [agentFilters, setAgentFilters] = useState<AgentFilters>(defaultAgentFilters);
  const [agentSort, setAgentSort] = useState<AgentSortState>(defaultAgentSort);
  const [selectedAgent, setSelectedAgent] = useState<AgentRealtimeRow | null>(null);
  const [selectedQueue, setSelectedQueue] = useState<QueueRealtimeRow | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [imports, setImports] = useState<ImportHistory[]>([]);
  const [importsLoading, setImportsLoading] = useState(false);
  const snapshotAbortRef = useRef<AbortController | null>(null);

  async function loadSnapshot(cycle = selectedCycle, background = false, view: "agents" | "queues" = activeTab) {
    snapshotAbortRef.current?.abort();
    const controller = new AbortController();
    snapshotAbortRef.current = controller;
    if (background) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (cycle) params.set("cycleDownload", cycle);
      params.set("view", view);
      const response = await fetch(`/api/realtime?${params.toString()}`, { cache: "no-store", signal: controller.signal });
      const json = await response.json();
      if (!response.ok) throw new Error(json.message || json.error || "Não foi possível carregar Real Time.");
      const nextPayload = json as RealTimePayload;
      setPayload(nextPayload);
      const nextSelectedCycle = view === "queues" ? nextPayload.data.queueView.selectedCycle : nextPayload.data.agents.selectedCycle;
      if (nextSelectedCycle && (!cycle || nextSelectedCycle !== cycle)) setSelectedCycle(nextSelectedCycle);
    } catch (currentError) {
      if (currentError instanceof DOMException && currentError.name === "AbortError") return;
      setError(currentError instanceof Error ? currentError.message : "Não foi possível carregar Real Time.");
    } finally {
      if (snapshotAbortRef.current === controller) {
        snapshotAbortRef.current = null;
        setLoading(false);
        setRefreshing(false);
      }
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
    const params = activeTab === "queues"
      ? buildQueueQueryParams(selectedCycle || queueView?.selectedCycle || "", queueFilters)
      : buildAgentQueryParams(selectedCycle || agentView?.selectedCycle || "", agentFilters);
    params.set("view", activeTab);
    params.set("sortBy", activeTab === "queues" ? `${queueSort.key}_${queueSort.direction}` : `${agentSort.key}_${agentSort.direction}`);
    window.location.assign(`/api/realtime/export?${params.toString()}`);
  }

  useEffect(() => {
    void loadSnapshot(selectedCycle, false, activeTab);
    return () => {
      snapshotAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCycle, activeTab]);

  const summary = payload?.data.summary;
  const queueView = payload?.data.queueView;
  const agentView = payload?.data.agents;
  const queueRows = useMemo(() => {
    const sourceRows = queueView?.rows ?? [];
    const normalizedSearch = normalizeSearch(queueFilters.search);
    return sourceRows.filter((row) => {
      if (queueFilters.lob === "MAPPED" && row.lob === "N/A") return false;
      if (queueFilters.lob && queueFilters.lob !== "MAPPED" && row.lob !== queueFilters.lob) return false;
      if (queueFilters.status && row.status !== queueFilters.status) return false;
      if (queueFilters.slaTarget) {
        const target = row.slaTargetMinutes === null ? "Sem meta" : String(row.slaTargetMinutes);
        if (target !== queueFilters.slaTarget) return false;
      }
      if (queueFilters.queueId && (row.queueId || "Sem Fila ID") !== queueFilters.queueId) return false;
      if (!normalizedSearch) return true;
      return normalizeSearch([
        row.queueName,
        row.queueId,
        row.status,
        row.lob,
        row.slaTargetMinutes === null ? "" : String(row.slaTargetMinutes)
      ].join(" ")).includes(normalizedSearch);
    }).sort((a, b) => compareQueueRows(a, b, queueSort));
  }, [queueFilters, queueSort, queueView?.rows]);

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
        row.roleTitle,
        ...row.queueBreakdown.map((queue) => `${queue.queueId} ${queue.queueName}`)
      ].join(" ")).includes(normalizedSearch);
    }).sort((a, b) => compareAgentRows(a, b, agentSort));
  }, [agentFilters, agentSort, agentView?.rows]);

  const cycles = activeTab === "queues" ? queueView?.cycles ?? [] : agentView?.cycles ?? [];
  const selectedCycleExists = Boolean(selectedCycle && cycles.some((cycle) => cycle.value === selectedCycle));
  const selectedCycleValue = selectedCycleExists ? selectedCycle : (activeTab === "queues" ? queueView?.selectedCycle : agentView?.selectedCycle) || "";
  const selectedCycleIndex = cycles.findIndex((cycle) => cycle.value === selectedCycleValue);
  const olderCycle = selectedCycleIndex >= 0 ? cycles[selectedCycleIndex + 1]?.value ?? "" : "";
  const newerCycle = selectedCycleIndex > 0 ? cycles[selectedCycleIndex - 1]?.value ?? "" : "";
  const latestCycle = cycles[0]?.value ?? "";
  const latestBatchId = cycles[0]?.batchId ?? "";
  const latestImportedAt = cycles[0]?.importedAt ?? "";
  const filteredAgentCards = useMemo(() => buildFilteredAgentCards(agentRows, selectedCycleValue), [agentRows, selectedCycleValue]);
  const filteredQueueCards = useMemo(() => buildQueueLobCards(queueRows, selectedCycleValue), [queueRows, selectedCycleValue]);

  useEffect(() => {
    const interval = window.setInterval(async () => {
      try {
        const params = new URLSearchParams({ view: activeTab });
        const response = await fetch(`/api/realtime/latest?${params.toString()}`, { cache: "no-store" });
        const json = await response.json();
        if (!response.ok) throw new Error(json.message || json.error || "Não foi possível verificar atualização do Real Time.");
        const latest = activeTab === "queues" ? json.data?.queues : json.data?.agents;
        const latestCycleDownload = typeof latest?.cycleDownload === "string" ? latest.cycleDownload : "";
        const nextBatchId = typeof latest?.batchId === "string" ? latest.batchId : "";
        const nextImportedAt = typeof latest?.importedAt === "string" ? latest.importedAt : "";
        const sameKnownBatch = nextBatchId
          ? nextBatchId === latestBatchId
          : latestCycleDownload === latestCycle && nextImportedAt === latestImportedAt;
        if (!latestCycleDownload || sameKnownBatch) return;

        const shouldFollowLatest = !selectedCycleValue || selectedCycleValue === latestCycle;
        await loadSnapshot(shouldFollowLatest ? latestCycleDownload : selectedCycleValue, true, activeTab);
      } catch (currentError) {
        console.warn("[realtime] Auto-refresh leve falhou.", currentError);
      }
    }, 60000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, latestBatchId, latestCycle, latestImportedAt, selectedCycleValue]);

  function updateAgentFilter(key: keyof AgentFilters, value: string) {
    setAgentFilters((current) => ({ ...current, [key]: value }));
  }

  function toggleAgentSort(key: AgentSortKey) {
    setAgentSort((current) => {
      if (current.key === key) return { key, direction: current.direction === "desc" ? "asc" : "desc" };
      return { key, direction: numericAgentSortKeys.has(key) ? "desc" : "asc" };
    });
  }

  function updateQueueFilter(key: keyof QueueFilters, value: string) {
    setQueueFilters((current) => ({ ...current, [key]: value }));
  }

  function toggleQueueSort(key: QueueSortKey) {
    setQueueSort((current) => {
      if (current.key === key) return { key, direction: current.direction === "desc" ? "asc" : "desc" };
      return { key, direction: numericQueueSortKeys.has(key) ? "desc" : "asc" };
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

      <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-[260px] flex-1 text-xs font-black uppercase tracking-wide text-muted">
            ciclo_download
            <RealtimeCyclePicker value={selectedCycleValue} cycles={cycles} onChange={setSelectedCycle} />
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
            Comparação: {(activeTab === "queues" ? queueView?.previousCycle : agentView?.previousCycle) || "Sem ciclo anterior"}
          </div>
        </div>
      </section>

      {activeTab === "agents" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {filteredAgentCards.map((card) => (
            <KpiCard key={card.label} card={card} />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          {filteredQueueCards.map((card) => (
            <QueueLobCard key={card.lob} card={card} />
          ))}
        </div>
      )}

      <section className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-100 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-2xl bg-slate-100 p-1">
                <button type="button" onClick={() => setActiveTab("agents")} className={cn("rounded-xl px-4 py-2 text-sm font-black transition", activeTab === "agents" ? "bg-white text-blue-700 shadow-sm" : "text-muted")}>
                  Agentes
                </button>
                <button type="button" onClick={() => setActiveTab("queues")} className={cn("rounded-xl px-4 py-2 text-sm font-black transition", activeTab === "queues" ? "bg-white text-blue-700 shadow-sm" : "text-muted")}>
                  Filas
                </button>
              </div>
              {activeTab === "agents" ? (
                <AgentLobQuickFilter value={agentFilters.lob} onChange={(value) => updateAgentFilter("lob", value)} options={agentView?.filters.lobs ?? []} />
              ) : (
                <QueueLobQuickFilter value={queueFilters.lob} onChange={(value) => updateQueueFilter("lob", value)} options={queueView?.filters.lobs ?? []} />
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={activeTab === "agents" ? () => setAgentFilters(defaultAgentFilters) : () => setQueueFilters(defaultQueueFilters)} className="premium-control h-10 px-3 text-sm font-extrabold text-navy-950">Filtros padrão</button>
              <button type="button" onClick={activeTab === "agents" ? () => setAgentFilters(emptyAgentFilters) : () => setQueueFilters({ search: "", lob: "", status: "", slaTarget: "", queueId: "" })} className="premium-control h-10 px-3 text-sm font-extrabold text-navy-950">Limpar</button>
            </div>
          </div>
          {activeTab === "agents" ? (
            <div className="mt-4 grid gap-2 rounded-3xl border border-slate-100 bg-slate-50/70 p-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
              <SearchBox value={agentFilters.search} onChange={(value) => updateAgentFilter("search", value)} placeholder="Buscar agente ou WB..." />
              <FilterSelect value={agentFilters.crossingStatus} onChange={(value) => updateAgentFilter("crossingStatus", value)} label="Cruzamento" empty="Todos" options={agentView?.filters.crossingStatuses ?? []} />
              <FilterSelect value={agentFilters.personType} onChange={(value) => updateAgentFilter("personType", value)} label="Tipo" empty="Todos" options={agentView?.filters.personTypes ?? []} />
              <FilterSelect value={agentFilters.employeeStatus} onChange={(value) => updateAgentFilter("employeeStatus", value)} label="Status" empty="Todos" options={agentView?.filters.employeeStatuses ?? []} />
              <FilterSelect value={agentFilters.supervisor} onChange={(value) => updateAgentFilter("supervisor", value)} label="Supervisor" empty="Todos" options={agentView?.filters.supervisors ?? []} />
              <FilterSelect value={agentFilters.shift} onChange={(value) => updateAgentFilter("shift", value)} label="Turno" empty="Todos" options={agentView?.filters.shifts ?? []} />
              <FilterSelect value={agentFilters.skill} onChange={(value) => updateAgentFilter("skill", value)} label="Skill" empty="Todas" options={agentView?.filters.skills ?? []} />
              <FilterSelect value={agentFilters.roleTitle} onChange={(value) => updateAgentFilter("roleTitle", value)} label="Cargo" empty="Todos" options={agentView?.filters.roleTitles ?? []} />
            </div>
          ) : (
            <div className="mt-4 grid gap-2 rounded-3xl border border-slate-100 bg-slate-50/70 p-3 sm:grid-cols-2 lg:grid-cols-4">
              <SearchBox value={queueFilters.search} onChange={(value) => updateQueueFilter("search", value)} placeholder="Buscar ID ou nome da fila..." />
              <FilterSelect value={queueFilters.status} onChange={(value) => updateQueueFilter("status", value)} label="Status" empty="Todos" options={queueView?.filters.statuses ?? []} />
              <FilterSelect value={queueFilters.slaTarget} onChange={(value) => updateQueueFilter("slaTarget", value)} label="Meta SLA" empty="Todas" options={queueView?.filters.slaTargets ?? []} formatOptionLabel={formatSlaTargetLabel} />
              <FilterSelect value={queueFilters.queueId} onChange={(value) => updateQueueFilter("queueId", value)} label="Fila ID" empty="Todas" options={queueView?.filters.queueIds ?? []} />
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
            <StructuredQueueTable rows={queueRows} totalRows={queueView?.rows.length ?? 0} sort={queueSort} onSort={toggleQueueSort} onSelect={setSelectedQueue} />
          )
        ) : (
          <div className="px-4 py-16 text-center">
            <Database className="mx-auto h-10 w-10 text-blue-500" />
            <h2 className="mt-3 text-lg font-black text-navy-950">Nenhum snapshot importado</h2>
            <p className="mx-auto mt-1 max-w-lg text-sm font-bold text-muted">Assim que o script local enviar o primeiro arquivo KAP, os dados aparecem aqui.</p>
          </div>
        )}
      </section>

      {selectedAgent ? <AgentDetailDrawer row={selectedAgent} selectedCycle={selectedCycleValue} onClose={() => setSelectedAgent(null)} /> : null}
      {selectedQueue ? <QueueDetailDrawer row={selectedQueue} onClose={() => setSelectedQueue(null)} /> : null}
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
    { label: "Status", sortKey: "employeeStatus" },
    { label: "LOB", sortKey: "lob" },
    { label: "Supervisor", sortKey: "supervisor" },
    { label: "Turno", sortKey: "shift" },
    { label: "Skill", sortKey: "skill" },
    { label: "Fila ID" },
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
        <table className="w-full min-w-[1320px] border-separate border-spacing-0 text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50/95 text-xs uppercase tracking-wide text-muted backdrop-blur">
            <tr className="border-b border-slate-100">
              <th colSpan={3} className="border-b border-slate-100 px-4 py-2 font-black text-blue-700">Identificação</th>
              <th colSpan={5} className="border-b border-slate-100 px-4 py-2 font-black text-violet-700">Operação</th>
              <th colSpan={5} className="border-b border-slate-100 px-4 py-2 font-black text-emerald-700">Performance</th>
              <th className="border-b border-slate-100 px-4 py-2 font-black text-slate-600">Ação</th>
            </tr>
            <tr>
              {columns.map((column) => (
                <th key={column.label} className="whitespace-nowrap border-b border-slate-100 px-4 py-3 font-black">
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
            {rows.map((row, index) => (
              <tr key={row.key} className={cn("border-t border-slate-100 transition hover:bg-blue-50/60", index % 2 ? "bg-slate-50/35" : "bg-white")}>
                <td className="px-4 py-3 font-extrabold text-navy-950">{row.displayName}</td>
                <td className="px-4 py-3 font-bold text-navy-950">{row.wbLogin || row.rawWbLogin || "-"}</td>
                <td className="px-4 py-3 font-bold text-muted">{row.employeeStatus}</td>
                <td className="px-4 py-3 font-bold">{row.lob}</td>
                <td className="px-4 py-3 font-bold">{row.supervisor}</td>
                <td className="px-4 py-3 font-bold">{row.shift}</td>
                <td className="px-4 py-3 font-bold">{row.skill}</td>
                <td className="px-4 py-3"><QueueIdCell queues={row.queueBreakdown} /></td>
                <td className="px-4 py-3"><AgentMetricCell current={row.current.submit} previous={row.previous?.submit ?? null} format="number" positiveDirection="up" /></td>
                <td className="px-4 py-3"><AgentMetricCell current={row.current.ahtMs} previous={row.previous?.ahtMs ?? null} format="duration" positiveDirection="down" /></td>
                <td className="px-4 py-3"><AgentMetricCell current={row.current.moderationMs} previous={row.previous?.moderationMs ?? null} format="duration" positiveDirection="neutral" /></td>
                <td className="px-4 py-3"><AgentMetricCell current={row.current.timeout} previous={row.previous?.timeout ?? null} format="number" positiveDirection="down" /></td>
                <td className="px-4 py-3"><AgentMetricCell current={row.current.refresh} previous={row.previous?.refresh ?? null} format="number" positiveDirection="down" /></td>
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

function QueueIdCell({ queues }: { queues: AgentRealtimeRow["queueBreakdown"] }) {
  const queueIds = Array.from(new Set(queues.map((queue) => queue.queueId).filter(Boolean)));
  const title = queueIds.length
    ? queueIds.map((queueId) => {
      const queueName = queues.find((queue) => queue.queueId === queueId)?.queueName;
      return queueName ? `${queueId} - ${queueName}` : queueId;
    }).join("\n")
    : "Sem Fila ID";

  if (!queueIds.length) {
    return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">Sem Fila ID</span>;
  }

  return (
    <div title={title} className="flex max-w-[150px] flex-col gap-1">
      {queueIds.slice(0, 2).map((queueId) => (
        <span key={queueId} className="w-fit rounded-full bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-700">
          {queueId}
        </span>
      ))}
      {queueIds.length > 2 ? (
        <span className="text-[11px] font-black text-muted">+{queueIds.length - 2} fila(s)</span>
      ) : null}
    </div>
  );
}

function HistoryQueueIdsCell({ queueIds }: { queueIds: string[] }) {
  const uniqueIds = Array.from(new Set(queueIds.filter(Boolean)));
  if (!uniqueIds.length) {
    return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">Sem Fila ID</span>;
  }

  return (
    <div title={uniqueIds.join("\n")} className="flex max-w-[150px] flex-col gap-1">
      {uniqueIds.slice(0, 2).map((queueId) => (
        <span key={queueId} className="w-fit rounded-full bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-700">
          {queueId}
        </span>
      ))}
      {uniqueIds.length > 2 ? (
        <span className="text-[11px] font-black text-muted">+{uniqueIds.length - 2} fila(s)</span>
      ) : null}
    </div>
  );
}

function AgentMetricCell({
  current,
  previous,
  format,
  positiveDirection
}: {
  current: number | null;
  previous: number | null;
  format: "number" | "duration";
  positiveDirection: "up" | "down" | "neutral";
}) {
  const delta = current !== null && previous !== null ? current - previous : null;
  const isPositive = delta === null || positiveDirection === "neutral" ? null : delta === 0 ? true : positiveDirection === "up" ? delta > 0 : delta < 0;
  const value = format === "duration" ? formatDurationFromMs(current) : formatInteger(current ?? 0);
  const deltaValue = delta === null ? "" : format === "duration" ? formatDurationFromMs(Math.abs(delta)) : formatInteger(Math.abs(delta));
  const trend = isPositive === null ? "neutral" : isPositive ? "positive" : "negative";
  const direction = delta === null || delta === 0 ? "none" : delta > 0 ? "up" : "down";

  return (
    <div className="min-w-[84px]">
      <p className="font-black text-navy-950">{value}</p>
      {delta === null ? (
        <p className="mt-1 text-[11px] font-black text-muted">Sem comparação</p>
      ) : (
        <TrendBadge trend={trend} direction={direction} value={deltaValue || "0"} />
      )}
    </div>
  );
}

function StructuredQueueTable({
  rows,
  totalRows,
  sort,
  onSort,
  onSelect
}: {
  rows: QueueRealtimeRow[];
  totalRows: number;
  sort: QueueSortState;
  onSort: (key: QueueSortKey) => void;
  onSelect: (row: QueueRealtimeRow) => void;
}) {
  const columns: Array<{ label: string; sortKey?: QueueSortKey }> = [
    { label: "LOB", sortKey: "lob" },
    { label: "ID", sortKey: "queueId" },
    { label: "Input", sortKey: "input" },
    { label: "Output", sortKey: "output" },
    { label: "AHT", sortKey: "aht" },
    { label: "Latência", sortKey: "latency" },
    { label: "Max Latência", sortKey: "maxLatency" },
    { label: "Meta Latência", sortKey: "slaTarget" },
    { label: "Aderência Latência", sortKey: "latencyAdherence" },
    { label: "Backlog", sortKey: "backlog" },
    { label: "Ações" }
  ];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs font-black uppercase tracking-wide text-muted">
        <span>{rows.length} de {totalRows} fila(s) exibidas</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1320px] border-separate border-spacing-0 text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50/95 text-xs uppercase tracking-wide text-muted backdrop-blur">
            <tr>
              {columns.map((column) => (
                <th key={column.label} className="whitespace-nowrap border-b border-slate-100 px-4 py-3 font-black">
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
            {rows.map((row, index) => (
              <tr key={row.key} className={cn("border-t border-slate-100 transition hover:bg-blue-50/60", index % 2 ? "bg-slate-50/35" : "bg-white")}>
                <td className="px-4 py-3 font-extrabold text-navy-950">{row.lob}</td>
                <td className="px-4 py-3"><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-700">{row.queueId || "Sem Fila ID"}</span></td>
                <td className="px-4 py-3"><AgentMetricCell current={row.current.input} previous={row.previous?.input ?? null} format="number" positiveDirection="neutral" /></td>
                <td className="px-4 py-3"><AgentMetricCell current={row.current.output} previous={row.previous?.output ?? null} format="number" positiveDirection="up" /></td>
                <td className="px-4 py-3"><AgentMetricCell current={row.current.ahtMs} previous={row.previous?.ahtMs ?? null} format="duration" positiveDirection="down" /></td>
                <td className="px-4 py-3"><AgentMetricCell current={row.current.latencyMs} previous={row.previous?.latencyMs ?? null} format="duration" positiveDirection="down" /></td>
                <td className="px-4 py-3"><AgentMetricCell current={row.current.maxLatencyMs} previous={row.previous?.maxLatencyMs ?? null} format="duration" positiveDirection="down" /></td>
                <td className="px-4 py-3"><LatencyTargetCell minutes={row.slaTargetMinutes} /></td>
                <td className="px-4 py-3"><LatencyAdherencePill status={resolveLatencyAdherence(row.current.maxLatencyMs, row.slaTargetMinutes)} /></td>
                <td className="px-4 py-3"><AgentMetricCell current={row.current.backlog} previous={row.previous?.backlog ?? null} format="number" positiveDirection="down" /></td>
                <td className="px-4 py-3">
                  <button type="button" onClick={() => onSelect(row)} className="premium-control inline-flex h-9 items-center gap-2 px-3 text-xs font-extrabold text-navy-950">
                    <Eye className="h-4 w-4" />
                    Detalhar
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-sm font-bold text-muted">Nenhuma fila encontrada para os filtros aplicados.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

function QueueStatusPill({ status }: { status: QueueStatus }) {
  const tone = status === "OK"
    ? "bg-emerald-100 text-emerald-700"
    : status === "Estável"
      ? "bg-blue-100 text-blue-700"
      : status === "Risco"
        ? "bg-amber-100 text-amber-800"
        : status === "Estourado"
          ? "bg-red-100 text-red-700"
          : "bg-slate-100 text-slate-700";
  return <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-black", tone)}>{status}</span>;
}

function resolveLatencyAdherence(maxLatencyMs: number | null, slaTargetMinutes: number | null): LatencyAdherenceStatus {
  if (maxLatencyMs === null || !slaTargetMinutes || slaTargetMinutes <= 0) return "N/A";
  const targetMs = slaTargetMinutes * 60 * 1000;
  const adherenceRatio = maxLatencyMs / targetMs;
  if (adherenceRatio < 0.7) return "OK";
  if (adherenceRatio < 1) return "Alerta";
  return "Estourado";
}

function latencyAdherenceSeverity(status: LatencyAdherenceStatus) {
  if (status === "Estourado") return 3;
  if (status === "Alerta") return 2;
  if (status === "OK") return 1;
  return 0;
}

function LatencyTargetCell({ minutes }: { minutes: number | null }) {
  return (
    <div className="min-w-[92px]">
      <p className="font-black text-navy-950">{minutes === null ? "Sem meta" : formatSlaTargetLabel(String(minutes))}</p>
      <p className="mt-1 text-[11px] font-black uppercase tracking-wide text-muted">meta</p>
    </div>
  );
}

function LatencyAdherencePill({ status }: { status: LatencyAdherenceStatus }) {
  const config = status === "OK"
    ? { className: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 }
    : status === "Alerta"
      ? { className: "bg-amber-100 text-amber-800", icon: AlertTriangle }
      : status === "Estourado"
        ? { className: "bg-red-100 text-red-700", icon: XCircle }
        : { className: "bg-slate-100 text-slate-700", icon: Activity };
  const Icon = config.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-black", config.className)}>
      <Icon className="h-3.5 w-3.5" />
      {status}
    </span>
  );
}

function RealtimeCyclePicker({
  value,
  cycles,
  onChange
}: {
  value: string;
  cycles: Array<{ value: string; batchId?: string; importedAt: string; importedAtLabel: string; rows: number }>;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const parsedCycles = useMemo(() => cycles.map((cycle) => ({ ...cycle, ...parseRealtimeCycle(cycle.value, cycle.importedAt) })), [cycles]);
  const selected = parsedCycles.find((cycle) => cycle.value === value) ?? parsedCycles[0];
  const selectedDate = selected?.date;
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(selected?.date ?? new Date()));

  useEffect(() => {
    if (selectedDate) setVisibleMonth(startOfMonth(selectedDate));
  }, [selectedDate]);

  const cyclesByDate = useMemo(() => {
    const map = new Map<string, typeof parsedCycles>();
    parsedCycles.forEach((cycle) => {
      const current = map.get(cycle.dateKey) ?? [];
      current.push(cycle);
      map.set(cycle.dateKey, current);
    });
    map.forEach((items) => items.sort((a, b) => b.timestamp - a.timestamp));
    return map;
  }, [parsedCycles]);
  const selectedDateKey = selected?.dateKey ?? formatDateKey(new Date());
  const selectedDayCycles = cyclesByDate.get(selectedDateKey) ?? [];
  const visibleCells = buildCalendarCells(visibleMonth);

  return (
    <div className="relative mt-1">
      <button type="button" onClick={() => setOpen((current) => !current)} className="premium-control flex h-11 w-full items-center justify-between gap-2 px-3 text-left text-sm font-extrabold text-navy-950">
        <span className="flex min-w-0 items-center gap-2">
          <CalendarDays className="h-4 w-4 shrink-0 text-blue-600" />
          <span className="truncate">{selected ? `${formatDateShort(selected.date)} - ${selected.timeLabel}` : "Selecione um ciclo"}</span>
        </span>
        <span className="text-xs font-black text-muted">{open ? "▲" : "▼"}</span>
      </button>
      {open ? (
        <div className="absolute left-0 top-12 z-40 grid w-[min(720px,calc(100vw-2rem))] gap-0 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl md:grid-cols-[minmax(0,1fr)_220px]">
          <div className="p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-lg font-black capitalize text-navy-950">{new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(visibleMonth)}</p>
                <p className="text-xs font-bold text-muted">Escolha o dia do ciclo</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setVisibleMonth(addMonths(visibleMonth, -1))} className="premium-control grid h-9 w-9 place-items-center text-sm font-black text-navy-950">‹</button>
                <button type="button" onClick={() => setVisibleMonth(startOfMonth(new Date()))} className="premium-control h-9 px-3 text-xs font-black text-navy-950">Hoje</button>
                <button type="button" onClick={() => setVisibleMonth(addMonths(visibleMonth, 1))} className="premium-control grid h-9 w-9 place-items-center text-sm font-black text-navy-950">›</button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-black uppercase text-muted">
              {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((day) => <span key={day} className="py-1">{day}</span>)}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {visibleCells.map((cell) => {
                const key = formatDateKey(cell.date);
                const hasCycle = cyclesByDate.has(key);
                const isSelected = key === selectedDateKey;
                const isCurrentMonth = cell.date.getMonth() === visibleMonth.getMonth();
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={!hasCycle}
                    onClick={() => {
                      const firstCycle = cyclesByDate.get(key)?.[0];
                      if (firstCycle) onChange(firstCycle.value);
                    }}
                    className={cn(
                      "aspect-square rounded-2xl text-sm font-black transition",
                      isSelected ? "bg-navy-950 text-white" : hasCycle ? "hover:bg-blue-50 hover:text-blue-700" : "cursor-not-allowed text-slate-300",
                      !isCurrentMonth && "opacity-50"
                    )}
                  >
                    {cell.date.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="border-t border-slate-100 bg-slate-50 p-3 md:border-l md:border-t-0">
            <p className="mb-2 text-xs font-black uppercase tracking-wide text-muted">Horários disponíveis</p>
            <div className="max-h-[340px] space-y-1 overflow-y-auto pr-1">
              {selectedDayCycles.map((cycle) => (
                <button
                  key={cycle.value}
                  type="button"
                  onClick={() => {
                    onChange(cycle.value);
                    setOpen(false);
                  }}
                  className={cn("w-full rounded-2xl px-3 py-2 text-left text-sm font-black transition", value === cycle.value ? "bg-blue-600 text-white" : "bg-white hover:bg-blue-50 hover:text-blue-700")}
                >
                  <span className="block">{cycle.timeLabel}</span>
                  <span className={cn("text-[11px] font-bold", value === cycle.value ? "text-blue-100" : "text-muted")}>{cycle.rows} linha(s)</span>
                </button>
              ))}
              {!selectedDayCycles.length ? <p className="rounded-2xl bg-white px-3 py-6 text-center text-sm font-bold text-muted">Nenhum ciclo neste dia.</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AgentDetailDrawer({ row, selectedCycle, onClose }: { row: AgentRealtimeRow; selectedCycle: string; onClose: () => void }) {
  const defaultDateKey = parseRealtimeCycle(selectedCycle || row.history[0]?.cycleDownload || "", "").dateKey;
  const [selectedHistoryDateKey, setSelectedHistoryDateKey] = useState(defaultDateKey);
  const historyDates = useMemo(() => {
    const byDate = new Map<string, { dateKey: string; label: string; count: number; timestamp: number }>();
    row.history.forEach((item) => {
      const parsed = parseRealtimeCycle(item.cycleDownload, "");
      const existing = byDate.get(parsed.dateKey);
      if (existing) {
        existing.count += 1;
        existing.timestamp = Math.max(existing.timestamp, parsed.timestamp);
      } else {
        byDate.set(parsed.dateKey, {
          dateKey: parsed.dateKey,
          label: formatDateShort(parsed.date),
          count: 1,
          timestamp: parsed.timestamp
        });
      }
    });
    return Array.from(byDate.values()).sort((a, b) => b.timestamp - a.timestamp);
  }, [row.history]);
  const filteredHistory = useMemo(() => row.history.filter((item) => parseRealtimeCycle(item.cycleDownload, "").dateKey === selectedHistoryDateKey), [row.history, selectedHistoryDateKey]);

  useEffect(() => {
    setSelectedHistoryDateKey(defaultDateKey);
  }, [defaultDateKey, row.key]);

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
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div>
              <h3 className="font-black text-navy-950">Histórico por ciclo_download</h3>
              <p className="text-xs font-bold text-muted">Evolução do agente no dia selecionado.</p>
            </div>
            <select
              value={selectedHistoryDateKey}
              onChange={(event) => setSelectedHistoryDateKey(event.target.value)}
              aria-label="Data do histórico"
              className="premium-control h-10 min-w-[180px] px-3 text-sm font-bold text-navy-950 outline-none"
            >
              {historyDates.map((date) => (
                <option key={date.dateKey} value={date.dateKey}>{date.label} ({date.count})</option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                <tr>{["Ciclo", "Fila ID", "Submit", "AHT", "Moderação", "Timeout", "Refresh"].map((column) => <th key={column} className="px-3 py-2 font-black">{column}</th>)}</tr>
              </thead>
              <tbody>
                {filteredHistory.map((item) => (
                  <tr key={item.cycleDownload} className="border-t border-slate-100">
                    <td className="px-3 py-3 font-extrabold">{item.cycleDownload}</td>
                    <td className="px-3 py-3"><HistoryQueueIdsCell queueIds={item.queueIds ?? []} /></td>
                    <td className="px-3 py-3 font-bold">{formatInteger(item.submit)}</td>
                    <td className="px-3 py-3 font-bold">{formatDurationFromMs(item.ahtMs)}</td>
                    <td className="px-3 py-3 font-bold">{formatDurationFromMs(item.moderationMs)}</td>
                    <td className="px-3 py-3 font-bold">{formatInteger(item.timeout)}</td>
                    <td className="px-3 py-3 font-bold">{formatInteger(item.refresh)}</td>
                  </tr>
                ))}
                {!filteredHistory.length ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-sm font-bold text-muted">Nenhum ciclo encontrado para esta data.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function QueueDetailDrawer({ row, onClose }: { row: QueueRealtimeRow; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-navy-950/40">
      <div className="h-full w-full max-w-5xl overflow-y-auto bg-white p-5 shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-black text-navy-950">{row.queueName}</h2>
              <QueueStatusPill status={row.status} />
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-700">{row.lob}</span>
            </div>
            <p className="mt-1 text-sm font-bold text-muted">
              Fila ID {row.queueId || "Sem Fila ID"} · Meta SLA {row.slaTargetMinutes === null ? "Sem meta" : `${row.slaTargetMinutes} min`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="premium-control inline-flex h-10 items-center gap-2 px-3 text-sm font-extrabold text-navy-950">
            <X className="h-4 w-4" />
            Fechar
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SmallMetric title="Input" value={formatInteger(row.current.input)} previous={row.previous ? formatInteger(row.previous.input) : "Sem comparação"} />
          <SmallMetric title="Output" value={formatInteger(row.current.output)} previous={row.previous ? formatInteger(row.previous.output) : "Sem comparação"} />
          <SmallMetric title="AHT" value={formatDurationFromMs(row.current.ahtMs)} previous={row.previous ? formatDurationFromMs(row.previous.ahtMs) : "Sem comparação"} />
          <SmallMetric title="Latência" value={formatDurationFromMs(row.current.latencyMs)} previous={row.previous ? formatDurationFromMs(row.previous.latencyMs) : "Sem comparação"} />
          <SmallMetric title="Max Latência" value={formatDurationFromMs(row.current.maxLatencyMs)} previous={row.previous ? formatDurationFromMs(row.previous.maxLatencyMs) : "Sem comparação"} />
          <SmallMetric title="Meta Latência" value={row.slaTargetMinutes === null ? "Sem meta" : formatSlaTargetLabel(String(row.slaTargetMinutes))} previous="referência da fila" />
          <SmallMetric title="Backlog" value={formatInteger(row.current.backlog)} previous={row.previous ? formatInteger(row.previous.backlog) : "Sem comparação"} />
          <div className="premium-card p-4">
            <p className="text-xs font-black uppercase tracking-wide text-muted">Aderência Latência</p>
            <div className="mt-3"><LatencyAdherencePill status={resolveLatencyAdherence(row.current.maxLatencyMs, row.slaTargetMinutes)} /></div>
            <p className="mt-2 text-xs font-bold text-muted">Max Latência vs meta</p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="premium-card p-4">
            <h3 className="text-sm font-black uppercase tracking-wide text-muted">Detalhes da fila</h3>
            <InfoLine label="ID da fila" value={row.queueId || "Sem Fila ID"} />
            <InfoLine label="Nome da fila" value={row.queueName} />
            <InfoLine label="LOB" value={row.lob} />
            <InfoLine label="Meta SLA" value={row.slaTargetMinutes === null ? "Sem meta" : `${row.slaTargetMinutes} min`} />
            <InfoLine label="Status" value={row.status} />
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
              <span className="text-xs font-black uppercase tracking-wide text-muted">Aderência Latência</span>
              <LatencyAdherencePill status={resolveLatencyAdherence(row.current.maxLatencyMs, row.slaTargetMinutes)} />
            </div>
          </div>
          <div className="premium-card overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-3">
              <h3 className="font-black text-navy-950">Comparativo do ciclo</h3>
              <p className="text-xs font-bold text-muted">Delta compacto contra o ciclo imediatamente anterior.</p>
            </div>
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-5">
              <AgentMetricCell current={row.current.input} previous={row.previous?.input ?? null} format="number" positiveDirection="neutral" />
              <AgentMetricCell current={row.current.output} previous={row.previous?.output ?? null} format="number" positiveDirection="up" />
              <AgentMetricCell current={row.current.ahtMs} previous={row.previous?.ahtMs ?? null} format="duration" positiveDirection="down" />
              <AgentMetricCell current={row.current.latencyMs} previous={row.previous?.latencyMs ?? null} format="duration" positiveDirection="down" />
              <AgentMetricCell current={row.current.maxLatencyMs} previous={row.previous?.maxLatencyMs ?? null} format="duration" positiveDirection="down" />
              <AgentMetricCell current={row.current.backlog} previous={row.previous?.backlog ?? null} format="number" positiveDirection="down" />
            </div>
          </div>
        </div>

        <div className="premium-card mt-5 overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3">
            <h3 className="font-black text-navy-950">Histórico por ciclo_download</h3>
            <p className="text-xs font-bold text-muted">Evolução de backlog, latência, AHT, input e output por ciclo.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                <tr>{["Ciclo", "Status", "Input", "Output", "AHT", "Latência", "Max Latência", "Meta Latência", "Aderência", "Backlog"].map((column) => <th key={column} className="px-3 py-2 font-black">{column}</th>)}</tr>
              </thead>
              <tbody>
                {row.history.map((item) => (
                  <tr key={item.cycleDownload} className="border-t border-slate-100">
                    <td className="px-3 py-3 font-extrabold">{item.cycleDownload}</td>
                    <td className="px-3 py-3"><QueueStatusPill status={item.status} /></td>
                    <td className="px-3 py-3 font-bold">{formatInteger(item.input)}</td>
                    <td className="px-3 py-3 font-bold">{formatInteger(item.output)}</td>
                    <td className="px-3 py-3 font-bold">{formatDurationFromMs(item.ahtMs)}</td>
                    <td className="px-3 py-3 font-bold">{formatDurationFromMs(item.latencyMs)}</td>
                    <td className="px-3 py-3 font-bold">{formatDurationFromMs(item.maxLatencyMs)}</td>
                    <td className="px-3 py-3 font-bold">{row.slaTargetMinutes === null ? "Sem meta" : formatSlaTargetLabel(String(row.slaTargetMinutes))}</td>
                    <td className="px-3 py-3"><LatencyAdherencePill status={resolveLatencyAdherence(item.maxLatencyMs, row.slaTargetMinutes)} /></td>
                    <td className="px-3 py-3 font-bold">{formatInteger(item.backlog)}</td>
                  </tr>
                ))}
                {!row.history.length ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-10 text-center text-sm font-bold text-muted">Sem histórico disponível para esta fila.</td>
                  </tr>
                ) : null}
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
    <label className="premium-control flex h-10 min-w-0 items-center gap-2 px-3 text-sm">
      <Search className="h-4 w-4 text-muted" />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full bg-transparent font-bold outline-none placeholder:text-muted/70" />
    </label>
  );
}

function FilterSelect({
  value,
  onChange,
  label,
  empty,
  options,
  formatOptionLabel = (optionLabel: string) => optionLabel
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  empty: string;
  options: CountItem[];
  formatOptionLabel?: (optionLabel: string) => string;
}) {
  const hasCurrentValue = value && !options.some((option) => option.label === value);
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} className="premium-control h-10 w-full min-w-0 px-3 text-sm font-bold text-navy-950 outline-none">
      <option value="">{empty}</option>
      {hasCurrentValue ? <option value={value}>{formatOptionLabel(value)}</option> : null}
      {options.map((option) => <option key={option.label} value={option.label}>{formatOptionLabel(option.label)} ({option.count})</option>)}
    </select>
  );
}

function AgentLobQuickFilter({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: CountItem[] }) {
  const counts = new Map(options.map((option) => [option.label, option.count]));
  const totalCount = options.reduce((sum, option) => sum + option.count, 0);
  const preferredOrder = ["ADS", "CEC", "TNS", "VIDEO", "COMMENTS"];
  const orderedLabels = Array.from(new Set([
    ...preferredOrder.filter((label) => counts.has(label)),
    ...options.map((option) => option.label).filter((label) => !preferredOrder.includes(label))
  ]));
  const orderedOptions: Array<CountItem & { value: string }> = [
    { label: "Todas", value: "", count: totalCount },
    ...orderedLabels.map((label) => ({ label, value: label, count: counts.get(label) ?? 0 }))
  ];

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-[0_4px_12px_rgba(7,27,58,0.035)]">
      {orderedOptions.map((option) => {
        const active = value === option.value || (!value && option.value === "");
        return (
          <button
            key={option.value || "all-agent-lobs"}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-8 items-center gap-1 rounded-xl px-3 text-xs font-black transition",
              active ? "bg-blue-600 text-white shadow-sm" : "text-muted hover:bg-blue-50 hover:text-blue-700"
            )}
          >
            {option.label}
            <span className={cn("rounded-full px-1.5 py-0.5 text-[10px]", active ? "bg-white/20 text-white" : "bg-slate-100 text-muted")}>{option.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function QueueLobQuickFilter({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: CountItem[] }) {
  const counts = new Map(options.map((option) => [option.label, option.count]));
  const totalCount = options.reduce((sum, option) => sum + option.count, 0);
  const mappedCount = (counts.get("ADS") ?? 0) + (counts.get("VIDEO") ?? 0) + (counts.get("COMMENTS") ?? 0);
  const orderedOptions: Array<CountItem & { value: string }> = [
    { label: "Todas", value: "", count: totalCount },
    { label: "Todos mapeados", value: "MAPPED", count: mappedCount },
    ...["ADS", "VIDEO", "COMMENTS", "N/A"].map((label) => ({ label, value: label, count: counts.get(label) ?? 0 }))
  ];
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-[0_4px_12px_rgba(7,27,58,0.035)]">
      {orderedOptions.map((option) => {
        const active = value === option.value || (!value && option.value === "");
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-8 items-center gap-1 rounded-xl px-3 text-xs font-black transition",
              active ? "bg-blue-600 text-white shadow-sm" : "text-muted hover:bg-blue-50 hover:text-blue-700"
            )}
          >
            {option.label}
            <span className={cn("rounded-full px-1.5 py-0.5 text-[10px]", active ? "bg-white/20 text-white" : "bg-slate-100 text-muted")}>{option.count}</span>
          </button>
        );
      })}
    </div>
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

function KpiCard({ card }: { card: AgentKpiCard }) {
  const tone = card.trend === "positive" ? "green" : card.trend === "negative" ? "orange" : "blue";
  return (
    <div className="rounded-[22px] border border-slate-200/80 bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(15,23,42,0.08)]">
      <div className="flex min-h-[136px] items-stretch justify-between gap-4">
        <div className="flex min-w-0 flex-col justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-muted">{card.label}</p>
            <p className="mt-4 text-3xl font-black leading-none tracking-tight text-navy-950">{card.value}</p>
          </div>
          <div>
            {card.hasComparison ? <TrendBadge trend={card.trend} direction={card.direction} value={card.delta || "0"} /> : <span className="text-xs font-black text-muted">Sem comparação</span>}
            <p className="mt-2 text-xs font-bold text-muted">comparado ao ciclo anterior</p>
          </div>
        </div>
        <div className="w-[46%] min-w-[112px]">
          <TrendSparkline data={card.history} format={card.format} trend={card.trend} />
        </div>
      </div>
      <div className={cn("mt-4 h-1.5 rounded-full", tone === "green" ? "bg-emerald-100" : tone === "orange" ? "bg-red-100" : "bg-blue-100")} />
    </div>
  );
}

function QueueLobCard({ card }: { card: QueueLobCardData }) {
  const latencyReference = getQueueLobLatencyReference(card.lob);
  return (
    <div className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-muted">LOB</p>
          <h3 className="mt-1 text-2xl font-black text-navy-950">{card.lob}</h3>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <LobAdherenceCounter label="OK" value={card.adherenceCounts.ok} tone="ok" />
          <LobAdherenceCounter label="Alerta" value={card.adherenceCounts.alerta} tone="alerta" />
          <LobAdherenceCounter label="Est." value={card.adherenceCounts.estourado} tone="estourado" />
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <MiniMetricChartCard label="Backlog" card={card.backlog} />
        <MiniMetricChartCard label="SLA / Latência" card={card.latency} reference={latencyReference} />
        <MiniMetricChartCard label="Max Latência" card={card.maxLatency} reference={latencyReference} />
        <MiniMetricChartCard label="AHT" card={card.aht} />
      </div>
    </div>
  );
}

function getQueueLobLatencyReference(lob: QueueLobCardData["lob"]): { value: number; label: string } | null {
  if (lob === "ADS") return { value: 2 * 60 * 60 * 1000, label: "2h" };
  if (lob === "VIDEO") return { value: 15 * 60 * 1000, label: "15m" };
  return null;
}

function LobAdherenceCounter({ label, value, tone }: { label: string; value: number; tone: "ok" | "alerta" | "estourado" }) {
  const toneClass = tone === "ok"
    ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
    : tone === "alerta"
      ? "bg-amber-50 text-amber-800 ring-amber-100"
      : "bg-red-50 text-red-700 ring-red-100";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black ring-1", toneClass)}>
      <span>{label}</span>
      <span className="rounded-full bg-white/80 px-1.5 py-0.5 leading-none">{value}</span>
    </span>
  );
}

function MiniMetricChartCard({ label, card, reference }: { label: string; card: AgentKpiCard; reference?: { value: number; label: string } | null }) {
  return (
    <div className="rounded-[18px] border border-slate-100 bg-slate-50/80 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-black uppercase tracking-wide text-muted">{label}</p>
          <p className="mt-1 text-xl font-black leading-none text-navy-950">{card.value}</p>
          <div className="mt-2">
            {card.hasComparison ? <TrendBadge trend={card.trend} direction={card.direction} value={card.delta || "0"} /> : <span className="text-[11px] font-black text-muted">Sem comparação</span>}
          </div>
        </div>
        {reference ? (
          <span className="shrink-0 rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-black text-muted">
            Meta {reference.label}
          </span>
        ) : null}
      </div>
      <div className="mt-2 h-16">
        <TrendSparkline data={card.history} format={card.format} trend={card.trend} compact referenceValue={reference?.value ?? null} />
      </div>
    </div>
  );
}

function TrendSparkline({
  data,
  format,
  trend,
  compact = false,
  referenceValue = null
}: {
  data: TrendPoint[];
  format: MetricFormat;
  trend: "positive" | "negative" | "neutral";
  compact?: boolean;
  referenceValue?: number | null;
}) {
  const gradientId = `sparkline-${useId().replace(/:/g, "")}`;
  const validData = data.filter((point) => point.value !== null);
  const color = trend === "positive" ? "#10B981" : trend === "negative" ? "#EF4444" : "#2563EB";
  if (validData.length < 2) {
    return (
      <div className="grid h-full place-items-center rounded-2xl bg-slate-50 text-[11px] font-black text-muted">
        Sem histórico
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={validData} margin={{ top: compact ? 4 : 12, right: 4, left: 4, bottom: compact ? 4 : 12 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.34} />
            <stop offset="95%" stopColor={color} stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <YAxis hide domain={[0, (dataMax: number) => Math.max(dataMax, referenceValue ?? 0)]} />
        <RechartsTooltip content={<SparklineTooltip format={format} />} cursor={{ stroke: "#CBD5E1", strokeDasharray: "4 4" }} />
        {referenceValue !== null ? (
          <ReferenceLine y={referenceValue} stroke="#64748B" strokeDasharray="5 5" strokeWidth={1.25} ifOverflow="extendDomain" />
        ) : null}
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={compact ? 2 : 2.5} fill={`url(#${gradientId})`} dot={false} isAnimationActive={false} activeDot={{ r: compact ? 3 : 4, stroke: color, strokeWidth: 2, fill: "#fff" }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function SparklineTooltip({ active, payload, format }: { active?: boolean; payload?: Array<{ payload?: TrendPoint }>; format: MetricFormat }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const value = format === "duration" ? formatDurationFromMs(point.value) : formatInteger(point.value ?? 0);
  const delta = point.delta === null ? "Sem comparação" : `${point.delta > 0 ? "+" : point.delta < 0 ? "-" : ""}${format === "duration" ? formatDurationFromMs(Math.abs(point.delta)) : formatInteger(Math.abs(point.delta))}`;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-xl">
      <p className="font-black text-navy-950">{point.label}</p>
      <p className="mt-1 font-bold text-muted">Valor: <span className="text-navy-950">{value}</span></p>
      <p className="font-bold text-muted">Variação: <span className="text-navy-950">{delta}</span></p>
    </div>
  );
}

function buildFilteredAgentCards(rows: AgentRealtimeRow[], selectedCycle: string): AgentKpiCard[] {
  const current = summarizeMetrics(rows.map((row) => row.current));
  const previousMetrics = rows.map((row) => row.previous).filter((metric): metric is AgentMetric => Boolean(metric));
  const previous = previousMetrics.length ? summarizeMetrics(previousMetrics) : null;
  return [
    buildAgentKpiCard("Submit total", current.submit, previous?.submit ?? null, "number", "up", buildAgentTrendSeries(rows, "submit", selectedCycle)),
    buildAgentKpiCard("AHT médio", current.ahtMs, previous?.ahtMs ?? null, "duration", "down", buildAgentTrendSeries(rows, "ahtMs", selectedCycle)),
    buildAgentKpiCard("Moderação total", current.moderationMs, previous?.moderationMs ?? null, "duration", "up", buildAgentTrendSeries(rows, "moderationMs", selectedCycle)),
    buildAgentKpiCard("Timeout", current.timeout, previous?.timeout ?? null, "number", "down", buildAgentTrendSeries(rows, "timeout", selectedCycle)),
    buildAgentKpiCard("Refresh", current.refresh, previous?.refresh ?? null, "number", "down", buildAgentTrendSeries(rows, "refresh", selectedCycle))
  ];
}

function buildQueueLobCards(rows: QueueRealtimeRow[], selectedCycle: string): QueueLobCardData[] {
  return (["ADS", "VIDEO", "COMMENTS"] as const).map((lob) => {
    const scopedRows = rows.filter((row) => row.lob === lob && (lob !== "VIDEO" || row.slaTargetMinutes === 15));
    if (!scopedRows.length) {
      return {
        lob,
        adherenceCounts: { ok: 0, alerta: 0, estourado: 0 },
        backlog: emptyKpiCard("Backlog"),
        latency: emptyKpiCard("SLA"),
        maxLatency: emptyKpiCard("Max Latência"),
        aht: emptyKpiCard("AHT")
      };
    }
    const current = summarizeQueueMetrics(scopedRows.map((row) => row.current));
    const previousMetrics = scopedRows.map((row) => row.previous).filter((metric): metric is QueueMetric => Boolean(metric));
    const previous = previousMetrics.length ? summarizeQueueMetrics(previousMetrics) : null;
    return {
      lob,
      adherenceCounts: summarizeLatencyAdherence(scopedRows),
      backlog: buildAgentKpiCard("Backlog", current.backlog, previous?.backlog ?? null, "number", "down", buildQueueTrendSeries(scopedRows, "backlog", selectedCycle)),
      latency: buildAgentKpiCard("SLA", current.latencyMs, previous?.latencyMs ?? null, "duration", "down", buildQueueTrendSeries(scopedRows, "latencyMs", selectedCycle)),
      maxLatency: buildAgentKpiCard("Max Latência", current.maxLatencyMs, previous?.maxLatencyMs ?? null, "duration", "down", buildQueueTrendSeries(scopedRows, "maxLatencyMs", selectedCycle)),
      aht: buildAgentKpiCard("AHT", current.ahtMs, previous?.ahtMs ?? null, "duration", "down", buildQueueTrendSeries(scopedRows, "ahtMs", selectedCycle))
    };
  });
}

function emptyKpiCard(label: string): AgentKpiCard {
  return { label, value: "-", delta: "", hasComparison: false, trend: "neutral", direction: "none", format: "number", history: [] };
}

function summarizeLatencyAdherence(rows: QueueRealtimeRow[]): QueueLobCardData["adherenceCounts"] {
  return rows.reduce<QueueLobCardData["adherenceCounts"]>((counts, row) => {
    const status = resolveLatencyAdherence(row.current.maxLatencyMs, row.slaTargetMinutes);
    if (status === "OK") counts.ok += 1;
    else if (status === "Alerta") counts.alerta += 1;
    else if (status === "Estourado") counts.estourado += 1;
    return counts;
  }, { ok: 0, alerta: 0, estourado: 0 });
}

function buildAgentTrendSeries(rows: AgentRealtimeRow[], key: "submit" | "ahtMs" | "moderationMs" | "timeout" | "refresh", selectedCycle: string): TrendPoint[] {
  const byCycle = new Map<string, AgentMetric[]>();
  rows.forEach((row) => {
    row.history.forEach((item) => {
      const metrics = byCycle.get(item.cycleDownload) ?? [];
      metrics.push({
        submit: item.submit,
        ahtMs: item.ahtMs,
        moderationMs: item.moderationMs,
        timeout: item.timeout,
        refresh: item.refresh,
        queueCount: 0,
        sourceRows: 1
      });
      byCycle.set(item.cycleDownload, metrics);
    });
  });
  const points = Array.from(byCycle.entries()).map(([cycleDownload, metrics]) => {
    const summary = summarizeMetrics(metrics);
    return { cycleDownload, value: summary[key] };
  });
  return buildTrendPoints(points, selectedCycle);
}

function buildQueueTrendSeries(rows: QueueRealtimeRow[], key: "backlog" | "latencyMs" | "maxLatencyMs" | "ahtMs" | "input" | "output", selectedCycle: string): TrendPoint[] {
  const byCycle = new Map<string, QueueMetric[]>();
  rows.forEach((row) => {
    row.history.forEach((item) => {
      const metrics = byCycle.get(item.cycleDownload) ?? [];
      metrics.push({
        input: item.input,
        output: item.output,
        ahtMs: item.ahtMs,
        latencyMs: item.latencyMs,
        maxLatencyMs: item.maxLatencyMs,
        maxLatencyRowNumber: item.maxLatencyRowNumber,
        backlog: item.backlog,
        sourceRows: 1
      });
      byCycle.set(item.cycleDownload, metrics);
    });
  });
  const points = Array.from(byCycle.entries()).map(([cycleDownload, metrics]) => {
    const summary = summarizeQueueMetrics(metrics);
    return { cycleDownload, value: summary[key] };
  });
  return buildTrendPoints(points, selectedCycle);
}

function buildTrendPoints(points: Array<{ cycleDownload: string; value: number | null }>, selectedCycle: string): TrendPoint[] {
  const selected = selectedCycle ? parseRealtimeCycle(selectedCycle, "") : null;
  const dailyPoints = selected
    ? points.filter((point) => {
      const parsed = parseRealtimeCycle(point.cycleDownload, "");
      return parsed.dateKey === selected.dateKey && parsed.timestamp <= selected.timestamp;
    })
    : points;
  return dailyPoints
    .sort((a, b) => parseRealtimeCycle(a.cycleDownload, "").timestamp - parseRealtimeCycle(b.cycleDownload, "").timestamp)
    .map((point, index, sorted) => {
      const previous = index > 0 ? sorted[index - 1].value : null;
      const delta = point.value !== null && previous !== null ? point.value - previous : null;
      return {
        label: formatCycleTooltipLabel(point.cycleDownload),
        value: point.value,
        delta
      };
    });
}

function summarizeQueueMetrics(metrics: QueueMetric[]): QueueMetric {
  const input = metrics.reduce((sum, metric) => sum + metric.input, 0);
  const output = metrics.reduce((sum, metric) => sum + metric.output, 0);
  const backlog = metrics.reduce((sum, metric) => sum + metric.backlog, 0);
  const ahtWeighted = metrics.reduce((sum, metric) => sum + (metric.ahtMs !== null ? metric.ahtMs * metric.output : 0), 0);
  const simpleAhtMetrics = metrics.filter((metric) => metric.output === 0 && metric.ahtMs !== null);
  const simpleAht = simpleAhtMetrics.reduce((sum, metric) => sum + (metric.ahtMs ?? 0), 0);
  const latencyWeightedByBacklog = metrics.reduce((sum, metric) => sum + (metric.latencyMs !== null ? metric.latencyMs * metric.backlog : 0), 0);
  const latencyBacklogWeight = metrics.reduce((sum, metric) => sum + (metric.latencyMs !== null ? metric.backlog : 0), 0);
  const latencyWeightedByInput = metrics.reduce((sum, metric) => sum + (metric.latencyMs !== null ? metric.latencyMs * metric.input : 0), 0);
  const latencyInputWeight = metrics.reduce((sum, metric) => sum + (metric.latencyMs !== null ? metric.input : 0), 0);
  const simpleLatencyMetrics = metrics.filter((metric) => metric.backlog === 0 && metric.input === 0 && metric.latencyMs !== null);
  const simpleLatency = simpleLatencyMetrics.reduce((sum, metric) => sum + (metric.latencyMs ?? 0), 0);
  return {
    input,
    output,
    backlog,
    sourceRows: metrics.reduce((sum, metric) => sum + metric.sourceRows, 0),
    maxLatencyMs: metrics.reduce<number | null>((currentMax, metric) => {
      if (metric.maxLatencyMs === null) return currentMax;
      return currentMax === null ? metric.maxLatencyMs : Math.max(currentMax, metric.maxLatencyMs);
    }, null),
    ahtMs: output > 0 ? ahtWeighted / output : simpleAhtMetrics.length ? simpleAht / simpleAhtMetrics.length : null,
    latencyMs: latencyBacklogWeight > 0
      ? latencyWeightedByBacklog / latencyBacklogWeight
      : latencyInputWeight > 0
        ? latencyWeightedByInput / latencyInputWeight
        : simpleLatencyMetrics.length
          ? simpleLatency / simpleLatencyMetrics.length
          : null
  };
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

function buildAgentKpiCard(label: string, current: number | null, previous: number | null, format: MetricFormat, positiveDirection: "up" | "down" | "neutral", history: TrendPoint[] = []): AgentKpiCard {
  const delta = current !== null && previous !== null ? current - previous : null;
  const isPositive = delta === null || positiveDirection === "neutral" ? null : delta === 0 ? true : positiveDirection === "up" ? delta > 0 : delta < 0;
  return {
    label,
    value: format === "duration" ? formatDurationFromMs(current) : formatInteger(current ?? 0),
    delta: delta === null ? "" : format === "duration" ? formatDurationFromMs(Math.abs(delta)) : formatInteger(Math.abs(delta)),
    hasComparison: delta !== null,
    trend: isPositive === null ? "neutral" : isPositive ? "positive" : "negative",
    direction: delta === null || delta === 0 ? "none" : delta > 0 ? "up" : "down",
    format,
    history
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

function parseRealtimeCycle(value: string, importedAt: string) {
  const fallbackDate = importedAt ? new Date(importedAt) : new Date();
  const match = value.match(/(\d{4})[-/](\d{2})[-/](\d{2})(?:[T_\s-]+(\d{2})[:-](\d{2})(?::?(\d{2}))?)?/);
  const year = match ? Number(match[1]) : fallbackDate.getFullYear();
  const month = match ? Number(match[2]) - 1 : fallbackDate.getMonth();
  const day = match ? Number(match[3]) : fallbackDate.getDate();
  const hour = match?.[4] ? Number(match[4]) : fallbackDate.getHours();
  const minute = match?.[5] ? Number(match[5]) : fallbackDate.getMinutes();
  const second = match?.[6] ? Number(match[6]) : 0;
  const date = new Date(year, month, day, hour, minute, second);
  return {
    date,
    dateKey: formatDateKey(date),
    timestamp: date.getTime(),
    timeLabel: new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date)
  };
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function buildCalendarCells(monthDate: Date) {
  const first = startOfMonth(monthDate);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }).map((_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { date };
  });
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDateShort(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function formatCycleTooltipLabel(cycleDownload: string) {
  const parsed = parseRealtimeCycle(cycleDownload, "");
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(parsed.date);
}

function formatSlaTargetLabel(value: string) {
  if (value === "Sem meta") return value;
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return value;
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
}

function buildAgentQueryParams(cycleDownload: string, filters: AgentFilters) {
  const params = new URLSearchParams();
  if (cycleDownload) params.set("cycleDownload", cycleDownload);
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params;
}

function buildQueueQueryParams(cycleDownload: string, filters: QueueFilters) {
  const params = new URLSearchParams();
  if (cycleDownload) params.set("cycleDownload", cycleDownload);
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(`queue${key[0].toUpperCase()}${key.slice(1)}`, value);
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

function compareQueueRows(a: QueueRealtimeRow, b: QueueRealtimeRow, sort: QueueSortState) {
  const severity = (status: QueueStatus) => {
    if (status === "Estourado") return 4;
    if (status === "Risco") return 3;
    if (status === "Estável") return 2;
    if (status === "OK") return 1;
    return 0;
  };
  const textValue = (row: QueueRealtimeRow) => {
    if (sort.key === "status") return String(severity(row.status));
    if (sort.key === "latencyAdherence") return String(latencyAdherenceSeverity(resolveLatencyAdherence(row.current.maxLatencyMs, row.slaTargetMinutes)));
    if (sort.key === "lob") return row.lob;
    if (sort.key === "queueId") return row.queueId || row.queueName;
    return row.queueId || row.queueName;
  };
  const numericValue = (row: QueueRealtimeRow) => {
    if (sort.key === "input") return row.current.input;
    if (sort.key === "output") return row.current.output;
    if (sort.key === "aht") return row.current.ahtMs;
    if (sort.key === "latency") return row.current.latencyMs;
    if (sort.key === "maxLatency") return row.current.maxLatencyMs;
    if (sort.key === "slaTarget") return row.slaTargetMinutes;
    if (sort.key === "backlog") return row.current.backlog;
    return null;
  };

  if (numericQueueSortKeys.has(sort.key)) {
    const left = numericValue(a);
    const right = numericValue(b);
    if (left === null && right === null) return a.queueId.localeCompare(b.queueId);
    if (left === null) return 1;
    if (right === null) return -1;
    const diff = sort.direction === "asc" ? left - right : right - left;
    return diff || a.queueId.localeCompare(b.queueId);
  }

  if (sort.key === "status" || sort.key === "latencyAdherence") {
    const diff = Number(textValue(a)) - Number(textValue(b));
    return (sort.direction === "asc" ? diff : -diff) || a.queueId.localeCompare(b.queueId);
  }

  const diff = textValue(a).localeCompare(textValue(b), "pt-BR", { sensitivity: "base" });
  return (sort.direction === "asc" ? diff : -diff) || a.queueId.localeCompare(b.queueId);
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}
