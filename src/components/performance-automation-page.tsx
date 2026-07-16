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
  Clock,
  Download,
  FileSpreadsheet,
  Gauge,
  LineChart as LineChartIcon,
  LockKeyhole,
  RefreshCw,
  Rows3,
  Search,
  Target,
  TrendingUp,
  Trophy,
  UploadCloud,
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
  rowsError: number;
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
  const [activeTab, setActiveTab] = useState<"queue" | "forecast">("queue");
  const [queueGranularity, setQueueGranularity] = useState<PerformanceGranularity>("daily");
  const [queueLob, setQueueLob] = useState("");
  const [queueStartDate, setQueueStartDate] = useState("");
  const [queueEndDate, setQueueEndDate] = useState("");
  const [forecastLob, setForecastLob] = useState("ADS");
  const [forecastView, setForecastView] = useState<ForecastView>("hour");
  const [forecastHorizon, setForecastHorizon] = useState(14);
  const [queuePayload, setQueuePayload] = useState<PerformanceProductionResponse | null>(null);
  const [forecastPayload, setForecastPayload] = useState<PerformanceProductionResponse | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [loadingForecast, setLoadingForecast] = useState(false);
  const [message, setMessage] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);

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

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (activeTab === "forecast") void loadForecast();
  }, [activeTab, loadForecast]);

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
            {basePayload?.canImport ? (
              <button type="button" onClick={() => setUploadOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-blue-700">
                <UploadCloud className="h-4 w-4" /> Subir bases
              </button>
            ) : null}
            <TopActions />
          </div>
        )}
      />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Último upload" value={formatUpload(basePayload?.panel.lastImport?.importedAt)} helper="base manual vigente" icon={CheckCircle2} tone="green" />
        <StatCard title="Janela da base" value={formatBaseRange(basePayload?.panel)} helper={formatRangeHelper(basePayload?.panel)} icon={CalendarClock} tone="purple" />
        <StatCard title="Output importado" value={formatNumber(basePayload?.panel.totalSubmit ?? basePayload?.summary.submit ?? 0)} helper="submit da base atual" icon={FileSpreadsheet} tone="blue" />
        <StatCard title="Input importado" value={formatNumber(basePayload?.panel.totalInput ?? basePayload?.summary.input ?? baseQueueSummary.input)} helper="enqueue da base atual" icon={Rows3} tone="cyan" />
      </section>

      <div className="flex flex-wrap gap-2">
        <TabButton active={activeTab === "queue"} icon={Rows3} label="Dados de fila" onClick={() => setActiveTab("queue")} />
        <TabButton active={activeTab === "forecast"} icon={LineChartIcon} label="Forecast" onClick={() => setActiveTab("forecast")} />
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
      ) : (
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
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ManualImportResult | null>(null);

  const submit = async () => {
    if (!productionFile || !volumeFile) {
      setError("Selecione as bases de Produção / Output e Filas / Input.");
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
        { file: volumeFile, fileType: "volume" }
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
      setResult({ productionRows: body.productionRows, volumeRows: body.volumeRows, rowsError: body.rowsError });
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
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/70 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-blue-600">Performance</p>
            <h2 id="performance-upload-title" className="mt-1 text-xl font-black text-navy-950">Substituir base atual</h2>
            <p className="mt-1 text-sm font-semibold text-muted">Envie as duas planilhas. A base vigente só será substituída depois que ambas forem validadas.</p>
          </div>
          <button type="button" onClick={onClose} disabled={uploading} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border text-muted hover:bg-slate-50 hover:text-navy-950 disabled:opacity-40" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">
            Este envio substitui integralmente a base anterior de Performance. Nenhum histórico de uploads é acumulado.
          </div>

          {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}
          {result ? (
            <div className="grid gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 sm:grid-cols-3">
              <ImportResultMetric label="Output" value={result.productionRows} />
              <ImportResultMetric label="Input" value={result.volumeRows} />
              <ImportResultMetric label="Linhas ignoradas" value={result.rowsError} />
            </div>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border bg-slate-50/70 px-5 py-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={uploading} className="h-10 rounded-xl border border-border bg-white px-4 text-sm font-black text-navy-950 hover:bg-slate-50 disabled:opacity-40">
            {result ? "Concluir" : "Cancelar"}
          </button>
          {!result ? (
            <button type="button" onClick={() => void submit()} disabled={uploading || !productionFile || !volumeFile} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-black text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-45">
              {uploading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              {uploading ? `Enviando e validando... ${uploadProgress}%` : "Substituir base"}
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

function SlicerButton({ active, label, onClick, tone = "blue" }: { active: boolean; label: string; onClick: () => void; tone?: "blue" | "cyan" | "dark" }) {
  const activeClass = tone === "cyan" ? "border-cyan-600 bg-cyan-600 text-white" : tone === "dark" ? "border-navy-950 bg-navy-950 text-white" : "border-blue-600 bg-blue-600 text-white";
  return <button type="button" aria-pressed={active} onClick={onClick} className={cn("h-9 rounded-lg border px-3 text-xs font-black transition", active ? activeClass : "border-border bg-white text-navy-950 hover:bg-slate-50")}>{label}</button>;
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
