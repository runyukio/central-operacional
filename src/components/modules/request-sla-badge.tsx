import { formatPipelineDuration, type RequestSla } from "@/lib/request-pipeline";
import { cn } from "@/lib/utils";

export function RequestSlaBadge({ sla }: { sla?: RequestSla }) {
  const state = sla?.state ?? "UNRECORDED";
  const label = {
    WAITING_WFM: "Aguardando WFM", WITHIN_DEADLINE: "Dentro do prazo", OVERDUE: "Fora do prazo",
    UNRECORDED: "Prazo sem registro", NOT_APPLICABLE: "Sem etapa WFM"
  }[state];
  const tone = state === "OVERDUE" ? "border-red-200 bg-red-50 text-red-700" : state === "WITHIN_DEADLINE" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600";
  const remaining = sla?.remainingBusinessMinutes;
  return <span className="block min-w-36 space-y-1 text-xs">
    <span className={cn("inline-flex rounded-full border px-2.5 py-1 font-bold", tone)}>{label}</span>
    {typeof remaining === "number" ? <span className="block text-muted">{sla?.closed ? "Encerrado • " : ""}{remaining < 0 ? `${formatPipelineDuration(remaining)} de atraso` : `${formatPipelineDuration(remaining)} ${sla?.closed ? "de antecedência" : "restantes"}`}</span> : null}
    {state === "WAITING_WFM" ? <span className="block text-muted">Contagem ainda não iniciada</span> : null}
  </span>;
}
