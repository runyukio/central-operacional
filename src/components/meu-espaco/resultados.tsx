"use client";

import { useState } from "react";
import type { SpaceMetric, SpaceResults } from "@/lib/meu-espaco-contract";
import { dateLabel, number, SpaceButtons, SpaceCard, tableClass } from "./shared";

export function TeamMetricCards({ data, compact = false }: { data: SpaceResults; compact?: boolean }) {
  if (!data.groups.length) return <div className="card p-6 text-muted">Nenhum parceiro no time atual para este filtro.</div>;
  return <div className="space-y-6">{data.groups.map((group) => <section key={group.lob} aria-label={`Indicadores ${group.lob}`}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-extrabold text-navy-950">{group.lob} <span className="text-xs font-medium text-muted">· {group.teamSize} parceiros no cadastro atual</span></h3><span className="text-xs text-muted">{dateLabel(data.period.startDate)} a {dateLabel(data.period.endDate)}</span></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <SpaceCard title="Qualidade" tone="teal" value={number(group.metric.quality, "%")} helper={`${group.metric.qualitySamples} avaliações · ponderada pela base avaliada`} />
      <SpaceCard title="Média diária do time" value={number(group.metric.dailyTeam)} helper={`${group.lob === "CEC" ? "Tickets" : "Submits"} por dia com base de produção · ${group.metric.productionDays} dias`} />
      <SpaceCard title="ABS do time" tone="amber" value={number(group.metric.abs, "%")} helper={`${group.metric.absences} faltas / ${group.metric.planned} dias escalados`} />
      {group.lob !== "CEC" ? <SpaceCard title={group.lob === "TNS" ? "Latência · vídeo 15 min" : "Latência média"} value={number(group.metric.latencyMinutes, " min")} helper={`Latência acumulada / ${group.metric.latencySubmits} submits com base válida`} /> : null}
      {group.lob === "TNS" ? <SpaceCard title="Latência · Comments" value={number(group.metric.commentsLatencyMinutes, " min")} helper={`${group.metric.commentsLatencySubmits} submits · separada das filas de vídeo`} /> : null}
      {!compact ? <><SpaceCard title="Produção total" value={number(group.metric.production)} helper={group.lob === "CEC" ? "Tickets no período" : "Submits no período"} /><SpaceCard title="Média diária por parceiro" value={number(group.metric.dailyIndividual)} helper={`Produção / ${group.metric.agentDays} dias-parceiro com base${group.lob === "CEC" ? " positiva" : ""}`} /><SpaceCard title={group.lob === "CEC" ? "CPD" : group.lob === "TNS" ? "AHT · filas de 15 min" : "AHT"} value={group.lob === "CEC" ? number(group.metric.cpd) : number(group.metric.ahtSeconds, " s")} helper={group.lob === "CEC" ? "Tickets por dia-parceiro com produção positiva" : "Duração total / submits das filas elegíveis"} /></> : null}
    </div>
    <div className="mt-3 rounded-xl border border-border p-3 text-xs leading-6 text-muted">
      <p>Cobertura: produção {group.coverage.productionPartners}/{group.teamSize} parceiros (até {dateLabel(group.coverage.productionLatest)}); qualidade {group.coverage.qualityPartners}/{group.teamSize} (até {dateLabel(group.coverage.qualityLatest)}); cronograma {group.coverage.schedulePartners}/{group.teamSize} (até {dateLabel(group.coverage.scheduleLatest)}).</p>
      <p>Última atualização encontrada nas bases: {group.coverage.updatedAt ? new Date(group.coverage.updatedAt).toLocaleString("pt-BR") : "Sem dados"}.</p>
    </div>
  </section>)}</div>;
}

function MetricCells({ metric, cec }: { metric: SpaceMetric; cec: boolean }) {
  return <><td>{number(metric.production)}</td><td>{number(metric.dailyIndividual)}</td><td>{cec ? number(metric.cpd) : number(metric.ahtSeconds, " s")}</td><td>{cec ? "Não se aplica" : number(metric.latencyMinutes, " min")}</td><td>{cec ? "Não se aplica" : number(metric.commentsLatencyMinutes, " min")}</td><td>{number(metric.quality, "%")}</td><td>{number(metric.abs, "%")}</td></>;
}

