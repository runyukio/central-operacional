"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  CalendarDays,
  ChartNoAxesCombined,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Gauge,
  LockKeyhole,
  RefreshCw
} from "lucide-react";

import { TopActions } from "@/components/layout/app-shell";
import { PageHeader, Panel, StatCard } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type PerformanceMetric = {
  qualityRule: "ADS_QUALITY" | "TNS_QUALITY" | "CEC_QUALITY" | "UNKNOWN" | "MIXED";
  quality: number;
  qualityCorrect: number;
  qualityTotal: number;
  submit: number;
  submitTotal: number;
  submitDays: number;
  ahtSeconds: number;
  moderationSeconds: number;
  abs: number;
  absences: number;
  scheduledDays: number;
};

type WeeklyPerformanceMetric = PerformanceMetric & {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
};

type OwnPerformance = PerformanceMetric & {
  employeeId: string;
  employeeName: string;
  wbLogin: string;
  lob: string;
  supervisor: string;
  roleTitle: string;
  skill: string;
  employeeStatus: string;
  weekly: WeeklyPerformanceMetric[];
};

type OwnPerformanceResponse = {
  mode: "mine";
  period: { startDate: string; endDate: string };
  summary: { mine: OwnPerformance };
  weekly: WeeklyPerformanceMetric[];
};

type DateRange = { startDate: string; endDate: string };

