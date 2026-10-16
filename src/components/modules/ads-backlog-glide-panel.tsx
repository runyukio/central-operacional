"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Clock3, Loader2, RefreshCw } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dateLabel, number, SpaceButtons } from "@/components/meu-espaco/shared";
import styles from "@/components/meu-espaco/space.module.css";
import glideStyles from "./ads-backlog-glide.module.css";
import { glideClearanceLabel, glideClock, glideIsStale, glideTimestamp } from "./ads-backlog-glide-display";
import { useAdsBacklogGlide } from "./use-ads-backlog-glide";

export function AdsBacklogGlidePanel() {
  const [horizonDays, setHorizonDays] = useState<7 | 14>(14);
  const read = useAdsBacklogGlide(horizonDays);
  return <AdsBacklogGlideView horizonDays={horizonDays} onHorizonChange={setHorizonDays} read={read} />;
}

/** Presentation can be rendered independently with a read-only fixture for visual checks. */
export function AdsBacklogGlideView({ horizonDays, onHorizonChange, read }: { horizonDays: 7 | 14; onHorizonChange: (days: 7 | 14) => void; read: ReturnType<typeof useAdsBacklogGlide> }) {
  const [selectedDay, setSelectedDay] = useState("");
  const data = read.data;
  const stale = data ? glideIsStale(data, read.elapsedMs) : false;
  const days = useMemo(() => [...new Set(data?.points.map(point => point.dateKey) ?? [])], [data]);
  const day = days.includes(selectedDay) ? selectedDay : days[0] ?? "";
  const points = data?.points.filter(point => point.dateKey === day) ?? [];
  const chart = useMemo(() => {
    if (!data) return [];
    const at = glideTimestamp(data.snapshotCycle);
    return [...(at !== null ? [{ timestamp: at, backlog: data.currentBacklog }] : []), ...data.points.map(point => ({ timestamp: point.timestamp, backlog: point.backlog }))];
  }, [data]);
  const eta = data ? glideClearanceLabel(data, read.elapsedMs, Boolean(read.error)) : "Sem dados";
  const status = !data ? "Aguardando dados" : read.error ? "Atualização pendente" : stale ? "Fonte desatualizada" : data.state === "incomplete" ? "Dados incompletos" : data.state === "no-clearance" ? "Sem zeragem prevista" : "Projeção disponível";

  return <section aria-label="Glide path do backlog ADS" className={`${styles.panel} space-y-4`}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h3 className="font-extrabold">Quando o backlog de ADS limpa?</h3><p className="mt-1 max-w-3xl text-xs text-muted">Projeção do backlog atual com o cronograma, a produtividade por agente, o forecast de entradas e ABS. Considera todo ADS a partir do ciclo atual, independentemente dos filtros de período e turno abaixo.</p></div>
      <span className={styles.statusBadge} data-status={data && !stale && !read.error && data.state === "projected" ? "met" : "missing"} aria-live="polite">{status}</span>
    </div>
    <div className="flex flex-wrap items-end justify-between gap-3">
      <SpaceButtons label="Horizonte do glide path" value={String(horizonDays)} onChange={value => { onHorizonChange(value === "7" ? 7 : 14); setSelectedDay(""); }} options={[{ id: "7", label: "7 dias" }, { id: "14", label: "14 dias" }]} />
      <div className="flex flex-wrap items-center gap-3"><span className="flex items-center gap-1.5 text-xs text-muted"><Clock3 aria-hidden className="h-3.5 w-3.5" />Atualiza a cada 1h e ao voltar à aba</span><button type="button" className={styles.chip} onClick={read.recalculate} disabled={read.loading}><RefreshCw aria-hidden className={`h-4 w-4 ${read.loading ? "animate-spin" : ""}`} />Recalcular</button></div>
    </div>
    {read.error ? <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{read.error} {data ? "A última consulta continua disponível para referência. A previsão de zeragem foi suspensa até atualizar." : ""}<button className="ml-2 font-bold underline" onClick={read.recalculate} type="button">Tentar novamente</button></div> : null}
    {read.loading ? <p role="status" className="flex items-center gap-2 text-xs text-muted"><Loader2 aria-hidden className="h-4 w-4 animate-spin" />{data ? "Atualizando projeção…" : "Carregando backlog e capacidade…"}</p> : null}
    {data ? <>
      <div className={glideStyles.metrics}>
        <div><span className={glideStyles.metricLabel}>Backlog no ciclo</span><strong className={glideStyles.metricValue}>{number(data.currentBacklog)}</strong><span className="mt-1 block text-xs text-muted">Ciclo {glideClock(data.snapshotCycle)} · Brasil</span></div>
        <div><span className={glideStyles.metricLabel}>Primeira zeragem projetada</span><strong className={`${glideStyles.metricValue} ${glideStyles.eta}`}>{eta}</strong><span className="mt-1 block text-xs text-muted">{data.reaccumulates && !stale && !read.error && data.state === "projected" ? "Volta a acumular após a primeira zeragem." : "Estimativa consolidada de ADS, sujeita à evolução das entradas."}</span></div>
        <div><span className={glideStyles.metricLabel}>ABS previsto</span><strong className={glideStyles.metricValue}>{number(data.absRate * 100, "%")}</strong><span className="mt-1 block text-xs text-muted">Aplicado à presença ainda não confirmada; faltas já registradas não são descontadas duas vezes.</span></div>
      </div>
      {stale ? <p role="alert" className={glideStyles.warning}><AlertTriangle aria-hidden className="h-4 w-4 shrink-0" />O ciclo ou a importação tem mais de 90 minutos. A curva mantém a referência do último ciclo; a data de zeragem fica suspensa até receber dados atuais.</p> : null}
      <p className={glideStyles.assumption}><AlertTriangle aria-hidden className="h-4 w-4 shrink-0" />A capacidade consolidada pressupõe redistribuição de trabalho entre as filas de ADS. A zeragem projetada não garante limpeza de cada fila ou cumprimento do SLA.</p>
      {chart.length ? <div className="h-64 w-full" role="img" aria-label={`Backlog consolidado de ADS projetado hora a hora para ${horizonDays} dias. Valores por intervalo na tabela abaixo.`}>
        <ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{ left: 0, right: 12, top: 8, bottom: 5 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} tickCount={7} minTickGap={24} tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={(at: number) => glideClock(at).slice(0, 5)} />
          <YAxis domain={[0, "auto"]} tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={(value: number) => value.toLocaleString("pt-BR", { notation: "compact" })} />
          <Tooltip labelFormatter={(at: number) => `${glideClock(at)} · Brasil`} formatter={(value: number) => [number(value), "Backlog projetado"]} contentStyle={{ background: "var(--surface-raised, #fff)", border: "1px solid var(--border)", borderRadius: 10, color: "var(--ink)" }} />
          <Line dataKey="backlog" name="Backlog projetado" stroke="#2563eb" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
        </LineChart></ResponsiveContainer>
      </div> : <p className="py-4 text-sm text-muted">Sem intervalos completos para desenhar a projeção.</p>}
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="text-sm font-bold">Projeção hora a hora</h4><p className="mt-1 text-xs text-muted">Backlog ao fim do intervalo · capacidade e forecast proporcionais quando a primeira hora é parcial.</p></div>{days.length ? <label className="flex items-center gap-2 text-xs font-bold text-muted">Dia da projeção<select aria-label="Dia da projeção do backlog" className="h-10 rounded-lg border border-border bg-transparent px-3 text-sm text-[var(--ink)]" value={day} onChange={event => setSelectedDay(event.target.value)}>{days.map(value => <option key={value} value={value}>{dateLabel(value)}</option>)}</select></label> : null}</div>
      <div className={glideStyles.tableViewport}><table className={`${styles.table} ${glideStyles.hourTable}`} aria-label={`Glide path horário de ADS em ${dateLabel(day)}`}><thead><tr>{["Intervalo BR", "Forecast", "Agentes", "Prod. média/h", "Horas efetivas", "Capacidade", "ABS", "Backlog final"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>
        {points.map(point => <tr key={point.timestamp}><td data-label="Intervalo BR"><strong>{glideClock(point.intervalStart, false)}–{glideClock(point.timestamp, false)}</strong></td><td data-label="Forecast">{number(point.forecast)}</td><td data-label="Agentes">{number(point.scheduledAgents)}{point.missingAgents ? <small className="mt-1 block text-amber-700 dark:text-amber-300">{number(point.missingAgents)} sem referência</small> : null}</td><td data-label="Prod. média/h">{number(point.averageProductivity)}</td><td data-label="Horas efetivas">{number(point.effectiveAgentHours)}</td><td data-label="Capacidade">{number(point.capacity)}</td><td data-label="ABS">{number(data.absRate * 100, "%")}</td><td data-label="Backlog final" className="font-bold">{number(point.backlog)}</td></tr>)}
        {!points.length ? <tr><td colSpan={8}>Sem intervalos disponíveis.</td></tr> : null}
      </tbody></table></div>
      <details className="text-xs text-muted"><summary className="cursor-pointer font-bold">Premissas e atualização das fontes</summary><div className="mt-3 space-y-2 leading-relaxed"><p>Produtividade: submits por hora de cronograma nas duas semanas completas de {dateLabel(data.historyPeriod.startDate)} a {dateLabel(data.historyPeriod.endDate)}. Usa a referência individual com pelo menos 3 turnos válidos e, quando necessário, a média da skill. Sem um novo desconto de pausas ou fator de escala 1,29.</p><p>Entradas: forecast unificado de ADS, sem alteração da previsão da Central. Entradas repetidas legítimas continuam compondo a demanda. Dados ausentes permanecem “Sem dados”.</p><p>Calculado em {new Date(data.calculatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · Importação do backlog: {data.sources.snapshotImportedAt ? new Date(data.sources.snapshotImportedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "Sem dados"}.</p>{data.warnings.length ? <ul className="list-disc space-y-1 pl-4">{[...new Set(data.warnings)].map(warning => <li key={warning}>{warning}</li>)}</ul> : null}</div></details>
    </> : !read.loading && !read.error ? <p className="py-4 text-sm text-muted">Nenhuma projeção disponível.</p> : null}
  </section>;
}
