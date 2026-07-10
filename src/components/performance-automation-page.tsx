"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type LucideIcon,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  Gauge,
  LineChart as LineChartIcon,
  LockKeyhole,
  RefreshCw,
  Rows3,
  Target,
  TrendingUp,
  Trophy
} from "lucide-react";
import {
  CartesianGrid,
  ComposedChart,
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

type PerformancePanel = {
  dataRange: { startDate: string; endDate: string } | null;
  lastDataAt: string | null;
  lastImport: { fileName: string; importedAt: string; rowsValid: number; rowsError?: number; status: string; ageHours?: number | null } | null;
  totalRows: number;
};

type PerformanceProductionResponse = {
  mode: "production";
  granularity: PerformanceGranularity;
  panel: PerformancePanel;
  filters: { lobs: string[] };
  summary: PerformanceSummary;
  trend: PerformanceTrendRow[];
};

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

export function PerformanceAutomationPage() {
  const [activeTab, setActiveTab] = useState<"queue" | "forecast">("queue");
  const [queueGranularity, setQueueGranularity] = useState<PerformanceGranularity>("daily");
  const [queueLob, setQueueLob] = useState("");
  const [forecastLob, setForecastLob] = useState("ADS");
  const [forecastView, setForecastView] = useState<ForecastView>("hour");
  const [forecastHorizon, setForecastHorizon] = useState(14);
  const [queuePayload, setQueuePayload] = useState<PerformanceProductionResponse | null>(null);
  const [forecastPayload, setForecastPayload] = useState<PerformanceProductionResponse | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [loadingForecast, setLoadingForecast] = useState(false);
  const [message, setMessage] = useState("");

  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    const params = new URLSearchParams({ granularity: queueGranularity });
    if (queueLob) params.set("lob", queueLob);
    try {
      const data = await fetchPerformance(params);
      setQueuePayload(data);
      setMessage("");
      if (!forecastLob && data.filters.lobs.length) setForecastLob(data.filters.lobs.includes("ADS") ? "ADS" : data.filters.lobs[0]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Nao foi possivel carregar Performance.");
    } finally {
      setLoadingQueue(false);
    }
  }, [forecastLob, queueGranularity, queueLob]);

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
  const forecast = useMemo(
    () => buildForecastModel(forecastPayload?.trend ?? [], forecastHorizon, forecastView),
    [forecastPayload, forecastHorizon, forecastView]
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Performance"
        description="Acompanhamento da automacao de producao e volume de entrada."
        icon={Trophy}
        actions={<TopActions />}
      />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Ultimo upload" value={formatUpload(basePayload?.panel.lastImport?.importedAt)} helper="producao e enqueue" icon={CheckCircle2} tone="green" />
        <StatCard title="Janela da base" value={formatBaseRange(basePayload?.panel)} helper={formatRangeHelper(basePayload?.panel)} icon={CalendarClock} tone="purple" />
        <StatCard title="Submit importado" value={formatNumber(basePayload?.summary.submit ?? 0)} helper={`${formatNumber(basePayload?.summary.records ?? 0)} registros`} icon={FileSpreadsheet} tone="blue" />
        <StatCard title="Enqueue importado" value={formatNumber(basePayload?.summary.input ?? 0)} helper={`${formatNumber(basePayload?.summary.queues ?? 0)} filas`} icon={Rows3} tone="cyan" />
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
          granularity={queueGranularity}
          onLobChange={setQueueLob}
          onGranularityChange={setQueueGranularity}
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
  granularity,
  onLobChange,
  onGranularityChange,
  onRefresh
}: {
  loading: boolean;
  rows: PerformanceTrendRow[];
  payload: PerformanceProductionResponse | null;
  lobs: string[];
  selectedLob: string;
  granularity: PerformanceGranularity;
  onLobChange: (value: string) => void;
  onGranularityChange: (value: PerformanceGranularity) => void;
  onRefresh: () => void;
}) {
  const tableRows = [...rows].reverse().slice(0, 80);
  const chartRows = rows.slice(-14);
  const maxValue = Math.max(1, ...chartRows.flatMap((row) => [row.input, row.submit]));

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-base font-black text-navy-950">Dados de fila</h2>
        <button type="button" onClick={onRefresh} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-xs font-black text-navy-950 hover:bg-slate-50">
          <RefreshCw className="h-4 w-4" /> Atualizar
        </button>
      </div>

      <div className="space-y-4 p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <SlicerGroup label="Periodo">
            {granularityOptions.map((option) => <SlicerButton key={option.value} active={granularity === option.value} label={option.label} onClick={() => onGranularityChange(option.value)} />)}
          </SlicerGroup>
          <SlicerGroup label="LOB">
            <SlicerButton active={!selectedLob} label="Todas as LOBs" onClick={() => onLobChange("")} tone="dark" />
            {lobs.map((lob) => <SlicerButton key={lob} active={selectedLob === lob} label={lob} onClick={() => onLobChange(lob)} tone="dark" />)}
          </SlicerGroup>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <StatCard title="Submit" value={formatNumber(payload?.summary.submit ?? 0)} helper={`${formatNumber(payload?.summary.records ?? 0)} registros`} icon={FileSpreadsheet} tone="blue" />
          <StatCard title="Enqueue" value={formatNumber(payload?.summary.input ?? 0)} helper={`${formatNumber(payload?.summary.queues ?? 0)} filas`} icon={Rows3} tone="cyan" />
          <StatCard title="Latency" value={formatMinutes(payload?.summary.latencyMinutes ?? null)} helper="latency / submit" icon={Clock} tone="orange" />
        </div>

        {loading ? <EmptyBox label="Carregando dados de Performance..." /> : (
          <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-xl border border-border bg-white p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="text-sm font-black text-navy-950">Evolucao</h3>
                <span className="text-xs font-bold text-muted">{granularityOptions.find((option) => option.value === granularity)?.label}</span>
              </div>
              <div className="space-y-3">
                {chartRows.map((row) => (
                  <div key={row.key} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs font-black">
                      <span className="text-navy-950">{row.label}</span>
                      <span className="text-muted">{formatNumber(row.input)} enqueue</span>
                    </div>
                    <MetricBar value={row.input} max={maxValue} className="bg-cyan-500" />
                    <MetricBar value={row.submit} max={maxValue} className="bg-blue-500" />
                  </div>
                ))}
                {!chartRows.length ? <EmptyBox label="Sem evolucao para o filtro selecionado." /> : null}
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border bg-white">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-slate-50 text-xs font-black uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-3">Periodo</th>
                    <th className="px-3 py-3">LOB</th>
                    <th className="px-3 py-3 text-right">Submit</th>
                    <th className="px-3 py-3 text-right">Enqueue</th>
                    <th className="px-3 py-3 text-right">Latency</th>
                    <th className="px-3 py-3 text-right">AHT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {tableRows.map((row) => (
                    <tr key={row.key} className="hover:bg-blue-50/40">
                      <td className="px-3 py-2 font-black text-navy-950">{row.label}</td>
                      <td className="px-3 py-2 font-bold text-muted">{selectedLob || "Todos"}</td>
                      <td className="px-3 py-2 text-right font-bold text-navy-950">{formatNumber(row.submit)}</td>
                      <td className="px-3 py-2 text-right font-bold text-navy-950">{formatNumber(row.input)}</td>
                      <td className="px-3 py-2 text-right font-bold text-navy-950">{formatMinutes(row.latencyMinutes)}</td>
                      <td className="px-3 py-2 text-right font-bold text-navy-950">{formatSeconds(row.ahtSeconds)}</td>
                    </tr>
                  ))}
                  {!tableRows.length ? <tr><td colSpan={6} className="px-3 py-8 text-center text-sm font-bold text-muted">Sem dados para o filtro selecionado.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
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
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-3 text-center">
          <div className="grid w-full max-w-2xl gap-3 sm:grid-cols-2">
            <InfoTile title="Ultimo real" value={formatForecastDate(model.lastRealAt)} />
            <InfoTile title="Projetado ate" value={formatForecastDate(model.projectedUntil)} />
          </div>

          <SlicerGroup label="Visao" centered>
            {forecastViewOptions.map((option) => <SlicerButton key={option.value} active={selectedView === option.value} label={option.label} onClick={() => onViewChange(option.value)} />)}
          </SlicerGroup>
          <SlicerGroup label="Horizonte" centered>
            {forecastHorizons.map((days) => <SlicerButton key={days} active={horizon === days} label={`${days} dias`} onClick={() => onHorizonChange(days)} tone="cyan" />)}
          </SlicerGroup>
          <SlicerGroup label="LOB" centered>
            <SlicerButton active={!selectedLob} label="Todas as LOBs" onClick={() => onLobChange("")} tone="dark" />
            {lobs.filter((lob) => lob !== "N/A").map((lob) => <SlicerButton key={lob} active={selectedLob === lob} label={lob} onClick={() => onLobChange(lob)} tone="dark" />)}
          </SlicerGroup>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <ForecastCard title="Proximas 24h" value={formatOptionalNumber(model.next24h)} helper="enqueue previsto" icon={TrendingUp} tone="cyan" />
          <ForecastCard title={`${horizon} dias`} value={formatOptionalNumber(model.horizonTotal)} helper={`${model.horizonHours} horas base`} icon={BarChart3} tone="blue" />
          <ForecastCard title="Ajuste recente" value={formatOptionalMultiplier(model.adjustment)} helper="hora + ultimos dias" icon={RefreshCw} tone="green" />
          <ForecastCard title="Assertividade" value={formatOptionalPercent(model.accuracy)} helper="ultimos 7 dias" icon={Gauge} tone="green" />
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
                <th className="px-3 py-3 text-right">Real</th>
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
        <Line type="monotone" dataKey="real" name="Real" stroke="#2563EB" strokeWidth={3} dot={false} connectNulls={false} />
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
        <div className="flex justify-between gap-4"><span>Real</span><span>{formatOptionalNumber(row.real)}</span></div>
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

  const future: ForecastHour[] = [];
  for (let index = 1; index <= horizonHours; index++) {
    const at = new Date(lastReal.timestamp + index * hourMs);
    const prediction = predictHour(positiveActuals, at, lastReal.at);
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
  const accuracy = calculateBacktestAccuracy(positiveActuals, lastReal.at);
  const chartRows = aggregateForecastRows([...actualsToHours(actuals.slice(-168)), ...future], view);
  const tableRows = aggregateForecastRows(future, view).slice(0, view === "hour" ? 168 : 60);

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

function predictHour(actuals: Array<{ at: Date; timestamp: number; input: number }>, targetAt: Date, referenceAt: Date) {
  const referenceTime = referenceAt.getTime();
  const targetDay = targetAt.getUTCDay();
  const targetHour = targetAt.getUTCHours();
  const training = actuals.filter((row) => row.timestamp <= referenceTime && row.input > 0);
  const sameSlot = training.filter((row) => row.at.getUTCDay() === targetDay && row.at.getUTCHours() === targetHour);
  const sameHourRecent = training.filter((row) => row.at.getUTCHours() === targetHour && row.timestamp >= referenceTime - 28 * dayMs);
  const recent = training.filter((row) => row.timestamp >= referenceTime - 7 * dayMs);
  const candidate = sameSlot.length >= 2 ? sameSlot : sameHourRecent.length >= 3 ? sameHourRecent : recent.length >= 8 ? recent : training;
  const baseline = weightedAverage(candidate, referenceAt);
  const fallback = sameHourRecent.length ? weightedAverage(sameHourRecent, referenceAt) : weightedAverage(recent.length ? recent : training, referenceAt);
  const blended = baseline > 0 && fallback > 0 ? baseline * 0.62 + fallback * 0.38 : baseline || fallback;
  const adjustment = calculateRecentAdjustment(training, targetAt, referenceAt);
  const forecast = Math.max(0, blended * adjustment);
  const stats = statsFor(candidate);
  const spread = stats.mean > 0 ? stats.stdDev / stats.mean : 0.45;
  const band = clamp(0.2 + spread * 0.45 + Math.abs(adjustment - 1) * 0.12 + (candidate.length < 4 ? 0.18 : 0), 0.22, 0.95);
  const confidence = clamp(0.9 - spread * 0.22 - Math.abs(adjustment - 1) * 0.2 + Math.min(candidate.length, 12) * 0.015, 0.32, 0.94);
  return { forecast, lower: forecast * (1 - band), upper: forecast * (1 + band), adjustment, confidence, samples: candidate.length };
}

function calculateRecentAdjustment(actuals: Array<{ at: Date; timestamp: number; input: number }>, targetAt: Date, referenceAt: Date) {
  const referenceTime = referenceAt.getTime();
  const targetHour = targetAt.getUTCHours();
  const sameHour = actuals.filter((row) => row.at.getUTCHours() === targetHour);
  const recentSameHour = sum(sameHour.filter((row) => row.timestamp > referenceTime - 7 * dayMs).map((row) => row.input));
  const previousSameHour = sum(sameHour.filter((row) => row.timestamp <= referenceTime - 7 * dayMs && row.timestamp > referenceTime - 35 * dayMs).map((row) => row.input)) / 4;
  const recentAll = sum(actuals.filter((row) => row.timestamp > referenceTime - 3 * dayMs).map((row) => row.input));
  const previousAll = sum(actuals.filter((row) => row.timestamp <= referenceTime - 3 * dayMs && row.timestamp > referenceTime - 24 * dayMs).map((row) => row.input)) / 7;
  const ratios: Array<{ ratio: number; weight: number }> = [];
  if (previousSameHour > 0) ratios.push({ ratio: clamp(recentSameHour / previousSameHour, 0.35, 2.7), weight: 0.65 });
  if (previousAll > 0) ratios.push({ ratio: clamp(recentAll / previousAll, 0.35, 2.4), weight: 0.35 });
  if (!ratios.length) return 1;
  const raw = ratios.reduce((total, item) => total + item.ratio * item.weight, 0) / ratios.reduce((total, item) => total + item.weight, 0);
  return clamp(1 + (raw - 1) * 0.86, 0.5, 2.25);
}

function calculateBacktestAccuracy(actuals: Array<{ at: Date; timestamp: number; input: number }>, lastReal: Date) {
  const testStart = lastReal.getTime() - 7 * dayMs;
  const testRows = actuals.filter((row) => row.timestamp > testStart && row.input > 0);
  let actualTotal = 0;
  let errorTotal = 0;
  let evaluated = 0;
  for (const row of testRows) {
    const history = actuals.filter((item) => item.timestamp < row.timestamp && item.input > 0);
    if (history.length < 24) continue;
    const predicted = predictHour(history, row.at, new Date(row.timestamp - hourMs)).forecast;
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

function weightedAverage(rows: Array<{ timestamp: number; input: number }>, referenceAt: Date) {
  const reference = referenceAt.getTime();
  let total = 0;
  let weight = 0;
  for (const row of rows) {
    const ageDays = Math.max(0, (reference - row.timestamp) / dayMs);
    const rowWeight = Math.pow(0.5, ageDays / 21);
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
