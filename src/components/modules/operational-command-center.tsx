"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClientRequestGate } from "@/lib/client-request-gate";
import { type LucideIcon, AlertTriangle, CalendarDays, CheckCircle2, Clock, HeartPulse, Laptop, RefreshCw, Trophy, UserCheck, Users, Wifi, XCircle } from "lucide-react";
import { EmptyState, MetricPill, PageHeader, Panel, SimpleTable, StatusBadge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { cleanShiftOptions, shiftCategoryName, standardShiftNames } from "@/lib/shift-display";
import { AttendanceItem, AttendanceSummary, EmployeeListResponse, RecurringAbsenceItem, SystemSettings, apiJson, currentOperationalMonthRange, downloadFile, employeeStatusKey, moodOptionForScore } from './shared';
const AbsenceReasonsDonut = dynamic(() => import("@/components/ui/lazy-recharts").then((module) => module.AbsenceReasonsDonut), { ssr: false });


function isAgentRoleTitle(value: string) {
  return /^(agente|agent|atendente|operador|content moderator)$/i.test(value.trim());
}


function defaultOperationalRoleTitle(options: string[]) {
  return options.find(isAgentRoleTitle) ?? options.find((option) => /agente|agent|atendente|operador/i.test(option)) ?? "Agente";
}


type ActivePeopleItem = {
  id: string;
  employeeId: string;
  employeeName: string;
  wbLogin?: string;
  email?: string;
  roleTitle?: string;
  lob?: string;
  supervisor?: string;
  shift?: string;
  skill?: string;
  employeeStatus?: string;
};


type OperationalPresenceStatus = "ONLINE" | "IDLE" | "LOCKED" | "OFFLINE";


type OperationalPresencePerson = {
  employeeId: string;
  employeeName: string;
  wbLogin: string;
  roleTitle: string;
  skill: string;
  lob: string;
  shift: string;
  supervisor: string;
  employeeStatus: string;
  hostname: string;
  windowsUser: string;
  lastSeenAt: string;
  status: OperationalPresenceStatus;
};


type OperationalPresencePayload = {
  success: boolean;
  capturedAt: string | null;
  summary: { online: number; idle: number; locked: number; offline: number };
  rows: OperationalPresencePerson[];
  error?: string;
  message?: string;
};


type AttritionEmployeeItem = {
  id: string;
  employeeId: string;
  employeeName: string;
  wbLogin?: string;
  email?: string;
  lob?: string;
  supervisor?: string;
  roleTitle?: string;
  skill?: string;
  wave?: string;
  admissionDate?: string;
  admissionDateIso?: string;
  terminationDate?: string;
  terminationDateIso?: string;
  employeeStatus?: string;
};


type CommandStat = {
  title: string;
  value: string | number;
  change?: string;
  helper?: string;
  icon: LucideIcon;
  tone?: "blue" | "green" | "orange" | "red" | "purple";
};


function CommandStatCard({ title, value, change, helper, icon: Icon, tone = "blue" }: CommandStat) {
  const toneClass = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-emerald-50 text-emerald-600",
    orange: "bg-orange-50 text-orange-600",
    red: "bg-red-50 text-red-600",
    purple: "bg-violet-50 text-violet-600"
  }[tone];

  return (
    <div className="card group relative flex min-h-[76px] min-w-0 items-center gap-2 overflow-hidden p-2.5">
      <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl shadow-soft ring-1 ring-white", toneClass)}>
        <Icon className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11.5px] font-extrabold leading-tight text-navy-950" title={title}>{title}</p>
        <div className="mt-0.5 flex min-w-0 items-end gap-1.5">
          <p className="min-w-0 truncate text-[20px] font-black leading-none tracking-tight text-navy-950" title={String(value)}>{value}</p>
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] leading-tight">
          {change ? (
            <span className={cn("font-bold", change.startsWith("-") || change.includes("↓") ? "text-red-500" : "text-emerald-600")}>{change}</span>
          ) : null}
          {helper ? <span className="truncate font-semibold text-muted">{helper}</span> : null}
        </div>
      </div>
    </div>
  );
}


const operationalPresenceStatusOrder: Array<Exclude<OperationalPresenceStatus, "OFFLINE">> = ["ONLINE", "IDLE", "LOCKED"];

const operationalPresenceStatusMeta: Record<Exclude<OperationalPresenceStatus, "OFFLINE">, {
  label: string;
  icon: LucideIcon;
  className: string;
  dotClassName: string;
}> = {
  ONLINE: {
    label: "Online",
    icon: Wifi,
    className: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
    dotClassName: "bg-emerald-500"
  },
  IDLE: {
    label: "Ocioso",
    icon: Clock,
    className: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
    dotClassName: "bg-amber-500"
  },
  LOCKED: {
    label: "Tela bloqueada",
    icon: Laptop,
    className: "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100",
    dotClassName: "bg-blue-500"
  }
};


