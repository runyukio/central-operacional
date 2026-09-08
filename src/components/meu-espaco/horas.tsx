"use client";

import { useEffect, useState } from "react";
import { FormInput } from "@/components/modules/shared";
import { formatWorkHours, formatSignedMinutesToHHMM } from "@/lib/work-hours-rules";
import type { SpaceHours, SpacePeriod } from "@/lib/meu-espaco-contract";
import { spaceHoursDefaultPeriod } from "@/lib/meu-espaco-hours";
import { dateLabel, SpaceCard, SpaceLoad, tableClass, useSpaceRead } from "./shared";
import { SpacePeriodSlicer } from "./slicers";

export function SpaceHoursTab({ supervisorId, initialPeriod }: { supervisorId: string; initialPeriod: SpacePeriod }) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [period, setPeriod] = useState(() => spaceHoursDefaultPeriod(initialPeriod, today)), [search, setSearch] = useState(""), [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => { const timer = setTimeout(() => { setAppliedSearch(search.trim()); setPage(1); }, 300); return () => clearTimeout(timer); }, [search]);
  const valid = Boolean(period.startDate && period.endDate && period.startDate <= period.endDate);
  const read = useSpaceRead<SpaceHours>(`/api/meu-espaco/horas?${new URLSearchParams({ ...period, supervisorId, search: appliedSearch, page: String(page) })}`, valid && search.trim() === appliedSearch);
  function changePeriod(patch: Partial<SpacePeriod>) { setPeriod((value) => ({ ...value, ...patch })); setPage(1); }
  return <div className="space-y-4">
    <SpacePeriodSlicer label="Período das horas e da projeção" value={period} today={today} onChange={changePeriod} />
    <div className="card flex flex-wrap items-end justify-between gap-4 p-4"><button type="button" className="premium-control px-4 py-2 text-sm font-bold" onClick={() => changePeriod(spaceHoursDefaultPeriod({ startDate: `${today.slice(0, 7)}-01`, endDate: today }, today))}>Mês completo · incluir projeção</button><FormInput label="Parceiro" value={search} onChange={setSearch} placeholder="Nome ou WB" /></div>
    <p className="text-sm text-muted">Realizado = soma das horas efetivas já registradas até hoje, incluindo ajustes aplicados. Projeção = escala de amanhã até a data final, seguindo as horas produtivas de Horas Operacionais. Hoje não é projetado novamente.</p>
    {!valid ? <p role="alert" className="text-red-700">Selecione um período válido.</p> : <SpaceLoad {...read} />}
    {valid && !read.loading && read.data && search.trim() === appliedSearch ? <>
      <div className="grid gap-3 sm:grid-cols-3"><SpaceCard title="Horas realizadas" value={read.data.summary.realizedHours === null ? "Sem dados" : formatWorkHours(read.data.summary.realizedHours)} helper={`${read.data.summary.realizedRecords} registros · até ${dateLabel(read.data.summary.actualThrough)} · todas as páginas`} /><SpaceCard title="Escala futura" value={formatWorkHours(read.data.summary.futureHours)} helper={`${read.data.summary.futureSlots} dias-parceiro elegíveis · ${dateLabel(read.data.summary.projectionFrom)} a ${dateLabel(read.data.summary.projectionUntil)}`} /><SpaceCard title="Total projetado" value={read.data.summary.projectedHours === null ? "Sem dados" : formatWorkHours(read.data.summary.projectedHours)} helper="Realizado acumulado + escala futura; não é um fechamento aprovado" /></div>
      {read.data.summary.missingPastSlots > 0 ? <p role="status" className="rounded-xl border border-border p-3 text-sm text-muted">Atenção: {read.data.summary.missingPastSlots} dias-parceiro escalados em datas anteriores a hoje ainda não têm horas registradas. Não foram preenchidos pela projeção; o total pode estar incompleto.</p> : null}
      {!read.data.summary.realizedRecords && read.data.summary.futureSlots > 0 ? <p className="text-sm text-muted">Sem realizado disponível: o total projetado considera somente a escala futura.</p> : null}
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className={tableClass}><thead><tr><th>Data / parceiro</th><th>Previstas</th><th>Capturadas</th><th>Registradas</th><th>Ajustadas</th><th>Efetivas</th><th>Diferença</th><th>Status</th></tr></thead><tbody>{read.data.data.map((row) => <tr key={row.id}><td><p className="font-bold">{row.employeeName}</p><p className="text-xs text-muted">{row.date} · {row.wbLogin}</p></td><td>{formatWorkHours(row.plannedHours)}</td><td>{formatWorkHours(row.capturedHours)}</td><td>{formatWorkHours(row.actualHours)}</td><td>{formatWorkHours(row.adjustedHours)}</td><td>{formatWorkHours(row.effectiveHours)}</td><td>{formatSignedMinutesToHHMM(row.differenceMinutes)}</td><td>{row.status}</td></tr>)}</tbody></table></div>
      {!read.data.data.length ? <p className="p-8 text-center text-muted">Sem registros de horas no período.</p> : null}
      <div className="flex items-center justify-between gap-3 border-t border-border p-4 text-sm"><button type="button" className="premium-control px-3 py-2 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</button><span>Página {page} de {read.data.pagination.totalPages} · {read.data.pagination.total} registros</span><button type="button" className="premium-control px-3 py-2 disabled:opacity-40" disabled={page >= read.data.pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Próxima</button></div>
    </div></> : null}
  </div>;
}
