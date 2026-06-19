"use client";

import {
  Activity,
  AlertCircle,
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

type QueueStatus = "OK" | "Estável" | "Risco" | "Estourado" | "N/A";

type QueueMetric = {
  input: number;
  output: number;
  ahtMs: number | null;
  latencyMs: number | null;
  maxLatencyMs: number | null;
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
    backlog: number;
  }>;
};

type QueueRealtimeView = {
  cycles: Array<{ value: string; importedAt: string; importedAtLabel: string; rows: number }>;
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
type AgentKpiCard = {
  label: string;
  value: string;
  delta: string;
  hasComparison: boolean;
  trend: "positive" | "negative" | "neutral";
  direction: "up" | "down" | "none";
};

type QueueFilters = {
  search: string;
  lob: string;
  status: string;
  slaTarget: string;
  queueId: string;
};

type QueueSortKey = "status" | "lob" | "queueId" | "input" | "output" | "aht" | "latency" | "maxLatency" | "backlog";
type QueueSortState = { key: QueueSortKey; direction: "asc" | "desc" };
type QueueLobCardData = {
  lob: "ADS" | "VIDEO" | "COMMENTS";
  backlog: AgentKpiCard;
  latency: AgentKpiCard;
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
const numericQueueSortKeys = new Set<QueueSortKey>(["input", "output", "aht", "latency", "maxLatency", "backlog"]);

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
    const params = activeTab === "queues"
      ? buildQueueQueryParams(selectedCycle || queueView?.selectedCycle || "", queueFilters)
      : buildAgentQueryParams(selectedCycle || agentView?.selectedCycle || "", agentFilters);
    params.set("view", activeTab);
    params.set("sortBy", activeTab === "queues" ? `${queueSort.key}_${queueSort.direction}` : `${agentSort.key}_${agentSort.direction}`);
    window.location.assign(`/api/realtime/export?${params.toString()}`);
  }

  useEffect(() => {
    void loadSnapshot(selectedCycle);
    const interval = window.setInterval(() => void loadSnapshot(selectedCycle, true), 60000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCycle]);

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

  const filteredAgentCards = useMemo(() => buildFilteredAgentCards(agentRows), [agentRows]);
  const filteredQueueCards = useMemo(() => buildQueueLobCards(queueRows), [queueRows]);

  const cycles = activeTab === "queues" ? queueView?.cycles ?? [] : agentView?.cycles ?? [];
  const selectedCycleExists = Boolean(selectedCycle && cycles.some((cycle) => cycle.value === selectedCycle));
  const selectedCycleValue = selectedCycleExists ? selectedCycle : (activeTab === "queues" ? queueView?.selectedCycle : agentView?.selectedCycle) || "";
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

      <section className="premium-card p-4">
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
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {filteredAgentCards.map((card) => (
            <CompareCard key={card.label} card={card} />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-3">
          {filteredQueueCards.map((card) => (
            <QueueLobCard key={card.lob} card={card} />
          ))}
        </div>
      )}

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
              <SearchBox value={queueFilters.search} onChange={(value) => updateQueueFilter("search", value)} placeholder="Buscar ID ou nome da fila..." />
              <QueueLobFilterSelect value={queueFilters.lob} onChange={(value) => updateQueueFilter("lob", value)} options={queueView?.filters.lobs ?? []} />
              <FilterSelect value={queueFilters.status} onChange={(value) => updateQueueFilter("status", value)} label="Status" empty="Todos" options={queueView?.filters.statuses ?? []} />
              <FilterSelect value={queueFilters.slaTarget} onChange={(value) => updateQueueFilter("slaTarget", value)} label="Meta SLA" empty="Todas" options={queueView?.filters.slaTargets ?? []} formatOptionLabel={formatSlaTargetLabel} />
              <FilterSelect value={queueFilters.queueId} onChange={(value) => updateQueueFilter("queueId", value)} label="Fila ID" empty="Todas" options={queueView?.filters.queueIds ?? []} />
              <button type="button" onClick={() => setQueueFilters(defaultQueueFilters)} className="premium-control h-10 px-3 text-sm font-extrabold text-navy-950">Limpar</button>
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

      {selectedAgent ? <AgentDetailDrawer row={selectedAgent} onClose={() => setSelectedAgent(null)} /> : null}
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
    { label: "Cruzamento" },
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
        <table className="min-w-[1320px] text-left text-sm">
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
  const isPositive = delta === null || delta === 0 || positiveDirection === "neutral" ? null : positiveDirection === "up" ? delta > 0 : delta < 0;
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
    { label: "Status da fila", sortKey: "status" },
    { label: "LOB", sortKey: "lob" },
    { label: "ID", sortKey: "queueId" },
    { label: "Input", sortKey: "input" },
    { label: "Output", sortKey: "output" },
    { label: "AHT", sortKey: "aht" },
    { label: "Latência", sortKey: "latency" },
    { label: "Max Latência", sortKey: "maxLatency" },
    { label: "Backlog", sortKey: "backlog" },
    { label: "Ações" }
  ];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs font-black uppercase tracking-wide text-muted">
        <span>{rows.length} de {totalRows} fila(s) exibidas</span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[1040px] text-left text-sm">
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
                <td className="px-4 py-3"><QueueStatusPill status={row.status} /></td>
                <td className="px-4 py-3 font-extrabold text-navy-950">{row.lob}</td>
                <td className="px-4 py-3 font-extrabold text-blue-700">{row.queueId || "Sem Fila ID"}</td>
                <td className="px-4 py-3"><AgentMetricCell current={row.current.input} previous={row.previous?.input ?? null} format="number" positiveDirection="neutral" /></td>
                <td className="px-4 py-3"><AgentMetricCell current={row.current.output} previous={row.previous?.output ?? null} format="number" positiveDirection="up" /></td>
                <td className="px-4 py-3"><AgentMetricCell current={row.current.ahtMs} previous={row.previous?.ahtMs ?? null} format="duration" positiveDirection="down" /></td>
                <td className="px-4 py-3"><AgentMetricCell current={row.current.latencyMs} previous={row.previous?.latencyMs ?? null} format="duration" positiveDirection="down" /></td>
                <td className="px-4 py-3"><AgentMetricCell current={row.current.maxLatencyMs} previous={row.previous?.maxLatencyMs ?? null} format="duration" positiveDirection="down" /></td>
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

function RealtimeCyclePicker({
  value,
  cycles,
  onChange
}: {
  value: string;
  cycles: Array<{ value: string; importedAt: string; importedAtLabel: string; rows: number }>;
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

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <SmallMetric title="Input" value={formatInteger(row.current.input)} previous={row.previous ? formatInteger(row.previous.input) : "Sem comparação"} />
          <SmallMetric title="Output" value={formatInteger(row.current.output)} previous={row.previous ? formatInteger(row.previous.output) : "Sem comparação"} />
          <SmallMetric title="AHT" value={formatDurationFromMs(row.current.ahtMs)} previous={row.previous ? formatDurationFromMs(row.previous.ahtMs) : "Sem comparação"} />
          <SmallMetric title="Latência" value={formatDurationFromMs(row.current.latencyMs)} previous={row.previous ? formatDurationFromMs(row.previous.latencyMs) : "Sem comparação"} />
          <SmallMetric title="Max Latência" value={formatDurationFromMs(row.current.maxLatencyMs)} previous={row.previous ? formatDurationFromMs(row.previous.maxLatencyMs) : "Sem comparação"} />
          <SmallMetric title="Backlog" value={formatInteger(row.current.backlog)} previous={row.previous ? formatInteger(row.previous.backlog) : "Sem comparação"} />
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="premium-card p-4">
            <h3 className="text-sm font-black uppercase tracking-wide text-muted">Detalhes da fila</h3>
            <InfoLine label="ID da fila" value={row.queueId || "Sem Fila ID"} />
            <InfoLine label="Nome da fila" value={row.queueName} />
            <InfoLine label="LOB" value={row.lob} />
            <InfoLine label="Meta SLA" value={row.slaTargetMinutes === null ? "Sem meta" : `${row.slaTargetMinutes} min`} />
            <InfoLine label="Status" value={row.status} />
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
                <tr>{["Ciclo", "Status", "Input", "Output", "AHT", "Latência", "Max Latência", "Backlog"].map((column) => <th key={column} className="px-3 py-2 font-black">{column}</th>)}</tr>
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
                    <td className="px-3 py-3 font-bold">{formatInteger(item.backlog)}</td>
                  </tr>
                ))}
                {!row.history.length ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-10 text-center text-sm font-bold text-muted">Sem histórico disponível para esta fila.</td>
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
    <label className="premium-control flex h-10 min-w-[220px] items-center gap-2 px-3 text-sm">
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
    <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} className="premium-control h-10 max-w-[190px] px-3 text-sm font-bold text-navy-950 outline-none">
      <option value="">{empty}</option>
      {hasCurrentValue ? <option value={value}>{formatOptionLabel(value)}</option> : null}
      {options.map((option) => <option key={option.label} value={option.label}>{formatOptionLabel(option.label)} ({option.count})</option>)}
    </select>
  );
}

