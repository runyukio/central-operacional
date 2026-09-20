"use client";

import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, CheckCircle2, ChevronRight, RefreshCw, X } from "lucide-react";
import { FormInput, currentOperationalDateInput } from "./shared";
import { SpaceButtons, SpaceLoad, dateLabel, number, useSpaceRead } from "@/components/meu-espaco/shared";
import styles from "@/components/meu-espaco/space.module.css";
import capacityStyles from "./ads-capacity.module.css";
import { addCapacityDays, CAPACITY_SHIFTS, type CapacityRow } from "@/lib/ads-capacity-core";
import type { AdsCapacitySummary } from "@/lib/ads-capacity-service";
import { selectCapacityDisplay } from "./ads-capacity-display";

const statusLabels = { sufficient: "Capacidade suficiente", deficit: "Déficit", incomplete: "Dados incompletos" };
const sourceLabels = { individual: "Histórico individual", skill: "Estimativa pela skill", missing: "Sem dados" };
const hours = (value: number | null) => value === null ? "Sem dados" : `${String(Math.floor(Math.round(value * 60) / 60)).padStart(2, "0")}:${String(Math.round(value * 60) % 60).padStart(2, "0")}`;

function Badge({ row }: { row: Pick<CapacityRow, "state"> }) {
  return <span className={styles.statusBadge} data-status={row.state === "sufficient" ? "met" : row.state === "deficit" ? "missed" : "missing"}>{statusLabels[row.state]}</span>;
}

