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
type OverviewFilter = "MACHINES" | "ACTIVE" | "IDLE" | "IDENTIFIED";

type RealtimeHoursPageProps = {
  canManageMappings?: boolean;
};

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

const emptyMappingsPayload: RealtimeHoursIdentityMappingsPayload = { success: true, data: [] };

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
  const [overviewFilter, setOverviewFilter] = useState<OverviewFilter>("MACHINES");
  const [timelineDate, setTimelineDate] = useState(todayInputDate());
  const [expandedTimelineKey, setExpandedTimelineKey] = useState<string | null>(null);
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, string>>({});
  const [savingMappingKey, setSavingMappingKey] = useState<string | null>(null);
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
  const records = useMemo(() => statusPayload?.records ?? [], [statusPayload?.records]);
  const currentRecordByKey = useMemo(() => {
    const lookup = new Map<string, RealtimeHoursRecord>();
    for (const record of records) {
      const key = realtimeHoursIdentityKey(record.hostname, record.windowsUser);
      if (key) lookup.set(key, record);
    }
    return lookup;
  }, [records]);
  const timelineRows = useMemo(() => {
    const normalizedSearch = normalizeText(search);
    const rows = timelinePayload?.rows ?? [];
    return rows.filter((row) => {
      const matchesSearch = normalizedSearch
        ? normalizeText([
          row.hostname,
          row.windowsUser,
          row.wbLogin,
          row.employeeName,
          row.lob,
          row.shift,
          row.ipAddress
        ].join(" ")).includes(normalizedSearch)
        : true;
      if (!matchesSearch) return false;

      const currentRecord = currentRecordByKey.get(row.key)
        ?? currentRecordByKey.get(realtimeHoursIdentityKey(row.hostname, row.windowsUser));
      if (overviewFilter === "MACHINES") return Boolean(currentRecord);
      if (overviewFilter === "ACTIVE") return Boolean(currentRecord?.isSessionActive);
      if (overviewFilter === "IDLE") {
        return Boolean(currentRecord?.isSessionActive && (currentRecord.idleSeconds ?? 0) >= idleThresholdSeconds);
      }
      if (overviewFilter === "IDENTIFIED") {
        return Boolean(
          currentRecord
          && !(
            currentRecord.identityConfidence === "UNKNOWN"
            && !currentRecord.wbLogin
            && !currentRecord.employeeId
          )
        );
      }
      return false;
    });
  }, [currentRecordByKey, overviewFilter, search, timelinePayload?.rows]);
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
      return matchesSearch;
    });
  }, [records, search]);

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
        description="Sinal das sessões Windows enviado diretamente pelos computadores da operação."
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
          {canManageMappings ? (
            <CaptureTabButton active={activeTab === "MAPPINGS"} onClick={() => setActiveTab("MAPPINGS")} icon={Link2} label="Vínculos" />
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <OverviewFilterCard
          title="Máquinas"
          value={summary.distinctHosts}
          helper={`${summary.totalRecords} sinal(is) atual(is)`}
          icon={Laptop}
          tone="blue"
          active={overviewFilter === "MACHINES"}
          onClick={() => setOverviewFilter("MACHINES")}
        />
        <OverviewFilterCard
          title="Sessões ativas"
          value={summary.activeSessions}
          helper={`${activePercent}% do sinal atual`}
          icon={Wifi}
          tone="green"
          active={overviewFilter === "ACTIVE"}
          onClick={() => setOverviewFilter((current) => current === "ACTIVE" ? "MACHINES" : "ACTIVE")}
        />
        <OverviewFilterCard
          title="Ociosas"
          value={summary.idleSessions}
          helper={`${idlePercent}% ativas acima de 5 min`}
          icon={Clock}
          tone="orange"
          active={overviewFilter === "IDLE"}
          onClick={() => setOverviewFilter((current) => current === "IDLE" ? "MACHINES" : "IDLE")}
        />
        <OverviewFilterCard
          title="Identificadas"
          value={summary.identifiedRecords}
          helper={`${identifiedPercent}% com identidade`}
          icon={ShieldCheck}
          tone="purple"
          active={overviewFilter === "IDENTIFIED"}
          onClick={() => setOverviewFilter((current) => current === "IDENTIFIED" ? "MACHINES" : "IDENTIFIED")}
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

function OverviewFilterCard({
  title,
  value,
  helper,
  icon: Icon,
  tone,
  active,
  onClick
}: {
  title: string;
  value: number;
  helper: string;
  icon: LucideIcon;
  tone: "blue" | "green" | "orange" | "purple";
  active: boolean;
  onClick: () => void;
}) {
  const toneStyles = {
    blue: { icon: "bg-blue-50 text-blue-600", selected: "border-blue-300 bg-blue-50/40 ring-blue-100" },
    green: { icon: "bg-emerald-50 text-emerald-600", selected: "border-emerald-300 bg-emerald-50/40 ring-emerald-100" },
    orange: { icon: "bg-amber-50 text-amber-600", selected: "border-amber-300 bg-amber-50/40 ring-amber-100" },
    purple: { icon: "bg-violet-50 text-violet-600", selected: "border-violet-300 bg-violet-50/40 ring-violet-100" }
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "group relative flex min-h-[106px] w-full items-center gap-3 rounded-xl border border-border bg-white px-4 py-3 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200",
        active && `ring-2 ${toneStyles.selected}`
      )}
      title={`${active ? "Filtro ativo" : "Filtrar por"} ${title.toLowerCase()}`}
    >
      <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", toneStyles.icon)}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-black text-navy-950">{title}</span>
        <span className="mt-0.5 block text-2xl font-black leading-none text-navy-950">{value}</span>
        <span className="mt-1.5 block truncate text-xs font-bold text-muted">{helper}</span>
      </span>
      {active ? <CheckCircle2 className="absolute right-3 top-3 h-4 w-4 text-blue-600" /> : null}
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
  const visibleSummary = {
    activeMs: rows.reduce((sum, row) => sum + row.activeMs, 0),
    noActivityMs: rows.reduce((sum, row) => sum + row.noActivityMs, 0),
    sessions: rows.reduce((sum, row) => sum + row.sessionCount, 0)
  };

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
        <EmptyState title="Sem captura para esta data" description="Escolha outra data ou aguarde os agentes Windows enviarem novos sinais." />
      ) : !rows.length ? (
        <EmptyState title="Nenhum registro neste filtro" description="Selecione outro indicador do topo ou ajuste a busca." />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-2.5 md:grid-cols-3">
            <TimelineSummaryCard title="Tempo ativo" value={formatDurationMs(visibleSummary.activeMs)} tone="green" />
            <TimelineSummaryCard title="Sem atividade" value={formatDurationMs(visibleSummary.noActivityMs)} tone="slate" />
            <TimelineSummaryCard title="Sessões" value={visibleSummary.sessions} tone="blue" />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-500">
            <span>{rows.length} colaborador(es) exibido(s)</span>
            <div className="flex flex-wrap items-center gap-3">
              <TimelineLegend color="bg-emerald-500" label="Atividade real" />
              <TimelineLegend color="bg-blue-500" label="Jornada prevista" />
              <TimelineLegend color="bg-amber-400" label="Atraso" />
              <TimelineLegend color="bg-red-400" label="Saída antecipada" />
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-white">
            <table className="w-full min-w-[1180px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-[11px] font-black uppercase tracking-wide text-muted">
                  <th className="w-14 px-3 py-3">Ação</th>
                  <th className="w-[270px] px-3 py-3">Colaborador</th>
                  <th className="w-32 px-3 py-3">Data</th>
                  <th className="w-28 px-3 py-3">Duração</th>
                  <th className="w-44 px-3 py-3">Escala prevista</th>
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

function TimelineTableRow({
  row,
  date,
  windowStart,
  windowEnd,
  calculationEnd,
  expanded,
  onToggle
}: {
  row: RealtimeHoursTimelineRow;
  date: string;
  windowStart: string;
  windowEnd: string;
  calculationEnd: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const shiftComparison = comparePlannedShift(row, date, calculationEnd);
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
        <td className="px-3 py-3">
          <p className="text-sm font-black text-navy-950">{plannedShiftLabel(row, date)}</p>
          <ShiftComparisonBadge comparison={shiftComparison} />
        </td>
        <td className="px-3 py-3">
          <TimelineBar
            row={row}
            date={date}
            windowStart={windowStart}
            windowEnd={windowEnd}
            calculationEnd={calculationEnd}
          />
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

function TimelineLegend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2.5 w-2.5 rounded-sm", color)} />
      {label}
    </span>
  );
}

type ShiftComparison = {
  label: string;
  tone: "green" | "blue" | "amber" | "red" | "slate";
  plannedShift: RealtimeHoursPlannedShift | null;
  firstActiveAt: number | null;
  lastActiveAt: number | null;
  arrivalDelayMs: number;
  earlyDepartureMs: number;
  observedUntil: number;
};

function TimelineBar({
  row,
  date,
  windowStart,
  windowEnd,
  calculationEnd
}: {
  row: RealtimeHoursTimelineRow;
  date: string;
  windowStart: string;
  windowEnd: string;
  calculationEnd: string;
}) {
  const startMs = new Date(windowStart).getTime();
  const endMs = new Date(windowEnd).getTime();
  const totalMs = Math.max(1, endMs - startMs);
  const comparison = comparePlannedShift(row, date, calculationEnd);

  return (
    <div className="relative pt-5">
      <div className="absolute inset-x-0 top-0 grid grid-cols-6 text-center text-[11px] font-bold text-slate-400">
        <span>02:00</span>
        <span>06:00</span>
        <span>10:00</span>
        <span>14:00</span>
        <span>18:00</span>
        <span>22:00</span>
      </div>
      <div className="relative h-11 overflow-hidden rounded-md border-2 border-slate-700 bg-slate-100 shadow-inner">
        <div className="absolute inset-x-0 top-0 h-7 border-b border-slate-200/80 bg-white/70">
          {row.segments.filter((segment) => segment.type === "ACTIVE").map((segment, index) => (
            <TimelineRange
              key={`${segment.start}-${index}`}
              start={new Date(segment.start).getTime()}
              end={new Date(segment.end).getTime()}
              windowStart={startMs}
              windowEnd={endMs}
              className="bottom-1 top-1 rounded bg-emerald-500"
              title={`Atividade real | Entrada: ${formatTimeOnly(segment.start)} | Saída: ${formatTimeOnly(segment.end)} | Duração: ${formatDurationMs(segment.durationMs)}`}
            />
          ))}
        </div>

        <div className="absolute inset-x-0 bottom-0 h-3 bg-slate-100">
          {row.plannedShifts.map((shift) => (
            <TimelineRange
              key={`${shift.start}-${shift.end}`}
              start={new Date(shift.start).getTime()}
              end={new Date(shift.end).getTime()}
              windowStart={startMs}
              windowEnd={endMs}
              className="bottom-[3px] h-1.5 rounded-full bg-blue-500"
              title={`Jornada prevista: ${shift.startsAt} - ${shift.endsAt} | ${scheduleStatusLabel(shift.status)}`}
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
              title={`Atraso: ${formatDurationMs(comparison.arrivalDelayMs)}`}
            />
          ) : null}

          {comparison.plannedShift && comparison.earlyDepartureMs > 5 * 60_000 && comparison.lastActiveAt ? (
            <TimelineRange
              start={comparison.lastActiveAt}
              end={new Date(comparison.plannedShift.end).getTime()}
              windowStart={startMs}
              windowEnd={endMs}
              className="bottom-[2px] h-2 rounded-full bg-red-400"
              title={`Saída antecipada: ${formatDurationMs(comparison.earlyDepartureMs)}`}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
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

function comparePlannedShift(row: RealtimeHoursTimelineRow, date: string, calculationEnd: string): ShiftComparison {
  const plannedShift = primaryPlannedShift(row, date);
  const observedUntil = new Date(calculationEnd).getTime();
  if (!plannedShift) {
    return {
      label: "Sem escala",
      tone: "slate",
      plannedShift: null,
      firstActiveAt: null,
      lastActiveAt: null,
      arrivalDelayMs: 0,
      earlyDepartureMs: 0,
      observedUntil
    };
  }

  const plannedStart = new Date(plannedShift.start).getTime();
  const plannedEnd = new Date(plannedShift.end).getTime();
  const activeSegments = row.segments
    .filter((segment) => segment.type === "ACTIVE")
    .map((segment) => ({ start: new Date(segment.start).getTime(), end: new Date(segment.end).getTime() }))
    .filter((segment) => segment.end > plannedStart && segment.start < plannedEnd);
  const firstActiveAt = activeSegments.length ? Math.max(plannedStart, activeSegments[0].start) : null;
  const lastActiveAt = activeSegments.length ? Math.min(plannedEnd, activeSegments[activeSegments.length - 1].end) : null;
  const arrivalDelayMs = firstActiveAt !== null
    ? Math.max(0, firstActiveAt - plannedStart)
    : observedUntil > plannedStart
      ? Math.max(0, Math.min(observedUntil, plannedEnd) - plannedStart)
      : 0;
  const shiftFinished = observedUntil >= plannedEnd;
  const earlyDepartureMs = shiftFinished && lastActiveAt !== null ? Math.max(0, plannedEnd - lastActiveAt) : 0;
  const toleranceMs = 5 * 60_000;

  if (observedUntil < plannedStart) {
    return { label: `Inicia às ${plannedShift.startsAt}`, tone: "blue", plannedShift, firstActiveAt, lastActiveAt, arrivalDelayMs, earlyDepartureMs, observedUntil };
  }
  if (!firstActiveAt) {
    return {
      label: shiftFinished ? "Sem atividade no turno" : "Aguardando entrada",
      tone: shiftFinished ? "red" : "amber",
      plannedShift,
      firstActiveAt,
      lastActiveAt,
      arrivalDelayMs,
      earlyDepartureMs,
      observedUntil
    };
  }
  if (arrivalDelayMs > toleranceMs && earlyDepartureMs > toleranceMs) {
    return {
      label: `${formatCompactMinutes(arrivalDelayMs)} atraso · ${formatCompactMinutes(earlyDepartureMs)} saída`,
      tone: "red",
      plannedShift,
      firstActiveAt,
      lastActiveAt,
      arrivalDelayMs,
      earlyDepartureMs,
      observedUntil
    };
  }
  if (arrivalDelayMs > toleranceMs) {
    return { label: `${formatCompactMinutes(arrivalDelayMs)} de atraso`, tone: "amber", plannedShift, firstActiveAt, lastActiveAt, arrivalDelayMs, earlyDepartureMs, observedUntil };
  }
  if (earlyDepartureMs > toleranceMs) {
    return { label: `${formatCompactMinutes(earlyDepartureMs)} antes`, tone: "red", plannedShift, firstActiveAt, lastActiveAt, arrivalDelayMs, earlyDepartureMs, observedUntil };
  }
  return {
    label: shiftFinished ? "No horário" : "Em jornada",
    tone: shiftFinished ? "green" : "blue",
    plannedShift,
    firstActiveAt,
    lastActiveAt,
    arrivalDelayMs,
    earlyDepartureMs,
    observedUntil
  };
}

function primaryPlannedShift(row: RealtimeHoursTimelineRow, date: string) {
  return row.plannedShifts.find((shift) => shift.sourceDate === date) ?? row.plannedShifts[0] ?? null;
}

function plannedShiftLabel(row: RealtimeHoursTimelineRow, date: string) {
  const shift = primaryPlannedShift(row, date);
  return shift ? `${shift.startsAt} - ${shift.endsAt}` : "Sem escala";
}

function ShiftComparisonBadge({ comparison }: { comparison: ShiftComparison }) {
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

function getSessionStatus(record: RealtimeHoursRecord) {
  if (!record.isSessionActive && record.sessionState === "LOCKED") return "Bloqueada (não contabiliza)";
  if (!record.isSessionActive && record.sessionState === "DISCONNECTED") return "Desconectada";
  if (!record.isSessionActive) return "Inativa";
  if ((record.idleSeconds ?? 0) >= idleThresholdSeconds) return "Ativa (ociosa)";
  return "Ativa";
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

function formatCompactMinutes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0m";
  const totalMinutes = Math.max(1, Math.round(value / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${hours}h`;
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

function realtimeHoursIdentityKey(hostname?: string | null, windowsUser?: string | null) {
  const host = String(hostname ?? "").trim().toLowerCase();
  const user = String(windowsUser ?? "").trim().toLowerCase();
  if (!host) return "";
  return `${host}::${user}`;
}

function scheduleStatusLabel(status: string) {
  const labels: Record<string, string> = {
    ATRASO: "Atraso",
    ESCALADO: "Escalado",
    FALTA: "Falta",
    FALTA_INJUSTIFICADA: "Falta injustificada",
    FALTA_JUSTIFICADA: "Falta justificada",
    NESTING: "Nesting",
    PRESENTE: "Presente",
    SAIDA_ANTECIPADA: "Saída antecipada",
    TREINAMENTO: "Treinamento",
    TROCA_APROVADA: "Troca aprovada",
    VENDA_FOLGA_APROVADA: "Venda de folga aprovada"
  };
  return labels[status] ?? status.replaceAll("_", " ").toLowerCase();
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
    "eventType",
    "sessionState",
    "agentVersion",
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
    record.eventType,
    record.sessionState,
    record.agentVersion,
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