export function PerformanceMyDataPage({ initialPeriod }: { initialPeriod: DateRange }) {
  const [draftPeriod, setDraftPeriod] = useState(initialPeriod);
  const [appliedPeriod, setAppliedPeriod] = useState(initialPeriod);
  const [payload, setPayload] = useState<OwnPerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setMessage("");
    const params = new URLSearchParams(appliedPeriod);
    try {
      const response = await fetch(`/api/performance/me?${params.toString()}`, { cache: "no-store" });
      const data = await response.json() as OwnPerformanceResponse & { message?: string; error?: string };
      if (!response.ok) throw new Error(data.message || data.error || "Não foi possível carregar seus dados.");
      setPayload(data);
    } catch (error) {
      setPayload(null);
      setMessage(error instanceof Error ? error.message : "Não foi possível carregar seus dados.");
    } finally {
      setLoading(false);
    }
  }, [appliedPeriod]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const invalidPeriod = !draftPeriod.startDate
    || !draftPeriod.endDate
    || draftPeriod.startDate > draftPeriod.endDate;
  const mine = payload?.summary.mine;
  const displayPeriod = payload?.period ?? appliedPeriod;
  const usesCpd = mine?.qualityRule === "CEC_QUALITY";
  const history = useMemo(
    () => (payload?.weekly ?? []).filter(hasPerformanceData),
    [payload?.weekly]
  );

  function applyPeriod() {
    if (invalidPeriod) {
      setMessage("Selecione uma data inicial anterior ou igual à data final.");
      return;
    }
    setAppliedPeriod(draftPeriod);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Meus Dados"
        description="Acompanhe seus indicadores oficiais de Performance no período selecionado."
        icon={ChartNoAxesCombined}
        actions={<TopActions />}
      />

      <section className="card p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid flex-1 gap-3 sm:grid-cols-2 xl:max-w-[520px]">
            <DateInput
              label="Data inicial"
              value={draftPeriod.startDate}
              onChange={(value) => setDraftPeriod((current) => ({ ...current, startDate: value }))}
            />
            <DateInput
              label="Data final"
              value={draftPeriod.endDate}
              onChange={(value) => setDraftPeriod((current) => ({ ...current, endDate: value }))}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-extrabold text-emerald-700">
              <LockKeyhole className="h-4 w-4" /> Visualização individual
            </div>
            <button
              type="button"
              onClick={applyPeriod}
              disabled={loading || invalidPeriod}
              className="premium-button inline-flex h-9 items-center gap-2 px-4 text-sm font-extrabold disabled:cursor-not-allowed disabled:opacity-55"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Atualizar período
            </button>
          </div>
        </div>
      </section>

      {message ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{message}</div>
      ) : null}

      {loading && !mine ? (
        <div className="card flex min-h-48 items-center justify-center gap-2 p-6 text-sm font-bold text-blue-700">
          <RefreshCw className="h-4 w-4 animate-spin" /> Carregando seus indicadores...
        </div>
      ) : null}

      {mine ? (
        <>
          <section className="card overflow-hidden">
            <div className="flex flex-col gap-3 bg-gradient-to-r from-blue-50 via-white to-violet-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-lg font-black text-navy-950">{mine.employeeName}</p>
                <p className="mt-1 text-sm font-semibold text-muted">{mine.wbLogin} · {mine.lob} · {mine.skill || "Sem skill atribuída"}</p>
              </div>
              <div className="rounded-xl border border-blue-100 bg-white px-3 py-2 text-right shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-muted">Período consultado</p>
                <p className="mt-1 text-sm font-black text-navy-950">{formatDate(displayPeriod.startDate)} a {formatDate(displayPeriod.endDate)}</p>
              </div>
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <StatCard
              title="Qualidade"
              value={mine.qualityTotal ? formatPercent(mine.quality) : "Sem dados"}
              helper={mine.qualityTotal ? `${formatNumber(mine.qualityCorrect)} de ${formatNumber(mine.qualityTotal)} avaliações` : "Nenhuma avaliação no período"}
              icon={CheckCircle2}
              tone="green"
            />
            <StatCard
              title={usesCpd ? "CPD médio" : "Submit médio/dia"}
              value={mine.submitDays ? formatNumber(mine.submit) : "Sem dados"}
              helper={mine.submitDays ? `${formatNumber(mine.submitDays)} dia(s) com produção` : "Nenhuma produção no período"}
              icon={Gauge}
              tone="purple"
            />
            <StatCard
              title={usesCpd ? "Tickets no período" : "Submits no período"}
              value={formatNumber(mine.submitTotal)}
              helper="Total no intervalo escolhido"
              icon={FileCheck2}
              tone="blue"
            />
            <StatCard
              title="AHT"
              value={mine.submitTotal ? formatDuration(mine.ahtSeconds) : "Sem dados"}
              helper="Tempo de moderação por submit"
              icon={Clock3}
              tone="orange"
            />
            <StatCard
              title="ABS"
              value={mine.scheduledDays ? formatPercent(mine.abs) : "Sem dados"}
              helper={mine.scheduledDays ? `${formatNumber(mine.absences)} falta(s) em ${formatNumber(mine.scheduledDays)} dia(s)` : "Sem cronograma no período"}
              icon={Activity}
              tone={mine.abs > 0 ? "red" : "green"}
            />
            <StatCard
              title="Dias com produção"
              value={formatNumber(mine.submitDays)}
              helper={`${formatNumber(mine.scheduledDays)} dia(s) escalado(s)`}
              icon={CalendarDays}
              tone="cyan"
            />
          </div>

          <Panel title="Histórico do período">
            {history.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-[0.08em] text-muted">
                    <tr>
                      <th className="whitespace-nowrap px-4 py-3">Semana</th>
                      <th className="whitespace-nowrap px-4 py-3">Qualidade</th>
                      <th className="whitespace-nowrap px-4 py-3">{usesCpd ? "CPD médio" : "Submit médio/dia"}</th>
                      <th className="whitespace-nowrap px-4 py-3">Total</th>
                      <th className="whitespace-nowrap px-4 py-3">AHT</th>
                      <th className="whitespace-nowrap px-4 py-3">ABS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {history.map((week) => (
                      <tr key={week.weekStart} className="odd:bg-white even:bg-slate-50/60">
                        <td className="whitespace-nowrap px-4 py-3 font-extrabold text-navy-950">{week.weekLabel}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-bold text-navy-950">{week.qualityTotal ? formatPercent(week.quality) : "-"}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-bold text-navy-950">{week.submitDays ? formatNumber(week.submit) : "-"}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-bold text-navy-950">{formatNumber(week.submitTotal)}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-bold text-navy-950">{week.submitTotal ? formatDuration(week.ahtSeconds) : "-"}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-bold text-navy-950">{week.scheduledDays ? formatPercent(week.abs) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-4 py-12 text-center">
                <p className="font-black text-navy-950">Ainda não há dados para o período selecionado.</p>
                <p className="mt-1 text-sm font-semibold text-muted">Altere as datas para consultar outro intervalo.</p>
              </div>
            )}
          </Panel>
        </>
      ) : null}
    </div>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="premium-control h-10 w-full px-3 text-sm font-bold text-navy-950 outline-none"
      />
    </label>
  );
}

function hasPerformanceData(row: WeeklyPerformanceMetric) {
  return row.qualityTotal > 0 || row.submitTotal > 0 || row.scheduledDays > 0;
}

function formatPercent(value: number) {
  return `${Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
}

function formatNumber(value: number) {
  return Math.round(Number(value || 0)).toLocaleString("pt-BR");
}

function formatDuration(value: number) {
  const seconds = Math.max(0, Math.round(Number(value || 0)));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m${String(remainingSeconds).padStart(2, "0")}s`;
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}
