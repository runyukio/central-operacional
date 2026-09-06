"use client";

import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, ClipboardList, KanbanSquare, Plus, RefreshCw, Search, UsersRound, XCircle } from "lucide-react";
import { TopActions } from "@/components/layout/app-shell";
import { EmptyState, PageHeader, Panel, PriorityBadge, SimpleTable, StatCard, StatusBadge } from "@/components/ui/primitives";
import { cn, initials } from "@/lib/utils";
import { standardShiftNames } from "@/lib/shift-display";
import { ClientRequest, CoverageImpactBadge, CoverageWarningDialog, CoverageWarningDialogState, DayOffKind, FormInput, FormSelect, RequestDetailContent, apiJson, coverageImpactFromError, dayOffKindFromRequest, dayOffKindLabels, getRequestIcon, offsetOperationalDateInput, queryParam, requestPriorities, requestStatuses, requestTypes } from './shared';
type RequestListResponse = {
  data: ClientRequest[];
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
  summary?: {
    total: number;
    byStatus: Record<string, number>;
  };
  supervisors?: Array<{ id: string; name: string; wbLogin: string; email?: string }>;
  actor?: { role: string; name?: string };
};

const requestColumns = ["Aberto", "Em análise", "Aprovado", "Recusado", "Concluído", "Cancelado"];


function isDayOffRequest(type: string) {
  return /troca de folga|venda de folga|solicita(ç|c)[aã]o de (dia de )?folga|dia de folga|folga solicitada|pedido de folga/i.test(type);
}


const defaultPipelineFilters = {
  employeeId: queryParam("employeeId"),
  search: "",
  status: "Todos",
  type: "Todos",
  startDate: queryParam("startDate"),
  endDate: queryParam("endDate"),
  lob: "Todos",
  supervisorId: "Todos",
  collaborator: "",
  wbLogin: "",
  requester: "",
  priority: "Todos",
  assignedTo: "Todos",
  pendingAction: "false",
  limit: "50"
};


function requestedDateLabel(request: ClientRequest) {
  const payload = request.payload ?? {};
  return String(
    payload.desiredDayOffRequestDate ??
      payload.desiredDayOffDate ??
      payload.requestedDate ??
      payload.dayOffToSellDate ??
      "-"
  );
}


function paginationRange(page: number, limit: number, total: number) {
  if (!total) return "Exibindo 0 de 0 solicitações";
  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);
  return `Exibindo ${start}-${end} de ${total} solicitações`;
}


function createDefaultRequestDraft() {
  return {
    type: "Troca de Folga",
    title: "Troca de Folga",
    priority: "Média",
    requestedDate: "",
    dayOffKind: "DAY_OFF_SWAP" as DayOffKind,
    currentDayOffDate: offsetOperationalDateInput(1),
    desiredDayOffDate: offsetOperationalDateInput(4),
    dayOffToSellDate: offsetOperationalDateInput(1),
    availabilityShift: "Manhã",
    preferredStartTime: "",
    preferredEndTime: "",
    acknowledgement: false,
    desiredDayOffRequestDate: offsetOperationalDateInput(5),
    dayOffReason: "Pessoal",
    urgency: "Média",
    justification: "",
    description: "",
    attachmentUrl: ""
  };
}


type RequestDraft = ReturnType<typeof createDefaultRequestDraft>;


