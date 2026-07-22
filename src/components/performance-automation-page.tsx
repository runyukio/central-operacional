"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type LucideIcon,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileSpreadsheet,
  Gauge,
  LineChart as LineChartIcon,
  LockKeyhole,
  RefreshCw,
  Rows3,
  Search,
  ShieldCheck,
  Target,
  TrendingUp,
  Trophy,
  UploadCloud,
  Users,
  X
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis
} from "recharts";

import { TopActions } from "@/components/layout/app-shell";
import { PageHeader, StatCard } from "@/components/ui/primitives";
import { cn, formatNumber } from "@/lib/utils";

type PerformanceGranularity = "monthly" | "weekly" | "daily" | "hourly";
type ForecastView = "hour" | "day" | "week";
type QualityGranularity = "monthly" | "weekly" | "daily";
type QualitySortDirection = "asc" | "desc";
type QualityLob = "ADS" | "VIDEO" | "COMMENTS";
type QualityImportScope = "ADS" | "TNS";
type SupervisorView = QualityGranularity;

type PerformanceSummary = {
  records: number;
  input: number;
  submit: number;
  moderationSeconds: number;
  moderationHours: number;
  ahtSeconds: number;
  latencyMinutes: number;
  agents?: number;
  queues?: number;
  lastImport?: { fileName: string; importedAt: string; rowsValid: number; status: string } | null;
};

type PerformanceTrendRow = PerformanceSummary & {
  key: string;
  label: string;
};

type PerformanceQueueRow = PerformanceSummary & {
  queueId: string;
  queueName: string;
  lob: string;
  slaTargetMinutes: number | null;
  agents: number;
};

type PerformancePanel = {
  dataRange: { startDate: string; endDate: string } | null;
  lastDataAt: string | null;
  lastImport: { fileName: string; importedAt: string; rowsValid: number; rowsError?: number; status: string; ageHours?: number | null } | null;
  totalRows: number;
  totalSubmit: number;
  totalInput: number;
};

type PerformanceProductionResponse = {
  mode: "production";
  canImport: boolean;
  granularity: PerformanceGranularity;
  panel: PerformancePanel;
  filters: { lobs: string[] };
  summary: PerformanceSummary;
  trend: PerformanceTrendRow[];
  queues?: PerformanceQueueRow[];
};

type ManualImportResult = {
  productionRows: number;
  volumeRows: number;
  cecCpdRows: number;
  rowsError: number;
};

type QualitySummary = {
  correct: number;
  total: number;
  errors: number;
  quality: number;
};

type QualityTrendRow = QualitySummary & {
  key: string;
  label: string;
};

type QualityAgentRow = QualitySummary & {
  employeeId: string;
  employeeName: string;
  wbLogin: string;
  lob: string;
  supervisor: string;
  lastAuditAt: string;
};

type PerformanceQualityResponse = {
  mode: "quality";
  canImport: boolean;
  granularity: QualityGranularity;
  period: { startDate: string; endDate: string };
  dataRange: { startDate: string; endDate: string } | null;
  selectedLob: string;
  filters: { lobs: string[] };
  summary: QualitySummary;
  trend: QualityTrendRow[];
  agents: QualityAgentRow[];
  lastImport: { fileName: string; importedAt: string; rowsValid: number; rowsError: number; status: string } | null;
};

type QualityImportResult = {
  qualityScope: QualityImportScope;
  qualityRows: number;
  qualityRowsError: number;
  qualityRowsIgnored: number;
};

type AgentSortKey = "employeeName" | "wbLogin" | "lob" | "supervisor" | "shift" | "outputTotal" | "submit" | "aht";
type AgentSortDirection = "asc" | "desc";

type PerformanceAgentRow = {
  employeeId: string | null;
  employeeName: string;
  wbLogin: string;
  lob: string;
  supervisorId: string | null;
  supervisor: string;
  shiftId: string | null;
  shift: string;
  submit: number;
  outputAveragePerDay: number;
  daysWithData: number;
  moderationSeconds: number;
  ahtSeconds: number;
};

type PerformanceAgentsResponse = {
  mode: "agents";
  view: QualityGranularity;
  period: { startDate: string; endDate: string };
  dataRange: { startDate: string; endDate: string } | null;
  selectedLob: string;
  filters: {
    lobs: string[];
    supervisors: Array<{ id: string; fullName: string }>;
    shifts: Array<{ id: string; name: string }>;
  };
  summary: {
    agents: number;
    submit: number;
    outputAveragePerDay: number;
    daysWithData: number;
    moderationSeconds: number;
    ahtSeconds: number;
  };
  pagination: { page: number; pageSize: number; totalRows: number; totalPages: number };
  sort: { sortBy: AgentSortKey; sortDirection: AgentSortDirection };
  agents: PerformanceAgentRow[];
};

type PerformanceSupervisorRow = {
  supervisorId: string;
  supervisor: string;
  teamSize: number;
  planned: number;
  absences: number;
  absRate: number;
  terminations: number;
  hcAverage: number;
  attritionRate: number;
  moodAverage: number;
  moodResponses: number;
  submit: number;
  moderationSeconds: number;
  ahtSeconds: number;
  qualityCorrect: number;
  qualityTotal: number;
  quality: number;
};

type PerformanceSupervisorsResponse = {
  mode: "supervisors";
  view: SupervisorView;
  period: { startDate: string; endDate: string };
  dataRange: { startDate: string; endDate: string } | null;
  summary: Omit<PerformanceSupervisorRow, "supervisorId" | "supervisor"> & { supervisors: number };
  supervisors: PerformanceSupervisorRow[];
};

type QueueSortKey = "queue" | "input" | "submit" | "latency" | "aht" | "agents";
type QueueSortDirection = "asc" | "desc";

type ForecastHour = {
  at: Date;
  timestamp: number;
  label: string;
  real: number | null;
  forecast: number | null;
  lower: number | null;
  upper: number | null;
  adjustment: number | null;
  confidence: number | null;
  samples: number;
};

type ForecastModel = {
  hasForecast: boolean;
  lastRealAt: Date | null;
  projectedUntil: Date | null;
  next24h: number | null;
  horizonTotal: number | null;
  peak: { value: number; at: Date | null };
  adjustment: number | null;
  accuracy: number | null;
  horizonHours: number;
  chartRows: ForecastChartRow[];
  tableRows: ForecastChartRow[];
};

type ForecastChartRow = {
  key: string;
  label: string;
  real: number | null;
  forecast: number | null;
  lower: number | null;
  upper: number | null;
  adjustment: number | null;
  confidence: number | null;
};

type ForecastActual = { at: Date; timestamp: number; input: number };
type ForecastModelName = "seasonalSlot" | "sameHourRecent" | "recentProfile" | "shortMomentum";
type ForecastModelWeights = Record<ForecastModelName, number>;
type ForecastCandidate = { name: ForecastModelName; value: number; samples: number; confidence: number };

const granularityOptions: Array<{ value: PerformanceGranularity; label: string }> = [
  { value: "monthly", label: "Mensal" },
  { value: "weekly", label: "Semanal" },
  { value: "daily", label: "Diario" },
  { value: "hourly", label: "Hora" }
];

const forecastViewOptions: Array<{ value: ForecastView; label: string }> = [
  { value: "hour", label: "Hora" },
  { value: "day", label: "Diario" },
  { value: "week", label: "Semanal" }
];

const forecastHorizons = [7, 14];
const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;
const forecastModelNames: ForecastModelName[] = ["seasonalSlot", "sameHourRecent", "recentProfile", "shortMomentum"];
const defaultForecastModelWeights: ForecastModelWeights = {
  seasonalSlot: 0.34,
  sameHourRecent: 0.24,
  recentProfile: 0.26,
  shortMomentum: 0.16
};

