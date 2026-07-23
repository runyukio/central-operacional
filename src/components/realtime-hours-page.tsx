"use client";

import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  Laptop,
  Link2,
  MonitorCog,
  WifiOff,
  RefreshCw,
  Search,
  Save,
  ShieldCheck,
  UserRound,
  Wifi,
  type LucideIcon
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import {
  compareRealtimeHoursPlannedShift as comparePlannedShift,
  filterRealtimeHoursTimelineRows,
  realtimeHoursPlannedShiftLabel as plannedShiftLabel,
  realtimeHoursScheduleStatusLabel as scheduleStatusLabel,
  type RealtimeHoursPresenceStatus,
  type RealtimeHoursScheduleFilter,
  type RealtimeHoursShiftFilter
} from "@/lib/realtime-hours-timeline";
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
  lockedSessions: number;
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
  eventType: string;
  sessionId: number | null;
  sessionState: string;
  agentVersion: string;
  capturedAt: string;
  hostname: string;
  windowsUser: string;
  wbLogin: string;
  employeeId: string;
  ipAddress: string;
  isSessionActive: boolean;
  isInputActive: boolean | null;
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

type RealtimeHoursTimelineSegment = {
  type: "ACTIVE" | "NO_ACTIVITY";
  start: string;
  end: string;
  durationMs: number;
};

type RealtimeHoursPlannedShift = {
  id: string;
  start: string;
  end: string;
  startsAt: string;
  endsAt: string;
  status: string;
  shift: string;
  sourceDate: string;
  overnight: boolean;
};

type RealtimeHoursTimelineRow = {
  key: string;
  data: string;
  slotId: string | null;
  hostname: string;
  hostnames: string[];
  windowsUser: string;
  windowsUsers: string[];
  deviceCount: number;
  devices: Array<{
    hostname: string;
    windowsUser: string;
    ipAddress: string;
    lastSeenAt: string;
  }>;
  wbLogin: string;
  employeeId: string;
  employeeName: string;
  roleTitle: string;
  lob: string;
  shift: string;
  supervisor: string;
  ipAddress: string;
  lastSeenAt: string;
  currentStatus: RealtimeHoursPresenceStatus;
  activeMs: number;
  noActivityMs: number;
  entryAt: string | null;
  exitAt: string | null;
  arrivalDelayMs: number;
  earlyDepartureMs: number;
  sessionCount: number;
  plannedShifts: RealtimeHoursPlannedShift[];
  segments: RealtimeHoursTimelineSegment[];
};

