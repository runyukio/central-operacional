import type { SpaceKpi } from "@/lib/meu-espaco-targets";
import { Check, Minus, AlertCircle } from "lucide-react";
import { number } from "./shared";
import styles from "./space.module.css";

export function SpaceTargetBadge({ kpi }: { kpi: SpaceKpi }) {
  const Icon = kpi.met === null ? Minus : kpi.met ? Check : AlertCircle;
  return <span className={styles.statusBadge} data-status={kpi.met === null ? "missing" : kpi.met ? "met" : "missed"}><Icon aria-hidden className="h-3.5 w-3.5" />{kpi.met === null ? "Sem dados" : kpi.met ? "Meta atingida" : "Fora da meta"}</span>;
}

export function SpaceTargetInline({ kpi }: { kpi: SpaceKpi }) {
  const delta = kpi.value === null ? null : kpi.value - kpi.target;
  const displayUnit = ["materialDaily", "cpd"].includes(kpi.id) ? "/dia" : kpi.unit;
  const unit = kpi.unit === "%" ? "p.p." : displayUnit;
  const magnitude = delta === null ? "" : Math.abs(delta) > 0 && Math.abs(delta) < 0.01 ? "<0,01" : number(Math.abs(delta));
  return <span className={styles.inlineTarget} data-status={kpi.met === null ? "missing" : kpi.met ? "met" : "missed"} title={`${kpi.met === null ? "Sem dados" : kpi.met ? "Meta atingida" : "Fora da meta"}. Delta = realizado menos meta.`}>
    {kpi.met === null ? "—" : kpi.met ? "✓" : "!"} Meta {kpi.direction === "min" ? "≥" : "≤"}{number(kpi.target)}{displayUnit === "%" || displayUnit === "/dia" ? displayUnit : ` ${displayUnit}`}{delta === null ? "" : ` · Δ ${delta > 0 ? "+" : delta < 0 ? "−" : ""}${magnitude} ${unit}`}
  </span>;
}

export function SpaceTargetCard({ kpi }: { kpi: SpaceKpi }) {
  return <div className={styles.metric} data-tone={kpi.met === false ? "amber" : "blue"}>
    <h4 className="text-xs font-bold uppercase tracking-wide text-muted">{kpi.label}</h4>
    <p className={styles.metricValue}>{number(kpi.value)}<span className="ml-1 text-sm font-medium text-muted">{kpi.value !== null ? kpi.unit : ""}</span></p>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span>Meta {kpi.direction === "min" ? "≥" : "≤"} {number(kpi.target)} {kpi.unit}</span><SpaceTargetBadge kpi={kpi} /></div>
    <p className="mt-2 text-xs text-muted">{kpi.gap === null ? "Aguardando base válida." : kpi.met ? "Dentro da meta no período · falta 0." : `${kpi.direction === "min" ? "Falta aumentar" : "Precisa reduzir"} ${number(kpi.gap)} ${kpi.unit === "%" ? "p.p." : `${kpi.unit}.`}`}</p>
  </div>;
}