function validateRequestDraft(draft: RequestDraft) {
  const dayOffKind = isDayOffRequest(draft.type) ? draft.dayOffKind : null;
  if (!dayOffKind) return "";
  if (!draft.justification.trim()) return "Informe a justificativa da solicitação de folga.";
  if (dayOffKind === "DAY_OFF_SWAP") {
    if (!draft.currentDayOffDate || !draft.desiredDayOffDate) return "Para troca de folga, informe data atual e nova data desejada.";
    if (draft.currentDayOffDate === draft.desiredDayOffDate) return "A nova data não pode ser igual à data atual da folga.";
  }
  if (dayOffKind === "DAY_OFF_SELL") {
    if (!draft.dayOffToSellDate) return "Informe a data da folga que deseja vender.";
    if (!draft.availabilityShift && (!draft.preferredStartTime || !draft.preferredEndTime)) return "Informe o turno desejado ou a disponibilidade de horário.";
    if (!draft.acknowledgement) return "Confirme a ciência de que a venda depende de aprovação.";
  }
  if (dayOffKind === "DAY_OFF_REQUEST" && (!draft.desiredDayOffRequestDate || !draft.dayOffReason)) return "Informe a data desejada e o motivo da folga.";
  return "";
}


async function createRequestFromDraft(draft: RequestDraft) {
  const dayOffKind = isDayOffRequest(draft.type) ? draft.dayOffKind : null;
  return apiJson<{ data: ClientRequest }>("/api/requests", {
    method: "POST",
    body: JSON.stringify({
      type: draft.type,
      title: draft.title || draft.type,
      priority: dayOffKind === "DAY_OFF_REQUEST" ? draft.urgency : draft.priority,
      description: draft.description || draft.justification || "Solicitação criada pelo portal operacional.",
      requestedDate: draft.requestedDate || undefined,
      dayOffKind: dayOffKind ?? undefined,
      currentDayOffDate: dayOffKind === "DAY_OFF_SWAP" ? draft.currentDayOffDate : undefined,
      desiredDayOffDate: dayOffKind === "DAY_OFF_SWAP" ? draft.desiredDayOffDate : undefined,
      dayOffToSellDate: dayOffKind === "DAY_OFF_SELL" ? draft.dayOffToSellDate : undefined,
      availabilityShift: dayOffKind === "DAY_OFF_SELL" ? draft.availabilityShift : undefined,
      preferredStartTime: dayOffKind === "DAY_OFF_SELL" ? draft.preferredStartTime : undefined,
      preferredEndTime: dayOffKind === "DAY_OFF_SELL" ? draft.preferredEndTime : undefined,
      acknowledgement: dayOffKind === "DAY_OFF_SELL" ? draft.acknowledgement : undefined,
      desiredDayOffRequestDate: dayOffKind === "DAY_OFF_REQUEST" ? draft.desiredDayOffRequestDate : undefined,
      dayOffReason: dayOffKind === "DAY_OFF_REQUEST" ? draft.dayOffReason : undefined,
      urgency: dayOffKind === "DAY_OFF_REQUEST" ? draft.urgency : undefined,
      justification: draft.justification || undefined,
      attachmentUrl: draft.attachmentUrl || undefined
    })
  });
}