type RealtimeHoursTimelinePayload = {
  success: boolean;
  date: string;
  window: { start: string; end: string; calculationEnd: string };
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

type CaptureTab = "TIMELINE" | "MAPPINGS";
type MappingMatchFilter = "ALL" | "FOUND" | "NOT_FOUND";

type RealtimeHoursPageProps = {
  canManageMappings?: boolean;
};

const emptySummary: RealtimeHoursSummary = {
  totalRecords: 0,
  distinctHosts: 0,
  activeSessions: 0,
  inactiveSessions: 0,
  idleSessions: 0,
  lockedSessions: 0,
  identifiedRecords: 0,
  unknownIdentityRecords: 0,
  identityConfidence: {
    high: 0,
    medium: 0,
    low: 0,
    unknown: 0
  }
};

const emptyMappingsPayload: RealtimeHoursIdentityMappingsPayload = { success: true, data: [] };
const ALL_LOBS_FILTER = "__ALL_LOBS__";

export function RealtimeHoursPage({ canManageMappings = false }: RealtimeHoursPageProps) {
  const [activeTab, setActiveTab] = useState<CaptureTab>("TIMELINE");
  const [statusPayload, setStatusPayload] = useState<RealtimeHoursStatusPayload | null>(null);
  const [timelinePayload, setTimelinePayload] = useState<RealtimeHoursTimelinePayload | null>(null);
  const [mappingsPayload, setMappingsPayload] = useState<RealtimeHoursIdentityMappingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [search, setSearch] = useState("");
  const [lobFilter, setLobFilter] = useState(ALL_LOBS_FILTER);
  const [presenceFilter, setPresenceFilter] = useState<"ALL" | RealtimeHoursPresenceStatus>("ALL");
  const [supervisorFilter, setSupervisorFilter] = useState("ALL");
  const [shiftFilter, setShiftFilter] = useState<RealtimeHoursShiftFilter>("ALL");
  const [scheduleFilter, setScheduleFilter] = useState<RealtimeHoursScheduleFilter>("ALL");
  const [mappingMatchFilter, setMappingMatchFilter] = useState<MappingMatchFilter>("ALL");
  const [timelineDate, setTimelineDate] = useState(todayInputDate());
  const [expandedTimelineKey, setExpandedTimelineKey] = useState<string | null>(null);
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, string>>({});
  const [savingMappingKey, setSavingMappingKey] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const loadData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    if (!showRefreshing) setLoading(true);
    setError("");
    setSuccessMessage("");

    try {
      const mappingsRequest = canManageMappings
        ? fetch("/api/realtime-hours/identity-mappings", { cache: "no-store" })
        : Promise.resolve(null);
      const [statusResponse, timelineResponse, mappingsResponse] = await Promise.all([
        fetch("/api/realtime-hours/status?limit=500", { cache: "no-store" }),
        fetch(`/api/realtime-hours/timeline?date=${encodeURIComponent(timelineDate)}`, { cache: "no-store" }),
        mappingsRequest
      ]);

      const [statusBody, timelineBody, mappingsBody] = await Promise.all([
        statusResponse.json() as Promise<RealtimeHoursStatusPayload>,
        timelineResponse.json() as Promise<RealtimeHoursTimelinePayload>,
        mappingsResponse
          ? mappingsResponse.json() as Promise<RealtimeHoursIdentityMappingsPayload>
          : Promise.resolve(emptyMappingsPayload)
      ]);

      if (!statusResponse.ok || statusBody.success === false) {
        throw new Error(statusBody.message || statusBody.error || "Não foi possível carregar a captura de horas.");
      }
      if (!timelineResponse.ok || timelineBody.success === false) {
        throw new Error(timelineBody.message || timelineBody.error || "Não foi possível carregar a linha do tempo.");
      }
      if (canManageMappings && mappingsResponse && (!mappingsResponse.ok || mappingsBody.success === false)) {
        throw new Error(mappingsBody.message || mappingsBody.error || "Não foi possível carregar os vínculos de usuários Windows.");
      }

      setStatusPayload(statusBody);
      setTimelinePayload(timelineBody);
      setMappingsPayload(mappingsBody);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar a captura de horas.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [canManageMappings, timelineDate]);

  useEffect(() => {
    loadData();
    const interval = window.setInterval(() => loadData(true), 60_000);
    return () => window.clearInterval(interval);
  }, [loadData]);

  const summary = statusPayload?.summary ?? emptySummary;
  const batch = statusPayload?.batch ?? null;
  const lobOptions = useMemo(() => buildLobOptions(timelinePayload?.rows ?? []), [timelinePayload?.rows]);
  const supervisorOptions = useMemo(() => buildSupervisorOptions(timelinePayload?.rows ?? []), [timelinePayload?.rows]);
  const timelineRows = useMemo(() => {
    return filterRealtimeHoursTimelineRows(timelinePayload?.rows ?? [], {
      date: timelineDate,
      search,
      lob: lobFilter,
      presence: presenceFilter,
      supervisor: supervisorFilter,
      shift: shiftFilter,
      schedule: scheduleFilter
    });
  }, [lobFilter, presenceFilter, scheduleFilter, search, shiftFilter, supervisorFilter, timelineDate, timelinePayload?.rows]);

  useEffect(() => {
    if (lobFilter !== ALL_LOBS_FILTER && !lobOptions.some((option) => option.value === lobFilter)) {
      setLobFilter(ALL_LOBS_FILTER);
    }
  }, [lobFilter, lobOptions]);
  useEffect(() => {
    if (supervisorFilter !== "ALL" && !supervisorOptions.includes(supervisorFilter)) {
      setSupervisorFilter("ALL");
    }
  }, [supervisorFilter, supervisorOptions]);
  const mappingRows = useMemo(() => {
    const normalizedSearch = normalizeText(search);
    const rows = mappingsPayload?.data ?? [];
    return rows.filter((row) => {
      const hasLob = normalizedLob(row.lob) !== "SEM_LOB";
      if (mappingMatchFilter === "FOUND" && !hasLob) return false;
      if (mappingMatchFilter === "NOT_FOUND" && hasLob) return false;
      return normalizedSearch
        ? normalizeText([
          row.hostname,
          row.windowsUser,
          row.wbLogin,
          row.employeeName,
          row.lob,
          row.shift
        ].join(" ")).includes(normalizedSearch)
        : true;
    });
  }, [mappingMatchFilter, mappingsPayload?.data, search]);

  const onlineSessions = Math.max(0, summary.activeSessions - summary.idleSessions);
  const onlinePercent = percent(onlineSessions, summary.totalRecords);
  const lockedPercent = percent(summary.lockedSessions, summary.totalRecords);
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

  async function exportTimeline() {
    setExporting(true);
    setError("");
    setSuccessMessage("");
    try {
      const params = new URLSearchParams({
        date: timelineDate,
        search,
        lob: lobFilter,
        presence: presenceFilter,
        supervisor: supervisorFilter,
        shift: shiftFilter,
        schedule: scheduleFilter
      });
      await downloadFile(
        `/api/realtime-hours/export?${params.toString()}`,
        `captura_de_horas_${todayInputDate()}.xlsx`,
        "Não foi possível exportar a Captura de Horas."
      );
      setSuccessMessage("Arquivo Excel gerado com os filtros selecionados.");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Não foi possível exportar a Captura de Horas.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Captura de Horas"
        description="Sinal das sessões Windows enviado diretamente pelos computadores da operação."
        icon={MonitorCog}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={exportTimeline}
              disabled={exporting || loading || !timelineRows.length}
              className="premium-control inline-flex h-9 items-center gap-2 px-3 text-sm font-extrabold text-navy-950 disabled:cursor-wait disabled:opacity-50"
              title="Exportar registros filtrados"
            >
              {exporting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {exporting ? "Exportando..." : "Exportar"}
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
          {canManageMappings ? (
            <CaptureTabButton active={activeTab === "MAPPINGS"} onClick={() => setActiveTab("MAPPINGS")} icon={Link2} label="Vínculos" />
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <OverviewMetricCard
          title="Online"
          value={onlineSessions}
          helper={`${onlinePercent}% com atividade recente`}
          icon={Wifi}
          tone="green"
        />
        <OverviewMetricCard
          title="Tela bloqueada"
          value={summary.lockedSessions}
          helper={`${lockedPercent}% do sinal atual`}
          icon={Laptop}
          tone="blue"
        />
        <OverviewMetricCard
          title="Ociosas"
          value={summary.idleSessions}
          helper={`${idlePercent}% sem interação há 5 min`}
          icon={Clock}
          tone="orange"
        />
        <OverviewMetricCard
          title="WB identificado"
          value={summary.identifiedRecords}
          helper={`${identifiedPercent}% com vínculo encontrado`}
          icon={ShieldCheck}
          tone="purple"
        />
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
          lobFilter={lobFilter}
          lobOptions={lobOptions}
          onLobFilterChange={setLobFilter}
          presenceFilter={presenceFilter}
          onPresenceFilterChange={setPresenceFilter}
          supervisorFilter={supervisorFilter}
          supervisorOptions={supervisorOptions}
          onSupervisorFilterChange={setSupervisorFilter}
          shiftFilter={shiftFilter}
          onShiftFilterChange={setShiftFilter}
          scheduleFilter={scheduleFilter}
          onScheduleFilterChange={setScheduleFilter}
          expandedKey={expandedTimelineKey}
          onToggleExpanded={(key) => setExpandedTimelineKey((current) => current === key ? null : key)}
        />
      ) : null}

      {canManageMappings && activeTab === "MAPPINGS" ? (
        <MappingsPanel
          rows={mappingRows}
          drafts={mappingDrafts}
          savingKey={savingMappingKey}
          onDraftChange={(key, value) => setMappingDrafts((current) => ({ ...current, [key]: value }))}
          onSave={saveMapping}
          search={search}
          onSearchChange={setSearch}
          matchFilter={mappingMatchFilter}
          onMatchFilterChange={setMappingMatchFilter}
        />
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

function OverviewMetricCard({
  title,
  value,
  helper,
  icon: Icon,
  tone
}: {
  title: string;
  value: number;
  helper: string;
  icon: LucideIcon;
  tone: "blue" | "green" | "orange" | "purple";
}) {
  const toneStyles = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-emerald-50 text-emerald-600",
    orange: "bg-amber-50 text-amber-600",
    purple: "bg-violet-50 text-violet-600"
  }[tone];

  return (
    <article className="flex min-h-[106px] w-full items-center gap-3 rounded-xl border border-border bg-white px-4 py-3 shadow-soft">
      <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", toneStyles)}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-black text-navy-950">{title}</span>
        <span className="mt-0.5 block text-2xl font-black leading-none text-navy-950">{value}</span>
        <span className="mt-1.5 block truncate text-xs font-bold text-muted">{helper}</span>
      </span>
    </article>
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
  lobFilter,
  lobOptions,
  onLobFilterChange,
  presenceFilter,
  onPresenceFilterChange,
  supervisorFilter,
  supervisorOptions,
  onSupervisorFilterChange,
  shiftFilter,
  onShiftFilterChange,
  scheduleFilter,
  onScheduleFilterChange,
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
  lobFilter: string;
  lobOptions: Array<{ value: string; label: string; count: number }>;
  onLobFilterChange: (value: string) => void;
  presenceFilter: "ALL" | RealtimeHoursPresenceStatus;
  onPresenceFilterChange: (value: "ALL" | RealtimeHoursPresenceStatus) => void;
  supervisorFilter: string;
  supervisorOptions: string[];
  onSupervisorFilterChange: (value: string) => void;
  shiftFilter: RealtimeHoursShiftFilter;
  onShiftFilterChange: (value: RealtimeHoursShiftFilter) => void;
  scheduleFilter: RealtimeHoursScheduleFilter;
  onScheduleFilterChange: (value: RealtimeHoursScheduleFilter) => void;
  expandedKey: string | null;
  onToggleExpanded: (key: string) => void;
}) {
  const visibleSummary = {
    activeMs: rows.reduce((sum, row) => sum + row.activeMs, 0),
    noActivityMs: rows.reduce((sum, row) => sum + row.noActivityMs, 0),
    sessions: rows.reduce((sum, row) => sum + row.sessionCount, 0)
  };

  return (
    <Panel title="Linha do tempo diária">
      <div className="mb-4 grid gap-2.5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-[190px_minmax(250px,1fr)_180px_220px_160px_150px]">
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

        <label className="relative block xl:col-span-2 2xl:col-span-1">
          <span className="sr-only">Buscar</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            className="premium-control h-10 w-full pl-9 pr-3 text-sm font-bold outline-none"
            placeholder="Buscar por colaborador, WB, usuário Windows, máquina ou IP"
          />
        </label>

        <label className="block">
          <span className="sr-only">Status atual</span>
          <select
            value={presenceFilter}
            onChange={(event) => onPresenceFilterChange(event.target.value as "ALL" | RealtimeHoursPresenceStatus)}
            className="premium-control h-10 w-full px-3 text-sm font-black text-navy-950 outline-none"
          >
            <option value="ALL">Todos os status</option>
            <option value="ONLINE">Online</option>
            <option value="LOCKED">Tela bloqueada</option>
            <option value="IDLE">Ocioso</option>
            <option value="OFFLINE">Offline</option>
          </select>
        </label>

        <label className="block">
          <span className="sr-only">Supervisor</span>
          <select
            value={supervisorFilter}
            onChange={(event) => onSupervisorFilterChange(event.target.value)}
            className="premium-control h-10 w-full px-3 text-sm font-black text-navy-950 outline-none"
          >
            <option value="ALL">Todos os supervisores</option>
            {supervisorOptions.map((supervisor) => <option key={supervisor} value={supervisor}>{supervisor}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="sr-only">Turno</span>
          <select
            value={shiftFilter}
            onChange={(event) => onShiftFilterChange(event.target.value as RealtimeHoursShiftFilter)}
            className="premium-control h-10 w-full px-3 text-sm font-black text-navy-950 outline-none"
          >
            <option value="ALL">Todos</option>
            <option value="MANHA">Manhã</option>
            <option value="TARDE">Tarde</option>
            <option value="NOITE">Noite</option>
          </select>
        </label>

        <label className="block">
          <span className="sr-only">Escala</span>
          <select
            value={scheduleFilter}
            onChange={(event) => onScheduleFilterChange(event.target.value as RealtimeHoursScheduleFilter)}
            className="premium-control h-10 w-full px-3 text-sm font-black text-navy-950 outline-none"
          >
            <option value="ALL">Total</option>
            <option value="SCHEDULED">Escalado</option>
          </select>
        </label>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-black uppercase tracking-wide text-muted">LOB</span>
        <LobSlicerButton
          active={lobFilter === ALL_LOBS_FILTER}
          label="Todas"
          count={lobOptions.reduce((sum, option) => sum + option.count, 0)}
          onClick={() => onLobFilterChange(ALL_LOBS_FILTER)}
        />
        {lobOptions.map((option) => (
          <LobSlicerButton
            key={option.value}
            active={lobFilter === option.value}
            label={option.label}
            count={option.count}
            onClick={() => onLobFilterChange(option.value)}
          />
        ))}
      </div>

      {loading ? (
        <div className="grid min-h-[260px] place-items-center text-sm font-bold text-muted">
          <span className="inline-flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
            Montando linha do tempo...
          </span>
        </div>
      ) : !payload?.rows?.length ? (
        <EmptyState title="Sem captura para esta data" description="Escolha outra data ou aguarde os agentes Windows enviarem novos sinais." />
      ) : !rows.length ? (
        <EmptyState title="Nenhum agente neste filtro" description="Ajuste a busca ou selecione outros filtros." />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-2.5 md:grid-cols-3">
            <TimelineSummaryCard title="Tempo ativo" value={formatDurationMs(visibleSummary.activeMs)} tone="green" />
            <TimelineSummaryCard title="Sem atividade" value={formatDurationMs(visibleSummary.noActivityMs)} tone="slate" />
            <TimelineSummaryCard title="Sessões" value={visibleSummary.sessions} tone="blue" />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-500">
            <span>{rows.length} registro(s) de slot exibido(s)</span>
            <div className="flex flex-wrap items-center gap-3">
              <TimelineLegend color="bg-emerald-500" label="Atividade real" />
              <TimelineLegend color="bg-blue-500" label="Jornada prevista" />
              <TimelineLegend color="bg-amber-400" label="Atraso" />
              <TimelineLegend color="bg-red-400" label="Saída antecipada" />
              <TimelineLegend color="bg-violet-500" label="Hora extra" />
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-white">
            <table className="w-full min-w-[1360px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-[11px] font-black uppercase tracking-wide text-muted">
                  <th className="w-14 px-3 py-3">Ação</th>
                  <th className="w-[270px] px-3 py-3">Colaborador</th>
                  <th className="w-32 px-3 py-3">Data</th>
                  <th className="w-28 px-3 py-3">Duração</th>
                  <th className="w-44 px-3 py-3">Escala prevista</th>
                  <th className="w-[580px] px-3 py-3">Timeline 48h</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {rows.map((row) => (
                  <TimelineTableRow
                    key={row.key}
                    row={row}
                    windowStart={payload.window.start}
                    windowEnd={payload.window.end}
                    calculationEnd={payload.window.calculationEnd ?? payload.window.end}
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

function LobSlicerButton({
  active,
  label,
  count,
  onClick
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-black transition",
        active
          ? "border-blue-600 bg-blue-600 text-white shadow-soft"
          : "border-border bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
      )}
    >
      <span>{label}</span>
      <span className={cn("rounded-md px-1.5 py-0.5 text-[10px]", active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500")}>
        {count}
      </span>
    </button>
  );
}

function TimelineTableRow({
  row,
  windowStart,
  windowEnd,
  calculationEnd,
  expanded,
  onToggle
}: {
  row: RealtimeHoursTimelineRow;
  windowStart: string;
  windowEnd: string;
  calculationEnd: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const shiftComparison = comparePlannedShift(row, row.data, calculationEnd);
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
              <PresenceStatusBadge status={row.currentStatus} />
              <p className="truncate text-xs font-bold text-muted" title={row.hostnames.join(", ")}>
                {row.wbLogin || "Sem WB"} · {row.deviceCount > 1 ? `${row.deviceCount} máquinas` : row.hostname}
              </p>
            </div>
          </div>
        </td>
        <td className="px-3 py-3">
          <p className="text-sm font-black text-navy-950">{formatDateLabel(row.data)}</p>
          <p className="text-xs font-bold text-muted">{row.sessionCount} sessão(ões)</p>
        </td>
        <td className="px-3 py-3 text-sm font-black text-emerald-600">{formatDurationMs(row.activeMs)}</td>
        <td className="px-3 py-3">
          <p className="text-sm font-black text-navy-950">{plannedShiftLabel(row, row.data)}</p>
          <ShiftComparisonBadge comparison={shiftComparison} />
        </td>
        <td className="px-3 py-3">
          <TimelineBar
            row={row}
            windowStart={windowStart}
            windowEnd={windowEnd}
            calculationEnd={calculationEnd}
          />
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={6} className="bg-slate-50/70 px-3 py-4">
            <ActivityBreakdown row={row} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function TimelineLegend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2.5 w-2.5 rounded-sm", color)} />
      {label}
    </span>
  );
}

function TimelineBar({
  row,
  windowStart,
  windowEnd,
  calculationEnd
}: {
  row: RealtimeHoursTimelineRow;
  windowStart: string;
  windowEnd: string;
  calculationEnd: string;
}) {
  const startMs = new Date(windowStart).getTime();
  const endMs = new Date(windowEnd).getTime();
  const comparison = comparePlannedShift(row, row.data, calculationEnd);
  const overtimeRanges = buildOvertimeRanges(row);
  const nextDate = addDaysToDateKey(row.data, 1);

  return (
    <div
      className="max-w-[560px] overflow-x-scroll pb-2"
      role="region"
      aria-label={`Linha do tempo de 48 horas de ${formatShortDate(row.data)} a ${formatShortDate(nextDate)}`}
      tabIndex={0}
    >
      <div className="relative w-[960px] min-w-[960px] pt-11">
        <div className="absolute inset-x-0 top-0 grid grid-cols-2 overflow-hidden rounded-t-md border border-b-0 border-slate-300 text-center text-[10px] font-black uppercase tracking-wide text-slate-500">
          <span className="bg-slate-50 py-1">{formatShortDate(row.data)}</span>
          <span className="border-l-2 border-blue-300 bg-blue-50/60 py-1">{formatShortDate(nextDate)}</span>
        </div>
        <div className="absolute inset-x-0 top-6 grid grid-cols-12 text-center text-[10px] font-bold text-slate-400">
          {["00", "04", "08", "12", "16", "20", "00", "04", "08", "12", "16", "20"].map((hour, index) => (
            <span key={`${hour}-${index}`}>{hour}:00</span>
          ))}
        </div>
        <div className="relative h-11 overflow-hidden rounded-md border-2 border-slate-700 bg-slate-100 shadow-inner">
          <span className="pointer-events-none absolute bottom-0 left-1/2 top-0 z-20 w-0.5 bg-blue-300" aria-hidden="true" />
          <div className="absolute inset-x-0 top-0 h-7 border-b border-slate-200/80 bg-white/70">
            {row.segments.filter((segment) => segment.type === "ACTIVE").map((segment, index) => (
              <TimelineRange
                key={`${segment.start}-${index}`}
                start={new Date(segment.start).getTime()}
                end={new Date(segment.end).getTime()}
                windowStart={startMs}
                windowEnd={endMs}
                className="bottom-1 top-1 rounded bg-emerald-500"
                title={`Atividade real | Entrada: ${formatDateTime(segment.start)} | Saída: ${formatDateTime(segment.end)} | Duração: ${formatDurationMs(segment.durationMs)}`}
              />
            ))}
          </div>

          <div className="absolute inset-x-0 bottom-0 h-3 bg-slate-100">
            {row.plannedShifts.map((shift) => (
              <TimelineRange
                key={shift.id}
                start={new Date(shift.start).getTime()}
                end={new Date(shift.end).getTime()}
                windowStart={startMs}
                windowEnd={endMs}
                className="bottom-[3px] h-1.5 rounded-full bg-blue-500"
                title={`Jornada prevista: ${formatDateTime(shift.start)} até ${formatDateTime(shift.end)} | ${scheduleStatusLabel(shift.status)}`}
              />
            ))}

            {comparison.plannedShift && comparison.arrivalDelayMs > 5 * 60_000 ? (
              <TimelineRange
                start={new Date(comparison.plannedShift.start).getTime()}
                end={comparison.firstActiveAt ?? Math.min(comparison.observedUntil, new Date(comparison.plannedShift.end).getTime())}
                windowStart={startMs}
                windowEnd={endMs}
                className={cn(
                  "bottom-[2px] h-2 rounded-full",
                  comparison.tone === "red" ? "bg-red-400" : "bg-amber-400"
                )}
                title={`Atraso: ${formatDurationMs(comparison.arrivalDelayMs)} | Previsto: ${formatDateTime(comparison.plannedShift.start)} | Entrada: ${row.entryAt ? formatDateTime(row.entryAt) : "não registrada"}`}
              />
            ) : null}

            {comparison.plannedShift && comparison.earlyDepartureMs > 5 * 60_000 && comparison.lastActiveAt ? (
              <TimelineRange
                start={comparison.lastActiveAt}
                end={new Date(comparison.plannedShift.end).getTime()}
                windowStart={startMs}
                windowEnd={endMs}
                className="bottom-[2px] h-2 rounded-full bg-red-400"
                title={`Saída antecipada: ${formatDurationMs(comparison.earlyDepartureMs)} | Saída: ${row.exitAt ? formatDateTime(row.exitAt) : "não registrada"} | Previsto: ${formatDateTime(comparison.plannedShift.end)}`}
              />
            ) : null}

            {overtimeRanges.map((range, index) => (
              <TimelineRange
                key={`overtime-${range.start}-${index}`}
                start={range.start}
                end={range.end}
                windowStart={startMs}
                windowEnd={endMs}
                className="bottom-[2px] h-2 rounded-full bg-violet-500"
                title={`Hora extra | Entrada: ${formatDateTime(new Date(range.start).toISOString())} | Saída: ${formatDateTime(new Date(range.end).toISOString())} | Duração: ${formatDurationMs(range.end - range.start)}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function buildOvertimeRanges(row: RealtimeHoursTimelineRow) {
  const toleranceMs = 5 * 60_000;
  const plannedRanges = row.plannedShifts
    .map((shift) => ({
      start: new Date(shift.start).getTime(),
      end: new Date(shift.end).getTime()
    }))
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
    .sort((left, right) => left.start - right.start);

  if (!plannedRanges.length) return [];

  return row.segments
    .filter((segment) => segment.type === "ACTIVE")
    .flatMap((segment) => {
      const segmentStart = new Date(segment.start).getTime();
      const segmentEnd = new Date(segment.end).getTime();
      if (!Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd) || segmentEnd <= segmentStart) return [];

      const outsideRanges: Array<{ start: number; end: number }> = [];
      let cursor = segmentStart;

      for (const planned of plannedRanges) {
        if (planned.end <= cursor) continue;
        if (planned.start >= segmentEnd) break;
        if (planned.start > cursor) outsideRanges.push({ start: cursor, end: Math.min(planned.start, segmentEnd) });
        cursor = Math.max(cursor, Math.min(segmentEnd, planned.end));
        if (cursor >= segmentEnd) break;
      }

      if (cursor < segmentEnd) outsideRanges.push({ start: cursor, end: segmentEnd });
      return outsideRanges;
    })
    .filter((range) => range.end - range.start > toleranceMs);
}

function TimelineRange({
  start,
  end,
  windowStart,
  windowEnd,
  className,
  title
}: {
  start: number;
  end: number;
  windowStart: number;
  windowEnd: number;
  className: string;
  title: string;
}) {
  const clippedStart = Math.max(windowStart, start);
  const clippedEnd = Math.min(windowEnd, end);
  if (!Number.isFinite(clippedStart) || !Number.isFinite(clippedEnd) || clippedEnd <= clippedStart) return null;
  const totalMs = Math.max(1, windowEnd - windowStart);
  const left = ((clippedStart - windowStart) / totalMs) * 100;
  const width = Math.max(0.2, ((clippedEnd - clippedStart) / totalMs) * 100);

  return (
    <span
      className={cn("absolute", className)}
      style={{ left: `${left}%`, width: `${Math.min(100 - left, width)}%` }}
      title={title}
    />
  );
}

function ShiftComparisonBadge({ comparison }: { comparison: ReturnType<typeof comparePlannedShift> }) {
  const styles = {
    green: "bg-emerald-50 text-emerald-700",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    slate: "bg-slate-100 text-slate-500"
  }[comparison.tone];
  return (
    <span className={cn("mt-1 inline-flex max-w-full truncate rounded-full px-2 py-0.5 text-[10px] font-black", styles)} title={comparison.label}>
      {comparison.label}
    </span>
  );
}

function ActivityBreakdown({ row }: { row: RealtimeHoursTimelineRow }) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-black text-navy-950">Detalhe de atividade - {formatDateLabel(row.data)}</p>
      {row.devices.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-black uppercase tracking-wide text-muted">Máquinas utilizadas</span>
          {row.devices.map((device) => (
            <span
              key={`${device.hostname}:${device.windowsUser}`}
              className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700"
              title={`Último sinal: ${formatDateTime(device.lastSeenAt)}${device.ipAddress ? ` · IP ${device.ipAddress}` : ""}`}
            >
              {device.hostname}{device.windowsUser ? ` · ${device.windowsUser}` : ""}
            </span>
          ))}
        </div>
      ) : null}
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
            <span className="text-center text-slate-600" title={`${formatDateTime(segment.start)} até ${formatDateTime(segment.end)}`}>
              {formatDateTimeCompact(segment.start)} - {formatDateTimeCompact(segment.end)}
            </span>
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
  onSearchChange,
  matchFilter,
  onMatchFilterChange
}: {
  rows: RealtimeHoursIdentityMapping[];
  drafts: Record<string, string>;
  savingKey: string | null;
  onDraftChange: (key: string, value: string) => void;
  onSave: (row: RealtimeHoursIdentityMapping) => void;
  search: string;
  onSearchChange: (value: string) => void;
  matchFilter: MappingMatchFilter;
  onMatchFilterChange: (value: MappingMatchFilter) => void;
}) {
  return (
    <Panel title={`Vínculos Windows -> WB/Login (${rows.length})`}>
      <div className="mb-3 grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_220px_auto]">
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
        <label className="block">
          <span className="sr-only">Status do WB</span>
          <select
            value={matchFilter}
            onChange={(event) => onMatchFilterChange(event.target.value as MappingMatchFilter)}
            className="premium-control h-10 w-full px-3 text-sm font-black text-navy-950 outline-none"
          >
            <option value="ALL">Todos os WBs</option>
            <option value="FOUND">WB encontrado (com LOB)</option>
            <option value="NOT_FOUND">WB não encontrado (sem LOB)</option>
          </select>
        </label>
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
          Salve vazio para remover vínculo.
        </div>
      </div>

      {!rows.length ? (
        <EmptyState title="Nenhum usuário Windows encontrado" description="Os usuários aparecerão depois que os agentes Windows enviarem os primeiros sinais." />
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

function PresenceStatusBadge({ status }: { status: RealtimeHoursPresenceStatus }) {
  const config = {
    ONLINE: { label: "Online", icon: Wifi, className: "border-emerald-100 bg-emerald-50 text-emerald-700" },
    LOCKED: { label: "Tela bloqueada", icon: Laptop, className: "border-blue-100 bg-blue-50 text-blue-700" },
    IDLE: { label: "Ocioso", icon: Clock, className: "border-amber-100 bg-amber-50 text-amber-700" },
    OFFLINE: { label: "Offline", icon: WifiOff, className: "border-slate-200 bg-slate-100 text-slate-600" }
  }[status];
  const Icon = config.icon;
  return (
    <span className={cn("mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black", config.className)}>
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
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

function formatDateTimeCompact(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatShortDate(value: string) {
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function formatDateLabel(value: string) {
  const date = new Date(`${value}T12:00:00.000Z`);
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
  if (!Number.isFinite(value) || value <= 0) return "0:00:00";
  const totalSeconds = Math.floor(value / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function todayInputDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function addDaysToDateKey(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function mappingRowKey(row: Pick<RealtimeHoursIdentityMapping, "hostname" | "windowsUser">) {
  return `${row.hostname.trim().toLowerCase()}::${row.windowsUser.trim().toLowerCase()}`;
}

function normalizedLob(value?: string | null) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized || "SEM_LOB";
}

function buildLobOptions(rows: RealtimeHoursTimelineRow[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const lob = normalizedLob(row.lob);
    counts.set(lob, (counts.get(lob) ?? 0) + 1);
  }

  const preferredOrder = ["ADS", "CEC", "COMMENTS", "VIDEO", "TNS", "PROJECT", "SEM_LOB"];
  return Array.from(counts.entries())
    .map(([value, count]) => ({
      value,
      count,
      label: value === "SEM_LOB" ? "Sem LOB" : value
    }))
    .sort((left, right) => {
      const leftIndex = preferredOrder.indexOf(left.value);
      const rightIndex = preferredOrder.indexOf(right.value);
      if (leftIndex !== -1 || rightIndex !== -1) {
        if (leftIndex === -1) return 1;
        if (rightIndex === -1) return -1;
        return leftIndex - rightIndex;
      }
      return left.label.localeCompare(right.label, "pt-BR");
    });
}

function buildSupervisorOptions(rows: RealtimeHoursTimelineRow[]) {
  return Array.from(new Set(rows.map((row) => row.supervisor.trim() || "Sem supervisor")))
    .sort((left, right) => {
      if (left === "Sem supervisor") return 1;
      if (right === "Sem supervisor") return -1;
      return left.localeCompare(right, "pt-BR");
    });
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

async function downloadFile(url: string, fallbackFileName: string, fallbackErrorMessage: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    throw new Error(payload?.message ?? payload?.error ?? fallbackErrorMessage);
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error(fallbackErrorMessage);
  const fileName = fileNameFromDisposition(response.headers.get("Content-Disposition"), fallbackFileName);
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function fileNameFromDisposition(disposition: string | null, fallback: string) {
  if (!disposition) return fallback;
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1].replace(/"/g, ""));
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] ?? fallback;
}
