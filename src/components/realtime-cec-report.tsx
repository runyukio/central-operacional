"use client";

import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, Database, Gauge, UserRound, UsersRound } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { cn } from "@/lib/utils";

export type CecReportAgent = {
  agentName: string;
  cpd: number;
  share: number;
};

export type CecReportTicket = {
  ticket: string;
  agentName: string;
  status: string;
};

export type CecReportSnapshot = {
  id: string;
  cycleDownload: string;
  fileName: string;
  source: string;
  generatedDate: string | null;
  importedAtLabel: string;
  totalCpd: number;
  activeAgents: number;
  averageCpd: number;
  agents: CecReportAgent[];
  tickets: CecReportTicket[];
};

export type CecReportPayload = {
  hasData: boolean;
  refreshWarning?: string;
  selectedCycle: string;
  previousCycle: string;
  cycles: Array<{
    value: string;
    importedAt: string;
    importedAtLabel: string;
    rows: number;
  }>;
  snapshot: CecReportSnapshot | null;
  previous: CecReportSnapshot | null;
  history: Array<{
    cycleDownload: string;
    totalCpd: number;
    activeAgents: number;
    averageCpd: number;
  }>;
};

function formatInteger(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value || 0);
}

function formatDecimal(value: number) {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(value || 0);
}

function shortCycleLabel(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return match ? `${match[3]}/${match[2]} ${match[4]}:${match[5]}` : value;
}

function CecEmptyState({ loading, error }: { loading: boolean; error: string }) {
  return (
    <section className="rounded-[24px] border border-slate-200/80 bg-white px-5 py-14 text-center shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <Database className={cn("mx-auto h-9 w-9 text-blue-500", loading && "animate-pulse")} />
      <h2 className="mt-3 text-lg font-black text-navy-950">{loading ? "Carregando CPD de CEC" : "CPD de CEC indisponível"}</h2>
      <p className="mx-auto mt-1 max-w-2xl text-sm font-bold text-muted">
        {error || "O Data Export do Freshdesk ainda não retornou um snapshot horário válido."}
      </p>
    </section>
  );
}

function DeltaBadge({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">Sem comparação</span>;
  }
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : ArrowRight;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-black",
      value > 0 ? "bg-emerald-100 text-emerald-700" : value < 0 ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"
    )}>
      <Icon className="h-3.5 w-3.5" />
      {value > 0 ? "+" : ""}{formatInteger(value)}
    </span>
  );
}

