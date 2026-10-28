"use client";

import { useEffect, useRef, useState } from "react";
import type { getPerformanceSupervisorAgentsDashboard } from "@/lib/performance-service";
import { compareSpaceValues } from "@/lib/meu-espaco-order";
import { formatMinutesToHHMM } from "@/lib/work-hours-rules";
import { number, tableClass, useSpaceRead } from "./meu-espaco/shared";
import { SpaceSortHeader } from "./meu-espaco/sort-header";

type Payload = Awaited<ReturnType<typeof getPerformanceSupervisorAgentsDashboard>>;
type Agent = Payload["agents"][number];
const columns = [
  { key: "abs", label: "ABS", value: (row: Agent) => row.metric.abs, suffix: "%" },
  { key: "mood", label: "Humor", value: (row: Agent) => row.moodAverage, suffix: "/5" },
  { key: "productivity", label: "AHT / CPD", value: (row: Agent) => row.lob === "CEC" ? row.metric.cpd : row.metric.ahtSeconds },
  { key: "quality", label: "Qualidade", value: (row: Agent) => row.metric.quality, suffix: "%" },
  { key: "adherence", label: "Aderência de horas · 8h", value: (row: Agent) => row.work.adherenceRate, suffix: "%" },
  { key: "late", label: "Taxa de atraso", value: (row: Agent) => row.work.lateRate, suffix: "%" },
  { key: "early", label: "Taxa de saída antecipada", value: (row: Agent) => row.work.earlyRate, suffix: "%" },
  { key: "overtime", label: "Hora extra", value: (row: Agent) => row.work.officialOvertimeHours }
];

export function SupervisorAgentsTable({ data }: { data: Payload }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("name"), [direction, setDirection] = useState<"asc" | "desc">("asc");
  function onSort(key: string) { setDirection(sort === key && direction === "asc" ? "desc" : "asc"); setSort(key); }
  const agents = data.agents.filter((row) => `${row.name} ${row.wbLogin}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a, b) => {
    const value = (row: Agent) => sort === "name" ? row.name : columns.find((column) => column.key === sort)?.value(row);
    return compareSpaceValues(value(a), value(b), direction) || a.name.localeCompare(b.name, "pt-BR");
  });
  return <div className="space-y-3 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-bold">Agentes de {data.supervisor}</h4>
      <label className="text-xs text-muted">Buscar agente<input className="premium-control ml-2 p-2 text-sm" placeholder="Nome ou WB" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
    <p className="text-xs text-muted">{data.period.startDate.split("-").reverse().join("/")} a {data.period.endDate.split("-").reverse().join("/")} · {data.agents.length} agente(s)</p>
    {data.workWarnings.length ? <div role="status" className="rounded-lg border border-amber-300 p-3 text-sm">{data.workWarnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}
    <div className="overflow-x-auto"><table className={`${tableClass} min-w-[1300px] [&_th:first-child]:sticky [&_th:first-child]:left-0 [&_th:first-child]:z-20 [&_th:first-child]:bg-slate-50 [&_td:first-child]:sticky [&_td:first-child]:left-0 [&_td:first-child]:z-10 [&_td:first-child]:bg-white`}><thead><tr>
      <SpaceSortHeader column="name" label="Agente / WB" sort={sort} direction={direction} onSort={onSort} /><th>LOB / skill</th>
      {columns.map((column) => <SpaceSortHeader key={column.key} column={column.key} label={column.label} sort={sort} direction={direction} onSort={onSort} />)}
    </tr></thead><tbody>{agents.map((row) => <tr key={row.id}><td className="font-bold">{row.name}<p className="text-xs font-normal text-muted">{row.wbLogin}</p></td><td>{row.lob}<p className="text-xs text-muted">{row.skill}</p></td>
      {columns.map((column) => <td key={column.key}>{column.key === "overtime"
        ? row.work.officialOvertimeHours == null ? "Sem dados" : formatMinutesToHHMM(row.work.officialOvertimeHours * 60)
        : number(column.value(row), column.key === "productivity" ? row.lob === "CEC" ? " CPD" : " s" : column.suffix)}
        {column.key === "adherence" ? <p className="text-xs text-muted">{row.work.recordedDays}/{row.work.expectedDays} dias com horas</p> : null}
        {column.key === "late" ? <p className="text-xs text-muted">{row.work.lateEntries}/{row.work.observedEntries} entradas observadas</p> : null}
        {column.key === "early" ? <p className="text-xs text-muted">{row.work.earlyExits}/{row.work.observedExits} saídas observadas</p> : null}
        {column.key === "mood" ? <p className="text-xs text-muted">{row.moodResponses} resposta(s)</p> : null}
      </td>)}
    </tr>)}</tbody></table>{!agents.length ? <p className="p-6 text-center text-muted">Nenhum agente encontrado.</p> : null}</div>
  </div>;
}

export function PerformanceSupervisorAgents({ supervisorId, period }: { supervisorId: string; period: { startDate: string; endDate: string } }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => { container.current?.scrollIntoView({ block: "nearest" }); }, []);
  const query = new URLSearchParams({ ...period, supervisorId });
  const read = useSpaceRead<Payload>(`/api/performance/supervisors?${query}`);
  if (read.error) return <div ref={container} role="alert" className="p-4 text-red-700">{read.error} <button type="button" onClick={read.retry} className="font-bold underline">Tentar novamente</button></div>;
  if (read.loading || !read.data) return <div ref={container} role="status" className="p-4 text-muted">Carregando agentes e indicadores do time…</div>;
  return <div ref={container}><SupervisorAgentsTable data={read.data} /></div>;
}