export function PerformanceAutomationPage() {
  const [activeTab, setActiveTab] = useState<"queue" | "agents" | "supervisors" | "forecast" | "quality">("queue");
  const [queueGranularity, setQueueGranularity] = useState<PerformanceGranularity>("daily");
  const [queueLob, setQueueLob] = useState("");
  const [queueStartDate, setQueueStartDate] = useState("");
  const [queueEndDate, setQueueEndDate] = useState("");
  const [forecastLob, setForecastLob] = useState("ADS");
  const [forecastView, setForecastView] = useState<ForecastView>("hour");
  const [forecastHorizon, setForecastHorizon] = useState(14);
  const [queuePayload, setQueuePayload] = useState<PerformanceProductionResponse | null>(null);
  const [forecastPayload, setForecastPayload] = useState<PerformanceProductionResponse | null>(null);
  const [qualityPayload, setQualityPayload] = useState<PerformanceQualityResponse | null>(null);
  const [qualityLob, setQualityLob] = useState<QualityLob>("ADS");
  const [qualityGranularity, setQualityGranularity] = useState<QualityGranularity>("daily");
  const [qualitySortDirection, setQualitySortDirection] = useState<QualitySortDirection>("desc");
  const [qualityStartDate, setQualityStartDate] = useState("");
  const [qualityEndDate, setQualityEndDate] = useState("");
  const [agentsPayload, setAgentsPayload] = useState<PerformanceAgentsResponse | null>(null);
  const [supervisorsPayload, setSupervisorsPayload] = useState<PerformanceSupervisorsResponse | null>(null);
  const [agentView, setAgentView] = useState<QualityGranularity>("daily");
  const [supervisorView, setSupervisorView] = useState<SupervisorView>("monthly");
  const [supervisorStartDate, setSupervisorStartDate] = useState("");
  const [supervisorEndDate, setSupervisorEndDate] = useState("");
  const [agentLob, setAgentLob] = useState("");
  const [agentShiftId, setAgentShiftId] = useState("");
  const [agentSupervisorId, setAgentSupervisorId] = useState("");
  const [agentSearch, setAgentSearch] = useState("");
  const [debouncedAgentSearch, setDebouncedAgentSearch] = useState("");
  const [agentStartDate, setAgentStartDate] = useState("");
  const [agentEndDate, setAgentEndDate] = useState("");
  const [agentSort, setAgentSort] = useState<{ key: AgentSortKey; direction: AgentSortDirection }>({ key: "submit", direction: "desc" });
  const [agentPage, setAgentPage] = useState(1);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [loadingForecast, setLoadingForecast] = useState(false);
  const [loadingQuality, setLoadingQuality] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [loadingSupervisors, setLoadingSupervisors] = useState(false);
  const [message, setMessage] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [qualityUploadOpen, setQualityUploadOpen] = useState(false);

  const loadQueue = useCallback(async (lobOverride?: string) => {
    setLoadingQueue(true);
    const effectiveLob = typeof lobOverride === "string" ? lobOverride : queueLob;
    const params = new URLSearchParams({ granularity: queueGranularity });
    if (effectiveLob) params.set("lob", effectiveLob);
    else params.set("metadataOnly", "true");
    if (queueStartDate) params.set("startDate", queueStartDate);
    if (queueEndDate) params.set("endDate", queueEndDate);
    try {
      const data = await fetchPerformance(params);
      setQueuePayload(data);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Nao foi possivel carregar Performance.");
    } finally {
      setLoadingQueue(false);
    }
  }, [queueEndDate, queueGranularity, queueLob, queueStartDate]);

  const exportQueue = useCallback(() => {
    const params = new URLSearchParams({ granularity: queueGranularity });
    if (queueLob) params.set("lob", queueLob);
    if (queueStartDate) params.set("startDate", queueStartDate);
    if (queueEndDate) params.set("endDate", queueEndDate);
    window.location.href = `/api/performance/queue/export?${params.toString()}`;
  }, [queueEndDate, queueGranularity, queueLob, queueStartDate]);

  const loadForecast = useCallback(async () => {
    setLoadingForecast(true);
    const params = new URLSearchParams({ granularity: "hourly" });
    if (forecastLob) params.set("lob", forecastLob);
    try {
      const data = await fetchPerformance(params);
      setForecastPayload(data);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Nao foi possivel carregar Forecast.");
    } finally {
      setLoadingForecast(false);
    }
  }, [forecastLob]);

  const loadQuality = useCallback(async (lobOverride?: QualityLob) => {
    setLoadingQuality(true);
    const effectiveLob = lobOverride ?? qualityLob;
    const params = new URLSearchParams({
      view: qualityGranularity,
      sortDirection: qualitySortDirection,
      lob: effectiveLob
    });
    if (qualityStartDate) params.set("startDate", qualityStartDate);
    if (qualityEndDate) params.set("endDate", qualityEndDate);
    try {
      const response = await fetch(`/api/performance/quality?${params.toString()}`, { cache: "no-store" });
      const body = await response.json().catch(() => null) as (PerformanceQualityResponse & { error?: string; message?: string }) | null;
      if (!response.ok || !body) throw new Error(body?.error || body?.message || "Não foi possível carregar Qualidade.");
      setQualityPayload(body);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível carregar Qualidade.");
    } finally {
      setLoadingQuality(false);
    }
  }, [qualityEndDate, qualityGranularity, qualityLob, qualitySortDirection, qualityStartDate]);

  const loadAgents = useCallback(async () => {
    setLoadingAgents(true);
    const params = new URLSearchParams({
      view: agentView,
      page: String(agentPage),
      pageSize: "50",
      sortBy: agentSort.key,
      sortDirection: agentSort.direction
    });
    if (agentLob) params.set("lob", agentLob);
    else params.set("metadataOnly", "true");
    if (agentStartDate) params.set("startDate", agentStartDate);
    if (agentEndDate) params.set("endDate", agentEndDate);
    if (agentShiftId) params.set("shiftId", agentShiftId);
    if (agentSupervisorId) params.set("supervisorId", agentSupervisorId);
    if (debouncedAgentSearch) params.set("search", debouncedAgentSearch);
    try {
      const data = await fetchPerformanceAgents(params);
      setAgentsPayload(data);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível carregar os dados dos agentes.");
    } finally {
      setLoadingAgents(false);
    }
  }, [agentEndDate, agentLob, agentPage, agentShiftId, agentSort, agentStartDate, agentSupervisorId, agentView, debouncedAgentSearch]);

  const loadSupervisors = useCallback(async () => {
    setLoadingSupervisors(true);
    const params = new URLSearchParams({ view: supervisorView });
    if (supervisorStartDate) params.set("startDate", supervisorStartDate);
    if (supervisorEndDate) params.set("endDate", supervisorEndDate);
    try {
      const data = await fetchPerformanceSupervisors(params);
      setSupervisorsPayload(data);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível carregar os dados dos supervisores.");
    } finally {
      setLoadingSupervisors(false);
    }
  }, [supervisorEndDate, supervisorStartDate, supervisorView]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (activeTab === "forecast") void loadForecast();
  }, [activeTab, loadForecast]);

  useEffect(() => {
    if (activeTab === "quality") void loadQuality();
  }, [activeTab, loadQuality]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedAgentSearch(agentSearch.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [agentSearch]);

  useEffect(() => {
    if (activeTab === "agents") void loadAgents();
  }, [activeTab, loadAgents]);

  useEffect(() => {
    if (activeTab === "supervisors") void loadSupervisors();
  }, [activeTab, loadSupervisors]);

  const basePayload = queuePayload ?? forecastPayload;
  const lobs = useMemo(() => normalizeLobs(basePayload?.filters.lobs ?? []), [basePayload]);
  const queueRows = queuePayload?.trend ?? [];
  const baseQueueSummary = useMemo(() => summarizeQueueRows(basePayload?.queues ?? []), [basePayload]);
  const forecast = useMemo(
    () => buildForecastModel(forecastPayload?.trend ?? [], forecastHorizon, forecastView),
    [forecastPayload, forecastHorizon, forecastView]
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Performance"
        description="Análise de Input, Output e Latência com substituição manual da base vigente."
        icon={Trophy}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {basePayload?.canImport && activeTab !== "quality" && activeTab !== "supervisors" ? (
              <button type="button" onClick={() => setUploadOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-blue-700">
                <UploadCloud className="h-4 w-4" /> Subir bases
              </button>
            ) : null}
            <TopActions />
          </div>
        )}
      />

      {activeTab === "supervisors" ? null : activeTab === "quality" ? (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Último upload" value={formatQualityImportDate(qualityPayload?.lastImport?.importedAt)} helper="snapshot de qualidade vigente" icon={CheckCircle2} tone="green" />
          <StatCard title="Janela da base" value={formatQualityRange(qualityPayload?.dataRange)} helper={qualityLob === "ADS" ? "ADS + PROJECT" : qualityLob} icon={CalendarClock} tone="purple" />
          <StatCard title="Casos auditados" value={formatNumber(qualityPayload?.summary.total ?? 0)} helper="chaves distintas" icon={FileSpreadsheet} tone="blue" />
          <StatCard title="Qualidade" value={formatQualityPercent(qualityPayload?.summary.quality)} helper="corretos / auditados" icon={ShieldCheck} tone="green" />
        </section>
      ) : (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Último upload" value={formatUpload(basePayload?.panel.lastImport?.importedAt)} helper="base manual vigente" icon={CheckCircle2} tone="green" />
          <StatCard title="Janela da base" value={formatBaseRange(basePayload?.panel)} helper={formatRangeHelper(basePayload?.panel)} icon={CalendarClock} tone="purple" />
          <StatCard title="Output importado" value={formatNumber(basePayload?.panel.totalSubmit ?? basePayload?.summary.submit ?? 0)} helper="submit da base atual" icon={FileSpreadsheet} tone="blue" />
          <StatCard title="Input importado" value={formatNumber(basePayload?.panel.totalInput ?? basePayload?.summary.input ?? baseQueueSummary.input)} helper="enqueue da base atual" icon={Rows3} tone="cyan" />
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <TabButton active={activeTab === "queue"} icon={Rows3} label="Dados de fila" onClick={() => setActiveTab("queue")} />
        <TabButton active={activeTab === "agents"} icon={Users} label="Agentes" onClick={() => setActiveTab("agents")} />
        <TabButton active={activeTab === "supervisors"} icon={ShieldCheck} label="Supervisores" onClick={() => setActiveTab("supervisors")} />
        <TabButton active={activeTab === "forecast"} icon={LineChartIcon} label="Forecast" onClick={() => setActiveTab("forecast")} />
        <TabButton active={activeTab === "quality"} icon={ShieldCheck} label="Qualidade" onClick={() => setActiveTab("quality")} />
      </div>

      {message ? <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{message}</p> : null}

      {activeTab === "queue" ? (
        <QueueView
          loading={loadingQueue}
          rows={queueRows}
          payload={queuePayload}
          lobs={lobs}
          selectedLob={queueLob}
          startDate={queueStartDate}
          endDate={queueEndDate}
          granularity={queueGranularity}
          onLobChange={setQueueLob}
          onStartDateChange={setQueueStartDate}
          onEndDateChange={setQueueEndDate}
          onGranularityChange={setQueueGranularity}
          onExport={exportQueue}
          onRefresh={() => void loadQueue()}
        />
      ) : activeTab === "agents" ? (
        <AgentsView
          loading={loadingAgents}
          payload={agentsPayload}
          selectedLob={agentLob}
          selectedShiftId={agentShiftId}
          selectedSupervisorId={agentSupervisorId}
          search={agentSearch}
          startDate={agentStartDate}
          endDate={agentEndDate}
          sort={agentSort}
          page={agentPage}
          view={agentView}
          onLobChange={(value) => { setAgentLob(value); setAgentPage(1); }}
          onShiftChange={(value) => { setAgentShiftId(value); setAgentPage(1); }}
          onSupervisorChange={(value) => { setAgentSupervisorId(value); setAgentPage(1); }}
          onSearchChange={(value) => { setAgentSearch(value); setAgentPage(1); }}
          onStartDateChange={(value) => { setAgentStartDate(value); setAgentPage(1); }}
          onEndDateChange={(value) => { setAgentEndDate(value); setAgentPage(1); }}
          onSortChange={(value) => { setAgentSort(value); setAgentPage(1); }}
          onPageChange={setAgentPage}
          onViewChange={(value) => {
            setAgentView(value);
            setAgentStartDate("");
            setAgentEndDate("");
            setAgentPage(1);
          }}
          onRefresh={() => void loadAgents()}
        />
      ) : activeTab === "supervisors" ? (
        <SupervisorsView
          loading={loadingSupervisors}
          payload={supervisorsPayload}
          view={supervisorView}
          startDate={supervisorStartDate}
          endDate={supervisorEndDate}
          onViewChange={setSupervisorView}
          onStartDateChange={setSupervisorStartDate}
          onEndDateChange={setSupervisorEndDate}
          onRefresh={() => void loadSupervisors()}
        />
      ) : activeTab === "forecast" ? (
        <ForecastViewPanel
          loading={loadingForecast && !forecastPayload}
          model={forecast}
          lobs={lobs}
          selectedLob={forecastLob}
          selectedView={forecastView}
          horizon={forecastHorizon}
          onLobChange={setForecastLob}
          onViewChange={setForecastView}
          onHorizonChange={setForecastHorizon}
          onRefresh={() => void loadForecast()}
        />
      ) : (
        <QualityView
          loading={loadingQuality}
          payload={qualityPayload}
          selectedLob={qualityLob}
          granularity={qualityGranularity}
          sortDirection={qualitySortDirection}
          startDate={qualityStartDate}
          endDate={qualityEndDate}
          onGranularityChange={setQualityGranularity}
          onSortDirectionChange={setQualitySortDirection}
          onStartDateChange={setQualityStartDate}
          onEndDateChange={setQualityEndDate}
          onLobChange={(value) => {
            setQualityLob(value);
            setQualityStartDate("");
            setQualityEndDate("");
          }}
          onRefresh={() => void loadQuality()}
          onUpload={(qualityPayload?.canImport ?? basePayload?.canImport) ? () => setQualityUploadOpen(true) : undefined}
        />
      )}

      {uploadOpen ? (
        <ManualImportModal
          onClose={() => setUploadOpen(false)}
          onImported={async () => {
            setQueueLob("");
            setQueuePayload(null);
            await loadQueue("");
          }}
        />
      ) : null}
      {qualityUploadOpen ? (
        <QualityImportModal
          initialScope={qualityLob === "ADS" ? "ADS" : "TNS"}
          onClose={() => setQualityUploadOpen(false)}
          onImported={async (scope) => {
            const nextLob: QualityLob = scope === "ADS" ? "ADS" : "VIDEO";
            setQualityLob(nextLob);
            setQualityPayload(null);
            await loadQuality(nextLob);
          }}
        />
      ) : null}
    </div>
  );
}

export function PerformanceRestrictedPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Performance" description="Modulo em validacao operacional." icon={Trophy} actions={<TopActions />} />
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-amber-700"><LockKeyhole className="h-5 w-5" /></span>
          <div>
            <h2 className="font-black">Performance disponivel apenas para validacao.</h2>
            <p className="mt-1 text-sm font-semibold">A liberacao geral sera feita depois da conferencia dos dados automatizados.</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function QualityView({
  loading,
  payload,
  selectedLob,
  granularity,
  sortDirection,
  startDate,
  endDate,
  onGranularityChange,
  onSortDirectionChange,
  onStartDateChange,
  onEndDateChange,
  onLobChange,
  onRefresh,
  onUpload
}: {
  loading: boolean;
  payload: PerformanceQualityResponse | null;
  selectedLob: QualityLob;
  granularity: QualityGranularity;
  sortDirection: QualitySortDirection;
  startDate: string;
  endDate: string;
  onGranularityChange: (value: QualityGranularity) => void;
  onSortDirectionChange: (value: QualitySortDirection) => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onLobChange: (value: QualityLob) => void;
  onRefresh: () => void;
  onUpload?: () => void;
}) {
  const [search, setSearch] = useState("");
  const agents = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
    const filtered = normalizedSearch
      ? (payload?.agents ?? []).filter((agent) => (
        agent.employeeName.toLocaleLowerCase("pt-BR").includes(normalizedSearch)
        || agent.wbLogin.toLocaleLowerCase("pt-BR").includes(normalizedSearch)
        || agent.supervisor.toLocaleLowerCase("pt-BR").includes(normalizedSearch)
      ))
      : (payload?.agents ?? []);
    const direction = sortDirection === "desc" ? -1 : 1;
    return [...filtered].sort((left, right) => (
      (left.quality - right.quality) * direction
      || right.total - left.total
      || left.employeeName.localeCompare(right.employeeName, "pt-BR")
    ));
  }, [payload?.agents, search, sortDirection]);

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-base font-black text-navy-950">Qualidade</h2>
          <p className="mt-1 text-xs font-bold text-muted">Casos corretos distintos divididos pelos casos auditados distintos.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onUpload ? (
            <button type="button" onClick={onUpload} className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-xs font-black text-white hover:bg-blue-700">
              <UploadCloud className="h-4 w-4" /> Subir qualidade
            </button>
          ) : null}
          <button type="button" onClick={onRefresh} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-xs font-black text-navy-950 hover:bg-slate-50">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Atualizar
          </button>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
            <DateRangeFilter
              startDate={startDate}
              endDate={endDate}
              minDate={payload?.dataRange?.startDate ?? ""}
              maxDate={payload?.dataRange?.endDate ?? ""}
              onStartDateChange={onStartDateChange}
              onEndDateChange={onEndDateChange}
            />
            <SlicerGroup label="LOB">
              {(["ADS", "VIDEO", "COMMENTS"] as QualityLob[]).map((lob) => (
                <SlicerButton key={lob} active={selectedLob === lob} label={lob} onClick={() => onLobChange(lob)} tone="dark" />
              ))}
            </SlicerGroup>
            <SlicerGroup label="Visão">
              <SlicerButton active={granularity === "monthly"} label="Mensal" onClick={() => onGranularityChange("monthly")} tone="dark" />
              <SlicerButton active={granularity === "weekly"} label="Semanal" onClick={() => onGranularityChange("weekly")} tone="dark" />
              <SlicerButton active={granularity === "daily"} label="Diário" onClick={() => onGranularityChange("daily")} tone="dark" />
            </SlicerGroup>
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-2 text-xs font-bold text-blue-900">
            Fórmula oficial: Correct distintos / total de casos distintos
          </div>
        </div>

        {loading && !payload ? <EmptyBox label="Carregando dados de qualidade..." /> : !payload?.summary.total ? (
          <div className="grid min-h-[260px] place-items-center rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 px-6 text-center">
            <div className="max-w-md">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white text-blue-600 shadow-sm"><ShieldCheck className="h-5 w-5" /></span>
              <h3 className="mt-4 text-lg font-black text-navy-950">Sem dados de qualidade</h3>
              <p className="mt-2 text-sm font-semibold text-muted">Envie a base de QA de {selectedLob === "ADS" ? "ADS/PROJECT" : "VIDEO/COMMENTS"} para carregar este indicador.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <StatCard title="Qualidade" value={formatQualityPercent(payload.summary.quality)} helper={payload.selectedLob} icon={ShieldCheck} tone="green" />
              <StatCard title="Casos corretos" value={formatNumber(payload.summary.correct)} helper="distinct Correct" icon={CheckCircle2} tone="green" />
              <StatCard title="Casos auditados" value={formatNumber(payload.summary.total)} helper="distinct concat" icon={FileSpreadsheet} tone="blue" />
              <StatCard title="Divergências" value={formatNumber(payload.summary.errors)} helper="auditados - corretos" icon={Target} tone="orange" />
            </div>

            <div className="rounded-xl border border-border bg-white p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-navy-950">Evolução {qualityGranularityLabel(granularity).toLocaleLowerCase("pt-BR")} da qualidade</h3>
                  <p className="mt-1 text-xs font-bold text-muted">Percentual oficial e volume de casos auditados por período.</p>
                </div>
                <span className="rounded-lg bg-slate-50 px-3 py-1 text-xs font-black text-muted">{formatNumber(payload.trend.length)} {qualityGranularityUnit(granularity)}</span>
              </div>
              <QualityDashboardChart rows={payload.trend} />
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-white">
              <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-black text-navy-950">Qualidade por agente</h3>
                  <p className="mt-1 text-xs font-bold text-muted">{sortDirection === "desc" ? "Maior qualidade primeiro." : "Menor qualidade primeiro."}</p>
                </div>
                <label className="relative block w-full sm:max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Buscar agente, WB ou supervisor"
                    className="h-10 w-full rounded-xl border border-border bg-white pl-9 pr-3 text-sm font-semibold text-navy-950 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </label>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-black uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-3 py-3">Agente</th>
                      <th className="px-3 py-3">LOB</th>
                      <th className="px-3 py-3">Supervisor</th>
                      <th className="px-3 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => onSortDirectionChange(sortDirection === "desc" ? "asc" : "desc")}
                          className="ml-auto inline-flex items-center gap-1.5 hover:text-blue-600"
                          aria-label={`Ordenar qualidade do ${sortDirection === "desc" ? "menor para o maior" : "maior para o menor"}`}
                        >
                          Qualidade {sortDirection === "desc" ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
                        </button>
                      </th>
                      <th className="px-3 py-3 text-right">Corretos</th>
                      <th className="px-3 py-3 text-right">Auditados</th>
                      <th className="px-3 py-3 text-right">Divergências</th>
                      <th className="px-3 py-3 text-right">Última auditoria</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {agents.map((agent) => (
                      <tr key={agent.employeeId} className="hover:bg-blue-50/40">
                        <td className="px-3 py-2">
                          <p className="font-black text-navy-950">{agent.employeeName}</p>
                          <p className="text-xs font-bold text-muted">{agent.wbLogin}</p>
                        </td>
                        <td className="px-3 py-2"><span className="rounded-lg bg-blue-50 px-2 py-1 text-xs font-black text-blue-700">{agent.lob}</span></td>
                        <td className="px-3 py-2 font-bold text-muted">{agent.supervisor}</td>
                        <td className="px-3 py-2 text-right"><QualityScore value={agent.quality} /></td>
                        <td className="px-3 py-2 text-right font-bold text-navy-950">{formatNumber(agent.correct)}</td>
                        <td className="px-3 py-2 text-right font-bold text-navy-950">{formatNumber(agent.total)}</td>
                        <td className="px-3 py-2 text-right font-bold text-navy-950">{formatNumber(agent.errors)}</td>
                        <td className="px-3 py-2 text-right text-xs font-bold text-muted">{formatQualityAuditDate(agent.lastAuditAt)}</td>
                      </tr>
                    ))}
                    {!agents.length ? <tr><td colSpan={8} className="px-3 py-8 text-center text-sm font-bold text-muted">Nenhum agente encontrado.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function QualityDashboardChart({ rows }: { rows: QualityTrendRow[] }) {
  if (!rows.length) return <EmptyBox label="Sem histórico diário para exibir." />;
  return (
    <div className="h-[360px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fontWeight: 700, fill: "#475569" }} tickLine={false} axisLine={false} minTickGap={18} />
          <YAxis yAxisId="cases" tick={{ fontSize: 11, fontWeight: 700, fill: "#475569" }} tickLine={false} axisLine={false} tickFormatter={(value) => formatCompactAxis(Number(value))} />
          <YAxis yAxisId="quality" orientation="right" domain={[0, 100]} tick={{ fontSize: 11, fontWeight: 700, fill: "#059669" }} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}%`} />
          <RechartsTooltip content={<QualityDashboardTooltip />} cursor={{ fill: "#EFF6FF" }} />
          <Legend wrapperStyle={{ fontSize: 12, fontWeight: 800 }} />
          <Bar yAxisId="cases" dataKey="total" name="Casos auditados" fill="#93C5FD" radius={[5, 5, 0, 0]} maxBarSize={34} />
          <Line yAxisId="quality" type="monotone" dataKey="quality" name="Qualidade" stroke="#10B981" strokeWidth={3} dot={false} activeDot={{ r: 5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function QualityDashboardTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: QualityTrendRow }> }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-xl border border-border bg-white p-3 text-xs font-bold text-navy-950 shadow-lg">
      <p className="mb-2 text-sm font-black">{row.label}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-5"><span>Qualidade</span><span>{formatQualityPercent(row.quality)}</span></div>
        <div className="flex justify-between gap-5"><span>Corretos</span><span>{formatNumber(row.correct)}</span></div>
        <div className="flex justify-between gap-5"><span>Auditados</span><span>{formatNumber(row.total)}</span></div>
        <div className="flex justify-between gap-5"><span>Divergências</span><span>{formatNumber(row.errors)}</span></div>
      </div>
    </div>
  );
}

function QualityScore({ value }: { value: number }) {
  const tone = value >= 95
    ? "bg-emerald-50 text-emerald-700"
    : value >= 90
      ? "bg-amber-50 text-amber-700"
      : "bg-red-50 text-red-700";
  return <span className={cn("inline-flex min-w-[72px] justify-center rounded-lg px-2 py-1 text-xs font-black", tone)}>{formatQualityPercent(value)}</span>;
}

function AgentsView({
  loading,
  payload,
  selectedLob,
  selectedShiftId,
  selectedSupervisorId,
  search,
  startDate,
  endDate,
  sort,
  page,
  view,
  onLobChange,
  onShiftChange,
  onSupervisorChange,
  onSearchChange,
  onStartDateChange,
  onEndDateChange,
  onSortChange,
  onPageChange,
  onViewChange,
  onRefresh
}: {
  loading: boolean;
  payload: PerformanceAgentsResponse | null;
  selectedLob: string;
  selectedShiftId: string;
  selectedSupervisorId: string;
  search: string;
  startDate: string;
  endDate: string;
  sort: { key: AgentSortKey; direction: AgentSortDirection };
  page: number;
  view: QualityGranularity;
  onLobChange: (value: string) => void;
  onShiftChange: (value: string) => void;
  onSupervisorChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onSortChange: (value: { key: AgentSortKey; direction: AgentSortDirection }) => void;
  onPageChange: (value: number) => void;
  onViewChange: (value: QualityGranularity) => void;
  onRefresh: () => void;
}) {
  const lobs = normalizeLobs(payload?.filters.lobs ?? []);
  const handleSort = (key: AgentSortKey) => {
    const textColumn = key === "employeeName" || key === "wbLogin" || key === "lob" || key === "supervisor" || key === "shift";
    onSortChange({
      key,
      direction: sort.key === key ? (sort.direction === "desc" ? "asc" : "desc") : textColumn ? "asc" : "desc"
    });
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-base font-black text-navy-950">Produtividade dos agentes</h2>
          <p className="mt-1 text-xs font-bold text-muted">
            {selectedLob === "CEC"
              ? "CPD calculado a partir da base CEC vigente."
              : "Output e AHT calculados a partir da base de produção vigente."}
          </p>
        </div>
        <button type="button" onClick={onRefresh} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-xs font-black text-navy-950 hover:bg-slate-50">
          <RefreshCw className="h-4 w-4" /> Atualizar
        </button>
      </div>

      <div className="space-y-4 p-4">
        <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-end 2xl:justify-between">
          <div className="flex flex-col gap-4 xl:flex-row xl:flex-wrap xl:items-end">
            <SlicerGroup label="Visão">
              <SlicerButton active={view === "monthly"} label="Mensal" onClick={() => onViewChange("monthly")} />
              <SlicerButton active={view === "weekly"} label="Semanal" onClick={() => onViewChange("weekly")} />
              <SlicerButton active={view === "daily"} label="Diário" onClick={() => onViewChange("daily")} />
            </SlicerGroup>
            <DateRangeFilter
              startDate={startDate}
              endDate={endDate}
              minDate={payload?.dataRange?.startDate ?? ""}
              maxDate={payload?.dataRange?.endDate ?? ""}
              onStartDateChange={onStartDateChange}
              onEndDateChange={onEndDateChange}
            />
            <SlicerGroup label="LOB">
              {lobs.map((lob) => <SlicerButton key={lob} active={selectedLob === lob} label={lob} onClick={() => onLobChange(lob)} tone="dark" />)}
            </SlicerGroup>
            <SlicerGroup label="Turno">
              <SlicerButton active={!selectedShiftId} label="Todos" onClick={() => onShiftChange("")} />
              {(payload?.filters.shifts ?? []).map((shift) => (
                <SlicerButton key={shift.id} active={selectedShiftId === shift.id} label={shift.name} onClick={() => onShiftChange(shift.id)} />
              ))}
            </SlicerGroup>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 2xl:w-[620px]">
            <label className="block">
              <span className="mb-2 block text-[11px] font-black uppercase tracking-wide text-muted">Supervisor</span>
              <select
                value={selectedSupervisorId}
                onChange={(event) => onSupervisorChange(event.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm font-bold text-navy-950 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                <option value="">Todos os supervisores</option>
                {(payload?.filters.supervisors ?? []).map((supervisor) => <option key={supervisor.id} value={supervisor.id}>{supervisor.fullName}</option>)}
              </select>
            </label>
            <label className="relative block self-end">
              <span className="mb-2 block text-[11px] font-black uppercase tracking-wide text-muted">Agente</span>
              <Search className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 text-muted" />
              <input
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Buscar nome ou WB/Login"
                className="h-10 w-full rounded-xl border border-border bg-white pl-9 pr-3 text-sm font-semibold text-navy-950 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
          </div>
        </div>

        {!selectedLob ? (
          <div className="grid min-h-[300px] place-items-center rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 px-6 text-center">
            <div className="max-w-md">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white text-blue-600 shadow-sm"><Users className="h-5 w-5" /></span>
              <h3 className="mt-4 text-lg font-black text-navy-950">Selecione uma LOB</h3>
              <p className="mt-2 text-sm font-semibold text-muted">Os agentes serão consultados somente para a operação escolhida.</p>
            </div>
          </div>
        ) : loading && !payload?.agents.length ? <EmptyBox label="Carregando produtividade dos agentes..." /> : (
          <div className="space-y-4">
            <div className={cn("grid gap-3", selectedLob === "CEC" ? "md:grid-cols-4" : "md:grid-cols-3")}>
              <StatCard title="Agentes" value={formatNumber(payload?.summary.agents ?? 0)} helper="com produção no período" icon={Users} tone="purple" />
              {selectedLob === "CEC" ? (
                <StatCard
                  title="Output total"
                  value={formatNumber(payload?.summary.submit ?? 0)}
                  helper="tickets no período"
                  icon={FileSpreadsheet}
                  tone="green"
                />
              ) : null}
              <StatCard
                title={selectedLob === "CEC" ? "CPD médio" : "Output médio/dia"}
                value={formatNumber(payload?.summary.outputAveragePerDay ?? 0)}
                helper={`${formatNumber(payload?.summary.daysWithData ?? 0)} dia(s) trabalhado(s)`}
                icon={FileSpreadsheet}
                tone="blue"
              />
              <StatCard
                title="AHT médio"
                value={selectedLob === "CEC" ? "-" : formatSeconds(payload?.summary.ahtSeconds)}
                helper={selectedLob === "CEC" ? "não disponível na base CPD" : "moderação / output"}
                icon={Clock}
                tone="orange"
              />
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <h3 className="text-sm font-black text-navy-950">Agentes da operação</h3>
                  <p className="mt-1 text-xs font-bold text-muted">{formatNumber(payload?.pagination.totalRows ?? 0)} resultado(s) · clique no cabeçalho para ordenar</p>
                </div>
                {loading ? <span className="inline-flex items-center gap-2 text-xs font-black text-blue-600"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Atualizando</span> : null}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1040px] text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-black uppercase tracking-wide text-muted">
                    <tr>
                      <AgentSortHeader label="Agente" sortKey="employeeName" current={sort} onSort={handleSort} />
                      <AgentSortHeader label="WB/Login" sortKey="wbLogin" current={sort} onSort={handleSort} />
                      <AgentSortHeader label="LOB" sortKey="lob" current={sort} onSort={handleSort} />
                      <AgentSortHeader label="Supervisor" sortKey="supervisor" current={sort} onSort={handleSort} />
                      <AgentSortHeader label="Turno" sortKey="shift" current={sort} onSort={handleSort} />
                      {selectedLob === "CEC" ? <AgentSortHeader label="Output" sortKey="outputTotal" current={sort} onSort={handleSort} align="right" /> : null}
                      <AgentSortHeader label={selectedLob === "CEC" ? "CPD médio" : "Output médio/dia"} sortKey="submit" current={sort} onSort={handleSort} align="right" />
                      <AgentSortHeader label="AHT" sortKey="aht" current={sort} onSort={handleSort} align="right" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {(payload?.agents ?? []).map((agent) => (
                      <tr key={`${agent.employeeId ?? agent.wbLogin}:${agent.lob}`} className="odd:bg-white even:bg-slate-50/45 hover:bg-blue-50/50">
                        <td className="px-3 py-3 font-black text-navy-950">{agent.employeeName}</td>
                        <td className="px-3 py-3 font-bold text-muted">{agent.wbLogin}</td>
                        <td className="px-3 py-3"><span className="rounded-lg bg-blue-50 px-2 py-1 text-xs font-black text-blue-700">{agent.lob}</span></td>
                        <td className="px-3 py-3 font-bold text-navy-950">{agent.supervisor}</td>
                        <td className="px-3 py-3 font-bold text-muted">{agent.shift}</td>
                        {selectedLob === "CEC" ? <td className="px-3 py-3 text-right font-black text-navy-950">{formatNumber(agent.submit)}</td> : null}
                        <td className="px-3 py-3 text-right font-black text-navy-950">
                          {formatNumber(agent.outputAveragePerDay)}
                          <span className="mt-0.5 block text-[10px] font-bold text-muted">{formatNumber(agent.daysWithData)} dia(s)</span>
                        </td>
                        <td className="px-3 py-3 text-right font-black text-navy-950">{selectedLob === "CEC" ? "-" : formatSeconds(agent.ahtSeconds)}</td>
                      </tr>
                    ))}
                    {!payload?.agents.length ? <tr><td colSpan={selectedLob === "CEC" ? 8 : 7} className="px-3 py-10 text-center text-sm font-bold text-muted">Nenhum agente encontrado para os filtros selecionados.</td></tr> : null}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
                <p className="text-xs font-bold text-muted">Página {payload?.pagination.page ?? page} de {payload?.pagination.totalPages ?? 1}</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onPageChange(Math.max(1, page - 1))}
                    disabled={page <= 1 || loading}
                    className="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-white px-3 text-xs font-black text-navy-950 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" /> Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() => onPageChange(page + 1)}
                    disabled={page >= (payload?.pagination.totalPages ?? 1) || loading}
                    className="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-white px-3 text-xs font-black text-navy-950 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Próxima <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function SupervisorsView({
  loading,
  payload,
  view,
  startDate,
  endDate,
  onViewChange,
  onStartDateChange,
  onEndDateChange,
  onRefresh
}: {
  loading: boolean;
  payload: PerformanceSupervisorsResponse | null;
  view: SupervisorView;
  startDate: string;
  endDate: string;
  onViewChange: (value: SupervisorView) => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onRefresh: () => void;
}) {
  const summary = payload?.summary;
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-base font-black text-navy-950">Consolidado por supervisor</h2>
          <p className="mt-1 text-xs font-bold text-muted">ABS, attrition, humor, AHT e qualidade consolidados por time.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <SlicerGroup label="Visão">
            <SlicerButton active={view === "monthly"} label="Mensal" onClick={() => onViewChange("monthly")} />
            <SlicerButton active={view === "weekly"} label="Semanal" onClick={() => onViewChange("weekly")} />
            <SlicerButton active={view === "daily"} label="Diário" onClick={() => onViewChange("daily")} />
          </SlicerGroup>
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            minDate={payload?.dataRange?.startDate ?? ""}
            maxDate={payload?.dataRange?.endDate ?? ""}
            onStartDateChange={onStartDateChange}
            onEndDateChange={onEndDateChange}
          />
          <button type="button" onClick={onRefresh} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-xs font-black text-navy-950 hover:bg-slate-50">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Atualizar
          </button>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-100 bg-blue-50/50 px-4 py-3">
          <p className="text-xs font-black uppercase tracking-wide text-blue-700">Período analisado</p>
          <p className="text-sm font-black text-navy-950">{formatDashboardPeriod(payload?.period)}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard title="ABS do time" value={formatQualityPercent(summary?.absRate)} helper={`${formatNumber(summary?.absences ?? 0)} ausência(s)`} icon={Target} tone="orange" />
          <StatCard title="Attrition do time" value={formatQualityPercent(summary?.attritionRate)} helper={`${formatNumber(summary?.terminations ?? 0)} desligamento(s)`} icon={TrendingUp} tone="purple" />
          <StatCard title="Humor do time" value={formatMoodScore(summary?.moodAverage)} helper={`${formatNumber(summary?.moodResponses ?? 0)} resposta(s)`} icon={Gauge} tone="green" />
          <StatCard title="AHT do time" value={formatSeconds(summary?.ahtSeconds)} helper="ADS + TNS Video (meta 15 min)" icon={Clock} tone="blue" />
          <StatCard title="Qualidade do time" value={formatQualityPercent(summary?.quality)} helper={`${formatNumber(summary?.qualityTotal ?? 0)} caso(s)`} icon={ShieldCheck} tone="green" />
        </div>

        {loading && !payload ? <EmptyBox label="Carregando consolidado dos supervisores..." /> : (
          <div className="overflow-hidden rounded-xl border border-border bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <h3 className="text-sm font-black text-navy-950">Supervisores</h3>
                <p className="mt-1 text-xs font-bold text-muted">{formatNumber(summary?.supervisors ?? 0)} supervisor(es) no período</p>
              </div>
              {loading ? <span className="inline-flex items-center gap-2 text-xs font-black text-blue-600"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Atualizando</span> : null}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-black uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-3">Supervisor</th>
                    <th className="px-3 py-3 text-right">Time</th>
                    <th className="px-3 py-3 text-right">ABS</th>
                    <th className="px-3 py-3 text-right">Attrition</th>
                    <th className="px-3 py-3 text-right">Humor</th>
                    <th className="px-3 py-3 text-right">AHT</th>
                    <th className="px-4 py-3 text-right">Qualidade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {(payload?.supervisors ?? []).map((row) => (
                    <tr key={row.supervisorId} className="odd:bg-white even:bg-slate-50/45 hover:bg-blue-50/50">
                      <td className="px-4 py-3 font-black text-navy-950">{row.supervisor}</td>
                      <td className="px-3 py-3 text-right font-black text-navy-950">{formatNumber(row.teamSize)}</td>
                      <td className="px-3 py-3 text-right"><SupervisorMetric value={formatQualityPercent(row.absRate)} detail={`${formatNumber(row.absences)} / ${formatNumber(row.planned)}`} /></td>
                      <td className="px-3 py-3 text-right"><SupervisorMetric value={formatQualityPercent(row.attritionRate)} detail={`${formatNumber(row.terminations)} deslig.`} /></td>
                      <td className="px-3 py-3 text-right"><SupervisorMetric value={formatMoodScore(row.moodAverage)} detail={`${formatNumber(row.moodResponses)} resp.`} /></td>
                      <td className="px-3 py-3 text-right"><SupervisorMetric value={formatSeconds(row.ahtSeconds)} detail={`${formatNumber(row.submit)} output`} /></td>
                      <td className="px-4 py-3 text-right"><SupervisorMetric value={formatQualityPercent(row.quality)} detail={`${formatNumber(row.qualityTotal)} casos`} /></td>
                    </tr>
                  ))}
                  {!payload?.supervisors.length ? <tr><td colSpan={7} className="px-4 py-10 text-center text-sm font-bold text-muted">Nenhum supervisor encontrado para o período.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function SupervisorMetric({ value, detail }: { value: string; detail: string }) {
  return (
    <span className="inline-flex flex-col items-end">
      <strong className="font-black text-navy-950">{value}</strong>
      <span className="mt-0.5 text-[10px] font-bold text-muted">{detail}</span>
    </span>
  );
}

function AgentSortHeader({
  label,
  sortKey,
  current,
  onSort,
  align = "left"
}: {
  label: string;
  sortKey: AgentSortKey;
  current: { key: AgentSortKey; direction: AgentSortDirection };
  onSort: (key: AgentSortKey) => void;
  align?: "left" | "right";
}) {
  const active = current.key === sortKey;
  const Icon = !active ? ArrowUpDown : current.direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={cn("px-3 py-3", align === "right" && "text-right")}>
      <button type="button" onClick={() => onSort(sortKey)} className={cn("inline-flex items-center gap-1.5 hover:text-blue-600", align === "right" && "ml-auto")}>
        {label}<Icon className="h-3.5 w-3.5" />
      </button>
    </th>
  );
}

function QueueView({
  loading,
  rows,
  payload,
  lobs,
  selectedLob,
  startDate,
  endDate,
  granularity,
  onLobChange,
  onStartDateChange,
  onEndDateChange,
  onGranularityChange,
  onExport,
  onRefresh
}: {
  loading: boolean;
  rows: PerformanceTrendRow[];
  payload: PerformanceProductionResponse | null;
  lobs: string[];
  selectedLob: string;
  startDate: string;
  endDate: string;
  granularity: PerformanceGranularity;
  onLobChange: (value: string) => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onGranularityChange: (value: PerformanceGranularity) => void;
  onExport: () => void;
  onRefresh: () => void;
}) {
  const [queueSearch, setQueueSearch] = useState("");
  const [queueSort, setQueueSort] = useState<{ key: QueueSortKey; direction: QueueSortDirection }>({ key: "input", direction: "desc" });
  const queueRows = useMemo(() => {
    const search = queueSearch.trim().toLocaleLowerCase("pt-BR");
    const filtered = (payload?.queues ?? []).filter((row) => {
      if (!search) return true;
      return row.queueId.toLocaleLowerCase("pt-BR").includes(search)
        || row.queueName.toLocaleLowerCase("pt-BR").includes(search);
    });
    return [...filtered].sort((a, b) => compareQueueRows(a, b, queueSort.key, queueSort.direction)).slice(0, 250);
  }, [payload, queueSearch, queueSort]);
  const queueSummary = useMemo(() => summarizeQueueRows(queueRows), [queueRows]);
  const chartLimit = granularity === "hourly" ? 48 : granularity === "daily" ? 30 : 24;
  const chartRows = rows.slice(-chartLimit);
  const summaryInput = payload?.summary.input || queueSummary.input;
  const summarySubmit = payload?.summary.submit || queueSummary.submit;
  const summaryLatency = payload?.summary.latencyMinutes || queueSummary.latencyMinutes;
  const summaryRecords = payload?.summary.records || queueSummary.records;
  const summaryQueues = payload?.summary.queues ?? queueSummary.queues;
  const handleQueueSort = (key: QueueSortKey) => {
    setQueueSort((current) => ({
      key,
      direction: current.key === key ? (current.direction === "desc" ? "asc" : "desc") : key === "queue" ? "asc" : "desc"
    }));
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-base font-black text-navy-950">Dados de fila</h2>
        <button type="button" onClick={onRefresh} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-xs font-black text-navy-950 hover:bg-slate-50">
          <RefreshCw className="h-4 w-4" /> Atualizar
        </button>
      </div>

      <div className="space-y-4 p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
            <DateRangeFilter
              startDate={startDate}
              endDate={endDate}
              minDate={payload?.panel.dataRange?.startDate ?? ""}
              maxDate={payload?.panel.dataRange?.endDate ?? ""}
              onStartDateChange={onStartDateChange}
              onEndDateChange={onEndDateChange}
            />
            <SlicerGroup label="Visao">
              {granularityOptions.map((option) => <SlicerButton key={option.value} active={granularity === option.value} label={option.label} onClick={() => onGranularityChange(option.value)} />)}
            </SlicerGroup>
            <SlicerGroup label="LOB">
              {lobs.map((lob) => <SlicerButton key={lob} active={selectedLob === lob} label={lob} onClick={() => onLobChange(lob)} tone="dark" />)}
            </SlicerGroup>
          </div>
          <button type="button" onClick={onExport} disabled={!selectedLob} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-white px-3 text-xs font-black text-navy-950 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45">
            <Download className="h-4 w-4" /> Exportar XLSX
          </button>
        </div>

        {!selectedLob ? (
          <div className="grid min-h-[300px] place-items-center rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 px-6 text-center">
            <div className="max-w-md">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white text-blue-600 shadow-sm"><BarChart3 className="h-5 w-5" /></span>
              <h3 className="mt-4 text-lg font-black text-navy-950">Selecione uma LOB</h3>
              <p className="mt-2 text-sm font-semibold text-muted">O gráfico e a tabela serão carregados somente para a operação escolhida.</p>
            </div>
          </div>
        ) : loading ? <EmptyBox label="Carregando dados de Performance..." /> : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <StatCard title="Input" value={formatNumber(summaryInput)} helper={`${formatNumber(summaryQueues)} filas`} icon={Rows3} tone="cyan" />
              <StatCard title="Output" value={formatNumber(summarySubmit)} helper={`${formatNumber(summaryRecords)} registros`} icon={FileSpreadsheet} tone="blue" />
              <StatCard title="Latência" value={formatMinutes(summaryLatency)} helper="latência / output" icon={Clock} tone="orange" />
            </div>

            <div className="rounded-xl border border-border bg-white p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-navy-950">Input, Output e Latência</h3>
                  <p className="mt-1 text-xs font-bold text-muted">{selectedLob} · {granularityOptions.find((option) => option.value === granularity)?.label}</p>
                </div>
                <span className="rounded-lg bg-slate-50 px-3 py-1 text-xs font-black text-muted">{formatNumber(chartRows.length)} pontos</span>
              </div>
              {chartRows.length ? <QueueDashboardChart rows={chartRows} /> : <EmptyBox label="Sem dados para o filtro selecionado." />}
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-white">
              <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-black text-navy-950">Filas da operação</h3>
                  <p className="mt-1 text-xs font-bold text-muted">Ordene os indicadores pelo cabeçalho da tabela.</p>
                </div>
                <label className="relative block w-full sm:max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <input
                    value={queueSearch}
                    onChange={(event) => setQueueSearch(event.target.value)}
                    placeholder="Buscar ID ou nome da fila"
                    className="h-10 w-full rounded-xl border border-border bg-white pl-9 pr-3 text-sm font-semibold text-navy-950 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </label>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full min-w-[840px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-black uppercase tracking-wide text-muted">
                  <tr>
                    <QueueSortHeader label="Fila" sortKey="queue" current={queueSort} onSort={handleQueueSort} />
                    <th className="px-3 py-3">LOB</th>
                    <QueueSortHeader label="Input" sortKey="input" current={queueSort} onSort={handleQueueSort} align="right" />
                    <QueueSortHeader label="Output" sortKey="submit" current={queueSort} onSort={handleQueueSort} align="right" />
                    <QueueSortHeader label="Latência" sortKey="latency" current={queueSort} onSort={handleQueueSort} align="right" />
                    <QueueSortHeader label="AHT" sortKey="aht" current={queueSort} onSort={handleQueueSort} align="right" />
                    <QueueSortHeader label="Agentes" sortKey="agents" current={queueSort} onSort={handleQueueSort} align="right" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {queueRows.map((row) => (
                    <tr key={row.queueId} className="hover:bg-blue-50/40">
                      <td className="px-3 py-2">
                        <p className="max-w-[360px] truncate font-black text-navy-950" title={row.queueName}>{row.queueName}</p>
                        <p className="text-xs font-bold text-muted">{row.queueId}</p>
                      </td>
                      <td className="px-3 py-2 font-bold text-muted">{row.lob || "N/A"}</td>
                      <td className="px-3 py-2 text-right font-bold text-navy-950">{formatNumber(row.input)}</td>
                      <td className="px-3 py-2 text-right font-bold text-navy-950">{formatNumber(row.submit)}</td>
                      <td className="px-3 py-2 text-right font-bold text-navy-950">{formatMinutes(row.latencyMinutes)}</td>
                      <td className="px-3 py-2 text-right font-bold text-navy-950">{formatSeconds(row.ahtSeconds)}</td>
                      <td className="px-3 py-2 text-right font-bold text-navy-950">{formatNumber(row.agents)}</td>
                    </tr>
                  ))}
                  {!queueRows.length ? <tr><td colSpan={7} className="px-3 py-8 text-center text-sm font-bold text-muted">Sem filas para o filtro selecionado.</td></tr> : null}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function QueueDashboardChart({ rows }: { rows: PerformanceTrendRow[] }) {
  return (
    <div className="h-[360px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fontWeight: 700, fill: "#475569" }} tickLine={false} axisLine={false} minTickGap={18} />
          <YAxis yAxisId="volume" tick={{ fontSize: 11, fontWeight: 700, fill: "#475569" }} tickLine={false} axisLine={false} tickFormatter={(value) => formatCompactAxis(Number(value))} />
          <YAxis yAxisId="latency" orientation="right" tick={{ fontSize: 11, fontWeight: 700, fill: "#EA580C" }} tickLine={false} axisLine={false} tickFormatter={(value) => `${Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}m`} />
          <RechartsTooltip content={<QueueDashboardTooltip />} cursor={{ fill: "#EFF6FF" }} />
          <Legend wrapperStyle={{ fontSize: 12, fontWeight: 800 }} />
          <Bar yAxisId="volume" dataKey="input" name="Input" fill="#06B6D4" radius={[5, 5, 0, 0]} maxBarSize={34} />
          <Bar yAxisId="volume" dataKey="submit" name="Output" fill="#2563EB" radius={[5, 5, 0, 0]} maxBarSize={34} />
          <Line yAxisId="latency" type="monotone" dataKey="latencyMinutes" name="Latência" stroke="#F97316" strokeWidth={3} dot={false} activeDot={{ r: 5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function QueueDashboardTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: PerformanceTrendRow }> }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-xl border border-border bg-white p-3 text-xs font-bold text-navy-950 shadow-lg">
      <p className="mb-2 text-sm font-black">{row.label}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-5"><span>Input</span><span>{formatNumber(row.input)}</span></div>
        <div className="flex justify-between gap-5"><span>Output</span><span>{formatNumber(row.submit)}</span></div>
        <div className="flex justify-between gap-5"><span>Latência</span><span>{formatMinutes(row.latencyMinutes)}</span></div>
        <div className="flex justify-between gap-5"><span>AHT</span><span>{formatSeconds(row.ahtSeconds)}</span></div>
      </div>
    </div>
  );
}

function QueueSortHeader({
  label,
  sortKey,
  current,
  onSort,
  align = "left"
}: {
  label: string;
  sortKey: QueueSortKey;
  current: { key: QueueSortKey; direction: QueueSortDirection };
  onSort: (key: QueueSortKey) => void;
  align?: "left" | "right";
}) {
  const active = current.key === sortKey;
  const Icon = !active ? ArrowUpDown : current.direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={cn("px-3 py-3", align === "right" && "text-right")}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn("inline-flex items-center gap-1.5 hover:text-blue-600", align === "right" && "ml-auto")}
      >
        {label}<Icon className="h-3.5 w-3.5" />
      </button>
    </th>
  );
}

function ManualImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => Promise<void> | void }) {
  const [productionFile, setProductionFile] = useState<File | null>(null);
  const [volumeFile, setVolumeFile] = useState<File | null>(null);
  const [cecCpdFile, setCecCpdFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ManualImportResult | null>(null);

  const submit = async () => {
    if (!productionFile || !volumeFile || !cecCpdFile) {
      setError("Selecione as bases de Produção / Output, Filas / Input e CEC CPD / Output.");
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    setError("");
    setResult(null);
    try {
      const start = await performanceUploadRequest<{ uploadId: string }>("/api/performance/import/manual?action=start", { method: "POST" });
      const uploadFiles = [
        { file: productionFile, fileType: "production" },
        { file: volumeFile, fileType: "volume" },
        { file: cecCpdFile, fileType: "cecCpd" }
      ] as const;
      const chunkSize = 2 * 1024 * 1024;
      const totalChunks = uploadFiles.reduce((total, item) => total + Math.ceil(item.file.size / chunkSize), 0);
      let uploadedChunks = 0;

      for (const item of uploadFiles) {
        const fileChunks = Math.ceil(item.file.size / chunkSize);
        for (let chunkIndex = 0; chunkIndex < fileChunks; chunkIndex++) {
          const params = new URLSearchParams({
            action: "chunk",
            uploadId: start.uploadId,
            fileType: item.fileType,
            fileName: item.file.name,
            chunkIndex: String(chunkIndex),
            totalChunks: String(fileChunks)
          });
          await performanceUploadRequest(`/api/performance/import/manual?${params.toString()}`, {
            method: "POST",
            headers: { "content-type": "application/octet-stream" },
            body: item.file.slice(chunkIndex * chunkSize, Math.min(item.file.size, (chunkIndex + 1) * chunkSize))
          });
          uploadedChunks += 1;
          setUploadProgress(Math.round((uploadedChunks / Math.max(1, totalChunks)) * 85));
        }
      }

      setUploadProgress(90);
      const finalizeParams = new URLSearchParams({ action: "finalize", uploadId: start.uploadId });
      const body = await performanceUploadRequest<ManualImportResult>(`/api/performance/import/manual?${finalizeParams.toString()}`, { method: "POST" });
      setUploadProgress(100);
      setResult({ productionRows: body.productionRows, volumeRows: body.volumeRows, cecCpdRows: body.cecCpdRows, rowsError: body.rowsError });
      await onImported();
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "Não foi possível substituir a base de Performance.";
      setError(message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/35 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="performance-upload-title">
      <div className="w-full max-w-4xl overflow-hidden rounded-2xl border border-white/70 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-blue-600">Performance</p>
            <h2 id="performance-upload-title" className="mt-1 text-xl font-black text-navy-950">Substituir base atual</h2>
            <p className="mt-1 text-sm font-semibold text-muted">Envie as três planilhas. A base vigente só será substituída depois que todas forem validadas.</p>
          </div>
          <button type="button" onClick={onClose} disabled={uploading} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border text-muted hover:bg-slate-50 hover:text-navy-950 disabled:opacity-40" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid gap-4 md:grid-cols-3">
            <PerformanceFileField
              label="Produção / Output"
              helper="Base com agentname, submit e moderation duration."
              file={productionFile}
              onChange={setProductionFile}
            />
            <PerformanceFileField
              label="Filas / Input"
              helper="Base com queue_id e enqueue."
              file={volumeFile}
              onChange={setVolumeFile}
            />
            <PerformanceFileField
              label="CEC CPD / Output"
              helper="Base com perform_time(hour), agent_name e ticket_id(去重计数)."
              file={cecCpdFile}
              onChange={setCecCpdFile}
            />
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">
            Este envio substitui integralmente a base anterior de Performance. Nenhum histórico de uploads é acumulado.
          </div>

          {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}
          {result ? (
            <div className="grid gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 sm:grid-cols-4">
              <ImportResultMetric label="Output" value={result.productionRows} />
              <ImportResultMetric label="Input" value={result.volumeRows} />
              <ImportResultMetric label="CPD CEC" value={result.cecCpdRows} />
              <ImportResultMetric label="Linhas ignoradas" value={result.rowsError} />
            </div>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border bg-slate-50/70 px-5 py-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={uploading} className="h-10 rounded-xl border border-border bg-white px-4 text-sm font-black text-navy-950 hover:bg-slate-50 disabled:opacity-40">
            {result ? "Concluir" : "Cancelar"}
          </button>
          {!result ? (
            <button type="button" onClick={() => void submit()} disabled={uploading || !productionFile || !volumeFile || !cecCpdFile} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-black text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-45">
              {uploading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              {uploading ? `Enviando e validando... ${uploadProgress}%` : "Substituir base"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function QualityImportModal({
  initialScope,
  onClose,
  onImported
}: {
  initialScope: QualityImportScope;
  onClose: () => void;
  onImported: (scope: QualityImportScope) => Promise<void> | void;
}) {
  const [qualityScope, setQualityScope] = useState<QualityImportScope>(initialScope);
  const [qualityFile, setQualityFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<QualityImportResult | null>(null);

  const submit = async () => {
    if (!qualityFile) {
      setError("Selecione a base de Qualidade.");
      return;
    }
    if (qualityFile.size > 250 * 1024 * 1024) {
      setError("A base de Qualidade deve ter no máximo 250 MB.");
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    setError("");
    setResult(null);
    try {
      const start = await performanceUploadRequest<{ uploadId: string }>("/api/performance/import/manual?action=start", { method: "POST" });
      const chunkSize = 2 * 1024 * 1024;
      const totalChunks = Math.max(1, Math.ceil(qualityFile.size / chunkSize));

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const params = new URLSearchParams({
          action: "chunk",
          uploadId: start.uploadId,
          fileType: "quality",
          fileName: qualityFile.name,
          chunkIndex: String(chunkIndex),
          totalChunks: String(totalChunks)
        });
        await performanceUploadRequest(`/api/performance/import/manual?${params.toString()}`, {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: qualityFile.slice(chunkIndex * chunkSize, Math.min(qualityFile.size, (chunkIndex + 1) * chunkSize))
        });
        setUploadProgress(Math.round(((chunkIndex + 1) / totalChunks) * 85));
      }

      setUploadProgress(90);
      const finalizeParams = new URLSearchParams({ action: "finalize", uploadId: start.uploadId, qualityScope });
      const body = await performanceUploadRequest<QualityImportResult>(`/api/performance/import/manual?${finalizeParams.toString()}`, { method: "POST" });
      setUploadProgress(100);
      setResult({
        qualityScope: body.qualityScope,
        qualityRows: body.qualityRows,
        qualityRowsError: body.qualityRowsError,
        qualityRowsIgnored: body.qualityRowsIgnored
      });
      await onImported(qualityScope);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Não foi possível substituir a base de Qualidade.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/35 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="quality-upload-title">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/70 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-blue-600">Performance</p>
            <h2 id="quality-upload-title" className="mt-1 text-xl font-black text-navy-950">Substituir base de Qualidade</h2>
            <p className="mt-1 text-sm font-semibold text-muted">Envie o XLSX de QA e escolha qual snapshot operacional será atualizado.</p>
          </div>
          <button type="button" onClick={onClose} disabled={uploading} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border text-muted hover:bg-slate-50 hover:text-navy-950 disabled:opacity-40" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <SlicerGroup label="Base de qualidade">
            <SlicerButton active={qualityScope === "ADS"} label="ADS / PROJECT" onClick={() => { setQualityScope("ADS"); setQualityFile(null); setResult(null); }} tone="dark" />
            <SlicerButton active={qualityScope === "TNS"} label="VIDEO / COMMENTS" onClick={() => { setQualityScope("TNS"); setQualityFile(null); setResult(null); }} tone="dark" />
          </SlicerGroup>
          <PerformanceFileField
            label={qualityScope === "ADS" ? "Qualidade ADS / PROJECT" : "Qualidade VIDEO / COMMENTS"}
            helper="Base com audit_name, final_result e IDs dos casos. Suporta até 1.000.000 de linhas e 250 MB, processados em lotes."
            file={qualityFile}
            onChange={setQualityFile}
          />
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">
            Após a validação, o envio substitui apenas o snapshot de {qualityScope === "ADS" ? "ADS/PROJECT" : "VIDEO/COMMENTS"}. A outra base de qualidade será preservada.
          </div>
          {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}
          {result ? (
            <div className="grid gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 sm:grid-cols-3">
              <ImportResultMetric label="Importadas" value={result.qualityRows} />
              <ImportResultMetric label="Ignoradas" value={result.qualityRowsIgnored} />
              <ImportResultMetric label="Com erro" value={result.qualityRowsError} />
            </div>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border bg-slate-50/70 px-5 py-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={uploading} className="h-10 rounded-xl border border-border bg-white px-4 text-sm font-black text-navy-950 hover:bg-slate-50 disabled:opacity-40">
            {result ? "Concluir" : "Cancelar"}
          </button>
          {!result ? (
            <button type="button" onClick={() => void submit()} disabled={uploading || !qualityFile} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-black text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-45">
              {uploading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              {uploading ? `${uploadProgress < 90 ? "Enviando" : "Processando em lotes"}... ${uploadProgress}%` : "Substituir qualidade"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

async function performanceUploadRequest<T = Record<string, unknown>>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const bodyText = await response.text();
  let body: (T & { error?: string; message?: string }) | null = null;
  if (bodyText) {
    try {
      body = JSON.parse(bodyText) as T & { error?: string; message?: string };
    } catch {
      body = null;
    }
  }
  if (!response.ok || !body) {
    const platformMessage = response.status === 413
      ? "Uma parte do arquivo excedeu o limite do servidor. Tente novamente."
      : response.status === 504
        ? "O processamento demorou além do limite. Tente novamente; as partes já enviadas não alteraram a base vigente."
        : `O upload falhou (HTTP ${response.status}).`;
    throw new Error(body?.error ?? body?.message ?? platformMessage);
  }
  return body;
}

function PerformanceFileField({ label, helper, file, onChange }: { label: string; helper: string; file: File | null; onChange: (file: File | null) => void }) {
  return (
    <label className="group flex min-h-[170px] cursor-pointer flex-col justify-between rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-4 transition hover:border-blue-400 hover:bg-blue-50/50">
      <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(event) => onChange(event.target.files?.[0] ?? null)} />
      <span>
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-blue-600 shadow-sm"><FileSpreadsheet className="h-5 w-5" /></span>
        <span className="mt-3 block text-sm font-black text-navy-950">{label}</span>
        <span className="mt-1 block text-xs font-semibold leading-5 text-muted">{helper}</span>
      </span>
      <span className="mt-3 block truncate rounded-lg bg-white px-3 py-2 text-xs font-bold text-muted shadow-sm" title={file?.name}>
        {file ? `${file.name} · ${formatFileSize(file.size)}` : "Selecionar XLSX"}
      </span>
    </label>
  );
}

function ImportResultMetric({ label, value }: { label: string; value: number }) {
  return <div><p className="text-[11px] font-black uppercase tracking-wide text-emerald-700">{label}</p><p className="mt-1 text-xl font-black text-emerald-950">{formatNumber(value)}</p></div>;
}

function ForecastViewPanel({
  loading,
  model,
  lobs,
  selectedLob,
  selectedView,
  horizon,
  onLobChange,
  onViewChange,
  onHorizonChange,
  onRefresh
}: {
  loading: boolean;
  model: ForecastModel;
  lobs: string[];
  selectedLob: string;
  selectedView: ForecastView;
  horizon: number;
  onLobChange: (value: string) => void;
  onViewChange: (value: ForecastView) => void;
  onHorizonChange: (value: number) => void;
  onRefresh: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-base font-black text-navy-950">Forecast de enqueue</h2>
        <button type="button" onClick={onRefresh} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-xs font-black text-navy-950 hover:bg-slate-50">
          <RefreshCw className="h-4 w-4" /> Atualizar
        </button>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid w-full gap-4 md:grid-cols-2 xl:grid-cols-[minmax(320px,0.9fr)_auto_auto_minmax(390px,1.1fr)] xl:items-end">
          <div className="min-w-0">
            <p className="mb-2 text-[11px] font-black uppercase tracking-wide text-muted">Periodo</p>
            <div className="grid grid-cols-2 gap-2">
              <InfoTile title="Ultimo real" value={formatForecastDate(model.lastRealAt)} />
              <InfoTile title="Projetado ate" value={formatForecastDate(model.projectedUntil)} />
            </div>
          </div>

          <SlicerGroup label="Visao">
            {forecastViewOptions.map((option) => <SlicerButton key={option.value} active={selectedView === option.value} label={option.label} onClick={() => onViewChange(option.value)} />)}
          </SlicerGroup>
          <SlicerGroup label="Horizonte">
            {forecastHorizons.map((days) => <SlicerButton key={days} active={horizon === days} label={`${days} dias`} onClick={() => onHorizonChange(days)} tone="cyan" />)}
          </SlicerGroup>
          <SlicerGroup label="LOB">
            <SlicerButton active={!selectedLob} label="Todas as LOBs" onClick={() => onLobChange("")} tone="dark" />
            {lobs.filter((lob) => lob !== "N/A").map((lob) => <SlicerButton key={lob} active={selectedLob === lob} label={lob} onClick={() => onLobChange(lob)} tone="dark" />)}
          </SlicerGroup>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <ForecastCard title="Proximas 24h" value={formatOptionalNumber(model.next24h)} helper="enqueue previsto" icon={TrendingUp} tone="cyan" />
          <ForecastCard title={`${horizon} dias`} value={formatOptionalNumber(model.horizonTotal)} helper={`${model.horizonHours} horas base`} icon={BarChart3} tone="blue" />
          <ForecastCard title="Ajuste recente" value={formatOptionalMultiplier(model.adjustment)} helper="24h, 72h e hora" icon={RefreshCw} tone="green" />
          <ForecastCard title="Assertividade" value={formatOptionalPercent(model.accuracy)} helper="backtest 7 dias" icon={Gauge} tone="green" />
          <ForecastCard title="Pico previsto" value={formatOptionalNumber(model.peak.value || null)} helper={formatForecastDate(model.peak.at)} icon={Clock} tone="orange" />
        </div>

        <div className="rounded-xl border border-border bg-white p-3">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-sm font-black text-navy-950">Forecast {forecastViewOptions.find((option) => option.value === selectedView)?.label.toLowerCase()}</h3>
            <span className="text-xs font-bold text-muted">{selectedLob || "Todas as LOBs"} · {horizon} dias</span>
          </div>
          {loading ? <EmptyBox label="Carregando forecast..." /> : <ForecastChart rows={model.chartRows} />}
        </div>

        <div className="overflow-x-auto rounded-xl border border-border bg-white">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-black uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-3">Periodo</th>
                <th className="px-3 py-3 text-right">Enqueue real</th>
                <th className="px-3 py-3 text-right">Forecast</th>
                <th className="px-3 py-3 text-right">Min</th>
                <th className="px-3 py-3 text-right">Max</th>
                <th className="px-3 py-3 text-right">Ajuste</th>
                <th className="px-3 py-3 text-right">Confianca</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {model.tableRows.map((row) => (
                <tr key={row.key} className="hover:bg-blue-50/40">
                  <td className="px-3 py-2 font-black text-navy-950">{row.label}</td>
                  <td className="px-3 py-2 text-right font-bold text-muted">{formatOptionalNumber(row.real)}</td>
                  <td className="px-3 py-2 text-right font-bold text-navy-950">{formatOptionalNumber(row.forecast)}</td>
                  <td className="px-3 py-2 text-right font-bold text-muted">{formatOptionalNumber(row.lower)}</td>
                  <td className="px-3 py-2 text-right font-bold text-muted">{formatOptionalNumber(row.upper)}</td>
                  <td className="px-3 py-2 text-right font-bold text-navy-950">{formatOptionalMultiplier(row.adjustment)}</td>
                  <td className="px-3 py-2 text-right font-bold text-navy-950">{formatOptionalPercent(row.confidence)}</td>
                </tr>
              ))}
              {!model.tableRows.length ? <tr><td colSpan={7} className="px-3 py-8 text-center text-sm font-bold text-muted">Sem forecast valido para o filtro selecionado.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function ForecastChart({ rows }: { rows: ForecastChartRow[] }) {
  if (!rows.length) return <EmptyBox label="Sem pontos para exibir." />;
  return (
    <ResponsiveContainer width="100%" height={420}>
      <ComposedChart data={rows} margin={{ top: 14, right: 22, left: 0, bottom: 8 }}>
        <CartesianGrid stroke="#E5EAF2" vertical={false} strokeDasharray="4 4" />
        <XAxis dataKey="label" tick={{ fill: "#64748B", fontSize: 11, fontWeight: 700 }} tickLine={false} axisLine={false} minTickGap={18} />
        <YAxis tick={{ fill: "#64748B", fontSize: 12 }} tickLine={false} axisLine={false} />
        <RechartsTooltip content={<ForecastTooltip />} cursor={{ stroke: "#0f172a", strokeDasharray: "4 4" }} />
        <Line type="monotone" dataKey="real" name="Enqueue real" stroke="#2563EB" strokeWidth={3} dot={false} connectNulls={false} />
        <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#0284C7" strokeWidth={3} strokeDasharray="5 5" dot={false} connectNulls={false} />
        <Line type="monotone" dataKey="upper" name="Max" stroke="#93C5FD" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls={false} />
        <Line type="monotone" dataKey="lower" name="Min" stroke="#93C5FD" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function ForecastTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ForecastChartRow }> }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-xl border border-border bg-white p-3 text-xs font-bold shadow-xl">
      <p className="mb-2 font-black text-navy-950">{row.label}</p>
      <div className="space-y-1 text-muted">
        <div className="flex justify-between gap-4"><span>Enqueue real</span><span>{formatOptionalNumber(row.real)}</span></div>
        <div className="flex justify-between gap-4"><span>Forecast</span><span>{formatOptionalNumber(row.forecast)}</span></div>
        <div className="flex justify-between gap-4"><span>Faixa</span><span>{formatOptionalNumber(row.lower)} - {formatOptionalNumber(row.upper)}</span></div>
      </div>
    </div>
  );
}

function TabButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: LucideIcon; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={cn("inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-black transition", active ? "border-blue-600 bg-blue-600 text-white" : "border-border bg-white text-navy-950 hover:bg-blue-50")}><Icon className="h-4 w-4" />{label}</button>;
}

function SlicerGroup({ label, children, centered = false }: { label: string; children: React.ReactNode; centered?: boolean }) {
  return <div className={cn("flex flex-wrap gap-2", centered ? "justify-center text-center" : "items-center")}><span className="w-full text-[11px] font-black uppercase tracking-wide text-muted">{label}</span>{children}</div>;
}

function DateRangeFilter({
  startDate,
  endDate,
  minDate,
  maxDate,
  onStartDateChange,
  onEndDateChange
}: {
  startDate: string;
  endDate: string;
  minDate: string;
  maxDate: string;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
}) {
  const hasRange = Boolean(startDate || endDate);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-full text-[11px] font-black uppercase tracking-wide text-muted">Data</span>
      <input
        type="date"
        value={startDate}
        min={minDate || undefined}
        max={endDate || maxDate || undefined}
        onChange={(event) => onStartDateChange(event.target.value)}
        className="h-9 rounded-lg border border-border bg-white px-3 text-xs font-black text-navy-950 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        aria-label="Data inicial"
      />
      <input
        type="date"
        value={endDate}
        min={startDate || minDate || undefined}
        max={maxDate || undefined}
        onChange={(event) => onEndDateChange(event.target.value)}
        className="h-9 rounded-lg border border-border bg-white px-3 text-xs font-black text-navy-950 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        aria-label="Data final"
      />
      {hasRange ? (
        <button
          type="button"
          onClick={() => {
            onStartDateChange("");
            onEndDateChange("");
          }}
          className="h-9 rounded-lg border border-border bg-white px-3 text-xs font-black text-muted hover:bg-slate-50 hover:text-navy-950"
        >
          Limpar
        </button>
      ) : null}
    </div>
  );
}

function SlicerButton({ active, label, onClick, tone = "blue", disabled = false }: { active: boolean; label: string; onClick: () => void; tone?: "blue" | "cyan" | "dark"; disabled?: boolean }) {
  const activeClass = tone === "cyan" ? "border-cyan-600 bg-cyan-600 text-white" : tone === "dark" ? "border-navy-950 bg-navy-950 text-white" : "border-blue-600 bg-blue-600 text-white";
  return <button type="button" aria-pressed={active} disabled={disabled} onClick={onClick} className={cn("h-9 rounded-lg border px-3 text-xs font-black transition disabled:cursor-default", active ? activeClass : "border-border bg-white text-navy-950 hover:bg-slate-50")}>{label}</button>;
}

function InfoTile({ title, value }: { title: string; value: string }) {
  return <div className="rounded-xl border border-border bg-white px-4 py-3"><p className="text-xs font-black uppercase tracking-wide text-muted">{title}</p><p className="mt-1 text-sm font-black text-navy-950">{value}</p></div>;
}

function ForecastCard({ title, value, helper, icon: Icon, tone }: { title: string; value: string; helper: string; icon: LucideIcon; tone: "blue" | "cyan" | "green" | "orange" }) {
  const toneClass = tone === "green" ? "bg-emerald-50 text-emerald-600" : tone === "orange" ? "bg-orange-50 text-orange-600" : tone === "cyan" ? "bg-cyan-50 text-cyan-600" : "bg-blue-50 text-blue-600";
  return <div className="rounded-2xl border border-border bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wide text-muted">{title}</p><p className="mt-2 text-2xl font-black text-navy-950">{value}</p><p className="mt-1 text-xs font-bold text-muted">{helper}</p></div><span className={cn("grid h-9 w-9 place-items-center rounded-xl", toneClass)}><Icon className="h-4 w-4" /></span></div></div>;
}

function MetricBar({ value, max, className }: { value: number; max: number; className: string }) {
  const width = `${Math.max(2, Math.min(100, (value / Math.max(1, max)) * 100))}%`;
  return <div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className={cn("h-full rounded-full", className)} style={{ width }} /></div>;
}

function EmptyBox({ label }: { label: string }) {
  return <div className="grid min-h-[120px] place-items-center rounded-xl border border-dashed border-border p-6 text-center text-sm font-bold text-muted">{label}</div>;
}

async function fetchPerformance(params: URLSearchParams): Promise<PerformanceProductionResponse> {
  const response = await fetch(`/api/performance?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? "Nao foi possivel carregar Performance.");
  }
  const data = await response.json() as PerformanceProductionResponse;
  if (data.mode !== "production") throw new Error("Resposta de Performance inesperada.");
  return data;
}

async function fetchPerformanceAgents(params: URLSearchParams): Promise<PerformanceAgentsResponse> {
  const response = await fetch(`/api/performance/agents?${params.toString()}`, { cache: "no-store" });
  const body = await response.json().catch(() => null) as (PerformanceAgentsResponse & { error?: string; message?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error || body?.message || "Não foi possível carregar os dados dos agentes.");
  if (body.mode !== "agents") throw new Error("Resposta de agentes inesperada.");
  return body;
}

async function fetchPerformanceSupervisors(params: URLSearchParams): Promise<PerformanceSupervisorsResponse> {
  const response = await fetch(`/api/performance/supervisors?${params.toString()}`, { cache: "no-store" });
  const body = await response.json().catch(() => null) as (PerformanceSupervisorsResponse & { error?: string; message?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error || body?.message || "Não foi possível carregar os dados dos supervisores.");
  if (body.mode !== "supervisors") throw new Error("Resposta de supervisores inesperada.");
  return body;
}

function buildForecastModel(rows: PerformanceTrendRow[], horizonDays: number, view: ForecastView): ForecastModel {
  const actuals = rows
    .map((row) => ({ at: parseTrendHour(row.key), input: Math.max(0, Number(row.input || 0)) }))
    .filter((row): row is { at: Date; input: number } => Boolean(row.at))
    .map((row) => ({ at: row.at, timestamp: row.at.getTime(), input: row.input }))
    .sort((a, b) => a.timestamp - b.timestamp);

  const positiveActuals = actuals.filter((row) => row.input > 0);
  const lastReal = positiveActuals.at(-1) ?? actuals.at(-1) ?? null;
  const horizonHours = horizonDays * 24;

  if (!lastReal || !positiveActuals.length) {
    return { hasForecast: false, lastRealAt: lastReal?.at ?? null, projectedUntil: null, next24h: null, horizonTotal: null, peak: { value: 0, at: null }, adjustment: null, accuracy: null, horizonHours, chartRows: aggregateForecastRows(actualsToHours(actuals.slice(-168)), view), tableRows: [] };
  }

  const modelWeights = calculateForecastModelWeights(positiveActuals, lastReal.at);
  const future: ForecastHour[] = [];
  for (let index = 1; index <= horizonHours; index++) {
    const at = new Date(lastReal.timestamp + index * hourMs);
    const prediction = predictHour(positiveActuals, at, lastReal.at, modelWeights);
    future.push({
      at,
      timestamp: at.getTime(),
      label: formatHourLabel(at),
      real: null,
      forecast: round(prediction.forecast),
      lower: round(prediction.lower),
      upper: round(prediction.upper),
      adjustment: roundRatio(prediction.adjustment),
      confidence: roundRatio(prediction.confidence),
      samples: prediction.samples
    });
  }

  const projectedRows = future.filter((row) => Number(row.forecast) > 0);
  const next24h = sum(projectedRows.slice(0, 24).map((row) => row.forecast ?? 0));
  const horizonTotal = sum(projectedRows.map((row) => row.forecast ?? 0));
  const peak = projectedRows.reduce<{ value: number; at: Date | null }>((current, row) => {
    const value = row.forecast ?? 0;
    return value > current.value ? { value, at: row.at } : current;
  }, { value: 0, at: null });
  const adjustment = weightedAverageValue(projectedRows.map((row) => ({ value: row.adjustment ?? 1, weight: row.forecast ?? 1 })));
  const accuracy = calculateBacktestAccuracy(positiveActuals, lastReal.at, modelWeights);
  const historical = buildHistoricalForecastHours(actuals, modelWeights, 168);
  const combinedRows = aggregateForecastRows([...historical, ...future], view);
  const chartRows = combinedRows;
  const tableRows = selectForecastTableRows(combinedRows, lastReal.at, view, horizonDays);

  return {
    hasForecast: projectedRows.length > 0,
    lastRealAt: lastReal.at,
    projectedUntil: future.at(-1)?.at ?? null,
    next24h: projectedRows.length ? next24h : null,
    horizonTotal: projectedRows.length ? horizonTotal : null,
    peak,
    adjustment: projectedRows.length ? adjustment : null,
    accuracy,
    horizonHours,
    chartRows,
    tableRows
  };
}

function buildHistoricalForecastHours(actuals: ForecastActual[], modelWeights: ForecastModelWeights, limit: number): ForecastHour[] {
  const firstIndex = Math.max(0, actuals.length - limit);
  return actuals.slice(firstIndex).map((row, index) => {
    const absoluteIndex = firstIndex + index;
    const history = actuals.slice(0, absoluteIndex).filter((item) => item.input > 0);
    if (history.length < 24) {
      return {
        at: row.at,
        timestamp: row.timestamp,
        label: formatHourLabel(row.at),
        real: row.input,
        forecast: null,
        lower: null,
        upper: null,
        adjustment: null,
        confidence: null,
        samples: history.length
      };
    }

    const referenceAt = new Date(row.timestamp - hourMs);
    const prediction = predictHour(history, row.at, referenceAt, modelWeights);
    return {
      at: row.at,
      timestamp: row.timestamp,
      label: formatHourLabel(row.at),
      real: row.input,
      forecast: round(prediction.forecast),
      lower: round(prediction.lower),
      upper: round(prediction.upper),
      adjustment: roundRatio(prediction.adjustment),
      confidence: roundRatio(prediction.confidence),
      samples: prediction.samples
    };
  });
}

function selectForecastTableRows(rows: ForecastChartRow[], lastRealAt: Date, view: ForecastView, horizonDays: number) {
  const lastRealTime = lastRealAt.getTime();
  const pivotIndex = rows.reduce((latestIndex, row, index) => {
    const timestamp = new Date(row.key).getTime();
    return Number.isFinite(timestamp) && timestamp <= lastRealTime ? index : latestIndex;
  }, -1);
  if (pivotIndex < 0) return rows.slice(0, view === "hour" ? 168 : 60);

  const historicalCount = view === "hour" ? 24 : view === "day" ? 7 : 4;
  const futureCount = view === "hour"
    ? Math.min(horizonDays * 24, 168)
    : view === "day"
      ? horizonDays
      : Math.max(1, Math.ceil(horizonDays / 7));
  return rows.slice(Math.max(0, pivotIndex - historicalCount + 1), pivotIndex + futureCount + 1);
}

function predictHour(actuals: ForecastActual[], targetAt: Date, referenceAt: Date, modelWeights: ForecastModelWeights = defaultForecastModelWeights) {
  const referenceTime = referenceAt.getTime();
  const targetHour = targetAt.getUTCHours();
  const training = actuals.filter((row) => row.timestamp <= referenceTime && row.input > 0);
  const candidates = buildForecastCandidates(training, targetAt, referenceAt);
  const fallbackRows = training.filter((row) => row.timestamp >= referenceTime - 14 * dayMs);
  const fallback = weightedAverage(fallbackRows.length ? fallbackRows : training, referenceAt);
  let total = 0;
  let weight = 0;
  let sampleCount = 0;
  for (const candidate of candidates) {
    const candidateWeight = (modelWeights[candidate.name] ?? 0) * clamp(candidate.confidence, 0.12, 1.25);
    total += candidate.value * candidateWeight;
    weight += candidateWeight;
    sampleCount += candidate.samples;
  }
  const blended = weight > 0 ? total / weight : fallback;
  const adjustment = calculateRecentAdjustment(training, targetAt, referenceAt);
  const forecast = Math.max(0, blended * adjustment);
  const dispersionRows = training.filter((row) => row.at.getUTCHours() === targetHour && row.timestamp >= referenceTime - 28 * dayMs);
  const stats = statsFor(dispersionRows.length ? dispersionRows : candidates.map((candidate) => ({ input: candidate.value })));
  const spread = stats.mean > 0 ? stats.stdDev / stats.mean : 0.45;
  const band = clamp(0.18 + spread * 0.42 + Math.abs(adjustment - 1) * 0.16 + (sampleCount < 8 ? 0.16 : 0), 0.2, 1.05);
  const confidence = clamp(0.92 - spread * 0.22 - Math.abs(adjustment - 1) * 0.16 + Math.min(sampleCount, 36) * 0.006, 0.34, 0.96);
  return { forecast, lower: forecast * (1 - band), upper: forecast * (1 + band), adjustment, confidence, samples: sampleCount };
}

function buildForecastCandidates(actuals: ForecastActual[], targetAt: Date, referenceAt: Date): ForecastCandidate[] {
  const referenceTime = referenceAt.getTime();
  const targetDay = targetAt.getUTCDay();
  const targetHour = targetAt.getUTCHours();
  const candidates: ForecastCandidate[] = [];
  const seasonalSlot = actuals.filter((row) => row.at.getUTCDay() === targetDay && row.at.getUTCHours() === targetHour);
  const sameHourRecent = actuals.filter((row) => row.at.getUTCHours() === targetHour && row.timestamp >= referenceTime - 35 * dayMs);
  const profileValue = recentHourlyProfileForecast(actuals, targetAt, referenceAt);
  const momentumValue = shortMomentumForecast(actuals, targetAt, referenceAt);

  if (seasonalSlot.length) {
    candidates.push({
      name: "seasonalSlot",
      value: weightedAverage(seasonalSlot, referenceAt),
      samples: seasonalSlot.length,
      confidence: clamp(seasonalSlot.length / 8, 0.25, 1)
    });
  }
  if (sameHourRecent.length) {
    candidates.push({
      name: "sameHourRecent",
      value: weightedAverage(sameHourRecent, referenceAt, 10),
      samples: sameHourRecent.length,
      confidence: clamp(sameHourRecent.length / 10, 0.28, 1.05)
    });
  }
  if (profileValue.value > 0) {
    candidates.push({
      name: "recentProfile",
      value: profileValue.value,
      samples: profileValue.samples,
      confidence: clamp(profileValue.samples / 24, 0.25, 1.1)
    });
  }
  if (momentumValue.value > 0) {
    candidates.push({
      name: "shortMomentum",
      value: momentumValue.value,
      samples: momentumValue.samples,
      confidence: clamp(momentumValue.samples / 8, 0.25, 1)
    });
  }
  return candidates.filter((candidate) => Number.isFinite(candidate.value) && candidate.value > 0);
}

function recentHourlyProfileForecast(actuals: ForecastActual[], targetAt: Date, referenceAt: Date) {
  const referenceTime = referenceAt.getTime();
  const targetHour = targetAt.getUTCHours();
  const recent = actuals.filter((row) => row.timestamp >= referenceTime - 7 * dayMs);
  const broader = actuals.filter((row) => row.timestamp >= referenceTime - 28 * dayMs);
  const recentTotal = sum(recent.map((row) => row.input));
  const broaderTotal = sum(broader.map((row) => row.input));
  const recentDays = new Set(recent.map((row) => utcDayKey(row.at))).size;
  const broaderDays = new Set(broader.map((row) => utcDayKey(row.at))).size;
  const recentHourShare = recentTotal > 0 ? sum(recent.filter((row) => row.at.getUTCHours() === targetHour).map((row) => row.input)) / recentTotal : 0;
  const broaderHourShare = broaderTotal > 0 ? sum(broader.filter((row) => row.at.getUTCHours() === targetHour).map((row) => row.input)) / broaderTotal : 0;
  const share = recentHourShare && broaderHourShare ? recentHourShare * 0.72 + broaderHourShare * 0.28 : recentHourShare || broaderHourShare;
  const recentDailyAverage = recentDays > 0 ? recentTotal / recentDays : 0;
  const broaderDailyAverage = broaderDays > 0 ? broaderTotal / broaderDays : 0;
  const dailyAverage = recentDailyAverage && broaderDailyAverage ? recentDailyAverage * 0.72 + broaderDailyAverage * 0.28 : recentDailyAverage || broaderDailyAverage;
  return { value: dailyAverage * share, samples: recent.length || broader.length };
}

function shortMomentumForecast(actuals: ForecastActual[], targetAt: Date, referenceAt: Date) {
  const referenceTime = referenceAt.getTime();
  const targetHour = targetAt.getUTCHours();
  const recentSameHour = actuals.filter((row) => row.at.getUTCHours() === targetHour && row.timestamp >= referenceTime - 10 * dayMs);
  const last72h = actuals.filter((row) => row.timestamp >= referenceTime - 72 * hourMs);
  const last24h = actuals.filter((row) => row.timestamp >= referenceTime - 24 * hourMs);
  const sameHourValue = recentSameHour.length ? weightedAverage(recentSameHour, referenceAt, 5) : 0;
  const hourlyMomentum = last72h.length ? sum(last72h.map((row) => row.input)) / Math.max(1, Math.min(72, Math.ceil((referenceTime - last72h[0].timestamp) / hourMs))) : 0;
  const hotNow = last24h.length ? sum(last24h.map((row) => row.input)) / Math.max(1, Math.min(24, Math.ceil((referenceTime - last24h[0].timestamp) / hourMs))) : 0;
  const value = sameHourValue > 0 ? sameHourValue * 0.62 + (hotNow || hourlyMomentum) * 0.38 : hotNow || hourlyMomentum;
  return { value, samples: recentSameHour.length + last24h.length };
}

function calculateForecastModelWeights(actuals: ForecastActual[], referenceAt: Date): ForecastModelWeights {
  const referenceTime = referenceAt.getTime();
  const testRows = actuals.filter((row) => row.timestamp >= referenceTime - 7 * dayMs && row.input > 0).slice(-168);
  const errors = new Map<ForecastModelName, { total: number; weight: number }>();
  for (const row of testRows) {
    const history = actuals.filter((item) => item.timestamp < row.timestamp && item.input > 0);
    if (history.length < 48) continue;
    const candidates = buildForecastCandidates(history, row.at, new Date(row.timestamp - hourMs));
    const recencyWeight = Math.pow(0.5, Math.max(0, (referenceTime - row.timestamp) / dayMs) / 3);
    for (const candidate of candidates) {
      const current = errors.get(candidate.name) ?? { total: 0, weight: 0 };
      const errorRatio = Math.abs(row.input - candidate.value) / Math.max(1, row.input);
      const rowWeight = Math.max(1, row.input) * recencyWeight * clamp(candidate.confidence, 0.25, 1.15);
      current.total += errorRatio * rowWeight;
      current.weight += rowWeight;
      errors.set(candidate.name, current);
    }
  }

  const scores = forecastModelNames.reduce<Record<ForecastModelName, number>>((acc, name) => {
    const error = errors.get(name);
    const averageError = error && error.weight > 0 ? error.total / error.weight : null;
    acc[name] = averageError === null ? defaultForecastModelWeights[name] : 1 / (averageError + 0.08);
    return acc;
  }, { ...defaultForecastModelWeights });
  const scoreTotal = forecastModelNames.reduce((total, name) => total + scores[name], 0);
  if (!scoreTotal) return defaultForecastModelWeights;
  return forecastModelNames.reduce<ForecastModelWeights>((acc, name) => {
    const learned = scores[name] / scoreTotal;
    acc[name] = learned * 0.72 + defaultForecastModelWeights[name] * 0.28;
    return acc;
  }, { ...defaultForecastModelWeights });
}

function calculateRecentAdjustment(actuals: ForecastActual[], targetAt: Date, referenceAt: Date) {
  const referenceTime = referenceAt.getTime();
  const targetHour = targetAt.getUTCHours();
  const ratios: Array<{ ratio: number; weight: number }> = [];
  addWindowRatio(ratios, actuals, referenceTime, 24 * hourMs, 0.36, 3.4);
  addWindowRatio(ratios, actuals, referenceTime, 72 * hourMs, 0.3, 3);
  addWindowRatio(ratios, actuals, referenceTime, 7 * dayMs, 0.18, 2.6);
  const sameHour = actuals.filter((row) => row.at.getUTCHours() === targetHour);
  const recentSameHour = sum(sameHour.filter((row) => row.timestamp > referenceTime - 10 * dayMs).map((row) => row.input));
  const previousSameHour = sum(sameHour.filter((row) => row.timestamp <= referenceTime - 10 * dayMs && row.timestamp > referenceTime - 50 * dayMs).map((row) => row.input)) / 4;
  if (previousSameHour > 0) ratios.push({ ratio: clamp(recentSameHour / previousSameHour, 0.35, 3.4), weight: 0.24 });
  if (!ratios.length) return 1;
  const raw = ratios.reduce((total, item) => total + item.ratio * item.weight, 0) / ratios.reduce((total, item) => total + item.weight, 0);
  return clamp(1 + (raw - 1) * 0.94, 0.45, 3.1);
}

function addWindowRatio(ratios: Array<{ ratio: number; weight: number }>, actuals: ForecastActual[], referenceTime: number, windowMs: number, weight: number, maxRatio: number) {
  const recent = sum(actuals.filter((row) => row.timestamp > referenceTime - windowMs).map((row) => row.input));
  const previous = sum(actuals.filter((row) => row.timestamp <= referenceTime - windowMs && row.timestamp > referenceTime - windowMs * 2).map((row) => row.input));
  if (previous > 0) ratios.push({ ratio: clamp(recent / previous, 0.35, maxRatio), weight });
}

function calculateBacktestAccuracy(actuals: ForecastActual[], lastReal: Date, modelWeights: ForecastModelWeights) {
  const testStart = lastReal.getTime() - 7 * dayMs;
  const testRows = actuals.filter((row) => row.timestamp > testStart && row.input > 0);
  let actualTotal = 0;
  let errorTotal = 0;
  let evaluated = 0;
  for (const row of testRows) {
    const history = actuals.filter((item) => item.timestamp < row.timestamp && item.input > 0);
    if (history.length < 24) continue;
    const predicted = predictHour(history, row.at, new Date(row.timestamp - hourMs), modelWeights).forecast;
    actualTotal += row.input;
    errorTotal += Math.abs(row.input - predicted);
    evaluated += 1;
  }
  if (!evaluated || actualTotal <= 0) return null;
  return clamp(1 - errorTotal / actualTotal, 0, 1);
}

function actualsToHours(actuals: Array<{ at: Date; timestamp: number; input: number }>): ForecastHour[] {
  return actuals.map((row) => ({ at: row.at, timestamp: row.timestamp, label: formatHourLabel(row.at), real: row.input, forecast: null, lower: null, upper: null, adjustment: null, confidence: null, samples: 0 }));
}

function aggregateForecastRows(rows: ForecastHour[], view: ForecastView): ForecastChartRow[] {
  if (view === "hour") {
    return rows.map((row) => ({ key: row.at.toISOString(), label: row.label, real: row.real, forecast: row.forecast, lower: row.lower, upper: row.upper, adjustment: row.adjustment, confidence: row.confidence }));
  }
  const byKey = new Map<string, { at: Date; real: number; forecast: number; lower: number; upper: number; adjustmentWeight: number; adjustmentTotal: number; confidenceWeight: number; confidenceTotal: number }>();
  for (const row of rows) {
    const start = view === "day" ? startOfUtcDay(row.at) : startOfUtcWeek(row.at);
    const key = start.toISOString();
    const current = byKey.get(key) ?? { at: start, real: 0, forecast: 0, lower: 0, upper: 0, adjustmentWeight: 0, adjustmentTotal: 0, confidenceWeight: 0, confidenceTotal: 0 };
    current.real += row.real ?? 0;
    current.forecast += row.forecast ?? 0;
    current.lower += row.lower ?? 0;
    current.upper += row.upper ?? 0;
    if (row.adjustment !== null && row.forecast !== null) {
      current.adjustmentTotal += row.adjustment * Math.max(1, row.forecast);
      current.adjustmentWeight += Math.max(1, row.forecast);
    }
    if (row.confidence !== null && row.forecast !== null) {
      current.confidenceTotal += row.confidence * Math.max(1, row.forecast);
      current.confidenceWeight += Math.max(1, row.forecast);
    }
    byKey.set(key, current);
  }
  return Array.from(byKey.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, row]) => ({
    key,
    label: view === "day" ? formatDayLabel(row.at) : formatWeekLabel(row.at),
    real: row.real > 0 ? round(row.real) : null,
    forecast: row.forecast > 0 ? round(row.forecast) : null,
    lower: row.lower > 0 ? round(row.lower) : null,
    upper: row.upper > 0 ? round(row.upper) : null,
    adjustment: row.adjustmentWeight > 0 ? roundRatio(row.adjustmentTotal / row.adjustmentWeight) : null,
    confidence: row.confidenceWeight > 0 ? roundRatio(row.confidenceTotal / row.confidenceWeight) : null
  }));
}

function weightedAverage(rows: Array<{ timestamp: number; input: number }>, referenceAt: Date, halfLifeDays = 21) {
  const reference = referenceAt.getTime();
  let total = 0;
  let weight = 0;
  for (const row of rows) {
    const ageDays = Math.max(0, (reference - row.timestamp) / dayMs);
    const rowWeight = Math.pow(0.5, ageDays / halfLifeDays);
    total += row.input * rowWeight;
    weight += rowWeight;
  }
  return weight > 0 ? total / weight : 0;
}

function weightedAverageValue(rows: Array<{ value: number; weight: number }>) {
  const totalWeight = rows.reduce((total, row) => total + row.weight, 0);
  return totalWeight > 0 ? rows.reduce((total, row) => total + row.value * row.weight, 0) / totalWeight : null;
}

function statsFor(rows: Array<{ input: number }>) {
  if (!rows.length) return { mean: 0, stdDev: 0 };
  const mean = sum(rows.map((row) => row.input)) / rows.length;
  const variance = rows.reduce((total, row) => total + (row.input - mean) ** 2, 0) / rows.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

function parseTrendHour(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):/);
  if (!match) return null;
  const [, year, month, day, hour] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), 0, 0, 0));
}

