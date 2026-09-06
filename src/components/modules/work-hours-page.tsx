"use client";

import { createClientRequestGate } from "@/lib/client-request-gate";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { AlertTriangle, CheckCircle2, Clock, ClipboardList, Download, FileText, RefreshCw, Upload } from "lucide-react";
import { CaptureShiftDateDialog } from "@/components/capture-shift-date-dialog";
import { type CapturePeriod } from "@/lib/work-hours-capture-period";
import { captureImportNeedsReview, processCaptureImportDays, type CaptureDayResult } from "@/lib/work-hours-capture-batch";
import type { CaptureRegistrationWarning } from "@/lib/work-hours-capture-review";
import { adherenceFilterQuery, filterWorkHourAdherenceRows, groupWorkHourAdherenceByDay, initialAdherenceFilters, type WorkHourAdherenceFilters } from "@/lib/work-hour-adherence-filters";
import { EmptyState, MetricPill, PageHeader, StatCard, StatusBadge } from "@/components/ui/primitives";
import { canApproveWorkHourAdjustment, canEditWorkHours, canImportWorkHours, canJustifyAbsence, canRequestWorkHourAdjustment, canViewWorkHours, normalizeRole } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { cleanShiftName, cleanShiftOptions, shiftCategoryName } from "@/lib/shift-display";
import { DEFAULT_PRODUCTIVE_HOURS, type WorkHourBalanceStatus, workHourBalanceStatus } from "@/lib/work-hours-rules";
import { FormInput, FormSelect, IMPORT_PREVIEW_ISSUE_LIMIT, IMPORT_PREVIEW_ROW_LIMIT, ImportIssueSummary, InfoLine, SystemSettings, WorkHourRow, WorkHourSummary, apiJson, currentOperationalMonthRange, downloadFile, formatHourDifference, formatWorkHourSummaryDifference, formatWorkHourValue, initialDateRangeFromUrl, parseProductiveHoursInput, queryParam, requestedHoursInputErrorMessage } from './shared';
type WorkHourPreview = {
  message?: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  rows: Array<Record<string, unknown>>;
  warningRows: number;
  createdRows: number;
  updatedRows: number;
  foundEmployees: number;
  missingEmployees: number;
  uniqueWbLogins?: number;
  foundUniqueWbLogins?: number;
  missingWbLogins?: string[];
  scheduleFoundRows: number;
  noScheduleRows: number;
  validation: Array<{ rowNumber: number; wbLogin: string; originalWbLogin?: string; normalizedWbLogin?: string; employeeName: string; employeeStatus?: string; date: string; hasSchedule?: boolean; allowsWorkHours?: boolean; scheduleStatus?: string; actualHours?: number; actualHoursLabel?: string; plannedHours?: number | null; plannedHoursLabel?: string; differenceMinutes?: number | null; differenceLabel?: string; errors: string[]; warnings: string[]; action: string; status: string }>;
};


type CaptureWorkHourImportPreview = {
  period: { startDate: string; endDate: string };
  registrationWarnings: CaptureRegistrationWarning[];
  summary: { automatic: number; divergences: number; ignored: number };
  overlap: {
    count: number;
    dates: string[];
    agents: Array<{ id: string; name: string; wbLogin: string }>;
    currentHours: number;
    proposedHours: number;
  };
};


type WorkHourAdherenceRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  wbLogin: string;
  date: string;
  lob: string;
  classification: string;
  supervisor: string;
  supervisorId: string;
  shift: string;
  plannedSlot: string;
  capturedDuration: string;
  durationSource: string;
  status: string;
  justification: string;
  answeredBy: string;
  answeredAt: string;
};


function WorkHourBalanceBadge({
  plannedHours,
  differenceMinutes
}: {
  plannedHours: number;
  differenceMinutes: number;
}) {
  const status = workHourBalanceStatus(plannedHours, differenceMinutes);
  const styles: Record<WorkHourBalanceStatus, string> = {
    "Hora extra": "border-violet-200 bg-violet-50 text-violet-700",
    OK: "border-emerald-200 bg-emerald-50 text-emerald-700",
    "Horas pendentes": "border-amber-200 bg-amber-50 text-amber-700",
    "Sem cronograma": "border-slate-200 bg-slate-100 text-slate-600"
  };

  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-extrabold leading-tight", styles[status])}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-75" />
      {status}
    </span>
  );
}


