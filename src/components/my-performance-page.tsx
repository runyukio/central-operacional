"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarDays, ClipboardList, Clock, RefreshCw, ShieldCheck, Trophy } from "lucide-react";

import { EmptyState, PageHeader, Panel, StatCard } from "@/components/ui/primitives";

type MetricSummary = {
  quality: number;
  qualityRule: string;
  qualityDenominator: number;
  qualityCorrect: number;
  qualityTotal: number;
  submit: number;
  submitTotal: number;
  submitDays: number;
  ahtSeconds: number;
  abs: number;
  absences: number;
  scheduledDays: number;
};

type WeeklyMetric = MetricSummary & {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  lobAverage?: MetricSummary;
};

type OwnPerformanceResponse = {
  mode: "mine";
  period: { startDate: string; endDate: string };
  summary: {
    mine: MetricSummary & {
      employeeName: string;
      wbLogin: string;
      lob: string;
      supervisor: string;
    };
    lobAverage: MetricSummary;
  };
  weekly: WeeklyMetric[];
};

type DateRange = { startDate: string; endDate: string };

export function MyPerformancePage({ initialStartDate, initialEndDate }: { initialStartDate?: string; initialEndDate?: string }) {
  const initialRange = currentMonthRange(initialStartDate, initialEndDate);
  const [draftRange, setDraftRange] = useState<DateRange>(initialRange);
  const [range, setRange] = useState<DateRange>(initialRange);
  const [payload, setPayload] = useState<OwnPerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const loadPerformance = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams(range);
      const response = await fetch(`/api/performance/me?${params.toString()}`, { cache: "no-store" });
      const body = await response.json() as OwnPerformanceResponse & { message?: string; error?: string };
      if (!response.ok) throw new Error(body.message || body.error || "Não foi possível carregar sua Performance.");
      setPayload(body);
    } catch (error) {
      setPayload(null);
      setMessage(error instanceof Error ? error.message : "Não foi possível carregar sua Performance.");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void loadPerformance();
  }, [loadPerformance]);

  const mine = payload?.summary.mine;
  const lobAverage = payload?.summary.lobAverage;
  const usesCpd = mine?.qualityRule === "CEC_QUALITY";
  const productivityLabel = usesCpd ? "CPD" : "Submit/dia";
  const hasData = mine ? hasPerformanceData(mine) : false;

  function applyRange() {
    if (!draftRange.startDate || !draftRange.endDate) {
      setMessage("Informe a data inicial e a data final.");
      return;
    }
    if (draftRange.startDate > draftRange.endDate) {
      setMessage("A data inicial não pode ser posterior à data final.");
      return;
    }
    setRange(draftRange);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Minha Performance"
        description="Seus indicadores individuais, sem acesso aos resultados de outros colaboradores."
        icon={Trophy}
      />

      <section className="card p-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,180px)_minmax(0,180px)_auto] md:items-end">
          <DateField label="Data inicial" value={draftRange.startDate} onChange={(startDate) => setDraftRange((current) => ({ ...current, startDate }))} />
          <DateField label="Data final" value={draftRange.endDate} onChange={(endDate) => setDraftRange((current) => ({ ...current, endDate }))} />
          <button
            type="button"
            onClick={applyRange}
            disabled={loading}
            className="premium-button inline-flex h-10 items-center justify-center gap-2 px-4 text-sm font-extrabold disabled:cursor-not-allowed disabled:opacity-60 md:justify-self-start"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>
      </section>

      <div aria-live="polite">
        {message ? <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{message}</p> : null}
        {loading && !payload ? <p className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">Carregando seus indicadores...</p> : null}
      </div>

      {mine ? (
        <>
          <section className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-white px-4 py-3 shadow-sm">
            <p className="text-base font-black text-navy-950">{mine.employeeName}</p>
            <p className="mt-1 text-sm font-semibold text-muted">{mine.wbLogin} · {mine.lob} · Supervisão: {mine.supervisor}</p>
          </section>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Minha Qualidade"
              value={mine.qualityDenominator > 0 ? formatPercent(mine.quality) : "-"}
              helper={`${formatQualityBase(mine)} · LOB: ${formatOptionalPercent(lobAverage?.quality, lobAverage?.qualityDenominator)}`}
              icon={ShieldCheck}
              tone="green"
            />
            <StatCard
              title={`Meu ${productivityLabel}`}
              value={mine.submitDays > 0 ? formatNumber(mine.submit) : "-"}
              helper={`${formatNumber(mine.submitTotal)} no período · LOB: ${formatOptionalNumber(lobAverage?.submit, lobAverage?.submitDays)}`}
              icon={ClipboardList}
              tone="purple"
            />
            <StatCard
              title="Meu AHT"
              value={mine.submitTotal > 0 ? formatAht(mine.ahtSeconds) : "-"}
              helper={`Média da LOB: ${formatOptionalAht(lobAverage?.ahtSeconds, lobAverage?.submitTotal)}`}
              icon={Clock}
              tone="orange"
            />
            <StatCard
              title="Meu ABS"
              value={mine.scheduledDays > 0 ? formatPercent(mine.abs) : "-"}
              helper={`${mine.absences}/${mine.scheduledDays} dias · LOB: ${formatOptionalPercent(lobAverage?.abs, lobAverage?.scheduledDays)}`}
              icon={AlertTriangle}
              tone={mine.abs > 0 ? "red" : "green"}
            />
          </div>

          {hasData ? (
            <Panel title="Evolução semanal">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-black uppercase tracking-[0.08em] text-muted">
                    <tr>
                      <th className="whitespace-nowrap px-4 py-3">Semana</th>
                      <th className="whitespace-nowrap px-4 py-3">Qualidade</th>
                      <th className="whitespace-nowrap px-4 py-3">{productivityLabel}</th>
                      <th className="whitespace-nowrap px-4 py-3">AHT</th>
                      <th className="whitespace-nowrap px-4 py-3">ABS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {payload?.weekly.map((week) => (
                      <tr key={week.weekStart} className="odd:bg-white even:bg-slate-50/55">
                        <td className="whitespace-nowrap px-4 py-3 font-extrabold text-navy-950">{week.weekLabel}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-bold text-navy-950">{week.qualityDenominator > 0 ? formatPercent(week.quality) : "-"}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-bold text-navy-950">{week.submitDays > 0 ? formatNumber(week.submit) : "-"}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-bold text-navy-950">{week.submitTotal > 0 ? formatAht(week.ahtSeconds) : "-"}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-bold text-navy-950">{week.scheduledDays > 0 ? formatPercent(week.abs) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : (
            <EmptyState title="Sem indicadores no período" description="Quando as bases de qualidade, produtividade e cronograma tiverem registros, seus números aparecerão aqui." />
          )}

          <Panel title="Como seus números são calculados">
            <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
              <MetricDefinition title="Qualidade" description="Resultado correto dividido pelo total avaliado, conforme a regra da sua operação." />
              <MetricDefinition title={productivityLabel} description={usesCpd ? "Média diária de tickets únicos tratados no CEC." : "Média diária de submits no período selecionado."} />
              <MetricDefinition title="AHT" description="Tempo total de moderação dividido pela quantidade de submits." />
              <MetricDefinition title="ABS" description="Dias de ausência divididos pelos dias válidos do cronograma." />
            </div>
          </Panel>
        </>
      ) : null}
    </div>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">{label}</span>
      <span className="relative block">
        <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-600" />
        <input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="premium-control h-10 w-full pl-10 pr-3 text-sm font-bold outline-none" />
      </span>
    </label>
  );
}

function MetricDefinition({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-border bg-slate-50 p-3">
      <p className="font-black text-navy-950">{title}</p>
      <p className="mt-1 text-xs font-semibold leading-5 text-muted">{description}</p>
    </div>
  );
}

function currentMonthRange(initialStartDate?: string, initialEndDate?: string): DateRange {
  if (initialStartDate && initialEndDate) return { startDate: initialStartDate, endDate: initialEndDate };
  const now = new Date();
  return {
    startDate: localDateInput(new Date(now.getFullYear(), now.getMonth(), 1)),
    endDate: localDateInput(new Date(now.getFullYear(), now.getMonth() + 1, 0))
  };
}

function localDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function hasPerformanceData(metrics: MetricSummary) {
  return metrics.qualityDenominator > 0 || metrics.submitTotal > 0 || metrics.scheduledDays > 0;
}

function formatQualityBase(metrics: MetricSummary) {
  return metrics.qualityDenominator > 0 ? `${metrics.qualityCorrect}/${metrics.qualityTotal} avaliados` : "Sem avaliações";
}

function formatPercent(value: number) {
  return `${Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: Number.isInteger(value) ? 0 : 1, maximumFractionDigits: 1 })}%`;
}

function formatNumber(value: number) {
  return Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

function formatAht(seconds: number) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes > 0 ? `${minutes}m${String(rest).padStart(2, "0")}s` : `${rest}s`;
}

function formatOptionalPercent(value?: number, denominator?: number) {
  return Number(denominator || 0) > 0 ? formatPercent(Number(value || 0)) : "-";
}

function formatOptionalNumber(value?: number, days?: number) {
  return Number(days || 0) > 0 ? formatNumber(Number(value || 0)) : "-";
}

function formatOptionalAht(value?: number, submitTotal?: number) {
  return Number(submitTotal || 0) > 0 ? formatAht(Number(value || 0)) : "-";
}
