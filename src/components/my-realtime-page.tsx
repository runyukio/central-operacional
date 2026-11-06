"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCheck, Clock, MonitorCog, RefreshCw, RotateCw, Timer, Ticket } from "lucide-react";

import { PageHeader, Panel, StatCard } from "@/components/ui/primitives";
import type { MyRealtimePayload, PersonalSourceStatus } from "@/lib/my-realtime";
import { cn } from "@/lib/utils";

const number = new Intl.NumberFormat("pt-BR");
const dateTime = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const clock = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const dayLabel = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });

function aht(value: number | null | undefined) {
  return value === null || value === undefined ? "Sem dados" : `${(value / 1_000).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s`;
}

function duration(value: number | null | undefined) {
  if (value === null || value === undefined) return "Sem dados";
  const seconds = Math.floor(value / 1_000);
  return [Math.floor(seconds / 3_600), Math.floor(seconds / 60) % 60, seconds % 60].map((part) => String(part).padStart(2, "0")).join(":");
}

function count(value: number | null | undefined) {
  return value === null || value === undefined ? "Sem dados" : number.format(value);
}

function Status({ status }: { status: PersonalSourceStatus }) {
  return <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-600">
    {status === "complete" ? "Disponível" : status === "partial" ? "Parcial" : "Sem dados"}
  </span>;
}

