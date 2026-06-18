"use client";

import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  CheckCircle2,
  Clock3,
  Database,
  Eye,
  RefreshCw,
  Search,
  Table2,
  UsersRound,
  Wifi,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
  queueName: string;
  queues: string[];
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
    queues: string[];
  }>;
  queueBreakdown: Array<{
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
    queues: CountItem[];
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
  queue: string;
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
  roleTitle: "",
  queue: ""
};

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
  const [agentFilters, setAgentFilters] = useState<AgentFilters>(emptyAgentFilters);
  const [selectedAgent, setSelectedAgent] = useState<AgentRealtimeRow | null>(null);

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
        ...Object.values(row.rawData).map((value) => String(value ?? ""))
      ].join(" ")).includes(normalizedSearch);
    });
  }, [queueDataset?.rows, queueLobFilter, queueSearch, queueStatusFilter]);

  const agentRows = useMemo(() => {
    const normalizedSearch = normalizeSearch(agentFilters.search);
    return (agentView?.rows ?? []).filter((row) => {
      if (agentFilters.crossingStatus && row.crossingStatus !== agentFilters.crossingStatus) return false;
      if (agentFilters.personType && row.personType !== agentFilters.personType) return false;
      if (agentFilters.employeeStatus && row.employeeStatus !== agentFilters.employeeStatus) return false;
      if (agentFilters.lob && row.lob !== agentFilters.lob) return false;
      if (agentFilters.supervisor && row.supervisor !== agentFilters.supervisor) return false;
      if (agentFilters.shift && row.shift !== agentFilters.shift) return false;
      if (agentFilters.skill && row.skill !== agentFilters.skill) return false;
      if (agentFilters.roleTitle && row.roleTitle !== agentFilters.roleTitle) return false;
      if (agentFilters.queue && !row.current.queues.includes(agentFilters.queue) && row.current.queueName !== agentFilters.queue) return false;
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
        row.current.queueName,
        row.current.queues.join(" ")
      ].join(" ")).includes(normalizedSearch);
    });
  }, [agentFilters, agentView?.rows]);

  const queueColumns = useMemo(() => buildQueueColumns(queueDataset?.columns ?? []), [queueDataset?.columns]);

  function updateAgentFilter(key: keyof AgentFilters, value: string) {
    setAgentFilters((current) => ({ ...current, [key]: value }));
  }

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
          <p className="mt-1 text-sm font-bold text-muted">Monitoramento KAP por ciclo_download, com cruzamento cadastral e comparação do ciclo anterior.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void loadSnapshot(selectedCycle, true)} className="premium-button inline-flex h-10 items-center gap-2 px-4 text-sm font-extrabold">
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            Atualizar
          </button>
        </div>
      </div>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}

      <section className="premium-card p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Última atualização" value={summary?.importedAtLabel || "-"} helper={summary?.fileName || "Aguardando primeiro upload"} icon={Clock3} tone={summary?.isStale ? "orange" : "blue"} />
          <StatCard title="Ciclo selecionado" value={agentView?.selectedCycle || "-"} helper={agentView?.previousCycle ? `Anterior: ${agentView.previousCycle}` : "Sem comparação"} icon={BarChart3} tone="purple" />
          <StatCard title="Filas" value={String(summary?.queueRows ?? 0)} helper="linhas importadas" icon={Table2} tone="purple" />
          <StatCard title="Agentes" value={String(summary?.agentRows ?? 0)} helper="linhas importadas" icon={UsersRound} tone="green" />
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

      <section className="premium-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-[260px] flex-1 text-xs font-black uppercase tracking-wide text-muted">
            ciclo_download
            <select value={selectedCycle || agentView?.selectedCycle || ""} onChange={(event) => setSelectedCycle(event.target.value)} className="premium-control mt-1 h-11 w-full px-3 text-sm font-extrabold text-navy-950 outline-none">
              {(agentView?.cycles ?? []).map((cycle) => <option key={cycle.value} value={cycle.value}>{cycle.value} · {cycle.rows} linha(s)</option>)}
            </select>
          </label>
          <button type="button" onClick={() => setSelectedCycle(agentView?.cycles[0]?.value ?? "")} className="premium-control h-11 px-4 text-sm font-extrabold text-navy-950">
            Último ciclo
          </button>
          <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-muted">
            Comparação: {agentView?.previousCycle || "Sem ciclo anterior"}
          </div>
        </div>
      </section>

      {activeTab === "agents" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {(agentView?.cards ?? []).map((card) => (
            <CompareCard key={card.label} card={card} />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {(payload?.data.kpis ?? []).map((item) => (
            <StatCard key={item.label} title={item.label} value={item.value} helper={item.helper} icon={Activity} tone={item.tone} />
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
              <SearchBox value={agentFilters.search} onChange={(value) => updateAgentFilter("search", value)} placeholder="Buscar agente, WB, fila..." />
              <FilterSelect value={agentFilters.crossingStatus} onChange={(value) => updateAgentFilter("crossingStatus", value)} label="Cruzamento" empty="Todos" options={agentView?.filters.crossingStatuses ?? []} />
              <FilterSelect value={agentFilters.personType} onChange={(value) => updateAgentFilter("personType", value)} label="Tipo" empty="Todos" options={agentView?.filters.personTypes ?? []} />
              <FilterSelect value={agentFilters.employeeStatus} onChange={(value) => updateAgentFilter("employeeStatus", value)} label="Status" empty="Todos" options={agentView?.filters.employeeStatuses ?? []} />
              <FilterSelect value={agentFilters.lob} onChange={(value) => updateAgentFilter("lob", value)} label="LOB" empty="Todas" options={agentView?.filters.lobs ?? []} />
              <FilterSelect value={agentFilters.supervisor} onChange={(value) => updateAgentFilter("supervisor", value)} label="Supervisor" empty="Todos" options={agentView?.filters.supervisors ?? []} />
              <FilterSelect value={agentFilters.shift} onChange={(value) => updateAgentFilter("shift", value)} label="Turno" empty="Todos" options={agentView?.filters.shifts ?? []} />
              <FilterSelect value={agentFilters.skill} onChange={(value) => updateAgentFilter("skill", value)} label="Skill" empty="Todas" options={agentView?.filters.skills ?? []} />
              <FilterSelect value={agentFilters.roleTitle} onChange={(value) => updateAgentFilter("roleTitle", value)} label="Cargo" empty="Todos" options={agentView?.filters.roleTitles ?? []} />
              <FilterSelect value={agentFilters.queue} onChange={(value) => updateAgentFilter("queue", value)} label="Fila" empty="Todas" options={agentView?.filters.queues ?? []} />
              <button type="button" onClick={() => setAgentFilters(emptyAgentFilters)} className="premium-control h-10 px-3 text-sm font-extrabold text-navy-950">Limpar</button>
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
            <AgentTable rows={agentRows} totalRows={agentView?.rows.length ?? 0} onSelect={setSelectedAgent} />
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
    </div>
  );
}

function AgentTable({ rows, totalRows, onSelect }: { rows: AgentRealtimeRow[]; totalRows: number; onSelect: (row: AgentRealtimeRow) => void }) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs font-black uppercase tracking-wide text-muted">
        <span>{rows.length} de {totalRows} agente(s) exibidos</span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[1280px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
            <tr>
              {["Agente", "WB/Login", "Cruzamento", "Tipo", "Status", "LOB", "Supervisor", "Turno", "Skill", "Fila", "Submit", "AHT", "Moderação", "Timeout", "Refresh", "Ações"].map((column) => (
                <th key={column} className="whitespace-nowrap px-4 py-3 font-black">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-slate-100 hover:bg-slate-50/70">
                <td className="px-4 py-3 font-extrabold text-navy-950">{row.displayName}</td>
                <td className="px-4 py-3 font-bold text-navy-950">{row.wbLogin || row.rawWbLogin || "-"}</td>
                <td className="px-4 py-3"><StatusPill value={row.crossingStatus} /></td>
                <td className="px-4 py-3"><StatusPill value={row.personType} /></td>
                <td className="px-4 py-3 font-bold text-muted">{row.employeeStatus}</td>
                <td className="px-4 py-3 font-bold">{row.lob}</td>
                <td className="px-4 py-3 font-bold">{row.supervisor}</td>
                <td className="px-4 py-3 font-bold">{row.shift}</td>
                <td className="px-4 py-3 font-bold">{row.skill}</td>
                <td className="max-w-[180px] px-4 py-3 font-bold"><span title={row.current.queues.join(", ")} className="block truncate">{row.current.queueName}</span></td>
                <td className="px-4 py-3 font-black text-navy-950">{formatInteger(row.current.submit)}<MetricDelta value={row.deltas.submit} metric="submit" /></td>
                <td className="px-4 py-3 font-black text-navy-950">{formatMinutes(row.current.ahtMs)}<MetricDelta value={row.deltas.ahtMs} metric="aht" /></td>
                <td className="px-4 py-3 font-black text-navy-950">{formatHours(row.current.moderationMs)}<MetricDelta value={row.deltas.moderationMs} metric="neutral-hours" /></td>
                <td className="px-4 py-3 font-black text-navy-950">{formatInteger(row.current.timeout)}<MetricDelta value={row.deltas.timeout} metric="down-good" /></td>
                <td className="px-4 py-3 font-black text-navy-950">{formatInteger(row.current.refresh)}<MetricDelta value={row.deltas.refresh} metric="down-good" /></td>
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
                <td colSpan={16} className="px-4 py-12 text-center text-sm font-bold text-muted">Nenhum agente encontrado para os filtros aplicados.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
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
          <SmallMetric title="AHT" value={formatMinutes(row.current.ahtMs)} previous={row.previous ? formatMinutes(row.previous.ahtMs) : "Sem comparação"} />
          <SmallMetric title="Moderação" value={formatHours(row.current.moderationMs)} previous={row.previous ? formatHours(row.previous.moderationMs) : "Sem comparação"} />
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
                  <tr>{["Fila", "Submit", "AHT", "Moderação", "Timeout", "Refresh"].map((column) => <th key={column} className="px-3 py-2 font-black">{column}</th>)}</tr>
                </thead>
                <tbody>
                  {row.queueBreakdown.map((queue) => (
                    <tr key={queue.queueName} className="border-t border-slate-100">
                      <td className="px-3 py-3 font-extrabold">{queue.queueName}</td>
                      <td className="px-3 py-3 font-bold">{formatInteger(queue.submit)}</td>
                      <td className="px-3 py-3 font-bold">{formatMinutes(queue.ahtMs)}</td>
                      <td className="px-3 py-3 font-bold">{formatHours(queue.moderationMs)}</td>
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
                <tr>{["Ciclo", "Submit", "AHT", "Moderação", "Timeout", "Refresh", "Filas"].map((column) => <th key={column} className="px-3 py-2 font-black">{column}</th>)}</tr>
              </thead>
              <tbody>
                {row.history.map((item) => (
                  <tr key={item.cycleDownload} className="border-t border-slate-100">
                    <td className="px-3 py-3 font-extrabold">{item.cycleDownload}</td>
                    <td className="px-3 py-3 font-bold">{formatInteger(item.submit)}</td>
                    <td className="px-3 py-3 font-bold">{formatMinutes(item.ahtMs)}</td>
                    <td className="px-3 py-3 font-bold">{formatHours(item.moderationMs)}</td>
                    <td className="px-3 py-3 font-bold">{formatInteger(item.timeout)}</td>
                    <td className="px-3 py-3 font-bold">{formatInteger(item.refresh)}</td>
                    <td className="max-w-[320px] px-3 py-3 font-bold"><span title={item.queues.join(", ")} className="block truncate">{item.queues.join(", ") || "-"}</span></td>
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
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} className="premium-control h-10 max-w-[190px] px-3 text-sm font-bold text-navy-950 outline-none">
      <option value="">{empty}</option>
      {options.map((option) => <option key={option.label} value={option.label}>{option.label} ({option.count})</option>)}
    </select>
  );
}

function CompareCard({ card }: { card: AgentRealtimeView["cards"][number] }) {
  const tone = card.trend === "positive" ? "green" : card.trend === "negative" ? "orange" : "blue";
  const icon = card.trend === "positive" ? CheckCircle2 : card.trend === "negative" ? AlertCircle : Activity;
  return (
    <div className="premium-card flex items-start justify-between gap-3 p-4">
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-muted">{card.label}</p>
        <p className="mt-1 text-2xl font-black text-navy-950">{card.value}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-black">
          {card.previous ? <span className="text-muted">Anterior: {card.previous}</span> : <span className="text-muted">Sem comparação</span>}
          {card.delta ? <TrendBadge trend={card.trend} direction={card.direction} value={card.delta} /> : null}
        </div>
      </div>
      <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl", toneClass(tone))}>
        {icon({ className: "h-5 w-5" })}
      </span>
    </div>
  );
}

function StatCard({ title, value, helper, icon: Icon, tone }: { title: string; value: string; helper: string; icon: LucideIcon; tone: "blue" | "green" | "purple" | "orange" }) {
  return (
    <div className="premium-card flex items-center justify-between gap-3 p-4">
      <div>
        <p className="text-xs font-black uppercase tracking-wide text-muted">{title}</p>
        <p className="mt-1 text-2xl font-black text-navy-950">{value}</p>
        <p className="mt-1 text-xs font-bold text-muted">{helper}</p>
      </div>
      <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl", toneClass(tone))}>
        <Icon className="h-5 w-5" />
      </span>
    </div>
  );
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

function MetricDelta({ value, metric }: { value: number | null; metric: "submit" | "aht" | "down-good" | "neutral-hours" }) {
  if (value === null || value === 0) return null;
  const positive = metric === "submit" ? value > 0 : metric === "aht" || metric === "down-good" ? value < 0 : null;
  const text = metric === "aht" ? `${value > 0 ? "+" : ""}${formatMinutes(value)}` : metric === "neutral-hours" ? `${value > 0 ? "+" : ""}${formatHours(value)}` : `${value > 0 ? "+" : ""}${formatInteger(value)}`;
  return <TrendBadge trend={positive === null ? "neutral" : positive ? "positive" : "negative"} direction={value > 0 ? "up" : "down"} value={text} />;
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
  if (key.startsWith("raw:")) return formatValue(row.rawData[key.slice(4)]);
  return "";
}

function formatValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatInteger(value: number) {
  return Math.round(value).toLocaleString("pt-BR");
}

function formatMinutes(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "N/A";
  return `${(value / 60000).toLocaleString("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} min`;
}

function formatHours(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "N/A";
  return `${(value / 3600000).toLocaleString("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} h`;
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
