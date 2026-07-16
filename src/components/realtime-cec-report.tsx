"use client";

import { AlertTriangle, CheckCircle2, Clock3, Database, UserRound } from "lucide-react";
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

import { cn } from "@/lib/utils";

export type CecReportGroup = {
  key: string;
  label: string;
  backlog: number;
  onHold: number;
  open: number;
  new: number;
};

export type CecReportAgent = {
  name: string;
  group: string;
  backlog: number;
  percent: number | null;
};

export type CecReportTicket = {
  ticket: string;
  agentName: string;
  status: string;
};

export type CecReportSnapshot = {
  id: string;
  cycleDownload: string;
  importedAtLabel: string;
  totalBacklog: number;
  normalBacklog: number;
  onHoldCount: number;
  openCount: number;
  newCount: number;
  groups: CecReportGroup[];
  departments: CecReportAgent[];
  tickets: CecReportTicket[];
};

export type CecReportPayload = {
  hasData: boolean;
  selectedCycle: string;
  previousCycle: string;
  snapshot: CecReportSnapshot | null;
  previous: CecReportSnapshot | null;
  history: Array<{
    cycleDownload: string;
    totalBacklog: number;
    normalBacklog: number;
    onHoldCount: number;
    openCount: number;
    newCount: number;
  }>;
};

const statusConfig = [
  { key: "Open", label: "Open", color: "#2563EB", icon: Clock3 },
  { key: "On Hold", label: "On Hold", color: "#F59E0B", icon: AlertTriangle },
  { key: "New", label: "New", color: "#10B981", icon: CheckCircle2 }
] as const;

function formatInteger(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value || 0);
}

function shortCycleLabel(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return match ? `${match[3]}/${match[2]} ${match[4]}:${match[5]}` : value;
}

function CecEmptyState({ loading, error }: { loading: boolean; error: string }) {
  return (
    <section className="rounded-[24px] border border-slate-200/80 bg-white px-5 py-14 text-center shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <Database className={cn("mx-auto h-9 w-9 text-blue-500", loading && "animate-pulse")} />
      <h2 className="mt-3 text-lg font-black text-navy-950">{loading ? "Loading CEC report" : "CEC data unavailable"}</h2>
      <p className="mx-auto mt-1 max-w-xl text-sm font-bold text-muted">
        {error || "The Freshdesk automation has not sent the Backlog Normal snapshot yet."}
      </p>
    </section>
  );
}