function RequestCreateModal({
  draft,
  setDraft,
  onClose,
  onSubmit
}: {
  draft: RequestDraft;
  setDraft: Dispatch<SetStateAction<RequestDraft>>;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
      <div className="card max-h-[88vh] w-full max-w-xl overflow-y-auto p-5">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-navy-950">Nova solicitação</h2>
          <button onClick={onClose} className="text-2xl text-muted">×</button>
        </div>
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-muted">Tipo</span>
            <select
              value={draft.type}
              onChange={(event) => {
                const type = event.target.value;
                const dayOffKind = dayOffKindFromRequest({ type });
                setDraft((current) => ({ ...current, type, title: type, dayOffKind: dayOffKind ?? current.dayOffKind }));
              }}
              className="h-11 w-full rounded-lg border border-border px-3 outline-none"
            >
              {requestTypes.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-muted">Título</span>
            <input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} className="h-11 w-full rounded-lg border border-border px-3 outline-none" placeholder="Resumo da solicitação" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-muted">Prioridade</span>
            <select value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value }))} className="h-11 w-full rounded-lg border border-border px-3 outline-none">
              {requestPriorities.map((priority) => (
                <option key={priority}>{priority}</option>
              ))}
            </select>
          </label>
          {isDayOffRequest(draft.type) ? (
            <div className="grid gap-3 md:grid-cols-2">
              {draft.dayOffKind === "DAY_OFF_SWAP" ? (
                <>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-semibold text-muted">Data atual da folga</span>
                    <input type="date" value={draft.currentDayOffDate} onChange={(event) => setDraft((current) => ({ ...current, currentDayOffDate: event.target.value }))} className="h-11 w-full rounded-lg border border-border px-3 outline-none" />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-semibold text-muted">Nova data desejada</span>
                    <input type="date" value={draft.desiredDayOffDate} onChange={(event) => setDraft((current) => ({ ...current, desiredDayOffDate: event.target.value }))} className="h-11 w-full rounded-lg border border-border px-3 outline-none" />
                  </label>
                </>
              ) : null}
              {draft.dayOffKind === "DAY_OFF_SELL" ? (
                <>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-semibold text-muted">Data da folga que deseja vender</span>
                    <input type="date" value={draft.dayOffToSellDate} onChange={(event) => setDraft((current) => ({ ...current, dayOffToSellDate: event.target.value }))} className="h-11 w-full rounded-lg border border-border px-3 outline-none" />
                  </label>
                  <FormSelect label="Turno desejado" value={draft.availabilityShift} options={Array.from(standardShiftNames)} onChange={(value) => setDraft((current) => ({ ...current, availabilityShift: value }))} />
                  <FormInput label="Entrada preferencial" value={draft.preferredStartTime} onChange={(value) => setDraft((current) => ({ ...current, preferredStartTime: value }))} />
                  <FormInput label="Saída preferencial" value={draft.preferredEndTime} onChange={(value) => setDraft((current) => ({ ...current, preferredEndTime: value }))} />
                  <label className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-700 md:col-span-2">
                    <input type="checkbox" checked={draft.acknowledgement} onChange={(event) => setDraft((current) => ({ ...current, acknowledgement: event.target.checked }))} />
                    Estou ciente de que a venda de folga depende de aprovação da operação/WFM.
                  </label>
                </>
              ) : null}
              {draft.dayOffKind === "DAY_OFF_REQUEST" ? (
                <>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-semibold text-muted">Data desejada para folga</span>
                    <input type="date" value={draft.desiredDayOffRequestDate} onChange={(event) => setDraft((current) => ({ ...current, desiredDayOffRequestDate: event.target.value }))} className="h-11 w-full rounded-lg border border-border px-3 outline-none" />
                  </label>
                  <FormSelect label="Motivo" value={draft.dayOffReason} options={["Pessoal", "Saúde", "Familiar", "Compromisso externo", "Estudos", "Emergência", "Outro"]} onChange={(value) => setDraft((current) => ({ ...current, dayOffReason: value }))} />
                  <FormSelect label="Urgência" value={draft.urgency} options={requestPriorities} onChange={(value) => setDraft((current) => ({ ...current, urgency: value }))} />
                </>
              ) : null}
            </div>
          ) : (
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-muted">Data desejada</span>
              <input type="date" value={draft.requestedDate} onChange={(event) => setDraft((current) => ({ ...current, requestedDate: event.target.value }))} className="h-11 w-full rounded-lg border border-border px-3 outline-none" />
            </label>
          )}
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-muted">Justificativa</span>
            <textarea value={draft.justification} onChange={(event) => setDraft((current) => ({ ...current, justification: event.target.value }))} className="min-h-24 w-full rounded-lg border border-border p-3 outline-none" placeholder="Explique o motivo da solicitação" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-muted">Descrição</span>
            <textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} className="min-h-24 w-full rounded-lg border border-border p-3 outline-none" placeholder="Detalhes adicionais" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-muted">Anexo opcional</span>
            <input value={draft.attachmentUrl} onChange={(event) => setDraft((current) => ({ ...current, attachmentUrl: event.target.value }))} className="h-11 w-full rounded-lg border border-border px-3 outline-none" placeholder="URL ou caminho do anexo" />
          </label>
          <button onClick={onSubmit} className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white">
            Criar solicitação
          </button>
        </div>
      </div>
    </div>
  );
}