export function WorkHoursPage() {
  const { data: session } = useSession();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [rows, setRows] = useState<WorkHourRow[]>([]);
  const [summary, setSummary] = useState<WorkHourSummary | null>(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });
  const [hoursRequests] = useState(createClientRequestGate);
  const [filters, setFilters] = useState(() => ({
    ...initialDateRangeFromUrl(),
    employeeId: queryParam("employeeId"),
    lob: queryParam("lob") || "Todos",
    supervisor: queryParam("supervisor"),
    shift: queryParam("shift") || "Todos",
    collaborator: queryParam("collaborator"),
    employeeStatus: queryParam("employeeStatus") || "Todos",
    status: queryParam("status") || "Todos",
    overtimeOnly: queryParam("overtimeOnly") === "true",
    hoursPendingOnly: queryParam("hoursPendingOnly") === "true",
    pendingOnly: queryParam("pendingOnly") === "true",
    noScheduleOnly: queryParam("noScheduleOnly") === "true"
  }));
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<(WorkHourPreview & { fileName: string }) | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [savingImport, setSavingImport] = useState(false);
  const [captureImportPreview, setCaptureImportPreview] = useState<CaptureWorkHourImportPreview | null>(null);
  const [captureDateDialogOpen, setCaptureDateDialogOpen] = useState(false);
  const [capturePeriod, setCapturePeriod] = useState<CapturePeriod | null>(null);
  const [captureProgress, setCaptureProgress] = useState("");
  const captureImportScope = useRef<{ payload: ReturnType<typeof captureImportPayload>; query: string } | null>(null);
  const [importingCapture, setImportingCapture] = useState(false);
  const [adherenceRows, setAdherenceRows] = useState<WorkHourAdherenceRow[]>([]);
  const [activeHoursSlice, setActiveHoursSlice] = useState<"hours" | "justifications">("hours");
  const [adherenceFilters, setAdherenceFilters] = useState(() => initialAdherenceFilters(currentOperationalMonthRange()));
  const [appliedAdherenceFilters, setAppliedAdherenceFilters] = useState(adherenceFilters);
  const [adherenceSelectionLabels, setAdherenceSelectionLabels] = useState({ supervisor: "Todos", partner: "Todos" });
  const [loadingAdherence, setLoadingAdherence] = useState(false);
  const [adherenceError, setAdherenceError] = useState("");
  const adherenceRequestId = useRef(0);
  const [adherenceDrafts, setAdherenceDrafts] = useState<Record<string, string>>({});
  const [savingAdherenceId, setSavingAdherenceId] = useState("");
  const [exportingAdherence, setExportingAdherence] = useState(false);
  const [downloadingWorkHourTemplate, setDownloadingWorkHourTemplate] = useState(false);
  const [selectedRow, setSelectedRow] = useState<WorkHourRow | null>(null);
  const [showAdjustment, setShowAdjustment] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [adjustmentAction, setAdjustmentAction] = useState<"approve" | "reject">("approve");
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [deletingWorkHourId, setDeletingWorkHourId] = useState("");
  const [adjustmentForm, setAdjustmentForm] = useState({
    requestedActualHours: "",
    reason: "Erro de apontamento",
    justification: "",
    rejectionReason: ""
  });

  const actorRole = session?.user?.role ?? "COLABORADOR";
  const normalizedRole = normalizeRole(actorRole);
  const permissionUser = { role: actorRole };
  const canUpload = canImportWorkHours(permissionUser);
  const canApprove = canApproveWorkHourAdjustment(permissionUser);
  const canDeleteWorkHours = canEditWorkHours(permissionUser);
  const canRequestAdjustment = canRequestWorkHourAdjustment(permissionUser);
  const canViewAdherence = canJustifyAbsence(permissionUser);
  const visibleAdherenceRows = useMemo(() => filterWorkHourAdherenceRows(adherenceRows, appliedAdherenceFilters), [adherenceRows, appliedAdherenceFilters]);
  const adherenceDays = useMemo(() => groupWorkHourAdherenceByDay(visibleAdherenceRows), [visibleAdherenceRows]);
  const adherenceOptions = useMemo(() => {
    const supervisors = new Map(adherenceRows.map((row) => [row.supervisorId, row.supervisor]));
    const partners = new Map(adherenceRows.map((row) => [row.employeeId, `${row.employeeName} · ${row.wbLogin}`]));
    const byLabel = (a: [string, string], b: [string, string]) => a[1].localeCompare(b[1], "pt-BR");
    return {
      lobs: ["Todos", ...Array.from(new Set(adherenceRows.map((row) => row.lob).filter(Boolean))).sort()],
      shifts: ["Todos", ...Array.from(new Set(adherenceRows.map((row) => row.shift).filter(Boolean))).sort()],
      supervisors: new Map(Array.from(supervisors).sort(byLabel)),
      partners: new Map(Array.from(partners).sort(byLabel))
    };
  }, [adherenceRows]);
  const employeeWorkHourStatusOptions = ["Todos", "Ativos", "Desligados/Inativos"];
  const statusOptions = ["Todos", "Hora extra", "OK", "Horas pendentes", "Sem cronograma"];
  const lobOptions = ["Todos", ...(settings?.lobs.filter((lob) => lob.status !== "INACTIVE").map((lob) => lob.name) ?? Array.from(new Set(rows.map((row) => row.lob).filter(Boolean))))];
  const workHourShiftCategories = settings?.shifts.filter((shift) => shift.status !== "INACTIVE").map((shift) => shiftCategoryName(shift.name)) ?? rows.map((row) => shiftCategoryName(row.shift));
  const shiftOptions = ["Todos", "Sem turno", ...cleanShiftOptions(workHourShiftCategories, true)];
  const adjustmentRequestedHoursPreview = parseProductiveHoursInput(adjustmentForm.requestedActualHours);
  const selectedAdjustmentDifferenceMinutes = selectedRow && adjustmentRequestedHoursPreview !== null
    ? Math.round((adjustmentRequestedHoursPreview - selectedRow.effectiveHours) * 60)
    : null;

  useEffect(() => {
    apiJson<{ data: SystemSettings }>("/api/settings").then((payload) => setSettings(payload.data)).catch(() => undefined);
    void loadWorkHours();
    return () => hoursRequests.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (canViewAdherence) void loadAdherence();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewAdherence]);

  async function loadWorkHours(nextPage = pagination.page, appliedFilters = filters) {
    const request = hoursRequests.begin();
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({
        startDate: appliedFilters.startDate,
        endDate: appliedFilters.endDate,
        page: String(nextPage),
        limit: String(pagination.limit)
      });
      if (appliedFilters.lob !== "Todos") params.set("lob", appliedFilters.lob);
      if (appliedFilters.employeeId) params.set("employeeId", appliedFilters.employeeId);
      if (appliedFilters.supervisor) params.set("supervisor", appliedFilters.supervisor);
      if (appliedFilters.shift !== "Todos") params.set("shift", appliedFilters.shift);
      if (appliedFilters.collaborator) params.set("collaborator", appliedFilters.collaborator);
      if (appliedFilters.employeeStatus !== "Todos") params.set("employeeStatus", appliedFilters.employeeStatus);
      if (appliedFilters.status !== "Todos") params.set("status", appliedFilters.status);
      if (appliedFilters.overtimeOnly) params.set("overtimeOnly", "true");
      if (appliedFilters.hoursPendingOnly) params.set("hoursPendingOnly", "true");
      if (appliedFilters.pendingOnly) params.set("pendingOnly", "true");
      if (appliedFilters.noScheduleOnly) params.set("noScheduleOnly", "true");
      const payload = await apiJson<{ data: WorkHourRow[]; summary: WorkHourSummary; pagination: typeof pagination }>(`/api/work-hours?${params.toString()}`, { signal: request.signal });
      if (!hoursRequests.isCurrent(request)) return;
      setRows(payload.data);
      setSummary(payload.summary);
      setPagination(payload.pagination);
    } catch (error) {
      if (!hoursRequests.isCurrent(request)) return;
      setRows([]);
      setSummary(null);
      setMessage(error instanceof Error ? error.message : "Não foi possível carregar horas operacionais.");
    } finally {
      if (hoursRequests.isCurrent(request)) setLoading(false);
    }
  }

  function captureImportPayload(period: CapturePeriod) {
    return {
      ...period,
      employeeId: filters.employeeId || undefined,
      lob: filters.lob,
      supervisor: filters.supervisor || undefined,
      shift: filters.shift,
      collaborator: filters.collaborator || undefined,
      employeeStatus: filters.employeeStatus
    };
  }

  function preservedWorkHourQuery() {
    const params = new URLSearchParams({ startDate: filters.startDate, endDate: filters.endDate });
    if (filters.employeeId) params.set("employeeId", filters.employeeId);
    if (filters.lob !== "Todos") params.set("lob", filters.lob);
    if (filters.supervisor) params.set("supervisor", filters.supervisor);
    if (filters.shift !== "Todos") params.set("shift", filters.shift);
    if (filters.collaborator) params.set("collaborator", filters.collaborator);
    if (filters.employeeStatus !== "Todos") params.set("employeeStatus", filters.employeeStatus);
    if (filters.status !== "Todos") params.set("status", filters.status);
    for (const key of ["overtimeOnly", "hoursPendingOnly", "pendingOnly", "noScheduleOnly"] as const) {
      if (filters[key]) params.set(key, "true");
    }
    return params.toString();
  }

  function captureReviewQuery(period: CapturePeriod) {
    return new URLSearchParams({ ...period, returnQuery: preservedWorkHourQuery() }).toString();
  }

  async function importFromCapture(period: CapturePeriod) {
    setCapturePeriod(period);
    setCaptureProgress("Consultando período...");
    setImportingCapture(true);
    setCaptureImportPreview(null);
    setMessage("");
    // Confirmation must refer to the scope shown in the preview, even if filters change.
    const scope = { payload: captureImportPayload(period), query: captureReviewQuery(period) };
    captureImportScope.current = scope;
    try {
      const previewPayload = await apiJson<{ data: CaptureWorkHourImportPreview }>("/api/work-hours/capture-import/preview", {
        method: "POST",
        body: JSON.stringify(scope.payload)
      });
      if (previewPayload.data.overlap.count > 0) {
        setCaptureImportPreview(previewPayload.data);
        return;
      }
      await commitCaptureImport(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível importar a Captura de Horas.");
    } finally {
      setImportingCapture(false);
      setCaptureProgress("");
    }
  }

  async function commitCaptureImport(confirmReprocessing: boolean) {
    const scope = captureImportScope.current;
    if (!scope) return;
    setImportingCapture(true);
    setMessage("");
    try {
      const result = await processCaptureImportDays(scope.payload, async (date) => {
        const payload = await apiJson<{ data: CaptureDayResult }>("/api/work-hours/capture-import/commit", {
          method: "POST",
          body: JSON.stringify({ ...scope.payload, startDate: date, endDate: date, confirmReprocessing })
        });
        return payload.data;
      }, (date, index, total) => setCaptureProgress(`Importando ${date} · ${index}/${total} dia(s)`));
      setCaptureImportPreview(null);
      if (captureImportNeedsReview(result)) {
        window.location.assign(`/horas-operacionais/divergencias?${scope.query}`);
        return;
      }
      await Promise.all([loadWorkHours(1), canViewAdherence ? loadAdherence() : Promise.resolve()]);
      setMessage(`${result.completedDates.length} dia(s) concluído(s). ${result.imported} registro(s) atualizado(s) pela Captura de Horas. ${result.unchanged} já estavam corretos.`);
    } catch (error) {
      // A new attempt must regenerate the preview, including completed days.
      setCaptureImportPreview(null);
      captureImportScope.current = null;
      await Promise.all([loadWorkHours(1), canViewAdherence ? loadAdherence() : Promise.resolve()]);
      setMessage(error instanceof Error ? error.message : "Não foi possível processar a Captura de Horas.");
    } finally {
      setImportingCapture(false);
      setCaptureProgress("");
    }
  }

  async function exportAdherence() {
    if (!canViewAdherence || exportingAdherence || loadingAdherence || adherenceError) return;
    setExportingAdherence(true);
    try {
      await downloadFile(`/api/work-hours/adherence/export?${adherenceFilterQuery(appliedAdherenceFilters)}`, `justificativas_aderencia_${appliedAdherenceFilters.startDate}_${appliedAdherenceFilters.endDate}.xlsx`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível exportar as justificativas.");
    } finally {
      setExportingAdherence(false);
    }
  }

  async function loadAdherence(nextFilters: WorkHourAdherenceFilters = appliedAdherenceFilters) {
    if (!canViewAdherence) return;
    const requestId = ++adherenceRequestId.current;
    if (!nextFilters.startDate || !nextFilters.endDate || nextFilters.startDate > nextFilters.endDate) {
      setAdherenceError("Informe um período válido: a data inicial deve ser anterior ou igual à data final.");
      setLoadingAdherence(false);
      return;
    }
    setLoadingAdherence(true);
    setAdherenceError("");
    try {
      // Load the authorized period once; keep dropdown options independent of the selected dimensions.
      const query = adherenceFilterQuery({ startDate: nextFilters.startDate, endDate: nextFilters.endDate });
      const payload = await apiJson<{ data: WorkHourAdherenceRow[] }>(`/api/work-hours/adherence?${query}`);
      if (requestId !== adherenceRequestId.current) return;
      setAdherenceRows(payload.data);
      setAppliedAdherenceFilters({ ...nextFilters });
      setAdherenceDrafts((current) => ({ ...current, ...Object.fromEntries(payload.data.map((row) => [row.id, current[row.id] ?? row.justification])) }));
    } catch (error) {
      if (requestId !== adherenceRequestId.current) return;
      setAdherenceRows([]);
      setAdherenceError(error instanceof Error ? error.message : "Não foi possível carregar as justificativas.");
    } finally {
      if (requestId === adherenceRequestId.current) setLoadingAdherence(false);
    }
  }

  async function submitAdherenceJustification(row: WorkHourAdherenceRow) {
    const justification = (adherenceDrafts[row.id] ?? "").trim();
    if (justification.length < 5) {
      setMessage("Informe uma justificativa de aderência com pelo menos 5 caracteres.");
      return;
    }
    setSavingAdherenceId(row.id);
    setMessage("");
    try {
      await apiJson("/api/work-hours/adherence", {
        method: "POST",
        body: JSON.stringify({ id: row.id, justification })
      });
      setMessage("Justificativa de aderência enviada.");
      await loadAdherence();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível enviar a justificativa.");
    } finally {
      setSavingAdherenceId("");
    }
  }

  async function handleWorkHourFile(file?: File) {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    setMessage("");
    try {
      const payload = await apiJson<WorkHourPreview & { fileName: string }>("/api/work-hours/import/preview", {
        method: "POST",
        body: formData
      });
      setPreview(payload);
      setShowPreview(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível validar o arquivo de horas.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function downloadWorkHourTemplate() {
    setDownloadingWorkHourTemplate(true);
    setMessage("");
    try {
      await downloadFile("/api/work-hours/template", "template_horas_operacionais.xlsx");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível baixar o template. Tente novamente.");
    } finally {
      setDownloadingWorkHourTemplate(false);
    }
  }

  async function commitWorkHourImport() {
    if (!preview) return;
    setSavingImport(true);
    try {
      const payload = await apiJson<{ data: { importedRows: number; createdRows: number; updatedRows: number } }>("/api/work-hours/import/commit", {
        method: "POST",
        body: JSON.stringify({ fileName: preview.fileName, allowPartial: true, rows: preview.rows })
      });
      setShowPreview(false);
      setPreview(null);
      setMessage(`${payload.data.importedRows} registro(s) importado(s). Criados: ${payload.data.createdRows}. Atualizados: ${payload.data.updatedRows}.`);
      await loadWorkHours(1);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível importar horas.");
    } finally {
      setSavingImport(false);
    }
  }

  function openAdjustment(row: WorkHourRow) {
    const isRejectedAdjustment = row.adjustmentStatus === "Recusado";
    setSelectedRow(row);
    setAdjustmentForm({
      requestedActualHours: isRejectedAdjustment && row.adjustmentRequestedHours !== null && row.adjustmentRequestedHours !== undefined
        ? formatWorkHourValue(row.adjustmentRequestedHours, "")
        : formatWorkHourValue(row.effectiveHours, ""),
      reason: isRejectedAdjustment && row.adjustmentReason ? row.adjustmentReason : "Erro de apontamento",
      justification: isRejectedAdjustment ? row.adjustmentJustification ?? "" : "",
      rejectionReason: ""
    });
    setShowAdjustment(true);
  }

  function openReview(row: WorkHourRow, action: "approve" | "reject") {
    setSelectedRow(row);
    setAdjustmentAction(action);
    setAdjustmentForm({ ...adjustmentForm, requestedActualHours: formatWorkHourValue(row.effectiveHours, adjustmentForm.requestedActualHours), rejectionReason: "" });
    setShowReview(true);
  }

  async function submitAdjustment() {
    if (!selectedRow) return;
    setSavingAdjustment(true);
    setMessage("");
    if (!adjustmentForm.requestedActualHours.trim()) {
      setSavingAdjustment(false);
      setMessage("Nova hora solicitada é obrigatória.");
      return;
    }
    const requestedActualHours = parseProductiveHoursInput(adjustmentForm.requestedActualHours);
    if (requestedActualHours === null) {
      setSavingAdjustment(false);
      setMessage(requestedHoursInputErrorMessage);
      return;
    }
    try {
      await apiJson("/api/work-hours", {
        method: "POST",
        body: JSON.stringify({
          workHourRecordId: selectedRow.id,
          requestedActualHours,
          reason: adjustmentForm.reason,
          justification: adjustmentForm.justification
        })
      });
      setShowAdjustment(false);
      setMessage("Ajuste de horas solicitado e enviado para WFM/Admin.");
      await loadWorkHours();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível solicitar ajuste.");
    } finally {
      setSavingAdjustment(false);
    }
  }

  async function reviewAdjustment() {
    if (!selectedRow?.adjustmentId) return;
    setSavingAdjustment(true);
    try {
      await apiJson("/api/work-hours/adjustments", {
        method: "PATCH",
        body: JSON.stringify({ id: selectedRow.adjustmentId, action: adjustmentAction, rejectionReason: adjustmentForm.rejectionReason })
      });
      setShowReview(false);
      setMessage(adjustmentAction === "approve" ? "Ajuste aprovado e horas efetivas atualizadas." : "Ajuste recusado.");
      await loadWorkHours();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível processar ajuste.");
    } finally {
      setSavingAdjustment(false);
    }
  }

  async function deleteWorkHour(row: WorkHourRow) {
    const confirmed = window.confirm(`Excluir as horas de ${row.employeeName} em ${row.date} e suas justificativas de aderência? O cronograma e o parceiro serão mantidos.`);
    if (!confirmed) return;

    setDeletingWorkHourId(row.id);
    setMessage("");
    try {
      await apiJson("/api/work-hours", {
        method: "DELETE",
        body: JSON.stringify({
          workHourRecordId: row.id,
          reason: "Exclusão pelo painel de Horas Operacionais"
        })
      });
      await Promise.all([
        loadWorkHours(rows.length === 1 && pagination.page > 1 ? pagination.page - 1 : pagination.page),
        canViewAdherence ? loadAdherence() : Promise.resolve()
      ]);
      setMessage("Horas e pendências de aderência vinculadas excluídas.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível excluir o registro de horas.");
    } finally {
      setDeletingWorkHourId("");
    }
  }

  function exportUrl() {
    const params = new URLSearchParams({ startDate: filters.startDate, endDate: filters.endDate });
    if (filters.lob !== "Todos") params.set("lob", filters.lob);
    if (filters.employeeId) params.set("employeeId", filters.employeeId);
    if (filters.supervisor) params.set("supervisor", filters.supervisor);
    if (filters.shift !== "Todos") params.set("shift", filters.shift);
    if (filters.collaborator) params.set("collaborator", filters.collaborator);
    if (filters.employeeStatus !== "Todos") params.set("employeeStatus", filters.employeeStatus);
    if (filters.status !== "Todos") params.set("status", filters.status);
    if (filters.overtimeOnly) params.set("overtimeOnly", "true");
    if (filters.hoursPendingOnly) params.set("hoursPendingOnly", "true");
    if (filters.pendingOnly) params.set("pendingOnly", "true");
    if (filters.noScheduleOnly) params.set("noScheduleOnly", "true");
    return `/api/work-hours/export?${params.toString()}`;
  }

  return (
    <div>
      <PageHeader
        title="Horas Operacionais"
        description={`Upload, conferência e ajuste das horas produtivas realizadas versus base planejada de ${formatWorkHourValue(DEFAULT_PRODUCTIVE_HOURS)}`}
        icon={Clock}
        actions={
          <div className="flex flex-wrap gap-2">
            {canUpload ? <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => handleWorkHourFile(event.target.files?.[0])} /> : null}
            {canUpload ? (
              <button onClick={() => fileInputRef.current?.click()} className="flex h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white shadow-soft">
                <Upload className="h-4 w-4" />
                Upload horas
              </button>
            ) : null}
            {canUpload ? (
              <button type="button" disabled={importingCapture} onClick={() => setCaptureDateDialogOpen(true)} className="flex h-11 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white shadow-soft disabled:cursor-not-allowed disabled:opacity-60">
                <RefreshCw className={cn("h-4 w-4", importingCapture && "animate-spin")} />
                {importingCapture ? captureProgress || "Consultando captura..." : "Importar da Captura de Horas"}
              </button>
            ) : null}
            {canUpload ? (
              <a href={`/horas-operacionais/divergencias?${captureReviewQuery(capturePeriod ?? { startDate: filters.startDate, endDate: filters.endDate })}`} aria-disabled={importingCapture} onClick={(event) => { if (importingCapture) event.preventDefault(); }} className="flex h-11 items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 text-sm font-bold text-amber-800 shadow-soft">
                <AlertTriangle className="h-4 w-4" />
                Tela de Divergências
              </a>
            ) : null}
            {canUpload ? (
              <button type="button" disabled={downloadingWorkHourTemplate} onClick={downloadWorkHourTemplate} className="flex h-11 items-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-bold text-navy-950 shadow-soft disabled:cursor-not-allowed disabled:opacity-60">
                <Download className="h-4 w-4" />
                {downloadingWorkHourTemplate ? "Baixando..." : "Baixar template"}
              </button>
            ) : null}
            {canViewWorkHours(permissionUser) ? (
              <a href={exportUrl()} className="flex h-11 items-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-bold text-navy-950 shadow-soft">
                <FileText className="h-4 w-4" />
                Exportar XLSX
              </a>
            ) : null}
          </div>
        }
      />

      {message ? <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{message}</div> : null}

      {importingCapture ? <p role="status" className="mb-4 text-sm font-bold text-emerald-700">{captureProgress} · Mantenha esta tela aberta até a conclusão.</p> : null}
      {canUpload ? <CaptureShiftDateDialog open={captureDateDialogOpen} onOpenChange={setCaptureDateDialogOpen} onContinue={(period) => void importFromCapture(period)} /> : null}

      {captureImportPreview?.overlap.count ? (
        <section className="card mb-5 border-amber-300 bg-amber-50 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div className="min-w-0 flex-1">
              <h2 className="font-extrabold text-amber-950">Confirmação de reprocessamento necessária</h2>
              <p className="mt-1 text-sm font-bold text-amber-900">Período: {captureImportPreview.period.startDate} até {captureImportPreview.period.endDate}. Os dias serão processados separadamente, preservando a data de cada turno.</p>
              <p className="mt-1 text-sm font-semibold text-amber-900">Já existem {captureImportPreview.overlap.count} registro(s) no escopo. A confirmação recalcula tudo a partir da duração original, substitui somente os registros afetados e nunca soma horas ou os 30 minutos novamente.</p>
              {captureImportPreview.registrationWarnings?.length ? <p className="mt-2 text-sm font-bold text-amber-950">
                Atenção: {captureImportPreview.registrationWarnings.length} bloqueio(s) de cadastro impedem a importação de outros slots. <Link target="_blank" rel="noopener noreferrer" href={`/horas-operacionais/divergencias?${captureReviewQuery(captureImportPreview.period)}`} className="underline">Ver parceiros e motivos na tela de divergências ↗</Link>
              </p> : null}
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <InfoLine label="Datas afetadas" value={captureImportPreview.overlap.dates.join(", ")} />
                <InfoLine label="Agentes afetados" value={captureImportPreview.overlap.agents.map((agent) => `${agent.name} (${agent.wbLogin})`).join(", ")} />
                <InfoLine label="Horas atuais" value={formatWorkHourValue(captureImportPreview.overlap.currentHours, "0:00")} />
                <InfoLine label="Horas propostas" value={formatWorkHourValue(captureImportPreview.overlap.proposedHours, "0:00")} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button disabled={importingCapture} onClick={() => commitCaptureImport(true)} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{importingCapture ? "Reprocessando..." : "Confirmar reprocessamento"}</button>
                <button disabled={importingCapture} onClick={() => setCaptureImportPreview(null)} className="rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-bold text-navy-950">Cancelar</button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Horas previstas" value={formatWorkHourValue(summary?.plannedHours ?? 0, "0:00")} helper={`base produtiva ${formatWorkHourValue(DEFAULT_PRODUCTIVE_HOURS)}/dia`} icon={Clock} tone="blue" />
        <StatCard title="Horas realizadas" value={formatWorkHourValue(summary?.actualHours ?? 0, "0:00")} helper="apontamento importado" icon={CheckCircle2} tone="green" />
        <StatCard title="Diferença total" value={formatWorkHourSummaryDifference(summary?.differenceHours ?? 0)} helper="realizado - previsto" icon={AlertTriangle} tone={(summary?.differenceHours ?? 0) < 0 ? "orange" : "cyan"} />
        <StatCard title="Ajustes pendentes" value={summary?.pendingAdjustments ?? 0} helper="aguardando WFM/Admin" icon={ClipboardList} tone={(summary?.pendingAdjustments ?? 0) ? "orange" : "green"} />
      </div>
      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricPill value={formatWorkHourValue(summary?.overtimeHours ?? 0, "0:00")} label="Horas extras" />
        <MetricPill value={formatWorkHourValue(summary?.pendingHours ?? 0, "0:00")} label="Horas pendentes" />
        <MetricPill value={formatWorkHourValue(summary?.adjustedHours ?? 0, "0:00")} label="Horas ajustadas" />
        <MetricPill value={summary?.noScheduleRecords ?? 0} label="Sem cronograma vinculado" />
      </div>

      <nav aria-label="Visão de Horas Operacionais" className="mb-5 flex flex-wrap gap-2">
        <button type="button" aria-pressed={activeHoursSlice === "hours"} onClick={() => setActiveHoursSlice("hours")} className={cn("inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-black transition", activeHoursSlice === "hours" ? "border-blue-600 bg-blue-600 text-white" : "border-border bg-white text-navy-950 hover:bg-blue-50")}><Clock className="h-4 w-4" />Painel de horas</button>
        {canViewAdherence ? <button type="button" aria-pressed={activeHoursSlice === "justifications"} onClick={() => setActiveHoursSlice("justifications")} className={cn("inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-black transition", activeHoursSlice === "justifications" ? "border-blue-600 bg-blue-600 text-white" : "border-border bg-white text-navy-950 hover:bg-blue-50")}><ClipboardList className="h-4 w-4" />Justificativas</button> : null}
      </nav>

      {activeHoursSlice === "hours" ? (
      <section className="card mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-9">
          <FormInput label="Data inicial" type="date" value={filters.startDate} onChange={(value) => setFilters({ ...filters, startDate: value })} />
          <FormInput label="Data final" type="date" value={filters.endDate} onChange={(value) => setFilters({ ...filters, endDate: value })} />
          <FormSelect label="LOB" value={filters.lob} options={lobOptions} onChange={(value) => setFilters({ ...filters, lob: value })} />
          <FormInput label="Supervisor" value={filters.supervisor} onChange={(value) => setFilters({ ...filters, supervisor: value })} />
          <FormSelect label="Turno" value={filters.shift} options={shiftOptions} onChange={(value) => setFilters({ ...filters, shift: value })} />
          <FormInput label="Parceiro/WB" value={filters.collaborator} onChange={(value) => setFilters({ ...filters, collaborator: value })} />
          <FormSelect label="Status parceiro" value={filters.employeeStatus} options={employeeWorkHourStatusOptions} onChange={(value) => setFilters({ ...filters, employeeStatus: value })} />
          <FormSelect label="Status" value={filters.status} options={statusOptions} onChange={(value) => setFilters({ ...filters, status: value, overtimeOnly: false, hoursPendingOnly: false, pendingOnly: false, noScheduleOnly: false })} />
          <div className="flex items-end gap-2">
            <button onClick={() => { void loadWorkHours(1); }} className="h-11 flex-1 rounded-lg bg-blue-600 px-3 text-sm font-bold text-white">Filtrar</button>
            <button onClick={() => { const resetFilters = { ...currentOperationalMonthRange(), employeeId: "", lob: "Todos", supervisor: "", shift: "Todos", collaborator: "", employeeStatus: "Todos", status: "Todos", overtimeOnly: false, hoursPendingOnly: false, pendingOnly: false, noScheduleOnly: false }; setFilters(resetFilters); void loadWorkHours(1, resetFilters); }} className="h-11 rounded-lg border border-border bg-white px-3 text-sm font-bold">Limpar</button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold text-navy-950">
          <label className="flex items-center gap-2"><input type="checkbox" checked={filters.overtimeOnly} onChange={(event) => setFilters({ ...filters, status: "Todos", overtimeOnly: event.target.checked, hoursPendingOnly: false, pendingOnly: false, noScheduleOnly: false })} /> Horas extras</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={filters.hoursPendingOnly} onChange={(event) => setFilters({ ...filters, status: "Todos", hoursPendingOnly: event.target.checked, overtimeOnly: false, pendingOnly: false, noScheduleOnly: false })} /> Horas pendentes</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={filters.pendingOnly} onChange={(event) => setFilters({ ...filters, status: "Todos", pendingOnly: event.target.checked, overtimeOnly: false, hoursPendingOnly: false, noScheduleOnly: false })} /> Ajuste pendente</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={filters.noScheduleOnly} onChange={(event) => setFilters({ ...filters, status: "Todos", noScheduleOnly: event.target.checked, overtimeOnly: false, hoursPendingOnly: false, pendingOnly: false })} /> Sem cronograma</label>
        </div>
      </section>
      ) : null}

      {activeHoursSlice === "justifications" && canViewAdherence ? (
        <>
        <section className="card mb-5 p-4" aria-label="Filtros de justificativas">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <FormInput label="Data inicial" type="date" value={adherenceFilters.startDate} onChange={(value) => setAdherenceFilters({ ...adherenceFilters, startDate: value })} />
            <FormInput label="Data final" type="date" value={adherenceFilters.endDate} onChange={(value) => setAdherenceFilters({ ...adherenceFilters, endDate: value })} />
            <FormSelect label="LOB" value={adherenceFilters.lob} options={Array.from(new Set([...adherenceOptions.lobs, adherenceFilters.lob]))} onChange={(value) => setAdherenceFilters({ ...adherenceFilters, lob: value })} />
            <FormSelect label="Supervisor" value={adherenceFilters.supervisorId} options={Array.from(new Set(["Todos", ...adherenceOptions.supervisors.keys(), adherenceFilters.supervisorId]))} optionLabel={(value) => value === "Todos" ? value : adherenceOptions.supervisors.get(value) ?? adherenceSelectionLabels.supervisor} onChange={(value) => { setAdherenceFilters({ ...adherenceFilters, supervisorId: value }); setAdherenceSelectionLabels((current) => ({ ...current, supervisor: adherenceOptions.supervisors.get(value) ?? value })); }} />
            <FormSelect label="Turno" value={adherenceFilters.shift} options={Array.from(new Set([...adherenceOptions.shifts, adherenceFilters.shift]))} onChange={(value) => setAdherenceFilters({ ...adherenceFilters, shift: value })} />
            <FormSelect label="Parceiro" value={adherenceFilters.employeeId} options={Array.from(new Set(["Todos", ...adherenceOptions.partners.keys(), adherenceFilters.employeeId]))} optionLabel={(value) => value === "Todos" ? value : adherenceOptions.partners.get(value) ?? adherenceSelectionLabels.partner} onChange={(value) => { setAdherenceFilters({ ...adherenceFilters, employeeId: value }); setAdherenceSelectionLabels((current) => ({ ...current, partner: adherenceOptions.partners.get(value) ?? value })); }} />
            <FormSelect label="Status da justificativa" value={adherenceFilters.justificationStatus} options={["Todos", "Pendentes", "Justificados"]} onChange={(value) => setAdherenceFilters({ ...adherenceFilters, justificationStatus: value })} />
            <div className="flex items-end gap-2">
              <button type="button" disabled={loadingAdherence} onClick={() => void loadAdherence(adherenceFilters)} className="h-11 flex-1 rounded-lg bg-blue-600 px-3 text-sm font-bold text-white disabled:opacity-60">{loadingAdherence ? "Carregando..." : "Filtrar"}</button>
              <button type="button" disabled={loadingAdherence} onClick={() => { const cleared = initialAdherenceFilters(currentOperationalMonthRange()); setAdherenceFilters(cleared); void loadAdherence(cleared); }} className="h-11 rounded-lg border border-border bg-white px-3 text-sm font-bold disabled:opacity-60">Limpar</button>
            </div>
          </div>
        </section>
        <section className="card mb-5 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-lg font-extrabold text-navy-950">Pendências de justificativa</h2>
              <p className="text-sm font-semibold text-muted">Capturas originais ou horas lançadas manualmente abaixo de 7:25 para agentes elegíveis.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={`${visibleAdherenceRows.filter((row) => row.status === "Pendente").length} pendente(s)`} />
              <StatusBadge status={`${visibleAdherenceRows.filter((row) => row.status === "Justificado").length} justificado(s)`} />
              <button type="button" onClick={() => void exportAdherence()} disabled={exportingAdherence || loadingAdherence || Boolean(adherenceError)} className="premium-control inline-flex h-10 items-center gap-2 px-4 text-sm font-bold text-navy-950 disabled:opacity-50">
                <Download className="h-4 w-4" /> {exportingAdherence ? "Exportando..." : "Exportar justificativas"}
              </button>
            </div>
          </div>
          {adherenceError ? <p role="alert" className="p-6 text-sm font-bold text-red-700">{adherenceError}</p> : loadingAdherence ? <p role="status" className="p-6 text-sm font-semibold text-muted">Carregando justificativas...</p> : visibleAdherenceRows.length ? (
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full min-w-[1320px] text-left text-sm">
                <thead className="sticky top-0 z-10 border-b border-border bg-slate-50 text-xs font-bold uppercase tracking-wide text-muted">
                  <tr>
                    {[
                      "Parceiro / WB", "Data", "LOB / classificação", "Supervisor", "Escala prevista", "Duração de referência", "Status", "Justificativa", "Resposta"
                    ].map((column) => <th key={column} className="px-4 py-3">{column}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-white">
                  {adherenceDays.map((day) => (
                    <Fragment key={day.date}>
                    <tr className="bg-slate-50"><th scope="rowgroup" colSpan={9} className="px-4 py-3 font-extrabold text-navy-950">{day.date.split("-").reverse().join("/")} <span className="ml-2 text-xs font-semibold text-muted">{day.rows.length} registro(s)</span></th></tr>
                    {day.rows.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-3"><p className="font-bold text-navy-950">{row.employeeName}</p><p className="text-xs font-semibold text-muted">{row.wbLogin}</p></td>
                      <td className="px-4 py-3 font-bold">{row.date}</td>
                      <td className="px-4 py-3">{row.lob} · {row.classification}</td>
                      <td className="px-4 py-3">{row.supervisor}</td>
                      <td className="px-4 py-3">{row.plannedSlot}</td>
                      <td className="px-4 py-3 font-extrabold text-amber-700">{row.capturedDuration}<p className="text-xs font-semibold text-muted">{row.durationSource}</p></td>
                      <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                      <td className="px-4 py-3">
                        {row.status === "Pendente" ? (
                          <textarea
                            aria-label={`Justificativa de aderência de ${row.employeeName}`}
                            value={adherenceDrafts[row.id] ?? ""}
                            onChange={(event) => setAdherenceDrafts((current) => ({ ...current, [row.id]: event.target.value }))}
                            placeholder="Explique a baixa aderência ao Cronograma"
                            className="min-h-20 w-80 rounded-lg border border-border p-2.5 text-sm outline-none focus:border-blue-400"
                          />
                        ) : <p className="max-w-sm whitespace-pre-wrap font-semibold">{row.justification}</p>}
                      </td>
                      <td className="px-4 py-3">
                        {row.status === "Pendente" ? (
                          <button disabled={savingAdherenceId === row.id} onClick={() => submitAdherenceJustification(row)} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-60">
                            {savingAdherenceId === row.id ? "Enviando..." : "Enviar justificativa"}
                          </button>
                        ) : <p className="text-xs font-semibold text-muted">{row.answeredBy}<br />{row.answeredAt}</p>}
                      </td>
                    </tr>
                    ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6"><EmptyState title="Nenhuma justificativa encontrada" description="Não há justificativas pendentes ou respondidas para o período e os filtros selecionados." /></div>
          )}
        </section>
        </>
      ) : null}

      {activeHoursSlice === "hours" ? (
      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-extrabold text-navy-950">Painel de horas</h2>
            <p className="text-sm text-muted">{loading ? "Carregando..." : `${pagination.total} registro(s) no período`}</p>
          </div>
          {!canUpload && normalizedRole === "SUPERVISOR" ? <StatusBadge status="Supervisor solicita ajuste; WFM aprova" /> : null}
        </div>
        <div className="overflow-x-auto">
          {rows.length ? (
            <table className="w-full min-w-[1420px] text-left text-sm">
              <thead className="border-b border-border bg-slate-50 text-xs font-bold uppercase tracking-wide text-muted">
                <tr>
                  {["Data", "Parceiro", "WB/Login", "Status parceiro", "LOB", "Supervisor", "Turno", "Horas planejadas", "Horas realizadas", "Horas de captura", "Dif.", "Status", "Ajuste", "Ações"].map((column) => <th key={column} className="px-4 py-3">{column}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-white">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-blue-50/30">
                    <td className="px-4 py-3 font-bold text-navy-950">{row.date}</td>
                    <td className="px-4 py-3">{row.employeeName}</td>
                    <td className="px-4 py-3">{row.wbLogin}</td>
                    <td className="px-4 py-3"><StatusBadge status={row.employeeStatus || "Sem status"} /></td>
                    <td className="px-4 py-3">{row.lob}</td>
                    <td className="px-4 py-3">{row.supervisor || "-"}</td>
                    <td className="px-4 py-3">{cleanShiftName(row.shift) || "-"}</td>
                    <td className="px-4 py-3">{formatWorkHourValue(row.plannedHours || 0, "0:00")}</td>
                    <td className="px-4 py-3">{formatWorkHourValue(row.effectiveHours, "0:00")}</td>
                    <td className="px-4 py-3">{formatWorkHourValue(row.capturedHours, "0:00")}</td>
                    <td className={cn("px-4 py-3 font-bold", row.differenceMinutes < 0 ? "text-red-600" : row.differenceMinutes > 0 ? "text-emerald-600" : "text-muted")}>{formatHourDifference(row.differenceMinutes)}</td>
                    <td className="px-4 py-3"><WorkHourBalanceBadge plannedHours={row.plannedHours} differenceMinutes={row.differenceMinutes} /></td>
                    <td className="px-4 py-3">
                      {row.adjustmentId ? (
                        <div className="min-w-[240px] space-y-1">
                          <StatusBadge status={row.adjustmentStatus} />
                          <p className="text-xs font-semibold text-muted">Atual: {formatWorkHourValue(row.adjustmentCurrentHours ?? row.effectiveHours, "0:00")}</p>
                          <p className="text-xs font-semibold text-navy-950">Solicitado: {row.adjustmentRequestedHours === null || row.adjustmentRequestedHours === undefined ? "-" : formatWorkHourValue(row.adjustmentRequestedHours)}</p>
                          <p className={cn("text-xs font-bold", (row.adjustmentDifferenceMinutes ?? 0) < 0 ? "text-red-600" : (row.adjustmentDifferenceMinutes ?? 0) > 0 ? "text-emerald-600" : "text-muted")}>
                            Ajuste: {row.adjustmentDifferenceMinutes === null || row.adjustmentDifferenceMinutes === undefined ? "-" : formatHourDifference(row.adjustmentDifferenceMinutes)}
                          </p>
                          {row.adjustmentRequestedBy ? <p className="text-[11px] font-semibold text-muted">Por {row.adjustmentRequestedBy} em {row.adjustmentRequestedAt}</p> : null}
                          {row.adjustmentStatus === "Recusado" && row.adjustmentRejectionReason ? (
                            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-red-800">
                              <p className="text-[11px] font-black uppercase tracking-wide">Motivo da recusa</p>
                              <p className="mt-1 whitespace-pre-wrap text-xs font-semibold leading-5">{row.adjustmentRejectionReason}</p>
                              {row.adjustmentRejectedBy || row.adjustmentRejectedAt ? (
                                <p className="mt-1.5 text-[11px] font-bold text-red-700">
                                  {[row.adjustmentRejectedBy ? `Por ${row.adjustmentRejectedBy}` : "", row.adjustmentRejectedAt ? `em ${row.adjustmentRejectedAt}` : ""].filter(Boolean).join(" ")}
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <StatusBadge status="Sem ajuste" />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {canRequestAdjustment && row.plannedHours > 0 && row.status !== "Ajuste solicitado" ? (
                          <button onClick={() => openAdjustment(row)} className={cn("rounded-lg border px-3 py-2 text-xs font-bold", row.adjustmentStatus === "Recusado" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-blue-200 bg-blue-50 text-blue-700")}>
                            {row.adjustmentStatus === "Recusado" ? "Corrigir e reenviar" : "Solicitar ajuste"}
                          </button>
                        ) : null}
                        {canApprove && row.adjustmentId && row.adjustmentStatus === "Em análise" ? (
                          <>
                            <button onClick={() => openReview(row, "approve")} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Aprovar</button>
                            <button onClick={() => openReview(row, "reject")} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">Recusar</button>
                          </>
                        ) : null}
                        {canDeleteWorkHours ? (
                          <button disabled={deletingWorkHourId === row.id} onClick={() => deleteWorkHour(row)} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-60">
                            {deletingWorkHourId === row.id ? "Excluindo..." : "Excluir"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8"><EmptyState title="Nenhum registro de horas" description="Importe horas realizadas ou ajuste os filtros do período." /></div>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border px-5 py-4 text-sm text-muted">
          <span>Página {pagination.page} de {pagination.totalPages}</span>
          <div className="flex gap-2">
            <button disabled={pagination.page <= 1} onClick={() => loadWorkHours(pagination.page - 1)} className="rounded-lg border border-border bg-white px-3 py-2 font-bold disabled:opacity-40">Anterior</button>
            <button disabled={pagination.page >= pagination.totalPages} onClick={() => loadWorkHours(pagination.page + 1)} className="rounded-lg border border-border bg-white px-3 py-2 font-bold disabled:opacity-40">Próxima</button>
          </div>
        </div>
      </section>
      ) : null}

      {showPreview && preview ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Preview do upload de horas</h2>
                <p className="text-sm text-muted">{preview.fileName} • {preview.totalRows} linha(s)</p>
              </div>
              <button onClick={() => setShowPreview(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="max-h-[56vh] min-h-[260px] overflow-auto rounded-lg border border-border">
                {preview.message ? (
                  <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{preview.message}</div>
                ) : null}
                <table className="w-full min-w-[1060px] text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-50 font-bold text-muted">
                    <tr>
                      <th className="px-3 py-2">Linha</th>
                      <th className="px-3 py-2">WB/Login</th>
                      <th className="px-3 py-2">Parceiro</th>
                      <th className="px-3 py-2">Status parceiro</th>
                      <th className="px-3 py-2">Data</th>
                      <th className="px-3 py-2">Cronograma</th>
                      <th className="px-3 py-2">Status cronograma</th>
                      <th className="px-3 py-2">Aceita horas</th>
                      <th className="px-3 py-2">Planejado</th>
                      <th className="px-3 py-2">Horas</th>
                      <th className="px-3 py-2">Divergência</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Ação</th>
                      <th className="px-3 py-2">Erros/alertas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-white">
                    {preview.validation.slice(0, IMPORT_PREVIEW_ROW_LIMIT).map((row) => (
                      <tr key={row.rowNumber}>
                        <td className="px-3 py-2 font-bold">{row.rowNumber}</td>
                        <td className="px-3 py-2">
                          <p className="font-bold text-navy-950">{row.originalWbLogin || row.wbLogin}</p>
                          {row.normalizedWbLogin && row.normalizedWbLogin !== (row.originalWbLogin || row.wbLogin).toLowerCase() ? (
                            <p className="text-[11px] text-muted">normalizado: {row.normalizedWbLogin}</p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">{row.employeeName || "-"}</td>
                        <td className="px-3 py-2">{row.employeeStatus || "-"}</td>
                        <td className="px-3 py-2">{row.date || "-"}</td>
                        <td className="px-3 py-2">{row.hasSchedule ? "Sim" : "Não"}</td>
                        <td className="px-3 py-2">{row.scheduleStatus || "-"}</td>
                        <td className="px-3 py-2">{row.allowsWorkHours ? "Sim" : "Não"}</td>
                        <td className="px-3 py-2">{row.plannedHoursLabel || (row.plannedHours === null || row.plannedHours === undefined ? "-" : formatWorkHourValue(row.plannedHours))}</td>
                        <td className="px-3 py-2">{row.actualHoursLabel || (row.actualHours === null || row.actualHours === undefined ? "-" : formatWorkHourValue(row.actualHours))}</td>
                        <td className={cn("px-3 py-2 font-bold", (row.differenceMinutes ?? 0) < 0 ? "text-red-600" : (row.differenceMinutes ?? 0) > 0 ? "text-emerald-600" : "text-muted")}>{row.differenceLabel || (row.differenceMinutes === null || row.differenceMinutes === undefined ? "-" : formatHourDifference(row.differenceMinutes))}</td>
                        <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
                        <td className="px-3 py-2">{row.action}</td>
                        <td className="px-3 py-2">
                          {[...row.errors, ...row.warnings].length ? [...row.errors, ...row.warnings].join(" | ") : "OK"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="max-h-[56vh] min-h-0 space-y-3 overflow-y-auto pr-1">
                <MetricPill value={preview.validRows} label="Linhas válidas" />
                <MetricPill value={preview.errorRows} label="Linhas com erro" />
                <MetricPill value={preview.warningRows} label="Alertas" />
                <MetricPill value={preview.createdRows} label="Novos registros" />
                <MetricPill value={preview.updatedRows} label="Atualizações" />
                <MetricPill value={`${preview.foundUniqueWbLogins ?? 0}/${preview.uniqueWbLogins ?? 0}`} label="WB/Login encontrados" />
                <MetricPill value={preview.scheduleFoundRows} label="Com cronograma" />
                <MetricPill value={preview.noScheduleRows} label="Sem cronograma" />
                <p className="text-sm text-muted">WB/Login inexistente ou ausência de cronograma bloqueia a linha. Parceiro desligado/inativo vira alerta para invoice, não erro. A divergência compara horas realizadas contra {formatWorkHourValue(DEFAULT_PRODUCTIVE_HOURS)} por dia produtivo.</p>
                <ImportIssueSummary rows={preview.validation} title="Corrija estas linhas do upload de horas" />
                {preview.missingWbLogins?.length ? (
                  <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-xs font-semibold text-red-700">
                    <p className="mb-1 font-extrabold">Primeiros WB/Login não encontrados</p>
                    <p className="max-h-32 overflow-y-auto break-words pr-1">{preview.missingWbLogins.slice(0, IMPORT_PREVIEW_ISSUE_LIMIT).join(", ")}</p>
                    {preview.missingWbLogins.length > IMPORT_PREVIEW_ISSUE_LIMIT ? (
                      <p className="mt-2 text-muted">Mostrando {IMPORT_PREVIEW_ISSUE_LIMIT} de {preview.missingWbLogins.length} WB/Login não encontrados.</p>
                    ) : null}
                  </div>
                ) : null}
                {preview.validation.length > IMPORT_PREVIEW_ROW_LIMIT ? <p className="text-xs font-semibold text-muted">Exibindo as primeiras {IMPORT_PREVIEW_ROW_LIMIT} linhas do preview. O arquivo completo será processado na confirmação.</p> : null}
              </div>
            </div>
            <div className="shrink-0 flex flex-wrap justify-end gap-3 border-t border-border bg-white px-5 py-3">
              <button onClick={() => setShowPreview(false)} className="rounded-lg border border-border px-4 py-3 text-sm font-bold">Cancelar</button>
              <button disabled={savingImport || preview.validRows === 0} onClick={commitWorkHourImport} className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-60">
                {savingImport ? "Importando..." : "Confirmar importação"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showAdjustment && selectedRow ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-2xl p-5">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">{selectedRow.adjustmentStatus === "Recusado" ? "Corrigir e reenviar ajuste" : "Solicitar ajuste de horas"}</h2>
                <p className="text-sm text-muted">{selectedRow.employeeName} • {selectedRow.date} • {selectedRow.wbLogin}</p>
              </div>
              <button onClick={() => setShowAdjustment(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            {selectedRow.adjustmentStatus === "Recusado" && selectedRow.adjustmentRejectionReason ? (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
                <p className="text-sm font-extrabold">Motivo da recusa</p>
                <p className="mt-1 whitespace-pre-wrap text-sm font-semibold leading-6">{selectedRow.adjustmentRejectionReason}</p>
                {selectedRow.adjustmentRejectedBy || selectedRow.adjustmentRejectedAt ? (
                  <p className="mt-2 text-xs font-bold text-red-700">
                    {[selectedRow.adjustmentRejectedBy ? `Por ${selectedRow.adjustmentRejectedBy}` : "", selectedRow.adjustmentRejectedAt ? `em ${selectedRow.adjustmentRejectedAt}` : ""].filter(Boolean).join(" ")}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              <InfoLine label="Parceiro" value={selectedRow.employeeName} />
              <InfoLine label="WB/Login" value={selectedRow.wbLogin} />
              <InfoLine label="Data" value={selectedRow.date} />
              <InfoLine label="Cronograma vinculado" value={selectedRow.plannedHours > 0 ? "Sim" : "Não"} />
              <InfoLine label="Horas planejadas produtivas" value={formatWorkHourValue(selectedRow.plannedHours || DEFAULT_PRODUCTIVE_HOURS)} />
              <InfoLine label="Hora realizada atual" value={formatWorkHourValue(selectedRow.effectiveHours, "0:00")} />
              <InfoLine label="Divergência atual" value={formatHourDifference(selectedRow.differenceMinutes)} />
              <InfoLine label="Diferença do ajuste" value={selectedAdjustmentDifferenceMinutes === null ? "-" : formatHourDifference(selectedAdjustmentDifferenceMinutes)} />
              <FormInput label="Nova hora solicitada" value={adjustmentForm.requestedActualHours} onChange={(value) => setAdjustmentForm({ ...adjustmentForm, requestedActualHours: value })} />
              <div>
                <FormSelect label="Motivo" value={adjustmentForm.reason} options={["Erro de apontamento", "Sistema não capturou horário", "Feedback/treinamento durante o turno", "Problema técnico", "Ajuste manual autorizado", "Erro no upload", "Atividade operacional fora do sistema", "Outro"]} onChange={(value) => setAdjustmentForm({ ...adjustmentForm, reason: value })} />
              </div>
              <label className="md:col-span-2">
                <span className="mb-1.5 block text-sm font-bold text-muted">Justificativa</span>
                <textarea value={adjustmentForm.justification} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, justification: event.target.value })} className="min-h-28 w-full rounded-lg border border-border p-3 outline-none" />
              </label>
            </div>
            <button disabled={savingAdjustment} onClick={submitAdjustment} className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
              {savingAdjustment ? "Enviando..." : selectedRow.adjustmentStatus === "Recusado" ? "Reenviar para WFM/Admin" : "Enviar para WFM/Admin"}
            </button>
          </div>
        </div>
      ) : null}

      {showReview && selectedRow ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-xl p-5">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">{adjustmentAction === "approve" ? "Aprovar ajuste" : "Recusar ajuste"}</h2>
                <p className="text-sm text-muted">{selectedRow.employeeName} • {selectedRow.date}</p>
              </div>
              <button onClick={() => setShowReview(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            <div className="mb-4 grid gap-3 md:grid-cols-2">
              <InfoLine label="Hora realizada atual" value={formatWorkHourValue(selectedRow.adjustmentCurrentHours ?? selectedRow.effectiveHours, "0:00")} />
              <InfoLine label="Hora solicitada" value={selectedRow.adjustmentRequestedHours === null || selectedRow.adjustmentRequestedHours === undefined ? "-" : formatWorkHourValue(selectedRow.adjustmentRequestedHours)} />
              <InfoLine label="Diferença solicitada" value={selectedRow.adjustmentDifferenceMinutes === null || selectedRow.adjustmentDifferenceMinutes === undefined ? "-" : formatHourDifference(selectedRow.adjustmentDifferenceMinutes)} />
              <InfoLine label="Status do ajuste" value={selectedRow.adjustmentStatus} />
              <InfoLine label="Motivo" value={selectedRow.adjustmentReason || "-"} />
              <InfoLine label="Solicitado por" value={selectedRow.adjustmentRequestedBy || "-"} />
              <div className="md:col-span-2">
                <InfoLine label="Justificativa" value={selectedRow.adjustmentJustification || "-"} />
              </div>
            </div>
            {adjustmentAction === "reject" ? (
              <label>
                <span className="mb-1.5 block text-sm font-bold text-muted">Motivo da recusa</span>
                <textarea value={adjustmentForm.rejectionReason} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, rejectionReason: event.target.value })} className="min-h-28 w-full rounded-lg border border-border p-3 outline-none" />
              </label>
            ) : (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
                Ao aprovar, as horas ajustadas passam a valer como horas efetivas oficiais.
              </div>
            )}
            <button disabled={savingAdjustment} onClick={reviewAdjustment} className={cn("mt-5 w-full rounded-lg px-4 py-3 text-sm font-bold text-white disabled:opacity-60", adjustmentAction === "approve" ? "bg-emerald-600" : "bg-red-600")}>
              {savingAdjustment ? "Processando..." : adjustmentAction === "approve" ? "Aprovar ajuste" : "Recusar ajuste"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
