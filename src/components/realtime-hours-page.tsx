"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  History,
  Laptop,
  MonitorCog,
  RefreshCw,
  Search,
  ShieldCheck,
  Wifi,
  WifiOff
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState, PageHeader, Panel, StatCard, StatusBadge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type RealtimeHoursBatch = {
  id: string;
  source: string;
  status: string;
  capturedAt: string;
  importedAt: string;
  rowsTotal: number;
  rowsValid: number;
  rowsError: number;
  minutesSinceCaptured: number;
  isStale: boolean;
};

type RealtimeHoursSummary = {
  totalRecords: number;
  distinctHosts: number;
  activeSessions: number;
  inactiveSessions: number;
  idleSessions: number;
  identifiedRecords: number;
  unknownIdentityRecords: number;
  identityConfidence: {
    high: number;
    medium: number;
    low: number;
    unknown: number;
  };
};

type RealtimeHoursRecord = {
  id: string;
  capturedAt: string;
  hostname: string;
  windowsUser: string;
  wbLogin: string;
  employeeId: string;
  ipAddress: string;
  isSessionActive: boolean;
  idleSeconds: number | null;
  activeProcessName: string;
  activeWindowTitle: string;
  lastActivityAt: string | null;
  identitySource: string;
  identityConfidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN" | string;
  createdAt: string;
};

type RealtimeHoursStatusPayload = {
  success: boolean;
  batch: RealtimeHoursBatch | null;
  summary: RealtimeHoursSummary;
  records: RealtimeHoursRecord[];
  recordsReturned: number;
  limit: number;
  error?: string;
  message?: string;
};

type RealtimeHoursImport = {
  id: string;
  source: string;
  status: string;
  capturedAt: string;
  importedAt: string;
  rowsTotal: number;
  rowsValid: number;
  rowsError: number;
  recordCount: number;
  errorSummary: unknown;
};

type RealtimeHoursImportsPayload = {
  success: boolean;
  data: RealtimeHoursImport[];
  limit: number;
  error?: string;
  message?: string;
};

type SessionFilter = "ALL" | "ACTIVE" | "IDLE" | "INACTIVE";
type IdentityFilter = "ALL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

const idleThresholdSeconds = 300;

const emptySummary: RealtimeHoursSummary = {
  totalRecords: 0,
  distinctHosts: 0,
  activeSessions: 0,
  inactiveSessions: 0,
  idleSessions: 0,
  identifiedRecords: 0,
  unknownIdentityRecords: 0,
  identityConfidence: {
    high: 0,
    medium: 0,
    low: 0,
    unknown: 0
  }
};

