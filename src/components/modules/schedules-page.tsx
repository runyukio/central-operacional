"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarCheck, Download, FileSpreadsheet, Plus, Upload } from "lucide-react";
import { TopActions } from "@/components/layout/app-shell";
import { DonutLegend, EmptyState, MetricPill, MiniAlertList, PageHeader, Panel, StatusBadge } from "@/components/ui/primitives";
import { scheduleGridRows } from "@/lib/demo-data";
import { parseWbLoginBatch, serializeWbLogins } from "@/lib/batch-wb-filter";
import { canAdminOverrideWorkflowScheduleStatus, canEditSchedule, canEditWorkHours, canViewSchedules, normalizeRole } from "@/lib/permissions";
import { cn, initials } from "@/lib/utils";
import { approvedShiftBaseTimes, baseTimesForShift } from "@/lib/shift-base-times";
import { cleanShiftName, cleanShiftOptions, isSelectableShiftName, shiftCategoryName } from "@/lib/shift-display";
import { DEFAULT_PRODUCTIVE_HOURS, canScheduleStatusReceiveWorkHours, normalizeProductivePlannedHours, workHoursBlockedReasonForSchedule } from "@/lib/work-hours-rules";
import { AttendanceItem, AttendanceSummary, EmployeeClient, EmployeeListResponse, FormInput, FormSelect, IMPORT_PREVIEW_ROW_LIMIT, ImportIssueSummary, InfoLine, SystemSettings, WorkHourRow, apiJson, currentOperationalDateInput, currentOperationalMonth, currentUrlSearchParams, dateInputFromUtc, downloadFile, employeeMapStatusLabel, employeeStatusKey, formatHourDifference, formatWorkHourValue, initialDateRangeFromUrl, monthRange, operationalDateFromParts, parseDateInput, parseProductiveHoursInput, queryParam, requestedHoursInputErrorMessage, scheduleMonthFormatter, shiftTagClass, statusFromScheduleCell, timesForShift } from './shared';
const scheduleImportColumns = ["wb_login", "data", "status", "turno", "entrada", "saida", "lob"] as const;

const scheduleStatusOptions = ["Escalado", "Presente", "Nesting", "Falta", "Falta Justificada", "Falta Injustificada", "Afastado", "Férias", "Treinamento", "Folga", "Troca aprovada", "Venda de folga aprovada", "Folga aprovada", "Desligado", "Sem cronograma", "Erro de cronograma"] as const;

const scheduleEditableStatusOptions = ["Escalado", "Presente", "Nesting", "Falta", "Afastado", "Férias", "Treinamento", "Folga", "Desligado", "Sem cronograma", "Erro de cronograma"] as const;

const workflowManagedScheduleStatuses = ["Troca aprovada", "Venda de folga aprovada", "Folga aprovada"] as const;

const attendanceReasonStatuses = ["Falta", "Erro de cronograma"];

const scheduleTimeRequiredStatuses = ["Escalado", "Presente", "Nesting", "Troca aprovada", "Venda de folga aprovada"];

const absenceReasonOptions = ["Problema de saúde", "Erro de programação de escala", "Problema técnico corporativo", "Emergência familiar", "Não informado", "Problema técnico pessoal", "Problema de transporte", "Problema pessoal", "Erro de visualização de escala", "Outros"];


type ImportPreview = {
  fileName: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  warningRows?: number;
  createdRows?: number;
  updatedRows?: number;
  foundEmployees?: number;
  missingEmployees?: number;
  rows: Array<Record<string, unknown>>;
  validation: Array<{ rowNumber: number; errors: string[]; warnings: string[]; action?: string; status?: string; employeeName?: string }>;
};


function scheduleEmployeeStatusBadge(status?: string | null) {
  const label = employeeMapStatusLabel(String(status ?? "")).trim();
  const key = employeeStatusKey(label);
  if (!label || ["ATIVO", "ONLINE", "EM_TREINAMENTO", "NESTING"].includes(key)) return null;

  const className =
    key.includes("DESLIGADO")
      ? "border-red-200 bg-red-50 text-red-700"
      : key.includes("AFASTADO") || key.includes("AFASTADA")
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : key.includes("SUSPENSO") || key.includes("SUSPENSA")
          ? "border-violet-200 bg-violet-50 text-violet-700"
          : key.includes("INATIVO") || key.includes("DESATIVADO") || key.includes("DESATIVADA")
            ? "border-slate-200 bg-slate-100 text-slate-700"
            : "border-blue-200 bg-blue-50 text-blue-700";

  return { label, className };
}


type ScheduleWorkHourCell = Pick<WorkHourRow, "id" | "plannedStart" | "plannedEnd" | "plannedHours" | "actualHours" | "effectiveHours" | "differenceMinutes" | "status" | "rawStatus" | "source" | "adjustmentId" | "adjustmentStatus"> & {
  updatedAt?: string;
};


type SchedulePlannedCell = {
  scheduleId: string;
  startsAt: string;
  endsAt: string;
  shiftName?: string;
  observation?: string;
  justification?: ScheduleJustificationCell | null;
};


type ScheduleJustificationCell = {
  id?: string;
  status: string;
  justificationStatus: string;
  absenceReason?: string;
  reasonClassification?: string;
  reasonClassificationLabel?: string;
  reasonCategory?: string;
  supervisorJustification?: string;
  isJustified?: boolean;
  impactsAbs?: boolean;
  impactsCoverage?: boolean;
  registeredBy?: string;
  registeredAt?: string;
  justifiedBy?: string;
  justifiedAt?: string;
  updatedAt?: string;
  history?: Array<{
    previousStatus?: string;
    newStatus?: string;
    previousReason?: string;
    newReason?: string;
    comment?: string;
    changedBy?: string;
    createdAt?: string;
  }>;
};


type ScheduleGridRow = (typeof scheduleGridRows)[number] & {
  dayShifts?: string[];
  plannedTimes?: Array<SchedulePlannedCell | null>;
  workHours?: Array<ScheduleWorkHourCell | null>;
};


type ScheduleMetrics = {
  quantity: number;
};


type ScheduleMetricsPayload = {
  quantity?: number | string;
  totalSlots?: number | string;
};


function countValidScheduleSlots(rows: ScheduleGridRow[]) {
  return rows.reduce((total, row) => total + row.days.filter((value) => value !== "Sem cronograma").length, 0);
}


function normalizeScheduleMetrics(metrics: ScheduleMetricsPayload | undefined, rows: ScheduleGridRow[]): ScheduleMetrics {
  const rawQuantity = metrics?.quantity ?? metrics?.totalSlots;
  const quantity = typeof rawQuantity === "number" ? rawQuantity : Number(rawQuantity);
  return {
    quantity: Number.isFinite(quantity) ? quantity : countValidScheduleSlots(rows)
  };
}


type ScheduleRangeMode = "day" | "week" | "month" | "custom";


type ScheduleImportHistory = {
  id: string;
  fileName: string;
  importedRows: number;
  totalRows?: number;
  errorRows?: number;
  warningRows?: number;
  status: string;
  createdAt: string;
  user: string;
};


type ScheduleAlertItem = {
  title: string;
  status: string;
  tone: "red" | "orange" | "blue" | "green";
  detail: string;
};


function statusNeedsReason(status: string) {
  return attendanceReasonStatuses.includes(status);
}


function statusNeedsTime(status: string) {
  return scheduleTimeRequiredStatuses.includes(status);
}


function employeeOptionLabel(employee: { name: string; wb?: string; email?: string }) {
  if (employee.wb) return `${employee.name} - ${employee.wb}`;
  if (employee.email) return `${employee.name} - ${employee.email}`;
  return employee.name;
}


const workHoursInputErrorMessage = "Horas realizadas inválidas. Use formato HH:mm, como 8:30, ou decimal, como 8,5.";


function workHourAmountBadgeClass(value: unknown) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "bg-slate-100 text-slate-500";
  const minutes = Math.round(numericValue * 60);
  const targetMinutes = Math.round(DEFAULT_PRODUCTIVE_HOURS * 60);
  if (minutes === targetMinutes) return "bg-emerald-100 text-emerald-700";
  if (minutes > targetMinutes) return "bg-blue-100 text-blue-700";
  return "bg-orange-100 text-orange-700";
}


function workHourAmountBadgeTitle(value: unknown) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "Sem horas registradas";
  const minutes = Math.round(numericValue * 60);
  const targetMinutes = Math.round(DEFAULT_PRODUCTIVE_HOURS * 60);
  if (minutes === targetMinutes) return "Horas realizadas iguais ao previsto";
  if (minutes > targetMinutes) return "Horas realizadas acima do previsto";
  return "Horas realizadas abaixo do previsto";
}


function initialMonthFromUrl(fallback = currentOperationalMonth()) {
  const params = currentUrlSearchParams();
  const monthInput = params.get("month");
  if (monthInput?.includes("-")) {
    const [year, month] = monthInput.split("-").map(Number);
    if (year && month) return { year, month };
  }
  const month = Number(params.get("month"));
  const year = Number(params.get("year"));
  return month && year ? { month, year } : fallback;
}


function anchorForSchedulePeriod(period: { month: number; year: number }, currentStartDate?: string) {
  const parsed = parseDateInput(currentStartDate ?? "");
  const day = parsed?.getUTCDate() ?? 1;
  const lastDay = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate();
  return operationalDateFromParts(period.year, period.month, Math.min(day, lastDay));
}


function rangeForScheduleMode(mode: ScheduleRangeMode, period: { month: number; year: number }, currentStartDate?: string) {
  const anchor = anchorForSchedulePeriod(period, currentStartDate);
  if (mode === "day") {
    const value = dateInputFromUtc(anchor);
    return { startDate: value, endDate: value };
  }
  if (mode === "week") {
    const weekday = anchor.getUTCDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    const start = new Date(anchor);
    start.setUTCDate(anchor.getUTCDate() + mondayOffset);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    return { startDate: dateInputFromUtc(start), endDate: dateInputFromUtc(end) };
  }
  return monthRange(period.month, period.year);
}


function dateInputsBetween(startDate: string, endDate: string) {
  const start = parseDateInput(startDate);
  const end = parseDateInput(endDate);
  if (!start && !end) return [];
  const first = start ?? end!;
  const last = end ?? start!;
  const from = first <= last ? first : last;
  const to = first <= last ? last : first;
  const values: string[] = [];
  const current = new Date(from);
  while (current <= to) {
    values.push(dateInputFromUtc(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return values;
}


function isInvalidDateRange(range: { startDate: string; endDate: string }) {
  const start = parseDateInput(range.startDate);
  const end = parseDateInput(range.endDate);
  return Boolean(start && end && start > end);
}


const scheduleWeekdayFormatter = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "America/Sao_Paulo" });


function formatScheduleDateHeader(dateIso: string) {
  const date = parseDateInput(dateIso);
  if (!date) return dateIso;
  const weekday = scheduleWeekdayFormatter.format(date).replace(".", "");
  return `${String(date.getUTCDate()).padStart(2, "0")} ${weekday}`;
}


function scheduleSlotDisplayLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "falta justificada") return "Falta Just.";
  if (normalized === "falta injustificada") return "Falta Injust.";
  if (normalized.includes("sem justificativa")) return "Falta s/ just.";
  if (normalized === "venda de folga aprovada") return "Venda folga";
  if (normalized === "folga aprovada") return "Folga aprov.";
  if (normalized === "saída antecipada" || normalized === "saida antecipada") return "Saída ant.";
  if (normalized === "sem cronograma") return "Sem cron.";
  if (normalized === "erro de cronograma") return "Erro cron.";
  return value;
}


function scheduleSlotStatusTextClass(value: string) {
  const label = scheduleSlotDisplayLabel(value);
  if (label.length > 14) return "text-[9px] leading-[10px]";
  if (label.length > 10) return "text-[9.5px] leading-[10.5px]";
  return "text-[10.5px] leading-[11.5px]";
}


const scheduleWorkCountStatuses = new Set(["Escalado", "Presente", "Atraso", "Saída antecipada", "Saida antecipada", "Troca aprovada", "Venda de folga aprovada", "Nesting"]);

const scheduleDayOffCountStatuses = new Set(["Folga", "Folga aprovada"]);

const scheduleAbsenceCountStatuses = new Set(["Falta", "Falta Justificada", "Falta Injustificada", "Falta Just.", "Falta Injust.", "Falta s/ just.", "Ausente"]);


function countScheduleStatuses(days: string[], statusSet: Set<string>) {
  return days.reduce((total, value) => total + (statusSet.has(scheduleSlotDisplayLabel(value)) || statusSet.has(value) ? 1 : 0), 0);
}


