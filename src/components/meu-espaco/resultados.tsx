"use client";

import { useState } from "react";
import type { SpaceMetric, SpaceResults } from "@/lib/meu-espaco-contract";
import { dateLabel, number, SpaceButtons, SpaceCard, tableClass } from "./shared";
import { formatLatencyDisplay } from "@/lib/latency-display";

export function TeamMetricCards({ data, compact = false }: { data: SpaceResults; compact?: boolean }) {
  if (!data.groups.length) return <div className="card p-6 text-muted">Nenhum parceiro no time atual para este filtro.</div>;
  return <div className="space-y-6">{data.groups.map((group) => <section key={group.lob} aria-label={`Indicadores ${group.lob}`}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-extrabold text-navy-950">{group.lob} <span className="text-xs font-medium text-muted">· {group.teamSize} parceiros no cadastro atual</span></h3><span className="text-xs text-muted">{dateLabel(data.period.startDate)} a {dateLabel(data.period.endDate)}</span></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <SpaceCard title="Qualidade" tone="teal" value={number(group.metric.quality, "%")} helper={`${group.metric.qualitySamples} avaliações · ponderada pela base avaliada`} />
      <SpaceCard title={group.lob === "CEC" ? "CPD médio da operação" : group.lob === "TNS" ? "AHT · vídeo 15 min" : "AHT"} value={group.lob === "CEC" ? number(group.metric.cpd) : number(group.metric.ahtSeconds, " s")} helper={group.lob === "CEC" ? "Tickets / dias-parceiro com produção positiva" : "Duração total / submits das filas elegíveis"} />
      <SpaceCard title="ABS do time" tone="amber" value={number(group.metric.abs, "%")} helper={`${group.metric.absences} faltas / ${group.metric.planned} dias escalados`} />
      {group.lob !== "CEC" ? <SpaceCard title={group.lob === "TNS" ? "Latência · vídeo 15 min" : "Latência média · horas"} value={formatLatencyDisplay(group.metric.latencyMinutes, group.lob)} helper={`Latência ponderada por ${group.metric.latencySubmits} submits com base válida`} /> : null}
      {group.lob === "CEC" ? <><SpaceCard title="SLA/FRT · Normal" value={number(group.metric.cecFrt?.normalSla ?? null, "%")} helper={`${group.metric.cecFrt?.normalTotal ?? 0} primeiras respostas >0 · prazo 24h · criação do ticket`} /><SpaceCard title="SLA/FRT · P0 + HM" value={number(group.metric.cecFrt?.urgentSla ?? null, "%")} helper={`${group.metric.cecFrt?.urgentTotal ?? 0} primeiras respostas >0 · prazo 4h · criação do ticket`} /></> : null}
      {group.lob === "TNS" ? <SpaceCard title="Latência · Comments · horas" value={formatLatencyDisplay(group.metric.commentsLatencyMinutes, "COMMENTS")} helper={`${group.metric.commentsLatencySubmits} submits · separada das filas de vídeo`} /> : null}
      {!compact && group.lob !== "CEC" ? <SpaceCard title="Média diária por parceiro" value={number(group.metric.dailyIndividual)} helper={`Submits / ${group.metric.agentDays} dias-parceiro com base`} /> : null}
    </div>
    <div className="mt-3 rounded-xl border border-border p-3 text-xs leading-6 text-muted">
      <p>Cobertura: produção {group.coverage.productionPartners}/{group.teamSize} parceiros (até {dateLabel(group.coverage.productionLatest)}); qualidade {group.coverage.qualityPartners}/{group.teamSize} (até {dateLabel(group.coverage.qualityLatest)}); cronograma {group.coverage.schedulePartners}/{group.teamSize} (até {dateLabel(group.coverage.scheduleLatest)}).</p>
      {group.lob === "CEC" ? <p>SLA/FRT: {group.coverage.frtPartners ?? 0}/{group.teamSize} parceiros (criação de tickets até {dateLabel(group.coverage.frtLatest ?? null)}). CPD continua pela data da produção.</p> : null}
      <p>Última atualização encontrada nas bases: {group.coverage.updatedAt ? new Date(group.coverage.updatedAt).toLocaleString("pt-BR") : "Sem dados"}.</p>
    </div>
  </section>)}</div>;
}

function MetricCells({ metric, lob }: { metric: SpaceMetric; lob: string }) {
  const cec = lob === "CEC";
  return <>{!cec ? <td>{number(metric.dailyIndividual)}</td> : null}<td>{cec ? number(metric.cpd) : number(metric.ahtSeconds, " s")}</td><td>{cec ? number(metric.cecFrt?.normalSla ?? null, "%") : formatLatencyDisplay(metric.latencyMinutes, lob)}</td><td>{cec ? number(metric.cecFrt?.urgentSla ?? null, "%") : formatLatencyDisplay(metric.commentsLatencyMinutes, "COMMENTS")}</td><td>{number(metric.quality, "%")}</td><td>{number(metric.abs, "%")}</td></>;
}

function MetricHeaders({ lob }: { lob: string }) {
  return <>{lob !== "CEC" ? <th>Média diária individual</th> : null}<th>{lob === "CEC" ? "CPD" : "AHT"}</th><th>{lob === "CEC" ? "SLA/FRT Normal" : lob === "ADS" ? "Latência (h)" : "Latência vídeo (min)"}</th><th>{lob === "CEC" ? "SLA/FRT P0 + HM" : "Latência Comments (h)"}</th><th>Qualidade</th><th>ABS</th></>;
}

