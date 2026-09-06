"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, MessageCircle, RefreshCw, Send, Trash2 } from "lucide-react";
import { TopActions } from "@/components/layout/app-shell";
import { EmptyState, PageHeader, Panel, PriorityBadge, SimpleTable, StatCard, StatusBadge } from "@/components/ui/primitives";
import { ApiRequestError, apiJson, downloadFile } from './shared';
type AnonymousFeedbackClient = {
  id: string;
  category: string;
  urgency: string;
  urgencyLabel: string;
  comment: string;
  status: string;
  statusLabel: string;
  allowContact: boolean;
  contact?: { name: string; email: string; wbLogin: string } | null;
  lob?: string | null;
  jobTitle?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
  response?: string | null;
  respondedAt?: string | null;
  respondedBy?: string | null;
};


type AnonymousFeedbackListResponse = {
  data: AnonymousFeedbackClient[];
  summary: {
    total: number;
    new: number;
    inReview: number;
    resolved: number;
    archived: number;
    critical: number;
  };
  pagination: { page: number; limit: number; total: number; totalPages: number };
};


const anonymousCategories = ["Liderança", "Cronograma", "Ferramentas / acessos", "Ambiente", "Comunicação", "Carga de trabalho", "Sugestão", "Problema operacional", "Outro"];

const urgencyOptions = ["Baixa", "Média", "Alta", "Crítica"];

const feedbackStatusOptions = ["Todos", "Novo", "Em análise", "Resolvido", "Arquivado"];


function ptDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}