export function MyRealtimePage() {
  const [payload, setPayload] = useState<MyRealtimePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);

  const load = useCallback(async (manual = false) => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    if (manual) setRefreshing(true);
    try {
      const response = await fetch("/api/realtime/me", { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok || body.success !== true) {
        if ([401, 403, 404].includes(response.status)) setPayload(null);
        throw new Error(body.message || "Não foi possível consultar seu Real Time.");
      }
      if (!mountedRef.current) return;
      setPayload(body as MyRealtimePayload);
      setError("");
    } catch (failure) {
      if (controller.signal.aborted || !mountedRef.current) return;
      setError(failure instanceof Error ? failure.message : "Não foi possível consultar seu Real Time.");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (mountedRef.current) { setLoading(false); setRefreshing(false); }
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    const refresh = () => { if (!document.hidden) void load(); };
    const timer = window.setInterval(refresh, 120_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [load]);

  const shift = payload?.shift;
  const cec = payload?.kind === "cec";
  const metrics = payload?.productivity.metrics;
  const helper = payload?.productivity.status === "partial" ? "Parcial · intervalos disponíveis" : "Acumulado do Shift Date";

  return <div className="space-y-4">
    <PageHeader title="Meu Real Time" description="Seus números da jornada, incluindo antecipação e horas extras. Atualização automática a cada 2 minutos." icon={MonitorCog}
      actions={<div className="flex flex-wrap items-center gap-2">
        <Link href="/minhas-horas" className="premium-control inline-flex h-9 items-center px-3 text-sm font-bold">Minhas Horas</Link>
        <button type="button" onClick={() => void load(true)} disabled={loading || refreshing} className="premium-button inline-flex h-9 items-center gap-2 px-3 text-sm font-extrabold disabled:opacity-60">
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />{refreshing ? "Atualizando…" : "Atualizar"}
        </button>
      </div>} />

    {error ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-sm font-bold text-red-700">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div>{error}{payload ? <p className="mt-1 text-xs font-medium">Exibindo a última consulta recebida em {dateTime.format(new Date(payload.queriedAt))}. Os números podem estar desatualizados.</p> : null}</div>
    </div> : null}

    {loading ? <div role="status" className="grid min-h-64 place-items-center text-sm font-bold text-muted"><span className="flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin" />Consultando seu turno…</span></div> : null}

    {payload ? <>
      <div className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-extrabold text-navy-950">{payload.employee.fullName}</p><p className="mt-1 text-xs font-medium text-muted">WB {payload.employee.wbLogin} · {payload.employee.lob}</p></div>
        <div className="text-xs font-bold text-muted sm:text-right">{shift ? <><p>Shift Date {shift.date.split("-").reverse().join("/")} · Escala {shift.startsAt} às {shift.endsAt}</p>
          {payload.shiftState === "before_shift" || payload.shiftState === "after_shift" ? <p className="mt-1">{payload.shiftState === "before_shift" ? "Antes do horário previsto" : "Após o horário previsto"} · incluindo os dados disponíveis</p> : null}
          <p className="mt-1">Consultado até {dateTime.format(new Date(shift.observedUntil))}</p></> : "Nenhuma jornada associada a este horário"}</div>
      </div>

      {!shift ? <Panel title={payload.shiftState === "no_schedule" ? "Escala indisponível" : "Fora do turno"}>
        <p className="text-sm text-muted">{payload.shiftState === "no_schedule" ? "Não foi possível determinar seu turno pela escala. Peça ao supervisor para conferir seu cronograma." : "Não há jornada associada a este horário na sua escala. A antecipação e as horas extras aparecem junto ao turno de origem."}</p>
      </Panel> : <>
        <div className={cn("grid gap-3 sm:grid-cols-2", cec ? "xl:grid-cols-2" : "lg:grid-cols-3 xl:grid-cols-6")}>
          {cec ? <StatCard title="CPD do último ciclo" value={count(payload.productivity.cpd)} helper="Tickets distintos · não acumulado do turno" icon={Ticket} tone="blue" /> : <>
            <StatCard title="Submit" value={count(metrics?.submit)} helper={helper} icon={CheckCheck} tone="blue" />
            <StatCard title="Moderation Duration" value={duration(metrics?.moderationMs)} helper={helper} icon={Timer} tone="blue" />
            <StatCard title="AHT" value={aht(metrics?.ahtMs)} helper="Moderação / submits do Shift Date" icon={Timer} tone="blue" />
            <StatCard title="Refresh" value={count(metrics?.refresh)} helper={helper} icon={RotateCw} tone="blue" />
            <StatCard title="Timeout" value={count(metrics?.timeout)} helper={helper} icon={Clock} tone="blue" />
          </>}
          <StatCard title="Horas capturadas" value={duration(payload.capture.capturedMs)} helper="Mesmo total da Captura de Horas neste Shift Date" icon={MonitorCog} tone="blue" />
        </div>

        <div className="grid gap-3 md:grid-cols-2" aria-live="polite">
          <div className="rounded-xl border border-border bg-white p-3 text-xs text-muted"><div className="mb-2 flex items-center gap-2"><strong className="text-navy-950">{cec ? "Fonte CEC" : "Fonte Real Time"}</strong><Status status={payload.productivity.status} /></div>
            <p>Último ciclo: {payload.productivity.lastCycle ? payload.productivity.lastCycle.split(" ").reverse().join(" · ") : "Sem dados no turno"}</p>
            {payload.productivity.importedAt ? <p className="mt-1">Importado em {dateTime.format(new Date(payload.productivity.importedAt))}</p> : null}
            {payload.productivity.message ? <p className="mt-2 font-bold">{payload.productivity.message}</p> : null}
          </div>
          <div className="rounded-xl border border-border bg-white p-3 text-xs text-muted"><div className="mb-2 flex items-center gap-2"><strong className="text-navy-950">Captura de Horas</strong><Status status={payload.capture.status} /></div>
            <p>Último sinal: {payload.capture.lastSeenAt ? dateTime.format(new Date(payload.capture.lastSeenAt)) : "Sem sinal no turno"}</p>
            <p className="mt-1">Inclui antecipação e horas extras atribuídas ao turno pela Captura de Horas. Ajustes e horas consideradas ficam em Minhas Horas.</p>
            {payload.capture.message ? <p className="mt-2 font-bold">{payload.capture.message}</p> : null}
          </div>
        </div>

        <Panel title="Hora a hora">
          <p className="mb-3 text-xs text-muted">{cec ? "Último CPD disponível em cada hora, sem somar ciclos. A captura inclui antecipação e horas extras atribuídas ao turno." : "13:00 representa 13h às 14h. O acumulado inclui antecipação e horas extras, preserva a produção anterior ao reinício da fonte às 13h e mantém a madrugada no turno de origem. A hora em andamento é parcial."}</p>
          {payload.intervals.length ? <div className="overflow-x-auto rounded-xl border border-border">
            <table className={cn("w-full border-collapse text-left text-sm", cec ? "min-w-[580px]" : "min-w-[1000px]")}>
              <caption className="sr-only">Suas métricas no turno atual</caption>
              <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-wide text-muted"><tr>
                <th scope="col" className="px-3 py-3">Hora</th>
                {cec ? <th scope="col" className="px-3 py-3">CPD do último ciclo da hora</th> : <>{["Submit", "Moderation Duration", "AHT", "Refresh", "Timeout"].map((title) => <th key={title} scope="col" className="px-3 py-3">{title}</th>)}</>}
                <th scope="col" className="px-3 py-3">Horas capturadas</th><th scope="col" className="px-3 py-3">Dados de produção</th>
              </tr></thead>
              <tbody className="divide-y divide-border/70 bg-white">{payload.intervals.map((interval) => <tr key={`${interval.start}:${interval.end}`}>
                <th scope="row" title={`${clock.format(new Date(interval.start))} às ${clock.format(new Date(interval.end))}`} className="whitespace-nowrap px-3 py-3 font-bold text-navy-950">
                  <span className="block">{clock.format(new Date(interval.hour ?? interval.start))}</span>
                  <span className="mt-1 block text-[11px] font-medium text-muted">{dayLabel.format(new Date(interval.hour ?? interval.start))}</span>
                  {Date.parse(interval.end) <= Date.parse(shift.start) ? <span className="mt-1 block text-[11px] font-medium text-muted">Antes da escala</span>
                    : Date.parse(interval.start) >= Date.parse(shift.end) ? <span className="mt-1 block text-[11px] font-medium text-muted">Após a escala</span> : null}
                  {cec && interval.cycle ? <span className="mt-1 block text-[11px] font-medium text-muted">Ciclo {interval.cycle.slice(11)}</span> : null}
                </th>
                {cec ? <td className="px-3 py-3 tabular-nums">{count(interval.cpd)}</td> : <>
                  <td className="px-3 py-3 tabular-nums">{count(interval.metrics?.submit)}</td><td className="px-3 py-3 tabular-nums">{duration(interval.metrics?.moderationMs)}</td>
                  <td className="px-3 py-3 tabular-nums">{aht(interval.metrics?.ahtMs)}</td>
                  <td className="px-3 py-3 tabular-nums">{count(interval.metrics?.refresh)}</td><td className="px-3 py-3 tabular-nums">{count(interval.metrics?.timeout)}</td>
                </>}
                <td className="px-3 py-3 tabular-nums">{duration(interval.capturedMs)}</td><td className="px-3 py-3">{interval.captureOnly ? <span className="text-xs font-bold text-muted">Somente captura</span> : <Status status={interval.status} />}</td>
              </tr>)}</tbody>
            </table>
          </div> : <p className="py-8 text-center text-sm text-muted">Ainda não há ciclos disponíveis neste turno.</p>}
        </Panel>
      </>}
    </> : null}
  </div>;
}