export function SupervisorLatency({ groups }: { groups: SpaceResults["supervisors"][number]["groups"] }) {
  const applicable = groups.filter((group) => ["ADS", "TNS", "CEC"].includes(group.lob));
  if (!applicable.length) return <span className="text-xs text-muted">Não se aplica</span>;
  return <div className="space-y-1 text-xs">{applicable.map(({ lob, metric }) => lob === "CEC" ? <div key={lob}><p>SLA Normal: <strong>{number(metric.cecFrt?.normalSla ?? null, "%")}</strong></p><p>SLA P0 + HM: <strong>{number(metric.cecFrt?.urgentSla ?? null, "%")}</strong></p></div> : <div key={lob}><p><span className="text-muted">{lob === "TNS" ? "Vídeo · 15 min" : "ADS"}: </span><strong>{formatLatencyDisplay(metric.latencyMinutes, lob)}</strong></p>{lob === "TNS" ? <p><span className="text-muted">Comments: </span><strong>{formatLatencyDisplay(metric.commentsLatencyMinutes, "COMMENTS")}</strong></p> : null}</div>)}</div>;
}

export function SpaceResultsTab({ data }: { data: SpaceResults }) {
  const [search, setSearch] = useState("");
  const [selectedLob, setSelectedLob] = useState("");
  const lob = data.groups.some((group) => group.lob === selectedLob) ? selectedLob : "";
  const visibleData = { ...data, groups: data.groups.filter((group) => !lob || group.lob === lob) };
  const partners = data.partners.filter((row) => (!lob || row.lob === lob) && `${row.name} ${row.wbLogin}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div className="space-y-6">
    <p className="rounded-xl border border-border p-3 text-sm text-muted">Time pelo cadastro atual, sem desligados. ADS e Comments: latência ponderada em horas; vídeo TNS de 15 minutos: em minutos. CEC: CPD médio e SLA/FRT percentual por criação do ticket, separado em Normal (24h) e P0 + HM (4h).</p>
    <SpaceButtons label="Operação dos resultados" value={lob} onChange={setSelectedLob} options={[{ id: "", label: "Todas as operações" }, ...data.groups.map((group) => ({ id: group.lob, label: group.lob }))]} />
    <TeamMetricCards data={visibleData} />
    <section className="card overflow-hidden" aria-label="Latência e SLA por supervisor"><div className="p-4"><h3 className="font-extrabold">Latência e SLA por supervisor</h3><p className="mt-1 text-xs text-muted">Mesmo período e operação selecionados · composição atual do time</p></div><div className="overflow-x-auto"><table className={tableClass}><thead><tr><th>Supervisor</th><th>Latência ponderada / SLA CEC</th></tr></thead><tbody>{data.supervisors.filter((row) => row.groups.some((group) => !lob || group.lob === lob)).map((row) => <tr key={row.id}><td className="font-bold">{row.name}</td><td><SupervisorLatency groups={row.groups.filter((group) => !lob || group.lob === lob)} /></td></tr>)}</tbody></table></div></section>
    <section className="card overflow-hidden" aria-label="Resultados por parceiro"><div className="flex flex-wrap items-center justify-between gap-3 p-4"><h3 className="font-extrabold">Resultado por parceiro</h3><label className="text-xs text-muted">Buscar parceiro<input className="premium-control ml-2 p-2 text-sm" placeholder="Nome ou WB" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
      {visibleData.groups.map((group) => <div key={group.lob} className="overflow-x-auto"><h4 className="px-4 py-2 text-sm font-bold">{group.lob}</h4><table className={tableClass}><thead><tr><th>Parceiro / WB</th><th>Skill principal</th><MetricHeaders lob={group.lob} /></tr></thead><tbody>{partners.filter((row) => row.lob === group.lob).map((row) => <tr key={row.id}><td><p className="font-bold">{row.name}</p><p className="text-xs text-muted">{row.wbLogin}</p></td><td>{row.skill}</td><MetricCells metric={row.metric} lob={row.lob} /></tr>)}</tbody></table></div>)}
      {!partners.length ? <p className="p-6 text-center text-muted">Nenhum parceiro encontrado.</p> : null}
    </section>
    {visibleData.groups.map((group) => <section key={group.lob} className="card overflow-hidden" aria-label={`Evolução diária ${group.lob}`}>
      <div className="p-4"><h3 className="font-extrabold">Evolução diária · {group.lob}</h3><p className="mt-1 text-xs text-muted">Cada linha corresponde à data da base. {group.lob === "ADS" ? "Submit total soma a produção do time nessa data. " : ""}Datas sem registros não são convertidas em zero.</p></div>
      <div className="overflow-x-auto"><table className={tableClass}><thead><tr><th>Data</th>{group.lob === "ADS" ? <th>Submit total</th> : null}<MetricHeaders lob={group.lob} /></tr></thead><tbody>{group.daily.map((row) => <tr key={row.date}><td>{dateLabel(row.date)}</td>{group.lob === "ADS" ? <td>{number(row.metric.production)}</td> : null}<MetricCells metric={row.metric} lob={group.lob} /></tr>)}</tbody></table></div>
      {!group.daily.length ? <p className="p-6 text-center text-muted">Sem dados no período.</p> : null}
    </section>)}
  </div>;
}