export function AdsCapacityPanel() {
  const [draft, setDraft] = useState(() => { const startDate = currentOperationalDateInput(); return { startDate, endDate: addCapacityDays(startDate, 13), shift: "Todos" }; });
  const [filters, setFilters] = useState(draft), [revision, setRevision] = useState(0), [selected, setSelected] = useState<string | null>(null);
  const [dayView, setDayView] = useState("all");
  const params = new URLSearchParams(filters);
  const read = useSpaceRead<AdsCapacitySummary>(`/api/staff-coverage/ads/planning?${params}`, true, revision);
  const data = read.data;
  const visible = useMemo(() => selectCapacityDisplay(data?.data ?? [], data?.byDay ?? [], dayView === "deficit"), [data, dayView]);
  const detailsParams = new URLSearchParams({ ...filters, key: selected ?? "", version: data?.version ?? "" });
  const detail = useSpaceRead<{ row: CapacityRow }>(`/api/staff-coverage/ads/planning/details?${detailsParams}`, selected !== null && Boolean(data));
  const apply = () => { setSelected(null); setFilters({ ...draft }); setRevision((r) => r + 1); };
  return <section aria-label="Planejamento de capacidade ADS" className={`${styles.root} space-y-4`}>
    <form className={`${styles.panel} flex flex-wrap items-end gap-3`} onSubmit={(event) => { event.preventDefault(); apply(); }}>
      <FormInput label="Data inicial" type="date" value={draft.startDate} onChange={(startDate) => setDraft((d) => ({ ...d, startDate }))} />
      <FormInput label="Data final" type="date" value={draft.endDate} onChange={(endDate) => setDraft((d) => ({ ...d, endDate }))} />
      <SpaceButtons label="Turno" value={draft.shift} onChange={(shift) => setDraft((d) => ({ ...d, shift }))} options={[{ id: "Todos", label: "Todos" }, ...CAPACITY_SHIFTS.map((id) => ({ id, label: id }))]} />
      <SpaceButtons label="Exibir" value={dayView} onChange={setDayView} options={[{id:"all",label:"Todos os dias"},{id:"deficit",label:data && !read.loading && !read.error ? `Dias com déficit (${visible.deficitDates.size})` : "Dias com déficit"}]} />
      <button type="submit" className={`${styles.chip} !bg-blue-600 !text-white`} disabled={read.loading}><RefreshCw className={`h-4 w-4 ${read.loading ? "animate-spin" : ""}`} />Aplicar</button>
      <p className="basis-full text-xs text-muted">Até 31 dias · data de início do turno, incluindo a madrugada seguinte · somente consulta.</p>
    </form>
    <SpaceLoad {...read} />
    {!read.loading && !read.error && data ? <>
      <div className={styles.panel}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div><h3 className="font-extrabold">Forecast e capacidade por dia</h3><p className="mt-1 text-xs text-muted">{dayView === "deficit" ? "Totais diários dos turnos selecionados. A tabela abaixo mostra somente os turnos com déficit." : "Compare o volume previsto com a capacidade do cronograma."}</p></div>
        </div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
          <div className="flex flex-wrap gap-4"><span className={capacityStyles.legendItem}><i style={{background:"#2563eb"}} />Forecast</span><span className={capacityStyles.legendItem}><i style={{background:"#14b8a6"}} />Capacidade</span><span className={capacityStyles.legendItem}><i style={{background:"#ef4444"}} />Capacidade abaixo do forecast</span></div>
          <span aria-live="polite">{visible.days.length} dia(s){dayView === "deficit" ? " · pelo menos um turno em déficit" : " no período"}</span>
        </div>
        {visible.days.length ? <>
        <div className="h-72 w-full" role="img" aria-label="Comparação diária entre forecast e capacidade de submits. Valores detalhados na tabela abaixo.">
          <ResponsiveContainer width="100%" height="100%"><BarChart data={visible.days.map((day) => ({ ...day, label: dateLabel(day.date).slice(0, 5) }))} margin={{ left: 5, right: 10, top: 10, bottom: 5 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} />
            <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={(value: number) => value.toLocaleString("pt-BR", { notation: "compact" })} />
            <Tooltip formatter={(value: number) => number(value)} labelFormatter={(_label, entries) => { const day = entries[0]?.payload; return day ? `${dateLabel(day.date)}${day.missing ? " · capacidade parcial" : ""}` : ""; }} contentStyle={{ background: "var(--surface-raised, #fff)", border: "1px solid var(--border)", borderRadius: 10, color: "var(--ink)" }} />
            <Bar dataKey="forecast" name="Forecast" fill="#2563eb" radius={[4, 4, 0, 0]} />
            <Bar dataKey="capacity" name={data.summary.missing ? "Capacidade (parcial)" : "Capacidade estimada"} fill="#14b8a6" radius={[4, 4, 0, 0]}>{visible.days.map(day => <Cell key={day.date} fill={day.gap !== null && day.gap < 0 ? "#ef4444" : "#14b8a6"} />)}</Bar>
          </BarChart></ResponsiveContainer>
        </div>
        </> : <div className="flex flex-col items-center gap-2 py-10 text-center"><CheckCircle2 className="h-8 w-8 text-muted" /><p className="font-bold">Nenhum dia com déficit identificado neste filtro.</p><p className="text-xs text-muted">Dias com dados incompletos não são considerados déficit confirmado.</p><button type="button" className={styles.chip} onClick={() => setDayView("all")}>Ver todos os dias</button></div>}
      </div>
      {visible.rows.length ? <div className={styles.panel}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-extrabold">Planejamento por dia e turno</h3><p className="mt-1 text-xs text-muted">Abra “Ver parceiros” para entender a capacidade de cada pessoa.</p></div><span className="text-xs text-muted" aria-live="polite">{visible.rows.length} turno(s){dayView === "deficit" ? " com déficit" : ""}</span></div>
        <div className={capacityStyles.tableViewport}><table className={`${styles.table} ${capacityStyles.planningTable}`} aria-label="Planejamento por dia e turno"><colgroup>{[13,7,17,11,11,12,10,19].map((width,index)=><col key={index} style={{width:`${width}%`}} />)}</colgroup><thead><tr>{["Dia / turno", "Pessoas", "Dimensionamento", "Forecast", "Capacidade", "Saldo submits", "Cobertura", "Situação"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{visible.rows.map((row,index) => <tr key={row.key} data-state={row.state} data-new-day={index > 0 && visible.rows[index-1].date !== row.date || undefined}>
            <td data-label="Dia / turno"><strong className="block">{dateLabel(row.date)}</strong><span className="mt-1 block text-muted">{row.shift}</span></td>
            <td data-label="Pessoas"><strong className="text-base">{row.scheduled}</strong></td>
            <td data-label="Dimensionamento"><span className="block"><span className="text-muted">Requerido:</span> {row.required === null ? "Não cadastrado" : number(row.required)}</span><span className="block"><span className="text-muted">Necessário:</span> {number(row.calculatedRequired)}</span><small className="block text-muted">Saldo pessoas¹: {number(row.peopleGap)}</small></td>
            <td data-label="Forecast">{number(row.forecast)}</td><td data-label="Capacidade">{number(row.capacity)}{row.missing ? <small className="block text-amber-700 dark:text-amber-300">Parcial</small> : null}</td>
            <td data-label="Saldo submits"><span className={capacityStyles.balance} data-negative={row.gap !== null && row.gap < 0 || undefined}>{row.gap !== null ? row.gap < 0 ? <ArrowDownRight aria-hidden className="h-3.5 w-3.5 shrink-0" /> : <ArrowUpRight aria-hidden className="h-3.5 w-3.5 shrink-0" /> : null}{number(row.gap)}</span></td>
            <td data-label="Cobertura"><strong>{number(row.coverage, "%")}</strong>{row.coverage !== null ? <div className={capacityStyles.coverageTrack} aria-hidden><span data-negative={row.coverage < 100 || undefined} style={{width:`${Math.max(0,Math.min(100,row.coverage))}%`}} /></div> : null}</td>
            <td data-label="Situação"><Badge row={row} /><button type="button" className="mt-2 flex items-center gap-1 text-left text-xs font-bold text-blue-600 hover:underline dark:text-blue-300" onClick={() => setSelected(row.key)} aria-label={`Ver parceiros ${dateLabel(row.date)} ${row.shift}`}>Ver parceiros<ChevronRight className="h-3.5 w-3.5 shrink-0" /></button>{row.scheduled === 0 && row.shift !== "Sem cobertura" ? <small className="mt-1 block text-muted">Sem pessoas programadas</small> : null}</td>
          </tr>)}</tbody></table></div>
        <p className="mt-3 text-xs text-muted">¹ Pessoas programadas menos necessidade calculada. A necessidade é arredondada para cima; os demais cálculos preservam a precisão.</p>
      </div> : null}
    </> : null}
    <Dialog.Root open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}><Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <Dialog.Content className={`${styles.root} fixed left-1/2 top-1/2 z-50 flex max-h-[92dvh] w-[calc(100%_-_2rem)] max-w-[1600px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border bg-white dark:bg-[var(--surface-raised)] p-4 sm:p-6 shadow-2xl`}>
        <div className="flex items-center justify-between gap-3"><Dialog.Title className="text-lg font-extrabold">Capacidade por parceiro</Dialog.Title><Dialog.Close className={styles.chip} aria-label="Fechar detalhe"><X className="h-4 w-4" /></Dialog.Close></div>
        <Dialog.Description className="my-2 text-sm text-muted">{selected ? selected.replace("|", " · ") : ""} · produtividade por hora de cronograma, sem novo desconto de pausas.</Dialog.Description>
        <SpaceLoad {...detail} />
        {!detail.loading && !detail.error && detail.data ? <div className={`${capacityStyles.tableViewport} min-h-0 overflow-y-auto`}><table className={`${styles.table} ${capacityStyles.detailTable}`} aria-label="Capacidade por parceiro">
          <colgroup>{[24, 12, 12, 12, 6, 8, 8, 18].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
          <thead><tr>{["Parceiro / WB", "Skill", "Status", "Horário", "Horas", "Submits/h", "Capacidade", "Referência"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>
          {detail.data.row.agents.map((agent) => <tr key={agent.id}><td data-label="Parceiro / WB" className="font-bold">{agent.name}<small className="block font-normal text-muted">{agent.wbLogin}</small></td><td data-label="Skill">{agent.skill || "Sem skill"}</td><td data-label="Status">{agent.statusLabel}</td>
            <td data-label="Horário">{agent.start === null || agent.end === null ? "Revisar horário" : <><span className="inline-block">{new Date(agent.start).toISOString().slice(11, 16)}–{new Date(agent.end).toISOString().slice(11, 16)}</span>{new Date(agent.end).toISOString().slice(0, 10) !== agent.date ? <small className="block text-muted">(+1 dia)</small> : null}</>}</td>
            <td data-label="Horas">{hours(agent.plannedHours)}</td><td data-label="Submits/h">{number(agent.rate)}</td><td data-label="Capacidade">{number(agent.capacity)}</td><td data-label="Referência">{sourceLabels[agent.source]}<small className="block text-muted">{agent.validShifts} turnos individuais válidos</small></td></tr>)}
          {!detail.data.row.agents.length ? <tr className={capacityStyles.emptyRow}><td colSpan={8}>Nenhum parceiro programado neste intervalo.</td></tr> : null}
        </tbody></table></div> : null}
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>
  </section>;
}
