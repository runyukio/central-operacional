"use client";

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { EmptyState, MetricPill, PageHeader, Panel, StatusBadge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { cleanShiftName, isSelectableShiftName, standardShiftNames } from "@/lib/shift-display";
import { DEFAULT_PRODUCTIVE_HOURS, canScheduleStatusReceiveWorkHours } from "@/lib/work-hours-rules";
import { MONTHLY_ADVANCE_FIXED_AMOUNT } from "@/lib/monthly-advance-constants";
import { AdditionalRegistrationDataResponse, ClientRequest, CoverageWarningDialog, CoverageWarningDialogState, DayOffKind, FormInput, FormSelect, InfoLine, MonthlyAdvanceRecordClient, RequestDetailContent, SystemSettings, WorkHourRow, WorkHourSummary, apiJson, coverageImpactFromError, currencyFormatter, currentOperationalDateInput, currentOperationalMonth, dateInputFromParts, dayOffKindFromRequest, dayOffKindLabels, formatHourDifference, formatWorkHourSummaryDifference, formatWorkHourValue, getRequestIcon, monthRange, moodOptionForScore, normalizeMoodScoreForUi, offsetOperationalDateInput, operationalDateFromParts, operationalMoodOptions, requestPriorities, requestStatuses, requestTypes, scheduleMonthFormatter, shiftTagClass, statusFromScheduleCell } from './shared';
const dayOffOptions: Array<{ kind: DayOffKind; title: string; description: string }> = [
  { kind: "DAY_OFF_SWAP", title: "Trocar folga", description: "Mover uma folga para outra data já programada." },
  { kind: "DAY_OFF_SELL", title: "Vender folga", description: "Trabalhar em uma Folga, Folga aprovada ou Troca aprovada." },
  { kind: "DAY_OFF_REQUEST", title: "Solicitar dia de folga", description: "Pedir folga em uma data em que você está programado." }
];


type MonthlyAdvanceCycle = {
  referenceMonth: string;
  label: string;
  monthLabel: string;
  locked: boolean;
  closedMessage: string;
  deadlineMessage?: string;
  answered: boolean;
  canRespond: boolean;
  canRequestChange: boolean;
  record: MonthlyAdvanceRecordClient | null;
};


type CalendarScheduleDay = {
  date: number;
  outside: boolean;
  shift: string;
  label: string;
  dateIso?: string;
};


function primaryDayOffDate(request: ClientRequest) {
  const payload = request.payload ?? {};
  if (/turno/i.test(request.type)) {
    const start = String(payload.shiftChangeStartDate ?? payload.shiftChangeDate ?? payload.requestedDate ?? "-");
    const end = String(payload.shiftChangeEndDate ?? "");
    return end && end !== start ? `${start} a ${end}` : start;
  }
  const kind = dayOffKindFromRequest(request);
  if (kind === "DAY_OFF_SWAP") return String(payload.currentDayOffDate ?? "-");
  if (kind === "DAY_OFF_SELL") return String(payload.dayOffToSellDate ?? "-");
  if (kind === "DAY_OFF_REQUEST") return String(payload.desiredDayOffRequestDate ?? payload.desiredDayOffDate ?? payload.requestedDate ?? "-");
  return String(payload.requestedDate ?? "-");
}


export function MySchedulePage() {
  const [days, setDays] = useState<CalendarScheduleDay[]>(emptyCalendarDays());
  const [mySchedulePeriod, setMySchedulePeriod] = useState(() => currentOperationalMonth());
  const [loadingMySchedule, setLoadingMySchedule] = useState(false);
  const [scheduleInfo, setScheduleInfo] = useState<{ id: string; name: string; schedule: string; shift: string; lob: string } | null>(null);
  const [myWorkHours, setMyWorkHours] = useState<WorkHourRow[]>([]);
  const [myWorkHourSummary, setMyWorkHourSummary] = useState<WorkHourSummary | null>(null);
  const [myScheduleShiftOptions, setMyScheduleShiftOptions] = useState<string[]>(Array.from(standardShiftNames).filter((shift) => shift !== "Folga"));
  const [monthlyAdvanceCycles, setMonthlyAdvanceCycles] = useState<MonthlyAdvanceCycle[]>([]);
  const [monthlyAdvanceNotice, setMonthlyAdvanceNotice] = useState("");
  const [monthlyAdvanceBlockedReason, setMonthlyAdvanceBlockedReason] = useState("");
  const [savingMonthlyAdvance, setSavingMonthlyAdvance] = useState("");
  const [myRequests, setMyRequests] = useState<ClientRequest[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<ClientRequest | null>(null);
  const [showDayOffModal, setShowDayOffModal] = useState(false);
  const [showShiftChangeModal, setShowShiftChangeModal] = useState(false);
  const [dayOffMessage, setDayOffMessage] = useState("");
  const [savingDayOff, setSavingDayOff] = useState(false);
  const [savingShiftChange, setSavingShiftChange] = useState(false);
  const [actorRole, setActorRole] = useState("COLABORADOR");
  const [actionReason, setActionReason] = useState("");
  const [comment, setComment] = useState("");
  const [actionPending, setActionPending] = useState("");
  const [coverageWarning, setCoverageWarning] = useState<CoverageWarningDialogState | null>(null);
  const [requestFilters, setRequestFilters] = useState({ status: "Todos", type: "Todos", priority: "Todos", query: "" });
  const [dayOffForm, setDayOffForm] = useState({
    kind: "DAY_OFF_SWAP" as DayOffKind,
    currentDayOffDate: offsetOperationalDateInput(1),
    desiredDayOffDate: offsetOperationalDateInput(4),
    dayOffToSellDate: offsetOperationalDateInput(1),
    availabilityShift: "Manhã",
    preferredStartTime: "",
    preferredEndTime: "",
    acknowledgement: false,
    desiredDayOffRequestDate: offsetOperationalDateInput(5),
    dayOffReason: "Pessoal",
    urgency: "Média" as ClientRequest["priority"],
    justification: "",
    attachmentUrl: ""
  });
  const [shiftChangeForm, setShiftChangeForm] = useState({
    changeType: "Temporária" as "Fixa" | "Temporária",
    date: currentOperationalDateInput(),
    startDate: currentOperationalDateInput(),
    endDate: currentOperationalDateInput(),
    currentShift: "Sem turno",
    desiredShift: "Manhã",
    reason: "",
    observation: ""
  });
  const [todayMood, setTodayMood] = useState<{ id: string; date: string; moodScore: number; moodLabel: string; comment: string } | null>(null);
  const [moodForm, setMoodForm] = useState({ moodScore: 3, comment: "" });
  const [savingMood, setSavingMood] = useState(false);
  const [additionalDataPending, setAdditionalDataPending] = useState(false);

  useEffect(() => {
    void loadMyRequests();
    void loadMyMonthlyAdvance();
    void loadMyScheduleSettings();
    void loadMyMood();
    void loadMyAdditionalDataStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadMySchedule(mySchedulePeriod);
    void loadMyWorkHours(mySchedulePeriod);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mySchedulePeriod.month, mySchedulePeriod.year]);

  async function loadMySchedule(period = mySchedulePeriod) {
    const range = monthRange(period.month, period.year);
    const params = new URLSearchParams({
      view: "mine",
      startDate: range.startDate,
      endDate: range.endDate,
      month: String(period.month),
      year: String(period.year)
    });
    setLoadingMySchedule(true);
    try {
      const payload = await apiJson<{ data: { scheduleDays: CalendarScheduleDay[]; ownEmployee?: { id: string; name: string; schedule: string; shift: string; lob: string } | null } }>(`/api/schedules?${params.toString()}`);
      setDays(payload.data.scheduleDays.length ? payload.data.scheduleDays : emptyCalendarDays(period.month, period.year));
      setScheduleInfo(payload.data.ownEmployee ? { ...payload.data.ownEmployee, shift: cleanShiftName(payload.data.ownEmployee.shift) || "Sem turno" } : null);
    } catch {
      setDays(emptyCalendarDays(period.month, period.year));
      setScheduleInfo(null);
    } finally {
      setLoadingMySchedule(false);
    }
  }

  async function loadMyWorkHours(period = mySchedulePeriod) {
    const range = monthRange(period.month, period.year);
    try {
      const params = new URLSearchParams({
        scope: "mine",
        startDate: range.startDate,
        endDate: range.endDate,
        limit: "100"
      });
      const payload = await apiJson<{ data: WorkHourRow[]; summary: WorkHourSummary }>(`/api/work-hours?${params.toString()}`);
      setMyWorkHours(Array.isArray(payload.data) ? payload.data : []);
      setMyWorkHourSummary(payload.summary ?? null);
    } catch {
      setMyWorkHours([]);
      setMyWorkHourSummary(null);
    }
  }

  async function loadMyMonthlyAdvance() {
    try {
      const payload = await apiJson<{ data: MonthlyAdvanceCycle[]; message?: string; blockedReason?: string }>("/api/monthly-advance?scope=mine");
      setMonthlyAdvanceCycles(Array.isArray(payload.data) ? payload.data : []);
      setMonthlyAdvanceNotice(payload.message ?? "");
      setMonthlyAdvanceBlockedReason(payload.blockedReason ?? "");
    } catch {
      setMonthlyAdvanceCycles([]);
      setMonthlyAdvanceNotice("");
      setMonthlyAdvanceBlockedReason("");
    }
  }

  async function loadMyScheduleSettings() {
    try {
      const payload = await apiJson<{ data: SystemSettings }>("/api/settings");
      const shifts = payload.data.shifts
        .filter((shift) => shift.status !== "INACTIVE")
        .map((shift) => cleanShiftName(shift.name))
        .filter((shift) => shift && shift !== "Folga" && isSelectableShiftName(shift));
      setMyScheduleShiftOptions(Array.from(new Set([...Array.from(standardShiftNames).filter((shift) => shift !== "Folga"), ...shifts])));
    } catch {
      setMyScheduleShiftOptions(Array.from(standardShiftNames).filter((shift) => shift !== "Folga"));
    }
  }

  async function loadMyRequests() {
    try {
      const payload = await apiJson<{ data: ClientRequest[]; actor?: { role: string; name: string } }>("/api/requests?scope=mine");
      setMyRequests(payload.data);
      setActorRole(payload.actor?.role ?? "COLABORADOR");
      setSelectedRequest((current) => (current ? payload.data.find((item) => item.id === current.id) ?? current : null));
    } catch {
      setMyRequests([]);
    }
  }

  async function loadMyMood() {
    try {
      const date = currentOperationalDateInput();
      const payload = await apiJson<{ data: { id: string; date: string; moodScore: number; moodLabel: string; comment: string } | null }>(`/api/mood?date=${date}`);
      setTodayMood(payload.data);
      if (payload.data) setMoodForm({ moodScore: normalizeMoodScoreForUi(payload.data.moodScore), comment: payload.data.comment ?? "" });
    } catch {
      setTodayMood(null);
    }
  }

  async function loadMyAdditionalDataStatus() {
    try {
      const payload = await apiJson<AdditionalRegistrationDataResponse>("/api/employee-additional-data");
      setAdditionalDataPending(Boolean(payload.data.pending));
    } catch {
      setAdditionalDataPending(false);
    }
  }

  async function submitMood() {
    if (savingMood) return;
    setSavingMood(true);
    setDayOffMessage("");
    try {
      const payload = await apiJson<{ data: { id: string; date: string; moodScore: number; moodLabel: string; comment: string }; message?: string }>("/api/mood", {
        method: "POST",
        body: JSON.stringify({
          date: currentOperationalDateInput(),
          moodScore: moodForm.moodScore,
          comment: moodForm.comment || undefined
        })
      });
      setTodayMood(payload.data);
      setDayOffMessage(payload.message ?? "Humor registrado com sucesso.");
    } catch (error) {
      setDayOffMessage(error instanceof Error ? error.message : "Não foi possível registrar seu humor.");
    } finally {
      setSavingMood(false);
    }
  }

  async function respondMonthlyAdvance(referenceMonth: string, optIn: boolean) {
    if (savingMonthlyAdvance) return;
    setSavingMonthlyAdvance(referenceMonth);
    setDayOffMessage("");
    try {
      await apiJson<{ data: MonthlyAdvanceRecordClient }>("/api/monthly-advance", {
        method: "POST",
        body: JSON.stringify({ referenceMonth, optIn })
      });
      setDayOffMessage(optIn ? "Adesão registrada com valor de R$300,00." : "Resposta do adiantamento mensal registrada com sucesso.");
      await loadMyMonthlyAdvance();
    } catch (error) {
      setDayOffMessage(error instanceof Error ? error.message : "Não foi possível responder o adiantamento mensal.");
    } finally {
      setSavingMonthlyAdvance("");
    }
  }

  async function requestMonthlyAdvanceChange(cycle: MonthlyAdvanceCycle) {
    if (!cycle.record || savingMonthlyAdvance) return;
    const requestedOptIn = !cycle.record.optIn;
    const reason = window.prompt(`Informe o motivo para alterar ${cycle.monthLabel} para ${requestedOptIn ? "Sim" : "Não"}.`);
    if (!reason?.trim()) return;
    setSavingMonthlyAdvance(cycle.referenceMonth);
    setDayOffMessage("");
    try {
      await apiJson<{ data: { id: string } }>("/api/monthly-advance/change-request", {
        method: "POST",
        body: JSON.stringify({
          referenceMonth: cycle.referenceMonth,
          requestedOptIn,
          reason,
          observation: reason
        })
      });
      setDayOffMessage("Solicitação de alteração do adiantamento aberta para análise do WFM.");
      await loadMyRequests();
    } catch (error) {
      setDayOffMessage(error instanceof Error ? error.message : "Não foi possível abrir a solicitação de alteração.");
    } finally {
      setSavingMonthlyAdvance("");
    }
  }

  function validateDayOffForm() {
    if (!dayOffForm.justification.trim()) return "Justificativa é obrigatória.";
    if (dayOffForm.kind === "DAY_OFF_SWAP") {
      if (!dayOffForm.currentDayOffDate || !dayOffForm.desiredDayOffDate) return "Informe a data atual e a nova data desejada.";
      if (dayOffForm.currentDayOffDate === dayOffForm.desiredDayOffDate) return "A nova data não pode ser igual à data atual da folga.";
    }
    if (dayOffForm.kind === "DAY_OFF_SELL") {
      if (!dayOffForm.dayOffToSellDate) return "Informe a data da folga que deseja vender.";
      if (!dayOffForm.availabilityShift && (!dayOffForm.preferredStartTime || !dayOffForm.preferredEndTime)) return "Informe o turno desejado ou disponibilidade de horário.";
      if (!dayOffForm.acknowledgement) return "Confirme a ciência de que a venda depende de aprovação.";
    }
    if (dayOffForm.kind === "DAY_OFF_REQUEST") {
      if (!dayOffForm.desiredDayOffRequestDate) return "Informe a data desejada para folga.";
      if (!dayOffForm.dayOffReason) return "Informe o motivo da solicitação.";
    }
    return "";
  }

  async function submitDayOffRequest() {
    const validation = validateDayOffForm();
    if (validation) {
      setDayOffMessage(validation);
      return;
    }
    setSavingDayOff(true);
    setDayOffMessage("");
    const type = dayOffKindLabels[dayOffForm.kind];
    try {
      const payload = await apiJson<{ data: ClientRequest }>("/api/requests", {
        method: "POST",
        body: JSON.stringify({
          type,
          title: type,
          priority: dayOffForm.kind === "DAY_OFF_REQUEST" ? dayOffForm.urgency : "Média",
          description: dayOffForm.justification,
          dayOffKind: dayOffForm.kind,
          currentDayOffDate: dayOffForm.kind === "DAY_OFF_SWAP" ? dayOffForm.currentDayOffDate : undefined,
          desiredDayOffDate: dayOffForm.kind === "DAY_OFF_SWAP" ? dayOffForm.desiredDayOffDate : undefined,
          dayOffToSellDate: dayOffForm.kind === "DAY_OFF_SELL" ? dayOffForm.dayOffToSellDate : undefined,
          availabilityShift: dayOffForm.kind === "DAY_OFF_SELL" ? dayOffForm.availabilityShift : undefined,
          preferredStartTime: dayOffForm.kind === "DAY_OFF_SELL" ? dayOffForm.preferredStartTime : undefined,
          preferredEndTime: dayOffForm.kind === "DAY_OFF_SELL" ? dayOffForm.preferredEndTime : undefined,
          acknowledgement: dayOffForm.kind === "DAY_OFF_SELL" ? dayOffForm.acknowledgement : undefined,
          desiredDayOffRequestDate: dayOffForm.kind === "DAY_OFF_REQUEST" ? dayOffForm.desiredDayOffRequestDate : undefined,
          dayOffReason: dayOffForm.kind === "DAY_OFF_REQUEST" ? dayOffForm.dayOffReason : undefined,
          urgency: dayOffForm.kind === "DAY_OFF_REQUEST" ? dayOffForm.urgency : undefined,
          justification: dayOffForm.justification,
          attachmentUrl: dayOffForm.attachmentUrl || undefined
        })
      });
      setShowDayOffModal(false);
      setMyRequests((items) => [payload.data, ...items]);
      setSelectedRequest(payload.data);
      setDayOffMessage(`Solicitação ${payload.data.id} criada com sucesso. Ela já aparece em Minhas Solicitações e na esteira.`);
      await loadMyRequests();
    } catch (error) {
      setDayOffMessage(error instanceof Error ? error.message : "Não foi possível criar a solicitação de folga.");
    } finally {
      setSavingDayOff(false);
    }
  }

  function openDayOffRequestModal() {
    setDayOffMessage("");
    setShowDayOffModal(true);
  }

  function selectDayOffKind(kind: DayOffKind) {
    setDayOffMessage("");
    setDayOffForm((current) => ({ ...current, kind }));
  }

  function shiftForScheduleDate(dateIso: string) {
    const day = days.find((item) => item.dateIso === dateIso && !item.outside);
    return cleanShiftName(day?.shift) || "Sem turno";
  }

  function openShiftChangeRequest(dateIso?: string) {
    const targetDate = dateIso || currentOperationalDateInput();
    const currentShift = shiftForScheduleDate(targetDate);
    const desiredShift = ["Manhã", "Tarde", "Noite"].find((shift) => shift !== currentShift) ?? "Manhã";
    setShiftChangeForm({
      changeType: "Temporária",
      date: targetDate,
      startDate: targetDate,
      endDate: targetDate,
      currentShift,
      desiredShift,
      reason: "",
      observation: ""
    });
    setShowShiftChangeModal(true);
  }

  async function submitShiftChangeRequest() {
    const startDate = shiftChangeForm.startDate || shiftChangeForm.date;
    const endDate = shiftChangeForm.endDate;
    if (!startDate) {
      setDayOffMessage(shiftChangeForm.changeType === "Fixa" ? "Data de início da vigência é obrigatória." : "Data inicial da troca de turno é obrigatória.");
      return;
    }
    if (shiftChangeForm.changeType === "Temporária" && !endDate) {
      setDayOffMessage("Data final da troca de turno temporária é obrigatória.");
      return;
    }
    if (shiftChangeForm.changeType === "Temporária" && endDate < startDate) {
      setDayOffMessage("Data final não pode ser anterior à data inicial.");
      return;
    }
    if (!shiftChangeForm.desiredShift.trim()) {
      setDayOffMessage("Novo turno solicitado é obrigatório.");
      return;
    }
    if (!shiftChangeForm.reason.trim()) {
      setDayOffMessage("Motivo da troca de turno é obrigatório.");
      return;
    }
    if (cleanShiftName(shiftChangeForm.currentShift) === cleanShiftName(shiftChangeForm.desiredShift)) {
      setDayOffMessage("O novo turno precisa ser diferente do turno atual.");
      return;
    }
    setSavingShiftChange(true);
    setDayOffMessage("");
    try {
      const payload = await apiJson<{ data: ClientRequest }>("/api/requests", {
        method: "POST",
        body: JSON.stringify({
          type: "Troca de Turno",
          title: "Troca de Turno",
          priority: "Média",
          description: shiftChangeForm.reason,
          requestedDate: startDate,
          shiftChangeType: shiftChangeForm.changeType,
          shiftChangeDate: startDate,
          shiftChangeStartDate: startDate,
          shiftChangeEndDate: shiftChangeForm.changeType === "Temporária" ? endDate : undefined,
          currentShift: shiftChangeForm.currentShift,
          desiredShift: shiftChangeForm.desiredShift,
          shiftChangeReason: shiftChangeForm.reason,
          shiftChangeObservation: shiftChangeForm.observation || undefined,
          justification: shiftChangeForm.reason
        })
      });
      setShowShiftChangeModal(false);
      setMyRequests((items) => [payload.data, ...items]);
      setSelectedRequest(payload.data);
      setDayOffMessage(`Solicitação ${payload.data.id} de troca de turno enviada com sucesso.`);
      await loadMyRequests();
    } catch (error) {
      setDayOffMessage(error instanceof Error ? error.message : "Não foi possível criar a solicitação de troca de turno.");
    } finally {
      setSavingShiftChange(false);
    }
  }

  async function moveMyRequest(id: string, status: string, actionInput?: Record<string, string>) {
    if (actionPending) return;
    const reason = actionReason.trim();
    if (status === "Recusado" && !reason) {
      setDayOffMessage("Informe o motivo da recusa.");
      return;
    }

    setActionPending(`${id}:${status}`);
    const patchStatus = (confirmed = false) => apiJson<{ data: ClientRequest; scheduleUpdated: boolean }>("/api/requests/status", {
      method: "PATCH",
      body: JSON.stringify({
        id,
        status,
        reason: reason || undefined,
        actionInput: { ...(actionInput ?? {}), ...(confirmed ? { confirmCoverageWarning: "true" } : {}) }
      })
    });
    const applyPayload = async (payload: { data: ClientRequest; scheduleUpdated: boolean }) => {
      setMyRequests((items) => items.map((item) => (item.id === id ? payload.data : item)));
      setSelectedRequest(payload.data);
      setActionReason("");
      setDayOffMessage(payload.scheduleUpdated ? "Solicitação aprovada e cronograma atualizado." : `Solicitação movida para ${payload.data.status}.`);
      await loadMySchedule(mySchedulePeriod);
      await loadMyWorkHours(mySchedulePeriod);
    };
    try {
      await applyPayload(await patchStatus());
    } catch (error) {
      const impact = coverageImpactFromError(error);
      if (impact) {
        setCoverageWarning({
          impact,
          onConfirm: async () => {
            setActionPending(`${id}:${status}`);
            try {
              await applyPayload(await patchStatus(true));
              setCoverageWarning(null);
            } catch (retryError) {
              setDayOffMessage(retryError instanceof Error ? retryError.message : "Não foi possível atualizar a solicitação.");
              setCoverageWarning(null);
            } finally {
              setActionPending("");
            }
          }
        });
        return;
      }
      setDayOffMessage(error instanceof Error ? error.message : "Não foi possível atualizar a solicitação.");
    } finally {
      setActionPending("");
    }
  }

  async function submitMyComment(id: string) {
    if (!comment.trim()) {
      setDayOffMessage("Digite um comentário antes de enviar.");
      return;
    }
    try {
      const payload = await apiJson<{ data: ClientRequest }>("/api/requests/comments", {
        method: "POST",
        body: JSON.stringify({ id, body: comment })
      });
      setMyRequests((items) => items.map((item) => (item.id === id ? payload.data : item)));
      setSelectedRequest(payload.data);
      setComment("");
      setDayOffMessage("Comentário registrado.");
    } catch (error) {
      setDayOffMessage(error instanceof Error ? error.message : "Não foi possível comentar.");
    }
  }

  const filteredRequests = myRequests.filter((request) => {
    const query = requestFilters.query.toLowerCase();
    return (
      (requestFilters.status === "Todos" || request.status === requestFilters.status) &&
      (requestFilters.type === "Todos" || request.type === requestFilters.type) &&
      (requestFilters.priority === "Todos" || request.priority === requestFilters.priority) &&
      (!query || [request.title, request.description, request.type].join(" ").toLowerCase().includes(query))
    );
  });

  const requestSummary = {
    total: myRequests.length,
    open: myRequests.filter((request) => request.status === "Aberto").length,
    analysis: myRequests.filter((request) => request.status === "Em análise").length,
    approved: myRequests.filter((request) => request.status === "Aprovado").length,
    refused: myRequests.filter((request) => request.status === "Recusado").length,
    done: myRequests.filter((request) => request.status === "Concluído").length,
    canceled: myRequests.filter((request) => request.status === "Cancelado").length
  };
  const monthLabel = scheduleMonthFormatter.format(operationalDateFromParts(mySchedulePeriod.year, mySchedulePeriod.month, 1));
  const todayIso = currentOperationalDateInput();
  const hasSchedule = days.some((day) => !day.outside && day.label !== "Sem cronograma");
  const nextScheduleLabel = cleanShiftName(days.find((day) => !day.outside && !["Sem cronograma", "Folga", "Férias"].includes(day.label))?.shift) || "";
  const workHourByDate = new Map(myWorkHours.map((row) => [row.date, row]));
  const shiftChangeOptions = Array.from(new Set([
    ...myScheduleShiftOptions,
    ...days.map((day) => cleanShiftName(day.shift)).filter((shift) => shift && shift !== "Folga" && shift !== "Sem turno" && shift !== "Sem cronograma")
  ]));
  const currentMoodOption = moodOptionForScore(moodForm.moodScore);
  const CurrentMoodIcon = currentMoodOption.icon;
  const dayOffSubmitLabel = dayOffForm.kind === "DAY_OFF_SWAP"
    ? "Enviar troca de folga"
    : dayOffForm.kind === "DAY_OFF_SELL"
      ? "Enviar venda de folga"
      : "Enviar solicitação de dia de folga";
  const shouldShowMonthlyAdvancePanel = monthlyAdvanceBlockedReason !== "TRAINING_STATUS";

  function moveMyScheduleMonth(delta: number) {
    setMySchedulePeriod((current) => {
      const next = operationalDateFromParts(current.year, current.month + delta, 1);
      return { month: next.getUTCMonth() + 1, year: next.getUTCFullYear() };
    });
  }

  return (
    <div>
      <PageHeader
        title="Meu Cronograma"
        description="Visualize seu cronograma, folgas e solicite alterações"
        icon={CalendarDays}
      />
      {dayOffMessage ? (
        <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{dayOffMessage}</div>
      ) : null}
      {additionalDataPending ? (
        <div className="mb-5 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-navy-950">Atualização cadastral pendente</p>
            <p className="mt-1 text-xs font-semibold text-amber-800">Complete seus Dados Cadastrais Adicionais.</p>
          </div>
          <a href="/meus-dados/adicionais" className="rounded-lg bg-amber-500 px-4 py-2 text-center text-xs font-extrabold text-white shadow-soft">Responder agora</a>
        </div>
      ) : null}
      <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_520px]">
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-5 py-4">
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => moveMyScheduleMonth(-1)} className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-white" aria-label="Mês anterior">‹</button>
              <h2 className="min-w-[140px] text-center text-xl font-extrabold capitalize text-navy-950">{monthLabel}</h2>
              <button type="button" onClick={() => moveMyScheduleMonth(1)} className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-white" aria-label="Próximo mês">›</button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <MetricPill value={hasSchedule && scheduleInfo ? `${scheduleInfo.schedule} - ${scheduleInfo.shift}` : "Sem cronograma"} label="Seu Cronograma" />
              <MetricPill value={hasSchedule && nextScheduleLabel ? nextScheduleLabel : "Sem próximo turno"} label="Próximo Turno" />
              <MetricPill value={hasSchedule && scheduleInfo ? scheduleInfo.lob : "Não vinculado"} label="Local" />
            </div>
          </div>
          {loadingMySchedule ? (
            <div className="border-b border-border p-8 text-center text-sm font-bold text-muted">Carregando cronograma deste mês...</div>
          ) : !hasSchedule ? (
            <div className="border-b border-border p-8"><EmptyState title="Nenhum cronograma encontrado para este mês." description="Você ainda pode navegar para outros meses normalmente." /></div>
          ) : null}
          <div className="grid grid-cols-7 border-b border-border bg-white text-center text-sm font-bold text-navy-950">
            {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((day) => (
              <div key={day} className="border-r border-border px-3 py-4 last:border-r-0">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 bg-white">
            {days.map((day, index) => {
              const isToday = day.dateIso === todayIso && !day.outside;
              const dateKey = day.outside ? "" : day.dateIso ?? dateInputFromParts(mySchedulePeriod.year, mySchedulePeriod.month, day.date);
              const workHour = dateKey ? workHourByDate.get(dateKey) : undefined;
              const dayLabel = cleanShiftName(day.label) || day.label;
              const dayShift = cleanShiftName(day.shift) || day.shift;
              const dayStatusForHours = statusFromScheduleCell(dayLabel);
              const dayAllowsWorkHours = canScheduleStatusReceiveWorkHours(dayStatusForHours, { status: dayStatusForHours, shiftName: dayShift });
              return (
                <div key={index} className={cn("min-h-[98px] border-r border-t border-border p-3 last:border-r-0", day.outside && "text-slate-300")}>
                  <div className={cn("mb-2 text-base font-bold", isToday && "grid h-8 w-8 place-items-center rounded-full bg-blue-600 text-white")}>{day.date}</div>
                  {!day.outside ? (
                    <div className="space-y-1.5">
                      <span className={cn("inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs font-semibold", shiftTagClass(dayLabel))}>
                        <span className={cn("status-dot", dayShift === "Manhã" ? "bg-emerald-500" : dayShift === "Tarde" ? "bg-orange-500" : dayShift === "Noite" ? "bg-violet-600" : "bg-violet-300")} />
                        {dayLabel}
                      </span>
                      <p className="rounded-md border border-slate-100 bg-slate-50 px-2 py-1 text-[11px] font-bold text-navy-900">Turno: {dayShift || "Sem turno"}</p>
                      {workHour ? (
                        <div className="rounded-md border border-blue-100 bg-white/80 px-2 py-1 text-[11px] font-bold text-navy-950">
                          <p>Planejado: {formatWorkHourValue(workHour.plannedHours || DEFAULT_PRODUCTIVE_HOURS)}</p>
                          <p>Realizado: {formatWorkHourValue(workHour.effectiveHours)}</p>
                          <p className={cn(workHour.differenceMinutes < 0 ? "text-red-600" : workHour.differenceMinutes > 0 ? "text-emerald-600" : "text-muted")}>{workHour.status} • {formatHourDifference(workHour.differenceMinutes)}</p>
                          {workHour.adjustmentStatus && workHour.adjustmentStatus !== "Sem ajuste" ? (
                            <p className="mt-1 rounded bg-amber-50 px-1.5 py-1 text-amber-800">Ajuste de horas {workHour.adjustmentStatus.toLowerCase()}</p>
                          ) : null}
                        </div>
                      ) : !dayAllowsWorkHours ? (
                        <p className="rounded-md border border-slate-100 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-muted">Sem horas</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-5 px-5 py-4 text-xs font-semibold text-muted">
            {Array.from(standardShiftNames).map((item, index) => (
              <span key={item} className="flex items-center gap-2">
                <span className={cn("status-dot", ["bg-emerald-500", "bg-orange-500", "bg-violet-600", "bg-violet-300"][index])} />
                {item}
              </span>
            ))}
          </div>
        </section>

        <div className="space-y-5">
          <Panel title="Humor Operacional">
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-muted">Como está seu humor hoje?</p>
                {todayMood ? (
                  <span
                    className={cn(
                      "mt-2 inline-grid h-8 w-8 place-items-center rounded-full border bg-white shadow-soft",
                      currentMoodOption.selected
                    )}
                    title={`Resposta atual: ${todayMood.moodLabel}`}
                    aria-label={`Resposta atual: ${todayMood.moodLabel}`}
                  >
                    <CurrentMoodIcon className="h-[18px] w-[18px]" aria-hidden="true" />
                  </span>
                ) : null}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {operationalMoodOptions.map((option) => {
                  const Icon = option.icon;
                  const selectedMood = moodForm.moodScore === option.score;
                  return (
                  <button
                    key={option.score}
                    type="button"
                    onClick={() => setMoodForm((current) => ({ ...current, moodScore: option.score }))}
                    title={option.label}
                    aria-label={option.label}
                    className={cn(
                      "group grid min-h-[82px] place-items-center rounded-2xl border bg-white transition hover:-translate-y-0.5 hover:border-blue-200 hover:bg-blue-50/50 focus:outline-none focus:ring-2 focus:ring-blue-100",
                      selectedMood ? option.selected : "border-border text-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-12 w-12 place-items-center rounded-full ring-1 transition",
                        selectedMood ? cn("bg-white/80", option.ring) : "bg-slate-50 ring-slate-100 group-hover:bg-white"
                      )}
                    >
                      <Icon className={cn("h-7 w-7", selectedMood ? "" : option.tone)} aria-hidden="true" />
                    </span>
                    <span className="sr-only">{option.label}</span>
                  </button>
                  );
                })}
              </div>
              <textarea
                value={moodForm.comment}
                onChange={(event) => setMoodForm((current) => ({ ...current, comment: event.target.value }))}
                className="min-h-20 w-full rounded-lg border border-border p-3 text-sm outline-none"
                placeholder="Comentário opcional"
              />
              <button
                type="button"
                disabled={savingMood}
                onClick={() => void submitMood()}
                className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-extrabold text-white disabled:opacity-50"
              >
                {savingMood ? "Salvando..." : todayMood ? "Atualizar humor" : "Registrar humor"}
              </button>
            </div>
          </Panel>
          {shouldShowMonthlyAdvancePanel ? (
            <Panel title="Adiantamento Mensal">
              {monthlyAdvanceCycles.length ? (
                <div className="grid gap-3">
                  {monthlyAdvanceCycles.map((cycle) => (
                    <div key={cycle.referenceMonth} className="rounded-lg border border-border bg-white p-3">
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-extrabold text-navy-950">{cycle.label}</p>
                          <p className="text-xs font-semibold text-muted">{cycle.monthLabel}</p>
                        </div>
                        <StatusBadge status={cycle.record?.optInLabel ?? (cycle.locked ? "Fechado" : "Pendente")} />
                      </div>
                      {cycle.record ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <InfoLine label="Aderente" value={cycle.record.optInLabel} />
                            <InfoLine label="Valor" value={currencyFormatter.format(cycle.record.amount)} />
                            <InfoLine label="Atualizado por" value={cycle.record.updatedBy ?? "Sistema"} />
                            <InfoLine label="Atualizado em" value={cycle.record.updatedAt} />
                          </div>
                          {cycle.closedMessage ? (
                            <p className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">{cycle.closedMessage}</p>
                          ) : null}
                          {cycle.canRequestChange ? (
                            <button
                              type="button"
                              disabled={savingMonthlyAdvance === cycle.referenceMonth}
                              onClick={() => requestMonthlyAdvanceChange(cycle)}
                              className="w-full rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-extrabold text-blue-700 disabled:opacity-50"
                            >
                              {savingMonthlyAdvance === cycle.referenceMonth ? "Enviando..." : "Solicitar alteração do adiantamento"}
                            </button>
                          ) : null}
                        </div>
                      ) : !cycle.canRespond ? (
                        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-muted">
                          <p>{cycle.closedMessage || cycle.deadlineMessage || "Este mês não está aberto para resposta direta."}</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {cycle.deadlineMessage ? (
                            <p className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-extrabold text-blue-700">{cycle.deadlineMessage}</p>
                          ) : null}
                          <p className="text-sm font-semibold text-muted">Deseja aderir ao adiantamento mensal para {cycle.monthLabel}?</p>
                          <p className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-extrabold text-blue-700">
                            Valor do adiantamento: {currencyFormatter.format(MONTHLY_ADVANCE_FIXED_AMOUNT)}
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              disabled={savingMonthlyAdvance === cycle.referenceMonth}
                              onClick={() => respondMonthlyAdvance(cycle.referenceMonth, true)}
                              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-extrabold text-white disabled:opacity-50"
                            >
                              Sim
                            </button>
                            <button
                              type="button"
                              disabled={savingMonthlyAdvance === cycle.referenceMonth}
                              onClick={() => respondMonthlyAdvance(cycle.referenceMonth, false)}
                              className="rounded-lg border border-border bg-white px-3 py-2 text-sm font-extrabold text-navy-950 disabled:opacity-50"
                            >
                              Não
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="Adiantamento mensal indisponível" description={monthlyAdvanceNotice || "Não foi possível carregar os ciclos de resposta agora."} />
              )}
            </Panel>
          ) : null}
          <Panel title="Minhas Solicitações" action="Solicitar Folga" actionOnClick={openDayOffRequestModal}>
            <div className="mb-3 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => openShiftChangeRequest()}
                className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-extrabold text-blue-700"
              >
                Solicitar troca de turno
              </button>
            </div>
            <div className="mb-4 grid gap-2 md:grid-cols-2">
              <select value={requestFilters.status} onChange={(event) => setRequestFilters({ ...requestFilters, status: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
                {["Todos", ...requestStatuses].map((status) => <option key={status}>{status}</option>)}
              </select>
              <select value={requestFilters.type} onChange={(event) => setRequestFilters({ ...requestFilters, type: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
                {["Todos", ...requestTypes].map((type) => <option key={type}>{type}</option>)}
              </select>
              <select value={requestFilters.priority} onChange={(event) => setRequestFilters({ ...requestFilters, priority: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
                {["Todos", ...requestPriorities].map((priority) => <option key={priority}>{priority}</option>)}
              </select>
              <input value={requestFilters.query} onChange={(event) => setRequestFilters({ ...requestFilters, query: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Buscar solicitação" />
            </div>
            {filteredRequests.length ? (
              <div className="space-y-3">
                {filteredRequests.slice(0, 6).map((request) => {
                  const Icon = getRequestIcon(request.type);
                  return (
                    <button key={request.id} onClick={() => setSelectedRequest(request)} className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition hover:bg-blue-50/40">
                      <div className="grid h-11 w-11 place-items-center rounded-xl bg-amber-50 text-amber-500">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-navy-950">{request.title || request.type}</p>
                        <p className="text-xs text-muted">{request.id} • {primaryDayOffDate(request)} • Atualizada em {request.updatedAt ?? request.time}</p>
                      </div>
                      <StatusBadge status={request.status} />
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="Você ainda não possui solicitações" description="Quando você abrir uma solicitação, ela aparecerá aqui para acompanhamento." />
            )}
          </Panel>
          <Panel title="Resumo de Horas">
            {myWorkHours.length && myWorkHourSummary ? (
              <div className="grid gap-3">
                <MetricPill value={formatWorkHourValue(myWorkHourSummary.plannedHours, "0:00")} label="Horas produtivas previstas" />
                <MetricPill value={formatWorkHourValue(myWorkHourSummary.actualHours, "0:00")} label="Horas realizadas" />
                <MetricPill value={formatWorkHourSummaryDifference(myWorkHourSummary.differenceHours)} label="Diferença" />
                <MetricPill value={formatWorkHourValue(myWorkHourSummary.adjustedHours, "0:00")} label="Horas ajustadas" />
                <MetricPill value={myWorkHourSummary.pendingAdjustments} label="Ajustes pendentes" />
                <MetricPill value={myWorkHourSummary.divergentRecords} label="Dias com divergência" />
                <MetricPill value={myWorkHourSummary.noScheduleRecords} label="Dias sem cronograma vinculado" />
              </div>
            ) : (
              <EmptyState title="Horas ainda não importadas" description="Horas ainda não importadas para este período." />
            )}
          </Panel>
        </div>
      </div>
      <div className="grid gap-5">
        <Panel title="Status das Solicitações">
          <div className="grid grid-cols-2 divide-x divide-y divide-border rounded-lg border border-border md:grid-cols-6 md:divide-y-0">
            <MetricPill value={requestSummary.total} label="Total" />
            <MetricPill value={requestSummary.open} label="Abertas" />
            <MetricPill value={requestSummary.analysis} label="Em análise" />
            <MetricPill value={requestSummary.approved} label="Aprovadas" />
            <MetricPill value={requestSummary.refused} label="Recusadas" />
            <MetricPill value={requestSummary.done} label="Concluídas" />
          </div>
        </Panel>
      </div>
      {showDayOffModal ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[88vh] w-full max-w-3xl overflow-y-auto p-5">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Solicitar Folga</h2>
                <p className="text-sm text-muted">Qual tipo de solicitação de folga você deseja abrir?</p>
              </div>
              <button type="button" onClick={() => setShowDayOffModal(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            {dayOffMessage ? (
              <div role="alert" className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{dayOffMessage}</div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-3">
              {dayOffOptions.map((option) => (
                <button type="button" key={option.kind} onClick={() => selectDayOffKind(option.kind)} className={cn("rounded-lg border p-4 text-left transition", dayOffForm.kind === option.kind ? "border-blue-500 bg-blue-50 text-blue-700" : "border-border bg-white text-navy-950 hover:bg-slate-50")}>
                  <p className="font-extrabold">{option.title}</p>
                  <p className="mt-1 text-xs text-muted">{option.description}</p>
                </button>
              ))}
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {dayOffForm.kind === "DAY_OFF_SWAP" ? (
                <>
                  <FormInput label="Data atual da folga" type="date" value={dayOffForm.currentDayOffDate} onChange={(value) => setDayOffForm({ ...dayOffForm, currentDayOffDate: value })} />
                  <FormInput label="Nova data desejada" type="date" value={dayOffForm.desiredDayOffDate} onChange={(value) => setDayOffForm({ ...dayOffForm, desiredDayOffDate: value })} />
                </>
              ) : null}
              {dayOffForm.kind === "DAY_OFF_SELL" ? (
                <>
                  <FormInput label="Data da folga que deseja vender" type="date" value={dayOffForm.dayOffToSellDate} onChange={(value) => setDayOffForm({ ...dayOffForm, dayOffToSellDate: value })} helper="Pode ser Folga, Folga aprovada ou Troca aprovada." />
                  <FormSelect label="Turno desejado" value={dayOffForm.availabilityShift} options={Array.from(standardShiftNames)} onChange={(value) => setDayOffForm({ ...dayOffForm, availabilityShift: value })} />
                  <FormInput label="Horário preferencial de entrada" value={dayOffForm.preferredStartTime} onChange={(value) => setDayOffForm({ ...dayOffForm, preferredStartTime: value })} />
                  <FormInput label="Horário preferencial de saída" value={dayOffForm.preferredEndTime} onChange={(value) => setDayOffForm({ ...dayOffForm, preferredEndTime: value })} />
                  <label className="md:col-span-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-700">
                    <input type="checkbox" checked={dayOffForm.acknowledgement} onChange={(event) => setDayOffForm({ ...dayOffForm, acknowledgement: event.target.checked })} />
                    Estou ciente de que a venda de folga depende de aprovação da operação/WFM.
                  </label>
                </>
              ) : null}
              {dayOffForm.kind === "DAY_OFF_REQUEST" ? (
                <>
                  <FormInput label="Data desejada para folga" type="date" value={dayOffForm.desiredDayOffRequestDate} onChange={(value) => setDayOffForm({ ...dayOffForm, desiredDayOffRequestDate: value })} />
                  <FormSelect label="Motivo" value={dayOffForm.dayOffReason} options={["Pessoal", "Saúde", "Familiar", "Compromisso externo", "Estudos", "Emergência", "Outro"]} onChange={(value) => setDayOffForm({ ...dayOffForm, dayOffReason: value })} />
                  <FormSelect label="Urgência" value={dayOffForm.urgency} options={requestPriorities} onChange={(value) => setDayOffForm({ ...dayOffForm, urgency: value as ClientRequest["priority"] })} />
                  <FormInput label="Anexo/evidência opcional" value={dayOffForm.attachmentUrl} onChange={(value) => setDayOffForm({ ...dayOffForm, attachmentUrl: value })} />
                </>
              ) : null}
              <label className="md:col-span-2">
                <span className="mb-1.5 block text-sm font-bold text-muted">Justificativa</span>
                <textarea value={dayOffForm.justification} onChange={(event) => setDayOffForm({ ...dayOffForm, justification: event.target.value })} className="min-h-28 w-full rounded-lg border border-border p-3 outline-none" placeholder="Explique o motivo da solicitação" />
              </label>
            </div>
            <div className="mt-5 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
              Toda solicitação depende de aprovação e será registrada com histórico, auditoria e notificação interna.
            </div>
            <button type="button" disabled={savingDayOff} onClick={() => void submitDayOffRequest()} className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
              {savingDayOff ? "Enviando..." : dayOffSubmitLabel}
            </button>
          </div>
        </div>
      ) : null}
      {showShiftChangeModal ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[88vh] w-full max-w-xl overflow-y-auto p-5">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Solicitar troca de turno</h2>
                <p className="text-sm text-muted">A troca segue aprovação do Supervisor e análise final do WFM.</p>
              </div>
              <button onClick={() => setShowShiftChangeModal(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormSelect
                label="Tipo de troca"
                value={shiftChangeForm.changeType}
                options={["Temporária", "Fixa"]}
                onChange={(value) => setShiftChangeForm((current) => ({ ...current, changeType: value as "Fixa" | "Temporária" }))}
              />
              <FormInput
                label={shiftChangeForm.changeType === "Fixa" ? "Início da vigência" : "Data inicial"}
                type="date"
                value={shiftChangeForm.startDate}
                onChange={(value) => setShiftChangeForm((current) => ({ ...current, date: value, startDate: value, currentShift: shiftForScheduleDate(value) }))}
              />
              {shiftChangeForm.changeType === "Temporária" ? (
                <FormInput
                  label="Data final"
                  type="date"
                  value={shiftChangeForm.endDate}
                  onChange={(value) => setShiftChangeForm((current) => ({ ...current, endDate: value }))}
                />
              ) : null}
              <FormInput label="Turno atual" value={shiftChangeForm.currentShift || "Sem turno"} disabled onChange={() => undefined} />
              <FormSelect
                label="Novo turno solicitado"
                value={shiftChangeForm.desiredShift}
                options={shiftChangeOptions}
                onChange={(value) => setShiftChangeForm((current) => ({ ...current, desiredShift: value }))}
              />
              <FormInput
                label="Observação opcional"
                value={shiftChangeForm.observation}
                onChange={(value) => setShiftChangeForm((current) => ({ ...current, observation: value }))}
              />
              <label className="md:col-span-2">
                <span className="mb-1.5 block text-sm font-bold text-muted">Motivo</span>
                <textarea
                  value={shiftChangeForm.reason}
                  onChange={(event) => setShiftChangeForm((current) => ({ ...current, reason: event.target.value }))}
                  className="min-h-28 w-full rounded-lg border border-border p-3 outline-none"
                  placeholder="Explique o motivo da troca de turno"
                />
              </label>
            </div>
            <button disabled={savingShiftChange} onClick={submitShiftChangeRequest} className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
              {savingShiftChange ? "Enviando..." : "Enviar solicitação de troca de turno"}
            </button>
          </div>
        </div>
      ) : null}
      {selectedRequest ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[88vh] w-full max-w-3xl overflow-y-auto p-5">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-navy-950">Detalhe da Solicitação</h2>
              <button onClick={() => setSelectedRequest(null)} className="text-2xl text-muted">×</button>
            </div>
            <RequestDetailContent selected={selectedRequest} actorRole={actorRole} actionReason={actionReason} setActionReason={setActionReason} comment={comment} setComment={setComment} onMove={moveMyRequest} onComment={submitMyComment} actionPending={actionPending} />
          </div>
        </div>
      ) : null}
      <CoverageWarningDialog warning={coverageWarning} onClose={() => setCoverageWarning(null)} />
    </div>
  );
}


function emptyCalendarDays(month = currentOperationalMonth().month, year = currentOperationalMonth().year) {
  const first = operationalDateFromParts(year, month, 1);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const leading = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }).map((_, index) => {
    const dayNumber = index - leading + 1;
    const outside = dayNumber < 1 || dayNumber > daysInMonth;
    const actualDate = operationalDateFromParts(year, month, dayNumber);
    return {
      date: actualDate.getUTCDate(),
      outside,
      dateIso: outside ? undefined : dateInputFromParts(year, month, actualDate.getUTCDate()),
      shift: "Sem turno",
      label: "Sem cronograma"
    };
  });
}
