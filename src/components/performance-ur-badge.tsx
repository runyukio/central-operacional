import { UR_TARGET } from "@/lib/performance-ur";
import { cn } from "@/lib/utils";

export function PerformanceUrBadge({ value }: { value?: number | null }) {
  if (value == null || !Number.isFinite(value)) return <span className="text-xs text-muted">Sem dados</span>;
  const met = value >= UR_TARGET;
  return <div className="inline-flex flex-col items-end gap-1" title="UR = moderação real / (8h × dias-agente com base). Sem filtro por fila.">
    <span className={cn("rounded-md px-2 py-1 text-xs font-extrabold", met ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200")}>{value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% · {met ? "Meta atingida" : "Fora da meta"}</span>
    <span className="text-[10px] text-muted">Meta ≥60% · Δ {(value - UR_TARGET).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "always" })} p.p.</span>
  </div>;
}