function normalizeLobs(lobs: string[]) {
  const preferred = ["ADS", "VIDEO", "COMMENTS", "N/A"];
  const set = new Set(lobs.map((lob) => String(lob).trim().toUpperCase()).filter(Boolean));
  return preferred.filter((lob) => set.has(lob));
}

function summarizeQueueRows(rows: PerformanceQueueRow[]) {
  const summary = rows.reduce(
    (acc, row) => {
      acc.records += row.records || 0;
      acc.input += row.input || 0;
      acc.submit += row.submit || 0;
      acc.moderationSeconds += row.moderationSeconds || 0;
      acc.latencyWeighted += (row.latencyMinutes || 0) * (row.submit || 0);
      acc.latencyWeight += row.submit || 0;
      return acc;
    },
    { records: 0, input: 0, submit: 0, moderationSeconds: 0, latencyWeighted: 0, latencyWeight: 0 }
  );

  return {
    records: summary.records,
    input: summary.input,
    submit: summary.submit,
    queues: rows.length,
    latencyMinutes: summary.latencyWeight > 0 ? summary.latencyWeighted / summary.latencyWeight : 0,
    ahtSeconds: summary.submit > 0 ? summary.moderationSeconds / summary.submit : 0
  };
}

function compareQueueRows(a: PerformanceQueueRow, b: PerformanceQueueRow, key: QueueSortKey, direction: QueueSortDirection) {
  const multiplier = direction === "asc" ? 1 : -1;
  if (key === "queue") return a.queueName.localeCompare(b.queueName, "pt-BR", { sensitivity: "base" }) * multiplier;
  const valueA = key === "input" ? a.input
    : key === "submit" ? a.submit
      : key === "latency" ? a.latencyMinutes
        : key === "aht" ? a.ahtSeconds
          : a.agents;
  const valueB = key === "input" ? b.input
    : key === "submit" ? b.submit
      : key === "latency" ? b.latencyMinutes
        : key === "aht" ? b.ahtSeconds
          : b.agents;
  if (valueA !== valueB) return (valueA - valueB) * multiplier;
  return a.queueName.localeCompare(b.queueName, "pt-BR", { sensitivity: "base" });
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number) {
  return Math.round(Number.isFinite(value) ? value : 0);
}