function QueueLobFilterSelect({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: CountItem[] }) {
  const counts = new Map(options.map((option) => [option.label, option.count]));
  const mappedCount = (counts.get("ADS") ?? 0) + (counts.get("VIDEO") ?? 0) + (counts.get("COMMENTS") ?? 0);
  const orderedOptions: CountItem[] = [
    { label: "MAPPED", count: mappedCount },
    ...["ADS", "VIDEO", "COMMENTS", "N/A"].map((label) => ({ label, count: counts.get(label) ?? 0 })),
    ...options.filter((option) => !["ADS", "VIDEO", "COMMENTS", "N/A"].includes(option.label))
  ];
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} aria-label="LOB" className="premium-control h-10 max-w-[190px] px-3 text-sm font-bold text-navy-950 outline-none">
      <option value="">Todas</option>
      {orderedOptions.map((option) => (
        <option key={option.label} value={option.label}>
          {option.label === "MAPPED" ? "Todos mapeados" : option.label} ({option.count})
        </option>
      ))}
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

function QueueLobCard({ card }: { card: QueueLobCardData }) {
  return (
    <div className="premium-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-muted">LOB</p>
          <h3 className="text-xl font-black text-navy-950">{card.lob}</h3>
        </div>
        <span className="rounded-2xl bg-blue-50 px-3 py-2 text-xs font-black text-blue-700">Filas</span>
      </div>
      <div className="mt-4 grid gap-3">
        <QueueCardMetric label="Backlog" card={card.backlog} />
        <QueueCardMetric label="SLA" card={card.latency} />
        <QueueCardMetric label="AHT" card={card.aht} />
      </div>
    </div>
  );
}

