"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { compareSpaceValues } from "@/lib/meu-espaco-order";
import { SpaceSortHeader } from "./sort-header";
import { SpaceTargetCard, SpaceTargetInline } from "./target-card";
const SpaceGlideTab = dynamic(() => import("./glide-path").then((m) => m.SpaceGlideTab), { ssr: false, loading: () => <p className="p-5 text-muted">Carregando Glide path…</p> });
import type { SpaceMetric, SpaceResults } from "@/lib/meu-espaco-contract";
import { dateLabel, number, SpaceButtons, SpaceCard, tableClass } from "./shared";
import { formatLatencyDisplay } from "@/lib/latency-display";
import { PerformanceUrBadge } from "@/components/performance-ur-badge";

export function TeamMetricCards({ data, compact = false }: { data: SpaceResults; compact?: boolean }) {
  if (!data.groups.length) return <div className="card p-6 text-muted">Nenhum parceiro no time atual para este filtro.</div>;
  return <div className="space-y-6">{data.groups.map((group) => <section key={group.lob} aria-label={`Indicadores ${group.lob}`}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-extrabold text-navy-950">{group.lob} <span className="text-xs font-medium text-muted">· {group.teamSize} parceiros no cadastro atual</span></h3><span className="text-xs text-muted">{dateLabel(data.period.startDate)} a {dateLabel(data.period.endDate)}</span></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {group.metric.targets?.map((kpi) => <SpaceTargetCard key={kpi.id} kpi={kpi} />)}
      {!compact && group.lob !== "CEC" ? <SpaceCard title="Média diária por parceiro · todas as skills" value={number(group.metric.dailyIndividual)} helper={`Submits / ${group.metric.agentDays} dias-parceiro com base. A meta de 300 é exclusiva de Material Queues.`} /> : null}
    </div>
    <details className="mt-3 rounded-xl border border-border p-3 text-xs leading-6 text-muted"><summary className="cursor-pointer font-bold">Cobertura e atualização das bases</summary>
      <p>Cobertura: produção {group.coverage.productionPartners}/{group.teamSize} parceiros (até {dateLabel(group.coverage.productionLatest)}); qualidade {group.coverage.qualityPartners}/{group.teamSize} (até {dateLabel(group.coverage.qualityLatest)}); cronograma {group.coverage.schedulePartners}/{group.teamSize} (até {dateLabel(group.coverage.scheduleLatest)}).</p>
      <p>UR: {group.coverage.urPartners ?? 0}/{group.teamSize} parceiros (até {dateLabel(group.coverage.urLatest ?? null)}). Moderação real ÷ (8h × dias-agente na base), pelo Brazil Shift Date. Sem base não é zero.</p>
      {group.lob === "CEC" ? <p>SLA/FRT: {group.coverage.frtPartners ?? 0}/{group.teamSize} parceiros (criação de tickets até {dateLabel(group.coverage.frtLatest ?? null)}). CPD continua pela data da produção.</p> : null}
      <p>Última atualização encontrada nas bases: {group.coverage.updatedAt ? new Date(group.coverage.updatedAt).toLocaleString("pt-BR") : "Sem dados"}.</p>
    </details>
  </section>)}</div>;
}

