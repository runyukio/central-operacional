"use client";

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Info,
  MoreVertical,
  XCircle
} from "lucide-react";

import { cn, formatNumber, formatPercent } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  icon: Icon,
  actions
}: {
  title: string;
  description: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 border-b border-border/70 pb-4 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {Icon ? (
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white text-blue-600 shadow-soft">
            <Icon className="h-5 w-5" />
          </div>
        ) : null}
        <div className="min-w-0">
          <h1 className="break-words text-[21px] font-extrabold leading-tight tracking-tight text-navy-950 md:text-[23px]">{title}</h1>
          <p className="mt-1 text-[13px] font-medium leading-snug text-muted">{description}</p>
        </div>
      </div>
      {actions ? <div className="min-w-0">{actions}</div> : null}
    </div>
  );
}

export function StatCard({
  title,
  value,
  change,
  helper,
  icon: Icon,
  tone = "blue",
  sparkline
}: {
  title: string;
  value: string | number;
  change?: string;
  helper?: string;
  icon: LucideIcon;
  tone?: "blue" | "green" | "orange" | "red" | "purple" | "gold" | "cyan";
  sparkline?: React.ReactNode;
}) {
  const toneClass = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-emerald-50 text-emerald-600",
    orange: "bg-orange-50 text-orange-600",
    red: "bg-red-50 text-red-600",
    purple: "bg-violet-50 text-violet-600",
    gold: "bg-amber-50 text-amber-500",
    cyan: "bg-cyan-50 text-cyan-600"
  }[tone];

  return (
    <div className="card group relative flex min-h-[104px] min-w-0 items-center gap-3 overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-200 to-transparent opacity-70" />
      <div className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-xl shadow-soft ring-1 ring-white", toneClass)}>
        <Icon className="h-6 w-6" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="max-w-full break-words text-[12px] font-extrabold leading-tight text-navy-950">{title}</p>
        <div className="mt-1.5 flex min-w-0 items-end gap-2">
          <p className="min-w-0 break-words text-[23px] font-black leading-none tracking-tight text-navy-950">{value}</p>
          {sparkline}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          {change ? (
            <span className={cn("font-bold", change.startsWith("-") || change.includes("↓") ? "text-red-500" : "text-emerald-600")}>
              {change}
            </span>
          ) : null}
          {helper ? <span className="text-muted">{helper}</span> : null}
        </div>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const styles =
    normalized.includes("crítico") || normalized.includes("critico") || normalized.includes("recus") || normalized.includes("inoperante")
      ? "bg-red-50 text-red-600"
      : normalized.includes("aten") || normalized.includes("manutenção") || normalized.includes("manutencao") || normalized.includes("pendente")
        ? "bg-amber-50 text-amber-600"
        : normalized.includes("aprov") || normalized.includes("funcion") || normalized.includes("online") || normalized.includes("lido") || normalized.includes("sucesso")
          ? "bg-emerald-50 text-emerald-600"
          : normalized.includes("nesting")
            ? "bg-violet-50 text-violet-700"
            : normalized.includes("inform") || normalized.includes("análise") || normalized.includes("analise")
            ? "bg-blue-50 text-blue-600"
            : "bg-slate-100 text-slate-600";

  return (
    <span className={cn("inline-flex max-w-full items-center gap-1.5 rounded-md border border-current/10 px-2 py-1 text-[11px] font-extrabold leading-tight", styles)}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-75" />
      <span className="min-w-0 break-words">{status}</span>
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const color =
    priority === "Alta" || priority === "Crítica" ? "bg-red-500" : priority === "Média" ? "bg-amber-500" : "bg-emerald-500";
  return (
    <span className="inline-flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1 text-xs font-bold text-muted">
      <span className={cn("status-dot", color)} />
      {priority}
    </span>
  );
}

export function FilterBar({
  filters,
  action,
  primaryAction
}: {
  filters: string[];
  action?: string;
  primaryAction?: string;
}) {
  return (
    <div className="card mb-5 flex flex-col gap-3 p-3 lg:flex-row lg:items-end lg:p-4">
      <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        {filters.map((filter) => (
          <label key={filter} className="block">
            <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">{filter}</span>
            <div className="relative">
            <select className="premium-control h-10 w-full appearance-none px-3 pr-9 text-sm font-bold outline-none">
              <option>Todos</option>
              <option>CEC</option>
              <option>TNS</option>
              <option>ADS</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            </div>
          </label>
        ))}
      </div>
      {action ? <button className="premium-control h-10 px-4 text-sm font-extrabold text-navy-950">{action}</button> : null}
      {primaryAction ? <button className="premium-button h-10 px-4 text-sm font-extrabold">{primaryAction}</button> : null}
    </div>
  );
}

export function Panel({ title, children, action, actionOnClick }: { title: string; children: React.ReactNode; action?: string; actionOnClick?: () => void }) {
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/75 bg-gradient-to-b from-white to-slate-50/65 px-4 py-3">
        <h2 className="min-w-0 break-words text-[14px] font-black leading-tight tracking-tight text-navy-950">{title}</h2>
        {action && actionOnClick ? (
          <button type="button" onClick={actionOnClick} className="flex items-center gap-1 text-sm font-extrabold text-blue-600">
            {action}
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : action ? (
          <span className="flex items-center gap-1 text-sm font-extrabold text-blue-600">
            {action}
            <ChevronRight className="h-4 w-4" />
          </span>
        ) : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function MiniAlertList({ items }: { items: Array<{ title: string; status: string; time?: string; tone?: "red" | "orange" | "blue" | "green" }> }) {
  const iconByTone = {
    red: XCircle,
    orange: AlertTriangle,
    blue: Info,
    green: CheckCircle2
  };

  return (
    <div className="divide-y divide-border/70">
      {items.map((item, index) => {
        const Icon = iconByTone[item.tone ?? "blue"];
        return (
          <div key={index} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", item.tone === "red" ? "bg-red-50 text-red-500" : item.tone === "orange" ? "bg-amber-50 text-amber-500" : item.tone === "green" ? "bg-emerald-50 text-emerald-500" : "bg-blue-50 text-blue-500")}>
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-navy-950">{item.title}</p>
            </div>
            <StatusBadge status={item.status} />
            {item.time ? <span className="text-xs text-muted">{item.time}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

export function SimpleTable({
  columns,
  rows
}: {
  columns: string[];
  rows: Array<Array<React.ReactNode>>;
}) {
  return (
    <div className="max-w-full overflow-x-auto rounded-lg border border-border bg-white">
      <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-border bg-gradient-to-b from-slate-50 to-white text-[11px] font-black uppercase tracking-wide text-muted">
            {columns.map((column) => (
              <th key={column} className="px-3 py-2.5 leading-tight break-words">
                {column}
              </th>
            ))}
            <th className="w-10 px-3 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70 bg-white">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="transition-colors hover:bg-blue-50/35">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="max-w-[260px] break-words px-3 py-2.5 align-middle font-medium leading-snug text-navy-950">
                  {cell}
                </td>
              ))}
              <td className="px-3 py-2.5 text-right text-muted">
                <MoreVertical className="h-4 w-4" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProgressLine({ label, value, tone = "green" }: { label: string; value: number; tone?: "green" | "blue" | "orange" | "purple" }) {
  const toneClass = {
    green: "bg-emerald-500",
    blue: "bg-blue-600",
    orange: "bg-orange-500",
    purple: "bg-violet-600"
  }[tone];
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs font-semibold">
        <span className="text-muted">{label}</span>
        <span className="text-navy-950">{formatPercent(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 shadow-inner">
        <div className={cn("h-full rounded-full", toneClass)} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  );
}

export function DonutLegend({ total, items }: { total: string | number; items: Array<{ label: string; value: string; color: string }> }) {
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div className="grid h-36 w-36 shrink-0 place-items-center rounded-full bg-[conic-gradient(#10B981_0_72%,#F59E0B_72%_88%,#EF4444_88%_96%,#CBD5E1_96%_100%)] p-4 shadow-soft">
        <div className="grid h-full w-full place-items-center rounded-full bg-white text-center shadow-inner">
          <div>
            <p className="text-2xl font-extrabold text-navy-950">{total}</p>
            <p className="text-xs text-muted">Total</p>
          </div>
        </div>
      </div>
      <div className="flex-1 space-y-3">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-4 text-sm">
            <span className="flex items-center gap-2 font-semibold text-navy-950">
              <span className="status-dot" style={{ backgroundColor: item.color }} />
              {item.label}
            </span>
            <span className="font-bold text-muted">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MetricPill({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-gradient-to-b from-white to-slate-50/70 p-3 text-center shadow-soft">
      <p className="min-w-0 break-words text-[19px] font-black leading-tight tracking-tight text-navy-950">{typeof value === "number" ? formatNumber(value) : value}</p>
      <p className="mx-auto mt-1 max-w-full whitespace-normal break-words text-[10.5px] font-extrabold uppercase leading-tight tracking-wide text-muted">{label}</p>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid min-h-[180px] place-items-center rounded-xl border border-dashed border-border bg-gradient-to-b from-white to-slate-50 p-4 text-center">
      <div>
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-blue-50">
          <Circle className="h-8 w-8 text-blue-300" />
        </div>
        <h3 className="mt-3 text-base font-bold text-navy-950">{title}</h3>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="card flex h-32 items-center justify-center gap-3 text-sm font-bold text-muted">
      <Clock className="h-5 w-5 animate-spin text-blue-600" />
      Carregando dados operacionais...
    </div>
  );
}

export function Delta({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600">
      <ArrowUpRight className="h-3.5 w-3.5" />
      {children}
    </span>
  );
}
