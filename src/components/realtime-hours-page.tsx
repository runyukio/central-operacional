"use client";

import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  History,
  Laptop,
  Link2,
  MonitorCog,
  RefreshCw,
  Search,
  Save,
  ShieldCheck,
  UserRound,
  Wifi,
  WifiOff,
  type LucideIcon
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

type RealtimeHoursTimelineSegment = {
  type: "ACTIVE" | "NO_ACTIVITY";
  start: string;
  end: string;
  durationMs: number;
};

type RealtimeHoursTimelineRow = {
  key: string;
  hostname: string;
  windowsUser: string;
  wbLogin: string;
  employeeId: string;
  employeeName: string;
  roleTitle: string;
  lob: string;
  shift: string;
  ipAddress: string;
  lastSeenAt: string;
  activeMs: number;
  noActivityMs: number;
  sessionCount: number;
  segments: RealtimeHoursTimelineSegment[];
};

type RealtimeHoursTimelinePayload = {
  success: boolean;
  date: string;
  window: { start: string; end: string };
  summary: {
    users: number;
    activeMs: number;
    noActivityMs: number;
    sessions: number;
  };
  rows: RealtimeHoursTimelineRow[];
  error?: string;
  message?: string;
};

type RealtimeHoursIdentityMapping = {
  id: string | null;
  hostname: string;
  windowsUser: string;
  wbLogin: string;
  employeeId: string;
  employeeName: string;
  roleTitle: string;
  lob: string;
  shift: string;
  mapped: boolean;
  lastSeenAt: string | null;
  recordCount: number;
  identityConfidence: string;
};

type RealtimeHoursIdentityMappingsPayload = {
  success: boolean;
  data: RealtimeHoursIdentityMapping[];
  error?: string;
  message?: string;
};