export function RequestsKanbanPage() {
  const [requests, setRequests] = useState<ClientRequest[]>([]);
  const [selected, setSelected] = useState<ClientRequest | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [actorRole, setActorRole] = useState("ADMIN");
  const [actionMessage, setActionMessage] = useState("");
  const [actionReason, setActionReason] = useState("");
  const [comment, setComment] = useState("");
  const [actionPending, setActionPending] = useState("");
  const [coverageWarning, setCoverageWarning] = useState<CoverageWarningDialogState | null>(null);
  const [filters, setFilters] = useState(defaultPipelineFilters);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 50, totalPages: 1 });
  const [summary, setSummary] = useState<RequestListResponse["summary"]>({ total: 0, byStatus: {} });
  const [supervisors, setSupervisors] = useState<RequestListResponse["supervisors"]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "kanban">("table");
  const [loadError, setLoadError] = useState("");
  const [newRequest, setNewRequest] = useState(createDefaultRequestDraft);
  const initialDeepLinkHandled = useRef(false);
  const countByStatus = (status: string) => summary?.byStatus?.[status] ?? requests.filter((request) => request.status === status).length;

  useEffect(() => {
    setSelected(null);
    setDetailLoading(false);
    void loadKanbanRequests(defaultPipelineFilters, 1);
    const params = new URLSearchParams(window.location.search);
    const explicitRequestId = params.get("requestId") ?? params.get("request") ?? params.get("id") ?? params.get("taskId");
    if (explicitRequestId && !initialDeepLinkHandled.current) {
      initialDeepLinkHandled.current = true;
      void openRequestDetail({ id: explicitRequestId } as ClientRequest);
    }
    return () => {
      setSelected(null);
      setDetailLoading(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buildPipelineParams(nextFilters = filters, nextPage = pagination.page) {
    const params = new URLSearchParams();
    params.set("page", String(nextPage));
    params.set("limit", nextFilters.limit);
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (!value || value === "Todos" || value === "false") return;
      params.set(key, value);
    });
    return params;
  }

  async function loadKanbanRequests(nextFilters = filters, nextPage = pagination.page) {
    setLoading(true);
    setLoadError("");
    try {
      const payload = await apiJson<RequestListResponse>(`/api/requests?${buildPipelineParams(nextFilters, nextPage).toString()}`);
      const page = payload.page ?? nextPage;
      const limit = payload.limit ?? Number(nextFilters.limit);
      setRequests(payload.data);
      setActorRole(payload.actor?.role ?? "ADMIN");
      setPagination({
        total: payload.total ?? payload.data.length,
        page,
        limit,
        totalPages: payload.totalPages ?? 1
      });
      setSummary(payload.summary ?? { total: payload.total ?? payload.data.length, byStatus: {} });
      setSupervisors(payload.supervisors ?? []);
    } catch (error) {
      setRequests([]);
      setPagination({ total: 0, page: 1, limit: Number(nextFilters.limit), totalPages: 1 });
      setLoadError(error instanceof Error ? error.message : "Não foi possível carregar a esteira.");
    } finally {
      setLoading(false);
    }
  }

  function applyFilters(nextFilters = filters) {
    setFilters(nextFilters);
    void loadKanbanRequests(nextFilters, 1);
  }

  function clearFilters() {
    setFilters(defaultPipelineFilters);
    void loadKanbanRequests(defaultPipelineFilters, 1);
  }

  function goToPage(nextPage: number) {
    const safePage = Math.min(Math.max(nextPage, 1), pagination.totalPages);
    void loadKanbanRequests(filters, safePage);
  }

  async function openRequestDetail(request: ClientRequest) {
    setSelected(request);
    setDetailLoading(true);
    try {
      const payload = await apiJson<{ data: ClientRequest; actor?: { role: string } }>(`/api/requests?id=${encodeURIComponent(request.id)}`);
      setSelected(payload.data);
      setActorRole(payload.actor?.role ?? actorRole);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Não foi possível carregar o detalhe da solicitação.");
    } finally {
      setDetailLoading(false);
    }
  }

  function closeRequestDetail() {
    setSelected(null);
    setDetailLoading(false);
    setActionReason("");
    setComment("");
    const url = new URL(window.location.href);
    let changed = false;
    ["requestId", "request", "id", "taskId"].forEach((key) => {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    });
    if (changed) {
      const nextUrl = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState({}, "", nextUrl);
    }
  }

  async function submitRequest() {
    const validationMessage = validateRequestDraft(newRequest);
    if (validationMessage) {
      setActionMessage(validationMessage);
      return;
    }

    try {
      const payload = await createRequestFromDraft(newRequest);
      setShowCreate(false);
      setNewRequest(createDefaultRequestDraft());
      setActionMessage(`Solicitação ${payload.data.id} criada com sucesso e enviada para a esteira.`);
      void loadKanbanRequests(filters, 1);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Não foi possível criar a solicitação.");
    }
  }

  async function moveStatus(id: string, status: string, actionInput?: Record<string, string>) {
    if (actionPending) return;
    const reason = actionReason.trim();
    if (status === "Recusado" && !reason) {
      setActionMessage("Informe o motivo da recusa.");
      return;
    }

    setActionPending(`${id}:${status}`);
    const previousStatus = requests.find((request) => request.id === id)?.status;
    const patchStatus = (confirmed = false) => apiJson<{ data: ClientRequest; scheduleUpdated: boolean }>("/api/requests/status", {
      method: "PATCH",
      body: JSON.stringify({
        id,
        status,
        reason: reason || `Movido para ${status} pela esteira.`,
        actionInput: { ...(actionInput ?? {}), ...(confirmed ? { confirmCoverageWarning: "true" } : {}) }
      })
    });
    const applyPayload = (payload: { data: ClientRequest; scheduleUpdated: boolean }) => {
      setRequests((items) => items.map((request) => (request.id === id ? payload.data : request)));
      setSelected(payload.data);
      if (previousStatus && previousStatus !== payload.data.status) {
        setSummary((current) => {
          const base = current ?? { total: pagination.total, byStatus: {} };
          return {
            ...base,
            byStatus: {
              ...base.byStatus,
              [previousStatus]: Math.max(0, (base.byStatus?.[previousStatus] ?? 0) - 1),
              [payload.data.status]: (base.byStatus?.[payload.data.status] ?? 0) + 1
            }
          };
        });
      }
      setActionReason("");
      setActionMessage(payload.scheduleUpdated ? "Solicitação aprovada e cronograma atualizado." : payload.data.status === "Em análise" ? "Solicitação enviada para análise do WFM." : `Solicitação ${payload.data.id} atualizada para ${payload.data.status}.`);
    };
    try {
      applyPayload(await patchStatus());
    } catch (error) {
      const impact = coverageImpactFromError(error);
      if (impact) {
        setCoverageWarning({
          impact,
          onConfirm: async () => {
            setActionPending(`${id}:${status}`);
            try {
              applyPayload(await patchStatus(true));
              setCoverageWarning(null);
            } catch (retryError) {
              setActionMessage(retryError instanceof Error ? retryError.message : "Não foi possível atualizar a solicitação.");
              setCoverageWarning(null);
            } finally {
              setActionPending("");
            }
          }
        });
        return;
      }
      setActionMessage(error instanceof Error ? error.message : "Não foi possível atualizar a solicitação.");
    } finally {
      setActionPending("");
    }
  }

  async function submitComment(id: string) {
    if (!comment.trim()) {
      setActionMessage("Digite um comentário antes de enviar.");
      return;
    }

    try {
      const payload = await apiJson<{ data: ClientRequest }>("/api/requests/comments", {
        method: "POST",
        body: JSON.stringify({ id, body: comment })
      });
      setRequests((items) => items.map((request) => (request.id === id ? payload.data : request)));
      setSelected(payload.data);
      setComment("");
      setActionMessage("Comentário registrado.");
      void loadKanbanRequests(filters, pagination.page);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Não foi possível comentar.");
    }
  }

  return (
    <div>
      <PageHeader
        title="Esteiras de Solicitações"
        description="Acompanhe e gerencie as solicitações do time em todas as etapas do processo."
        icon={KanbanSquare}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setShowCreate(true)} className="flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-bold text-white">
              <Plus className="h-4 w-4" />
              Nova solicitação
            </button>
            <button onClick={() => setViewMode("table")} className={cn("h-10 rounded-lg border px-3 text-sm font-bold", viewMode === "table" ? "border-blue-600 bg-blue-600 text-white" : "border-border bg-white text-navy-950")}>Tabela</button>
            <button onClick={() => setViewMode("kanban")} className={cn("h-10 rounded-lg border px-3 text-sm font-bold", viewMode === "kanban" ? "border-blue-600 bg-blue-600 text-white" : "border-border bg-white text-navy-950")}>Kanban</button>
            <button onClick={() => loadKanbanRequests(filters, pagination.page)} className="flex h-10 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-bold text-navy-950">
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              Atualizar
            </button>
            <TopActions />
          </div>
        }
      />
      <div className="card mb-5 space-y-4 p-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <label className="relative block xl:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" />
            <input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} className="h-10 w-full rounded-lg border border-border pl-9 pr-3 text-sm outline-none" placeholder="Buscar por parceiro, WB/Login, tipo ou ID" />
          </label>
          <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
            {["Todos", ...requestStatuses].map((status) => <option key={status}>{status}</option>)}
          </select>
          <select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
            {["Todos", ...requestTypes].map((type) => <option key={type}>{type}</option>)}
          </select>
          <select value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
            {["Todos", ...requestPriorities].map((priority) => <option key={priority}>{priority}</option>)}
          </select>
          <select value={filters.pendingAction} onChange={(event) => setFilters({ ...filters, pendingAction: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
            <option value="false">Todas as etapas</option>
            <option value="true">Pendentes da minha ação</option>
          </select>
          <input type="date" value={filters.startDate} onChange={(event) => setFilters({ ...filters, startDate: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" aria-label="Data inicial" />
          <input type="date" value={filters.endDate} onChange={(event) => setFilters({ ...filters, endDate: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" aria-label="Data final" />
          <select value={filters.lob} onChange={(event) => setFilters({ ...filters, lob: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
            {["Todos", "ALL", "CEC", "TNS", "ADS"].map((lob) => <option key={lob}>{lob}</option>)}
          </select>
          <select value={filters.supervisorId} onChange={(event) => setFilters({ ...filters, supervisorId: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
            <option value="Todos">Todos os supervisores</option>
            <option value="SEM_SUPERVISOR">Sem supervisor</option>
            {(supervisors ?? []).map((supervisor) => (
              <option key={supervisor.id} value={supervisor.id}>{supervisor.name} - {supervisor.wbLogin}</option>
            ))}
          </select>
          <input value={filters.collaborator} onChange={(event) => setFilters({ ...filters, collaborator: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Parceiro" />
          <input value={filters.wbLogin} onChange={(event) => setFilters({ ...filters, wbLogin: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="WB/Login" />
          <input value={filters.requester} onChange={(event) => setFilters({ ...filters, requester: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Solicitante" />
          <select value={filters.assignedTo} onChange={(event) => setFilters({ ...filters, assignedTo: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
            {["Todos", "Supervisor", "WFM", "WFM/Admin", "Nenhum"].map((owner) => <option key={owner}>{owner}</option>)}
          </select>
          <select value={filters.limit} onChange={(event) => applyFilters({ ...filters, limit: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
            {["25", "50", "100"].map((limit) => <option key={limit} value={limit}>{limit} por página</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-muted">{paginationRange(pagination.page, pagination.limit, pagination.total)}</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => applyFilters()} className="h-10 rounded-lg bg-navy-950 px-4 text-sm font-extrabold text-white">Aplicar filtros</button>
            <button onClick={clearFilters} className="h-10 rounded-lg border border-border bg-white px-4 text-sm font-bold text-navy-950">Limpar filtros</button>
          </div>
        </div>
      </div>
      {actionMessage ? <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{actionMessage}</div> : null}
      {loadError ? <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">Não foi possível carregar a esteira.</div> : null}
      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {[
          ["Total de Solicitações", summary?.total ?? pagination.total, UsersRound, "blue"],
          ["Abertas", countByStatus("Aberto"), ClipboardList, "blue"],
          ["Em análise", countByStatus("Em análise"), Clock, "orange"],
          ["Aprovadas", countByStatus("Aprovado"), CheckCircle2, "green"],
          ["Recusadas", countByStatus("Recusado"), XCircle, "red"],
          ["Concluídas", countByStatus("Concluído"), ClipboardList, "cyan"]
        ].map(([title, value, Icon, tone]) => (
          <StatCard key={String(title)} title={String(title)} value={String(value)} helper="Filtros atuais" icon={Icon as never} tone={tone as never} />
        ))}
      </div>
      {loading ? <div className="mb-5 rounded-lg border border-border bg-white p-4 text-sm font-bold text-muted">Carregando solicitações...</div> : null}
      {!loading && !requests.length ? <div className="mb-5"><EmptyState title="Nenhuma solicitação encontrada para os filtros selecionados." description="Ajuste os filtros ou limpe a busca para visualizar a esteira." /></div> : null}
      {viewMode === "table" ? (
        <Panel title="Visão Tabela">
          <SimpleTable
            columns={["ID", "Criação", "Tipo", "Status", "Impacto", "Parceiro", "WB/Login", "LOB", "Supervisor", "Data solicitada", "Prioridade", "Próxima etapa", "Responsável", "Atualização", "Ações"]}
            rows={requests.map((request) => [
              <button key={`${request.id}-id`} onClick={() => openRequestDetail(request)} className="font-extrabold text-blue-600">{request.id}</button>,
              request.createdAt ?? request.time,
              <div key={`${request.id}-type`}><p className="font-bold text-navy-950">{request.type}</p><p className="line-clamp-1 text-xs text-muted">{request.title}</p></div>,
              <StatusBadge key={`${request.id}-status`} status={request.status} />,
              <CoverageImpactBadge key={`${request.id}-impact`} impact={request.coverageImpact} />,
              request.requester,
              request.requesterWbLogin ?? "-",
              request.lob ?? "-",
              request.supervisor ?? "Sem supervisor",
              requestedDateLabel(request),
              <PriorityBadge key={`${request.id}-priority`} priority={request.priority} />,
              request.nextStep ?? "-",
              request.nextOwner ?? "Nenhum",
              request.updatedAt ?? "-",
              <button key={`${request.id}-detail`} onClick={() => openRequestDetail(request)} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-blue-700">Ver detalhes</button>
            ])}
          />
        </Panel>
      ) : (
        <div className="grid gap-4 xl:grid-cols-3 2xl:grid-cols-6">
          {requestColumns.map((column, columnIndex) => (
            <section key={column} className="card overflow-hidden">
              <div className={cn("h-1", ["bg-blue-600", "bg-amber-500", "bg-emerald-500", "bg-red-500", "bg-slate-500", "bg-slate-400"][columnIndex])} />
              <div className="flex items-center justify-between border-b border-border px-4 py-4">
                <h2 className="font-extrabold text-navy-950">{column}</h2>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-sm font-bold text-navy-950">{countByStatus(column)}</span>
              </div>
              <div className="min-h-[440px] space-y-3 p-3">
                {requests
                  .filter((request) => request.status === column)
                  .slice(0, 20)
                  .map((request) => {
                    const Icon = getRequestIcon(request.type);
                    const dayOffKind = dayOffKindFromRequest(request);
                    return (
                      <button key={request.id} onClick={() => openRequestDetail(request)} className="w-full rounded-lg border border-border bg-white p-3 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-card">
                        <div className="flex items-start gap-3">
                          <div className="grid h-10 w-10 place-items-center rounded-lg bg-blue-50 text-blue-600">
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-extrabold text-navy-950">{request.type}</p>
                            <p className="text-xs text-muted">{request.nextOwner ?? request.area}</p>
                          </div>
                        </div>
                        {dayOffKind ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <StatusBadge status={dayOffKindLabels[dayOffKind]} />
                            <CoverageImpactBadge impact={request.coverageImpact} />
                          </div>
                        ) : null}
                        <p className="mt-3 line-clamp-2 text-xs font-semibold text-muted">{request.title || request.description}</p>
                        <div className="mt-4 flex items-center justify-between">
                          <PriorityBadge priority={request.priority} />
                          <span className="text-xs text-muted">{request.time}</span>
                        </div>
                        <div className="mt-4 flex items-center gap-2">
                          <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-200 text-[11px] font-bold">{initials(request.requester)}</span>
                          <span className="truncate text-xs font-semibold text-muted">{request.requester}</span>
                        </div>
                      </button>
                    );
                  })}
              </div>
              <button onClick={() => applyFilters({ ...filters, status: column })} className="w-full border-t border-border py-4 text-sm font-bold text-blue-600">Ver status na tabela</button>
            </section>
          ))}
        </div>
      )}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-white px-4 py-3">
        <p className="text-sm font-semibold text-muted">{paginationRange(pagination.page, pagination.limit, pagination.total)}</p>
        <div className="flex flex-wrap gap-2">
          <button disabled={pagination.page <= 1 || loading} onClick={() => goToPage(1)} className="h-9 rounded-lg border border-border px-3 text-sm font-bold disabled:opacity-50">Primeira</button>
          <button disabled={pagination.page <= 1 || loading} onClick={() => goToPage(pagination.page - 1)} className="h-9 rounded-lg border border-border px-3 text-sm font-bold disabled:opacity-50">Anterior</button>
          <span className="grid h-9 place-items-center rounded-lg bg-slate-100 px-3 text-sm font-bold text-navy-950">Página {pagination.page} de {pagination.totalPages}</span>
          <button disabled={pagination.page >= pagination.totalPages || loading} onClick={() => goToPage(pagination.page + 1)} className="h-9 rounded-lg border border-border px-3 text-sm font-bold disabled:opacity-50">Próxima</button>
          <button disabled={pagination.page >= pagination.totalPages || loading} onClick={() => goToPage(pagination.totalPages)} className="h-9 rounded-lg border border-border px-3 text-sm font-bold disabled:opacity-50">Última</button>
        </div>
      </div>
      {selected ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[88vh] w-full max-w-3xl overflow-y-auto p-5">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-navy-950">Detalhe da Solicitação</h2>
              <button onClick={closeRequestDetail} className="text-2xl text-muted">×</button>
            </div>
            {detailLoading ? <div className="mb-4 rounded-lg border border-border bg-slate-50 p-3 text-sm font-bold text-muted">Carregando detalhe completo...</div> : null}
            <RequestDetailContent selected={selected} actorRole={actorRole} actionReason={actionReason} setActionReason={setActionReason} comment={comment} setComment={setComment} onMove={moveStatus} onComment={submitComment} actionPending={actionPending} />
          </div>
        </div>
      ) : null}
      {showCreate ? <RequestCreateModal draft={newRequest} setDraft={setNewRequest} onClose={() => setShowCreate(false)} onSubmit={submitRequest} /> : null}
      <CoverageWarningDialog warning={coverageWarning} onClose={() => setCoverageWarning(null)} />
    </div>
  );
}
