"use client";

import { CheckCircle2, FileSpreadsheet, ShieldCheck, Target } from "lucide-react";
import { StatCard } from "@/components/ui/primitives";
import { QUALITY_EXTRA_INDICATORS, qualityTargetForLob, type QualityIndicators } from "@/lib/performance-quality";
import { formatNumber } from "@/lib/utils";

export function formatQualityIndicator(value: number | null | undefined, percent: boolean) {
  if (value === null || value === undefined) return "—";
  return percent ? `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : formatNumber(value);
}

export function QualityIndicatorsPanel({ indicators, total, correct, lob }: { indicators?: QualityIndicators; total: number; correct: number; lob: string }) {
  const target = qualityTargetForLob(lob);
  const tone = indicators?.accuracy == null ? "blue" : indicators.accuracy >= target ? "green" : "red";
  return (
    <section aria-label="Indicadores de qualidade" className="space-y-3">
      <p className="text-xs font-bold text-muted">{formatNumber(total)} casos distintos auditados. As taxas são recalculadas pelos casos do período e filtro selecionados.</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard title="Accuracy" value={formatQualityIndicator(indicators?.accuracy, true)} helper={`${formatNumber(correct)} corretos / ${formatNumber(total)} auditados · Meta ≥ ${target}%`} icon={ShieldCheck} tone={tone} />
        {QUALITY_EXTRA_INDICATORS.map((metric) => (
          <StatCard key={metric.key} title={metric.label} value={formatQualityIndicator(indicators?.[metric.key], metric.percent)}
            helper={metric.key === "leakageRate" ? "Leakage / Allow" : metric.key === "falsePositiveRate" ? "False Positive / Labeled" : metric.key === "mislabeledRate" ? "Error Labeling / auditados" : "casos distintos"}
            icon={metric.percent ? Target : metric.key === "allow" || metric.key === "labeled" ? FileSpreadsheet : CheckCircle2}
            tone={metric.percent ? "orange" : "blue"} />
        ))}
      </div>
      {indicators && indicators.casesWithDecision < total ? (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900">Allow, Labeled e suas taxas exigem a classificação de todos os casos. {formatNumber(indicators.casesWithDecision)} de {formatNumber(total)} casos têm essa informação; importe a nova base para completar os denominadores.</p>
      ) : null}
      <p className="text-xs font-semibold text-muted">— indica ausência da base de cálculo ou denominador zero.</p>
    </section>
  );
}

export function QualityIndicatorCells({ indicators }: { indicators?: QualityIndicators }) {
  return <>{QUALITY_EXTRA_INDICATORS.map((metric) => <td key={metric.key} className="whitespace-nowrap px-3 py-2 text-right font-bold text-navy-950">{formatQualityIndicator(indicators?.[metric.key], metric.percent)}</td>)}</>;
}
