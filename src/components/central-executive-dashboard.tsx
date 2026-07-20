"use client";

import dynamic from "next/dynamic";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Activity, AlertCircle, RefreshCw, ShieldCheck, UsersRound } from "lucide-react";

import { EmptyState } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

const Bar = dynamic(() => import("@/components/ui/lazy-recharts").then((module) => module.ChartBar), { ssr: false });
const BarChart = dynamic(() => import("@/components/ui/lazy-recharts").then((module) => module.ChartBarChart), { ssr: false });
const CartesianGrid = dynamic(() => import("@/components/ui/lazy-recharts").then((module) => module.ChartCartesianGrid), { ssr: false });
const Line = dynamic(() => import("@/components/ui/lazy-recharts").then((module) => module.ChartLine), { ssr: false });
const LineChart = dynamic(() => import("@/components/ui/lazy-recharts").then((module) => module.ChartLineChart), { ssr: false });
const ReferenceLine = dynamic(() => import("@/components/ui/lazy-recharts").then((module) => module.ChartReferenceLine), { ssr: false });
const ResponsiveContainer = dynamic(() => import("@/components/ui/lazy-recharts").then((module) => module.ChartResponsiveContainer), { ssr: false });
const Tooltip = dynamic(() => import("@/components/ui/lazy-recharts").then((module) => module.ChartTooltip), { ssr: false });
const XAxis = dynamic(() => import("@/components/ui/lazy-recharts").then((module) => module.ChartXAxis), { ssr: false });
const YAxis = dynamic(() => import("@/components/ui/lazy-recharts").then((module) => module.ChartYAxis), { ssr: false });

type ExecutivePeriod = "daily" | "weekly" | "monthly";

type PresenceRow = {
  lob: string;
  shift: string;
  status: "ONLINE" | "IDLE" | "LOCKED" | "OFFLINE";
};

type LobAttendance = {
  planned: number;
  present: number;
  absent: number;
  absRate: number;
};

type LobAttrition = {
  lob: string;
  terminations: number;
  attritionRate: number;
};

type PerformanceTrendRow = {
  key: string;
  label: string;
  latencyMinutes: number;
};

type QualityTrendRow = {
  key: string;
  label: string;
  correct: number;
  total: number;
  quality: number;
};

type Props = {
  lobs: string[];
  selectedLob: string;
  onLobChange: (lob: string) => void;
  presenceRows: PresenceRow[];
  attendanceByLob: Record<string, LobAttendance>;
  attritionByLob: LobAttrition[];
  presenceUpdatedAt: string;
  loadingSummary: boolean;
  loadingPresence: boolean;
  onDateRangeChange: (range: { startDate: string; endDate: string }) => void;
  onRefresh: () => void;
};

const periodLabels: Record<ExecutivePeriod, string> = {
  daily: "Diário",
  weekly: "Semanal",
  monthly: "Mensal"
};

const periodGranularity: Record<ExecutivePeriod, string> = {
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly"
};

const executivePeriodOrder: ExecutivePeriod[] = ["monthly", "weekly", "daily"];

const executiveLobOrder = ["ADS", "PROJECT", "VIDEO", "COMMENTS", "TNS", "CEC", "ALL"];
const executiveShiftOrder = ["Manhã", "Tarde", "Noite", "Sem turno"];

