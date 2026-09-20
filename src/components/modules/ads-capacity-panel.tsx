"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronRight, RefreshCw, X } from "lucide-react";
import { FormInput, currentOperationalDateInput } from "./shared";
import { SpaceButtons, SpaceCard, SpaceLoad, dateLabel, number, tableClass, useSpaceRead } from "@/components/meu-espaco/shared";
import styles from "@/components/meu-espaco/space.module.css";
import { addCapacityDays, CAPACITY_SHIFTS, type CapacityRow } from "@/lib/ads-capacity-core";
import type { AdsCapacitySummary } from "@/lib/ads-capacity-service";

const statusLabels = { sufficient: "Capacidade suficiente", deficit: "Déficit", incomplete: "Dados incompletos" };
const sourceLabels = { individual: "Histórico individual", skill: "Estimativa pela skill", missing: "Sem dados" };
const timestamp = (value: string | null, wallClock = false) => value ? new Date(value).toLocaleString("pt-BR", { timeZone: wallClock ? "UTC" : "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "Sem dados";
const hours = (value: number | null) => value === null ? "Sem dados" : `${String(Math.floor(Math.round(value * 60) / 60)).padStart(2, "0")}:${String(Math.round(value * 60) % 60).padStart(2, "0")}`;

function Badge({ row }: { row: Pick<CapacityRow, "state"> }) {
  return <span className={styles.statusBadge} data-status={row.state === "sufficient" ? "met" : row.state === "deficit" ? "missed" : "missing"}>{statusLabels[row.state]}</span>;
}

export function AdsCapacityPanel() {
  const [draft, setDraft] = useState(() => { const startDate = currentOperationalDateInput(); return { startDate, endDate: addCapacityDays(startDate, 13), shift: "Todos" }; });
  const [filters, setFilters] = useState(draft), [revision, setRevision] = useState(0), [selected, setSelected] = useState<string | null>(null);
  const params = new URLSearchParams(filters);
  const read = useSpaceRead<AdsCapacitySummary>(`/api/staff-coverage/ads/planning?${params}`, true, revision);
  const data = read.data;
  const detailsParams = new URLSearchParams({ ...filters, key: selected ?? "", version: data?.version ?? "" });
  const detail = useSpaceRead<{ row: CapacityRow }>(`/api/staff-coverage/ads/planning/details?${detailsParams}`, selected !== null && Boolean(data));
  const apply = () => { setSelected(null); setFilters({ ...draft }); setRevision((r) => r + 1); };
  return <section aria-label="Planejamento de capacidade ADS" className={`${styles.root} space-y-4`}>
    <form className={`${styles.panel} flex flex-wrap items-end gap-3`} onSubmit={(event) => { event.preventDefault(); apply(); }}>
      <FormInput label="Data inicial" type="date" value={draft.startDate} onChange={(startDate) => setDraft((d) => ({ ...d, startDate }))} />
      <FormInput label="Data final" type="date" value={draft.endDate} onChange={(endDate) => setDraft((d) => ({ ...d, endDate }))} />
      <SpaceButtons label="Turno" value={draft.shift} onChange={(shift) => setDraft((d) => ({ ...d, shift }))} options={[{ id: "Todos", label: "Todos" }, ...CAPACITY_SHIFTS.map((id) => ({ id, label: id }))]} />
      <button type="submit" className={`${styles.chip} !bg-blue-600 !text-white`} disabled={read.loading}><RefreshCw className={`h-4 w-4 ${read.loading ? "animate-spin" : ""}`} />Aplicar</button>
      <p className="basis-full text-xs text-muted">Até 31 dias · data de início do turno, incluindo a madrugada seguinte · somente consulta.</p>
    </form>
    <SpaceLoad {...read} />
    {!read.loading && !read.error && data ? <>
      <div className="grid gap-3 md:grid-cols-3">
        <SpaceCard title="Forecast atribuído" value={number(data.summary.forecast)} helper="submits previstos no período operacional" />
        <SpaceCard title={data.summary.missing ? "Capacidade estimada · parcial" : "Capacidade estimada"} value={number(data.summary.capacity)} helper="soma da produtividade de quem está no cronograma" />
        <SpaceCard title="Saldo em submits" value={number(data.summary.gap)} helper="capacidade menos forecast" />
      </div>
      <div className={`${styles.panel} space-y-2 text-xs text-muted`}>
        <p><strong className="text-navy-950">Histórico: {dateLabel(data.historyPeriod.startDate)} a {dateLabel(data.historyPeriod.endDate)}</strong> · duas semanas completas · submits ÷ horas de cronograma.</p>
        <p>Parceiros únicos: {data.summary.reference.individual} com média individual · {data.summary.reference.skill} pela skill · {data.summary.reference.missing} sem referência. {data.summary.scheduled} participações no cronograma do período.</p>
        <p>Produção até {timestamp(data.sources.latestProductionAt, true)} · volume até {timestamp(data.sources.latestVolumeAt, true)} · consulta {timestamp(data.calculatedAt)}.</p>
        <p>Comparecimento e ritmo histórico mantidos; sem desconto adicional de pausas, ABS ou backlog. Não representa garantia de SLA.</p>
        {data.warnings.length ? <details><summary className="cursor-pointer font-bold text-amber-700 dark:text-amber-300">Cobertura das bases: {data.warnings.length} aviso(s)</summary><ul className="mt-2 list-disc space-y-1 pl-5">{data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details> : null}
        {(data.summary.uncoveredForecast ?? 0) > 0 ? <p className="font-bold text-red-700 dark:text-red-300">Forecast sem cobertura: {number(data.summary.uncoveredForecast)} submits. Esse volume está preservado nas linhas “Sem cobertura”.</p> : null}
      </div>
      <div className={styles.panel}>
        <h3 className="mb-4 font-extrabold">Forecast e capacidade por dia</h3>
        <div className="h-72 w-full" role="img" aria-label="Comparação diária entre forecast e capacidade de submits. Valores detalhados na tabela abaixo.">
          <ResponsiveContainer width="100%" height="100%"><BarChart data={data.byDay.map((day) => ({ ...day, label: dateLabel(day.date).slice(0, 5) }))} margin={{ left: 5, right: 10, top: 10, bottom: 5 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} />
            <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={(value: number) => value.toLocaleString("pt-BR", { notation: "compact" })} />
            <Tooltip formatter={(value: number) => number(value)} labelFormatter={(_label, entries) => { const day = entries[0]?.payload; return day ? `${dateLabel(day.date)}${day.missing ? " · capacidade parcial" : ""}` : ""; }} contentStyle={{ background: "var(--surface-raised, #fff)", border: "1px solid var(--border)", borderRadius: 10, color: "var(--ink)" }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="forecast" name="Forecast" fill="#2563eb" radius={[4, 4, 0, 0]} />
            <Bar dataKey="capacity" name={data.summary.missing ? "Capacidade (parcial)" : "Capacidade estimada"} fill="#14b8a6" radius={[4, 4, 0, 0]} />
          </BarChart></ResponsiveContainer>
        </div>
      </div>
      <div className={styles.panel}>
        <h3 className="font-extrabold">Planejamento por dia e turno</h3>
        <p className="mb-3 mt-1 text-xs text-muted">Necessidade calculada para a produtividade e composição daquele turno. Requerido cadastrado permanece inalterado.</p>
        <div className="overflow-x-auto"><table className={`${tableClass} min-w-[1280px]`}><thead><tr>{["Data / turno", "Pessoas", "Requerido cadastrado", "Necessidade calculada", "Capacidade", "Forecast", "Saldo submits", "Cobertura", "Saldo pessoas¹", "Situação"].map((label) => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{data.data.map((row) => <tr key={row.key}>
            <td><button type="button" className="flex items-center gap-1 text-left font-bold text-blue-600 hover:underline" onClick={() => setSelected(row.key)} aria-label={`Ver parceiros ${dateLabel(row.date)} ${row.shift}`}>{dateLabel(row.date)}<br />{row.shift}<ChevronRight className="h-4 w-4 shrink-0" /></button></td>
            <td>{row.scheduled}</td><td>{row.required === null ? "Não cadastrado" : number(row.required)}</td><td>{number(row.calculatedRequired)}</td>
            <td>{number(row.capacity)}{row.missing ? <small className="block text-amber-700 dark:text-amber-300">Parcial</small> : null}</td><td>{number(row.forecast)}</td><td>{number(row.gap)}</td><td>{number(row.coverage, "%")}</td><td>{number(row.peopleGap)}</td><td><Badge row={row} />{row.scheduled === 0 && row.shift !== "Sem cobertura" ? <small className="mt-1 block text-muted">Sem pessoas programadas</small> : null}</td>
          </tr>)}</tbody></table></div>
        <p className="mt-3 text-xs text-muted">¹ Pessoas programadas menos necessidade calculada. A necessidade é arredondada para cima; os demais cálculos preservam a precisão.</p>
      </div>
    </> : null}
    <Dialog.Root open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}><Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <Dialog.Content className={`${styles.root} fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100%_-_2rem)] max-w-6xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border bg-white dark:bg-[var(--surface-raised)] p-5 shadow-2xl`}>
        <div className="flex items-center justify-between gap-3"><Dialog.Title className="text-lg font-extrabold">Capacidade por parceiro</Dialog.Title><Dialog.Close className={styles.chip} aria-label="Fechar detalhe"><X className="h-4 w-4" /></Dialog.Close></div>
        <Dialog.Description className="my-2 text-sm text-muted">{selected ? selected.replace("|", " · ") : ""} · produtividade por hora de cronograma, sem novo desconto de pausas.</Dialog.Description>
        <SpaceLoad {...detail} />
        {!detail.loading && !detail.error && detail.data ? <div className="overflow-auto"><table className={`${tableClass} min-w-[1120px]`}><thead><tr>{["Parceiro / WB", "Skill", "Status", "Horário", "Horas", "Submits/h", "Capacidade", "Referência"].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>
          {detail.data.row.agents.map((agent) => <tr key={agent.id}><td className="font-bold">{agent.name}<small className="block font-normal text-muted">{agent.wbLogin}</small></td><td>{agent.skill || "Sem skill"}</td><td>{agent.statusLabel}</td>
            <td className="whitespace-nowrap">{agent.start === null || agent.end === null ? "Revisar horário" : `${new Date(agent.start).toISOString().slice(11, 16)}–${new Date(agent.end).toISOString().slice(11, 16)}${new Date(agent.end).toISOString().slice(0, 10) !== agent.date ? " (+1 dia)" : ""}`}</td>
            <td>{hours(agent.plannedHours)}</td><td>{number(agent.rate)}</td><td>{number(agent.capacity)}</td><td>{sourceLabels[agent.source]}<small className="block text-muted">{agent.validShifts} turnos individuais válidos</small></td></tr>)}
          {!detail.data.row.agents.length ? <tr><td colSpan={8}>Nenhum parceiro programado neste intervalo.</td></tr> : null}
        </tbody></table></div> : null}
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>
  </section>;
}
