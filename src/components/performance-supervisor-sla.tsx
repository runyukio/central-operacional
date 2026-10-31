import { formatSupervisorLatency, type SupervisorSla } from "@/lib/performance-supervisors-sla";

const percent = (value: number | null) => value == null ? "Sem dados" : `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

export function SupervisorSlaMetric({ sla }: { sla: SupervisorSla }) {
  const rows = [
    ...(sla.lobs.includes("ADS") ? [{ label: "ADS", value: formatSupervisorLatency(sla.ads.minutes), detail: "Meta ≤ 02:00", met: sla.ads.minutes == null ? null : sla.ads.minutes <= 120 }] : []),
    ...(sla.lobs.includes("TNS") ? [{ label: "TNS Vídeo", value: formatSupervisorLatency(sla.tns.minutes), detail: "Filas de 15 min · Meta ≤ 00:15", met: sla.tns.minutes == null ? null : sla.tns.minutes <= 15 }] : []),
    ...(sla.lobs.includes("CEC") ? [
      { label: "Normal", value: percent(sla.cec.normalSla), detail: "FRT ≤ 24h · Meta ≥ 97%", met: sla.cec.normalSla == null ? null : sla.cec.normalSla >= 97 },
      { label: "P0 + HM", value: percent(sla.cec.urgentSla), detail: "FRT ≤ 4h · Meta ≥ 97%", met: sla.cec.urgentSla == null ? null : sla.cec.urgentSla >= 97 }
    ] : [])
  ];
  return <span className="inline-flex min-w-[170px] flex-col items-end gap-2">
    {rows.length ? rows.map((row) => <span key={row.label} className="flex flex-col items-end">
      <strong className={`whitespace-nowrap font-black ${row.met == null ? "text-muted" : row.met ? "text-emerald-700" : "text-red-700"}`}>{row.label} · {row.value}</strong>
      <span className="mt-0.5 text-[10px] font-bold text-muted">{row.detail}</span>
    </span>) : <span className="text-muted">Sem dados</span>}
  </span>;
}