function roundRatio(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 1000) / 1000;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function utcDayKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function startOfUtcWeek(date: Date) {
  const day = date.getUTCDay();
  const sinceMonday = day === 0 ? 6 : day - 1;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - sinceMonday));
}

function formatUpload(value?: string | null) {
  return value || "-";
}

function formatQualityPercent(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
    : "-";
}

function qualityGranularityLabel(granularity: QualityGranularity) {
  if (granularity === "monthly") return "Mensal";
  if (granularity === "weekly") return "Semanal";
  return "Diária";
}

function qualityGranularityUnit(granularity: QualityGranularity) {
  if (granularity === "monthly") return "meses";
  if (granularity === "weekly") return "semanas";
  return "dias";
}

function formatQualityRange(range?: { startDate: string; endDate: string } | null) {
  if (!range) return "-";
  return `${formatDateOnlyPtBr(range.startDate)} - ${formatDateOnlyPtBr(range.endDate)}`;
}

function formatDashboardPeriod(period?: { startDate: string; endDate: string } | null) {
  if (!period) return "-";
  const start = formatDateOnlyPtBr(period.startDate);
  const end = formatDateOnlyPtBr(period.endDate);
  return start === end ? start : `${start} a ${end}`;
}

function formatMoodScore(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? `${value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/5`
    : "-";
}

function formatQualityImportDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatQualityAuditDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDateOnlyPtBr(value: string) {
  const date = parseDateOnly(value);
  if (!date) return value;
  return date.toLocaleDateString("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatBaseRange(panel?: PerformancePanel | null) {
  if (!panel?.dataRange) return "-";
  const start = formatDateCompact(panel.dataRange.startDate);
  const end = panel.lastDataAt ? formatDateTimeCompact(panel.lastDataAt) : formatDateCompact(panel.dataRange.endDate);
  return `${start} - ${end}`;
}

function formatRangeHelper(panel?: PerformancePanel | null) {
  if (!panel?.dataRange) return "range do upload";
  const start = parseDateOnly(panel.dataRange.startDate);
  const end = parseDateOnly(panel.dataRange.endDate);
  if (!start || !end) return "range do upload";
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / dayMs) + 1);
  return `${formatNumber(days)} dias recebidos no upload`;
}

function formatDateCompact(value: string) {
  const date = parseDateOnly(value);
  if (!date) return value;
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}, 00`;
}

function formatDateTimeCompact(value: string) {
  const match = value.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (match) return `${match[1]}/${match[2]}, ${match[4]}`;
  return value;
}

function parseDateOnly(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function formatHourLabel(date: Date) {
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")} ${String(date.getUTCHours()).padStart(2, "0")}:00`;
}

function formatDayLabel(date: Date) {
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatWeekLabel(date: Date) {
  const end = new Date(date.getTime() + 6 * dayMs);
  return `${formatDayLabel(date)}-${formatDayLabel(end)}`;
}

function formatForecastDate(date?: Date | null) {
  return date ? formatHourLabel(date) : "N/A";
}

function formatOptionalNumber(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? formatNumber(Math.round(value)) : "N/A";
}

function formatOptionalMultiplier(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x` : "N/A";
}

function formatOptionalPercent(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : "N/A";
}

function formatMinutes(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} min` : "-";
}

function formatSeconds(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}s` : "-";
}

function formatCompactAxis(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1000) return `${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 KB";
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
  return `${Math.ceil(size / 1024).toLocaleString("pt-BR")} KB`;
}
