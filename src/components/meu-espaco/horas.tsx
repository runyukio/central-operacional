"use client";

import { useEffect, useState } from "react";
import { FormInput } from "@/components/modules/shared";
import { formatWorkHours, formatSignedMinutesToHHMM } from "@/lib/work-hours-rules";
import type { SpaceHours, SpacePeriod } from "@/lib/meu-espaco-contract";
import { spaceHoursDefaultPeriod } from "@/lib/meu-espaco-hours";
import { dateLabel, SpaceCard, SpaceLoad, tableClass, useSpaceRead } from "./shared";

export function SpaceHoursTab({ supervisorId, initialPeriod }: { supervisorId: string; initialPeriod: SpacePeriod }) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [month, setMonth] = useState(() => spaceHoursDefaultPeriod(initialPeriod, today).startDate.slice(0, 7)), [search, setSearch] = useState(""), [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => { const timer = setTimeout(() => { setAppliedSearch(search.trim()); setPage(1); }, 300); return () => clearTimeout(timer); }, [search]);
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const read = useSpaceRead<SpaceHours>(`/api/meu-espaco/horas?${new URLSearchParams({ month, supervisorId, search: appliedSearch, page: String(page) })}`, valid && search.trim() === appliedSearch);
  function changeMonth(value: string) { setMonth(value); setPage(1); }
  return <div className="space-y-4">
    <div className="card flex flex-wrap items-end justify-between gap-4 p-4"><FormInput label="Mês das horas" type="month" value={month} onChange={changeMonth} /><button type="button" className="premium-control px-4 py-2 text-sm font-bold" onClick={() => changeMonth(today.slice(0, 7))}>Mês atual</button><FormInput label="Parceiro" value={search} onChange={setSearch} placeholder="Nome ou WB" /></div>
    <p className="text-sm text-muted">Visão mensal: uma linha por parceiro, somando todos os dias do mês. Realizado inclui ajustes aplicados até hoje. Projeção usa a escala de amanhã até o último dia do mês; hoje não é projetado novamente.</p>
    {!valid ? <p role="alert" className="text-red-700">Selecione um período válido.</p> : <SpaceLoad {...read} />}
    {valid && !read.loading && read.data && search.trim() === appliedSearch ? <>
      <div className="grid gap-3 sm:grid-cols-3"><SpaceCard title="Horas realizadas no mês" value={read.data.summary.realizedHours === null ? "Sem dados" : formatWorkHours(read.data.summary.realizedHours)} helper={`${read.data.summary.realizedRecords} registros · até ${dateLabel(read.data.summary.actualThrough)} · todos os parceiros filtrados`} /><SpaceCard title="Escala futura do mês" value={formatWorkHours(read.data.summary.futureHours)} helper={read.data.summary.futureSlots ? `${read.data.summary.futureSlots} dias-parceiro · até ${dateLabel(read.data.summary.projectionUntil)}` : "Sem escala futura elegível neste mês"} /><SpaceCard title="Total projetado do mês" value={read.data.summary.projectedHours === null ? "Sem dados" : formatWorkHours(read.data.summary.projectedHours)} helper="Realizado acumulado + escala futura; não é um fechamento aprovado" /></div>
      {read.data.summary.missingPastSlots > 0 ? <p role="status" className="rounded-xl border border-border p-3 text-sm text-muted">Atenção: {read.data.summary.missingPastSlots} dias-parceiro escalados em datas anteriores a hoje ainda não têm horas registradas. Não foram preenchidos pela projeção; o total pode estar incompleto.</p> : null}
      {!read.data.summary.realizedRecords && read.data.summary.futureSlots > 0 ? <p className="text-sm text-muted">Sem realizado disponível: o total projetado considera somente a escala futura.</p> : null}
      <div className="card overflow-hidden"><h3 className="p-4 text-sm font-bold">Consolidado mensal por parceiro · {month.split("-").reverse().join("/")}</h3><div className="overflow-x-auto"><table className={tableClass}><thead><tr><th>Parceiro / WB</th><th>Escala do mês</th><th>Capturadas</th><th>Realizadas (efetivas)</th><th>Escala futura</th><th>Total projetado</th><th>Diferença realizada</th><th>Status do mês</th></tr></thead><tbody>{read.data.data.map((row) => <tr key={row.id}><td><p className="font-bold">{row.employeeName}</p><p className="text-xs text-muted">{row.wbLogin}</p></td><td>{formatWorkHours(row.plannedHours)}</td><td>{row.realizedRecords ? formatWorkHours(row.capturedHours) : "Sem dados"}</td><td>{row.realizedRecords ? formatWorkHours(row.effectiveHours) : "Sem dados"}</td><td>{formatWorkHours(row.futureHours)}</td><td>{row.projectedHours === null ? "Sem dados" : formatWorkHours(row.projectedHours)}</td><td>{row.realizedRecords ? formatSignedMinutesToHHMM(row.differenceMinutes) : "Sem dados"}</td><td>{row.status}</td></tr>)}</tbody></table></div>
      {!read.data.data.length ? <p className="p-8 text-center text-muted">Sem registros de horas no período.</p> : null}
      <div className="flex items-center justify-between gap-3 border-t border-border p-4 text-sm"><button type="button" className="premium-control px-3 py-2 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</button><span>Página {page} de {read.data.pagination.totalPages} · {read.data.pagination.total} parceiros</span><button type="button" className="premium-control px-3 py-2 disabled:opacity-40" disabled={page >= read.data.pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Próxima</button></div>
    </div></> : null}
  </div>;
}