type MetricColumn = { key: string; label: string; value: (metric: SpaceMetric) => number | null; suffix?: string; latencyLob?: string };
function metricColumns(lob: string, individual = false): MetricColumn[] {
  const cols: MetricColumn[] = lob === "CEC"
    ? [{ key: "cpd", label: "CPD", value: (m) => m.cpd }, { key: "normalFrt", label: "SLA/FRT Normal", value: (m) => m.cecFrt?.normalSla ?? null, suffix: "%" }, { key: "urgentFrt", label: "SLA/FRT P0 + HM", value: (m) => m.cecFrt?.urgentSla ?? null, suffix: "%" }]
    : [{ key: "dailyIndividual", label: "Média diária individual", value: (m) => m.dailyIndividual }, { key: "ahtSeconds", label: "AHT", value: (m) => m.ahtSeconds, suffix: " s" },
      ...(!individual && ["ADS", "TNS"].includes(lob) ? [{ key: "latencyMinutes", label: lob === "ADS" ? "Latência (h)" : "Latência vídeo (min)", value: (m: SpaceMetric) => m.latencyMinutes, latencyLob: lob }] : []),
      ...(!individual && lob === "TNS" ? [{ key: "commentsLatencyMinutes", label: "Latência Comments (h)", value: (m: SpaceMetric) => m.commentsLatencyMinutes, latencyLob: "COMMENTS" }] : [])];
  return [...cols, { key: "quality", label: "Qualidade", value: (m) => m.quality, suffix: "%" }, { key: "abs", label: "ABS", value: (m) => m.abs, suffix: "%" }, { key: "ur", label: "UR", value: (m) => m.ur ?? null, suffix: "%" }];
}
function MetricCells({ metric, lob, individual = false }: { metric: SpaceMetric; lob: string; individual?: boolean }) {
  return <>{metricColumns(lob, individual).map((col) => {
    const id = col.key === "dailyIndividual" ? "materialDaily" : col.key === "ahtSeconds" ? "aht" : col.key;
    const target = individual ? metric.targets?.find((kpi) => kpi.id === id) : undefined;
    return <td key={col.key}>{col.latencyLob ? formatLatencyDisplay(col.value(metric), col.latencyLob) : number(col.value(metric), col.suffix)}{target ? <SpaceTargetInline kpi={target} /> : null}</td>;
  })}</>;
}
function MetricHeaders({ lob, individual = false, sort, direction = "asc", onSort }: { lob: string; individual?: boolean; sort?: string; direction?: "asc" | "desc"; onSort?: (key: string) => void }) {
  return <>{metricColumns(lob, individual).map((col) => onSort ? <SpaceSortHeader key={col.key} column={col.key} label={col.label} sort={sort || ""} direction={direction} onSort={onSort} /> : <th key={col.key}>{col.label}</th>)}</>;
}

export function SupervisorLatency({ groups }: { groups: SpaceResults["supervisors"][number]["groups"] }) {
  const applicable = groups.filter((group) => ["ADS", "TNS", "CEC"].includes(group.lob));
  if (!applicable.length) return <span className="text-xs text-muted">Não se aplica</span>;
  return <div className="space-y-1 text-xs">{applicable.map(({ lob, metric }) => lob === "CEC" ? <div key={lob}><p>SLA Normal: <strong>{number(metric.cecFrt?.normalSla ?? null, "%")}</strong></p><p>SLA P0 + HM: <strong>{number(metric.cecFrt?.urgentSla ?? null, "%")}</strong></p></div> : <div key={lob}><p><span className="text-muted">{lob === "TNS" ? "Vídeo · 15 min" : "ADS"}: </span><strong>{formatLatencyDisplay(metric.latencyMinutes, lob)}</strong></p>{lob === "TNS" ? <p><span className="text-muted">Comments: </span><strong>{formatLatencyDisplay(metric.commentsLatencyMinutes, "COMMENTS")}</strong></p> : null}</div>)}</div>;
}