export function AnonymousFeedbackPage() {
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState("");
  const [anonymousForm, setAnonymousForm] = useState({ category: "Liderança", urgency: "Média", comment: "", allowContact: false });
  const [feedbackPayload, setFeedbackPayload] = useState<AnonymousFeedbackListResponse | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackView, setFeedbackView] = useState<"loading" | "admin" | "submit" | "error">("loading");
  const [selectedFeedback, setSelectedFeedback] = useState<AnonymousFeedbackClient | null>(null);
  const [responseDraft, setResponseDraft] = useState("");
  const [responseSaving, setResponseSaving] = useState(false);
  const [deletingFeedbackId, setDeletingFeedbackId] = useState<string | null>(null);
  const [feedbackFilters, setFeedbackFilters] = useState({ status: "Todos", urgency: "Todos", category: "Todos", startDate: "", endDate: "", lob: "", jobTitle: "", search: "" });

  const loadAnonymousFeedback = useCallback(async () => {
    setFeedbackLoading(true);
    const params = new URLSearchParams();
    if (feedbackFilters.status !== "Todos") params.set("status", feedbackFilters.status);
    if (feedbackFilters.urgency !== "Todos") params.set("urgency", feedbackFilters.urgency);
    if (feedbackFilters.category !== "Todos") params.set("category", feedbackFilters.category);
    if (feedbackFilters.startDate) params.set("startDate", feedbackFilters.startDate);
    if (feedbackFilters.endDate) params.set("endDate", feedbackFilters.endDate);
    if (feedbackFilters.lob.trim()) params.set("lob", feedbackFilters.lob.trim());
    if (feedbackFilters.jobTitle.trim()) params.set("jobTitle", feedbackFilters.jobTitle.trim());
    if (feedbackFilters.search.trim()) params.set("search", feedbackFilters.search.trim());
    try {
      const payload = await apiJson<AnonymousFeedbackListResponse>(`/api/anonymous-feedback?${params.toString()}`);
      setFeedbackPayload(payload);
      setFeedbackView("admin");
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 403) {
        setFeedbackView("submit");
      } else {
        setFeedbackView("error");
        setMessage(error instanceof Error ? error.message : "Não foi possível carregar feedbacks.");
      }
    } finally {
      setFeedbackLoading(false);
    }
  }, [feedbackFilters.category, feedbackFilters.endDate, feedbackFilters.jobTitle, feedbackFilters.lob, feedbackFilters.search, feedbackFilters.startDate, feedbackFilters.status, feedbackFilters.urgency]);

  useEffect(() => {
    void loadAnonymousFeedback();
  }, [loadAnonymousFeedback]);

  async function submitAnonymousFeedback() {
    setMessage("");
    try {
      const payload = await apiJson<{ data: { message: string } }>("/api/anonymous-feedback", {
        method: "POST",
        body: JSON.stringify(anonymousForm)
      });
      setSubmitted(true);
      setMessage(payload.data.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível enviar o feedback.");
    }
  }

  async function updateFeedbackStatus(id: string, status: string) {
    setMessage("");
    try {
      const payload = await apiJson<{ data: AnonymousFeedbackClient }>("/api/anonymous-feedback", {
        method: "PATCH",
        body: JSON.stringify({ id, status })
      });
      setSelectedFeedback((current) => current?.id === id ? { ...current, status: payload.data.status, statusLabel: payload.data.statusLabel, resolvedAt: payload.data.resolvedAt } : current);
      setMessage("Status atualizado.");
      await loadAnonymousFeedback();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível atualizar o status.");
    }
  }

  async function deleteFeedback(feedback: AnonymousFeedbackClient) {
    const confirmed = window.confirm("Excluir este feedback permanentemente? Essa ação não pode ser desfeita.");
    if (!confirmed) return;

    setMessage("");
    setDeletingFeedbackId(feedback.id);
    try {
      const payload = await apiJson<{ data: { id: string }; message: string }>("/api/anonymous-feedback", {
        method: "DELETE",
        body: JSON.stringify({ id: feedback.id })
      });
      setSelectedFeedback((current) => current?.id === feedback.id ? null : current);
      setFeedbackPayload((current) => current ? {
        ...current,
        data: current.data.filter((item) => item.id !== feedback.id),
        pagination: {
          ...current.pagination,
          total: Math.max(0, current.pagination.total - 1)
        }
      } : current);
      setMessage(payload.message);
      await loadAnonymousFeedback();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível excluir o feedback.");
    } finally {
      setDeletingFeedbackId(null);
    }
  }

  function openFeedbackDetails(feedback: AnonymousFeedbackClient) {
    setSelectedFeedback(feedback);
    setResponseDraft(feedback.response ?? "");
  }

  async function saveFeedbackResponse() {
    if (!selectedFeedback || responseDraft.trim().length < 3) return;
    setMessage("");
    setResponseSaving(true);
    try {
      const payload = await apiJson<{ data: AnonymousFeedbackClient }>("/api/anonymous-feedback", {
        method: "PATCH",
        body: JSON.stringify({ id: selectedFeedback.id, response: responseDraft.trim() })
      });
      setSelectedFeedback((current) => current ? {
        ...current,
        response: payload.data.response,
        respondedAt: payload.data.respondedAt,
        respondedBy: "East River"
      } : current);
      setResponseDraft(payload.data.response ?? responseDraft.trim());
      setMessage("Resposta enviada ao parceiro como East River.");
      await loadAnonymousFeedback();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível enviar a resposta.");
    } finally {
      setResponseSaving(false);
    }
  }

  if (feedbackView === "loading") {
    return (
      <div>
        <PageHeader title="Feedback Anônimo" description="Canal seguro para registrar percepções, sugestões e problemas operacionais." icon={MessageCircle} actions={<TopActions />} />
        <Panel title="Carregando">
          <EmptyState title="Carregando Feedback Anônimo" description="Verificando sua permissão de acesso." />
        </Panel>
      </div>
    );
  }

  if (feedbackView === "error") {
    return (
      <div>
        <PageHeader title="Feedback Anônimo" description="Canal seguro para registrar percepções, sugestões e problemas operacionais." icon={MessageCircle} actions={<TopActions />} />
        <Panel title="Não foi possível carregar">
          <div className="rounded-lg border border-red-100 bg-red-50 p-5 text-center">
            <AlertTriangle className="mx-auto h-9 w-9 text-red-500" />
            <p className="mt-3 text-sm font-extrabold text-red-800">{message || "Não foi possível carregar Feedback Anônimo."}</p>
            <button type="button" onClick={loadAnonymousFeedback} disabled={feedbackLoading} className="mt-4 h-10 rounded-lg border border-red-200 bg-white px-4 text-sm font-extrabold text-red-700 disabled:opacity-60">
              {feedbackLoading ? "Tentando novamente..." : "Tentar novamente"}
            </button>
          </div>
        </Panel>
      </div>
    );
  }

  if (feedbackView === "admin") {
    const summary = feedbackPayload?.summary;
    const exportParams = new URLSearchParams();
    if (feedbackFilters.status !== "Todos") exportParams.set("status", feedbackFilters.status);
    if (feedbackFilters.urgency !== "Todos") exportParams.set("urgency", feedbackFilters.urgency);
    if (feedbackFilters.category !== "Todos") exportParams.set("category", feedbackFilters.category);
    if (feedbackFilters.startDate) exportParams.set("startDate", feedbackFilters.startDate);
    if (feedbackFilters.endDate) exportParams.set("endDate", feedbackFilters.endDate);
    if (feedbackFilters.lob.trim()) exportParams.set("lob", feedbackFilters.lob.trim());
    if (feedbackFilters.jobTitle.trim()) exportParams.set("jobTitle", feedbackFilters.jobTitle.trim());
    if (feedbackFilters.search.trim()) exportParams.set("search", feedbackFilters.search.trim());
    return (
      <div>
        <PageHeader title="Feedback Anônimo" description="Acompanhe manifestações, responda aos parceiros e preserve a escolha de identificação." icon={MessageCircle} actions={<TopActions />} />
        {message ? <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{message}</div> : null}
        <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard title="Total" value={summary?.total ?? 0} helper="feedbacks recebidos" icon={MessageCircle} tone="blue" />
          <StatCard title="Novos" value={summary?.new ?? 0} helper="aguardando leitura" icon={Send} tone="cyan" />
          <StatCard title="Em análise" value={summary?.inReview ?? 0} helper="em tratamento" icon={RefreshCw} tone="orange" />
          <StatCard title="Resolvidos" value={summary?.resolved ?? 0} helper="concluídos" icon={CheckCircle2} tone="green" />
          <StatCard title="Críticos" value={summary?.critical ?? 0} helper="urgência crítica" icon={AlertTriangle} tone="red" />
        </div>
        <Panel title="Feedbacks recebidos" action="Exportar" actionOnClick={() => void downloadFile(`/api/anonymous-feedback/export?${exportParams.toString()}`, "feedback_anonimo.xlsx").catch((error) => setMessage(error.message))}>
          <div className="mb-4 grid gap-3 md:grid-cols-4 xl:grid-cols-8">
            <select value={feedbackFilters.status} onChange={(event) => setFeedbackFilters({ ...feedbackFilters, status: event.target.value })} className="h-10 rounded-lg border border-border px-3">
              {feedbackStatusOptions.map((option) => <option key={option}>{option}</option>)}
            </select>
            <select value={feedbackFilters.urgency} onChange={(event) => setFeedbackFilters({ ...feedbackFilters, urgency: event.target.value })} className="h-10 rounded-lg border border-border px-3">
              <option>Todos</option>
              {urgencyOptions.map((option) => <option key={option}>{option}</option>)}
            </select>
            <select value={feedbackFilters.category} onChange={(event) => setFeedbackFilters({ ...feedbackFilters, category: event.target.value })} className="h-10 rounded-lg border border-border px-3">
              <option>Todos</option>
              {anonymousCategories.map((option) => <option key={option}>{option}</option>)}
            </select>
            <input type="date" value={feedbackFilters.startDate} onChange={(event) => setFeedbackFilters({ ...feedbackFilters, startDate: event.target.value })} className="h-10 rounded-lg border border-border px-3" />
            <input type="date" value={feedbackFilters.endDate} onChange={(event) => setFeedbackFilters({ ...feedbackFilters, endDate: event.target.value })} className="h-10 rounded-lg border border-border px-3" />
            <input value={feedbackFilters.lob} onChange={(event) => setFeedbackFilters({ ...feedbackFilters, lob: event.target.value })} className="h-10 rounded-lg border border-border px-3" placeholder="LOB" />
            <input value={feedbackFilters.jobTitle} onChange={(event) => setFeedbackFilters({ ...feedbackFilters, jobTitle: event.target.value })} className="h-10 rounded-lg border border-border px-3" placeholder="Cargo/Função" />
            <div className="flex gap-2 xl:col-span-1">
              <input value={feedbackFilters.search} onChange={(event) => setFeedbackFilters({ ...feedbackFilters, search: event.target.value })} className="h-10 min-w-0 flex-1 rounded-lg border border-border px-3" placeholder="Buscar comentário" />
              <button type="button" onClick={loadAnonymousFeedback} className="h-10 rounded-lg border border-border px-3 text-sm font-bold">Buscar</button>
            </div>
          </div>
          {feedbackLoading ? (
            <EmptyState title="Carregando feedbacks" description="Buscando dados reais no banco." />
          ) : feedbackPayload?.data.length ? (
            <SimpleTable
              columns={["Data", "Categoria", "Urgência", "LOB", "Cargo/Função", "Comentário", "Status", "Identificação", "Retorno", "Ações"]}
              rows={feedbackPayload.data.map((feedback) => [
                ptDate(feedback.createdAt),
                feedback.category,
                <PriorityBadge key={`${feedback.id}-urgency`} priority={feedback.urgencyLabel} />,
                feedback.lob ?? "-",
                feedback.jobTitle ?? "-",
                <div key={`${feedback.id}-comment`} className="max-w-[420px]">
                  <p className="line-clamp-3 text-sm">{feedback.comment}</p>
                </div>,
                <StatusBadge key={`${feedback.id}-status`} status={feedback.statusLabel} />,
                feedback.allowContact ? <StatusBadge key={`${feedback.id}-contact`} status="Identificado" /> : <StatusBadge key={`${feedback.id}-anonymous`} status="Anônimo" />,
                feedback.response ? <StatusBadge key={`${feedback.id}-response`} status="Respondido" /> : <StatusBadge key={`${feedback.id}-pending-response`} status="Aguardando" />,
                <div key={`${feedback.id}-actions`} className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => openFeedbackDetails(feedback)} className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">{feedback.response ? "Ver resposta" : "Responder"}</button>
                  <button type="button" onClick={() => updateFeedbackStatus(feedback.id, "Em análise")} className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">Em análise</button>
                  <button type="button" onClick={() => updateFeedbackStatus(feedback.id, "Resolvido")} className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">Resolver</button>
                  <button type="button" onClick={() => void deleteFeedback(feedback)} disabled={deletingFeedbackId === feedback.id} className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-60">
                    <Trash2 className="h-3.5 w-3.5" />
                    {deletingFeedbackId === feedback.id ? "Excluindo..." : "Excluir"}
                  </button>
                </div>
              ])}
            />
          ) : (
            <EmptyState title="Nenhum feedback recebido ainda." description="Os feedbacks enviados pelos parceiros aparecerão aqui." />
          )}
        </Panel>
        {selectedFeedback ? (
          <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
            <div className="card max-h-[88vh] w-full max-w-2xl overflow-y-auto p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-extrabold text-navy-950">Detalhe do feedback</h2>
                  <p className="text-sm text-muted">{ptDate(selectedFeedback.createdAt)} · {selectedFeedback.category}</p>
                </div>
                <button type="button" onClick={() => setSelectedFeedback(null)} aria-label="Fechar detalhe do feedback" className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
              </div>
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <PriorityBadge priority={selectedFeedback.urgencyLabel} />
                  <StatusBadge status={selectedFeedback.statusLabel} />
                  {selectedFeedback.allowContact ? <StatusBadge status="Identificado" /> : <span className="inline-flex rounded-md bg-slate-100 px-2 py-1 text-xs font-extrabold text-slate-600">Anônimo</span>}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs font-extrabold uppercase tracking-wide text-muted">LOB</p>
                    <p className="mt-1 font-bold text-navy-950">{selectedFeedback.lob ?? "-"}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs font-extrabold uppercase tracking-wide text-muted">Cargo/Função</p>
                    <p className="mt-1 font-bold text-navy-950">{selectedFeedback.jobTitle ?? "-"}</p>
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs font-extrabold uppercase tracking-wide text-muted">Comentário</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-navy-950">{selectedFeedback.comment}</p>
                </div>
                {selectedFeedback.allowContact && selectedFeedback.contact ? (
                  <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
                    <p className="font-extrabold">Contato permitido pelo parceiro</p>
                    <p className="mt-1">{selectedFeedback.contact.name} · {selectedFeedback.contact.email} · {selectedFeedback.contact.wbLogin}</p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    <p className="font-extrabold">Identidade protegida</p>
                    <p className="mt-1">O parceiro optou por permanecer anônimo. Nenhum dado de identificação é exibido nesta área.</p>
                  </div>
                )}
                <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-extrabold text-navy-950">Resposta para o parceiro</p>
                      <p className="mt-1 text-xs font-semibold text-emerald-800">No perfil do parceiro, o remetente será exibido somente como East River.</p>
                    </div>
                    {selectedFeedback.respondedAt ? <p className="text-xs font-bold text-emerald-700">Último envio: {ptDate(selectedFeedback.respondedAt)}</p> : null}
                  </div>
                  <label className="mt-3 block">
                    <span className="sr-only">Resposta da East River para o parceiro</span>
                    <textarea
                      value={responseDraft}
                      onChange={(event) => setResponseDraft(event.target.value)}
                      maxLength={4000}
                      className="min-h-32 w-full rounded-lg border border-emerald-200 bg-white p-3 text-sm leading-6 outline-none focus:border-emerald-400"
                      placeholder="Escreva o posicionamento ou retorno da East River"
                    />
                  </label>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-muted">{responseDraft.length}/4000 caracteres</p>
                    <button type="button" onClick={saveFeedbackResponse} disabled={responseSaving || responseDraft.trim().length < 3} className="premium-button h-10 px-4 text-sm font-extrabold disabled:opacity-60">
                      {responseSaving ? "Enviando..." : selectedFeedback.response ? "Atualizar resposta" : "Enviar resposta"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Feedback Anônimo" description="Canal seguro para registrar percepções, acompanhar o tratamento e receber o retorno da East River." icon={MessageCircle} actions={<TopActions />} />
      {message ? <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{message}</div> : null}
      <Panel title="Enviar feedback anônimo">
        {submitted ? (
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-5 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
            <h2 className="mt-3 text-lg font-extrabold text-navy-950">Feedback enviado com sucesso.</h2>
            <p className="mt-1 text-sm font-semibold text-muted">Você poderá acompanhar o status e a resposta da East River em Meu Perfil.</p>
            <Link href="/meu-perfil#meus-feedbacks" className="mt-4 inline-flex h-10 items-center rounded-lg bg-emerald-600 px-4 text-sm font-extrabold text-white hover:bg-emerald-700">Acompanhar em Meu Perfil</Link>
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-bold text-muted">Categoria</span>
                <select value={anonymousForm.category} onChange={(event) => setAnonymousForm({ ...anonymousForm, category: event.target.value })} className="h-11 w-full rounded-lg border border-border px-3">
                  {anonymousCategories.map((category) => <option key={category}>{category}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-bold text-muted">Nível de urgência</span>
                <select value={anonymousForm.urgency} onChange={(event) => setAnonymousForm({ ...anonymousForm, urgency: event.target.value })} className="h-11 w-full rounded-lg border border-border px-3">
                  {urgencyOptions.map((urgency) => <option key={urgency}>{urgency}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-bold text-muted">Comentário</span>
                <textarea value={anonymousForm.comment} onChange={(event) => setAnonymousForm({ ...anonymousForm, comment: event.target.value })} className="min-h-40 w-full rounded-lg border border-border p-3 outline-none" placeholder="Descreva a situação, oportunidade ou sugestão" />
              </label>
              <label className="flex items-start gap-3 rounded-lg border border-border bg-slate-50 p-3 text-sm font-bold text-navy-950">
                <input type="checkbox" checked={anonymousForm.allowContact} onChange={(event) => setAnonymousForm({ ...anonymousForm, allowContact: event.target.checked })} className="mt-0.5 h-4 w-4" />
                <span>
                  Quero me identificar para a equipe responsável
                  <span className="mt-1 block text-xs font-semibold leading-5 text-muted">Ao marcar, seu nome, e-mail e WB/Login poderão ser vistos pelos perfis autorizados. Desmarcado, o envio permanece anônimo.</span>
                </span>
              </label>
              <button type="button" onClick={submitAnonymousFeedback} disabled={!anonymousForm.comment.trim()} className="premium-button h-11 px-5 text-sm font-extrabold disabled:opacity-60">Enviar feedback</button>
            </div>
            <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm font-semibold leading-6 text-blue-800">
              Sua escolha de privacidade é respeitada. Sem identificação, administradores não recebem seu nome, e-mail ou WB/Login. O sistema mantém apenas um vínculo privado para mostrar o protocolo e a resposta exclusivamente no seu próprio perfil.
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
