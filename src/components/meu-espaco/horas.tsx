"use client";

import { useEffect, useState } from "react";
import { FormInput } from "@/components/modules/shared";
import { formatWorkHours, formatSignedMinutesToHHMM } from "@/lib/work-hours-rules";
import type { SpaceHours, SpacePeriod } from "@/lib/meu-espaco-contract";
import { SpaceLoad, tableClass, useSpaceRead } from "./shared";

export function SpaceHoursTab({ supervisorId, initialPeriod }: { supervisorId: string; initialPeriod: SpacePeriod }) {
  const [period, setPeriod] = useState(initialPeriod), [search, setSearch] = useState(""), [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => { const timer = setTimeout(() => { setAppliedSearch(search.trim()); setPage(1); }, 300); return () => clearTimeout(timer); }, [search]);
  const valid = Boolean(period.startDate && period.endDate && period.startDate <= period.endDate);
  const read = useSpaceRead<SpaceHours>(`/api/meu-espaco/horas?${new URLSearchParams({ ...period, supervisorId, search: appliedSearch, page: String(page) })}`, valid && search.trim() === appliedSearch);
  function changePeriod(patch: Partial<SpacePeriod>) { setPeriod((value) => ({ ...value, ...patch })); setPage(1); }
  return <div className="space-y-4">
    <div className="card grid gap-4 p-4 sm:grid-cols-3"><FormInput label="Horas desde" type="date" value={period.startDate} onChange={(startDate) => changePeriod({ startDate })} /><FormInput label="Horas até" type="date" value={period.endDate} onChange={(endDate) => changePeriod({ endDate })} /><FormInput label="Parceiro" value={search} onChange={setSearch} placeholder="Nome ou WB" /></div>
    <p className="text-sm text-muted">Consulta das Horas Operacionais do time atual. Importação, edição e aprovação continuam nas telas originais.</p>
    {!valid ? <p role="alert" className="text-red-700">Selecione um período válido.</p> : <SpaceLoad {...read} />}
    {valid && !read.loading && read.data && search.trim() === appliedSearch ? <div className="card overflow-hidden"><div className="overflow-x-auto"><table className={tableClass}><thead><tr><th>Data / parceiro</th><th>Previstas</th><th>Capturadas</th><th>Registradas</th><th>Ajustadas</th><th>Efetivas</th><th>Diferença</th><th>Status</th></tr></thead><tbody>{read.data.data.map((row) => <tr key={row.id}><td><p className="font-bold">{row.employeeName}</p><p className="text-xs text-muted">{row.date} · {row.wbLogin}</p></td><td>{formatWorkHours(row.plannedHours)}</td><td>{formatWorkHours(row.capturedHours)}</td><td>{formatWorkHours(row.actualHours)}</td><td>{formatWorkHours(row.adjustedHours)}</td><td>{formatWorkHours(row.effectiveHours)}</td><td>{formatSignedMinutesToHHMM(row.differenceMinutes)}</td><td>{row.status}</td></tr>)}</tbody></table></div>
      {!read.data.data.length ? <p className="p-8 text-center text-muted">Sem registros de horas no período.</p> : null}
      <div className="flex items-center justify-between gap-3 border-t border-border p-4 text-sm"><button type="button" className="premium-control px-3 py-2 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</button><span>Página {page} de {read.data.pagination.totalPages} · {read.data.pagination.total} registros</span><button type="button" className="premium-control px-3 py-2 disabled:opacity-40" disabled={page >= read.data.pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Próxima</button></div>
    </div> : null}
  </div>;
}