export function CecReportOverview({ report, loading, error }: { report: CecReportPayload | null; loading: boolean; error: string }) {
  const snapshot = report?.snapshot ?? null;
  if (!snapshot) return <CecEmptyState loading={loading} error={error || report?.refreshWarning || ""} />;

  const previousTotal = report?.previous?.totalCpd ?? null;
  const delta = previousTotal === null ? null : snapshot.totalCpd - previousTotal;
  const trend = (report?.history ?? []).map((item) => ({
    label: shortCycleLabel(item.cycleDownload),
    cpd: item.totalCpd
  }));

  return (
    <section className="space-y-4">
      {report?.refreshWarning ? (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{report.refreshWarning} O último snapshot CPD válido foi mantido.</span>
        </div>
      ) : null}

      <article className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-blue-600">Report CEC</p>
            <h2 className="mt-1 text-xl font-black text-navy-950">CPD por hora</h2>
            <p className="mt-1 text-xs font-bold text-muted">
              Contagem distinta de Ticket ID dentro de cada Agent name · snapshot {snapshot.cycleDownload}
            </p>
          </div>
          <DeltaBadge value={delta} />
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl bg-blue-50/80 p-4">
            <div className="flex items-center gap-2 text-blue-700">
              <Gauge className="h-4 w-4" />
              <span className="text-xs font-black uppercase tracking-wide">CPD total</span>
            </div>
            <p className="mt-2 text-4xl font-black tracking-tight text-navy-950">{formatInteger(snapshot.totalCpd)}</p>
            <p className="mt-1 text-xs font-bold text-muted">tickets distintos somados por agente</p>
          </div>
          <div className="rounded-2xl bg-emerald-50/80 p-4">
            <div className="flex items-center gap-2 text-emerald-700">
              <UsersRound className="h-4 w-4" />
              <span className="text-xs font-black uppercase tracking-wide">Agentes com CPD</span>
            </div>
            <p className="mt-2 text-4xl font-black tracking-tight text-navy-950">{formatInteger(snapshot.activeAgents)}</p>
            <p className="mt-1 text-xs font-bold text-muted">agentes com ao menos um ticket</p>
          </div>
          <div className="rounded-2xl bg-violet-50/80 p-4">
            <div className="flex items-center gap-2 text-violet-700">
              <UserRound className="h-4 w-4" />
              <span className="text-xs font-black uppercase tracking-wide">Média por agente</span>
            </div>
            <p className="mt-2 text-4xl font-black tracking-tight text-navy-950">{formatDecimal(snapshot.averageCpd)}</p>
            <p className="mt-1 text-xs font-bold text-muted">CPD total ÷ agentes com CPD</p>
          </div>
        </div>

        <div className="mt-5 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
              <defs>
                <linearGradient id="cecCpdFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#2563EB" stopOpacity={0.24} />
                  <stop offset="100%" stopColor="#2563EB" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#E2E8F0" strokeDasharray="4 4" />
              <XAxis dataKey="label" tick={{ fill: "#64748B", fontSize: 11, fontWeight: 700 }} tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis allowDecimals={false} tick={{ fill: "#64748B", fontSize: 11, fontWeight: 700 }} tickLine={false} axisLine={false} />
              <Tooltip formatter={(value) => [formatInteger(Number(value)), "CPD"]} labelStyle={{ fontWeight: 800 }} />
              <Area type="monotone" dataKey="cpd" stroke="#2563EB" strokeWidth={2.5} fill="url(#cecCpdFill)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-right text-[11px] font-bold text-muted">Atualizado em {snapshot.importedAtLabel}</p>
      </article>
    </section>
  );
}

export function CecReportDetails({ report, loading }: { report: CecReportPayload | null; loading: boolean }) {
  const snapshot = report?.snapshot ?? null;
  if (!snapshot) {
    return <div className="px-4 py-12 text-center text-sm font-bold text-muted">{loading ? "Carregando agentes..." : "Nenhum agente disponível no snapshot CEC."}</div>;
  }

  const previousByAgent = new Map(
    (report?.previous?.agents ?? []).map((agent) => [agent.agentName.trim().toLocaleLowerCase("pt-BR"), agent.cpd])
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="font-black text-navy-950">CPD por agente</h2>
          <p className="mt-0.5 text-xs font-bold text-muted">Ticket ID distinto por agente no arquivo correspondente ao snapshot da hora.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
          <UserRound className="h-3.5 w-3.5" /> {snapshot.activeAgents} agentes
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] table-fixed text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="w-[42%] px-4 py-3 font-black">Agente</th>
              <th className="w-[16%] px-4 py-3 text-center font-black">CPD atual</th>
              <th className="w-[16%] px-4 py-3 text-center font-black">Hora anterior</th>
              <th className="w-[14%] px-4 py-3 text-center font-black">Diferença</th>
              <th className="w-[12%] px-4 py-3 text-right font-black">Participação</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.agents.map((agent, index) => {
              const previous = previousByAgent.get(agent.agentName.trim().toLocaleLowerCase("pt-BR")) ?? 0;
              const difference = agent.cpd - previous;
              return (
                <tr key={agent.agentName} className={cn("border-t border-slate-100", index % 2 ? "bg-slate-50/45" : "bg-white")}>
                  <td className="px-4 py-3 font-extrabold text-navy-950">{agent.agentName}</td>
                  <td className="px-4 py-3 text-center text-base font-black text-blue-700">{formatInteger(agent.cpd)}</td>
                  <td className="px-4 py-3 text-center font-bold text-slate-600">{formatInteger(previous)}</td>
                  <td className={cn(
                    "px-4 py-3 text-center font-black",
                    difference > 0 ? "text-emerald-700" : difference < 0 ? "text-red-700" : "text-slate-500"
                  )}>
                    {difference > 0 ? "+" : ""}{formatInteger(difference)}
                  </td>
                  <td className="px-4 py-3 text-right font-black text-muted">{formatDecimal(agent.share)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