type SessionFilter = "ALL" | "ACTIVE" | "IDLE" | "INACTIVE";
type IdentityFilter = "ALL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
type CaptureTab = "TIMELINE" | "MAPPINGS" | "SNAPSHOT" | "IMPORTS";

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
  const [activeTab, setActiveTab] = useState<CaptureTab>("TIMELINE");
  const [statusPayload, setStatusPayload] = useState<RealtimeHoursStatusPayload | null>(null);
  const [importsPayload, setImportsPayload] = useState<RealtimeHoursImportsPayload | null>(null);
  const [timelinePayload, setTimelinePayload] = useState<RealtimeHoursTimelinePayload | null>(null);
  const [mappingsPayload, setMappingsPayload] = useState<RealtimeHoursIdentityMappingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [search, setSearch] = useState("");
  const [timelineDate, setTimelineDate] = useState(todayInputDate());
  const [expandedTimelineKey, setExpandedTimelineKey] = useState<string | null>(null);
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, string>>({});
  const [savingMappingKey, setSavingMappingKey] = useState<string | null>(null);
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("ALL");
  const [identityFilter, setIdentityFilter] = useState<IdentityFilter>("ALL");

  const loadData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    if (!showRefreshing) setLoading(true);
    setError("");
    setSuccessMessage("");

    try {
      const [statusResponse, importsResponse, timelineResponse, mappingsResponse] = await Promise.all([
        fetch("/api/realtime-hours/status?limit=500", { cache: "no-store" }),
        fetch("/api/realtime-hours/imports?limit=8", { cache: "no-store" }),
        fetch(`/api/realtime-hours/timeline?date=${encodeURIComponent(timelineDate)}`, { cache: "no-store" }),
        fetch("/api/realtime-hours/identity-mappings", { cache: "no-store" })
      ]);

      const [statusBody, importsBody, timelineBody, mappingsBody] = await Promise.all([
        statusResponse.json() as Promise<RealtimeHoursStatusPayload>,
        importsResponse.json() as Promise<RealtimeHoursImportsPayload>,
        timelineResponse.json() as Promise<RealtimeHoursTimelinePayload>,
        mappingsResponse.json() as Promise<RealtimeHoursIdentityMappingsPayload>
      ]);

      if (!statusResponse.ok || statusBody.success === false) {
        throw new Error(statusBody.message || statusBody.error || "Não foi possível carregar a captura de horas.");
      }
      if (!importsResponse.ok || importsBody.success === false) {
        throw new Error(importsBody.message || importsBody.error || "Não foi possível carregar o histórico de uploads.");
      }
      if (!timelineResponse.ok || timelineBody.success === false) {
        throw new Error(timelineBody.message || timelineBody.error || "Não foi possível carregar a linha do tempo.");
      }
      if (!mappingsResponse.ok || mappingsBody.success === false) {
        throw new Error(mappingsBody.message || mappingsBody.error || "Não foi possível carregar os vínculos de usuários Windows.");
      }

      setStatusPayload(statusBody);
      setImportsPayload(importsBody);
      setTimelinePayload(timelineBody);
      setMappingsPayload(mappingsBody);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar a captura de horas.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [timelineDate]);

  useEffect(() => {
    loadData();
    const interval = window.setInterval(() => loadData(true), 60_000);
    return () => window.clearInterval(interval);
  }, [loadData]);

  const summary = statusPayload?.summary ?? emptySummary;
  const batch = statusPayload?.batch ?? null;
  const records = useMemo(() => statusPayload?.records ?? [], [statusPayload?.records]);
  const timelineRows = useMemo(() => {
    const normalizedSearch = normalizeText(search);
    const rows = timelinePayload?.rows ?? [];
    if (!normalizedSearch) return rows;
    return rows.filter((row) => normalizeText([
      row.hostname,
      row.windowsUser,
      row.wbLogin,
      row.employeeName,
      row.lob,
      row.shift,
      row.ipAddress
    ].join(" ")).includes(normalizedSearch));
  }, [search, timelinePayload?.rows]);
  const mappingRows = useMemo(() => {
    const normalizedSearch = normalizeText(search);
    const rows = mappingsPayload?.data ?? [];
    if (!normalizedSearch) return rows;
    return rows.filter((row) => normalizeText([
      row.hostname,
      row.windowsUser,
      row.wbLogin,
      row.employeeName,
      row.lob,
      row.shift
    ].join(" ")).includes(normalizedSearch));
  }, [mappingsPayload?.data, search]);

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

  async function saveMapping(row: RealtimeHoursIdentityMapping) {
    const key = mappingRowKey(row);
    const wbLogin = (mappingDrafts[key] ?? row.wbLogin).trim();
    setSavingMappingKey(key);
    setError("");
    setSuccessMessage("");

    try {
      const response = await fetch("/api/realtime-hours/identity-mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostname: row.hostname,
          windowsUser: row.windowsUser,
          wbLogin
        })
      });
      const body = await response.json() as { success?: boolean; message?: string; error?: string };
      if (!response.ok || body.success === false) {
        throw new Error(body.message || body.error || "Não foi possível salvar o vínculo.");
      }
      setSuccessMessage(wbLogin ? "Vínculo salvo e aplicado ao histórico capturado." : "Vínculo removido.");
      setMappingDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      await loadData(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar o vínculo.");
    } finally {
      setSavingMappingKey(null);
    }
  }

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

      {successMessage ? (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-sm font-bold text-emerald-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      ) : null}

      <div className="rounded-2xl border border-border bg-white p-2 shadow-soft">
        <div className="flex flex-wrap items-center gap-2">
          <CaptureTabButton active={activeTab === "TIMELINE"} onClick={() => setActiveTab("TIMELINE")} icon={Clock} label="Linha do tempo" />
          <CaptureTabButton active={activeTab === "MAPPINGS"} onClick={() => setActiveTab("MAPPINGS")} icon={Link2} label="Vínculos" />
          <CaptureTabButton active={activeTab === "SNAPSHOT"} onClick={() => setActiveTab("SNAPSHOT")} icon={MonitorCog} label="Snapshot" />
          <CaptureTabButton active={activeTab === "IMPORTS"} onClick={() => setActiveTab("IMPORTS")} icon={History} label="Uploads" />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Máquinas" value={summary.distinctHosts} helper={`${summary.totalRecords} registro(s)`} icon={Laptop} tone="blue" />
        <StatCard title="Sessões ativas" value={summary.activeSessions} helper={`${activePercent}% do snapshot`} icon={Wifi} tone="green" />
        <StatCard title="Ociosas" value={summary.idleSessions} helper={`${idlePercent}% acima de 5 min`} icon={Clock} tone={summary.idleSessions ? "orange" : "green"} />
        <StatCard title="Identificadas" value={summary.identifiedRecords} helper={`${identifiedPercent}% com identidade`} icon={ShieldCheck} tone="purple" />
      </div>

      {activeTab === "TIMELINE" ? (
        <TimelinePanel
          loading={loading}
          date={timelineDate}
          onDateChange={setTimelineDate}
          search={search}
          onSearchChange={setSearch}
          payload={timelinePayload}
          rows={timelineRows}
          expandedKey={expandedTimelineKey}
          onToggleExpanded={(key) => setExpandedTimelineKey((current) => current === key ? null : key)}
        />
      ) : null}

      {activeTab === "MAPPINGS" ? (
        <MappingsPanel
          rows={mappingRows}
          drafts={mappingDrafts}
          savingKey={savingMappingKey}
          onDraftChange={(key, value) => setMappingDrafts((current) => ({ ...current, [key]: value }))}
          onSave={saveMapping}
          search={search}
          onSearchChange={setSearch}
        />
      ) : null}

      {activeTab === "SNAPSHOT" ? (
        <>
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

          <SnapshotRecordsPanel
            records={filteredRecords}
            search={search}
            onSearchChange={setSearch}
            sessionFilter={sessionFilter}
            onSessionFilterChange={setSessionFilter}
            identityFilter={identityFilter}
            onIdentityFilterChange={setIdentityFilter}
          />
        </>
      ) : null}

      {activeTab === "IMPORTS" ? (
        <UploadsPanel imports={importsPayload?.data ?? []} />
      ) : null}
    </div>
  );
}

function CaptureTabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-black transition",
        active ? "bg-blue-600 text-white shadow-soft" : "bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-navy-950"
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function TimelinePanel({
  loading,
  date,
  onDateChange,
  search,
  onSearchChange,
  payload,
  rows,
  expandedKey,
  onToggleExpanded
}: {
  loading: boolean;
  date: string;
  onDateChange: (value: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  payload: RealtimeHoursTimelinePayload | null;
  rows: RealtimeHoursTimelineRow[];
  expandedKey: string | null;
  onToggleExpanded: (key: string) => void;
}) {
  return (
    <Panel title="Linha do tempo diária">
      <div className="mb-4 grid gap-2.5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <label className="relative block">
          <span className="sr-only">Data</span>
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-600" />
          <input
            type="date"
            value={date}
            onChange={(event) => onDateChange(event.target.value)}
            className="premium-control h-10 w-full pl-9 pr-3 text-sm font-black text-navy-950 outline-none"
          />
        </label>

        <label className="relative block">
          <span className="sr-only">Buscar</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            className="premium-control h-10 w-full pl-9 pr-3 text-sm font-bold outline-none"
            placeholder="Buscar por colaborador, WB, usuário Windows, máquina ou IP"
          />
        </label>
      </div>

      {loading ? (
        <div className="grid min-h-[260px] place-items-center text-sm font-bold text-muted">
          <span className="inline-flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
            Montando linha do tempo...
          </span>
        </div>
      ) : !payload?.rows?.length ? (
        <EmptyState title="Sem captura para esta data" description="Escolha outra data ou aguarde o servidor local enviar novos snapshots." />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-2.5 md:grid-cols-3">
            <TimelineSummaryCard title="Tempo ativo" value={formatDurationMs(payload.summary.activeMs)} tone="green" />
            <TimelineSummaryCard title="Sem atividade" value={formatDurationMs(payload.summary.noActivityMs)} tone="slate" />
            <TimelineSummaryCard title="Sessões" value={payload.summary.sessions} tone="blue" />
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-white">
            <table className="w-full min-w-[1180px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-[11px] font-black uppercase tracking-wide text-muted">
                  <th className="w-14 px-3 py-3">Ação</th>
                  <th className="w-[270px] px-3 py-3">Colaborador</th>
                  <th className="w-32 px-3 py-3">Data</th>
                  <th className="w-28 px-3 py-3">Duração</th>
                  <th className="w-40 px-3 py-3">Período</th>
                  <th className="px-3 py-3">Timeline 24h</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {rows.map((row) => (
                  <TimelineTableRow
                    key={row.key}
                    row={row}
                    date={date}
                    windowStart={payload.window.start}
                    windowEnd={payload.window.end}
                    expanded={expandedKey === row.key}
                    onToggle={() => onToggleExpanded(row.key)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}

function TimelineTableRow({
  row,
  date,
  windowStart,
  windowEnd,
  expanded,
  onToggle
}: {
  row: RealtimeHoursTimelineRow;
  date: string;
  windowStart: string;
  windowEnd: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="align-middle transition-colors hover:bg-blue-50/30">
        <td className="px-3 py-3">
          <button
            type="button"
            onClick={onToggle}
            className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-white text-blue-600 shadow-soft transition hover:bg-blue-50"
            title={expanded ? "Ocultar sessões" : "Ver sessões"}
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
          </button>
        </td>
        <td className="px-3 py-3">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-600">
              <UserRound className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-navy-950">{row.employeeName || row.wbLogin || row.windowsUser || row.hostname}</p>
              <p className="truncate text-xs font-bold text-muted">
                {row.wbLogin || "Sem WB"} · {row.windowsUser || "Sem usuário Windows"} · {row.hostname}
              </p>
            </div>
          </div>
        </td>
        <td className="px-3 py-3">
          <p className="text-sm font-black text-navy-950">{formatDateLabel(date)}</p>
          <p className="text-xs font-bold text-muted">{row.sessionCount} sessão(ões)</p>
        </td>
        <td className="px-3 py-3 text-sm font-black text-emerald-600">{formatDurationMs(row.activeMs)}</td>
        <td className="px-3 py-3 text-sm font-bold text-slate-700">00:00 - 23:59</td>
        <td className="px-3 py-3">
          <TimelineBar row={row} windowStart={windowStart} windowEnd={windowEnd} />
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={6} className="bg-slate-50/70 px-3 py-4">
            <ActivityBreakdown row={row} date={date} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function TimelineBar({ row, windowStart, windowEnd }: { row: RealtimeHoursTimelineRow; windowStart: string; windowEnd: string }) {
  const startMs = new Date(windowStart).getTime();
  const endMs = new Date(windowEnd).getTime();
  const totalMs = Math.max(1, endMs - startMs);

  return (
    <div className="relative pt-5">
      <div className="absolute inset-x-0 top-0 grid grid-cols-6 text-center text-[11px] font-bold text-slate-400">
        <span>2 AM</span>
        <span>6 AM</span>
        <span>10 AM</span>
        <span>2 PM</span>
        <span>6 PM</span>
        <span>10 PM</span>
      </div>
      <div className="relative h-8 overflow-hidden rounded-md border-2 border-slate-700 bg-slate-100 shadow-inner">
        {row.segments.filter((segment) => segment.type === "ACTIVE").map((segment, index) => {
          const segmentStart = new Date(segment.start).getTime();
          const segmentEnd = new Date(segment.end).getTime();
          const left = ((segmentStart - startMs) / totalMs) * 100;
          const width = Math.max(0.2, ((segmentEnd - segmentStart) / totalMs) * 100);
          return (
            <span
              key={`${segment.start}-${index}`}
              className="absolute bottom-1 top-1 rounded bg-emerald-500"
              style={{ left: `${Math.max(0, left)}%`, width: `${Math.min(100 - Math.max(0, left), width)}%` }}
              title={`${formatTimeOnly(segment.start)} - ${formatTimeOnly(segment.end)} · ${formatDurationMs(segment.durationMs)}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function ActivityBreakdown({ row, date }: { row: RealtimeHoursTimelineRow; date: string }) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-black text-navy-950">Detalhe de atividade - {formatDateLabel(date)}</p>
      <div className="grid gap-2.5 md:grid-cols-3">
        <TimelineSummaryCard title="Tempo ativo" value={formatDurationMs(row.activeMs)} tone="green" />
        <TimelineSummaryCard title="Sem atividade" value={formatDurationMs(row.noActivityMs)} tone="slate" />
        <TimelineSummaryCard title="Sessões" value={row.sessionCount} tone="blue" />
      </div>
      <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
        {row.segments.map((segment, index) => (
          <div
            key={`${segment.start}-${index}`}
            className={cn(
              "grid grid-cols-[minmax(140px,1fr)_180px_90px] items-center gap-3 rounded-lg border px-3 py-2 text-sm font-bold",
              segment.type === "ACTIVE" ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500"
            )}
          >
            <span className="inline-flex items-center gap-2">
              <span className={cn("h-2 w-2 rounded-full", segment.type === "ACTIVE" ? "bg-emerald-500" : "bg-slate-400")} />
              {segment.type === "ACTIVE" ? "Ativo" : "Sem atividade"}
            </span>
            <span className="text-center text-slate-600">{formatTimeOnly(segment.start)} - {formatTimeOnly(segment.end)}</span>
            <span className="text-right text-navy-950">{formatDurationMs(segment.durationMs)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineSummaryCard({ title, value, tone }: { title: string; value: ReactNode; tone: "green" | "slate" | "blue" }) {
  const styles = {
    green: "border-emerald-100 bg-emerald-50 text-emerald-700",
    slate: "border-slate-200 bg-white text-slate-600",
    blue: "border-blue-100 bg-blue-50 text-blue-700"
  }[tone];
  return (
    <div className={cn("rounded-xl border px-3 py-3", styles)}>
      <p className="text-[11px] font-black uppercase tracking-wide opacity-80">{title}</p>
      <p className="mt-1 text-lg font-black">{value}</p>
    </div>
  );
}

function MappingsPanel({
  rows,
  drafts,
  savingKey,
  onDraftChange,
  onSave,
  search,
  onSearchChange
}: {
  rows: RealtimeHoursIdentityMapping[];
  drafts: Record<string, string>;
  savingKey: string | null;
  onDraftChange: (key: string, value: string) => void;
  onSave: (row: RealtimeHoursIdentityMapping) => void;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  return (
    <Panel title={`Vínculos Windows -> WB/Login (${rows.length})`}>
      <div className="mb-3 grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_auto]">
        <label className="relative block">
          <span className="sr-only">Buscar vínculo</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            className="premium-control h-10 w-full pl-9 pr-3 text-sm font-bold outline-none"
            placeholder="Buscar máquina, usuário Windows, WB ou colaborador"
          />
        </label>
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
          Salve vazio para remover vínculo.
        </div>
      </div>

      {!rows.length ? (
        <EmptyState title="Nenhum usuário Windows encontrado" description="Os usuários aparecerão depois que o servidor local enviar os primeiros snapshots." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-white">
          <table className="w-full min-w-[980px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-slate-50 text-[11px] font-black uppercase tracking-wide text-muted">
                <th className="px-3 py-3">Máquina</th>
                <th className="px-3 py-3">Usuário Windows</th>
                <th className="px-3 py-3">Colaborador atual</th>
                <th className="px-3 py-3">Novo WB/Login</th>
                <th className="px-3 py-3">Último sinal</th>
                <th className="px-3 py-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {rows.map((row) => {
                const key = mappingRowKey(row);
                const value = drafts[key] ?? row.wbLogin;
                return (
                  <tr key={key} className="transition-colors hover:bg-blue-50/30">
                    <td className="px-3 py-3 font-black text-navy-950">{row.hostname}</td>
                    <td className="px-3 py-3 font-bold text-slate-700">{row.windowsUser}</td>
                    <td className="px-3 py-3">
                      <p className="font-black text-navy-950">{row.employeeName || row.wbLogin || "-"}</p>
                      <p className="text-xs font-bold text-muted">{row.wbLogin || "Sem WB"} · {row.lob || "Sem LOB"} · {row.shift || "Sem turno"}</p>
                    </td>
                    <td className="px-3 py-3">
                      <input
                        value={value}
                        onChange={(event) => onDraftChange(key, event.target.value)}
                        className="premium-control h-9 w-full px-3 text-sm font-bold outline-none"
                        placeholder="wb_login"
                      />
                    </td>
                    <td className="px-3 py-3 font-bold text-slate-600">{formatDateTime(row.lastSeenAt)}</td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => onSave(row)}
                        disabled={savingKey === key}
                        className="premium-button inline-flex h-9 items-center gap-2 px-3 text-sm font-black disabled:cursor-wait disabled:opacity-70"
                      >
                        <Save className="h-4 w-4" />
                        Salvar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function SnapshotRecordsPanel({
  records,
  search,
  onSearchChange,
  sessionFilter,
  onSessionFilterChange,
  identityFilter,
  onIdentityFilterChange
}: {
  records: RealtimeHoursRecord[];
  search: string;
  onSearchChange: (value: string) => void;
  sessionFilter: SessionFilter;
  onSessionFilterChange: (value: SessionFilter) => void;
  identityFilter: IdentityFilter;
  onIdentityFilterChange: (value: IdentityFilter) => void;
}) {
  return (
    <Panel title={`Computadores (${records.length})`}>
      <div className="mb-3 grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_160px_180px]">
        <label className="relative block">
          <span className="sr-only">Buscar</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            className="premium-control h-10 w-full pl-9 pr-3 text-sm font-bold outline-none"
            placeholder="Buscar máquina, usuário, login ou IP"
          />
        </label>

        <label className="block">
          <span className="sr-only">Sessão</span>
          <select
            value={sessionFilter}
            onChange={(event) => onSessionFilterChange(event.target.value as SessionFilter)}
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
            onChange={(event) => onIdentityFilterChange(event.target.value as IdentityFilter)}
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

      {!records.length ? (
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
              {records.map((record) => (
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
  );
}

function UploadsPanel({ imports }: { imports: RealtimeHoursImport[] }) {
  return (
    <Panel title="Histórico de uploads">
      {!imports.length ? (
        <EmptyState title="Sem histórico" description="Os uploads aparecerão aqui depois do primeiro envio do servidor local." />
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
          {imports.map((item) => (
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

function formatTimeOnly(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDateLabel(value: string) {
  const date = new Date(`${value}T12:00:00-03:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function formatDurationMs(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0m";
  const totalMinutes = Math.floor(value / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m`;
}

function todayInputDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function mappingRowKey(row: Pick<RealtimeHoursIdentityMapping, "hostname" | "windowsUser">) {
  return `${row.hostname.trim().toLowerCase()}::${row.windowsUser.trim().toLowerCase()}`;
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