export function CecReportOverview({ report, loading, error }: { report: CecReportPayload | null; loading: boolean; error: string }) {
  const snapshot = report?.snapshot ?? null;
  if (!snapshot) return <CecEmptyState loading={loading} error={error} />;

  const previous = report?.previous?.totalBacklog ?? null;
  const delta = previous === null ? null : snapshot.totalBacklog - previous;
  const trend = (report?.history ?? []).map((item) => ({ label: shortCycleLabel(item.cycleDownload), value: item.totalBacklog }));
  const statusTotal = snapshot.openCount + snapshot.onHoldCount + snapshot.newCount;
  const otherCount = Math.max(0, snapshot.totalBacklog - statusTotal);
  const statusData = [
    { name: "Open", value: snapshot.openCount, color: "#2563EB" },
    { name: "On Hold", value: snapshot.onHoldCount, color: "#F59E0B" },
    { name: "New", value: snapshot.newCount, color: "#10B981" },
    ...(otherCount ? [{ name: "Other", value: otherCount, color: "#94A3B8" }] : [])
  ].filter((item) => item.value > 0);

  return (
    <section className="grid items-stretch gap-4 xl:grid-cols-[0.92fr_1.08fr]">
      <article className="flex min-h-[310px] flex-col rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-blue-600">Report CEC</p>
            <h2 className="mt-1 text-xl font-black text-navy-950">Backlog Normal</h2>
            <p className="mt-1 text-xs font-bold text-muted">Cycle {snapshot.cycleDownload}</p>
          </div>
          <span className={cn(
            "inline-flex rounded-full px-3 py-1 text-xs font-black",
            delta === null ? "bg-slate-100 text-slate-600" : delta <= 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
          )}>
            {delta === null ? "No comparison" : `${delta > 0 ? "+" : ""}${formatInteger(delta)}`}
          </span>
        </div>
        <p className="mt-5 text-5xl font-black tracking-tight text-navy-950">{formatInteger(snapshot.totalBacklog)}</p>
        <p className="mt-1 text-sm font-bold text-muted">tickets in the current snapshot</p>
        <div className="mt-auto h-28 pt-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="cecBacklogFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#2563EB" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#2563EB" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" hide />
              <Tooltip formatter={(value) => [formatInteger(Number(value)), "Backlog"]} labelStyle={{ fontWeight: 800 }} />
              <Area type="monotone" dataKey="value" stroke="#2563EB" strokeWidth={2.5} fill="url(#cecBacklogFill)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </article>

      <article className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-navy-950">Ticket status</h2>
            <p className="mt-1 text-xs font-bold text-muted">Last update {snapshot.importedAtLabel}</p>
          </div>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">{formatInteger(snapshot.totalBacklog)} tickets</span>
        </div>
        <div className="mt-3 grid items-center gap-3 sm:grid-cols-[minmax(220px,0.9fr)_minmax(240px,1.1fr)]">
          <div className="relative mx-auto h-[210px] w-full max-w-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={2} stroke="none" isAnimationActive={false}>
                  {statusData.map((item) => <Cell key={item.name} fill={item.color} />)}
                </Pie>
                <Tooltip formatter={(value, name) => [formatInteger(Number(value)), name]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-black text-navy-950">{formatInteger(snapshot.totalBacklog)}</span>
              <span className="text-[10px] font-black uppercase tracking-wide text-muted">total</span>
            </div>
          </div>
          <div className="space-y-2">
            {statusConfig.map((status) => {
              const value = status.key === "Open" ? snapshot.openCount : status.key === "On Hold" ? snapshot.onHoldCount : snapshot.newCount;
              const percentage = snapshot.totalBacklog ? (value / snapshot.totalBacklog) * 100 : 0;
              const Icon = status.icon;
              return (
                <div key={status.key} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm"><Icon className="h-4 w-4" style={{ color: status.color }} /></span>
                  <div>
                    <p className="text-sm font-black text-navy-950">{status.label}</p>
                    <p className="text-[11px] font-bold text-muted">{percentage.toFixed(1)}%</p>
                  </div>
                  <span className="text-lg font-black text-navy-950">{formatInteger(value)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </article>
    </section>
  );
}

export function CecReportDetails({ report, loading }: { report: CecReportPayload | null; loading: boolean }) {
  const snapshot = report?.snapshot ?? null;
  if (!snapshot) {
    return <div className="px-4 py-12 text-center text-sm font-bold text-muted">{loading ? "Loading agent distribution..." : "No CEC rows available."}</div>;
  }

  const statusByAgent = new Map<string, Record<string, number>>();
  snapshot.tickets.forEach((ticket) => {
    const counts = statusByAgent.get(ticket.agentName) ?? {};
    counts[ticket.status] = (counts[ticket.status] || 0) + 1;
    statusByAgent.set(ticket.agentName, counts);
  });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="font-black text-navy-950">Backlog by agent</h2>
          <p className="mt-0.5 text-xs font-bold text-muted">Normal tickets grouped by the Freshdesk agent name.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
          <UserRound className="h-3.5 w-3.5" /> {snapshot.departments.length} agents
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] table-fixed text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="w-[38%] px-4 py-3 font-black">Agent name</th>
              <th className="w-[14%] px-4 py-3 text-center font-black">Tickets</th>
              <th className="w-[14%] px-4 py-3 text-center font-black">Open</th>
              <th className="w-[14%] px-4 py-3 text-center font-black">On Hold</th>
              <th className="w-[10%] px-4 py-3 text-center font-black">New</th>
              <th className="w-[10%] px-4 py-3 text-right font-black">Share</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.departments.map((agent, index) => {
              const statuses = statusByAgent.get(agent.name) ?? {};
              return (
                <tr key={`${agent.name}-${index}`} className={cn("border-t border-slate-100", index % 2 ? "bg-slate-50/45" : "bg-white")}>
                  <td className="px-4 py-3 font-extrabold text-navy-950">{agent.name}</td>
                  <td className="px-4 py-3 text-center font-black text-navy-950">{formatInteger(agent.backlog)}</td>
                  <td className="px-4 py-3 text-center font-bold text-blue-700">{formatInteger(statuses.Open || 0)}</td>
                  <td className="px-4 py-3 text-center font-bold text-amber-700">{formatInteger(statuses["On Hold"] || 0)}</td>
                  <td className="px-4 py-3 text-center font-bold text-emerald-700">{formatInteger(statuses.New || 0)}</td>
                  <td className="px-4 py-3 text-right font-black text-muted">{(agent.percent ?? 0).toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