export function SupervisorLatency({ groups }: { groups: SpaceResults["supervisors"][number]["groups"] }) {
  const applicable = groups.filter((group) => ["ADS", "TNS"].includes(group.lob));
  if (!applicable.length) return <span className="text-xs text-muted">Não se aplica</span>;
  return <div className="space-y-1 text-xs">{applicable.map(({ lob, metric }) => <div key={lob}><p><span className="text-muted">{lob === "TNS" ? "Vídeo · 15 min" : "ADS"}: </span><strong>{number(metric.latencyMinutes, " min")}</strong></p>{lob === "TNS" ? <p><span className="text-muted">Comments: </span><strong>{number(metric.commentsLatencyMinutes, " min")}</strong></p> : null}</div>)}</div>;
}

export function SpaceResultsTab({ data }: { data: SpaceResults }) {
  const [search, setSearch] = useState("");
  const [selectedLob, setSelectedLob] = useState("");
  const lob = data.groups.some((group) => group.lob === selectedLob) ? selectedLob : "";
  const visibleData = { ...data, groups: data.groups.filter((group) => !lob || group.lob === lob) };
  const partners = data.partners.filter((row) => (!lob || row.lob === lob) && `${row.name} ${row.wbLogin}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div className="space-y-6">
    <p className="rounded-xl border border-border p-3 text-sm text-muted">Composição do time pelo cadastro atual, inclusive ao consultar meses anteriores. Latência ponderada pelos submits com informação válida, não pela média simples dos parceiros. ADS, vídeo TNS de 15 minutos e Comments são apresentados separadamente; CEC não utiliza esta métrica.</p>
    <SpaceButtons label="Operação dos resultados" value={lob} onChange={setSelectedLob} options={[{ id: "", label: "Todas as operações" }, ...data.groups.map((group) => ({ id: group.lob, label: group.lob }))]} />
    <TeamMetricCards data={visibleData} />
    <section className="card overflow-hidden" aria-label="Latência por supervisor"><div className="p-4"><h3 className="font-extrabold">Latência por supervisor</h3><p className="mt-1 text-xs text-muted">Mesmo período e operação selecionados · composição atual do time</p></div><div className="overflow-x-auto"><table className={tableClass}><thead><tr><th>Supervisor</th><th>Latência média ponderada</th></tr></thead><tbody>{data.supervisors.filter((row) => row.groups.some((group) => !lob || group.lob === lob)).map((row) => <tr key={row.id}><td className="font-bold">{row.name}</td><td><SupervisorLatency groups={row.groups.filter((group) => !lob || group.lob === lob)} /></td></tr>)}</tbody></table></div></section>
    <section className="card overflow-hidden" aria-label="Resultados por parceiro"><div className="flex flex-wrap items-center justify-between gap-3 p-4"><h3 className="font-extrabold">Resultado por parceiro</h3><label className="text-xs text-muted">Buscar parceiro<input className="premium-control ml-2 p-2 text-sm" placeholder="Nome ou WB" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
      <div className="overflow-x-auto"><table className={tableClass}><thead><tr><th>Parceiro / WB</th><th>Skill principal</th><th>Operação</th><th>Produção total</th><th>Média diária individual</th><th>AHT / CPD</th><th>Latência ADS / vídeo 15 min</th><th>Latência Comments</th><th>Qualidade</th><th>ABS</th></tr></thead><tbody>{partners.map((row) => <tr key={row.id}><td><p className="font-bold">{row.name}</p><p className="text-xs text-muted">{row.wbLogin}</p></td><td>{row.skill}</td><td>{row.lob}</td><MetricCells metric={row.metric} cec={row.lob === "CEC"} /></tr>)}</tbody></table></div>
      {!partners.length ? <p className="p-6 text-center text-muted">Nenhum parceiro encontrado.</p> : null}
    </section>
    {visibleData.groups.map((group) => <section key={group.lob} className="card overflow-hidden" aria-label={`Evolução diária ${group.lob}`}>
      <div className="p-4"><h3 className="font-extrabold">Evolução diária · {group.lob}</h3><p className="mt-1 text-xs text-muted">Cada linha corresponde à data da base. Datas sem registros não são convertidas em zero.</p></div>
      <div className="overflow-x-auto"><table className={tableClass}><thead><tr><th>Data</th><th>Produção do time</th><th>Média por parceiro</th><th>{group.lob === "CEC" ? "CPD" : group.lob === "TNS" ? "AHT · 15 min" : "AHT"}</th><th>Latência ADS / vídeo 15 min</th><th>Latência Comments</th><th>Qualidade</th><th>ABS</th></tr></thead><tbody>{group.daily.map((row) => <tr key={row.date}><td>{dateLabel(row.date)}</td><MetricCells metric={row.metric} cec={group.lob === "CEC"} /></tr>)}</tbody></table></div>
      {!group.daily.length ? <p className="p-6 text-center text-muted">Sem dados no período.</p> : null}
    </section>)}
  </div>;
}