export function OperationalCommandCenter() {
  const [attendanceSummary, setAttendanceSummary] = useState<AttendanceSummary | null>(null);
  const [dateRange, setDateRange] = useState(() => currentOperationalMonthRange());
  const [commandLobs, setCommandLobs] = useState<string[]>(["Todos"]);
  const [commandRoleTitles, setCommandRoleTitles] = useState<string[]>(["Todos", "Agente"]);
  const [commandShiftOptions, setCommandShiftOptions] = useState<string[]>(["Todos", "Sem turno", ...Array.from(standardShiftNames)]);
  const [commandSkillOptions, setCommandSkillOptions] = useState<string[]>(["Todos", "SEM_SKILL"]);
  const [selectedCommandLob, setSelectedCommandLob] = useState("Todos");
  const [selectedCommandSupervisor, setSelectedCommandSupervisor] = useState("Todos");
  const [selectedCommandRoleTitle, setSelectedCommandRoleTitle] = useState("Agente");
  const [selectedCommandShift, setSelectedCommandShift] = useState("Todos");
  const [selectedCommandSkill, setSelectedCommandSkill] = useState("Todos");
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [summaryRequests] = useState(createClientRequestGate);
  const presenceRequestRef = useRef<Promise<void> | null>(null);
  const presenceAbortRef = useRef<AbortController | null>(null);
  const [selectedAbsenceReason, setSelectedAbsenceReason] = useState<string | null>(null);
  const [absenceReasonPeople, setAbsenceReasonPeople] = useState<AttendanceItem[]>([]);
  const [loadingAbsenceReasonPeople, setLoadingAbsenceReasonPeople] = useState(false);
  const [absenceReasonError, setAbsenceReasonError] = useState("");
  const [absenceReasonExportError, setAbsenceReasonExportError] = useState("");
  const [exportingJustifiedAbsences, setExportingJustifiedAbsences] = useState(false);
  const [exportingUnjustifiedAbsences, setExportingUnjustifiedAbsences] = useState(false);
  const [exportingClassifiedUnjustifiedAbsences, setExportingClassifiedUnjustifiedAbsences] = useState(false);
  const [selectedAbsSupervisor, setSelectedAbsSupervisor] = useState<string | null>(null);
  const [absSupervisorPeople, setAbsSupervisorPeople] = useState<AttendanceItem[]>([]);
  const [loadingAbsSupervisorPeople, setLoadingAbsSupervisorPeople] = useState(false);
  const [absSupervisorError, setAbsSupervisorError] = useState("");
  const [selectedCommandDetail, setSelectedCommandDetail] = useState<{ type: "scheduled" | "present" | "absences"; title: string } | null>(null);
  const [commandDetailPeople, setCommandDetailPeople] = useState<AttendanceItem[]>([]);
  const [loadingCommandDetailPeople, setLoadingCommandDetailPeople] = useState(false);
  const [commandDetailError, setCommandDetailError] = useState("");
  const [exportingCommandDetail, setExportingCommandDetail] = useState(false);
  const [selectedLobAbs, setSelectedLobAbs] = useState<string | null>(null);
  const [lobAbsPeople, setLobAbsPeople] = useState<AttendanceItem[]>([]);
  const [loadingLobAbsPeople, setLoadingLobAbsPeople] = useState(false);
  const [lobAbsError, setLobAbsError] = useState("");
  const [selectedAgentAbsences, setSelectedAgentAbsences] = useState<{ employeeId: string; name: string } | null>(null);
  const [agentAbsencePeople, setAgentAbsencePeople] = useState<AttendanceItem[]>([]);
  const [loadingAgentAbsencePeople, setLoadingAgentAbsencePeople] = useState(false);
  const [agentAbsenceError, setAgentAbsenceError] = useState("");
  const [selectedActivePeopleGroup, setSelectedActivePeopleGroup] = useState<{ lob: string; shift?: string; shifts?: string[] } | null>(null);
  const [activePeople, setActivePeople] = useState<ActivePeopleItem[]>([]);
  const [loadingActivePeople, setLoadingActivePeople] = useState(false);
  const [activePeopleError, setActivePeopleError] = useState("");
  const [selectedAttritionGroup, setSelectedAttritionGroup] = useState<{ title: string; lob?: string } | null>(null);
  const [attritionPeople, setAttritionPeople] = useState<AttritionEmployeeItem[]>([]);
  const [loadingAttritionPeople, setLoadingAttritionPeople] = useState(false);
  const [attritionPeopleError, setAttritionPeopleError] = useState("");
  const [attritionExportError, setAttritionExportError] = useState("");
  const [exportingAttrition, setExportingAttrition] = useState(false);
  const [showRecurringAbsences, setShowRecurringAbsences] = useState(false);
  const [recurringAbsenceExportError, setRecurringAbsenceExportError] = useState("");
  const [exportingRecurringAbsences, setExportingRecurringAbsences] = useState(false);
  const [showMoodDetail, setShowMoodDetail] = useState(false);
  const [operationalPresence, setOperationalPresence] = useState<OperationalPresencePayload | null>(null);
  const [loadingOperationalPresence, setLoadingOperationalPresence] = useState(false);
  const [operationalPresenceError, setOperationalPresenceError] = useState("");
  const [selectedPresenceGroup, setSelectedPresenceGroup] = useState<{ lob: string; shift: string; status: OperationalPresenceStatus } | null>(null);

  const loadOperationalPresence = useCallback(async (showLoading = false) => {
    if (presenceRequestRef.current) return presenceRequestRef.current;
    const controller = new AbortController();
    presenceAbortRef.current = controller;
    const pending = (async () => {
      if (showLoading) setLoadingOperationalPresence(true);
      setOperationalPresenceError("");
      try {
        const payload = await apiJson<OperationalPresencePayload>("/api/realtime-hours/operational-presence", { signal: controller.signal });
        if (!controller.signal.aborted) setOperationalPresence(payload);
      } catch (error) {
        if (!controller.signal.aborted) setOperationalPresenceError(error instanceof Error ? error.message : "Não foi possível carregar a presença atual.");
      } finally {
        if (presenceAbortRef.current === controller) {
          presenceRequestRef.current = null;
          presenceAbortRef.current = null;
          if (!controller.signal.aborted) setLoadingOperationalPresence(false);
        }
      }
    })();
    presenceRequestRef.current = pending;
    return pending;
  }, []);

  useEffect(() => {
    void loadCommandCenterSummary();
    return () => summaryRequests.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange.startDate, dateRange.endDate, selectedCommandLob, selectedCommandSupervisor, selectedCommandRoleTitle, selectedCommandShift, selectedCommandSkill]);

  useEffect(() => {
    function refreshVisiblePresence() {
      if (!document.hidden) void loadOperationalPresence(true);
    }
    refreshVisiblePresence();
    const interval = window.setInterval(refreshVisiblePresence, 60_000);
    document.addEventListener("visibilitychange", refreshVisiblePresence);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshVisiblePresence);
      presenceAbortRef.current?.abort();
      presenceAbortRef.current = null;
      presenceRequestRef.current = null;
    };
  }, [loadOperationalPresence]);

  useEffect(() => {
    apiJson<{ data: SystemSettings }>("/api/settings")
      .then((payload) => {
        const activeLobs = payload.data.lobs.filter((lob) => lob.status !== "INACTIVE").map((lob) => lob.name);
        const activeRoleTitles = payload.data.roleTitles.filter((title) => title.status !== "INACTIVE").map((title) => title.name).filter(Boolean);
        const activeShiftCategories = payload.data.shifts.filter((shift) => shift.status !== "INACTIVE").map((shift) => shiftCategoryName(shift.name));
        const defaultRoleTitle = defaultOperationalRoleTitle(activeRoleTitles);
        setCommandLobs(["Todos", ...activeLobs]);
        setCommandRoleTitles(["Todos", ...Array.from(new Set([...activeRoleTitles, defaultRoleTitle]))]);
        setCommandShiftOptions(["Todos", "Sem turno", ...cleanShiftOptions(activeShiftCategories, true)]);
        setSelectedCommandRoleTitle((current) => (current && current !== "Agente" ? current : defaultRoleTitle));
      })
      .catch(() => {
        setCommandLobs(["Todos"]);
        setCommandRoleTitles(["Todos", "Agente"]);
        setCommandShiftOptions(["Todos", "Sem turno", ...Array.from(standardShiftNames)]);
      });
  }, []);

  useEffect(() => {
    apiJson<EmployeeListResponse>("/api/employees?limit=10")
      .then((payload) => {
        setCommandSkillOptions(["Todos", "SEM_SKILL", ...(payload.filterOptions?.skills ?? []).filter(Boolean)]);
      })
      .catch(() => setCommandSkillOptions(["Todos", "SEM_SKILL"]));
  }, []);

  async function loadCommandCenterSummary() {
    const request = summaryRequests.begin();
    setLoadingSummary(true);
    setSummaryError("");
    try {
      const params = new URLSearchParams({ startDate: dateRange.startDate, endDate: dateRange.endDate, summaryOnly: "true" });
      if (selectedCommandLob !== "Todos") params.set("lob", selectedCommandLob);
      if (selectedCommandSupervisor !== "Todos") params.set("supervisor", selectedCommandSupervisor);
      if (selectedCommandRoleTitle !== "Todos") params.set("roleTitle", selectedCommandRoleTitle);
      if (selectedCommandShift !== "Todos") params.set("shift", selectedCommandShift);
      if (selectedCommandSkill !== "Todos") params.set("skill", selectedCommandSkill);
      const payload = await apiJson<{ summary: AttendanceSummary }>(`/api/attendance?${params.toString()}`, { signal: request.signal });
      if (!summaryRequests.isCurrent(request)) return;
      setAttendanceSummary(payload.summary);
    } catch (error) {
      if (!summaryRequests.isCurrent(request)) return;
      setAttendanceSummary(null);
      setSummaryError(error instanceof Error ? error.message : "Não foi possível carregar os indicadores da operação.");
    } finally {
      if (summaryRequests.isCurrent(request)) setLoadingSummary(false);
    }
  }

  async function openAbsenceReasonPeople(reason: string, justification?: "pending" | "justified" | "unjustified") {
    setSelectedAbsenceReason(justification === "justified" ? "Faltas justificadas" : justification === "unjustified" ? "Faltas injustificadas" : reason);
    setAbsenceReasonPeople([]);
    setAbsenceReasonError("");
    setAbsenceReasonExportError("");
    setLoadingAbsenceReasonPeople(true);
    try {
      const params = new URLSearchParams({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        includeJustified: "true",
        skipSummary: "true"
      });
      if (justification) {
        params.set("justification", justification);
      } else {
        params.set("reason", reason);
      }
      if (selectedCommandLob !== "Todos") params.set("lob", selectedCommandLob);
      if (selectedCommandSupervisor !== "Todos") params.set("supervisor", selectedCommandSupervisor);
      if (selectedCommandRoleTitle !== "Todos") params.set("roleTitle", selectedCommandRoleTitle);
      if (selectedCommandShift !== "Todos") params.set("shift", selectedCommandShift);
      if (selectedCommandSkill !== "Todos") params.set("skill", selectedCommandSkill);
      const payload = await apiJson<{ data: AttendanceItem[] }>(`/api/attendance?${params.toString()}`);
      setAbsenceReasonPeople(payload.data);
    } catch {
      setAbsenceReasonError("Não foi possível carregar as ausências deste motivo.");
    } finally {
      setLoadingAbsenceReasonPeople(false);
    }
  }

  function appendCommandFilters(params: URLSearchParams, options: { includeSupervisor?: boolean; includeLob?: boolean; includeRoleTitle?: boolean } = {}) {
    const { includeSupervisor = true, includeLob = true, includeRoleTitle = true } = options;
    if (includeLob && selectedCommandLob !== "Todos") params.set("lob", selectedCommandLob);
    if (includeSupervisor && selectedCommandSupervisor !== "Todos") params.set("supervisor", selectedCommandSupervisor);
    if (includeRoleTitle && selectedCommandRoleTitle !== "Todos") params.set("roleTitle", selectedCommandRoleTitle);
    if (selectedCommandShift !== "Todos") params.set("shift", selectedCommandShift);
    if (selectedCommandSkill !== "Todos") params.set("skill", selectedCommandSkill);
  }

  async function openCommandDetailPeople(type: "scheduled" | "present" | "absences", title: string) {
    setSelectedCommandDetail({ type, title });
    setCommandDetailPeople([]);
    setCommandDetailError("");
    setLoadingCommandDetailPeople(true);
    try {
      const params = new URLSearchParams({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        detailType: type,
        includeJustified: "true",
        skipSummary: "true"
      });
      appendCommandFilters(params);
      const payload = await apiJson<{ data: AttendanceItem[] }>(`/api/attendance?${params.toString()}`);
      setCommandDetailPeople(payload.data);
    } catch {
      setCommandDetailError("Não foi possível carregar as pessoas deste indicador.");
    } finally {
      setLoadingCommandDetailPeople(false);
    }
  }

  function closeCommandDetailPeople() {
    setSelectedCommandDetail(null);
    setCommandDetailPeople([]);
    setCommandDetailError("");
  }

  async function exportCommandDetailPeople() {
    if (!selectedCommandDetail || !["present", "absences"].includes(selectedCommandDetail.type)) return;
    setExportingCommandDetail(true);
    setCommandDetailError("");
    try {
      const params = new URLSearchParams({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        detailType: selectedCommandDetail.type
      });
      appendCommandFilters(params);
      await downloadFile(
        `/api/attendance/details/export?${params.toString()}`,
        `${selectedCommandDetail.type === "present" ? "presentes" : "faltas"}_${dateRange.startDate}_${dateRange.endDate}.xlsx`,
        "Não foi possível exportar este indicador."
      );
    } catch (error) {
      setCommandDetailError(error instanceof Error ? error.message : "Não foi possível exportar este indicador.");
    } finally {
      setExportingCommandDetail(false);
    }
  }

  async function openLobAbsPeople(lob: string) {
    setSelectedLobAbs(lob);
    setLobAbsPeople([]);
    setLobAbsError("");
    setLoadingLobAbsPeople(true);
    try {
      const params = new URLSearchParams({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        detailType: "lobAbs",
        lob,
        includeJustified: "true",
        skipSummary: "true"
      });
      appendCommandFilters(params, { includeLob: false });
      const payload = await apiJson<{ data: AttendanceItem[] }>(`/api/attendance?${params.toString()}`);
      setLobAbsPeople(payload.data);
    } catch {
      setLobAbsError("Não foi possível carregar as faltas desta LOB.");
    } finally {
      setLoadingLobAbsPeople(false);
    }
  }

  function closeLobAbsPeople() {
    setSelectedLobAbs(null);
    setLobAbsPeople([]);
    setLobAbsError("");
  }

  async function openAgentAbsencePeople(agent: { employeeId: string; name: string }) {
    setSelectedAgentAbsences(agent);
    setAgentAbsencePeople([]);
    setAgentAbsenceError("");
    setLoadingAgentAbsencePeople(true);
    try {
      const params = new URLSearchParams({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        detailType: "agentAbsences",
        employeeId: agent.employeeId,
        includeJustified: "true",
        skipSummary: "true"
      });
      appendCommandFilters(params);
      const payload = await apiJson<{ data: AttendanceItem[] }>(`/api/attendance?${params.toString()}`);
      setAgentAbsencePeople(payload.data);
    } catch {
      setAgentAbsenceError("Não foi possível carregar as faltas deste agente.");
    } finally {
      setLoadingAgentAbsencePeople(false);
    }
  }

  function closeAgentAbsencePeople() {
    setSelectedAgentAbsences(null);
    setAgentAbsencePeople([]);
    setAgentAbsenceError("");
  }

  async function openActivePeopleGroup(group: { lob: string; shift?: string; shifts?: string[] }) {
    setSelectedActivePeopleGroup(group);
    setActivePeople([]);
    setActivePeopleError("");
    setLoadingActivePeople(true);
    try {
      const params = new URLSearchParams({
        detailType: "activePeople",
        lob: group.lob,
        skipSummary: "true"
      });
      appendCommandFilters(params, { includeLob: false });
      if (group.shift) params.set("shift", group.shift);
      const payload = await apiJson<{ data: ActivePeopleItem[] }>(`/api/attendance?${params.toString()}`);
      const allowedShifts = group.shifts?.length ? new Set(group.shifts) : null;
      setActivePeople(allowedShifts ? payload.data.filter((item) => allowedShifts.has(shiftCategoryName(item.shift))) : payload.data);
    } catch {
      setActivePeopleError("Não foi possível carregar as pessoas ativas deste grupo.");
    } finally {
      setLoadingActivePeople(false);
    }
  }

  function closeActivePeopleGroup() {
    setSelectedActivePeopleGroup(null);
    setActivePeople([]);
    setActivePeopleError("");
  }

  async function openAttritionPeople(group: { title: string; lob?: string }) {
    setSelectedAttritionGroup(group);
    setAttritionPeople([]);
    setAttritionPeopleError("");
    setAttritionExportError("");
    setLoadingAttritionPeople(true);
    try {
      const params = new URLSearchParams({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        detailType: "attrition",
        skipSummary: "true"
      });
      appendCommandFilters(params, { includeLob: false });
      if (group.lob) params.set("lob", group.lob);
      else if (selectedCommandLob !== "Todos") params.set("lob", selectedCommandLob);
      const payload = await apiJson<{ data: AttritionEmployeeItem[] }>(`/api/attendance?${params.toString()}`);
      setAttritionPeople(payload.data);
    } catch {
      setAttritionPeopleError("Não foi possível carregar os desligamentos deste período.");
    } finally {
      setLoadingAttritionPeople(false);
    }
  }

  function closeAttritionPeople() {
    setSelectedAttritionGroup(null);
    setAttritionPeople([]);
    setAttritionPeopleError("");
    setAttritionExportError("");
  }

  async function exportAttrition() {
    if (!selectedAttritionGroup) return;
    setAttritionExportError("");
    setExportingAttrition(true);
    try {
      const params = new URLSearchParams({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate
      });
      appendCommandFilters(params, { includeLob: false });
      if (selectedAttritionGroup.lob) params.set("lob", selectedAttritionGroup.lob);
      else if (selectedCommandLob !== "Todos") params.set("lob", selectedCommandLob);
      await downloadFile(
        `/api/attendance/attrition/export?${params.toString()}`,
        `attrition_${dateRange.startDate}_${dateRange.endDate}.xlsx`,
        "Não foi possível exportar Attrition. Tente novamente."
      );
    } catch (error) {
      setAttritionExportError(error instanceof Error ? error.message : "Não foi possível exportar Attrition. Tente novamente.");
    } finally {
      setExportingAttrition(false);
    }
  }

  function openRecurringAbsences() {
    setRecurringAbsenceExportError("");
    setShowRecurringAbsences(true);
  }

  function closeRecurringAbsences() {
    setShowRecurringAbsences(false);
    setRecurringAbsenceExportError("");
  }

  async function exportRecurringAbsences() {
    const items = attendanceSummary?.recurringAbsences ?? [];
    setRecurringAbsenceExportError("");
    if (!items.length) {
      setRecurringAbsenceExportError("Nenhuma falta recorrente encontrada para exportar.");
      return;
    }
    setExportingRecurringAbsences(true);
    try {
      const params = new URLSearchParams({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate
      });
      appendCommandFilters(params);
      await downloadFile(
        `/api/attendance/recurring-absences/export?${params.toString()}`,
        `faltas_recorrentes_${dateRange.endDate}.xlsx`,
        "Não foi possível exportar Faltas Recorrentes. Tente novamente."
      );
    } catch (error) {
      setRecurringAbsenceExportError(error instanceof Error ? error.message : "Não foi possível exportar Faltas Recorrentes. Tente novamente.");
    } finally {
      setExportingRecurringAbsences(false);
    }
  }

  function closeAbsenceReasonPeople() {
    setSelectedAbsenceReason(null);
    setAbsenceReasonPeople([]);
    setAbsenceReasonError("");
    setAbsenceReasonExportError("");
  }

  async function exportJustifiedAbsences() {
    if (selectedAbsenceReason !== "Faltas justificadas") return;
    setAbsenceReasonExportError("");
    if (!absenceReasonPeople.length) {
      setAbsenceReasonExportError("Nenhuma falta justificada encontrada para exportar.");
      return;
    }
    setExportingJustifiedAbsences(true);
    try {
      const params = new URLSearchParams({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate
      });
      if (selectedCommandLob !== "Todos") params.set("lob", selectedCommandLob);
      if (selectedCommandSupervisor !== "Todos") params.set("supervisor", selectedCommandSupervisor);
      if (selectedCommandRoleTitle !== "Todos") params.set("roleTitle", selectedCommandRoleTitle);
      if (selectedCommandShift !== "Todos") params.set("shift", selectedCommandShift);
      if (selectedCommandSkill !== "Todos") params.set("skill", selectedCommandSkill);
      await downloadFile(
        `/api/attendance/justified-absences/export?${params.toString()}`,
        `faltas_justificadas_${dateRange.startDate}_${dateRange.endDate}.xlsx`,
        "Não foi possível exportar as faltas justificadas. Tente novamente."
      );
    } catch (error) {
      setAbsenceReasonExportError(error instanceof Error ? error.message : "Não foi possível exportar as faltas justificadas. Tente novamente.");
    } finally {
      setExportingJustifiedAbsences(false);
    }
  }

  async function exportUnjustifiedAbsences() {
    if (selectedAbsenceReason !== "Sem justificativa") return;
    setAbsenceReasonExportError("");
    if (!absenceReasonPeople.length) {
      setAbsenceReasonExportError("Nenhuma falta sem justificativa encontrada para exportar.");
      return;
    }
    setExportingUnjustifiedAbsences(true);
    try {
      const params = new URLSearchParams({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate
      });
      if (selectedCommandLob !== "Todos") params.set("lob", selectedCommandLob);
      if (selectedCommandSupervisor !== "Todos") params.set("supervisor", selectedCommandSupervisor);
      if (selectedCommandRoleTitle !== "Todos") params.set("roleTitle", selectedCommandRoleTitle);
      if (selectedCommandShift !== "Todos") params.set("shift", selectedCommandShift);
      if (selectedCommandSkill !== "Todos") params.set("skill", selectedCommandSkill);
      await downloadFile(
        `/api/attendance/unjustified-absences/export?${params.toString()}`,
        `faltas_sem_justificativa_${dateRange.startDate}_${dateRange.endDate}.xlsx`,
        "Não foi possível exportar as faltas sem justificativa. Tente novamente."
      );
    } catch (error) {
      setAbsenceReasonExportError(error instanceof Error ? error.message : "Não foi possível exportar as faltas sem justificativa. Tente novamente.");
    } finally {
      setExportingUnjustifiedAbsences(false);
    }
  }

  async function exportClassifiedUnjustifiedAbsences() {
    if (selectedAbsenceReason !== "Faltas injustificadas") return;
    setAbsenceReasonExportError("");
    if (!absenceReasonPeople.length) {
      setAbsenceReasonExportError("Nenhuma falta injustificada encontrada para exportar.");
      return;
    }
    setExportingClassifiedUnjustifiedAbsences(true);
    try {
      const params = new URLSearchParams({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate
      });
      if (selectedCommandLob !== "Todos") params.set("lob", selectedCommandLob);
      if (selectedCommandSupervisor !== "Todos") params.set("supervisor", selectedCommandSupervisor);
      if (selectedCommandRoleTitle !== "Todos") params.set("roleTitle", selectedCommandRoleTitle);
      if (selectedCommandShift !== "Todos") params.set("shift", selectedCommandShift);
      if (selectedCommandSkill !== "Todos") params.set("skill", selectedCommandSkill);
      await downloadFile(
        `/api/attendance/classified-unjustified-absences/export?${params.toString()}`,
        `faltas_injustificadas_${dateRange.startDate}_${dateRange.endDate}.xlsx`,
        "Não foi possível exportar as faltas injustificadas. Tente novamente."
      );
    } catch (error) {
      setAbsenceReasonExportError(error instanceof Error ? error.message : "Não foi possível exportar as faltas injustificadas. Tente novamente.");
    } finally {
      setExportingClassifiedUnjustifiedAbsences(false);
    }
  }

  async function openAbsSupervisorPeople(supervisor: string) {
    setSelectedAbsSupervisor(supervisor);
    setAbsSupervisorPeople([]);
    setAbsSupervisorError("");
    setLoadingAbsSupervisorPeople(true);
    try {
      const params = new URLSearchParams({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        includeJustified: "true",
        skipSummary: "true",
        supervisor
      });
      if (selectedCommandLob !== "Todos") params.set("lob", selectedCommandLob);
      if (selectedCommandRoleTitle !== "Todos") params.set("roleTitle", selectedCommandRoleTitle);
      if (selectedCommandShift !== "Todos") params.set("shift", selectedCommandShift);
      if (selectedCommandSkill !== "Todos") params.set("skill", selectedCommandSkill);
      const payload = await apiJson<{ data: AttendanceItem[] }>(`/api/attendance?${params.toString()}`);
      setAbsSupervisorPeople(payload.data);
    } catch {
      setAbsSupervisorError("Não foi possível carregar as faltas deste supervisor.");
    } finally {
      setLoadingAbsSupervisorPeople(false);
    }
  }

  function closeAbsSupervisorPeople() {
    setSelectedAbsSupervisor(null);
    setAbsSupervisorPeople([]);
    setAbsSupervisorError("");
  }

  function setCommandRange(preset: "today" | "week" | "month" | "previousMonth") {
    const today = new Date();
    const base = dateRange.startDate ? new Date(`${dateRange.startDate}T00:00:00.000Z`) : today;
    if (preset === "today") {
      const value = today.toISOString().slice(0, 10);
      setDateRange({ startDate: value, endDate: value });
      return;
    }
    if (preset === "week") {
      const day = base.getUTCDay();
      const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() - day));
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 6));
      setDateRange({ startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) });
      return;
    }
    const monthOffset = preset === "previousMonth" ? -1 : 0;
    const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + monthOffset, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    setDateRange({ startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) });
  }

  const summary = attendanceSummary ?? {
    planned: 0,
    present: 0,
    absent: 0,
    absRate: 0,
    late: 0,
    earlyLeave: 0,
    unjustified: 0,
    justified: 0,
    classifiedUnjustified: 0,
    coverageRate: 0,
    gap: 0,
    riskLevel: "Sem dados",
    byReason: {},
    byShift: {},
    bySupervisor: {},
    byLob: {},
    topAbsenceAgents: [],
    recurringAbsences: [],
    attrition: {
      total: { lob: "Total", terminations: 0, hcStart: 0, hcEnd: 0, hcAverage: 0, attritionRate: 0 },
      byLob: []
    },
    mood: {
      average: 0,
      responses: 0,
      interpretation: "Sem respostas no período",
      distribution: { Triste: 0, Normal: 0, Feliz: 0 },
      byLob: [],
      bySupervisor: [],
      byRoleTitle: []
    }
  };
  const commandMood = summary.mood ?? {
    average: 0,
    responses: 0,
    interpretation: "Sem respostas no período",
    distribution: { Triste: 0, Normal: 0, Feliz: 0 },
    byLob: [],
    bySupervisor: [],
    byRoleTitle: []
  };
  const commandMoodOption = commandMood.responses ? moodOptionForScore(commandMood.average) : null;
  const stats = [
    { title: "Pessoas Escaladas", value: summary.planned, change: summary.planned ? "100%" : "0%", helper: "base atual", icon: Users, tone: "blue" as const, action: () => void openCommandDetailPeople("scheduled", "Pessoas Escaladas") },
    { title: "Presentes", value: summary.present, change: `${summary.coverageRate}%`, helper: "cobertura real", icon: UserCheck, tone: "green" as const, action: () => void openCommandDetailPeople("present", "Presentes") },
    { title: "Faltas", value: summary.absent, change: `${summary.absRate}%`, helper: "ABS", icon: XCircle, tone: "orange" as const, action: () => void openCommandDetailPeople("absences", "Faltas") },
    { title: "Faltas sem justificativa", value: summary.unjustified, helper: "pendentes", icon: AlertTriangle, tone: summary.unjustified ? "red" as const : "green" as const, action: () => void openAbsenceReasonPeople("Sem justificativa", "pending") },
    { title: "Faltas justificadas", value: summary.justified ?? 0, helper: "motivo justificado", icon: CheckCircle2, tone: (summary.justified ?? 0) ? "green" as const : "blue" as const, action: () => void openAbsenceReasonPeople("Faltas justificadas", "justified") },
    { title: "Faltas injustificadas", value: summary.classifiedUnjustified ?? 0, helper: "motivo injustificado", icon: AlertTriangle, tone: (summary.classifiedUnjustified ?? 0) ? "red" as const : "blue" as const, action: () => void openAbsenceReasonPeople("Faltas injustificadas", "unjustified") },
    {
      title: "Medidor de Humor",
      value: commandMood.responses ? commandMoodOption?.label ?? commandMood.interpretation : "Sem dados",
      change: commandMood.responses ? `${commandMood.responses} respostas` : undefined,
      helper: commandMood.interpretation,
      icon: commandMoodOption?.icon ?? HeartPulse,
      tone: commandMood.average <= 2 && commandMood.responses ? "red" as const : commandMood.average <= 3 && commandMood.responses ? "orange" as const : "purple" as const,
      action: () => setShowMoodDetail(true)
    }
  ];
  const operationalPresenceRows = (operationalPresence?.rows ?? []).filter((row) => {
    if (row.status === "OFFLINE") return false;
    if (selectedCommandLob !== "Todos" && employeeStatusKey(row.lob) !== employeeStatusKey(selectedCommandLob)) return false;
    if (selectedCommandSupervisor !== "Todos" && employeeStatusKey(row.supervisor) !== employeeStatusKey(selectedCommandSupervisor)) return false;
    if (selectedCommandRoleTitle !== "Todos" && employeeStatusKey(row.roleTitle) !== employeeStatusKey(selectedCommandRoleTitle)) return false;
    if (selectedCommandShift !== "Todos" && employeeStatusKey(shiftCategoryName(row.shift) || "Sem turno") !== employeeStatusKey(selectedCommandShift)) return false;
    if (selectedCommandSkill === "SEM_SKILL" && row.skill.trim()) return false;
    if (selectedCommandSkill !== "Todos" && selectedCommandSkill !== "SEM_SKILL" && employeeStatusKey(row.skill) !== employeeStatusKey(selectedCommandSkill)) return false;
    return true;
  });
  const operationalPresenceTotals = operationalPresenceRows.reduce((totals, row) => {
    if (row.status !== "OFFLINE") totals[row.status] += 1;
    return totals;
  }, { ONLINE: 0, IDLE: 0, LOCKED: 0 });
  const operationalPresenceByLob = new Map<string, OperationalPresencePerson[]>();
  for (const row of operationalPresenceRows) {
    const lob = row.lob.trim() || "Sem LOB";
    const lobRows = operationalPresenceByLob.get(lob) ?? [];
    lobRows.push(row);
    operationalPresenceByLob.set(lob, lobRows);
  }
  const lobOrder = ["ADS", "CEC", "COMMENTS", "VIDEO", "TNS", "PROJECT", "ALL"];
  const shiftOrder = ["Manhã", "Tarde", "Noite", "Sem turno"];
  const commandOperationalPresenceGroups = Array.from(operationalPresenceByLob.entries())
    .map(([lob, rows]) => {
      const shifts = new Map<string, OperationalPresencePerson[]>();
      for (const row of rows) {
        const shift = shiftCategoryName(row.shift) || "Sem turno";
        const shiftRows = shifts.get(shift) ?? [];
        shiftRows.push(row);
        shifts.set(shift, shiftRows);
      }
      return {
        lob,
        total: rows.length,
        shifts: Array.from(shifts.entries())
          .map(([shift, shiftRows]) => ({
            shift,
            total: shiftRows.length,
            counts: shiftRows.reduce((counts, row) => {
              if (row.status !== "OFFLINE") counts[row.status] += 1;
              return counts;
            }, { ONLINE: 0, IDLE: 0, LOCKED: 0 })
          }))
          .sort((left, right) => {
            const leftIndex = shiftOrder.indexOf(left.shift);
            const rightIndex = shiftOrder.indexOf(right.shift);
            return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex) || left.shift.localeCompare(right.shift, "pt-BR");
          })
      };
    })
    .sort((left, right) => {
      const leftIndex = lobOrder.indexOf(left.lob.toUpperCase());
      const rightIndex = lobOrder.indexOf(right.lob.toUpperCase());
      return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex) || left.lob.localeCompare(right.lob, "pt-BR");
    });
  const selectedPresencePeople = selectedPresenceGroup
    ? operationalPresenceRows.filter((row) => (
      (row.lob.trim() || "Sem LOB") === selectedPresenceGroup.lob
      && (shiftCategoryName(row.shift) || "Sem turno") === selectedPresenceGroup.shift
      && row.status === selectedPresenceGroup.status
    ))
    : [];
  const selectedPresenceMeta = selectedPresenceGroup?.status && selectedPresenceGroup.status !== "OFFLINE"
    ? operationalPresenceStatusMeta[selectedPresenceGroup.status]
    : null;
  const operationalPresenceUpdatedAt = operationalPresence?.capturedAt
    ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(operationalPresence.capturedAt))
    : "--:--";
  const commandAbsenceReasons = Object.entries(summary.byReason)
    .filter(([, value]) => value > 0)
    .map(([name, value], index) => ({ name, value, fill: ["#071B3A", "#14B8A6", "#F59E0B", "#7C3AED", "#94A3B8"][index % 5] }));
  const commandSupervisorOptions = ["Todos", ...Array.from(new Set(["Sem supervisor", ...Object.keys(summary.bySupervisor ?? {}), selectedCommandSupervisor].filter((value) => value && value !== "Todos")))];
  const commandAbsBySupervisor = Object.entries(summary.bySupervisor ?? {})
    .map(([supervisor, values]) => ({ supervisor, ...values }))
    .sort((a, b) => b.absent - a.absent || b.absRate - a.absRate || a.supervisor.localeCompare(b.supervisor, "pt-BR"));
  const commandAbsByLob = Object.entries(summary.byLob ?? {})
    .map(([lob, values]) => ({ lob, ...values }))
    .sort((a, b) => b.absRate - a.absRate || b.absent - a.absent || a.lob.localeCompare(b.lob, "pt-BR"));
  const maxSupervisorAbsRate = Math.max(1, ...commandAbsBySupervisor.map((item) => item.absRate));
  const maxLobAbsRate = Math.max(1, ...commandAbsByLob.map((item) => item.absRate));
  const commandTopAbsenceAgents = summary.topAbsenceAgents ?? [];
  const commandRecurringAbsences = summary.recurringAbsences ?? [];
  const commandRecurringAbsencePreview = commandRecurringAbsences.slice(0, 6);
  const commandActivePeopleByLobShift = summary.activePeopleByLobAndShift ?? [];
  const commandAttrition = summary.attrition ?? { total: { lob: "Total", terminations: 0, hcStart: 0, hcEnd: 0, hcAverage: 0, attritionRate: 0 }, byLob: [] };
  const commandAttritionByLob = commandAttrition.byLob ?? [];
  const activePeopleShiftColumns = ["Manhã", "Tarde", "Noite"];
  const activePeopleTrainingColumn = "Em treinamento";
  const activePeopleShiftCount = (row: { shifts: Record<string, number> }, targetShift: string) => Object.entries(row.shifts)
    .reduce((total, [shift, count]) => total + (shiftCategoryName(shift) === targetShift ? count : 0), 0);
  const activePeopleVisibleRows = commandActivePeopleByLobShift
    .map((row) => ({
      ...row,
      trainingTotal: activePeopleShiftCount(row, activePeopleTrainingColumn),
      visibleTotal: activePeopleShiftColumns.reduce((total, shift) => total + activePeopleShiftCount(row, shift), 0)
    }))
    .filter((row) => row.visibleTotal > 0 || row.trainingTotal > 0);
  const activePeopleColumnTotals = activePeopleShiftColumns.map((shift) => ({
    shift,
    total: activePeopleVisibleRows.reduce((sum, row) => sum + activePeopleShiftCount(row, shift), 0)
  }));
  const activePeopleTrainingTotal = activePeopleVisibleRows.reduce((sum, row) => sum + row.trainingTotal, 0);
  const activePeopleGrandTotal = activePeopleVisibleRows.reduce((sum, row) => sum + row.visibleTotal, 0);
  const absBarColor = (value: number) => value >= 8 ? "bg-red-500" : value >= 5 ? "bg-orange-500" : value >= 3 ? "bg-amber-400" : "bg-emerald-500";
  const absTextColor = (value: number) => value >= 8 ? "text-red-600" : value >= 5 ? "text-orange-600" : value >= 3 ? "text-amber-600" : "text-emerald-600";
  const absBarWidth = (value: number) => `${Math.min(100, Math.max(value > 0 ? 4 : 0, value))}%`;
  const rankingBarWidth = (value: number, maxValue: number) => `${Math.min(100, Math.max(value > 0 ? 7 : 0, (value / Math.max(maxValue, 1)) * 100))}%`;
  const recurringAbsenceRiskClass = (risk: RecurringAbsenceItem["riskLevel"]) => risk === "Crítico"
    ? "border-red-200 bg-red-50 text-red-700"
    : risk === "Alto risco"
      ? "border-orange-200 bg-orange-50 text-orange-700"
      : "border-amber-200 bg-amber-50 text-amber-700";
  const recurringAbsenceRows = (records: RecurringAbsenceItem[]) => records.map((record) => [
    record.name,
    record.wbLogin || "-",
    record.lob,
    record.supervisor,
    record.consecutiveDays,
    <span key={`${record.employeeId}-risk`} className={cn("inline-flex rounded-md border px-2 py-1 text-[11px] font-black", recurringAbsenceRiskClass(record.riskLevel))}>{record.riskLevel}</span>,
    `${record.lastDate} • ${record.lastStatus}`,
    <div key={`${record.employeeId}-sequence`} className="flex max-w-[360px] flex-col gap-1 text-[11px] font-semibold text-navy-950">
      {record.sequence.map((day) => (
        <span key={`${record.employeeId}-${day.date}`} className="rounded-md bg-slate-50 px-2 py-1">
          {day.date} - {day.status}{day.reason ? ` - ${day.reason}` : ""}{day.classification && day.classification !== "-" ? ` (${day.classification})` : ""}
        </span>
      ))}
    </div>,
    <a key={`${record.employeeId}-open`} href={`/escalas?startDate=${dateRange.endDate}&collaborator=${encodeURIComponent(record.name)}`} className="text-xs font-extrabold text-blue-600 hover:underline">Abrir no Cronograma</a>
  ]);
  const commandPeopleRows = (records: AttendanceItem[]) => records.map((record) => [
    record.employeeName,
    record.wbLogin ?? "-",
    record.date,
    record.lob ?? "-",
    record.supervisor ?? "Sem supervisor",
    record.shift,
    record.roleTitle ?? "-",
    <StatusBadge key={`${record.id}-status`} status={record.status} />,
    record.impactsAbs ? record.absenceReason ?? (record.isJustified ? "Justificada" : "Sem justificativa") : "-",
    <a key={`${record.id}-open`} href={`/escalas?startDate=${record.dateIso ?? dateRange.startDate}&collaborator=${encodeURIComponent(record.employeeName)}`} className="text-xs font-extrabold text-blue-600 hover:underline">Abrir no Cronograma</a>
  ]);
  const activePeopleRows = (records: ActivePeopleItem[]) => records.map((record) => [
    record.employeeName,
    record.wbLogin ?? "-",
    record.email ?? "-",
    record.roleTitle ?? "-",
    record.lob ?? "Sem LOB",
    record.supervisor ?? "Sem supervisor",
    record.shift ?? "Sem turno",
    record.skill || "-",
    record.employeeStatus ?? "-"
  ]);
  const attritionPeopleRows = (records: AttritionEmployeeItem[]) => records.map((record) => [
    record.employeeName,
    record.wbLogin ?? "-",
    record.email ?? "-",
    record.lob ?? "Sem LOB",
    record.supervisor ?? "Sem supervisor",
    record.roleTitle ?? "-",
    record.skill || "-",
    record.wave || "-",
    record.admissionDate || "-",
    record.terminationDate || "-",
    record.employeeStatus ?? "-"
  ]);
  const moodDistributionRows = Object.entries(commandMood.distribution)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => [
      label,
      count
    ]);
  const moodGroupRows = (records: Array<{ label: string; responses: number; average: number; interpretation: string }>) => records.map((record) => [
    record.label,
    record.responses,
    `${record.average} / 5`
  ]);

  return (
    <div>
      <PageHeader
        title="Central Operacional"
        description="Visão geral da operação em tempo real"
        icon={Trophy}
      />
      <>
          <section className="mb-3 rounded-lg border border-slate-200 bg-white p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
            <div className="flex flex-wrap items-center gap-2">
              <select value={selectedCommandLob} onChange={(event) => setSelectedCommandLob(event.target.value)} className="premium-control h-9 px-2.5 text-[12px] font-extrabold text-navy-950 outline-none">
                {commandLobs.map((lob) => <option key={lob} value={lob}>{lob === "Todos" ? "Todas as LOBs" : lob}</option>)}
              </select>
              <select value={selectedCommandSupervisor} onChange={(event) => setSelectedCommandSupervisor(event.target.value)} className="premium-control h-9 px-2.5 text-[12px] font-extrabold text-navy-950 outline-none">
                {commandSupervisorOptions.map((supervisor) => <option key={supervisor} value={supervisor}>{supervisor === "Todos" ? "Todos os supervisores" : supervisor}</option>)}
              </select>
              <select value={selectedCommandRoleTitle} onChange={(event) => setSelectedCommandRoleTitle(event.target.value)} className="premium-control h-9 px-2.5 text-[12px] font-extrabold text-navy-950 outline-none" title="Cargo/Função">
                {commandRoleTitles.map((roleTitle) => <option key={roleTitle} value={roleTitle}>{roleTitle === "Todos" ? "Todos os cargos" : roleTitle}</option>)}
              </select>
              <select value={selectedCommandShift} onChange={(event) => setSelectedCommandShift(event.target.value)} className="premium-control h-9 px-2.5 text-[12px] font-extrabold text-navy-950 outline-none" title="Turno">
                {commandShiftOptions.map((shift) => <option key={shift} value={shift}>{shift === "Todos" ? "Todos os turnos" : shift}</option>)}
              </select>
              <select value={selectedCommandSkill} onChange={(event) => setSelectedCommandSkill(event.target.value)} className="premium-control h-9 px-2.5 text-[12px] font-extrabold text-navy-950 outline-none" title="Skill">
                {commandSkillOptions.map((skill) => <option key={skill} value={skill}>{skill === "Todos" ? "Todas as skills" : skill === "SEM_SKILL" ? "Sem skill" : skill}</option>)}
              </select>
              <label className="premium-control flex h-9 items-center gap-1.5 px-2.5 text-[12px] font-bold text-navy-900">
                <CalendarDays className="h-3.5 w-3.5 text-blue-600" />
                <input type="date" value={dateRange.startDate} onChange={(event) => setDateRange((current) => ({ ...current, startDate: event.target.value }))} className="border-0 bg-transparent text-[12px] font-bold outline-none" />
              </label>
              <label className="premium-control flex h-9 items-center gap-1.5 px-2.5 text-[12px] font-bold text-navy-900">
                <span className="text-[11px] text-muted">até</span>
                <input type="date" value={dateRange.endDate} onChange={(event) => setDateRange((current) => ({ ...current, endDate: event.target.value }))} className="border-0 bg-transparent text-[12px] font-bold outline-none" />
              </label>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <button onClick={() => setCommandRange("today")} className="premium-control h-9 px-2.5 text-[11px] font-extrabold text-navy-950">Hoje</button>
                <button onClick={() => setCommandRange("week")} className="premium-control h-9 px-2.5 text-[11px] font-extrabold text-navy-950">Semana</button>
                <button onClick={() => setCommandRange("month")} className="premium-control h-9 px-2.5 text-[11px] font-extrabold text-navy-950">Mês</button>
                <button onClick={() => setCommandRange("previousMonth")} className="premium-control h-9 px-2.5 text-[11px] font-extrabold text-navy-950">Mês anterior</button>
                <button onClick={() => void Promise.all([loadCommandCenterSummary(), loadOperationalPresence(true)])} disabled={loadingSummary || loadingOperationalPresence} className="flex h-9 items-center gap-1.5 rounded-lg bg-navy-950 px-3 text-[12px] font-extrabold text-white shadow-soft disabled:opacity-60">
                  <RefreshCw className={cn("h-3.5 w-3.5", (loadingSummary || loadingOperationalPresence) && "animate-spin")} /> Atualizar
                </button>
              </div>
            </div>
          </section>
      {summaryError ? <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">Indicadores indisponíveis. {summaryError} Use Atualizar para tentar novamente.</div> : null}
      {loadingSummary ? <div role="status" className="mb-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">Carregando indicadores da operação...</div> : null}
      <div className="mb-3 grid gap-2.5 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7" aria-busy={loadingSummary}>
        {stats.map((stat) => (
          !attendanceSummary || loadingSummary ? (
            <CommandStatCard key={stat.title} {...stat} value="—" change={undefined} helper={loadingSummary ? "Carregando" : "Indisponível"} tone="blue" />
          ) : stat.action ? (
            <button key={stat.title} type="button" onClick={stat.action} className="h-full text-left">
              <CommandStatCard {...stat} />
            </button>
          ) : (
            <CommandStatCard key={stat.title} {...stat} />
          )
        ))}
      </div>
      <div className="space-y-3">
        <Panel title="Presença atual por LOB e turno">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-3">
            <div className="flex flex-wrap items-center gap-2">
              {operationalPresenceStatusOrder.map((status) => {
                const meta = operationalPresenceStatusMeta[status];
                const Icon = meta.icon;
                return (
                  <span key={status} className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-black", meta.className.replace(/hover:[^ ]+/g, ""))}>
                    <Icon className="h-3.5 w-3.5" />
                    {meta.label}
                    <strong className="text-[13px]">{operationalPresenceTotals[status]}</strong>
                  </span>
                );
              })}
            </div>
            <p className="text-[10.5px] font-bold text-muted">
              Sinal mais recente às {operationalPresenceUpdatedAt} · atualização automática a cada 60s
            </p>
          </div>

          {loadingOperationalPresence && !operationalPresence ? (
            <div className="py-7 text-center text-sm font-bold text-muted">Carregando presença atual...</div>
          ) : operationalPresenceError && !operationalPresence ? (
            <EmptyState title="Não foi possível carregar a presença atual" description={operationalPresenceError} />
          ) : commandOperationalPresenceGroups.length ? (
            <div className="grid gap-x-5 gap-y-4 md:grid-cols-2 2xl:grid-cols-3">
              {commandOperationalPresenceGroups.map((group) => (
                <section key={group.lob} className="min-w-0 border-l-2 border-slate-100 pl-3">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <h3 className="truncate text-[13px] font-black text-navy-950" title={group.lob}>{group.lob}</h3>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600">{group.total} conectados</span>
                  </div>
                  <div className="divide-y divide-border/65">
                    {group.shifts.map((shift) => (
                      <div key={`${group.lob}-${shift.shift}`} className="grid grid-cols-[minmax(64px,.8fr)_repeat(3,minmax(46px,1fr))] items-center gap-1.5 py-1.5">
                        <span className="truncate text-[11px] font-extrabold text-slate-600" title={shift.shift}>{shift.shift}</span>
                        {operationalPresenceStatusOrder.map((status) => {
                          const meta = operationalPresenceStatusMeta[status];
                          const Icon = meta.icon;
                          const count = shift.counts[status];
                          return (
                            <button
                              key={status}
                              type="button"
                              disabled={!count}
                              onClick={() => setSelectedPresenceGroup({ lob: group.lob, shift: shift.shift, status })}
                              title={`${meta.label}: ${count}. Clique para ver as pessoas.`}
                              className={cn(
                                "inline-flex h-7 min-w-0 items-center justify-center gap-1 rounded-md border px-1.5 text-[11px] font-black transition disabled:cursor-default disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-300",
                                count && meta.className
                              )}
                            >
                              <Icon className="h-3 w-3 shrink-0" />
                              {count}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Nenhuma pessoa conectada nos filtros atuais"
              description="O painel considera somente Online, Ocioso e Tela bloqueada no sinal mais recente da Captura de Horas."
            />
          )}
        </Panel>
        {attendanceSummary && !loadingSummary ? <>
        <div className="grid gap-3 xl:grid-cols-[1.25fr_.95fr]">
          <Panel title="ABS por Supervisor">
            {commandAbsBySupervisor.length ? (
              <div className="max-h-[310px] overflow-y-auto pr-1">
                <div className="grid grid-cols-[minmax(140px,1.2fr)_minmax(120px,1fr)_72px_64px_72px_82px] gap-2 border-b border-border px-1.5 pb-1.5 text-[9.5px] font-black uppercase tracking-wide text-muted max-lg:hidden">
                  <span>Supervisor</span>
                  <span>ABS</span>
                  <span className="text-center">Escaladas</span>
                  <span className="text-center">Faltas</span>
                  <span className="text-center">Sem just.</span>
                  <span className="text-center">Justificadas</span>
                </div>
                <div className="divide-y divide-border/70">
                  {commandAbsBySupervisor.map((item) => (
                    <button
                      key={item.supervisor}
                      type="button"
                      onClick={() => void openAbsSupervisorPeople(item.supervisor)}
                      className="grid w-full grid-cols-1 gap-1.5 px-1.5 py-2 text-left transition hover:bg-blue-50/55 lg:grid-cols-[minmax(140px,1.2fr)_minmax(120px,1fr)_72px_64px_72px_82px] lg:items-center lg:gap-2"
                    >
                      <span className="min-w-0 truncate text-[12.5px] font-extrabold text-navy-950" title={item.supervisor}>{item.supervisor}</span>
                      <span className="grid min-w-0 grid-cols-[46px_1fr] items-center gap-2">
                        <span className={cn("text-[11.5px] font-black", absTextColor(item.absRate))}>{item.absRate}%</span>
                        <span className="h-2 rounded-full bg-slate-100">
                          <span className={cn("block h-2 rounded-full", absBarColor(item.absRate))} style={{ width: rankingBarWidth(item.absRate, maxSupervisorAbsRate) }} />
                        </span>
                      </span>
                      <span className="text-[11.5px] font-extrabold text-navy-950 lg:text-center"><span className="lg:hidden">Escaladas: </span>{item.planned}</span>
                      <span className="text-[11.5px] font-extrabold text-navy-950 lg:text-center"><span className="lg:hidden">Faltas: </span>{item.absent}</span>
                      <span className="text-[11.5px] font-extrabold text-navy-950 lg:text-center"><span className="lg:hidden">Sem just.: </span>{item.unjustified}</span>
                      <span className="text-[11.5px] font-extrabold text-navy-950 lg:text-center"><span className="lg:hidden">Justificadas: </span>{item.justified}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : <EmptyState title="Sem ABS por supervisor" description="A visão será exibida quando houver cronogramas no período selecionado." />}
          </Panel>

          <Panel title="Pessoas Ativas por LOB e Turno">
            {activePeopleVisibleRows.length ? (
              <div className="max-h-[310px] overflow-auto pr-1">
                <table className="w-full min-w-[620px] text-left text-[11.5px]">
                  <thead className="sticky top-0 z-10 bg-white text-[10px] font-black uppercase tracking-wide text-muted">
                    <tr className="border-b border-border">
                      <th className="px-2 py-1.5">LOB</th>
                      {activePeopleShiftColumns.map((shift) => (
                        <th key={shift} className="px-2 py-1.5 text-center">{shift}</th>
                      ))}
                      <th className="px-2 py-1.5 text-center text-violet-700">Em treinamento</th>
                      <th className="px-2 py-1.5 text-center">
                        <span className="block">Total</span>
                        <span className="block text-[9px] normal-case tracking-normal text-muted">(não inclui treinamento)</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {activePeopleVisibleRows.map((row) => (
                      <tr key={row.lob} className="hover:bg-blue-50/35">
                        <td className="px-2 py-1.5 font-extrabold text-navy-950">{row.lob}</td>
                        {activePeopleShiftColumns.map((shift) => (
                          <td key={`${row.lob}-${shift}`} className="px-2 py-1.5 text-center">
                            <button
                              type="button"
                              disabled={!activePeopleShiftCount(row, shift)}
                              onClick={() => void openActivePeopleGroup({ lob: row.lob, shift })}
                              className="rounded-md px-2 py-1 font-black text-blue-700 transition hover:bg-blue-100 disabled:cursor-default disabled:text-muted disabled:hover:bg-transparent"
                            >
                              {activePeopleShiftCount(row, shift)}
                            </button>
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-center">
                          <button
                            type="button"
                            disabled={!row.trainingTotal}
                            onClick={() => void openActivePeopleGroup({ lob: row.lob, shifts: [activePeopleTrainingColumn] })}
                            className="rounded-md px-2 py-1 font-black text-violet-700 transition hover:bg-violet-50 disabled:cursor-default disabled:text-muted disabled:hover:bg-transparent"
                          >
                            {row.trainingTotal}
                          </button>
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => void openActivePeopleGroup({ lob: row.lob, shifts: activePeopleShiftColumns })}
                            className="rounded-md bg-slate-50 px-2 py-1 font-black text-navy-950 transition hover:bg-blue-100 hover:text-blue-700"
                          >
                            {row.visibleTotal}
                          </button>
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 font-black text-navy-950">
                      <td className="px-2 py-2">TOTAL</td>
                      {activePeopleColumnTotals.map((column) => (
                        <td key={`total-${column.shift}`} className="px-2 py-2 text-center">{column.total}</td>
                      ))}
                      <td className="px-2 py-2 text-center text-violet-700">{activePeopleTrainingTotal}</td>
                      <td className="px-2 py-2 text-center">{activePeopleGrandTotal}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-2 text-[10.5px] font-semibold text-blue-600">Total não inclui parceiros em treinamento.</p>
              </div>
            ) : <EmptyState title="Sem pessoas ativas" description="A matriz exibe Manhã, Tarde, Noite e treinamento para os filtros aplicados." />}
          </Panel>
        </div>

        <div className="grid gap-3 xl:grid-cols-3">
          <Panel title="Ausências por Motivo">
          {commandAbsenceReasons.length ? <div className="grid items-center gap-2.5 md:grid-cols-[160px_minmax(0,1fr)]">
            <div className="h-[160px] w-[160px] max-w-full justify-self-center">
              <AbsenceReasonsDonut data={commandAbsenceReasons} />
            </div>
            <div className="flex max-h-[220px] flex-col justify-center space-y-1.5 overflow-y-auto pr-1">
              {commandAbsenceReasons.map((reason) => (
                <button key={reason.name} type="button" onClick={() => void openAbsenceReasonPeople(reason.name)} className={cn("grid grid-cols-[minmax(0,1fr)_36px_76px] items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left text-[12px] transition hover:border-blue-100 hover:bg-blue-50", reason.name === "Sem justificativa" && "bg-amber-50/70")}>
                  <span className="flex min-w-0 items-center gap-2 font-semibold text-navy-950">
                    <span className="status-dot" style={{ backgroundColor: reason.fill }} />
                    <span className="truncate" title={reason.name}>{reason.name}</span>
                  </span>
                  <span className="text-right font-black text-navy-950">{reason.value}</span>
                  <span className="text-right text-[10.5px] font-extrabold text-blue-600">Ver pessoas</span>
                </button>
              ))}
            </div>
          </div> : <EmptyState title="Sem faltas registradas" description="Os motivos aparecerão quando houver registros reais de presença ou ocorrência." />}
          </Panel>

          <Panel title="ABS por LOB">
            {commandAbsByLob.length ? (
              <div className="max-h-[300px] overflow-y-auto overflow-x-hidden pr-1">
                <div className="grid grid-cols-[46px_minmax(72px,1fr)_72px_50px_52px] gap-1.5 border-b border-border px-1.5 pb-1.5 text-[9px] font-black uppercase tracking-wide text-muted">
                  <span>LOB</span>
                  <span>ABS</span>
                  <span className="text-center">Faltas/Esc.</span>
                  <span className="text-center">Sem Just.</span>
                  <span className="text-center">Justif.</span>
                </div>
                {commandAbsByLob.map((item) => (
                  <button
                    key={item.lob}
                    type="button"
                    onClick={() => void openLobAbsPeople(item.lob)}
                    className="grid w-full grid-cols-[46px_minmax(72px,1fr)_72px_50px_52px] items-center gap-1.5 border-b border-border/70 px-1.5 py-2.5 text-left transition last:border-b-0 hover:bg-blue-50/55"
                  >
                    <span className="min-w-0 truncate text-[11.5px] font-extrabold text-navy-950" title={item.lob}>{item.lob}</span>
                    <div className="grid min-w-0 grid-cols-[38px_1fr] items-center gap-1.5">
                      <span className={cn("text-[11px] font-black", absTextColor(item.absRate))}>{item.absRate}%</span>
                      <div className="h-2 rounded-full bg-slate-100">
                        <div className={cn("h-2 rounded-full", absBarColor(item.absRate))} style={{ width: rankingBarWidth(item.absRate, maxLobAbsRate) }} />
                      </div>
                    </div>
                    <span className="text-center text-[11px] font-extrabold text-navy-950">{item.absent}/{item.planned}</span>
                    <span className="text-center text-[11px] font-extrabold text-navy-950">{item.unjustified}</span>
                    <span className="text-center text-[11px] font-extrabold text-navy-950">{item.justified}</span>
                  </button>
                ))}
              </div>
            ) : <EmptyState title="Sem ABS por LOB" description="A visão será exibida quando houver cronogramas no período selecionado." />}
          </Panel>

          <Panel title="Faltas Recorrentes" action={commandRecurringAbsences.length > 6 ? "Ver todos" : undefined} actionOnClick={openRecurringAbsences}>
            {commandRecurringAbsencePreview.length ? (
              <div className="max-h-[300px] divide-y divide-border/70 overflow-y-auto pr-1">
                {commandRecurringAbsencePreview.map((agent) => (
                  <button
                    key={agent.employeeId}
                    type="button"
                    onClick={openRecurringAbsences}
                    className="grid min-h-[58px] w-full grid-cols-[minmax(0,1fr)_78px] items-center gap-2 py-2 text-left transition hover:bg-blue-50/55"
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <p className="truncate text-[12.5px] font-extrabold leading-tight text-navy-950" title={agent.name}>{agent.name}</p>
                        <span className={cn("shrink-0 rounded-md border px-1.5 py-0.5 text-[9.5px] font-black leading-none", recurringAbsenceRiskClass(agent.riskLevel))}>{agent.riskLevel}</span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] font-semibold leading-tight text-muted" title={`${agent.wbLogin || "-"} • ${agent.lob} • ${agent.supervisor}`}>
                        {agent.wbLogin || "-"} • {agent.lob} • {agent.supervisor}
                      </p>
                      <p className="mt-1 truncate text-[10.5px] font-bold text-slate-500" title={`${agent.lastDate} • ${agent.lastStatus}`}>
                        Último status: {agent.lastStatus} em {agent.lastDate}
                      </p>
                    </div>
                    <span className="justify-self-end rounded-md bg-red-50 px-2 py-1 text-center text-[11px] font-black leading-tight text-red-700">
                      {agent.consecutiveDays}
                      <span className="block text-[9px] uppercase">dias</span>
                    </span>
                  </button>
                ))}
                {commandRecurringAbsences.length > commandRecurringAbsencePreview.length ? (
                  <button type="button" onClick={openRecurringAbsences} className="w-full py-2 text-center text-xs font-extrabold text-blue-600 hover:underline">
                    Ver {commandRecurringAbsences.length - commandRecurringAbsencePreview.length} registro(s) adicional(is)
                  </button>
                ) : null}
              </div>
            ) : <EmptyState title="Nenhuma falta recorrente encontrada." description="Não há parceiros com 2 ou mais dias consecutivos de ausência até a data de referência." />}
          </Panel>
        </div>

        <div className="grid gap-3 xl:grid-cols-[1fr_.75fr_1.25fr]">
          <Panel title="Agentes com maior quantidade de faltas">
            {commandTopAbsenceAgents.length ? (
              <div className="max-h-[300px] divide-y divide-border/70 overflow-y-auto pr-1">
                {commandTopAbsenceAgents.map((agent, index) => (
                  <button
                    key={agent.employeeId}
                    type="button"
                    onClick={() => void openAgentAbsencePeople({ employeeId: agent.employeeId, name: agent.name })}
                    className="grid min-h-[56px] w-full grid-cols-[24px_minmax(0,1fr)_64px] items-center gap-2 py-1.5 text-left transition hover:bg-blue-50/55"
                  >
                    <span className={cn("grid h-6 w-6 place-items-center rounded-full text-[11px] font-black", index < 3 ? "bg-amber-400 text-white" : "bg-slate-200 text-navy-700")}>{index + 1}</span>
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-extrabold leading-tight text-navy-950" title={agent.name}>{agent.name}</p>
                      <p className="mt-0.5 truncate text-[11px] font-semibold leading-tight text-muted" title={`${agent.wbLogin || "-"} • ${agent.lob} • ${agent.supervisor}`}>
                        {agent.wbLogin || "-"} • {agent.lob} • {agent.supervisor}
                      </p>
                      <div className="mt-1 grid grid-cols-3 divide-x divide-border rounded-md bg-slate-50 text-center text-[9.5px]">
                        <div className="px-1 py-0.5">
                          <span className="block font-black leading-tight text-navy-950">{agent.unjustified}</span>
                          <span className="block truncate font-black uppercase leading-tight text-muted">Sem just.</span>
                        </div>
                        <div className="px-1 py-0.5">
                          <span className="block font-black leading-tight text-navy-950">{agent.justified}</span>
                          <span className="block truncate font-black uppercase leading-tight text-muted">Justificadas</span>
                        </div>
                        <div className="px-1 py-0.5">
                          <span className="block font-black leading-tight text-navy-950">{agent.absRate}%</span>
                          <span className="block truncate font-black uppercase leading-tight text-muted">ABS indiv.</span>
                        </div>
                      </div>
                    </div>
                    <span className="justify-self-end rounded-md bg-red-50 px-1.5 py-1 text-[11px] font-black leading-none text-red-700">{agent.absent} faltas</span>
                  </button>
                ))}
              </div>
            ) : <EmptyState title="Nenhuma falta encontrada" description="O ranking aparecerá quando houver faltas de agentes nos filtros selecionados." />}
          </Panel>

          <Panel title="Attrition Total">
            <button
              type="button"
              onClick={() => void openAttritionPeople({ title: "Attrition Total" })}
              className="w-full rounded-xl border border-border bg-white p-4 text-left transition hover:border-blue-200 hover:bg-blue-50/45"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-wide text-muted">Período considerado</p>
                  <p className="mt-1 text-sm font-extrabold text-navy-950">{dateRange.startDate} até {dateRange.endDate}</p>
                </div>
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-red-50 text-red-600">
                  <HeartPulse className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-4 flex items-end justify-between gap-4">
                <div>
                  <p className="text-[34px] font-black leading-none text-navy-950">{commandAttrition.total.attritionRate}%</p>
                  <p className="mt-1 text-xs font-bold text-muted">Attrition do período</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-black text-navy-950">{commandAttrition.total.terminations}</p>
                  <p className="text-xs font-bold text-muted">desligamento(s)</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-slate-50 px-2 py-2">
                  <p className="text-[10px] font-black uppercase text-muted">HC início</p>
                  <p className="text-sm font-black text-navy-950">{commandAttrition.total.hcStart}</p>
                </div>
                <div className="rounded-lg bg-slate-50 px-2 py-2">
                  <p className="text-[10px] font-black uppercase text-muted">HC fim</p>
                  <p className="text-sm font-black text-navy-950">{commandAttrition.total.hcEnd}</p>
                </div>
                <div className="rounded-lg bg-slate-50 px-2 py-2">
                  <p className="text-[10px] font-black uppercase text-muted">HC médio</p>
                  <p className="text-sm font-black text-navy-950">{commandAttrition.total.hcAverage}</p>
                </div>
              </div>
            </button>
          </Panel>

          <Panel title="Attrition por LOB">
            {commandAttritionByLob.length ? (
              <div className="max-h-[280px] overflow-y-auto overflow-x-hidden pr-1 max-md:overflow-x-auto">
                <div className="grid min-w-0 grid-cols-[60px_minmax(90px,1fr)_58px_62px_56px_60px_42px] gap-1.5 border-b border-border px-1.5 pb-1.5 text-[9px] font-black uppercase tracking-wide text-muted max-md:min-w-[620px]">
                  <span>LOB</span>
                  <span>Attrition</span>
                  <span className="text-center">Deslig.</span>
                  <span className="text-center">HC Inicial</span>
                  <span className="text-center">HC Final</span>
                  <span className="text-center">HC Médio</span>
                  <span className="text-center">%</span>
                </div>
                {commandAttritionByLob.map((item) => (
                  <button
                    key={item.lob}
                    type="button"
                    onClick={() => void openAttritionPeople({ title: `Attrition por LOB: ${item.lob}`, lob: item.lob })}
                    className="grid min-w-0 w-full grid-cols-[60px_minmax(90px,1fr)_58px_62px_56px_60px_42px] items-center gap-1.5 border-b border-border/70 px-1.5 py-2.5 text-left transition last:border-b-0 hover:bg-blue-50/55 max-md:min-w-[620px]"
                  >
                    <span className="min-w-0 truncate text-[11.5px] font-extrabold text-navy-950" title={item.lob}>{item.lob}</span>
                    <div className="min-w-0 h-2 rounded-full bg-slate-100">
                      <div className={cn("h-2 rounded-full", absBarColor(item.attritionRate))} style={{ width: absBarWidth(item.attritionRate) }} />
                    </div>
                    <span className="text-center text-[11px] font-extrabold text-navy-950">{item.terminations}</span>
                    <span className="text-center text-[11px] font-extrabold text-navy-950">{item.hcStart}</span>
                    <span className="text-center text-[11px] font-extrabold text-navy-950">{item.hcEnd}</span>
                    <span className="text-center text-[11px] font-extrabold text-navy-950">{item.hcAverage}</span>
                    <span className={cn("text-center text-[11px] font-black", absTextColor(item.attritionRate))}>{item.attritionRate}%</span>
                  </button>
                ))}
              </div>
            ) : <EmptyState title="Sem desligamentos no período" description="O cálculo usa Data de Desligamento e respeita os filtros da Central." />}
          </Panel>
        </div>
        </> : null}
      </div>
      </>

      {showRecurringAbsences ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[90vh] w-full max-w-7xl overflow-y-auto p-5">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Faltas Recorrentes</h2>
                <p className="text-sm font-semibold text-muted">
                  Sequências de 2+ dias até {dateRange.endDate} • {selectedCommandLob === "Todos" ? "Todas as LOBs" : selectedCommandLob}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={exportingRecurringAbsences}
                  onClick={() => void exportRecurringAbsences()}
                  className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-extrabold text-navy-950 hover:border-blue-200 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {exportingRecurringAbsences ? "Exportando..." : "Exportar"}
                </button>
                <button onClick={closeRecurringAbsences} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
              </div>
            </div>
            {recurringAbsenceExportError ? (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{recurringAbsenceExportError}</div>
            ) : null}
            {commandRecurringAbsences.length ? (
              <SimpleTable
                columns={["Parceiro", "WB/Login", "LOB", "Supervisor", "Dias", "Risco", "Último status", "Sequência", "Ação"]}
                rows={recurringAbsenceRows(commandRecurringAbsences)}
              />
            ) : (
              <EmptyState title="Nenhuma falta recorrente encontrada." description="Não há parceiros com 2 ou mais dias consecutivos de ausência nos filtros aplicados." />
            )}
          </div>
        </div>
      ) : null}

      {selectedPresenceGroup && selectedPresenceMeta ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[88vh] w-full max-w-5xl overflow-y-auto p-5">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-extrabold text-navy-950">{selectedPresenceMeta.label}</h2>
                  <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black", selectedPresenceMeta.className.replace(/hover:[^ ]+/g, ""))}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", selectedPresenceMeta.dotClassName)} />
                    {selectedPresencePeople.length}
                  </span>
                </div>
                <p className="text-sm font-semibold text-muted">
                  {selectedPresenceGroup.lob} · {selectedPresenceGroup.shift} · sinal atual às {operationalPresenceUpdatedAt}
                </p>
              </div>
              <button type="button" onClick={() => setSelectedPresenceGroup(null)} className="grid h-9 w-9 place-items-center rounded-lg text-xl hover:bg-slate-100" aria-label="Fechar">×</button>
            </div>
            {selectedPresencePeople.length ? (
              <SimpleTable
                columns={["Parceiro", "WB/Login", "Supervisor", "Cargo/Função", "Skill", "Máquina", "Último sinal"]}
                rows={selectedPresencePeople.map((person) => [
                  person.employeeName || "Não identificado",
                  person.wbLogin || "Sem WB",
                  person.supervisor,
                  person.roleTitle || "-",
                  person.skill || "-",
                  person.hostname || "-",
                  new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(person.lastSeenAt))
                ])}
              />
            ) : (
              <EmptyState title="Nenhuma pessoa neste grupo" description="O sinal pode ter sido atualizado desde a abertura do detalhe." />
            )}
          </div>
        </div>
      ) : null}

      {selectedCommandDetail ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[90vh] w-full max-w-6xl overflow-y-auto p-5">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">{selectedCommandDetail.title}</h2>
                <p className="text-sm font-semibold text-muted">
                  {dateRange.startDate} até {dateRange.endDate} • {selectedCommandLob === "Todos" ? "Todas as LOBs" : selectedCommandLob}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {["present", "absences"].includes(selectedCommandDetail.type) ? (
                  <button
                    type="button"
                    disabled={exportingCommandDetail || loadingCommandDetailPeople}
                    onClick={() => void exportCommandDetailPeople()}
                    className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-extrabold text-navy-950 hover:border-blue-200 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {exportingCommandDetail ? "Exportando..." : "Exportar"}
                  </button>
                ) : null}
                <button onClick={closeCommandDetailPeople} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
              </div>
            </div>
            {loadingCommandDetailPeople ? (
              <div className="rounded-xl border border-border p-8 text-center text-sm font-bold text-muted">Carregando pessoas deste indicador...</div>
            ) : commandDetailError ? (
              <EmptyState title="Não foi possível carregar" description={commandDetailError} />
            ) : commandDetailPeople.length ? (
              <SimpleTable
                columns={["Parceiro", "WB/Login", "Data", "LOB", "Supervisor", "Turno", "Cargo/Função", "Status do cronograma", "Justificativa", "Ação"]}
                rows={commandPeopleRows(commandDetailPeople)}
              />
            ) : (
              <EmptyState title="Nenhum parceiro encontrado para os filtros selecionados." description="A lista respeita o período e os filtros aplicados na Central Operacional." />
            )}
          </div>
        </div>
      ) : null}

      {selectedAgentAbsences ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[90vh] w-full max-w-6xl overflow-y-auto p-5">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Faltas do agente</h2>
                <p className="text-sm font-semibold text-muted">
                  {selectedAgentAbsences.name} • {dateRange.startDate} até {dateRange.endDate}
                </p>
              </div>
              <button onClick={closeAgentAbsencePeople} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            {loadingAgentAbsencePeople ? (
              <div className="rounded-xl border border-border p-8 text-center text-sm font-bold text-muted">Carregando faltas deste agente...</div>
            ) : agentAbsenceError ? (
              <EmptyState title="Não foi possível carregar" description={agentAbsenceError} />
            ) : agentAbsencePeople.length ? (
              <SimpleTable
                columns={["Parceiro", "WB/Login", "Data", "LOB", "Supervisor", "Turno", "Cargo/Função", "Status do cronograma", "Justificativa", "Ação"]}
                rows={commandPeopleRows(agentAbsencePeople)}
              />
            ) : (
              <EmptyState title="Nenhuma falta encontrada para os filtros selecionados." description="A lista respeita o período e os filtros aplicados na Central Operacional." />
            )}
          </div>
        </div>
      ) : null}

      {selectedLobAbs ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[90vh] w-full max-w-6xl overflow-y-auto p-5">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">ABS por LOB</h2>
                <p className="text-sm font-semibold text-muted">
                  {selectedLobAbs} • {dateRange.startDate} até {dateRange.endDate}
                </p>
              </div>
              <button onClick={closeLobAbsPeople} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            {loadingLobAbsPeople ? (
              <div className="rounded-xl border border-border p-8 text-center text-sm font-bold text-muted">Carregando faltas desta LOB...</div>
            ) : lobAbsError ? (
              <EmptyState title="Não foi possível carregar" description={lobAbsError} />
            ) : lobAbsPeople.length ? (
              <SimpleTable
                columns={["Parceiro", "WB/Login", "Data", "LOB", "Supervisor", "Turno", "Cargo/Função", "Status do cronograma", "Justificativa", "Ação"]}
                rows={commandPeopleRows(lobAbsPeople)}
              />
            ) : (
              <EmptyState title="Nenhum parceiro encontrado para os filtros selecionados." description="A lista respeita o período e os filtros aplicados na Central Operacional." />
            )}
          </div>
        </div>
      ) : null}

      {selectedActivePeopleGroup ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[90vh] w-full max-w-6xl overflow-y-auto p-5">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Pessoas Ativas por LOB e Turno</h2>
                <p className="text-sm font-semibold text-muted">
                  {selectedActivePeopleGroup.lob}{selectedActivePeopleGroup.shift ? ` • ${selectedActivePeopleGroup.shift}` : " • Todos os turnos"}
                </p>
              </div>
              <button onClick={closeActivePeopleGroup} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            {loadingActivePeople ? (
              <div className="rounded-xl border border-border p-8 text-center text-sm font-bold text-muted">Carregando pessoas ativas...</div>
            ) : activePeopleError ? (
              <EmptyState title="Não foi possível carregar" description={activePeopleError} />
            ) : activePeople.length ? (
              <SimpleTable
                columns={["Nome", "WB/Login", "E-mail", "Cargo/Função", "LOB", "Supervisor", "Turno", "Skill", "Status do parceiro"]}
                rows={activePeopleRows(activePeople)}
              />
            ) : (
              <EmptyState title="Nenhuma pessoa ativa encontrada" description="A lista respeita os filtros aplicados na Central Operacional." />
            )}
          </div>
        </div>
      ) : null}

      {selectedAttritionGroup ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[90vh] w-full max-w-6xl overflow-y-auto p-5">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">{selectedAttritionGroup.title}</h2>
                <p className="text-sm font-semibold text-muted">
                  {dateRange.startDate} até {dateRange.endDate} • {selectedAttritionGroup.lob ?? (selectedCommandLob === "Todos" ? "Todas as LOBs" : selectedCommandLob)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={exportingAttrition || loadingAttritionPeople}
                  onClick={() => void exportAttrition()}
                  className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-extrabold text-navy-950 hover:border-blue-200 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {exportingAttrition ? "Exportando..." : "Exportar"}
                </button>
                <button onClick={closeAttritionPeople} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
              </div>
            </div>
            {attritionExportError ? (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{attritionExportError}</div>
            ) : null}
            {loadingAttritionPeople ? (
              <div className="rounded-xl border border-border p-8 text-center text-sm font-bold text-muted">Carregando desligamentos...</div>
            ) : attritionPeopleError ? (
              <EmptyState title="Não foi possível carregar" description={attritionPeopleError} />
            ) : attritionPeople.length ? (
              <SimpleTable
                columns={["Nome", "WB/Login", "E-mail", "LOB", "Supervisor", "Cargo/Função", "Skill", "Wave", "Admissão", "Desligamento", "Status do parceiro"]}
                rows={attritionPeopleRows(attritionPeople)}
              />
            ) : (
              <EmptyState title="Nenhum desligamento encontrado" description="A lista considera apenas parceiros com Data de Desligamento dentro do período filtrado." />
            )}
          </div>
        </div>
      ) : null}

      {showMoodDetail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/40 p-2 backdrop-blur-sm sm:p-4">
          <div className="card flex max-h-[94vh] w-[96vw] max-w-[1460px] flex-col overflow-hidden sm:max-h-[92vh]">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-gradient-to-b from-white to-slate-50/80 px-4 py-3.5 sm:px-5">
              <div className="flex min-w-0 gap-3">
                <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600 ring-1 ring-violet-100">
                  <HeartPulse className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-lg font-extrabold leading-tight text-navy-950">Medidor de Humor</h2>
                  <p className="text-sm font-semibold text-muted">{dateRange.startDate} até {dateRange.endDate}</p>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Consolidado operacional</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowMoodDetail(false)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg hover:bg-slate-100"
                aria-label="Fechar Medidor de Humor"
              >
                ×
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              <div className="mb-4 grid gap-3 md:grid-cols-3">
                <MetricPill value={commandMood.responses ? `${commandMood.average} / 5` : "Sem dados"} label="Média de humor" />
                <MetricPill value={commandMood.responses} label="Respostas" />
                <MetricPill value={commandMood.interpretation} label="Classificação" />
              </div>
              {commandMood.responses ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  <MoodDetailPanel title="Distribuição">
                    <MoodDetailTable columns={["Humor", "Respostas"]} rows={moodDistributionRows} />
                  </MoodDetailPanel>
                  <MoodDetailPanel title="Por LOB">
                    <MoodDetailTable columns={["LOB", "Respostas", "Média"]} rows={moodGroupRows(commandMood.byLob)} />
                  </MoodDetailPanel>
                  <MoodDetailPanel title="Por Supervisor">
                    <MoodDetailTable columns={["Supervisor", "Respostas", "Média"]} rows={moodGroupRows(commandMood.bySupervisor)} />
                  </MoodDetailPanel>
                  <MoodDetailPanel title="Por Cargo/Função">
                    <MoodDetailTable columns={["Cargo/Função", "Respostas", "Média"]} rows={moodGroupRows(commandMood.byRoleTitle)} />
                  </MoodDetailPanel>
                </div>
              ) : (
                <EmptyState title="Sem respostas no período" description="As respostas registradas no Meu Cronograma aparecerão aqui de forma consolidada." />
              )}
            </div>
          </div>
        </div>
      ) : null}

      {selectedAbsenceReason ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[90vh] w-full max-w-6xl overflow-y-auto p-5">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Ausências por motivo</h2>
                <p className="text-sm font-semibold text-muted">
                  {selectedAbsenceReason} • {dateRange.startDate} até {dateRange.endDate} • {selectedCommandLob === "Todos" ? "Todas as LOBs" : selectedCommandLob}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {selectedAbsenceReason === "Sem justificativa" ? (
                  <button
                    type="button"
                    disabled={exportingUnjustifiedAbsences || loadingAbsenceReasonPeople}
                    onClick={() => void exportUnjustifiedAbsences()}
                    className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-extrabold text-navy-950 hover:border-blue-200 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {exportingUnjustifiedAbsences ? "Exportando..." : "Exportar"}
                  </button>
                ) : null}
                {selectedAbsenceReason === "Faltas justificadas" ? (
                  <button
                    type="button"
                    disabled={exportingJustifiedAbsences || loadingAbsenceReasonPeople}
                    onClick={() => void exportJustifiedAbsences()}
                    className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-extrabold text-navy-950 hover:border-blue-200 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {exportingJustifiedAbsences ? "Exportando..." : "Exportar"}
                  </button>
                ) : null}
                {selectedAbsenceReason === "Faltas injustificadas" ? (
                  <button
                    type="button"
                    disabled={exportingClassifiedUnjustifiedAbsences || loadingAbsenceReasonPeople}
                    onClick={() => void exportClassifiedUnjustifiedAbsences()}
                    className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-extrabold text-navy-950 hover:border-blue-200 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {exportingClassifiedUnjustifiedAbsences ? "Exportando..." : "Exportar"}
                  </button>
                ) : null}
                <button onClick={closeAbsenceReasonPeople} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
              </div>
            </div>
            {absenceReasonExportError ? (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{absenceReasonExportError}</div>
            ) : null}
            {loadingAbsenceReasonPeople ? (
              <div className="rounded-xl border border-border p-8 text-center text-sm font-bold text-muted">Carregando pessoas deste motivo...</div>
            ) : absenceReasonError ? (
              <EmptyState title="Não foi possível carregar" description={absenceReasonError} />
            ) : absenceReasonPeople.length ? (
              <SimpleTable
                columns={["Parceiro", "WB/Login", "Data", "Turno", "LOB", "Supervisor", "Status", "Motivo", "Classificação", "Categoria", "Observação", "Justificado por", "Justificado em", "Ação"]}
                rows={absenceReasonPeople.map((record) => [
                  record.employeeName,
                  record.wbLogin ?? "-",
                  record.date,
                  record.shift,
                  record.lob ?? "-",
                  record.supervisor ?? "Sem supervisor",
                  <StatusBadge key={`${record.id}-status`} status={record.status} />,
                  record.absenceReason ?? "Sem justificativa",
                  record.reasonClassification === "JUSTIFIED" ? "Justificado" : record.reasonClassification === "UNJUSTIFIED" ? "Injustificado" : "-",
                  record.reasonCategory ?? "-",
                  <span key={`${record.id}-note`} className="block max-w-[260px] truncate" title={record.supervisorJustification ?? ""}>{record.supervisorJustification ?? "-"}</span>,
                  record.justifiedBy ?? record.registeredBy ?? "Sistema",
                  record.justifiedAt ?? record.registeredAt,
                  <a key={`${record.id}-open`} href={`/escalas?startDate=${record.dateIso ?? dateRange.startDate}&collaborator=${encodeURIComponent(record.employeeName)}`} className="text-xs font-extrabold text-blue-600 hover:underline">Abrir no Cronograma</a>
                ])}
              />
            ) : (
              <EmptyState title="Nenhuma ausência encontrada para este motivo" description="A lista respeita o período e os filtros aplicados na Central Operacional." />
            )}
          </div>
        </div>
      ) : null}
      {selectedAbsSupervisor ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[90vh] w-full max-w-6xl overflow-y-auto p-5">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">ABS por Supervisor</h2>
                <p className="text-sm font-semibold text-muted">
                  {selectedAbsSupervisor} • {dateRange.startDate} até {dateRange.endDate} • {selectedCommandLob === "Todos" ? "Todas as LOBs" : selectedCommandLob}
                </p>
              </div>
              <button onClick={closeAbsSupervisorPeople} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            {loadingAbsSupervisorPeople ? (
              <div className="rounded-xl border border-border p-8 text-center text-sm font-bold text-muted">Carregando faltas deste supervisor...</div>
            ) : absSupervisorError ? (
              <EmptyState title="Não foi possível carregar" description={absSupervisorError} />
            ) : absSupervisorPeople.length ? (
              <SimpleTable
                columns={["Parceiro", "WB/Login", "Data", "Turno", "LOB", "Supervisor", "Status", "Motivo", "Justificativa", "Ação"]}
                rows={absSupervisorPeople.map((record) => [
                  record.employeeName,
                  record.wbLogin ?? "-",
                  record.date,
                  record.shift,
                  record.lob ?? "-",
                  record.supervisor ?? "Sem supervisor",
                  <StatusBadge key={`${record.id}-status`} status={record.status} />,
                  record.absenceReason ?? "Sem justificativa",
                  record.isJustified ? "Justificada" : "Sem justificativa",
                  <a key={`${record.id}-open`} href={`/escalas?startDate=${record.dateIso ?? dateRange.startDate}&collaborator=${encodeURIComponent(record.employeeName)}`} className="text-xs font-extrabold text-blue-600 hover:underline">Abrir no Cronograma</a>
                ])}
              />
            ) : (
              <EmptyState title="Nenhuma falta encontrada para este supervisor" description="A lista respeita o período e os filtros aplicados na Central Operacional." />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}


function MoodDetailPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-white shadow-soft">
      <div className="border-b border-border bg-gradient-to-b from-slate-50 to-white px-3.5 py-2.5">
        <h3 className="text-sm font-black leading-tight text-navy-950">{title}</h3>
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}


function MoodDetailTable({ columns, rows }: { columns: string[]; rows: Array<Array<React.ReactNode>> }) {
  return (
    <div className="max-h-[330px] overflow-y-auto rounded-lg border border-border bg-white">
      <table className="w-full table-fixed border-collapse text-left text-[12.5px]">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-border bg-slate-50 text-[10.5px] font-black uppercase tracking-wide text-muted shadow-sm">
            {columns.map((column, index) => (
              <th key={column} className={cn("px-3 py-2 leading-tight", index === 0 ? "w-[52%] text-left" : "text-right")}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="transition-colors hover:bg-blue-50/35">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={cn(
                    "px-3 py-2.5 align-middle leading-snug",
                    cellIndex === 0 ? "break-words font-bold text-navy-950" : "text-right font-extrabold text-navy-900"
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