export function CentralExecutiveDashboard({
  lobs,
  selectedLob,
  onLobChange,
  presenceRows,
  attendanceByLob,
  attritionByLob,
  presenceUpdatedAt,
  loadingSummary,
  loadingPresence,
  onDateRangeChange,
  onRefresh
}: Props) {
  const [period, setPeriod] = useState<ExecutivePeriod>("daily");
  const [performanceTrend, setPerformanceTrend] = useState<PerformanceTrendRow[]>([]);
  const [qualityTrend, setQualityTrend] = useState<QualityTrendRow[]>([]);
  const [loadingCharts, setLoadingCharts] = useState(false);
  const [chartError, setChartError] = useState("");
  const [chartRefreshKey, setChartRefreshKey] = useState(0);

  const periodRange = useMemo(() => executiveDateRange(period), [period]);
  const lobOptions = useMemo(() => {
    const normalized = Array.from(new Set(lobs
      .map((lob) => lob.trim().toUpperCase())
      .filter((lob) => lob && lob !== "TODOS")));
    normalized.sort((left, right) => {
      const leftIndex = executiveLobOrder.indexOf(left);
      const rightIndex = executiveLobOrder.indexOf(right);
      return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex) || left.localeCompare(right, "pt-BR");
    });
    return ["Todos", ...normalized];
  }, [lobs]);

  useEffect(() => {
    onDateRangeChange(periodRange);
  }, [onDateRangeChange, periodRange]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadCharts() {
      setLoadingCharts(true);
      setChartError("");
      try {
        const performanceParams = new URLSearchParams({
          startDate: periodRange.startDate,
          endDate: periodRange.endDate,
          granularity: periodGranularity[period]
        });
        if (selectedLob !== "Todos") performanceParams.set("lob", selectedLob);
        const latencyTarget = latencyTargetForLob(selectedLob);
        if (selectedLob === "VIDEO" || selectedLob === "COMMENTS") {
          performanceParams.set("slaTargetMinutes", String(latencyTarget));
        }

        const qualitySupported = selectedLob === "Todos" || selectedLob === "ADS" || selectedLob === "PROJECT";
        const qualityParams = new URLSearchParams({
          startDate: periodRange.startDate,
          endDate: periodRange.endDate
        });
        if (selectedLob === "ADS" || selectedLob === "PROJECT") qualityParams.set("lob", selectedLob);

        const [performanceResponse, qualityResponse] = await Promise.all([
          fetch(`/api/performance?${performanceParams.toString()}`, { cache: "no-store", signal: controller.signal }),
          qualitySupported
            ? fetch(`/api/performance/quality?${qualityParams.toString()}`, { cache: "no-store", signal: controller.signal })
            : Promise.resolve(null)
        ]);

        if (!performanceResponse.ok) throw new Error("Não foi possível carregar a latência.");
        const performancePayload = await performanceResponse.json() as { trend?: PerformanceTrendRow[] };
        setPerformanceTrend(performancePayload.trend ?? []);

        if (!qualityResponse) {
          setQualityTrend([]);
        } else if (qualityResponse.ok) {
          const qualityPayload = await qualityResponse.json() as { trend?: QualityTrendRow[] };
          setQualityTrend(aggregateQualityTrend(qualityPayload.trend ?? [], period));
        } else {
          setQualityTrend([]);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setPerformanceTrend([]);
        setQualityTrend([]);
        setChartError(error instanceof Error ? error.message : "Não foi possível carregar os indicadores executivos.");
      } finally {
        if (!controller.signal.aborted) setLoadingCharts(false);
      }
    }

    void loadCharts();
    return () => controller.abort();
  }, [chartRefreshKey, period, periodRange.endDate, periodRange.startDate, selectedLob]);

  const filteredPresence = presenceRows.filter((row) => (
    row.status !== "OFFLINE"
    && (selectedLob === "Todos" || normalizeKey(row.lob) === normalizeKey(selectedLob))
  ));
  const activeMatrix = buildActiveMatrix(filteredPresence);
  const absRows = Object.entries(attendanceByLob)
    .filter(([lob]) => selectedLob === "Todos" || normalizeKey(lob) === normalizeKey(selectedLob))
    .map(([lob, values]) => ({ lob, value: Number(values.absRate ?? 0), absent: values.absent, planned: values.planned }))
    .sort((left, right) => right.value - left.value);
  const attritionRows = attritionByLob
    .filter((row) => selectedLob === "Todos" || normalizeKey(row.lob) === normalizeKey(selectedLob))
    .map((row) => ({ lob: row.lob, value: Number(row.attritionRate ?? 0), terminations: row.terminations }))
    .sort((left, right) => right.value - left.value);
  const isLoading = loadingSummary || loadingPresence || loadingCharts;
  const latencyTargetMinutes = latencyTargetForLob(selectedLob);

  return (
    <div className="space-y-4">
      <section className="rounded-[8px] border border-slate-200 bg-white px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-blue-600">Visão executiva</p>
            <h2 className="mt-1 text-lg font-black text-navy-950">Indicadores consolidados da operação</h2>
          </div>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <SegmentedControl
              label="Período"
              options={executivePeriodOrder.map((value) => ({ value, label: periodLabels[value] }))}
              value={period}
              onChange={(value) => setPeriod(value as ExecutivePeriod)}
            />
            <SegmentedControl
              label="LOB"
              options={lobOptions.map((value) => ({ value, label: value === "Todos" ? "Todas" : value }))}
              value={selectedLob}
              onChange={onLobChange}
              scrollable
            />
            <button
              type="button"
              onClick={() => {
                onRefresh();
                setChartRefreshKey((current) => current + 1);
              }}
              disabled={isLoading}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-extrabold text-navy-950 transition hover:border-blue-200 hover:bg-blue-50 disabled:opacity-60"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
              Atualizar
            </button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[8px] border border-slate-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-md bg-blue-50 text-blue-600"><UsersRound className="h-4 w-4" /></span>
            <div>
              <h3 className="text-base font-black text-navy-950">Pessoas Ativas por LOB e Turno</h3>
              <p className="text-xs font-semibold text-muted">Online, ocioso e tela bloqueada no sinal atual</p>
            </div>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black text-slate-600">Atualizado às {presenceUpdatedAt}</span>
        </div>
        {activeMatrix.length ? (
          <div className="overflow-x-auto px-4 py-4">
            <table className="w-full min-w-[660px] table-fixed border-separate border-spacing-1.5">
              <thead>
                <tr>
                  <th className="w-[22%] px-3 py-2 text-left text-[10px] font-black uppercase tracking-wide text-muted">LOB</th>
                  {executiveShiftOrder.slice(0, 3).map((shift) => <th key={shift} className="px-3 py-2 text-center text-[10px] font-black uppercase tracking-wide text-muted">{shift}</th>)}
                  <th className="px-3 py-2 text-center text-[10px] font-black uppercase tracking-wide text-muted">Total</th>
                </tr>
              </thead>
              <tbody>
                {activeMatrix.map((row) => (
                  <tr key={row.lob}>
                    <td className="rounded-md bg-slate-50 px-3 py-3 text-sm font-black text-navy-950">{row.lob}</td>
                    {executiveShiftOrder.slice(0, 3).map((shift) => (
                      <td key={shift} className={cn("rounded-md px-3 py-3 text-center text-sm font-black", heatClass(row.shifts[shift] ?? 0, row.total))}>
                        {row.shifts[shift] ?? 0}
                      </td>
                    ))}
                    <td className="rounded-md bg-blue-600 px-3 py-3 text-center text-sm font-black text-white">{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5"><EmptyState title="Sem pessoas ativas" description="Não há sinal atual para a LOB selecionada." /></div>
        )}
      </section>

      {chartError ? (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
          <AlertCircle className="h-4 w-4" /> {chartError}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <ExecutiveChartCard
          title="Latência"
          subtitle={latencySubtitle(selectedLob, latencyTargetMinutes)}
          icon={Activity}
          loading={loadingCharts}
        >
          {performanceTrend.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={performanceTrend} margin={{ top: 12, right: 12, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="#E8EDF5" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748B" }} tickLine={false} axisLine={false} minTickGap={20} />
                <YAxis
                  tick={{ fontSize: 10, fill: "#64748B" }}
                  tickLine={false}
                  axisLine={false}
                  width={46}
                  tickFormatter={(value) => formatLatencyAxisTick(Number(value), selectedLob)}
                />
                <Tooltip formatter={(value) => [formatLatencyValue(Number(value), selectedLob), "Latência"]} />
                {latencyTargetMinutes ? (
                  <ReferenceLine
                    y={latencyTargetMinutes}
                    stroke="#F59E0B"
                    strokeDasharray="6 5"
                    strokeWidth={1.5}
                    ifOverflow="extendDomain"
                    label={{ value: `Meta ${formatLatencyTarget(latencyTargetMinutes)}`, position: "insideTopRight", fill: "#B45309", fontSize: 10 }}
                  />
                ) : null}
                <Line type="monotone" dataKey="latencyMinutes" stroke="#2563EB" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <ChartEmpty label="Sem latência no período" />}
        </ExecutiveChartCard>

        <ExecutiveChartCard title="Qualidade" subtitle={selectedLob === "Todos" ? "ADS + PROJECT" : selectedLob} icon={ShieldCheck} loading={loadingCharts}>
          {qualityTrend.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={qualityTrend} margin={{ top: 12, right: 12, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="#E8EDF5" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748B" }} tickLine={false} axisLine={false} minTickGap={20} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#64748B" }} tickLine={false} axisLine={false} width={38} unit="%" />
                <Tooltip formatter={(value) => [`${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`, "Qualidade"]} />
                <Line type="monotone" dataKey="quality" stroke="#10B981" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <ChartEmpty label="Qualidade disponível para ADS e PROJECT" />}
        </ExecutiveChartCard>

        <ExecutiveChartCard title="ABS por LOB" subtitle={periodCaption(periodRange)} icon={AlertCircle} loading={loadingSummary}>
          {absRows.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={absRows} margin={{ top: 12, right: 12, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="#E8EDF5" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="lob" tick={{ fontSize: 10, fill: "#64748B" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#64748B" }} tickLine={false} axisLine={false} width={38} unit="%" />
                <Tooltip formatter={(value) => [`${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`, "ABS"]} />
                <Bar dataKey="value" fill="#F59E0B" radius={[5, 5, 0, 0]} maxBarSize={52} />
              </BarChart>
            </ResponsiveContainer>
          ) : <ChartEmpty label="Sem ABS no período" />}
        </ExecutiveChartCard>

        <ExecutiveChartCard title="Attrition por LOB" subtitle={periodCaption(periodRange)} icon={UsersRound} loading={loadingSummary}>
          {attritionRows.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={attritionRows} margin={{ top: 12, right: 12, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="#E8EDF5" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="lob" tick={{ fontSize: 10, fill: "#64748B" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#64748B" }} tickLine={false} axisLine={false} width={38} unit="%" />
                <Tooltip formatter={(value) => [`${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`, "Attrition"]} />
                <Bar dataKey="value" fill="#7C3AED" radius={[5, 5, 0, 0]} maxBarSize={52} />
              </BarChart>
            </ResponsiveContainer>
          ) : <ChartEmpty label="Sem attrition no período" />}
        </ExecutiveChartCard>
      </div>
    </div>
  );
}

function SegmentedControl({
  label,
  options,
  value,
  onChange,
  scrollable = false
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  scrollable?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-muted">{label}</span>
      <div className={cn("flex items-center gap-1 rounded-md bg-slate-100 p-1", scrollable && "max-w-[52vw] overflow-x-auto lg:max-w-[440px]")}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "h-7 shrink-0 rounded px-2.5 text-[11px] font-extrabold transition",
              value === option.value ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:bg-white hover:text-navy-950"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ExecutiveChartCard({
  title,
  subtitle,
  icon: Icon,
  loading,
  children
}: {
  title: string;
  subtitle: string;
  icon: typeof Activity;
  loading: boolean;
  children: ReactNode;
}) {
  return (
    <section className="min-h-[330px] overflow-hidden rounded-[8px] border border-slate-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h3 className="text-base font-black text-navy-950">{title}</h3>
          <p className="mt-0.5 text-xs font-semibold text-muted">{subtitle}</p>
        </div>
        <span className="grid h-9 w-9 place-items-center rounded-md bg-blue-50 text-blue-600"><Icon className="h-4 w-4" /></span>
      </div>
      <div className="relative h-[260px] px-3 py-3">
        {loading ? <div className="absolute inset-0 z-10 grid place-items-center bg-white/70 text-xs font-bold text-muted">Carregando...</div> : null}
        {children}
      </div>
    </section>
  );
}

function ChartEmpty({ label }: { label: string }) {
  return <div className="grid h-full place-items-center text-center text-xs font-bold text-muted">{label}</div>;
}

function buildActiveMatrix(rows: PresenceRow[]) {
  const matrix = new Map<string, { lob: string; shifts: Record<string, number>; total: number }>();
  for (const row of rows) {
    const lob = row.lob.trim().toUpperCase() || "SEM LOB";
    const shift = normalizeShift(row.shift);
    const current = matrix.get(lob) ?? { lob, shifts: {}, total: 0 };
    current.shifts[shift] = (current.shifts[shift] ?? 0) + 1;
    current.total += 1;
    matrix.set(lob, current);
  }
  return Array.from(matrix.values()).sort((left, right) => {
    const leftIndex = executiveLobOrder.indexOf(left.lob);
    const rightIndex = executiveLobOrder.indexOf(right.lob);
    return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex) || left.lob.localeCompare(right.lob, "pt-BR");
  });
}

function normalizeShift(value: string) {
  const key = normalizeKey(value);
  if (/manha|morning/.test(key)) return "Manhã";
  if (/tarde|afternoon/.test(key)) return "Tarde";
  if (/noite|night/.test(key)) return "Noite";
  return "Sem turno";
}

function heatClass(value: number, total: number) {
  if (!value) return "bg-slate-50 text-slate-400";
  const ratio = value / Math.max(total, 1);
  if (ratio >= 0.55) return "bg-blue-600 text-white";
  if (ratio >= 0.3) return "bg-blue-100 text-blue-800";
  return "bg-blue-50 text-blue-700";
}

function normalizeKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function latencyTargetForLob(lob: string) {
  if (lob === "ADS") return 120;
  if (lob === "VIDEO") return 15;
  if (lob === "COMMENTS") return 1440;
  return null;
}

function latencySubtitle(lob: string, targetMinutes: number | null) {
  if (lob === "Todos") return "Todas as LOBs · sem meta única";
  if (!targetMinutes) return `${lob} · sem meta configurada`;
  const queueScope = lob === "ADS" ? "todas as filas" : `filas com meta ${formatLatencyTarget(targetMinutes)}`;
  return `${lob} · ${queueScope}`;
}

function formatLatencyTarget(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h${String(remainder).padStart(2, "0")}` : `${hours}h`;
}

function formatLatencyAxisTick(minutes: number, lob: string) {
  if (lob === "ADS" || lob === "COMMENTS") {
    const hours = minutes / 60;
    return `${hours.toLocaleString("pt-BR", { maximumFractionDigits: hours < 10 ? 1 : 0 })}h`;
  }
  return `${minutes.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}m`;
}

function formatLatencyValue(minutes: number, lob: string) {
  if (lob !== "ADS" && lob !== "COMMENTS") {
    return `${minutes.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} min`;
  }
  const totalMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(totalMinutes / 60);
  const remainder = totalMinutes % 60;
  return `${hours}:${String(remainder).padStart(2, "0")}h`;
}

function executiveDateRange(period: ExecutivePeriod) {
  const end = new Date();
  const start = new Date(end);
  if (period === "daily") start.setDate(start.getDate() - 13);
  if (period === "weekly") start.setDate(start.getDate() - 7 * 11);
  if (period === "monthly") start.setMonth(start.getMonth() - 5, 1);
  return { startDate: toDateKey(start), endDate: toDateKey(end) };
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function periodCaption(range: { startDate: string; endDate: string }) {
  return `${formatDate(range.startDate)} até ${formatDate(range.endDate)}`;
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function aggregateQualityTrend(rows: QualityTrendRow[], period: ExecutivePeriod) {
  if (period === "daily") return rows;
  const buckets = new Map<string, { key: string; label: string; correct: number; total: number }>();
  for (const row of rows) {
    const date = new Date(`${row.key}T12:00:00`);
    const bucketDate = new Date(date);
    if (period === "weekly") bucketDate.setDate(bucketDate.getDate() - ((bucketDate.getDay() + 6) % 7));
    if (period === "monthly") bucketDate.setDate(1);
    const key = toDateKey(bucketDate);
    const current = buckets.get(key) ?? {
      key,
      label: period === "weekly"
        ? `Sem. ${bucketDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`
        : bucketDate.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
      correct: 0,
      total: 0
    };
    current.correct += Number(row.correct ?? 0);
    current.total += Number(row.total ?? 0);
    buckets.set(key, current);
  }
  return Array.from(buckets.values())
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((row) => ({ ...row, quality: row.total > 0 ? Math.round((row.correct / row.total) * 10000) / 100 : 0 }));
}