function QueueCardMetric({ label, card }: { label: string; card: AgentKpiCard }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-muted">{label}</p>
          <p className="mt-0.5 text-lg font-black text-navy-950">{card.value}</p>
        </div>
        <div className="pt-4">
          {card.hasComparison ? <TrendBadge trend={card.trend} direction={card.direction} value={card.delta || "0"} /> : <span className="text-[11px] font-black text-muted">Sem comparação</span>}
        </div>
      </div>
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

function buildQueueLobCards(rows: QueueRealtimeRow[]): QueueLobCardData[] {
  return (["ADS", "VIDEO", "COMMENTS"] as const).map((lob) => {
    const scopedRows = rows.filter((row) => row.lob === lob && (lob !== "VIDEO" || row.slaTargetMinutes === 15));
    if (!scopedRows.length) {
      return {
        lob,
        backlog: emptyKpiCard("Backlog"),
        latency: emptyKpiCard("SLA"),
        aht: emptyKpiCard("AHT")
      };
    }
    const current = summarizeQueueMetrics(scopedRows.map((row) => row.current));
    const previousMetrics = scopedRows.map((row) => row.previous).filter((metric): metric is QueueMetric => Boolean(metric));
    const previous = previousMetrics.length ? summarizeQueueMetrics(previousMetrics) : null;
    return {
      lob,
      backlog: buildAgentKpiCard("Backlog", current.backlog, previous?.backlog ?? null, "number", "down"),
      latency: buildAgentKpiCard("SLA", current.latencyMs, previous?.latencyMs ?? null, "duration", "down"),
      aht: buildAgentKpiCard("AHT", current.ahtMs, previous?.ahtMs ?? null, "duration", "down")
    };
  });
}

function emptyKpiCard(label: string): AgentKpiCard {
  return { label, value: "-", delta: "", hasComparison: false, trend: "neutral", direction: "none" };
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

  if (sort.key === "status") {
    const diff = severity(a.status) - severity(b.status);
    return (sort.direction === "asc" ? diff : -diff) || a.queueId.localeCompare(b.queueId);
  }

  const diff = textValue(a).localeCompare(textValue(b), "pt-BR", { sensitivity: "base" });
  return (sort.direction === "asc" ? diff : -diff) || a.queueId.localeCompare(b.queueId);
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