export function RealtimeHoursPage() {
  const [statusPayload, setStatusPayload] = useState<RealtimeHoursStatusPayload | null>(null);
  const [importsPayload, setImportsPayload] = useState<RealtimeHoursImportsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("ALL");
  const [identityFilter, setIdentityFilter] = useState<IdentityFilter>("ALL");

  const loadData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    if (!showRefreshing) setLoading(true);
    setError("");

    try {
      const [statusResponse, importsResponse] = await Promise.all([
        fetch("/api/realtime-hours/status?limit=500", { cache: "no-store" }),
        fetch("/api/realtime-hours/imports?limit=8", { cache: "no-store" })
      ]);

      const [statusBody, importsBody] = await Promise.all([
        statusResponse.json() as Promise<RealtimeHoursStatusPayload>,
        importsResponse.json() as Promise<RealtimeHoursImportsPayload>
      ]);

      if (!statusResponse.ok || statusBody.success === false) {
        throw new Error(statusBody.message || statusBody.error || "Não foi possível carregar a captura de horas.");
      }
      if (!importsResponse.ok || importsBody.success === false) {
        throw new Error(importsBody.message || importsBody.error || "Não foi possível carregar o histórico de uploads.");
      }

      setStatusPayload(statusBody);
      setImportsPayload(importsBody);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar a captura de horas.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = window.setInterval(() => loadData(true), 60_000);
    return () => window.clearInterval(interval);
  }, [loadData]);

  const summary = statusPayload?.summary ?? emptySummary;
  const batch = statusPayload?.batch ?? null;
  const records = useMemo(() => statusPayload?.records ?? [], [statusPayload?.records]);

  const filteredRecords = useMemo(() => {
    const normalizedSearch = normalizeText(search);
    return records.filter((record) => {
      const sessionStatus = getSessionStatus(record);
      const matchesSearch = normalizedSearch
        ? normalizeText([
          record.hostname,
          record.windowsUser,
          record.wbLogin,
          record.employeeId,
          record.ipAddress,
          record.activeProcessName
        ].join(" ")).includes(normalizedSearch)
        : true;
      const matchesSession =
        sessionFilter === "ALL" ||
        (sessionFilter === "ACTIVE" && sessionStatus === "Ativa") ||
        (sessionFilter === "IDLE" && sessionStatus === "Ociosa") ||
        (sessionFilter === "INACTIVE" && sessionStatus === "Inativa");
      const matchesIdentity = identityFilter === "ALL" || record.identityConfidence === identityFilter;
      return matchesSearch && matchesSession && matchesIdentity;
    });
  }, [identityFilter, records, search, sessionFilter]);

  const activePercent = percent(summary.activeSessions, summary.totalRecords);
  const idlePercent = percent(summary.idleSessions, summary.totalRecords);
  const identifiedPercent = percent(summary.identifiedRecords, summary.totalRecords);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Captura de Horas"
        description="Sinal local dos computadores da operação consolidado pelo servidor Windows."
        icon={MonitorCog}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => exportCsv(filteredRecords)}
              disabled={!filteredRecords.length}
              className="premium-control inline-flex h-9 items-center gap-2 px-3 text-sm font-extrabold text-navy-950 disabled:cursor-not-allowed disabled:opacity-50"
              title="Exportar registros filtrados"
            >
              <Download className="h-4 w-4" />
              Exportar
            </button>
            <button
              type="button"
              onClick={() => loadData(true)}
              disabled={refreshing}
              className="premium-button inline-flex h-9 items-center gap-2 px-3 text-sm font-extrabold disabled:cursor-wait disabled:opacity-70"
              title="Atualizar dados"
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
              Atualizar
            </button>
          </div>
        }
      />

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-sm font-bold text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {batch?.isStale ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-sm font-bold text-amber-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Última captura recebida há {batch.minutesSinceCaptured} minuto(s).</span>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Máquinas" value={summary.distinctHosts} helper={`${summary.totalRecords} registro(s)`} icon={Laptop} tone="blue" />
        <StatCard title="Sessões ativas" value={summary.activeSessions} helper={`${activePercent}% do snapshot`} icon={Wifi} tone="green" />
        <StatCard title="Ociosas" value={summary.idleSessions} helper={`${idlePercent}% acima de 5 min`} icon={Clock} tone={summary.idleSessions ? "orange" : "green"} />
        <StatCard title="Identificadas" value={summary.identifiedRecords} helper={`${identifiedPercent}% com identidade`} icon={ShieldCheck} tone="purple" />
      </div>

      <Panel title="Snapshot atual">
        {loading ? (
          <div className="grid min-h-[220px] place-items-center text-sm font-bold text-muted">
            <span className="inline-flex items-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
              Carregando captura...
            </span>
          </div>
        ) : !batch ? (
          <EmptyState title="Ainda sem captura recebida" description="Nenhum snapshot de horas foi importado pelo servidor local." />
        ) : (
          <div className="space-y-3">
            <div className="grid gap-2.5 lg:grid-cols-4">
              <SnapshotMeta label="Fonte" value={batch.source} />
              <SnapshotMeta label="Capturado em" value={formatDateTime(batch.capturedAt)} />
              <SnapshotMeta label="Importado em" value={formatDateTime(batch.importedAt)} />
              <SnapshotMeta label="Status" value={<StatusBadge status={batch.status === "PARTIAL" ? "Parcial" : "Sucesso"} />} />
            </div>

            <div className="grid gap-2.5 lg:grid-cols-3">
              <ProgressCard label="Ativas" value={summary.activeSessions} total={summary.totalRecords} percentValue={activePercent} tone="green" />
              <ProgressCard label="Ociosas" value={summary.idleSessions} total={summary.totalRecords} percentValue={idlePercent} tone="orange" />
              <ProgressCard label="Identificadas" value={summary.identifiedRecords} total={summary.totalRecords} percentValue={identifiedPercent} tone="blue" />
            </div>
          </div>
        )}
      </Panel>

      <Panel title={`Computadores (${filteredRecords.length})`}>
        <div className="mb-3 grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_160px_180px]">
          <label className="relative block">
            <span className="sr-only">Buscar</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="premium-control h-10 w-full pl-9 pr-3 text-sm font-bold outline-none"
              placeholder="Buscar máquina, usuário, login ou IP"
            />
          </label>

          <label className="block">
            <span className="sr-only">Sessão</span>
            <select
              value={sessionFilter}
              onChange={(event) => setSessionFilter(event.target.value as SessionFilter)}
              className="premium-control h-10 w-full px-3 text-sm font-bold outline-none"
            >
              <option value="ALL">Todas</option>
              <option value="ACTIVE">Ativas</option>
              <option value="IDLE">Ociosas</option>
              <option value="INACTIVE">Inativas</option>
            </select>
          </label>

          <label className="block">
            <span className="sr-only">Identidade</span>
            <select
              value={identityFilter}
              onChange={(event) => setIdentityFilter(event.target.value as IdentityFilter)}
              className="premium-control h-10 w-full px-3 text-sm font-bold outline-none"
            >
              <option value="ALL">Toda identidade</option>
              <option value="HIGH">Alta</option>
              <option value="MEDIUM">Média</option>
              <option value="LOW">Baixa</option>
              <option value="UNKNOWN">Desconhecida</option>
            </select>
          </label>
        </div>

        {!filteredRecords.length ? (
          <EmptyState title="Nenhum computador no filtro" description="Ajuste a busca ou aguarde o próximo snapshot do servidor local." />
        ) : (
          <div className="max-w-full overflow-x-auto rounded-lg border border-border bg-white">
            <table className="w-full min-w-[1040px] border-collapse text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-border bg-gradient-to-b from-slate-50 to-white text-[10.5px] font-black uppercase tracking-wide text-muted">
                  <th className="px-3 py-2">Máquina</th>
                  <th className="px-3 py-2">Usuário Windows</th>
                  <th className="px-3 py-2">WB/Login</th>
                  <th className="px-3 py-2">IP</th>
                  <th className="px-3 py-2">Sessão</th>
                  <th className="px-3 py-2">Ociosidade</th>
                  <th className="px-3 py-2">Última atividade</th>
                  <th className="px-3 py-2">Identidade</th>
                  <th className="px-3 py-2">Processo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70 bg-white">
                {filteredRecords.map((record) => (
                  <tr key={record.id} className="transition-colors hover:bg-blue-50/35">
                    <td className="px-3 py-2 font-black text-navy-950">{record.hostname}</td>
                    <td className="px-3 py-2 font-bold text-slate-700">{record.windowsUser || "-"}</td>
                    <td className="px-3 py-2 font-bold text-slate-700">{record.wbLogin || "-"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">{record.ipAddress || "-"}</td>
                    <td className="px-3 py-2">
                      <SessionBadge record={record} />
                    </td>
                    <td className="px-3 py-2 font-bold text-slate-700">{formatIdle(record.idleSeconds)}</td>
                    <td className="px-3 py-2 font-bold text-slate-700">{formatDateTime(record.lastActivityAt)}</td>
                    <td className="px-3 py-2">
                      <IdentityBadge confidence={record.identityConfidence} />
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-2 font-bold text-slate-600" title={record.activeWindowTitle || record.activeProcessName}>
                      {record.activeProcessName || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Histórico de uploads">
        {!importsPayload?.data?.length ? (
          <EmptyState title="Sem histórico" description="Os uploads aparecerão aqui depois do primeiro envio do servidor local." />
        ) : (
          <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
            {importsPayload.data.map((item) => (
              <div key={item.id} className="rounded-lg border border-border bg-white p-3 shadow-soft">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-50 text-blue-600">
                    <History className="h-4 w-4" />
                  </span>
                  <StatusBadge status={item.status === "PARTIAL" ? "Parcial" : "Sucesso"} />
                </div>
                <p className="text-sm font-black text-navy-950">{formatDateTime(item.capturedAt)}</p>
                <p className="mt-1 text-xs font-bold text-muted">{item.source}</p>
                <div className="mt-2 grid grid-cols-3 gap-1 text-center text-xs">
                  <MiniMetric label="Total" value={item.rowsTotal} />
                  <MiniMetric label="Válidos" value={item.rowsValid} />
                  <MiniMetric label="Erro" value={item.rowsError} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function SnapshotMeta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-slate-50/70 px-3 py-2">
      <p className="text-[10.5px] font-black uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-1 min-w-0 break-words text-sm font-extrabold text-navy-950">{value || "-"}</div>
    </div>
  );
}

function ProgressCard({
  label,
  value,
  total,
  percentValue,
  tone
}: {
  label: string;
  value: number;
  total: number;
  percentValue: number;
  tone: "green" | "orange" | "blue";
}) {
  const barClass = {
    green: "bg-emerald-500",
    orange: "bg-amber-500",
    blue: "bg-blue-500"
  }[tone];

  return (
    <div className="rounded-lg border border-border bg-white p-3 shadow-soft">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-black text-navy-950">{label}</span>
        <span className="font-extrabold text-muted">{value}/{total}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={cn("h-full rounded-full", barClass)} style={{ width: `${Math.min(100, Math.max(0, percentValue))}%` }} />
      </div>
    </div>
  );
}

function SessionBadge({ record }: { record: RealtimeHoursRecord }) {
  const status = getSessionStatus(record);
  const Icon = status === "Ativa" ? CheckCircle2 : status === "Ociosa" ? Clock : WifiOff;
  const styles =
    status === "Ativa"
      ? "bg-emerald-50 text-emerald-700"
      : status === "Ociosa"
        ? "bg-amber-50 text-amber-700"
        : "bg-slate-100 text-slate-600";

  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-black", styles)}>
      <Icon className="h-3.5 w-3.5" />
      {status}
    </span>
  );
}

function IdentityBadge({ confidence }: { confidence: string }) {
  const label = {
    HIGH: "Alta",
    MEDIUM: "Média",
    LOW: "Baixa",
    UNKNOWN: "Desconhecida"
  }[confidence] ?? confidence;

  const styles =
    confidence === "HIGH"
      ? "bg-emerald-50 text-emerald-700"
      : confidence === "MEDIUM"
        ? "bg-blue-50 text-blue-700"
        : confidence === "LOW"
          ? "bg-amber-50 text-amber-700"
          : "bg-slate-100 text-slate-600";

  return <span className={cn("inline-flex rounded-md px-2 py-1 text-[11px] font-black", styles)}>{label}</span>;
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-slate-50 px-2 py-1.5">
      <p className="font-black text-navy-950">{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}

function getSessionStatus(record: RealtimeHoursRecord) {
  if (!record.isSessionActive) return "Inativa";
  if ((record.idleSeconds ?? 0) >= idleThresholdSeconds) return "Ociosa";
  return "Ativa";
}

function formatIdle(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return "-";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function percent(value: number, total: number) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function normalizeText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function exportCsv(records: RealtimeHoursRecord[]) {
  const headers = [
    "hostname",
    "windowsUser",
    "wbLogin",
    "employeeId",
    "ipAddress",
    "sessionStatus",
    "idleSeconds",
    "lastActivityAt",
    "identityConfidence",
    "identitySource",
    "activeProcessName",
    "activeWindowTitle"
  ];
  const rows = records.map((record) => [
    record.hostname,
    record.windowsUser,
    record.wbLogin,
    record.employeeId,
    record.ipAddress,
    getSessionStatus(record),
    record.idleSeconds ?? "",
    record.lastActivityAt ?? "",
    record.identityConfidence,
    record.identitySource,
    record.activeProcessName,
    record.activeWindowTitle
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `captura-horas-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