export function SchedulesPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [previewRows, setPreviewRows] = useState<Array<Record<string, unknown>>>([]);
  const [previewResult, setPreviewResult] = useState<ImportPreview | null>(null);
  const [previewFileName, setPreviewFileName] = useState("upload.xlsx");
  const [showPreview, setShowPreview] = useState(false);
  const [showAttendance, setShowAttendance] = useState(false);
  const [showEditSchedule, setShowEditSchedule] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [downloadingScheduleTemplate, setDownloadingScheduleTemplate] = useState(false);
  const [imported, setImported] = useState("");
  const [scheduleRows, setScheduleRows] = useState<ScheduleGridRow[]>([]);
  const [scheduleEmployees, setScheduleEmployees] = useState<EmployeeClient[]>([]);
  const [scheduleEmployeeSearchResults, setScheduleEmployeeSearchResults] = useState<EmployeeClient[]>([]);
  const [scheduleEmployeeSearch, setScheduleEmployeeSearch] = useState("");
  const [loadingScheduleEmployeeSearch, setLoadingScheduleEmployeeSearch] = useState(false);
  const [scheduleSettings, setScheduleSettings] = useState<SystemSettings | null>(null);
  const [scheduleSkillFilterOptions, setScheduleSkillFilterOptions] = useState<string[]>([]);
  const [importHistory, setImportHistory] = useState<ScheduleImportHistory[]>([]);
  const [showScheduleAlerts, setShowScheduleAlerts] = useState(false);
  const [showScheduleImports, setShowScheduleImports] = useState(false);
  const [scheduleAnalysisPanelOpen, setScheduleAnalysisPanelOpen] = useState(true);
  const [showPendingJustifications, setShowPendingJustifications] = useState(false);
  const [attendanceMessage, setAttendanceMessage] = useState("");
  const [attendanceSummary, setAttendanceSummary] = useState<AttendanceSummary | null>(null);
  const [scheduleMetrics, setScheduleMetrics] = useState<ScheduleMetrics>({ quantity: 0 });
  const [pendingJustifications, setPendingJustifications] = useState<AttendanceItem[]>([]);
  const [selectedAttendancePending, setSelectedAttendancePending] = useState<AttendanceItem | null>(null);
  const [pendingSupervisorFilter, setPendingSupervisorFilter] = useState("Todos");
  const [scheduleActorRole, setScheduleActorRole] = useState("COLABORADOR");
  const [schedulePeriod, setSchedulePeriod] = useState(() => initialMonthFromUrl());
  const [scheduleRangeMode, setScheduleRangeMode] = useState<ScheduleRangeMode>("month");
  const [scheduleDateRange, setScheduleDateRange] = useState(() => initialDateRangeFromUrl(monthRange(initialMonthFromUrl().month, initialMonthFromUrl().year)));
  const [scheduleDateError, setScheduleDateError] = useState("");
  const [scheduleDateColumns, setScheduleDateColumns] = useState<string[]>([]);
  const [schedulePagination, setSchedulePagination] = useState({ page: 1, limit: 75, total: 0, totalPages: 1 });
  const [scheduleFilters, setScheduleFilters] = useState({ employeeId: queryParam("employeeId"), collaborator: "", lob: "Todos", supervisor: "Todos", shift: "Todos", status: "Todos", skill: "Todos", roleTitle: "", wbLogins: queryParam("wbLogins") });
  const [scheduleBatchText, setScheduleBatchText] = useState("");
  const [scheduleBatchOpen, setScheduleBatchOpen] = useState(false);
  const [scheduleEditForm, setScheduleEditForm] = useState({
    scheduleId: "",
    employeeId: "",
    date: currentOperationalDateInput(),
    shift: "Manhã",
    startsAt: String(approvedShiftBaseTimes.Manhã.startsAt),
    endsAt: String(approvedShiftBaseTimes.Manhã.endsAt),
    status: "Escalado",
    lob: "",
    supervisor: "",
    observation: "",
    pendingJustification: false
  });
  const [selectedScheduleJustification, setSelectedScheduleJustification] = useState<ScheduleJustificationCell | null>(null);
  const [justificationDraft, setJustificationDraft] = useState({
    absenceReason: "",
    reasonCategory: "Cronograma",
    supervisorJustification: "",
    hasEvidence: false,
    evidenceUrl: ""
  });
  const [savingJustification, setSavingJustification] = useState(false);
  const [workHourForm, setWorkHourForm] = useState({
    recordId: "",
    plannedStart: "",
    plannedEnd: "",
    plannedHours: 0,
    actualHours: "",
    effectiveHours: 0,
    differenceMinutes: 0,
    status: "Sem horas",
    rawStatus: "",
    source: "",
    adjustmentId: "",
    adjustmentStatus: "Sem ajuste"
  });
  const [savingWorkHour, setSavingWorkHour] = useState(false);
  const [deletingWorkHour, setDeletingWorkHour] = useState(false);
  const [workHourAdjustmentForm, setWorkHourAdjustmentForm] = useState({
    requestedActualHours: "",
    reason: "Erro de apontamento",
    justification: ""
  });
  const [savingWorkHourAdjustment, setSavingWorkHourAdjustment] = useState(false);
  const [attendanceForm, setAttendanceForm] = useState({
    attendanceRecordId: "",
    scheduleId: "",
    employeeId: "",
    date: currentOperationalDateInput(),
    shift: "Manhã",
    status: "Falta",
    absenceReason: "",
    reasonCategory: "Cronograma",
    supervisorJustification: "",
    hasEvidence: false,
    evidenceUrl: "",
    impactsAbs: true,
    impactsCoverage: true
  });

  useEffect(() => {
    void refreshSchedules(1, scheduleFilters, scheduleDateRange, { includeImports: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedulePeriod.month, schedulePeriod.year, scheduleFilters.lob]);

  useEffect(() => {
    void loadScheduleSupportData();
  }, []);

  useEffect(() => {
    const query = scheduleEmployeeSearch.trim();
    if (query.length < 2) {
      setScheduleEmployeeSearchResults([]);
      setLoadingScheduleEmployeeSearch(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      setLoadingScheduleEmployeeSearch(true);
      apiJson<EmployeeListResponse>(`/api/employees?search=${encodeURIComponent(query)}&limit=50`)
        .then((payload) => setScheduleEmployeeSearchResults(payload.data.filter((employee) => employee.status !== "Inativo").map((employee) => ({ ...employee, shift: cleanShiftName(employee.shift) || "Manhã" }))))
        .catch(() => setScheduleEmployeeSearchResults([]))
        .finally(() => setLoadingScheduleEmployeeSearch(false));
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [scheduleEmployeeSearch]);

  async function loadScheduleSupportData() {
    try {
      const [employeePayload, settingsPayload] = await Promise.all([
        apiJson<EmployeeListResponse>("/api/employees"),
        apiJson<{ data: SystemSettings }>("/api/settings")
      ]);
      const activeEmployees = employeePayload.data
        .filter((employee) => employee.status !== "Inativo")
        .map((employee) => ({ ...employee, shift: cleanShiftName(employee.shift) || "Manhã" }));
      setScheduleEmployees(activeEmployees);
      setScheduleSkillFilterOptions(employeePayload.filterOptions?.skills ?? []);
      setScheduleSettings(settingsPayload.data);
      if (activeEmployees.length) {
        setAttendanceForm((current) => current.employeeId ? current : { ...current, employeeId: activeEmployees[0].id, shift: activeEmployees[0].shift });
        setScheduleEditForm((current) => current.employeeId ? current : { ...current, employeeId: activeEmployees[0].id, shift: activeEmployees[0].shift, lob: activeEmployees[0].lob, supervisor: activeEmployees[0].supervisor });
      }
    } catch {
      setScheduleEmployees([]);
      setScheduleSkillFilterOptions([]);
    }
  }

  async function refreshSchedules(pageOverride = schedulePagination.page, filtersOverride = scheduleFilters, rangeOverride = scheduleDateRange, options: { includeImports?: boolean } = {}) {
    try {
      const params = new URLSearchParams({
        month: String(schedulePeriod.month),
        year: String(schedulePeriod.year),
        startDate: rangeOverride.startDate,
        endDate: rangeOverride.endDate,
        page: String(pageOverride),
        limit: String(schedulePagination.limit),
        collaborator: filtersOverride.collaborator,
        lob: filtersOverride.lob,
        supervisor: filtersOverride.supervisor,
        shift: filtersOverride.shift,
        status: filtersOverride.status,
        skill: filtersOverride.skill,
        roleTitle: filtersOverride.roleTitle,
        employeeId: filtersOverride.employeeId,
        skipSummary: "true",
        includeImports: options.includeImports ? "true" : "false"
      });
      const batchWbs = scheduleBatchValues(filtersOverride);
      if (batchWbs.length) params.set("wbLogins", serializeWbLogins(batchWbs));
      const payload = await apiJson<{ data: { scheduleGridRows: typeof scheduleRows; imports?: ScheduleImportHistory[]; attendanceSummary?: AttendanceSummary; scheduleMetrics?: ScheduleMetricsPayload; daysInMonth?: number; dateColumns?: string[]; pagination?: { page: number; limit: number; total: number; totalPages: number }; batchWb?: { applied: string[]; notFound: string[]; duplicatesRemoved: number } }; actor?: { role: string; name: string } }>(`/api/schedules?${params.toString()}`);
      setScheduleActorRole(payload.actor?.role ?? "COLABORADOR");
      setScheduleRows(payload.data.scheduleGridRows);
      setScheduleMetrics(normalizeScheduleMetrics(payload.data.scheduleMetrics, payload.data.scheduleGridRows));
      setSchedulePagination(payload.data.pagination ?? { page: pageOverride, limit: schedulePagination.limit, total: payload.data.scheduleGridRows.length, totalPages: 1 });
      setScheduleDateColumns(payload.data.dateColumns ?? []);
      if (payload.data.scheduleGridRows.length) {
        setAttendanceForm((current) => payload.data.scheduleGridRows.some((row) => row.employee.id === current.employeeId) ? current : { ...current, employeeId: payload.data.scheduleGridRows[0].employee.id });
        setScheduleEditForm((current) => payload.data.scheduleGridRows.some((row) => row.employee.id === current.employeeId) ? current : { ...current, employeeId: payload.data.scheduleGridRows[0].employee.id, lob: payload.data.scheduleGridRows[0].employee.lob, supervisor: payload.data.scheduleGridRows[0].employee.supervisor });
      }
      if (payload.data.imports) setImportHistory(payload.data.imports);
      if (payload.data.attendanceSummary) setAttendanceSummary(payload.data.attendanceSummary);
      else setAttendanceSummary(null);
      if (payload.data.batchWb?.notFound.length) {
        setAttendanceMessage(`${payload.data.batchWb.applied.length} login(s) aplicados. ${payload.data.batchWb.notFound.length} não encontrado(s): ${payload.data.batchWb.notFound.join(", ")}.`);
      } else if (attendanceMessage.includes("login(s) aplicados")) {
        setAttendanceMessage("");
      }
      void refreshScheduleSummary(rangeOverride, filtersOverride);
      void refreshAttendanceForSchedulePeriod(rangeOverride, filtersOverride);
    } catch {
      setScheduleRows([]);
      setScheduleMetrics({ quantity: 0 });
      setScheduleDateColumns([]);
      setSchedulePagination((current) => ({ ...current, page: 1, total: 0, totalPages: 1 }));
    }
  }

  async function refreshScheduleSummary(rangeOverride = scheduleDateRange, filtersOverride = scheduleFilters) {
    try {
      const params = new URLSearchParams({
        startDate: rangeOverride.startDate,
        endDate: rangeOverride.endDate,
        summaryOnly: "true"
      });
      if (filtersOverride.lob !== "Todos") params.set("lob", filtersOverride.lob);
      if (filtersOverride.supervisor !== "Todos") params.set("supervisor", filtersOverride.supervisor);
      if (filtersOverride.shift !== "Todos") params.set("shift", filtersOverride.shift);
      if (filtersOverride.collaborator.trim()) params.set("collaborator", filtersOverride.collaborator.trim());
      if (filtersOverride.employeeId) params.set("employeeId", filtersOverride.employeeId);
      if (filtersOverride.status !== "Todos") params.set("status", filtersOverride.status);
      if (filtersOverride.skill !== "Todos") params.set("skill", filtersOverride.skill);
      if (filtersOverride.roleTitle && filtersOverride.roleTitle !== "Todos") params.set("roleTitle", filtersOverride.roleTitle);
      const batchWbs = scheduleBatchValues(filtersOverride);
      if (batchWbs.length) params.set("wbLogins", serializeWbLogins(batchWbs));
      const payload = await apiJson<{ summary: AttendanceSummary }>(`/api/attendance?${params.toString()}`);
      setAttendanceSummary(payload.summary);
    } catch {
      setAttendanceSummary(null);
    }
  }

  async function refreshAttendanceForSchedulePeriod(rangeOverride = scheduleDateRange, filtersOverride = scheduleFilters) {
    const params = new URLSearchParams({
      month: String(schedulePeriod.month),
      year: String(schedulePeriod.year),
      startDate: rangeOverride.startDate,
      endDate: rangeOverride.endDate,
      skipSummary: "true"
    });
    if (filtersOverride.lob !== "Todos") params.set("lob", filtersOverride.lob);
    if (filtersOverride.supervisor !== "Todos") params.set("supervisor", filtersOverride.supervisor.trim());
    if (filtersOverride.shift !== "Todos") params.set("shift", filtersOverride.shift);
    if (filtersOverride.collaborator.trim()) params.set("collaborator", filtersOverride.collaborator.trim());
    if (filtersOverride.employeeId) params.set("employeeId", filtersOverride.employeeId);
    if (filtersOverride.skill !== "Todos") params.set("skill", filtersOverride.skill);
    const batchWbs = scheduleBatchValues(filtersOverride);
    if (batchWbs.length) params.set("wbLogins", serializeWbLogins(batchWbs));
    try {
      const payload = await apiJson<{ data: AttendanceItem[]; summary: AttendanceSummary }>(`/api/attendance?${params.toString()}`);
      setPendingJustifications(payload.data.filter((record) => statusNeedsReason(record.status) && record.isJustified === false));
    } catch {
      setPendingJustifications([]);
    }
  }

  function moveScheduleMonth(delta: number) {
    const next = new Date(Date.UTC(schedulePeriod.year, schedulePeriod.month - 1 + delta, 1));
    const nextPeriod = { month: next.getUTCMonth() + 1, year: next.getUTCFullYear() };
    setSchedulePeriod(nextPeriod);
    if (scheduleRangeMode !== "custom") setScheduleDateRange(rangeForScheduleMode(scheduleRangeMode, nextPeriod, scheduleDateRange.startDate));
  }

  function updateSchedulePeriod(nextPeriod: { month: number; year: number }) {
    setSchedulePeriod(nextPeriod);
    if (scheduleRangeMode !== "custom") setScheduleDateRange(rangeForScheduleMode(scheduleRangeMode, nextPeriod, scheduleDateRange.startDate));
  }

  function applyScheduleQuickRange(mode: ScheduleRangeMode) {
    const nextRange = rangeForScheduleMode(mode, schedulePeriod, scheduleDateRange.startDate);
    setScheduleRangeMode(mode);
    setScheduleDateRange(nextRange);
    setScheduleDateError("");
    void refreshSchedules(1, scheduleFilters, nextRange);
  }

  function applyScheduleDateRange() {
    if (isInvalidDateRange(scheduleDateRange)) {
      setScheduleDateError("Data inicial não pode ser maior que data final.");
      return;
    }
    setScheduleRangeMode("custom");
    setScheduleDateError("");
    void refreshSchedules(1, scheduleFilters, scheduleDateRange);
  }

  function applyScheduleFilters() {
    if (isInvalidDateRange(scheduleDateRange)) {
      setScheduleDateError("Data inicial não pode ser maior que data final.");
      return;
    }
    setScheduleDateError("");
    void refreshSchedules(1, scheduleFilters, scheduleDateRange);
  }

  function clearScheduleFilters() {
    const clearedFilters = { employeeId: "", collaborator: "", lob: "Todos", supervisor: "Todos", shift: "Todos", status: "Todos", skill: "Todos", roleTitle: "", wbLogins: "" };
    const clearedRange = monthRange(schedulePeriod.month, schedulePeriod.year);
    setScheduleFilters(clearedFilters);
    setScheduleBatchText("");
    setScheduleBatchOpen(false);
    setScheduleRangeMode("month");
    setScheduleDateRange(clearedRange);
    setScheduleDateError("");
    void refreshSchedules(1, clearedFilters, clearedRange);
  }

  function scheduleBatchValues(filters = scheduleFilters) {
    return parseWbLoginBatch(filters.wbLogins).values;
  }

  function addScheduleBatchWbs() {
    const parsed = parseWbLoginBatch(scheduleBatchText);
    if (!parsed.values.length) {
      setAttendanceMessage("Cole um ou mais WB/Login para aplicar o filtro em lote.");
      return;
    }
    const nextValues = parseWbLoginBatch([...scheduleBatchValues(), ...parsed.values]).values;
    const nextFilters = { ...scheduleFilters, wbLogins: serializeWbLogins(nextValues) };
    setScheduleFilters(nextFilters);
    setScheduleBatchText("");
    setScheduleBatchOpen(false);
    setAttendanceMessage(`${parsed.values.length} login(s) adicionados ao filtro em lote${parsed.duplicatesRemoved ? `; ${parsed.duplicatesRemoved} duplicado(s) ignorado(s)` : ""}.`);
    void refreshSchedules(1, nextFilters, scheduleDateRange);
  }

  function removeScheduleBatchWb(value: string) {
    const nextValues = scheduleBatchValues().filter((item) => item !== value);
    const nextFilters = { ...scheduleFilters, wbLogins: serializeWbLogins(nextValues) };
    setScheduleFilters(nextFilters);
    void refreshSchedules(1, nextFilters, scheduleDateRange);
  }

  function clearScheduleBatchWbs() {
    const nextFilters = { ...scheduleFilters, wbLogins: "" };
    setScheduleFilters(nextFilters);
    setScheduleBatchText("");
    setScheduleBatchOpen(false);
    void refreshSchedules(1, nextFilters, scheduleDateRange);
  }

  async function handleFile(file?: File) {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    const preview = await apiJson<ImportPreview>("/api/schedules/import/preview", { method: "POST", body: formData });
    setPreviewFileName(file.name);
    setPreviewResult(preview);
    setPreviewRows(preview.rows);
    setShowPreview(true);
  }

  async function commitImport() {
    const result = await apiJson<{ data: { fileName: string; importedRows: number; status: string; createdAt: string; user: string }; preview: ImportPreview }>("/api/schedules/import/commit", {
      method: "POST",
      body: JSON.stringify({ fileName: previewFileName, allowPartial: true, rows: previewRows })
    });
    setImported(`${result.data.status}. ${result.data.importedRows} linhas registradas em auditoria.`);
    setImportHistory((items) => [result.data as (typeof importHistory)[number], ...items]);
    setShowPreview(false);
    await refreshSchedules();
  }

  function openScheduleEditor(row?: ScheduleGridRow, dayIndex = 0, value = "Escalado") {
    const targetRow = row ?? scheduleRows[0];
    const targetEmployee = targetRow?.employee ?? scheduleEmployees[0];
    if (!targetEmployee) {
      setAttendanceMessage("Nenhum parceiro ativo encontrado para receber cronograma.");
      return;
    }
    const cellStatus = statusFromScheduleCell(value);
    const employeeShift = cleanShiftName(targetEmployee.shift) || "Manhã";
    const plannedCell = targetRow?.plannedTimes?.[dayIndex] ?? null;
    const hourCell = targetRow?.workHours?.[dayIndex] ?? null;
    const cellShift = cleanShiftName(plannedCell?.shiftName ?? targetRow?.dayShifts?.[dayIndex] ?? value);
    const shift = availableShiftNames.includes(cellShift) ? cellShift : employeeShift;
    const times = configuredTimesForShift(shift);
    const justification = plannedCell?.justification ?? null;
    const plannedStart = plannedCell?.startsAt || (statusNeedsTime(cellStatus) ? times.startsAt : "");
    const plannedEnd = plannedCell?.endsAt || (statusNeedsTime(cellStatus) ? times.endsAt : "");
    const plannedHours = canScheduleStatusReceiveWorkHours(cellStatus, { status: cellStatus, startsAt: plannedStart, endsAt: plannedEnd, shiftName: shift }) ? DEFAULT_PRODUCTIVE_HOURS : 0;
    setScheduleEmployeeSearch(employeeOptionLabel(targetEmployee));
    setScheduleEditForm({
      scheduleId: plannedCell?.scheduleId ?? "",
      employeeId: targetEmployee.id,
      date: visibleScheduleDates[dayIndex] ?? `${schedulePeriod.year}-${String(schedulePeriod.month).padStart(2, "0")}-${String(dayIndex + 1).padStart(2, "0")}`,
      shift: cleanShiftName(shift) || "Manhã",
      startsAt: statusNeedsTime(cellStatus) ? plannedStart : "",
      endsAt: statusNeedsTime(cellStatus) ? plannedEnd : "",
      status: cellStatus,
      lob: targetEmployee.lob,
      supervisor: targetEmployee.supervisor,
      observation: plannedCell?.observation ?? "",
      pendingJustification: false
    });
    setSelectedScheduleJustification(justification);
    setJustificationDraft({
      absenceReason: justification?.absenceReason && justification.absenceReason !== "Sem justificativa" ? justification.absenceReason : "",
      reasonCategory: justification?.reasonCategory ?? "Cronograma",
      supervisorJustification: justification?.supervisorJustification ?? "",
      hasEvidence: false,
      evidenceUrl: ""
    });
    setWorkHourForm({
      recordId: hourCell?.id ?? "",
      plannedStart: hourCell?.plannedStart || plannedStart,
      plannedEnd: hourCell?.plannedEnd || plannedEnd,
      plannedHours: normalizeProductivePlannedHours(hourCell?.plannedHours) ?? plannedHours,
      actualHours: hourCell?.actualHours === null || hourCell?.actualHours === undefined ? "" : formatWorkHourValue(hourCell.actualHours, ""),
      effectiveHours: hourCell?.effectiveHours ?? 0,
      differenceMinutes: hourCell?.differenceMinutes ?? 0,
      status: hourCell?.status ?? (plannedCell ? "Sem horas" : "Sem cronograma"),
      rawStatus: hourCell?.rawStatus ?? "",
      source: hourCell?.source ?? "",
      adjustmentId: hourCell?.adjustmentId ?? "",
      adjustmentStatus: hourCell?.adjustmentStatus ?? "Sem ajuste"
    });
    setWorkHourAdjustmentForm({
      requestedActualHours: hourCell?.effectiveHours === null || hourCell?.effectiveHours === undefined ? "" : formatWorkHourValue(hourCell.effectiveHours, ""),
      reason: "Erro de apontamento",
      justification: ""
    });
    setShowEditSchedule(true);
  }

  function closeScheduleEditor() {
    setShowEditSchedule(false);
    setScheduleEmployeeSearch("");
    setScheduleEmployeeSearchResults([]);
    setSelectedScheduleJustification(null);
    setJustificationDraft({
      absenceReason: "",
      reasonCategory: "Cronograma",
      supervisorJustification: "",
      hasEvidence: false,
      evidenceUrl: ""
    });
  }

  function openPendingJustification(record: AttendanceItem) {
    const attendanceRecordId = record.attendanceRecordId ?? (record.id && !record.id.startsWith("schedule:") ? record.id : "");
    const scheduleId = record.scheduleId ?? (record.id?.startsWith("schedule:") ? record.id.replace("schedule:", "") : "");
    setSelectedAttendancePending(record);
    setAttendanceMessage("");
    setAttendanceForm({
      attendanceRecordId,
      scheduleId,
      employeeId: record.employeeId,
      date: record.dateIso ?? record.date,
      shift: cleanShiftName(record.shift) || "Manhã",
      status: statusFromScheduleCell(record.status),
      absenceReason: record.absenceReason && record.absenceReason !== "Sem justificativa" ? record.absenceReason : "",
      reasonCategory: record.reasonCategory ?? "Cronograma",
      supervisorJustification: record.supervisorJustification ?? "",
      hasEvidence: false,
      evidenceUrl: "",
      impactsAbs: record.impactsAbs,
      impactsCoverage: record.impactsCoverage
    });
    setShowAttendance(true);
  }

  function openAttendanceJustification(row?: ScheduleGridRow, dayIndex = 0, value = "Falta") {
    const targetRow = row ?? scheduleRows[0];
    const targetEmployee = targetRow?.employee ?? scheduleEmployees[0];
    if (!targetEmployee) {
      setAttendanceMessage("Nenhum parceiro ativo encontrado para justificar ocorrência.");
      return;
    }
    const cellStatus = statusFromScheduleCell(value);
    const safeStatus = supervisorOccurrenceStatuses.includes(cellStatus) ? cellStatus : "Falta";
    setSelectedAttendancePending(null);
    setAttendanceForm({
      attendanceRecordId: "",
      scheduleId: "",
      employeeId: targetEmployee.id,
      date: visibleScheduleDates[dayIndex] ?? `${schedulePeriod.year}-${String(schedulePeriod.month).padStart(2, "0")}-${String(dayIndex + 1).padStart(2, "0")}`,
      shift: cleanShiftName(targetEmployee.shift) || "Manhã",
      status: safeStatus,
      absenceReason: "",
      reasonCategory: attendanceForm.reasonCategory || "Cronograma",
      supervisorJustification: "",
      hasEvidence: false,
      evidenceUrl: "",
      impactsAbs: safeStatus === "Falta",
      impactsCoverage: safeStatus === "Falta" || safeStatus === "Erro de cronograma"
    });
    setShowAttendance(true);
  }

  function closeAttendanceModal() {
    setShowAttendance(false);
    setSelectedAttendancePending(null);
  }

  async function saveScheduleEdit() {
    if (!scheduleEditForm.employeeId) {
      setAttendanceMessage("Selecione um parceiro.");
      return;
    }
    if (!scheduleEditForm.date || !scheduleEditForm.status) {
      setAttendanceMessage("Data e status são obrigatórios.");
      return;
    }
    if (statusNeedsTime(scheduleEditForm.status) && (!scheduleEditForm.shift || !scheduleEditForm.startsAt || !scheduleEditForm.endsAt)) {
      setAttendanceMessage("Turno, entrada e saída são obrigatórios para status produtivos.");
      return;
    }
    if (statusNeedsReason(scheduleEditForm.status) && !scheduleEditForm.pendingJustification && !justificationDraft.absenceReason.trim()) {
      setAttendanceMessage("Selecione o motivo da ocorrência ou marque como sem justificativa no momento.");
      return;
    }
    if (statusNeedsReason(scheduleEditForm.status) && !scheduleEditForm.observation.trim() && !justificationDraft.supervisorJustification.trim() && !scheduleEditForm.pendingJustification) {
      setAttendanceMessage("Informe uma observação/descrição ou marque como sem justificativa no momento.");
      return;
    }

    setSavingSchedule(true);
    try {
      const payload = await apiJson<{ data: unknown; summary: AttendanceSummary; schedules: { scheduleGridRows: typeof scheduleGridRows; attendanceSummary?: AttendanceSummary } }>("/api/schedules", {
        method: "PATCH",
        body: JSON.stringify({
          ...scheduleEditForm,
          absenceReason: statusNeedsReason(scheduleEditForm.status) && !scheduleEditForm.pendingJustification ? justificationDraft.absenceReason : undefined,
          reasonCategory: statusNeedsReason(scheduleEditForm.status) && !scheduleEditForm.pendingJustification ? justificationDraft.reasonCategory || "Cronograma" : undefined,
          supervisorJustification: statusNeedsReason(scheduleEditForm.status) && !scheduleEditForm.pendingJustification ? justificationDraft.supervisorJustification || scheduleEditForm.observation : undefined,
          hasEvidence: statusNeedsReason(scheduleEditForm.status) && !scheduleEditForm.pendingJustification ? justificationDraft.hasEvidence : undefined,
          evidenceUrl: statusNeedsReason(scheduleEditForm.status) && !scheduleEditForm.pendingJustification ? justificationDraft.evidenceUrl : undefined
        })
      });
      setAttendanceSummary(payload.schedules.attendanceSummary ?? payload.summary);
      setAttendanceMessage("Cronograma atualizado com histórico, auditoria e indicadores de presença/cobertura.");
      closeScheduleEditor();
      await refreshSchedules();
    } catch (error) {
      setAttendanceMessage(error instanceof Error ? error.message : "Não foi possível editar o cronograma.");
    } finally {
      setSavingSchedule(false);
    }
  }

  async function saveManualWorkHours(confirmOverwrite = false) {
    if (!scheduleEditForm.employeeId || !scheduleEditForm.date) {
      setAttendanceMessage("Parceiro e data são obrigatórios para lançar horas.");
      return;
    }
    if (!selectedCellHasSchedule) {
      setAttendanceMessage("Não é possível lançar horas sem cronograma vinculado.");
      return;
    }
    if (!selectedScheduleAllowsWorkHours) {
      setAttendanceMessage(selectedScheduleWorkHoursBlockReason);
      return;
    }
    const parsedActualHours = parseProductiveHoursInput(workHourForm.actualHours);
    if (parsedActualHours === null) {
      setAttendanceMessage(workHoursInputErrorMessage);
      return;
    }
    if (workHourForm.recordId && workHourForm.source && !/^manual$/i.test(workHourForm.source) && !confirmOverwrite) {
      const confirmed = window.confirm("Já existe um registro de horas importado para este dia. Deseja sobrescrever manualmente?");
      if (!confirmed) return;
      return saveManualWorkHours(true);
    }

    setSavingWorkHour(true);
    try {
      const payload = await apiJson<{ data: WorkHourRow; message?: string; warning?: string }>("/api/work-hours/manual", {
        method: "POST",
        body: JSON.stringify({
          employeeId: scheduleEditForm.employeeId,
          date: scheduleEditForm.date,
          actualHours: parsedActualHours,
          confirmOverwrite
        })
      });
      setWorkHourForm({
        recordId: payload.data.id,
        plannedStart: payload.data.plannedStart,
        plannedEnd: payload.data.plannedEnd,
        plannedHours: payload.data.plannedHours,
        actualHours: formatWorkHourValue(payload.data.actualHours, ""),
        effectiveHours: payload.data.effectiveHours,
        differenceMinutes: payload.data.differenceMinutes,
        status: payload.data.status,
        rawStatus: payload.data.rawStatus ?? "",
        source: payload.data.source,
        adjustmentId: payload.data.adjustmentId ?? "",
        adjustmentStatus: payload.data.adjustmentStatus
      });
      setAttendanceMessage(payload.warning ? `${payload.message ?? "Horas salvas."} ${payload.warning}` : payload.message ?? "Horas salvas.");
      await refreshSchedules();
    } catch (error) {
      setAttendanceMessage(error instanceof Error ? error.message : "Não foi possível salvar as horas.");
    } finally {
      setSavingWorkHour(false);
    }
  }

  async function deleteSelectedWorkHours() {
    if (!workHourForm.recordId) {
      setAttendanceMessage("Nenhum registro de horas selecionado para excluir.");
      return;
    }

    const confirmed = window.confirm("Excluir as horas lançadas e as justificativas de aderência vinculadas a este dia? O cronograma será mantido.");
    if (!confirmed) return;

    setDeletingWorkHour(true);
    try {
      await apiJson("/api/work-hours", {
        method: "DELETE",
        body: JSON.stringify({
          workHourRecordId: workHourForm.recordId,
          reason: "Exclusão pelo slot do cronograma"
        })
      });
      setWorkHourForm({
        recordId: "",
        plannedStart: workHourForm.plannedStart,
        plannedEnd: workHourForm.plannedEnd,
        plannedHours: workHourForm.plannedHours,
        actualHours: "",
        effectiveHours: 0,
        differenceMinutes: 0,
        status: "Sem horas",
        rawStatus: "",
        source: "",
        adjustmentId: "",
        adjustmentStatus: "Sem ajuste"
      });
      setAttendanceMessage("Horas e pendências de aderência vinculadas excluídas. O cronograma foi mantido.");
      await refreshSchedules();
    } catch (error) {
      setAttendanceMessage(error instanceof Error ? error.message : "Não foi possível excluir as horas.");
    } finally {
      setDeletingWorkHour(false);
    }
  }

  async function requestScheduleWorkHourAdjustment() {
    if (!workHourForm.recordId) {
      setAttendanceMessage("Ainda não existe registro de horas para solicitar ajuste. WFM/Admin precisa lançar ou importar as horas primeiro.");
      return;
    }
    if (!workHourAdjustmentForm.reason.trim() || !workHourAdjustmentForm.justification.trim()) {
      setAttendanceMessage("Motivo e justificativa são obrigatórios para solicitar ajuste de horas.");
      return;
    }
    if (!workHourAdjustmentForm.requestedActualHours.trim()) {
      setAttendanceMessage("Nova hora solicitada é obrigatória.");
      return;
    }
    const requestedActualHours = parseProductiveHoursInput(workHourAdjustmentForm.requestedActualHours);
    if (requestedActualHours === null) {
      setAttendanceMessage(requestedHoursInputErrorMessage);
      return;
    }
    setSavingWorkHourAdjustment(true);
    try {
      await apiJson("/api/work-hours", {
        method: "POST",
        body: JSON.stringify({
          workHourRecordId: workHourForm.recordId,
          requestedActualHours,
          reason: workHourAdjustmentForm.reason,
          justification: workHourAdjustmentForm.justification
        })
      });
      setAttendanceMessage("Ajuste de horas solicitado para análise do WFM/Admin.");
      closeScheduleEditor();
      await refreshSchedules();
    } catch (error) {
      setAttendanceMessage(error instanceof Error ? error.message : "Não foi possível solicitar ajuste de horas.");
    } finally {
      setSavingWorkHourAdjustment(false);
    }
  }

  async function removeSelectedEmployeeSchedule(scope: "month" | "all" = "month") {
    if (!scheduleEditForm.employeeId) return;
    // The editor is opened from a date cell. Use that date as the source of
    // truth, rather than the page's initial period, which can differ after a
    // custom date-range is applied.
    const selectedDate = parseDateInput(scheduleEditForm.date);
    const selectedPeriod = selectedDate
      ? { month: selectedDate.getUTCMonth() + 1, year: selectedDate.getUTCFullYear() }
      : schedulePeriod;
    const selectedMonthLabel = scheduleMonthFormatter.format(operationalDateFromParts(selectedPeriod.year, selectedPeriod.month, 1));
    const confirmed = window.confirm(scope === "all"
      ? "Isso removerá todos os cronogramas deste parceiro, mas não excluirá o cadastro. Continuar?"
      : `Isso removerá somente os registros de cronograma de ${selectedMonthLabel} deste parceiro, sem alterar os demais meses. Continuar?`);
    if (!confirmed) return;

    setSavingSchedule(true);
    try {
      const payload = await apiJson<{ message: string }>("/api/schedules", {
        method: "DELETE",
        body: JSON.stringify({ employeeId: scheduleEditForm.employeeId, month: selectedPeriod.month, year: selectedPeriod.year, scope })
      });
      setAttendanceMessage(payload.message ?? "Cronograma removido.");
      closeScheduleEditor();
      await refreshSchedules();
    } catch (error) {
      setAttendanceMessage(error instanceof Error ? error.message : "Não foi possível remover o cronograma do parceiro.");
    } finally {
      setSavingSchedule(false);
    }
  }

  async function saveAttendance() {
    if (savingJustification) return;
    if (statusNeedsReason(attendanceForm.status)) {
      if (!attendanceForm.absenceReason.trim()) {
        setAttendanceMessage("Motivo da ocorrência é obrigatório.");
        return;
      }
      if (!attendanceForm.supervisorJustification.trim()) {
        setAttendanceMessage("Descrição da ocorrência é obrigatória.");
        return;
      }
    }

    setSavingJustification(true);
    try {
      const payload = await apiJson<{ data: Partial<AttendanceItem>; summary?: AttendanceSummary; message?: string }>("/api/attendance", {
        method: "POST",
        body: JSON.stringify(attendanceForm)
      });
      if (payload.summary) setAttendanceSummary(payload.summary);
      const employeeName = payload.data.employeeName ?? scheduleRows.find((row) => row.employee.id === attendanceForm.employeeId)?.employee.name ?? attendanceForm.employeeId;
      setAttendanceMessage(payload.message ?? `${employeeName}: ${payload.data.status ?? attendanceForm.status} registrado. ABS/cobertura/auditoria atualizados.`);
      closeAttendanceModal();
      if (isScheduleSupervisor) {
        void refreshAttendanceForSchedulePeriod(scheduleDateRange, scheduleFilters);
        void refreshScheduleSummary(scheduleDateRange, scheduleFilters);
      } else {
        void refreshSchedules();
      }
    } catch (error) {
      setAttendanceMessage(error instanceof Error ? error.message : "Não foi possível salvar presença/ocorrência.");
    } finally {
      setSavingJustification(false);
    }
  }

  async function saveSlotJustification() {
    if (savingJustification) return;
    if (!scheduleEditForm.employeeId || !scheduleEditForm.date) {
      setAttendanceMessage("Parceiro e data são obrigatórios para revisar a justificativa.");
      return;
    }
    if (!statusNeedsReason(scheduleEditForm.status)) {
      setAttendanceMessage("Este status não exige justificativa.");
      return;
    }
    if (!justificationDraft.absenceReason.trim()) {
      setAttendanceMessage("Motivo da ocorrência é obrigatório.");
      return;
    }
    if (!justificationDraft.supervisorJustification.trim()) {
      setAttendanceMessage("Descrição da ocorrência é obrigatória.");
      return;
    }

    setSavingJustification(true);
    try {
      const payload = await apiJson<{ data: Partial<AttendanceItem>; summary?: AttendanceSummary; message?: string }>("/api/attendance", {
        method: "POST",
        body: JSON.stringify({
          attendanceRecordId: selectedScheduleJustification?.id,
          scheduleId: scheduleEditForm.scheduleId || undefined,
          employeeId: scheduleEditForm.employeeId,
          date: scheduleEditForm.date,
          shift: scheduleEditForm.shift,
          status: scheduleEditForm.status,
          absenceReason: justificationDraft.absenceReason,
          reasonCategory: justificationDraft.reasonCategory || "Cronograma",
          supervisorJustification: justificationDraft.supervisorJustification,
          hasEvidence: justificationDraft.hasEvidence,
          evidenceUrl: justificationDraft.evidenceUrl,
          impactsAbs: scheduleEditForm.status === "Falta",
          impactsCoverage: scheduleEditForm.status === "Falta" || scheduleEditForm.status === "Erro de cronograma"
        })
      });
      if (payload.summary) setAttendanceSummary(payload.summary);
      setSelectedScheduleJustification({
        id: payload.data.id,
        status: payload.data.status ?? scheduleEditForm.status,
        justificationStatus: payload.data.isJustified === false ? "Justificativa pendente" : payload.data.reasonClassification === "UNJUSTIFIED" ? "Injustificado" : "Justificado",
        absenceReason: payload.data.absenceReason,
        reasonClassification: payload.data.reasonClassification,
        reasonClassificationLabel: payload.data.reasonClassification === "JUSTIFIED" ? "Justificado" : payload.data.reasonClassification === "UNJUSTIFIED" ? "Injustificado" : undefined,
        reasonCategory: payload.data.reasonCategory,
        supervisorJustification: payload.data.supervisorJustification,
        isJustified: payload.data.isJustified,
        impactsAbs: payload.data.impactsAbs,
        impactsCoverage: payload.data.impactsCoverage,
        registeredBy: payload.data.registeredBy,
        registeredAt: payload.data.registeredAt,
        justifiedBy: payload.data.justifiedBy,
        justifiedAt: payload.data.justifiedAt,
        updatedAt: payload.data.updatedAt
      });
      setAttendanceMessage(payload.message ?? "Justificativa atualizada com sucesso.");
      setPendingJustifications((items) => items.filter((record) => {
        if (payload.data.id && (record.id === payload.data.id || record.attendanceRecordId === payload.data.id)) return false;
        if (scheduleEditForm.scheduleId && record.scheduleId === scheduleEditForm.scheduleId) return false;
        return !(record.employeeId === scheduleEditForm.employeeId && (record.dateIso ?? record.date) === scheduleEditForm.date);
      }));
      void refreshAttendanceForSchedulePeriod(scheduleDateRange, scheduleFilters);
      void refreshScheduleSummary(scheduleDateRange, scheduleFilters);
    } catch (error) {
      setAttendanceMessage(error instanceof Error ? error.message : "Não foi possível atualizar a justificativa.");
    } finally {
      setSavingJustification(false);
    }
  }

  const validation = previewResult
    ? { errors: previewResult.errorRows, warnings: previewResult.validation.reduce((total, row) => total + row.warnings.length, 0) }
    : validateImportRows(previewRows);
  const attendanceRequiresReason = statusNeedsReason(attendanceForm.status);
  const scheduleEditRequiresReason = statusNeedsReason(scheduleEditForm.status);
  const scheduleEditRequiresTime = statusNeedsTime(scheduleEditForm.status);
  const scheduleCellValues = scheduleRows.flatMap((row) => row.days);
  const scheduledCells = scheduleCellValues.filter((value) => !["Folga", "Sem cronograma", "Férias"].includes(value)).length;
  const conflictCount = scheduleCellValues.filter((value) => value === "Conflito").length;
  const unscheduledCount = scheduleCellValues.filter((value) => value === "Sem cronograma" || value === "Descoberto").length;
  const filteredPendingJustifications =
    pendingSupervisorFilter === "Todos"
      ? pendingJustifications
      : pendingJustifications.filter((record) => (record.supervisor || "Sem supervisor") === pendingSupervisorFilter);
  const scheduleAlertItems = ([
    conflictCount > 0 ? {
      title: `${conflictCount} conflitos de cronograma`,
      status: String(conflictCount),
      tone: "red" as const,
      detail: "Revise células marcadas como conflito no período selecionado."
    } : null,
    unscheduledCount > 0 ? {
      title: `${unscheduledCount} células sem cronograma/descobertas`,
      status: String(unscheduledCount),
      tone: "orange" as const,
      detail: "Há dias sem cronograma vinculado ou descoberta nos filtros atuais."
    } : null,
    filteredPendingJustifications.length > 0 ? {
      title: `${filteredPendingJustifications.length} justificativas pendentes`,
      status: String(filteredPendingJustifications.length),
      tone: "orange" as const,
      detail: "Faltas ou erros de cronograma aguardando justificativa do supervisor."
    } : null,
    ...importHistory
      .filter((file) => (file.errorRows ?? 0) > 0 || (file.warningRows ?? 0) > 0 || /erro|falha|partial|parcial/i.test(file.status))
      .map((file) => ({
        title: `Importação com alerta: ${file.fileName}`,
        status: file.status,
        tone: ((file.errorRows ?? 0) > 0 || /erro|falha/i.test(file.status) ? "red" : "orange") as "red" | "orange",
        detail: `${file.errorRows ?? 0} erro(s), ${file.warningRows ?? 0} alerta(s), ${file.importedRows} linha(s) válidas.`
      }))
  ] as Array<ScheduleAlertItem | null>).filter((item): item is ScheduleAlertItem => item !== null);
  const plannedHours = scheduledCells * DEFAULT_PRODUCTIVE_HOURS;
  const scheduleTotalRows = schedulePagination.total || scheduleRows.length;
  const scheduleQuantity = scheduleMetrics.quantity;
  const scheduleSummaryItems = [
    { label: "Parceiros", value: scheduleTotalRows },
    { label: "Quantidade", value: scheduleQuantity },
    { label: "ABS", value: `${attendanceSummary?.absRate ?? 0}%` },
    { label: "Pendências", value: attendanceSummary?.unjustified ?? 0 }
  ];
  const schedulePageStart = scheduleTotalRows && scheduleRows.length ? (schedulePagination.page - 1) * schedulePagination.limit + 1 : 0;
  const schedulePageEnd = scheduleTotalRows ? Math.min(schedulePagination.page * schedulePagination.limit, scheduleTotalRows) : 0;
  const monthLabel = scheduleMonthFormatter.format(operationalDateFromParts(schedulePeriod.year, schedulePeriod.month, 1));
  const visibleScheduleDates = scheduleDateColumns.length
    ? scheduleDateColumns
    : dateInputsBetween(scheduleDateRange.startDate, scheduleDateRange.endDate);
  const scheduleBatchWbs = scheduleBatchValues();
  const scheduleRowEmployees = scheduleRows.map((row) => row.employee as EmployeeClient);
  const employeeOptions = Array.from(
    new Map([...scheduleEmployees, ...scheduleRowEmployees, ...scheduleEmployeeSearchResults].map((employee) => [employee.id, employee])).values()
  );
  const scheduleEmployeeSearchTerm = scheduleEmployeeSearch.trim().toLowerCase();
  const filteredScheduleEmployeeOptions = employeeOptions
    .filter((employee) => {
      if (!scheduleEmployeeSearchTerm) return true;
      return [employee.name, employee.wb, employee.email].filter(Boolean).join(" ").toLowerCase().includes(scheduleEmployeeSearchTerm);
    })
    .slice(0, 60);
  const configuredLobs = scheduleSettings?.lobs.filter((lob) => lob.status !== "INACTIVE").map((lob) => lob.name) ?? [];
  const configuredShifts = scheduleSettings?.shifts.filter((shift) => shift.status !== "INACTIVE" && isSelectableShiftName(shift.name)).map((shift) => cleanShiftName(shift.name)) ?? [];
  const configuredShiftCategories = scheduleSettings?.shifts.filter((shift) => shift.status !== "INACTIVE" && isSelectableShiftName(shift.name)).map((shift) => shiftCategoryName(shift.name)) ?? [];
  const availableShiftNames = cleanShiftOptions(configuredShifts, true);
  const uniqueLobs = ["Todos", ...Array.from(new Set([...configuredLobs, ...scheduleRows.map((row) => row.employee.lob).filter(Boolean), ...scheduleEmployees.map((employee) => employee.lob).filter(Boolean)]))];
  const uniqueSupervisors = ["Todos", ...Array.from(new Set(["Sem supervisor", ...scheduleRows.map((row) => row.employee.supervisor || "Sem supervisor"), ...scheduleEmployees.map((employee) => employee.supervisor || "Sem supervisor")].filter(Boolean)))];
  const uniqueSkills = [
    "Todos",
    "SEM_SKILL",
    ...Array.from(new Set([...scheduleSkillFilterOptions, ...scheduleRows.map((row) => (row.employee as EmployeeClient).skill), ...scheduleEmployees.map((employee) => employee.skill)].filter((skill): skill is string => Boolean(skill?.trim()) && skill !== "SEM_SKILL")))
  ];
  const uniqueRoleTitles = [
    "Todos",
    "Sem cargo",
    ...Array.from(new Set([
      ...(scheduleSettings?.roleTitles.filter((title) => title.status !== "INACTIVE").map((title) => title.name) ?? []),
      ...scheduleRows.map((row) => row.employee.role),
      ...scheduleEmployees.map((employee) => employee.role)
    ].filter((roleTitle): roleTitle is string => Boolean(roleTitle?.trim()) && roleTitle !== "Sem cargo")))
  ];
  const pendingSupervisorOptions = Array.from(
    new Map([
      ["Todos", "Todos"],
      ["Sem supervisor", "Sem supervisor"],
      ...(scheduleSettings?.supervisors ?? [])
        .filter((supervisor) => supervisor.status !== "INACTIVE")
        .map((supervisor) => [supervisor.name, supervisor.email ? `${supervisor.name} - ${supervisor.email}` : supervisor.name] as const),
      ...pendingJustifications.map((record) => [record.supervisor || "Sem supervisor", record.supervisor || "Sem supervisor"] as const)
    ]).entries()
  ).map(([value, label]) => ({ value, label }));
  const uniqueShifts = ["Todos", "Sem turno", ...cleanShiftOptions(configuredShiftCategories, true)];
  const canManageSchedules = canEditSchedule({ role: scheduleActorRole });
  const canExportSchedules = canViewSchedules({ role: scheduleActorRole });
  const isScheduleSupervisor = normalizeRole(scheduleActorRole) === "SUPERVISOR";
  const selectedScheduleEmployee = employeeOptions.find((employee) => employee.id === scheduleEditForm.employeeId);
  const selectedCellHasSchedule = Boolean(scheduleEditForm.scheduleId);
  const selectedScheduleWorkHoursGate = {
    status: scheduleEditForm.status,
    startsAt: scheduleEditForm.startsAt,
    endsAt: scheduleEditForm.endsAt,
    shiftName: scheduleEditForm.shift
  };
  const selectedScheduleAllowsWorkHours = selectedCellHasSchedule && canScheduleStatusReceiveWorkHours(scheduleEditForm.status, selectedScheduleWorkHoursGate);
  const selectedScheduleWorkHoursBlockReason = selectedCellHasSchedule
    ? workHoursBlockedReasonForSchedule(selectedScheduleWorkHoursGate)
    : "Não é possível lançar horas sem cronograma vinculado.";
  const plannedHoursForManualPreview = selectedScheduleAllowsWorkHours ? DEFAULT_PRODUCTIVE_HOURS : workHourForm.plannedHours;
  const canEditOfficialWorkHours = canEditWorkHours({ role: scheduleActorRole });
  const canEditSelectedWorkHours = canEditOfficialWorkHours && selectedScheduleAllowsWorkHours;
  const canEditSlotJustification = scheduleEditRequiresReason && (canManageSchedules || isScheduleSupervisor);
  const parsedManualActualHours = parseProductiveHoursInput(workHourForm.actualHours);
  const manualActualHoursPreview = parsedManualActualHours ?? workHourForm.effectiveHours ?? 0;
  const hasManualActualHoursPreview = parsedManualActualHours !== null || Boolean(workHourForm.recordId);
  const parsedScheduleAdjustmentHours = parseProductiveHoursInput(workHourAdjustmentForm.requestedActualHours);
  const scheduleAdjustmentDifferenceMinutes = parsedScheduleAdjustmentHours !== null
    ? Math.round((parsedScheduleAdjustmentHours - (workHourForm.effectiveHours ?? 0)) * 60)
    : null;
  const manualDifferencePreview = hasManualActualHoursPreview && plannedHoursForManualPreview
    ? Math.round((manualActualHoursPreview - plannedHoursForManualPreview) * 60)
    : workHourForm.differenceMinutes;
  const manualStatusPreview = plannedHoursForManualPreview
    ? Math.abs(manualDifferencePreview) <= 5 ? "OK" : "Divergente"
    : workHourForm.recordId ? workHourForm.status : selectedCellHasSchedule ? "Sem horas" : "Sem cronograma";
  const supervisorOccurrenceStatuses = ["Falta", "Erro de cronograma"];
  const selectedScheduleStatusIsWorkflowManaged = (workflowManagedScheduleStatuses as readonly string[]).includes(scheduleEditForm.status);
  const selectedScheduleStatusIsWorkflowLocked =
    selectedScheduleStatusIsWorkflowManaged
    && !canAdminOverrideWorkflowScheduleStatus({ role: scheduleActorRole }, scheduleEditForm.status);
  const scheduleEditStatusOptions = selectedScheduleStatusIsWorkflowManaged
    ? withCurrentScheduleStatus([...scheduleEditableStatusOptions], scheduleEditForm.status)
    : [...scheduleEditableStatusOptions];
  const attendanceStatusOptions = withCurrentScheduleStatus(
    isScheduleSupervisor
      ? supervisorOccurrenceStatuses
      : [...scheduleEditableStatusOptions].filter((status) => status !== "Escalado"),
    attendanceForm.status
  );

  function configuredTimesForShift(shift: string) {
    const cleanedShift = cleanShiftName(shift) || "Manhã";
    const baseTimes = baseTimesForShift(cleanedShift);
    if (baseTimes?.startsAt && baseTimes.endsAt) return baseTimes;
    const configured = scheduleSettings?.shifts.find((item) => item.status !== "INACTIVE" && cleanShiftName(item.name) === cleanedShift);
    return configured ? { startsAt: configured.startsAt, endsAt: configured.endsAt } : timesForShift(cleanedShift);
  }

  function selectScheduleEmployee(employee: EmployeeClient) {
    const employeeShift = cleanShiftName(employee.shift) || scheduleEditForm.shift;
    const times = configuredTimesForShift(employeeShift);
    const nextStartsAt = scheduleEditRequiresTime ? times.startsAt : scheduleEditForm.startsAt;
    const nextEndsAt = scheduleEditRequiresTime ? times.endsAt : scheduleEditForm.endsAt;
    setScheduleEditForm((current) => ({
      ...current,
      scheduleId: "",
      employeeId: employee.id,
      shift: employeeShift || current.shift,
      startsAt: nextStartsAt,
      endsAt: nextEndsAt,
      lob: employee.lob || current.lob,
      supervisor: employee.supervisor || current.supervisor
    }));
    setWorkHourForm((current) => ({
      ...current,
      recordId: "",
      plannedStart: nextStartsAt,
      plannedEnd: nextEndsAt,
      plannedHours: canScheduleStatusReceiveWorkHours(scheduleEditForm.status, { status: scheduleEditForm.status, startsAt: nextStartsAt, endsAt: nextEndsAt, shiftName: employeeShift }) ? DEFAULT_PRODUCTIVE_HOURS : 0,
      actualHours: "",
      effectiveHours: 0,
      differenceMinutes: 0,
      status: "Sem horas",
      rawStatus: "",
      source: "",
      adjustmentId: "",
      adjustmentStatus: "Sem ajuste"
    }));
    setScheduleEmployeeSearch(employeeOptionLabel(employee));
  }

  function scheduleExportUrl() {
    const params = new URLSearchParams({
      month: String(schedulePeriod.month),
      year: String(schedulePeriod.year),
      startDate: scheduleDateRange.startDate,
      endDate: scheduleDateRange.endDate
    });
    if (scheduleFilters.collaborator) params.set("collaborator", scheduleFilters.collaborator);
    if (scheduleFilters.employeeId) params.set("employeeId", scheduleFilters.employeeId);
    if (scheduleFilters.lob !== "Todos") params.set("lob", scheduleFilters.lob);
    if (scheduleFilters.supervisor !== "Todos") params.set("supervisor", scheduleFilters.supervisor);
    if (scheduleFilters.shift !== "Todos") params.set("shift", scheduleFilters.shift);
    if (scheduleFilters.status !== "Todos") params.set("status", scheduleFilters.status);
    if (scheduleFilters.skill !== "Todos") params.set("skill", scheduleFilters.skill);
    if (scheduleFilters.roleTitle) params.set("roleTitle", scheduleFilters.roleTitle);
    if (scheduleBatchWbs.length) params.set("wbLogins", serializeWbLogins(scheduleBatchWbs));
    return `/api/schedules/export?${params.toString()}`;
  }

  async function downloadScheduleTemplate() {
    setDownloadingScheduleTemplate(true);
    setAttendanceMessage("");
    try {
      await downloadFile("/api/schedules/template", "template_cronograma_central_operacional.xlsx");
    } catch (error) {
      setAttendanceMessage(error instanceof Error ? error.message : "Não foi possível baixar o template. Tente novamente.");
    } finally {
      setDownloadingScheduleTemplate(false);
    }
  }

  return (
    <div>
      <PageHeader title="Cronogramas Consolidados" description="Visão consolidada dos cronogramas da operação" icon={CalendarCheck} actions={<TopActions />} />
      <div className="card mb-4 p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <button onClick={() => moveScheduleMonth(-1)} className="h-9 rounded-lg border border-border bg-white px-3 text-sm font-bold">Mês anterior</button>
            <div className="premium-control h-9 px-3.5 text-sm font-extrabold capitalize text-navy-950">{monthLabel}</div>
            <button onClick={() => moveScheduleMonth(1)} className="h-9 rounded-lg border border-border bg-white px-3 text-sm font-bold">Próximo mês</button>
          </div>
          <div className="flex gap-2">
            <select value={schedulePeriod.month} onChange={(event) => updateSchedulePeriod({ ...schedulePeriod, month: Number(event.target.value) })} className="h-9 rounded-lg border border-border px-3 text-sm font-bold outline-none">
              {Array.from({ length: 12 }).map((_, index) => <option key={index + 1} value={index + 1}>{String(index + 1).padStart(2, "0")}</option>)}
            </select>
            <input value={schedulePeriod.year} onChange={(event) => updateSchedulePeriod({ ...schedulePeriod, year: Number(event.target.value) || 2026 })} className="h-9 w-24 rounded-lg border border-border px-3 text-sm font-bold outline-none" />
          </div>
        </div>
        <div className="mb-3 flex flex-wrap items-end gap-2.5">
          <div className="flex rounded-lg border border-border bg-white p-1">
            {(["day", "week", "month"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => applyScheduleQuickRange(mode)}
                className={cn("h-8 rounded-md px-2.5 text-sm font-extrabold transition", scheduleRangeMode === mode ? "bg-blue-600 text-white shadow-soft" : "text-navy-950 hover:bg-blue-50")}
              >
                {mode === "day" ? "Dia" : mode === "week" ? "Semana" : "Mês"}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-muted">Data inicial</span>
            <input
              type="date"
              value={scheduleDateRange.startDate}
              onChange={(event) => {
                setScheduleRangeMode("custom");
                setScheduleDateRange((current) => ({ ...current, startDate: event.target.value }));
              }}
              className="h-9 rounded-lg border border-border px-3 text-sm font-bold outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-muted">Data final</span>
            <input
              type="date"
              value={scheduleDateRange.endDate}
              onChange={(event) => {
                setScheduleRangeMode("custom");
                setScheduleDateRange((current) => ({ ...current, endDate: event.target.value }));
              }}
              className="h-9 rounded-lg border border-border px-3 text-sm font-bold outline-none"
            />
          </label>
          <button type="button" onClick={applyScheduleDateRange} className="h-9 rounded-lg bg-blue-600 px-3.5 text-sm font-bold text-white">Aplicar datas</button>
          {scheduleDateError ? <span className="text-sm font-bold text-red-600">{scheduleDateError}</span> : null}
        </div>
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-8">
          <input value={scheduleFilters.collaborator} onChange={(event) => setScheduleFilters({ ...scheduleFilters, collaborator: event.target.value })} className="h-9 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Nome, WB ou e-mail" />
          <select value={scheduleFilters.lob} onChange={(event) => setScheduleFilters({ ...scheduleFilters, lob: event.target.value })} className="h-9 rounded-lg border border-border px-3 text-sm font-bold outline-none">{uniqueLobs.map((item) => <option key={item}>{item}</option>)}</select>
          <select value={scheduleFilters.supervisor} onChange={(event) => setScheduleFilters({ ...scheduleFilters, supervisor: event.target.value })} className="h-9 rounded-lg border border-border px-3 text-sm font-bold outline-none">{uniqueSupervisors.map((item) => <option key={item}>{item}</option>)}</select>
          <select value={scheduleFilters.shift} onChange={(event) => setScheduleFilters({ ...scheduleFilters, shift: event.target.value })} className="h-9 rounded-lg border border-border px-3 text-sm font-bold outline-none">{uniqueShifts.map((item) => <option key={item}>{item}</option>)}</select>
          <select value={scheduleFilters.status} onChange={(event) => setScheduleFilters({ ...scheduleFilters, status: event.target.value })} className="h-9 rounded-lg border border-border px-3 text-sm font-bold outline-none">{["Todos", ...scheduleStatusOptions].map((item) => <option key={item}>{item}</option>)}</select>
          <select value={scheduleFilters.skill} onChange={(event) => setScheduleFilters({ ...scheduleFilters, skill: event.target.value })} className="h-9 rounded-lg border border-border px-3 text-sm font-bold outline-none">
            {uniqueSkills.map((skill) => <option key={skill} value={skill}>{skill === "Todos" ? "Todas as skills" : skill === "SEM_SKILL" ? "Sem skill" : skill}</option>)}
          </select>
          <select value={scheduleFilters.roleTitle || "Todos"} onChange={(event) => setScheduleFilters({ ...scheduleFilters, roleTitle: event.target.value === "Todos" ? "" : event.target.value })} className="h-9 rounded-lg border border-border px-3 text-sm font-bold outline-none">
            {uniqueRoleTitles.map((roleTitle) => <option key={roleTitle} value={roleTitle}>{roleTitle}</option>)}
          </select>
          <div className="rounded-lg border border-dashed border-blue-200 bg-blue-50/50 p-3 md:col-span-2 xl:col-span-8">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-black uppercase text-blue-700">Filtro em lote por WB/Login</p>
                <p className="text-xs font-semibold text-muted">Cole vários logins e combine com período, LOB, supervisor, turno, status, skill e cargo.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setScheduleBatchOpen((current) => !current)} className="inline-flex h-8 items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 text-xs font-extrabold text-blue-700">
                  <Plus className="h-3.5 w-3.5" /> Adicionar múltiplos
                </button>
                {scheduleBatchWbs.length ? <button type="button" onClick={clearScheduleBatchWbs} className="h-8 rounded-lg border border-border bg-white px-3 text-xs font-extrabold text-navy-950">Limpar WBs</button> : null}
              </div>
            </div>
            {scheduleBatchOpen ? (
              <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                <textarea value={scheduleBatchText} onChange={(event) => setScheduleBatchText(event.target.value)} className="min-h-24 rounded-lg border border-border bg-white p-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" placeholder={"wb_joao01\nwb_maria02; wb_pedro03"} />
                <div className="flex items-end">
                  <button type="button" onClick={addScheduleBatchWbs} className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-extrabold text-white">Aplicar lote</button>
                </div>
              </div>
            ) : null}
            {scheduleBatchWbs.length ? (
              <div className="mt-3 flex max-h-24 flex-wrap gap-2 overflow-y-auto pr-1">
                {scheduleBatchWbs.map((value) => (
                  <span key={value} className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-extrabold text-blue-700">
                    {value}
                    <button type="button" onClick={() => removeScheduleBatchWb(value)} className="text-blue-400 hover:text-red-600">×</button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={applyScheduleFilters} className="rounded-lg bg-blue-600 px-3 text-sm font-bold text-white">Filtrar</button>
            <button
              onClick={clearScheduleFilters}
              className="rounded-lg border border-border bg-white px-3 text-sm font-bold"
            >
              Limpar
            </button>
          </div>
        </div>
      </div>
      {canManageSchedules ? <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => handleFile(event.target.files?.[0])} /> : null}
      <div className="mb-4 flex flex-wrap gap-2.5">
        {canManageSchedules ? (
          <>
            <button onClick={() => fileInputRef.current?.click()} className="flex h-10 items-center gap-2 rounded-lg border border-border bg-white px-3.5 text-sm font-bold text-navy-950 shadow-soft">
              <Upload className="h-4 w-4" />
              Upload Excel
            </button>
            <button
              type="button"
              disabled={downloadingScheduleTemplate}
              onClick={downloadScheduleTemplate}
              className="flex h-10 items-center gap-2 rounded-lg border border-border bg-white px-3.5 text-sm font-bold text-navy-950 shadow-soft disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {downloadingScheduleTemplate ? "Baixando..." : "Baixar Template"}
            </button>
            <a
              href={scheduleExportUrl()}
              className="flex h-10 items-center gap-2 rounded-lg border border-border bg-white px-3.5 text-sm font-bold text-navy-950 shadow-soft"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Baixar Cronogramas Consolidados
            </a>
            <button onClick={() => openScheduleEditor(undefined, 0, "Escalado")} className="flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-3.5 text-sm font-bold text-white shadow-soft">
              <Plus className="h-4 w-4" />
              Adicionar cronograma manual
            </button>
          </>
        ) : (
          <>
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
              Este perfil visualiza a grade. Justificativas ficam com Supervisores autorizados; upload, adição manual e presença ficam com WFM/Admin.
            </div>
            {canExportSchedules ? (
              <a href={scheduleExportUrl()} className="flex h-10 items-center gap-2 rounded-lg border border-border bg-white px-3.5 text-sm font-bold text-navy-950 shadow-soft">
                <FileSpreadsheet className="h-4 w-4" />
                Baixar Cronogramas Consolidados
              </a>
            ) : null}
          </>
        )}
      </div>

      {imported ? (
        <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
          {imported}
        </div>
      ) : null}
      {attendanceMessage ? (
        <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">
          {attendanceMessage}
        </div>
      ) : null}

      <div className={cn("grid gap-3", scheduleAnalysisPanelOpen ? "xl:grid-cols-[minmax(0,1fr)_360px]" : "xl:grid-cols-1")}>
        <section className="card overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-border bg-gradient-to-b from-white to-slate-50/65 px-3 py-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
              {scheduleSummaryItems.map((item) => (
                <div key={item.label} className="min-w-0 rounded-lg border border-border bg-white px-3 py-2 text-center shadow-soft">
                  <p className="truncate text-[18px] font-black leading-none text-navy-950" title={String(item.value)}>{item.value}</p>
                  <p className="mt-1 truncate text-[10px] font-extrabold uppercase tracking-wide text-muted" title={item.label}>{item.label}</p>
                </div>
              ))}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setScheduleAnalysisPanelOpen((open) => !open)}
                className="h-9 rounded-lg border border-blue-100 bg-blue-50 px-3 text-[11.5px] font-extrabold text-blue-700 hover:border-blue-200 hover:bg-blue-100"
              >
                {scheduleAnalysisPanelOpen ? "Ocultar painel" : "Mostrar painel"}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            {scheduleRows.length ? <table className="w-full min-w-[1130px] border-collapse text-[11.5px]">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-muted">
                  <th className="px-3 py-2">Parceiro</th>
                  <th className="px-3 py-2">Cargo</th>
                  <th className="px-3 py-2">LOB</th>
                  <th className="px-2 py-2 text-center">Escala</th>
                  <th className="px-2 py-2 text-center">Folga</th>
                  <th className="px-2 py-2 text-center">Faltas</th>
                  {visibleScheduleDates.map((dateIso) => (
                    <th key={dateIso} className="px-1.5 py-2 text-center">{formatScheduleDateHeader(dateIso)}</th>
                  ))}
                  <th className="px-3 py-2 text-center">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70 bg-white">
                {scheduleRows.map((row) => {
                  const workDays = countScheduleStatuses(row.days, scheduleWorkCountStatuses);
                  const dayOffDays = countScheduleStatuses(row.days, scheduleDayOffCountStatuses);
                  const absenceDays = countScheduleStatuses(row.days, scheduleAbsenceCountStatuses);
                  const employeeStatusBadge = scheduleEmployeeStatusBadge(row.employee.status);
                  return (
                  <tr key={row.employee.id} className="hover:bg-blue-50/30">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-500 text-[11px] font-bold text-white">{initials(row.employee.name)}</span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="min-w-0 font-bold text-navy-950">{row.employee.name}</p>
                            {employeeStatusBadge ? (
                              <span className={cn("inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-extrabold leading-none", employeeStatusBadge.className)}>
                                {employeeStatusBadge.label}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">{row.employee.role}</td>
                    <td className="px-3 py-2">{row.employee.lob}</td>
                    <td className="px-2 py-2 text-center"><span className="inline-flex min-w-10 justify-center rounded-full border border-blue-100 bg-blue-50 px-2 py-1 text-xs font-black text-blue-700">{workDays}</span></td>
                    <td className="px-2 py-2 text-center"><span className="inline-flex min-w-10 justify-center rounded-full border border-emerald-100 bg-emerald-50 px-2 py-1 text-xs font-black text-emerald-700">{dayOffDays}</span></td>
                    <td className="px-2 py-2 text-center"><span className="inline-flex min-w-10 justify-center rounded-full border border-red-100 bg-red-50 px-2 py-1 text-xs font-black text-red-700">{absenceDays}</span></td>
                    {row.days.map((value, index) => {
                      const hourCell = row.workHours?.[index] ?? null;
                      const slotLabel = scheduleSlotDisplayLabel(value);
                      const slotStatusTextClass = scheduleSlotStatusTextClass(value);
                      return (
                        <td key={`${row.employee.id}-${index}`} className="px-1 py-1.5 text-center">
                          <button
                            type="button"
                            title={value}
                            onClick={() => openScheduleEditor(row, index, value)}
                            className={cn(
                              "inline-flex h-[68px] w-[92px] flex-col items-center justify-center gap-1 overflow-hidden rounded-md px-1.5 py-1.5 text-center font-bold transition hover:ring-2 hover:ring-blue-200",
                              shiftTagClass(value),
                              hourCell?.rawStatus === "ADJUSTMENT_REQUESTED" && "ring-1 ring-amber-400"
                            )}
                          >
                            <span
                              className={cn("block h-[30px] w-full overflow-hidden text-center", slotStatusTextClass)}
                              style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, wordBreak: "break-word" }}
                            >
                              {slotLabel}
                            </span>
                            {hourCell ? (
                              <span
                                title={workHourAmountBadgeTitle(hourCell.effectiveHours)}
                                className={cn("grid h-[18px] w-[70px] place-items-center rounded px-1.5 text-[10px] leading-none", workHourAmountBadgeClass(hourCell.effectiveHours))}
                              >
                                {formatWorkHourValue(hourCell.effectiveHours)}
                              </span>
                            ) : (
                              <span className="grid h-[18px] w-[70px] place-items-center rounded bg-slate-100 px-1.5 text-[10px] leading-none text-slate-500 whitespace-nowrap">Sem horas</span>
                            )}
                          </button>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-center">
                      <button onClick={() => isScheduleSupervisor ? openAttendanceJustification(row, 0, row.days[0] ?? "Falta") : openScheduleEditor(row, 0, row.days[0] ?? "Escalado")} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
                        {isScheduleSupervisor ? "Justificar" : "Editar"}
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table> : <div className="p-8"><EmptyState title="Nenhum cronograma importado" description="Importe um cronograma para começar a visualizar a operação." /></div>}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-border px-5 py-3">
            {scheduleStatusOptions.map((status) => (
              <span key={status} className={cn("rounded-md px-2 py-1 text-xs font-bold", shiftTagClass(status))}>{status}</span>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-5 py-4 text-sm text-muted">
            <span>{scheduleTotalRows ? `Exibindo ${schedulePageStart}-${schedulePageEnd} de ${scheduleTotalRows} registros` : "Nenhum registro de cronograma"}</span>
            <div className="flex flex-wrap gap-2">
              <button disabled={schedulePagination.page <= 1} onClick={() => void refreshSchedules(1)} className="h-9 rounded-lg border border-border bg-white px-3 text-xs font-bold text-navy-950 disabled:cursor-not-allowed disabled:opacity-45">Primeira</button>
              <button disabled={schedulePagination.page <= 1} onClick={() => void refreshSchedules(schedulePagination.page - 1)} className="h-9 rounded-lg border border-border bg-white px-3 text-xs font-bold text-navy-950 disabled:cursor-not-allowed disabled:opacity-45">Anterior</button>
              <span className="grid h-9 min-w-24 place-items-center rounded-lg border border-blue-100 bg-blue-50 px-3 text-xs font-extrabold text-blue-700">
                {schedulePagination.page} de {schedulePagination.totalPages}
              </span>
              <button disabled={schedulePagination.page >= schedulePagination.totalPages} onClick={() => void refreshSchedules(schedulePagination.page + 1)} className="h-9 rounded-lg border border-border bg-white px-3 text-xs font-bold text-navy-950 disabled:cursor-not-allowed disabled:opacity-45">Próxima</button>
              <button disabled={schedulePagination.page >= schedulePagination.totalPages} onClick={() => void refreshSchedules(schedulePagination.totalPages)} className="h-9 rounded-lg border border-border bg-white px-3 text-xs font-bold text-navy-950 disabled:cursor-not-allowed disabled:opacity-45">Última</button>
            </div>
          </div>
        </section>

        {scheduleAnalysisPanelOpen ? (
        <aside className="space-y-3">
          <Panel
            title="Pendências de Justificativa"
            action={filteredPendingJustifications.length ? `${filteredPendingJustifications.length} aberta(s)` : undefined}
            actionOnClick={() => setShowPendingJustifications(true)}
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label className="text-xs font-extrabold uppercase tracking-[0.08em] text-muted" htmlFor="pending-supervisor-filter">
                Supervisor
              </label>
              <select
                id="pending-supervisor-filter"
                value={pendingSupervisorFilter}
                onChange={(event) => setPendingSupervisorFilter(event.target.value)}
                className="premium-control h-10 min-w-0 flex-1 px-3 text-sm font-bold text-navy-950 outline-none"
              >
                {pendingSupervisorOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            {filteredPendingJustifications.length ? (
              <div className="space-y-3">
                {filteredPendingJustifications.slice(0, 6).map((record) => (
                  <div key={record.id} className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-extrabold text-navy-950">{record.employeeName}</p>
                        <p className="text-xs font-semibold text-orange-800">{record.date} • {cleanShiftName(record.shift) || "Sem turno"} • {record.status}</p>
                        <p className="mt-1 text-xs font-semibold text-muted">Supervisor: {record.supervisor || "Sem supervisor"}</p>
                        <p className="mt-1 text-xs text-muted">Registrado por {record.registeredBy}</p>
                      </div>
                      <button onClick={() => openPendingJustification(record)} className="rounded-lg bg-orange-600 px-3 py-2 text-xs font-bold text-white">
                        Justificar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title={pendingSupervisorFilter === "Todos" ? "Sem pendências" : "Sem pendências para este supervisor"}
                description={pendingSupervisorFilter === "Todos" ? "Faltas ou erros de cronograma sem justificativa aparecerão aqui." : "Nenhuma pendência de justificativa encontrada para este supervisor."}
              />
            )}
          </Panel>
          <Panel title="Cobertura">
            <DonutLegend
              total={`${attendanceSummary?.coverageRate ?? 0}%`}
              items={[
                { label: "Produtivo programado", value: formatWorkHourValue(plannedHours, "0:00"), color: "#10B981" },
                { label: "Atenção", value: "0:00", color: "#F59E0B" },
                { label: "Descoberto", value: formatWorkHourValue(unscheduledCount * DEFAULT_PRODUCTIVE_HOURS, "0:00"), color: "#EF4444" },
                { label: "Sem programação", value: formatWorkHourValue(unscheduledCount * DEFAULT_PRODUCTIVE_HOURS, "0:00"), color: "#CBD5E1" }
              ]}
            />
          </Panel>
          <Panel title="Alertas e Conflitos" action="Ver todos os alertas" actionOnClick={() => setShowScheduleAlerts(true)}>
            {scheduleAlertItems.length ? (
              <MiniAlertList items={scheduleAlertItems.slice(0, 3)} />
            ) : <EmptyState title="Sem alertas" description="Alertas aparecerão após importação e validação do cronograma real." />}
          </Panel>
          <Panel title="Importações Recentes" action="Ver todas" actionOnClick={() => setShowScheduleImports(true)}>
            {importHistory.length ? importHistory.slice(0, 5).map((file) => (
              <div key={file.id} className="mb-3 flex items-center gap-3 last:mb-0">
                <FileSpreadsheet className="h-8 w-8 text-emerald-600" />
                <div className="flex-1">
                  <p className="text-sm font-bold text-navy-950">{file.fileName}</p>
                  <p className="text-xs text-muted">Importado por {file.user} • {file.importedRows} linhas</p>
                </div>
                <StatusBadge status={file.status} />
              </div>
            )) : <EmptyState title="Nenhuma importação" description="Os arquivos importados aparecerão aqui." />}
          </Panel>
        </aside>
        ) : null}
      </div>

      {showPendingJustifications ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[88vh] w-full max-w-4xl overflow-y-auto p-5">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Pendências abertas do cronograma</h2>
                <p className="text-sm text-muted">
                  Ocorrências sem justificativa dentro do período e filtros atuais.
                  Supervisor: {pendingSupervisorFilter === "Todos" ? "Todos" : pendingSupervisorFilter}.
                </p>
              </div>
              <button type="button" onClick={() => setShowPendingJustifications(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <label className="text-xs font-extrabold uppercase tracking-[0.08em] text-muted" htmlFor="pending-supervisor-modal-filter">
                Supervisor
              </label>
              <select
                id="pending-supervisor-modal-filter"
                value={pendingSupervisorFilter}
                onChange={(event) => setPendingSupervisorFilter(event.target.value)}
                className="premium-control h-10 min-w-56 px-3 text-sm font-bold text-navy-950 outline-none"
              >
                {pendingSupervisorOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <span className="rounded-md bg-orange-50 px-2 py-1 text-xs font-black text-orange-700">
                {filteredPendingJustifications.length} pendência(s)
              </span>
            </div>
            {filteredPendingJustifications.length ? (
              <div className="space-y-3">
                {filteredPendingJustifications.map((record) => (
                  <div key={record.id} className="rounded-xl border border-orange-200 bg-orange-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-navy-950" title={record.employeeName}>{record.employeeName}</p>
                        <p className="mt-1 text-xs font-semibold text-orange-800">
                          {record.date} • {cleanShiftName(record.shift) || "Sem turno"} • {record.status}
                        </p>
                        <p className="mt-1 text-xs text-muted">Supervisor: {record.supervisor || "Sem supervisor"} • WB/Login: {record.wbLogin || "Não informado"}</p>
                        <p className="mt-1 text-xs text-muted">Motivo: {record.absenceReason || "Sem justificativa"} • Registrado por {record.registeredBy}</p>
                        <p className="mt-1 text-xs text-muted">Ação recomendada: justificar ocorrência ou corrigir o status do cronograma.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setShowPendingJustifications(false);
                          openPendingJustification(record);
                        }}
                        className="rounded-lg bg-orange-600 px-3 py-2 text-xs font-bold text-white"
                      >
                        Regularizar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="Nenhuma pendência aberta para os filtros selecionados."
                description={pendingSupervisorFilter === "Todos" ? "Quando surgir falta, atraso ou saída antecipada sem justificativa, o item aparecerá aqui." : "Nenhuma pendência de justificativa encontrada para este supervisor."}
              />
            )}
          </div>
        </div>
      ) : null}

      {showScheduleAlerts ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[88vh] w-full max-w-3xl overflow-y-auto p-5">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Alertas e conflitos do cronograma</h2>
                <p className="text-sm text-muted">Período atual, filtros aplicados e pendências reais carregadas da operação.</p>
              </div>
              <button type="button" onClick={() => setShowScheduleAlerts(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            {scheduleAlertItems.length ? (
              <div className="space-y-3">
                {scheduleAlertItems.map((item) => (
                  <div key={`${item.title}-${item.status}`} className="rounded-xl border border-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-extrabold text-navy-950">{item.title}</p>
                        <p className="mt-1 text-xs font-semibold text-muted">{item.detail}</p>
                      </div>
                      <StatusBadge status={item.status} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Nenhum alerta encontrado para o período selecionado." description="Ao surgir conflito, falta pendente ou importação com erro, o item aparecerá aqui." />
            )}
          </div>
        </div>
      ) : null}

      {showScheduleImports ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[88vh] w-full max-w-4xl overflow-y-auto p-5">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Histórico de importações</h2>
                <p className="text-sm text-muted">Últimas importações reais de cronograma registradas no banco.</p>
              </div>
              <button type="button" onClick={() => setShowScheduleImports(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            {importHistory.length ? (
              <div className="space-y-3">
                {importHistory.map((file) => (
                  <div key={file.id} className="rounded-xl border border-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-navy-950" title={file.fileName}>{file.fileName}</p>
                        <p className="mt-1 text-xs font-semibold text-muted">Importado por {file.user} • {file.createdAt}</p>
                        <p className="mt-2 text-xs text-muted">
                          Total: {file.totalRows ?? file.importedRows} • Válidas: {file.importedRows} • Erros: {file.errorRows ?? 0} • Alertas: {file.warningRows ?? 0}
                        </p>
                      </div>
                      <StatusBadge status={file.status} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Nenhuma importação recente encontrada." description="Quando um cronograma for importado, o histórico aparecerá aqui." />
            )}
          </div>
        </div>
      ) : null}

      {showEditSchedule ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[90vh] w-full max-w-5xl overflow-y-auto p-5">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">{canManageSchedules ? "Editar cronograma e horas" : "Visualizar cronograma e horas"}</h2>
                <p className="text-sm text-muted">{selectedScheduleEmployee ? `${employeeOptionLabel(selectedScheduleEmployee)} • ${scheduleEditForm.date}` : "Atualiza histórico, auditoria e horas oficiais quando aplicável."}</p>
              </div>
              <button onClick={closeScheduleEditor} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
              <section className="rounded-xl border border-border p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-extrabold text-navy-950">Cronograma</h3>
                    <p className="text-xs text-muted">Planejado do dia e status da célula.</p>
                  </div>
                  <StatusBadge status={scheduleEditForm.status} />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="block md:col-span-2">
                    <span className="mb-1.5 block text-sm font-bold text-muted">Parceiro</span>
                    <div className="rounded-lg border border-border bg-white p-2">
                      <input
                        disabled={!canManageSchedules}
                        value={scheduleEmployeeSearch}
                        onChange={(event) => setScheduleEmployeeSearch(event.target.value)}
                        className="h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                        placeholder="Buscar por nome, WB/Login ou e-mail"
                      />
                      {selectedScheduleEmployee ? (
                        <div className="mt-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800">
                          Selecionado: {employeeOptionLabel(selectedScheduleEmployee)}
                        </div>
                      ) : (
                        <div className="mt-2 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                          Selecione um parceiro.
                        </div>
                      )}
                      {canManageSchedules ? (
                        <div className="mt-2 max-h-52 overflow-y-auto rounded-md border border-border bg-white">
                          {loadingScheduleEmployeeSearch ? (
                            <div className="px-3 py-3 text-sm font-semibold text-muted">Buscando parceiros...</div>
                          ) : filteredScheduleEmployeeOptions.length ? (
                            filteredScheduleEmployeeOptions.map((employee) => (
                              <button
                                type="button"
                                key={employee.id}
                                onClick={() => selectScheduleEmployee(employee)}
                                className={cn(
                                  "block w-full px-3 py-2 text-left text-sm font-semibold transition hover:bg-blue-50",
                                  employee.id === scheduleEditForm.employeeId ? "bg-blue-50 text-blue-700" : "text-navy-950"
                                )}
                              >
                                <span className="block truncate">{employeeOptionLabel(employee)}</span>
                                <span className="block truncate text-xs font-medium text-muted">{employee.lob} • {cleanShiftName(employee.shift) || "Sem turno"} • {employee.status}</span>
                              </button>
                            ))
                          ) : (
                            <div className="px-3 py-3 text-sm font-semibold text-muted">Nenhum parceiro encontrado.</div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <FormInput disabled={!canManageSchedules} label="Data" type="date" value={scheduleEditForm.date} onChange={(value) => setScheduleEditForm({ ...scheduleEditForm, scheduleId: "", date: value })} />
                  <FormSelect
                    disabled={!canManageSchedules}
                    label="Turno"
                    value={scheduleEditForm.shift}
                    options={availableShiftNames}
                    onChange={(value) => {
                      const times = configuredTimesForShift(value);
                      setScheduleEditForm({ ...scheduleEditForm, shift: value, startsAt: scheduleEditRequiresTime ? times.startsAt : scheduleEditForm.startsAt, endsAt: scheduleEditRequiresTime ? times.endsAt : scheduleEditForm.endsAt });
                    }}
                  />
                  <FormSelect
                    disabled={!canManageSchedules || selectedScheduleStatusIsWorkflowLocked}
                    label="Status do cronograma"
                    value={scheduleEditForm.status}
                    options={scheduleEditStatusOptions}
                    onChange={(value) => {
                      const times = configuredTimesForShift(scheduleEditForm.shift);
                      const nextStartsAt = statusNeedsTime(value) ? scheduleEditForm.startsAt || times.startsAt : "";
                      const nextEndsAt = statusNeedsTime(value) ? scheduleEditForm.endsAt || times.endsAt : "";
                      const plannedHours = canScheduleStatusReceiveWorkHours(value, { status: value, startsAt: nextStartsAt, endsAt: nextEndsAt, shiftName: scheduleEditForm.shift }) ? DEFAULT_PRODUCTIVE_HOURS : 0;
                      setScheduleEditForm({
                        ...scheduleEditForm,
                        status: value,
                        startsAt: nextStartsAt,
                        endsAt: nextEndsAt,
                        observation: statusNeedsReason(value) ? scheduleEditForm.observation : scheduleEditForm.observation,
                        pendingJustification: statusNeedsReason(value) ? scheduleEditForm.pendingJustification : false
                      });
                      setWorkHourForm((current) => ({ ...current, plannedHours }));
                    }}
                  />
                  <FormInput disabled={!canManageSchedules} label="Entrada prevista" value={scheduleEditForm.startsAt} onChange={(value) => setScheduleEditForm({ ...scheduleEditForm, startsAt: value })} />
                  <FormInput disabled={!canManageSchedules} label="Saída prevista" value={scheduleEditForm.endsAt} onChange={(value) => setScheduleEditForm({ ...scheduleEditForm, endsAt: value })} />
                  <FormInput disabled={!canManageSchedules} label="LOB" value={scheduleEditForm.lob} onChange={(value) => setScheduleEditForm({ ...scheduleEditForm, lob: value })} />
                  <FormInput disabled={!canManageSchedules} label="Supervisor" value={scheduleEditForm.supervisor} onChange={(value) => setScheduleEditForm({ ...scheduleEditForm, supervisor: value })} />
                  <label className="md:col-span-2">
                    <span className="mb-1.5 block text-sm font-bold text-muted">{scheduleEditRequiresReason ? "Motivo/observação obrigatória" : "Observação do cronograma"}</span>
                    <textarea disabled={!canManageSchedules} value={scheduleEditForm.observation} onChange={(event) => setScheduleEditForm({ ...scheduleEditForm, observation: event.target.value })} className="min-h-24 w-full rounded-lg border border-border p-3 outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500" placeholder={scheduleEditRequiresReason ? "Obrigatório para falta ou erro de cronograma" : "Opcional para este status"} />
                  </label>
                  {scheduleEditRequiresReason && canManageSchedules ? (
                    <label className="md:col-span-2 flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-semibold text-orange-800">
                      <input
                        type="checkbox"
                        checked={scheduleEditForm.pendingJustification}
                        onChange={(event) => setScheduleEditForm({ ...scheduleEditForm, pendingJustification: event.target.checked, observation: event.target.checked ? "" : scheduleEditForm.observation })}
                        className="mt-1"
                      />
                      <span>
                        Sem justificativa no momento
                        <span className="mt-1 block text-xs font-medium text-orange-700">
                          WFM registra a ocorrência agora e o Supervisor recebe uma pendência para justificar depois.
                        </span>
                      </span>
                    </label>
                  ) : null}
                </div>
                <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
                  {selectedScheduleStatusIsWorkflowLocked
                    ? "Este status veio de Solicitações/Esteira e somente ADMIN pode corrigir este slot manualmente."
                    : selectedScheduleStatusIsWorkflowManaged
                      ? "ADMIN pode corrigir este slot mantendo o histórico e a auditoria da alteração."
                    : canManageSchedules ? scheduleEditForm.pendingJustification ? "A célula ficará destacada como pendente de justificativa até o Supervisor justificar." : scheduleEditRequiresTime ? "Este status exige turno, entrada e saída." : "Este status permite entrada/saída vazias." : "Supervisor visualiza o cronograma e solicita ajustes; WFM/Admin altera o planejado."}
                </div>
                <div className="mt-4 rounded-xl border border-border bg-slate-50 p-4">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-extrabold text-navy-950">Justificativa da ocorrência</h4>
                      <p className="text-xs font-semibold text-muted">
                        {scheduleEditRequiresReason ? "Motivo conectado ao registro oficial de presença." : "Este status não exige justificativa."}
                      </p>
                    </div>
                    {scheduleEditRequiresReason ? (
                      <StatusBadge status={selectedScheduleJustification?.justificationStatus ?? "Justificativa pendente"} />
                    ) : null}
                  </div>

                  {scheduleEditRequiresReason ? (
                    <div className="space-y-4">
                      <div className="grid gap-3 text-sm md:grid-cols-2">
                        <div className="rounded-lg border border-border bg-white p-3">
                          <span className="block text-xs font-bold uppercase tracking-wide text-muted">Status do cronograma</span>
                          <span className="mt-1 block font-extrabold text-navy-950">{scheduleEditForm.status}</span>
                        </div>
                        <div className="rounded-lg border border-border bg-white p-3">
                          <span className="block text-xs font-bold uppercase tracking-wide text-muted">Status da justificativa</span>
                          <span className="mt-1 block font-extrabold text-navy-950">{selectedScheduleJustification?.justificationStatus ?? "Justificativa pendente"}</span>
                        </div>
                        <div className="rounded-lg border border-border bg-white p-3">
                          <span className="block text-xs font-bold uppercase tracking-wide text-muted">Motivo</span>
                          <span className="mt-1 block font-extrabold text-navy-950">{selectedScheduleJustification?.absenceReason ?? "Sem justificativa"}</span>
                        </div>
                        <div className="rounded-lg border border-border bg-white p-3">
                          <span className="block text-xs font-bold uppercase tracking-wide text-muted">Classificação</span>
                          <span className="mt-1 block font-extrabold text-navy-950">{selectedScheduleJustification?.reasonClassificationLabel ?? (selectedScheduleJustification?.reasonClassification === "JUSTIFIED" ? "Justificado" : selectedScheduleJustification?.reasonClassification === "UNJUSTIFIED" ? "Injustificado" : "Pendente")}</span>
                        </div>
                        <div className="rounded-lg border border-border bg-white p-3">
                          <span className="block text-xs font-bold uppercase tracking-wide text-muted">Categoria</span>
                          <span className="mt-1 block font-extrabold text-navy-950">{selectedScheduleJustification?.reasonCategory ?? "Não informada"}</span>
                        </div>
                        <div className="rounded-lg border border-border bg-white p-3 md:col-span-2">
                          <span className="block text-xs font-bold uppercase tracking-wide text-muted">Observação/descrição</span>
                          <span className="mt-1 block whitespace-pre-wrap text-sm font-semibold text-navy-950">{selectedScheduleJustification?.supervisorJustification ?? "Justificativa pendente."}</span>
                        </div>
                        <div className="rounded-lg border border-border bg-white p-3">
                          <span className="block text-xs font-bold uppercase tracking-wide text-muted">Justificado por</span>
                          <span className="mt-1 block font-extrabold text-navy-950">{selectedScheduleJustification?.justifiedBy ?? selectedScheduleJustification?.registeredBy ?? "Ainda não justificado"}</span>
                        </div>
                        <div className="rounded-lg border border-border bg-white p-3">
                          <span className="block text-xs font-bold uppercase tracking-wide text-muted">Data/hora</span>
                          <span className="mt-1 block font-extrabold text-navy-950">{selectedScheduleJustification?.justifiedAt ?? selectedScheduleJustification?.registeredAt ?? "-"}</span>
                        </div>
                        <div className="rounded-lg border border-border bg-white p-3 md:col-span-2">
                          <span className="block text-xs font-bold uppercase tracking-wide text-muted">Última atualização</span>
                          <span className="mt-1 block font-extrabold text-navy-950">{selectedScheduleJustification?.updatedAt ?? "-"}</span>
                        </div>
                      </div>
                      {selectedScheduleJustification?.history?.length ? (
                        <div className="rounded-lg border border-border bg-white p-3">
                          <span className="block text-xs font-bold uppercase tracking-wide text-muted">Histórico</span>
                          <div className="mt-2 space-y-2">
                            {selectedScheduleJustification.history.slice(0, 5).map((item, index) => (
                              <div key={`${item.createdAt}-${index}`} className="rounded-md bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
                                <span className="font-extrabold text-navy-950">{item.createdAt ?? "-"}</span> • {item.changedBy ?? "Sistema"} • {item.previousReason ?? "Sem motivo"} → {item.newReason ?? "Sem motivo"}
                                {item.comment ? <span className="block text-muted">{item.comment}</span> : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {canEditSlotJustification ? (
                        <div className="rounded-xl border border-blue-100 bg-white p-4">
                          <div className="mb-3">
                            <h5 className="text-sm font-extrabold text-navy-950">Editar justificativa</h5>
                            <p className="text-xs font-semibold text-muted">Supervisor revisa ocorrências do time; WFM/Admin pode corrigir motivo, categoria e observação.</p>
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <FormSelect label="Motivo da justificativa" value={justificationDraft.absenceReason} options={["", ...absenceReasonOptions]} emptyLabel="Selecione um motivo" onChange={(value) => setJustificationDraft({ ...justificationDraft, absenceReason: value })} />
                            <FormSelect label="Categoria" value={justificationDraft.reasonCategory} options={["Cronograma", "Operacional", "Saúde", "Infraestrutura", "Equipamentos", "Internet", "Outros"]} onChange={(value) => setJustificationDraft({ ...justificationDraft, reasonCategory: value })} />
                            <label className="md:col-span-2">
                              <span className="mb-1.5 block text-sm font-bold text-muted">Observação</span>
                              <textarea value={justificationDraft.supervisorJustification} onChange={(event) => setJustificationDraft({ ...justificationDraft, supervisorJustification: event.target.value })} className="min-h-24 w-full rounded-lg border border-border bg-white p-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" placeholder="Descreva o motivo informado pelo Supervisor/WFM" />
                            </label>
                          </div>
                          <button disabled={savingJustification} onClick={saveSlotJustification} className="mt-4 w-full rounded-lg bg-navy-950 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
                            {savingJustification ? "Salvando justificativa..." : "Salvar justificativa"}
                          </button>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600">
                          Seu perfil pode visualizar a justificativa, mas não alterá-la neste slot.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600">
                      Este status não exige justificativa.
                    </div>
                  )}
                </div>
                {canManageSchedules ? (
                  <>
                    <button disabled={savingSchedule || selectedScheduleStatusIsWorkflowLocked} onClick={saveScheduleEdit} className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
                      {selectedScheduleStatusIsWorkflowLocked ? "Status controlado pela Esteira" : savingSchedule ? "Salvando..." : "Salvar edição do cronograma"}
                    </button>
                    <button disabled={savingSchedule} onClick={() => removeSelectedEmployeeSchedule("month")} className="mt-3 w-full rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 disabled:opacity-60">
                      Remover cronograma do parceiro neste mês
                    </button>
                  </>
                ) : null}
              </section>

              <section className="rounded-xl border border-border p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-extrabold text-navy-950">Horas</h3>
                    <p className="text-xs text-muted">Realizado oficial conectado ao módulo Horas Operacionais.</p>
                  </div>
                  <StatusBadge status={workHourForm.recordId ? workHourForm.status : selectedCellHasSchedule ? "Sem horas" : "Sem cronograma"} />
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <MetricPill value={plannedHoursForManualPreview ? formatWorkHourValue(plannedHoursForManualPreview) : "-"} label="Planejado produtivo" />
                  <MetricPill value={hasManualActualHoursPreview ? formatWorkHourValue(manualActualHoursPreview, "0:00") : "-"} label="Realizado produtivo" />
                  <MetricPill value={hasManualActualHoursPreview || workHourForm.differenceMinutes ? formatHourDifference(manualDifferencePreview) : "-"} label="Diferença" />
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <FormInput disabled label="Entrada prevista" value={workHourForm.plannedStart} onChange={() => undefined} />
                  <FormInput disabled label="Saída prevista" value={workHourForm.plannedEnd} onChange={() => undefined} />
                  {selectedScheduleAllowsWorkHours ? (
                    <FormInput disabled={!canEditSelectedWorkHours} label="Horas realizadas" value={workHourForm.actualHours} onChange={(value) => setWorkHourForm({ ...workHourForm, actualHours: value })} />
                  ) : (
                    <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-800">
                      Este status de cronograma não permite lançamento de horas realizadas.
                    </div>
                  )}
                </div>
                <div className={cn("mt-4 rounded-lg border px-4 py-3 text-sm font-semibold", manualStatusPreview === "OK" ? "border-emerald-100 bg-emerald-50 text-emerald-700" : manualStatusPreview === "Divergente" ? "border-orange-100 bg-orange-50 text-orange-700" : "border-blue-100 bg-blue-50 text-blue-700")}>
                  {!selectedScheduleAllowsWorkHours
                    ? selectedScheduleWorkHoursBlockReason
                    : plannedHoursForManualPreview
                    ? `Status previsto após salvar: ${manualStatusPreview}. Base produtiva: ${formatWorkHourValue(DEFAULT_PRODUCTIVE_HOURS)}.`
                    : selectedCellHasSchedule
                      ? "Horas ainda não lançadas para este dia."
                      : "Sem cronograma vinculado para este dia."}
                  {workHourForm.adjustmentStatus && workHourForm.adjustmentStatus !== "Sem ajuste" ? ` Ajuste: ${workHourForm.adjustmentStatus}.` : ""}
                </div>
                {canEditOfficialWorkHours ? (
                  <button disabled={savingWorkHour || deletingWorkHour || !selectedScheduleAllowsWorkHours} onClick={() => saveManualWorkHours()} className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
                    {savingWorkHour ? "Salvando horas..." : workHourForm.recordId ? "Salvar correção de horas" : "Lançar horas"}
                  </button>
                ) : (
                  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
                    Supervisor não altera horas oficiais. Use a solicitação de ajuste abaixo.
                  </div>
                )}
                {canEditOfficialWorkHours && workHourForm.recordId ? (
                  <button disabled={savingWorkHour || deletingWorkHour} onClick={deleteSelectedWorkHours} className="mt-3 w-full rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 disabled:opacity-60">
                    {deletingWorkHour ? "Excluindo horas..." : "Excluir horas deste dia"}
                  </button>
                ) : null}

                {isScheduleSupervisor ? (
                  <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <div className="mb-3">
                      <h4 className="text-sm font-extrabold text-amber-900">Solicitar ajuste de horas</h4>
                      <p className="text-xs font-semibold text-amber-800">A solicitação vai para WFM/Admin e só vira hora oficial após aprovação.</p>
                    </div>
                    {workHourForm.recordId && selectedScheduleAllowsWorkHours ? (
                      <div className="grid gap-4 md:grid-cols-2">
                        <InfoLine label="Hora realizada atual" value={formatWorkHourValue(workHourForm.effectiveHours || 0, "0:00")} />
                        <InfoLine label="Divergência atual" value={formatHourDifference(workHourForm.differenceMinutes || 0)} />
                        <InfoLine label="Diferença do ajuste" value={scheduleAdjustmentDifferenceMinutes === null ? "-" : formatHourDifference(scheduleAdjustmentDifferenceMinutes)} />
                        <FormInput label="Nova hora solicitada" value={workHourAdjustmentForm.requestedActualHours} onChange={(value) => setWorkHourAdjustmentForm({ ...workHourAdjustmentForm, requestedActualHours: value })} />
                        <div>
                          <FormSelect label="Motivo" value={workHourAdjustmentForm.reason} options={["Erro de apontamento", "Sistema não capturou horário", "Feedback/treinamento durante o turno", "Problema técnico", "Ajuste manual autorizado", "Erro no upload", "Atividade operacional fora do sistema", "Outro"]} onChange={(value) => setWorkHourAdjustmentForm({ ...workHourAdjustmentForm, reason: value })} />
                        </div>
                        <label className="md:col-span-2">
                          <span className="mb-1.5 block text-sm font-bold text-muted">Justificativa</span>
                          <textarea value={workHourAdjustmentForm.justification} onChange={(event) => setWorkHourAdjustmentForm({ ...workHourAdjustmentForm, justification: event.target.value })} className="min-h-24 w-full rounded-lg border border-border bg-white p-3 outline-none" />
                        </label>
                        <button disabled={savingWorkHourAdjustment} onClick={requestScheduleWorkHourAdjustment} className="md:col-span-2 rounded-lg bg-amber-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
                          {savingWorkHourAdjustment ? "Enviando..." : "Solicitar ajuste para WFM/Admin"}
                        </button>
                      </div>
                    ) : !selectedScheduleAllowsWorkHours ? (
                      <p className="text-sm font-semibold text-amber-800">Este status não permite ajuste de horas realizadas.</p>
                    ) : (
                      <p className="text-sm font-semibold text-amber-800">Ainda não existe registro de horas para este dia. WFM/Admin precisa lançar ou importar as horas antes da solicitação de ajuste.</p>
                    )}
                  </div>
                ) : null}
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {showAttendance ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-2xl p-5">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">{isScheduleSupervisor ? "Justificar ocorrência" : "Marcar presença/ocorrência"}</h2>
                <p className="text-sm text-muted">
                  {isScheduleSupervisor ? "Registra a justificativa da ocorrência sem alterar o fluxo operacional." : "Atualiza o status do cronograma e registra auditoria."}
                </p>
              </div>
              <button onClick={closeAttendanceModal} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {selectedAttendancePending ? (
                <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
                  <span className="mb-1.5 block text-sm font-bold text-muted">Parceiro</span>
                  <p className="text-sm font-extrabold text-navy-950">{selectedAttendancePending.employeeName}</p>
                  <p className="mt-1 text-xs font-semibold text-blue-700">
                    WB/Login: {selectedAttendancePending.wbLogin || "Não informado"} • Supervisor: {selectedAttendancePending.supervisor || "Sem supervisor"}
                  </p>
                </div>
              ) : (
                <label className="block">
                  <span className="mb-1.5 block text-sm font-bold text-muted">Parceiro</span>
                  <select value={attendanceForm.employeeId} onChange={(event) => setAttendanceForm({ ...attendanceForm, employeeId: event.target.value })} className="h-11 w-full rounded-lg border border-border px-3 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100">
                    {employeeOptions.map((employee) => <option key={employee.id} value={employee.id}>{employeeOptionLabel(employee)}</option>)}
                  </select>
                </label>
              )}
              <FormInput disabled={Boolean(selectedAttendancePending)} label="Data" type="date" value={attendanceForm.date} onChange={(value) => setAttendanceForm({ ...attendanceForm, date: value })} />
              <FormSelect disabled={Boolean(selectedAttendancePending)} label="Turno" value={attendanceForm.shift} options={availableShiftNames} onChange={(value) => setAttendanceForm({ ...attendanceForm, shift: value })} />
              <FormSelect
                label="Status do cronograma"
                value={attendanceForm.status}
                disabled={Boolean(selectedAttendancePending)}
                options={attendanceStatusOptions}
                onChange={(value) => {
                  const reasonRequired = statusNeedsReason(value);
                  setAttendanceForm({
                    ...attendanceForm,
                    status: value,
                    absenceReason: reasonRequired ? attendanceForm.absenceReason : "",
                    supervisorJustification: reasonRequired ? attendanceForm.supervisorJustification : "",
                    impactsAbs: value === "Falta",
                    impactsCoverage: value === "Falta" || value === "Sem cronograma"
                  });
                }}
              />
              <FormSelect label={attendanceRequiresReason ? "Motivo obrigatório" : "Motivo (opcional)"} value={attendanceForm.absenceReason} options={["", ...absenceReasonOptions]} emptyLabel="Selecione um motivo" onChange={(value) => setAttendanceForm({ ...attendanceForm, absenceReason: value })} />
              <FormSelect label="Categoria" value={attendanceForm.reasonCategory} options={["Pessoas", "Sistema", "Ferramenta", "Equipamento", "Cronograma", "Treinamento", "Outros"]} onChange={(value) => setAttendanceForm({ ...attendanceForm, reasonCategory: value })} />
              <label className="md:col-span-2">
                <span className="mb-1.5 block text-sm font-bold text-muted">{attendanceRequiresReason ? "Justificativa do supervisor obrigatória se não houver motivo" : "Justificativa do supervisor (opcional)"}</span>
                <textarea value={attendanceForm.supervisorJustification} onChange={(event) => setAttendanceForm({ ...attendanceForm, supervisorJustification: event.target.value })} className="min-h-24 w-full rounded-lg border border-border p-3 outline-none" />
              </label>
            </div>
            <div className="mt-5 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
              {isScheduleSupervisor ? "Supervisor não pode marcar Presente nem alterar o cronograma planejado. A validação/correção final fica com WFM/Admin." : attendanceRequiresReason ? "Este status exige motivo ou observação antes de salvar." : "Este status não exige motivo obrigatório."}
            </div>
            <button disabled={savingJustification} onClick={saveAttendance} className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
              {savingJustification ? "Salvando justificativa..." : "Salvar registro"}
            </button>
          </div>
        </div>
      ) : null}

      {showPreview ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Preview da importação</h2>
                <p className="text-sm text-muted">{previewResult?.totalRows ?? previewRows.length} linhas carregadas para validação visual.</p>
              </div>
              <button onClick={() => setShowPreview(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="max-h-[56vh] min-h-[260px] overflow-auto rounded-lg border border-border">
                <table className="w-full min-w-[820px] text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-50 font-bold text-muted">
                    <tr>
                      <th className="px-3 py-2">Linha</th>
                      {[...scheduleImportColumns, "validacao"].map((column) => (
                        <th key={column} className="px-3 py-2">{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {((previewRows.length ? previewRows : templateRows) as Array<Record<string, unknown>>).slice(0, IMPORT_PREVIEW_ROW_LIMIT).map((row, index) => {
                      const rowValidation = previewResult?.validation?.[index];
                      return (
                        <tr key={index}>
                          <td className="px-3 py-2 font-bold">{rowValidation?.rowNumber ?? index + 1}</td>
                          {scheduleImportColumns.map((column) => (
                            <td key={column} className="px-3 py-2">{String(row[column] ?? "")}</td>
                          ))}
                          <td className={cn("px-3 py-2 font-semibold", rowValidation?.errors.length ? "text-red-600" : rowValidation?.warnings.length ? "text-amber-600" : "text-muted")}>
                            {rowValidation
                              ? [...rowValidation.errors, ...rowValidation.warnings].join(" | ") || rowValidation.action || "OK"
                              : "OK"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="max-h-[56vh] min-h-0 space-y-3 overflow-y-auto pr-1">
                <StatusBadge status={validation.errors ? `${validation.errors} erros` : "Sem erros críticos"} />
                <StatusBadge status={`${validation.warnings} alertas`} />
                <MetricPill value={previewResult?.createdRows ?? 0} label="Novos cronogramas" />
                <MetricPill value={previewResult?.updatedRows ?? 0} label="Atualizações" />
                <MetricPill value={previewResult?.missingEmployees ?? 0} label="WB/Login não encontrados" />
                <p className="text-sm text-muted">Validações: WB/Login existente, data, status válido, turno, entrada, saída, LOB e conflito por pessoa/dia.</p>
                {previewResult?.validation ? (
                  <ImportIssueSummary rows={previewResult.validation} title="Corrija estas linhas do cronograma" />
                ) : null}
                {(previewRows.length > IMPORT_PREVIEW_ROW_LIMIT || (previewResult?.validation.length ?? 0) > IMPORT_PREVIEW_ROW_LIMIT) ? <p className="text-xs font-semibold text-muted">Exibindo as primeiras {IMPORT_PREVIEW_ROW_LIMIT} linhas do preview. O arquivo completo será processado na confirmação.</p> : null}
              </div>
            </div>
            <div className="shrink-0 flex flex-wrap justify-end gap-3 border-t border-border bg-white px-5 py-3">
              <button onClick={() => setShowPreview(false)} className="rounded-lg border border-border px-4 py-3 text-sm font-bold">Cancelar</button>
              <button
                onClick={commitImport}
                className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white"
              >
                Confirmar importação
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}


const templateRows = [
  {
    wb_login: "WB1001",
    data: currentOperationalDateInput(),
    status: "Escalado",
    turno: "Manhã",
    entrada: approvedShiftBaseTimes.Manhã.startsAt,
    saida: approvedShiftBaseTimes.Manhã.endsAt,
    lob: "CEC"
  }
];


function validateImportRows(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return { errors: 0, warnings: 0 };
  const required = ["wb_login", "data", "status", "turno", "entrada", "saida", "lob"];
  const errors = rows.reduce((acc, row) => acc + required.filter((field) => !row[field]).length, 0);
  const warnings = rows.filter((row) => row.lob && !["CEC", "TNS", "ADS"].includes(String(row.lob))).length;
  return { errors, warnings };
}


function withCurrentScheduleStatus(options: string[], current: string) {
  return current && !options.includes(current) ? [current, ...options] : options;
}