export function SpaceResultsTab({ data, supervisorId = "", view = "dashboard", onViewChange }: { data: SpaceResults; supervisorId?: string; view?: string; onViewChange?: (view: string) => void }) {
  const [employeeId, setEmployeeId] = useState("");
  function changeView(next: string) { onViewChange?.(next); }
  const [sort, setSort] = useState("name"), [direction, setDirection] = useState<"asc" | "desc">("asc");
  function onSort(key: string) { setDirection(sort === key && direction === "asc" ? "desc" : "asc"); setSort(key); }
  const [search, setSearch] = useState("");
  const [selectedLob, setSelectedLob] = useState("");
  const lob = data.groups.some((group) => group.lob === selectedLob) ? selectedLob : "";
  const visibleData = { ...data, groups: data.groups.filter((group) => !lob || group.lob === lob) };
  const partners = data.partners.filter((row) => (!lob || row.lob === lob) && `${row.name} ${row.wbLogin}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const sortedPartners = [...partners].sort((a, b) => {
    const value = (row: typeof a) => sort === "name" ? row.name : sort === "skill" ? row.skill : metricColumns(row.lob, true).find((col) => col.key === sort)?.value(row.metric);
    return compareSpaceValues(value(a), value(b), direction) || a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id);
  });
  const navigation = <SpaceButtons label="Visão dos resultados" value={view} onChange={changeView} options={[{ id: "dashboard", label: "Dashboard" }, { id: "glide", label: "Glide path" }]} />;
  if (view === "glide") return <div className="space-y-4">{navigation}<SpaceGlideTab key={supervisorId} supervisorId={supervisorId} lobs={data.groups.map((g) => g.lob).filter((lob) => ["ADS", "TNS", "CEC"].includes(lob))} partners={data.partners} employeeId={employeeId} onEmployeeChange={setEmployeeId} teamLabel={data.supervisors.length === 1 ? `Time de ${data.supervisors[0].name}` : "Todos os times selecionados"} /></div>;
  return <div className="space-y-6">
    {navigation}
    <SpaceButtons label="Operação dos resultados" value={lob} onChange={setSelectedLob} options={[{ id: "", label: "Todas as operações" }, ...data.groups.map((group) => ({ id: group.lob, label: group.lob }))]} />
    <TeamMetricCards data={visibleData} />
    <section className="card overflow-hidden" aria-label="Indicadores por supervisor"><div className="p-4"><h3 className="font-extrabold">Indicadores por supervisor</h3><p className="mt-1 text-xs text-muted">Mesmo período e operação selecionados · composição atual do time</p></div><div className="overflow-x-auto"><table className={tableClass}><thead><tr><th>Supervisor</th><th>Latência ponderada</th><th>UR · meta 60%</th></tr></thead><tbody>{data.supervisors.filter((row) => row.groups.some((group) => !lob || group.lob === lob)).map((row) => <tr key={row.id}><td className="font-bold">{row.name}</td><td><SupervisorLatency groups={row.groups.filter((group) => !lob || group.lob === lob)} /></td><td>{row.groups.filter((group) => !lob || group.lob === lob).map((group) => <div key={group.lob} className="py-1"><span className="mr-2 text-xs text-muted">{group.lob}</span><PerformanceUrBadge value={group.metric.ur} /></div>)}</td></tr>)}</tbody></table></div></section>
    <section className="card overflow-hidden" aria-label="Resultados por parceiro"><div className="flex flex-wrap items-center justify-between gap-3 p-4"><h3 className="font-extrabold">Resultado por parceiro</h3><label className="text-xs text-muted">Buscar parceiro<input className="premium-control ml-2 p-2 text-sm" placeholder="Nome ou WB" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
      {visibleData.groups.map((group) => <div key={group.lob} className="overflow-x-auto"><h4 className="px-4 py-2 text-sm font-bold">{group.lob}</h4><table className={tableClass}><thead><tr><SpaceSortHeader label="Parceiro / WB" column="name" sort={sort} direction={direction} onSort={onSort} /><SpaceSortHeader label="Skill principal" column="skill" sort={sort} direction={direction} onSort={onSort} /><MetricHeaders lob={group.lob} individual sort={sort} direction={direction} onSort={onSort} /></tr></thead><tbody>{sortedPartners.filter((row) => row.lob === group.lob).map((row) => <tr key={row.id}><td><button type="button" className="font-bold text-blue-600 hover:underline" title="Ver Glide path deste parceiro" onClick={() => { setEmployeeId(row.id); changeView("glide"); }}>{row.name}</button><p className="text-xs text-muted">{row.wbLogin}</p></td><td>{row.skill}</td><MetricCells metric={row.metric} lob={row.lob} individual /></tr>)}</tbody></table></div>)}
      {!partners.length ? <p className="p-6 text-center text-muted">Nenhum parceiro encontrado.</p> : null}
    </section>
    {visibleData.groups.map((group) => <section key={group.lob} className="card overflow-hidden" aria-label={`Evolução diária ${group.lob}`}>
      <div className="p-4"><h3 className="font-extrabold">Evolução diária · {group.lob}</h3><p className="mt-1 text-xs text-muted">Cada linha corresponde à data da base. {group.lob === "ADS" ? "Submit total soma a produção do time nessa data. " : ""}Datas sem registros não são convertidas em zero.</p></div>
      <div className="overflow-x-auto"><table className={tableClass}><thead><tr><th>Data</th>{group.lob === "ADS" ? <th>Submit total</th> : null}<MetricHeaders lob={group.lob} /></tr></thead><tbody>{group.daily.map((row) => <tr key={row.date}><td>{dateLabel(row.date)}</td>{group.lob === "ADS" ? <td>{number(row.metric.production)}</td> : null}<MetricCells metric={row.metric} lob={group.lob} /></tr>)}</tbody></table></div>
      {!group.daily.length ? <p className="p-6 text-center text-muted">Sem dados no período.</p> : null}
    </section>)}
  </div>;
}
