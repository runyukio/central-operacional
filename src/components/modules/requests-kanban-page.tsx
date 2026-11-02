"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, ClipboardList, Plus, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import { TopActions } from "@/components/layout/app-shell";
import { EmptyState, PageHeader, Panel, SimpleTable, StatCard, StatusBadge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { formatPipelineDate, formatPipelineDuration, type PipelineSummary } from "@/lib/request-pipeline";
import { RequestSlaBadge } from "./request-sla-badge";
import { type ClientRequest, CoverageWarningDialog, type CoverageWarningDialogState, FormInput, FormSelect, RequestDetailContent, apiJson, coverageImpactFromError, queryParam, requestPriorities, requestTypes } from "./shared";

type RequestListResponse = {
  data: ClientRequest[]; total?: number; page?: number; limit?: number; totalPages?: number;
  summary?: PipelineSummary; statusSummary?: PipelineSummary; error?: string;
  supervisors?: Array<{ id: string; name: string; wbLogin: string; email?: string }>;
  actor?: { role: string; name?: string };
};
const statusOptions = [
  ["Todos", "Todos"], ["Pendentes", "Pendentes"], ["Aberto", "Abertos"], ["Em análise", "Em análise"], ["Aprovado", "Aprovados"],
  ["Concluído", "Concluídos"], ["Recusado", "Recusados"], ["Cancelado", "Cancelados"]
];
const defaultPipelineFilters = {
  employeeId: queryParam("employeeId"), search: "", status: "Todos", type: "Todos",
  startDate: queryParam("startDate"), endDate: queryParam("endDate"), lob: "Todos",
  supervisorId: "Todos", priority: "Todos", pendingAction: "false", deadline: "Todos", sort: "created", limit: "50"
};
const emptySummary: PipelineSummary = { total: 0, byStatus: {}, open: 0, inAnalysis: 0, awaitingCompletion: 0, withinDeadline: 0, overdue: 0, oldestPending: null };
function paginationRange(page: number, limit: number, total: number) {
  return total ? `Exibindo ${(page - 1) * limit + 1}–${Math.min(page * limit, total)} de ${total} solicitações` : "Exibindo 0 de 0 solicitações";
}
function createDefaultRequestDraft() {
  return { type: "WFM", title: "", priority: "Média", description: "", requestedDate: "", attachmentUrl: "" };
}
type RequestDraft = ReturnType<typeof createDefaultRequestDraft>;
function validateRequestDraft(draft: RequestDraft) {
  if (!draft.title.trim()) return "Informe o título da solicitação.";
  if (!draft.description.trim()) return "Descreva sua solicitação para o WFM.";
  return "";
}
async function createRequestFromDraft(draft: RequestDraft) {
  return apiJson<{ data: ClientRequest }>("/api/requests", {
    method: "POST", body: JSON.stringify({ ...draft, type: "WFM", source: "pipeline" })
  });
}
function RequestCreateModal({ draft, setDraft, onClose, onSubmit, pending, message }: {
  draft: RequestDraft; setDraft: Dispatch<SetStateAction<RequestDraft>>; onClose: () => void; onSubmit: () => void; pending: boolean; message: string;
}) {
  return <Dialog.Root open onOpenChange={open => { if (!open && !pending) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-navy-950/40" />
    <div className="pointer-events-none fixed inset-0 z-[51] grid place-items-center p-4">
    <Dialog.Content className="card pointer-events-auto max-h-[88vh] w-full max-w-xl overflow-y-auto !bg-white p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Dialog.Title className="text-lg font-extrabold text-navy-950">Nova solicitação WFM</Dialog.Title>
        <button type="button" onClick={onClose} disabled={pending} aria-label="Fechar nova solicitação" className="rounded-lg p-2"><X className="h-5 w-5" /></button>
      </div>
      <Dialog.Description className="mb-4 text-sm text-muted">Enviada diretamente para o WFM. Trocas e outros pedidos devem ser abertos em suas telas de origem, como Meu Cronograma.</Dialog.Description>
      {message ? <p role="alert" className="mb-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-700">{message}</p> : null}
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
        <p className="rounded-lg bg-blue-50 p-3 text-sm font-bold text-blue-700">Tipo: WFM • Prazo de 48h, sem sábado e domingo</p>
        <FormInput label="Título" value={draft.title} onChange={title => setDraft(current => ({ ...current, title }))} />
        <label className="block"><span className="mb-1.5 block text-sm font-semibold text-muted">Descrição</span>
          <textarea required value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} className="min-h-28 w-full rounded-lg border border-border p-3 text-sm" />
        </label>
        <FormSelect label="Prioridade" value={draft.priority} options={requestPriorities} onChange={priority => setDraft(current => ({ ...current, priority }))} />
        <label className="block"><span className="mb-1.5 block text-sm font-semibold text-muted">Data desejada (opcional)</span>
          <input type="date" value={draft.requestedDate} onChange={event => setDraft(current => ({ ...current, requestedDate: event.target.value }))} className="h-11 w-full rounded-lg border border-border px-3" />
        </label>
        <FormInput label="Link do anexo (opcional)" value={draft.attachmentUrl} onChange={attachmentUrl => setDraft(current => ({ ...current, attachmentUrl }))} />
        <button disabled={pending} type="submit" className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{pending ? "Enviando..." : "Enviar para o WFM"}</button>
      </form>
    </Dialog.Content>
    </div>
  </Dialog.Portal></Dialog.Root>;
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
  const [summary, setSummary] = useState<PipelineSummary>(emptySummary);
  const [supervisors, setSupervisors] = useState<RequestListResponse["supervisors"]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [moreFilters, setMoreFilters] = useState(false);
  const [creating, setCreating] = useState(false);
  const [statusSummary, setStatusSummary] = useState<PipelineSummary>(emptySummary);
  const loadSequence = useRef(0);
  const detailSequence = useRef(0);
  const filtersRef = useRef(filters);
  const pageRef = useRef(1);
  const requestListRef = useRef<HTMLDivElement>(null);
  filtersRef.current = filters;
  const [loadError, setLoadError] = useState("");
  const [newRequest, setNewRequest] = useState(createDefaultRequestDraft);
  const initialDeepLinkHandled = useRef(false);
  const countByStatus = (status: string) => status === "Todos" ? statusSummary.total : status === "Pendentes"
    ? ["Aberto", "Em análise", "Aprovado"].reduce((total, label) => total + (statusSummary.byStatus[label] ?? 0), 0)
    : statusSummary.byStatus[status] ?? 0;
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (searchInput !== filtersRef.current.search) applyFilters({ ...filtersRef.current, search: searchInput });
    }, 350);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);
  useEffect(() => {
    const interval = window.setInterval(() => { void loadRequests(filtersRef.current, pageRef.current); }, 60_000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setSelected(null);
    setDetailLoading(false);
    void loadRequests(defaultPipelineFilters, 1);
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

  async function loadRequests(nextFilters = filters, nextPage = pagination.page) {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError("");
    try {
      const payload = await apiJson<RequestListResponse>(`/api/requests?${buildPipelineParams(nextFilters, nextPage).toString()}`);
      if (sequence !== loadSequence.current) return;
      if (payload.error) throw new Error(payload.error);
      const page = payload.page ?? nextPage;
      pageRef.current = page;
      const limit = payload.limit ?? Number(nextFilters.limit);
      setRequests(payload.data);
      setActorRole(payload.actor?.role ?? "ADMIN");
      setPagination({
        total: payload.total ?? payload.data.length,
        page,
        limit,
        totalPages: payload.totalPages ?? 1
      });
      setSummary(payload.summary ?? emptySummary);
      setStatusSummary(payload.statusSummary ?? payload.summary ?? emptySummary);
      setSupervisors(payload.supervisors ?? []);
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      setSummary(emptySummary);
      setStatusSummary(emptySummary);
      setRequests([]);
      setPagination({ total: 0, page: 1, limit: Number(nextFilters.limit), totalPages: 1 });
      setLoadError(error instanceof Error ? error.message : "Não foi possível carregar a esteira.");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }

  function applyFilters(nextFilters = filters) {
    filtersRef.current = nextFilters;
    setFilters(nextFilters);
    void loadRequests(nextFilters, 1);
  }

  function clearFilters() {
    setSearchInput("");
    applyFilters({ ...defaultPipelineFilters, employeeId: "", startDate: "", endDate: "" });
  }

  function goToPage(nextPage: number) {
    const safePage = Math.min(Math.max(nextPage, 1), pagination.totalPages);
    void loadRequests(filters, safePage);
  }

  async function openRequestDetail(request: ClientRequest) {
    const sequence = ++detailSequence.current;
    setActionMessage("");
    setActionReason("");
    setComment("");
    setSelected(request);
    setDetailLoading(true);
    try {
      const payload = await apiJson<{ data: ClientRequest; actor?: { role: string } }>(`/api/requests?id=${encodeURIComponent(request.id)}`);
      if (sequence !== detailSequence.current) return;
      setSelected(payload.data);
      setActorRole(payload.actor?.role ?? actorRole);
    } catch (error) {
      if (sequence !== detailSequence.current) return;
      setSelected(null);
      setActionMessage(error instanceof Error ? error.message : "Não foi possível carregar o detalhe da solicitação.");
    } finally {
      if (sequence === detailSequence.current) setDetailLoading(false);
    }
  }

  function closeRequestDetail() {
    ++detailSequence.current;
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
    if (creating) return;
    const validationMessage = validateRequestDraft(newRequest);
    if (validationMessage) {
      setActionMessage(validationMessage);
      return;
    }

    try {
      setCreating(true);
      const payload = await createRequestFromDraft(newRequest);
      setShowCreate(false);
      setNewRequest(createDefaultRequestDraft());
      setActionMessage(`Solicitação ${payload.data.id} criada com sucesso e enviada para a esteira.`);
      void loadRequests(filters, 1);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Não foi possível criar a solicitação.");
    } finally {
      setCreating(false);
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
      void loadRequests(filtersRef.current, pageRef.current);
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
      void loadRequests(filters, pagination.page);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Não foi possível comentar.");
    }
  }

  return (
    <div>
      <PageHeader
        title="Esteiras de Solicitações"
        description="Acompanhe e gerencie as solicitações do time em todas as etapas do processo."
        icon={ClipboardList}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => { setActionMessage(""); setShowCreate(true); }} className="flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-bold text-white">
              <Plus className="h-4 w-4" />
              Nova solicitação
            </button>
            <button onClick={() => loadRequests(filters, pagination.page)} className="flex h-10 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-bold text-navy-950">
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              Atualizar
            </button>
            <TopActions />
          </div>
        }
      />
      <div className="card mb-5 space-y-4 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="relative block md:col-span-2">
            <span className="mb-1.5 block text-xs font-bold text-muted">Busca</span>
            <Search className="pointer-events-none absolute left-3 top-9 h-4 w-4 text-muted" />
            <input value={searchInput} onChange={event => setSearchInput(event.target.value)} className="h-11 w-full rounded-lg border border-border pl-9 pr-3 text-sm" placeholder="ID, nome, WB/Login, tipo, responsável ou etapa" />
          </label>
          <FormSelect label="Tipo" value={filters.type} options={["Todos", ...requestTypes]} onChange={type => applyFilters({ ...filters, type })} />
          <FormSelect label="LOB" value={filters.lob} options={["Todos", "ALL", "CEC", "TNS", "ADS"]} onChange={lob => applyFilters({ ...filters, lob })} />
          <label className="block"><span className="mb-1.5 block text-sm font-semibold text-muted">Prazo</span>
            <select aria-label="Prazo" value={filters.deadline} onChange={event => applyFilters({ ...filters, deadline: event.target.value })} className="h-11 w-full rounded-lg border border-border px-3 text-sm">
              <option value="Todos">Todos</option><option value="WAITING_WFM">Aguardando WFM</option><option value="WITHIN_DEADLINE">Dentro do prazo</option><option value="OVERDUE">Fora do prazo</option>
            </select>
          </label>
        </div>
        <div role="group" aria-label="Status do pedido" className="flex flex-wrap gap-2">
          {statusOptions.map(([value, label]) => <button key={value} type="button" aria-pressed={filters.status === value} onClick={() => applyFilters({ ...filters, status: value })} className={cn("flex min-h-10 items-center gap-2 rounded-full border px-3 py-2 text-sm font-bold", filters.status === value ? "border-blue-600 bg-blue-600 text-white" : "border-border bg-white text-navy-950 hover:bg-slate-50")}>
            {label}<span className={cn("rounded-full px-2 text-xs", filters.status === value ? "bg-white/20" : "bg-slate-100")}>{countByStatus(value)}</span>
          </button>)}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" aria-expanded={moreFilters} aria-controls="pipeline-more-filters" onClick={() => setMoreFilters(current => !current)} className="flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm font-bold"><SlidersHorizontal className="h-4 w-4" />Mais filtros{[filters.startDate, filters.endDate, filters.supervisorId !== "Todos", filters.priority !== "Todos", filters.pendingAction === "true", filters.employeeId].filter(Boolean).length ? " • ativos" : ""}</button>
          <button type="button" onClick={clearFilters} className="min-h-10 rounded-lg border border-border px-3 text-sm font-bold">Limpar filtros</button>
        </div>
        {moreFilters ? <div id="pipeline-more-filters" className="grid gap-3 border-t border-border pt-4 md:grid-cols-2 xl:grid-cols-5">
          <label className="block"><span className="mb-1.5 block text-sm font-semibold text-muted">Criação: de</span><input type="date" value={filters.startDate} onChange={event => applyFilters({ ...filters, startDate: event.target.value })} className="h-11 w-full rounded-lg border border-border px-3 text-sm" /></label>
          <label className="block"><span className="mb-1.5 block text-sm font-semibold text-muted">Criação: até</span><input type="date" value={filters.endDate} onChange={event => applyFilters({ ...filters, endDate: event.target.value })} className="h-11 w-full rounded-lg border border-border px-3 text-sm" /></label>
          <label className="block"><span className="mb-1.5 block text-sm font-semibold text-muted">Supervisor</span><select aria-label="Supervisor" value={filters.supervisorId} onChange={event => applyFilters({ ...filters, supervisorId: event.target.value })} className="h-11 w-full rounded-lg border border-border px-3 text-sm"><option value="Todos">Todos</option><option value="SEM_SUPERVISOR">Sem supervisor</option>{supervisors?.map(supervisor => <option key={supervisor.id} value={supervisor.id}>{supervisor.name}</option>)}</select></label>
          <FormSelect label="Prioridade" value={filters.priority} options={["Todos", ...requestPriorities]} onChange={priority => applyFilters({ ...filters, priority })} />
          <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={filters.pendingAction === "true"} onChange={event => applyFilters({ ...filters, pendingAction: String(event.target.checked) })} />Pendentes da minha ação</label>
        </div> : null}
      </div>
      {actionMessage ? <div role="status" className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{actionMessage}</div> : null}
      {loadError ? <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{loadError}</div> : null}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6" aria-label="Indicadores das solicitações filtradas">
        <StatCard title="Abertos" value={summary.open} helper="Aguardando uma ação" icon={ClipboardList} tone="blue" />
        <StatCard title="Em análise" value={summary.inAnalysis} helper="Análise em andamento" icon={Clock} tone="orange" />
        <StatCard title="Aguardando conclusão" value={summary.awaitingCompletion} helper="Aprovados ainda pendentes" icon={ClipboardList} tone="cyan" />
        <StatCard title="Dentro do prazo" value={summary.withinDeadline} helper="Pendentes com prazo ativo" icon={CheckCircle2} tone="green" />
        <StatCard title="Fora do prazo" value={summary.overdue} helper="Pendentes acima de 48h" icon={AlertTriangle} tone="red" />
        <button type="button" disabled={!summary.oldestPending} aria-label="Ver lista de pendências, das mais antigas às mais recentes" onClick={() => {
          applyFilters({ ...filters, status: "Pendentes", sort: "oldest" });
          requestListRef.current?.focus({ preventScroll: true });
          requestListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }} className="min-w-0 rounded-xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:cursor-default">
          <StatCard title="Pendente mais antigo" value={summary.oldestPending?.id ?? "—"} helper={summary.oldestPending ? `Aberto há ${formatPipelineDuration((Date.now() - Date.parse(summary.oldestPending.createdAt)) / 60_000)} • Ver lista` : "Nenhuma pendência"} icon={Clock} tone="purple" />
        </button>
      </div>
      {loading ? <div className="mb-5 rounded-lg border border-border bg-white p-4 text-sm font-bold text-muted">Carregando solicitações...</div> : null}
      {!loading && !loadError && !requests.length ? <div className="mb-5"><EmptyState title="Nenhuma solicitação encontrada para os filtros selecionados." description="Ajuste os filtros ou limpe a busca para visualizar a esteira." /></div> : null}
      <div ref={requestListRef} role="region" aria-label="Lista de solicitações" tabIndex={-1} className="scroll-mt-24 outline-none">
      <Panel title={filters.status === "Pendentes" ? "Pendências" : "Solicitações"}>
        {filters.status === "Pendentes" ? <p className="mb-3 text-sm font-semibold text-muted">{filters.sort === "oldest" ? "Da mais antiga para a mais recente. " : ""}Selecione um pedido na lista para ver os detalhes.</p> : null}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">Prazo: 48h desde a entrada no WFM até o encerramento. Sábados e domingos não contam. Horário de São Paulo.</p>
          <label className="flex items-center gap-2 text-sm font-bold"><span>Ordenar por</span><select aria-label="Ordenar por" value={filters.sort} onChange={event => applyFilters({ ...filters, sort: event.target.value })} className="h-10 rounded-lg border border-border px-3"><option value="created">Mais recentes</option><option value="oldest">Mais antigos</option><option value="deadline">Vencimento</option></select></label>
        </div>
        <div aria-busy={loading}>
          <SimpleTable columns={["Pedido", "Solicitante", "Status", "Pendente com", "Próxima ação", "Entrada no WFM", "Vencimento", "Prazo"]} rows={requests.map(request => [
            <button key={`${request.id}-id`} onClick={() => openRequestDetail(request)} className="max-w-60 text-left"><span className="font-extrabold text-blue-600 underline-offset-2 hover:underline">{request.id}</span><span className="mt-1 block font-bold text-navy-950">{request.type}</span><span className="mt-1 line-clamp-2 text-xs text-muted">{request.title}</span><span className="mt-1 block text-xs text-muted">Criado em {formatPipelineDate(request.createdAtIso)}</span></button>,
            <div key={`${request.id}-requester`} className="max-w-48"><p className="font-bold">{request.requester}</p><p className="text-xs text-muted">{request.requesterWbLogin || "—"}</p></div>,
            <StatusBadge key={`${request.id}-status`} status={request.status} />,
            request.nextOwner ?? "—", request.nextStep ?? "—",
            formatPipelineDate(request.sla?.receivedAt), formatPipelineDate(request.sla?.dueAt),
            <RequestSlaBadge key={`${request.id}-sla`} sla={request.sla} />
          ])} />
        </div>
      </Panel>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-white px-4 py-3">
        <p className="text-sm font-semibold text-muted">{paginationRange(pagination.page, pagination.limit, pagination.total)} • 50 por página</p>
        <div className="flex flex-wrap gap-2">
          <button disabled={pagination.page <= 1 || loading} onClick={() => goToPage(1)} className="h-9 rounded-lg border border-border px-3 text-sm font-bold disabled:opacity-50">Primeira</button>
          <button disabled={pagination.page <= 1 || loading} onClick={() => goToPage(pagination.page - 1)} className="h-9 rounded-lg border border-border px-3 text-sm font-bold disabled:opacity-50">Anterior</button>
          <span className="grid h-9 place-items-center rounded-lg bg-slate-100 px-3 text-sm font-bold text-navy-950">Página {pagination.page} de {pagination.totalPages}</span>
          <button disabled={pagination.page >= pagination.totalPages || loading} onClick={() => goToPage(pagination.page + 1)} className="h-9 rounded-lg border border-border px-3 text-sm font-bold disabled:opacity-50">Próxima</button>
          <button disabled={pagination.page >= pagination.totalPages || loading} onClick={() => goToPage(pagination.totalPages)} className="h-9 rounded-lg border border-border px-3 text-sm font-bold disabled:opacity-50">Última</button>
        </div>
      </div>
      {selected ? (
        <Dialog.Root open onOpenChange={open => { if (!open && !actionPending) closeRequestDetail(); }}><Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-navy-950/40" />
          <div className="pointer-events-none fixed inset-0 z-[51] grid place-items-center p-4">
          <Dialog.Content className="card pointer-events-auto max-h-[88vh] w-full max-w-3xl overflow-y-auto !bg-white p-5">
            <div className="mb-5 flex items-center justify-between">
              <Dialog.Title className="text-lg font-extrabold text-navy-950">Detalhe da Solicitação</Dialog.Title>
              <button disabled={Boolean(actionPending)} aria-label="Fechar detalhe da solicitação" onClick={closeRequestDetail} className="rounded-lg p-2 text-muted"><X className="h-5 w-5" /></button>
            </div>
            <Dialog.Description className="sr-only">Dados, prazo, histórico e ações da solicitação.</Dialog.Description>
            {actionMessage ? <p role="status" className="mb-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-700">{actionMessage}</p> : null}
            {detailLoading ? <div className="mb-4 rounded-lg border border-border bg-slate-50 p-3 text-sm font-bold text-muted">Carregando detalhe completo...</div> : null}
            {!detailLoading ? <RequestDetailContent selected={selected} actorRole={actorRole} actionReason={actionReason} setActionReason={setActionReason} comment={comment} setComment={setComment} onMove={moveStatus} onComment={submitComment} actionPending={actionPending} /> : null}
          </Dialog.Content>
          </div>
        </Dialog.Portal></Dialog.Root>
      ) : null}
      {showCreate ? <RequestCreateModal draft={newRequest} setDraft={setNewRequest} onClose={() => setShowCreate(false)} onSubmit={submitRequest} pending={creating} message={actionMessage} /> : null}
      <CoverageWarningDialog warning={coverageWarning} onClose={() => setCoverageWarning(null)} />
    </div>
  );
}
