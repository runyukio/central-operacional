import type { SpaceKpi } from "@/lib/meu-espaco-targets";
import { number } from "./shared";
import styles from "./space.module.css";

export function SpaceTargetCard({ kpi }: { kpi: SpaceKpi }) {
  const status = kpi.met === null ? "Sem dados" : kpi.met ? "Meta atingida" : "Fora da meta";
  return <div className={styles.metric} data-tone={kpi.met === false ? "amber" : "blue"}>
    <h4 className="text-xs font-bold uppercase tracking-wide text-muted">{kpi.label}</h4>
    <p className={styles.metricValue}>{number(kpi.value)}<span className="ml-1 text-sm font-medium text-muted">{kpi.value !== null ? kpi.unit : ""}</span></p>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span>Meta {kpi.direction === "min" ? "≥" : "≤"} {number(kpi.target)} {kpi.unit}</span><span className={styles.badge}>{status}</span></div>
    <p className="mt-2 text-xs text-muted">{kpi.gap === null ? "Aguardando base válida." : kpi.met ? "Dentro da meta no período · falta 0." : `${kpi.direction === "min" ? "Falta aumentar" : "Precisa reduzir"} ${number(kpi.gap)} ${kpi.unit === "%" ? "p.p." : `${kpi.unit}.`}`}</p>
    <p className="mt-2 text-xs text-muted">Base: {kpi.weightLabel}.</p>
  </div>;
}
