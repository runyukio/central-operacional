"use client";

import {
  Check,
  CheckCircle2,
  Gift,
  History,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Ticket,
  Trash2,
  UsersRound,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader, Panel, StatCard, StatusBadge } from "@/components/ui/primitives";
import { formatRaffleNumber } from "@/lib/campaign-raffle-core";
import { cn } from "@/lib/utils";

type CampaignSummary = {
  id: string;
  name: string;
  status: string;
  minNumber: number;
  maxNumber: number;
  usedTickets: number;
  distributions: number;
  createdAt: string;
};

type StaffPayload = {
  view: "staff";
  access: { canManage: boolean; canViewOwn: boolean };
  campaigns: CampaignSummary[];
  selectedCampaignId: string | null;
  summary: { usedTickets: number; availableTickets: number; coveredAgents: number; distributions: number };
  agents: Array<{ id: string; name: string; wbLogin: string; shift: string; assignedTickets: number }>;
  recentDistributions: Array<{
    id: string;
    employeeCount: number;
    ticketsPerEmployee: number;
    totalTickets: number;
    assignedBy: string;
    createdAt: string;
  }>;
  ticketHolders: Array<{
    employeeId: string;
    name: string;
    wbLogin: string;
    status: string;
    tickets: Array<{ id: string; number: number; assignedAt: string }>;
  }>;
};

type AgentPayload = {
  view: "agent";
  access: { canManage: boolean; canViewOwn: boolean };
  employee: { name: string; wbLogin: string; lob: string };
  campaigns: Array<{
    id: string;
    name: string;
    status: string;
    minNumber: number;
    maxNumber: number;
    createdAt: string;
    tickets: Array<{ number: number; assignedAt: string }>;
  }>;
};

type RafflePayload = StaffPayload | AgentPayload;
type PendingDistribution = {
  employeeIds: string[];
  employeeNames: string[];
  ticketsPerEmployee: number;
  totalTickets: number;
  idempotencyKey: string;
  stage: "review" | "confirm";
};
type PendingTicketDeletion = {
  ticketId: string;
  number: number;
  employeeName: string;
  wbLogin: string;
};

export function CampaignRafflePage({ view }: { view: "agent" | "staff" }) {
  const [payload, setPayload] = useState<RafflePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [ticketsPerEmployee, setTicketsPerEmployee] = useState(1);
  const [agentSearch, setAgentSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<PendingDistribution | null>(null);
  const [sending, setSending] = useState(false);
  const [pendingDeletion, setPendingDeletion] = useState<PendingTicketDeletion | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadDashboard = useCallback(async (campaignId?: string) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ view });
      const effectiveCampaignId = campaignId ?? selectedCampaignId;
      if (effectiveCampaignId) params.set("campaignId", effectiveCampaignId);
      const response = await fetch(`/api/campaigns/raffle?${params.toString()}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || result.error || "Não foi possível carregar a campanha.");
      setPayload(result.data as RafflePayload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar a campanha.");
    } finally {
      setLoading(false);
    }
  }, [selectedCampaignId, view]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  if (loading && !payload) {
    return <CampaignLoading />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Rifa"
        description={view === "staff" ? "Distribuição segura de tickets da rifa para agentes ADS." : "Consulte os tickets atribuídos a você em cada campanha."}
        icon={Gift}
        actions={(
          <button type="button" onClick={() => void loadDashboard()} className="premium-control inline-flex h-10 items-center gap-2 px-3.5 text-sm font-extrabold text-navy-950">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Atualizar
          </button>
        )}
      />

      {error ? <Alert tone="error">{error}</Alert> : null}
      {success ? <Alert tone="success">{success}</Alert> : null}
      {payload?.view === "staff" ? (
        <StaffCampaignView
          payload={payload}
          selectedCampaignId={selectedCampaignId}
          setSelectedCampaignId={(id) => {
            setSelectedCampaignId(id);
            setSelectedEmployeeIds([]);
          }}
          selectedEmployeeIds={selectedEmployeeIds}
          setSelectedEmployeeIds={setSelectedEmployeeIds}
          ticketsPerEmployee={ticketsPerEmployee}
          setTicketsPerEmployee={setTicketsPerEmployee}
          agentSearch={agentSearch}
          setAgentSearch={setAgentSearch}
          onCreate={() => setCreateOpen(true)}
          onPrepare={(employeeNames) => {
            const totalTickets = selectedEmployeeIds.length * ticketsPerEmployee;
            setPending({
              employeeIds: [...selectedEmployeeIds],
              employeeNames,
              ticketsPerEmployee,
              totalTickets,
              idempotencyKey: createIdempotencyKey(),
              stage: "review"
            });
          }}
          onDeleteTicket={setPendingDeletion}
        />
      ) : payload?.view === "agent" ? <AgentCampaignView payload={payload} /> : null}

      {createOpen ? (
        <Modal title="Criar campanha" description="A faixa será fixa de 1 a 10.000 e os números não se repetirão dentro desta campanha." onClose={() => !creating && setCreateOpen(false)}>
          <label className="block">
            <span className="mb-1.5 block text-xs font-extrabold uppercase tracking-wide text-muted">Nome da campanha</span>
            <input autoFocus value={campaignName} onChange={(event) => setCampaignName(event.target.value)} maxLength={100} placeholder="Ex.: Campanha ADS — Setembro" className="premium-control h-11 w-full px-3 text-sm font-bold outline-none" />
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" disabled={creating} onClick={() => setCreateOpen(false)} className="premium-control h-10 px-4 text-sm font-extrabold text-navy-950">Cancelar</button>
            <button
              type="button"
              disabled={creating || campaignName.trim().length < 3}
              onClick={async () => {
                setCreating(true);
                setError("");
                try {
                  const response = await fetch("/api/campaigns/raffle", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "CREATE_CAMPAIGN", name: campaignName })
                  });
                  const result = await response.json();
                  if (!response.ok) throw new Error(result.message || result.error || "Não foi possível criar a campanha.");
                  setCreateOpen(false);
                  setCampaignName("");
                  setSelectedCampaignId(result.data.id);
                  setSuccess(`Campanha “${result.data.name}” criada.`);
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : "Não foi possível criar a campanha.");
                } finally {
                  setCreating(false);
                }
              }}
              className="premium-button h-10 px-4 text-sm font-extrabold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? "Criando..." : "Criar campanha"}
            </button>
          </div>
        </Modal>
      ) : null}

      {pending ? (
        <DistributionConfirmationModal
          pending={pending}
          sending={sending}
          onClose={() => !sending && setPending(null)}
          onContinue={() => setPending((current) => current ? { ...current, stage: "confirm" } : null)}
          onBack={() => setPending((current) => current ? { ...current, stage: "review" } : null)}
          onSend={async () => {
            const staffPayload = payload?.view === "staff" ? payload : null;
            const campaignId = selectedCampaignId || staffPayload?.selectedCampaignId || "";
            setSending(true);
            setError("");
            try {
              const response = await fetch("/api/campaigns/raffle", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "DISTRIBUTE",
                  campaignId,
                  employeeIds: pending.employeeIds,
                  ticketsPerEmployee: pending.ticketsPerEmployee,
                  idempotencyKey: pending.idempotencyKey
                })
              });
              const result = await response.json();
              if (!response.ok) throw new Error(result.message || result.error || "Não foi possível distribuir os tickets.");
              setPending(null);
              setSelectedEmployeeIds([]);
              setSuccess(`${result.data.totalTickets} tickets distribuídos com sucesso, sem duplicidade.`);
              await loadDashboard(campaignId);
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : "Não foi possível distribuir os tickets.");
            } finally {
              setSending(false);
            }
          }}
        />
      ) : null}

      {pendingDeletion ? (
        <TicketDeletionModal
          ticket={pendingDeletion}
          deleting={deleting}
          onClose={() => !deleting && setPendingDeletion(null)}
          onDelete={async () => {
            const staffPayload = payload?.view === "staff" ? payload : null;
            const campaignId = selectedCampaignId || staffPayload?.selectedCampaignId || "";
            setDeleting(true);
            setError("");
            try {
              const response = await fetch("/api/campaigns/raffle", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ticketId: pendingDeletion.ticketId })
              });
              const result = await response.json();
              if (!response.ok) throw new Error(result.message || result.error || "Não foi possível excluir o ticket.");
              setPendingDeletion(null);
              setSuccess(`Ticket ${formatRaffleNumber(result.data.number)} de ${result.data.employeeName} excluído.`);
              await loadDashboard(campaignId);
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : "Não foi possível excluir o ticket.");
            } finally {
              setDeleting(false);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function StaffCampaignView({
  payload,
  selectedCampaignId,
  setSelectedCampaignId,
  selectedEmployeeIds,
  setSelectedEmployeeIds,
  ticketsPerEmployee,
  setTicketsPerEmployee,
  agentSearch,
  setAgentSearch,
  onCreate,
  onPrepare,
  onDeleteTicket
}: {
  payload: StaffPayload;
  selectedCampaignId: string;
  setSelectedCampaignId: (id: string) => void;
  selectedEmployeeIds: string[];
  setSelectedEmployeeIds: (ids: string[]) => void;
  ticketsPerEmployee: number;
  setTicketsPerEmployee: (quantity: number) => void;
  agentSearch: string;
  setAgentSearch: (search: string) => void;
  onCreate: () => void;
  onPrepare: (employeeNames: string[]) => void;
  onDeleteTicket: (ticket: PendingTicketDeletion) => void;
}) {
  const [staffTab, setStaffTab] = useState<"distribute" | "tickets">("distribute");
  const [ticketSearch, setTicketSearch] = useState("");
  const campaignId = selectedCampaignId || payload.selectedCampaignId || "";
  const selectedCampaign = payload.campaigns.find((campaign) => campaign.id === campaignId) ?? null;
  const selectedSet = useMemo(() => new Set(selectedEmployeeIds), [selectedEmployeeIds]);
  const normalizedSearch = agentSearch.trim().toLowerCase();
  const filteredAgents = payload.agents.filter((agent) => !normalizedSearch || `${agent.name} ${agent.wbLogin} ${agent.shift}`.toLowerCase().includes(normalizedSearch));
  const totalTickets = selectedEmployeeIds.length * ticketsPerEmployee;
  const canPrepare = Boolean(selectedCampaign && selectedCampaign.status === "ACTIVE" && selectedEmployeeIds.length && ticketsPerEmployee > 0 && totalTickets <= payload.summary.availableTickets);
  const normalizedTicketSearch = ticketSearch.trim().toLowerCase();
  const filteredTicketHolders = useMemo(() => payload.ticketHolders.filter((holder) => (
    !normalizedTicketSearch
    || `${holder.name} ${holder.wbLogin} ${holder.tickets.map((ticket) => formatRaffleNumber(ticket.number)).join(" ")}`.toLowerCase().includes(normalizedTicketSearch)
  )), [normalizedTicketSearch, payload.ticketHolders]);

  return (
    <>
      <div className="card flex flex-col gap-3 p-3 md:flex-row md:items-end md:justify-between">
        <label className="block min-w-0 flex-1">
          <span className="mb-1.5 block text-xs font-extrabold uppercase tracking-wide text-muted">Campanha ativa</span>
          <select value={campaignId} onChange={(event) => setSelectedCampaignId(event.target.value)} className="premium-control h-11 w-full appearance-none px-3 text-sm font-extrabold text-navy-950 outline-none">
            {!payload.campaigns.length ? <option value="">Nenhuma campanha criada</option> : null}
            {payload.campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name} · {campaign.status === "ACTIVE" ? "Ativa" : "Encerrada"}</option>)}
          </select>
        </label>
        <button type="button" onClick={onCreate} className="premium-button inline-flex h-11 items-center justify-center gap-2 px-4 text-sm font-extrabold">
          <Plus className="h-4 w-4" /> Nova campanha
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Tickets distribuídos" value={payload.summary.usedTickets.toLocaleString("pt-BR")} helper="números únicos" icon={Ticket} tone="blue" />
        <StatCard title="Tickets disponíveis" value={payload.summary.availableTickets.toLocaleString("pt-BR")} helper="até 10.000" icon={ShieldCheck} tone="green" />
        <StatCard title="Agentes contemplados" value={payload.summary.coveredAgents} helper="agentes ADS" icon={UsersRound} tone="purple" />
        <StatCard title="Envios realizados" value={payload.summary.distributions} helper="lotes confirmados" icon={History} tone="cyan" />
      </div>

      {!selectedCampaign ? (
        <div className="card grid min-h-[260px] place-items-center p-8 text-center">
          <div>
            <Gift className="mx-auto h-10 w-10 text-blue-500" />
            <h2 className="mt-3 text-lg font-black text-navy-950">Crie a primeira campanha</h2>
            <p className="mt-1 text-sm text-muted">Depois você poderá selecionar os agentes ADS e distribuir números aleatórios.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="card flex flex-wrap gap-2 p-2">
            <button
              type="button"
              onClick={() => setStaffTab("distribute")}
              className={cn("rounded-xl px-4 py-2 text-sm font-extrabold transition", staffTab === "distribute" ? "bg-blue-600 text-white shadow-soft" : "text-muted hover:bg-slate-50 hover:text-navy-950")}
            >
              Distribuir tickets
            </button>
            <button
              type="button"
              onClick={() => setStaffTab("tickets")}
              className={cn("rounded-xl px-4 py-2 text-sm font-extrabold transition", staffTab === "tickets" ? "bg-blue-600 text-white shadow-soft" : "text-muted hover:bg-slate-50 hover:text-navy-950")}
            >
              Todos os tickets
            </button>
          </div>

          {staffTab === "distribute" ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.7fr)]">
          <Panel title="Distribuir tickets">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_190px]">
              <label className="block">
                <span className="mb-1.5 block text-xs font-extrabold uppercase tracking-wide text-muted">Buscar agente ADS</span>
                <span className="premium-control flex h-10 items-center gap-2 px-3">
                  <Search className="h-4 w-4 text-muted" />
                  <input value={agentSearch} onChange={(event) => setAgentSearch(event.target.value)} placeholder="Nome, WB ou turno" className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none" />
                </span>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-extrabold uppercase tracking-wide text-muted">Tickets por agente</span>
                <input type="number" min={1} max={10_000} value={ticketsPerEmployee} onChange={(event) => setTicketsPerEmployee(Math.max(1, Number(event.target.value) || 1))} className="premium-control h-10 w-full px-3 text-sm font-extrabold outline-none" />
              </label>
            </div>

            <div className="mt-3 overflow-hidden rounded-xl border border-border bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-slate-50 px-3 py-2">
                <p className="text-xs font-extrabold text-navy-950">{selectedEmployeeIds.length} selecionado(s)</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setSelectedEmployeeIds(Array.from(new Set([...selectedEmployeeIds, ...filteredAgents.map((agent) => agent.id)])))} className="text-xs font-extrabold text-blue-600">Selecionar visíveis</button>
                  {selectedEmployeeIds.length ? <button type="button" onClick={() => setSelectedEmployeeIds([])} className="text-xs font-extrabold text-red-500">Limpar</button> : null}
                </div>
              </div>
              <div className="max-h-[390px] divide-y divide-border/70 overflow-y-auto">
                {filteredAgents.map((agent) => {
                  const checked = selectedSet.has(agent.id);
                  return (
                    <label key={agent.id} className={cn("flex cursor-pointer items-center gap-3 px-3 py-2.5 transition hover:bg-blue-50/40", checked && "bg-blue-50/65")}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setSelectedEmployeeIds(checked ? selectedEmployeeIds.filter((id) => id !== agent.id) : [...selectedEmployeeIds, agent.id])}
                        className="h-4 w-4 rounded border-border text-blue-600"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-extrabold text-navy-950">{agent.name}</p>
                        <p className="truncate text-xs text-muted">{agent.wbLogin} · {agent.shift}</p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-extrabold text-muted">{agent.assignedTickets} atuais</span>
                    </label>
                  );
                })}
                {!filteredAgents.length ? <p className="px-3 py-8 text-center text-sm font-bold text-muted">Nenhum agente ADS encontrado.</p> : null}
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50/70 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-wide text-blue-700">Total do envio</p>
                <p className="mt-0.5 text-2xl font-black text-navy-950">{totalTickets.toLocaleString("pt-BR")} tickets</p>
                <p className="text-xs text-muted">{selectedEmployeeIds.length} agentes × {ticketsPerEmployee} por agente</p>
              </div>
              <button
                type="button"
                disabled={!canPrepare}
                onClick={() => onPrepare(payload.agents.filter((agent) => selectedSet.has(agent.id)).map((agent) => agent.name))}
                className="premium-button inline-flex h-11 items-center justify-center gap-2 px-5 text-sm font-extrabold disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-4 w-4" /> Preparar envio
              </button>
            </div>
            {totalTickets > payload.summary.availableTickets ? <p className="mt-2 text-xs font-bold text-red-600">O envio excede os {payload.summary.availableTickets.toLocaleString("pt-BR")} tickets disponíveis.</p> : null}
          </Panel>

          <Panel title="Histórico de envios">
            <div className="space-y-2.5">
              {payload.recentDistributions.map((distribution) => (
                <div key={distribution.id} className="rounded-xl border border-border bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-black text-navy-950">{distribution.totalTickets.toLocaleString("pt-BR")} tickets</p>
                      <p className="mt-0.5 text-xs text-muted">{distribution.employeeCount} agentes · {distribution.ticketsPerEmployee} por agente</p>
                    </div>
                    <StatusBadge status="Confirmado" />
                  </div>
                  <p className="mt-2 text-[11px] font-semibold text-muted">{formatDateTime(distribution.createdAt)} · {distribution.assignedBy}</p>
                </div>
              ))}
              {!payload.recentDistributions.length ? <p className="py-8 text-center text-sm font-bold text-muted">Nenhum envio realizado nesta campanha.</p> : null}
            </div>
          </Panel>
            </div>
          ) : (
            <TicketAssignmentsPanel
              holders={filteredTicketHolders}
              search={ticketSearch}
              setSearch={setTicketSearch}
              onDeleteTicket={onDeleteTicket}
            />
          )}
        </>
      )}
    </>
  );
}

function TicketAssignmentsPanel({
  holders,
  search,
  setSearch,
  onDeleteTicket
}: {
  holders: StaffPayload["ticketHolders"];
  search: string;
  setSearch: (value: string) => void;
  onDeleteTicket: (ticket: PendingTicketDeletion) => void;
}) {
  const visibleTickets = holders.reduce((total, holder) => total + holder.tickets.length, 0);
  return (
    <Panel title="Agentes e tickets">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="block min-w-0 flex-1">
          <span className="mb-1.5 block text-xs font-extrabold uppercase tracking-wide text-muted">Buscar agente ou ticket</span>
          <span className="premium-control flex h-10 items-center gap-2 px-3">
            <Search className="h-4 w-4 text-muted" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome, WB ou número" className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none" />
          </span>
        </label>
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-right">
          <p className="text-[11px] font-extrabold uppercase tracking-wide text-blue-700">Resultado</p>
          <p className="text-sm font-black text-navy-950">{holders.length} agentes · {visibleTickets} tickets</p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {holders.map((holder) => (
          <section key={holder.employeeId} className="overflow-hidden rounded-xl border border-border bg-white">
            <div className="flex flex-col gap-2 border-b border-border bg-slate-50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-navy-950">{holder.name}</p>
                <p className="truncate text-xs font-semibold text-muted">{holder.wbLogin} · {holder.status}</p>
              </div>
              <span className="w-fit rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-extrabold text-blue-700">{holder.tickets.length} ticket(s)</span>
            </div>
            <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
              {holder.tickets.map((ticket) => (
                <div key={ticket.id} className="flex items-center justify-between gap-2 rounded-xl border border-blue-100 bg-blue-50/45 px-3 py-2">
                  <div>
                    <p className="font-mono text-sm font-black tracking-wider text-navy-950">{formatRaffleNumber(ticket.number)}</p>
                    <p className="mt-0.5 text-[10px] font-semibold text-muted">{formatDateTime(ticket.assignedAt)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteTicket({
                      ticketId: ticket.id,
                      number: ticket.number,
                      employeeName: holder.name,
                      wbLogin: holder.wbLogin
                    })}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-red-200 bg-white text-red-600 transition hover:bg-red-50"
                    aria-label={`Excluir ticket ${formatRaffleNumber(ticket.number)} de ${holder.name}`}
                    title="Excluir ticket"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
        {!holders.length ? (
          <div className="grid min-h-[220px] place-items-center rounded-xl border border-dashed border-border bg-slate-50 p-8 text-center">
            <div>
              <Ticket className="mx-auto h-9 w-9 text-blue-400" />
              <p className="mt-3 text-sm font-black text-navy-950">Nenhum ticket encontrado</p>
              <p className="mt-1 text-xs font-semibold text-muted">Ajuste a busca ou distribua os primeiros tickets desta campanha.</p>
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function AgentCampaignView({ payload }: { payload: AgentPayload }) {
  const totalTickets = payload.campaigns.reduce((total, campaign) => total + campaign.tickets.length, 0);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard title="Meus tickets" value={totalTickets} helper="em todas as campanhas" icon={Ticket} tone="blue" />
        <StatCard title="Campanhas" value={payload.campaigns.length} helper="com números recebidos" icon={Gift} tone="purple" />
        <StatCard title="Operação" value={payload.employee.lob} helper={`${payload.employee.name} · ${payload.employee.wbLogin}`} icon={ShieldCheck} tone="green" />
      </div>

      {payload.campaigns.length ? payload.campaigns.map((campaign) => (
        <section key={campaign.id} className="card overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-border bg-gradient-to-r from-blue-50/80 via-white to-violet-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-black text-navy-950">{campaign.name}</h2>
              <p className="mt-0.5 text-xs font-semibold text-muted">Faixa {campaign.minNumber.toLocaleString("pt-BR")}–{campaign.maxNumber.toLocaleString("pt-BR")} · recebidos {campaign.tickets.length}</p>
            </div>
            <StatusBadge status={campaign.status === "ACTIVE" ? "Ativa" : "Encerrada"} />
          </div>
          <div className="p-4">
            <p className="mb-3 text-xs font-extrabold uppercase tracking-[0.16em] text-muted">Seus números</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-10">
              {campaign.tickets.map((ticket) => (
                <div key={ticket.number} className="relative overflow-hidden rounded-xl border border-blue-200 bg-gradient-to-br from-white to-blue-50 px-2 py-3 text-center shadow-soft">
                  <span className="absolute -right-2 -top-2 h-7 w-7 rounded-full border border-blue-100 bg-white" />
                  <Ticket className="mx-auto mb-1 h-4 w-4 text-blue-500" />
                  <p className="font-mono text-base font-black tracking-wider text-navy-950">{formatRaffleNumber(ticket.number)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )) : (
        <div className="card grid min-h-[320px] place-items-center p-8 text-center">
          <div>
            <Gift className="mx-auto h-12 w-12 text-blue-400" />
            <h2 className="mt-3 text-lg font-black text-navy-950">Você ainda não recebeu tickets</h2>
            <p className="mt-1 max-w-md text-sm text-muted">Quando WFM ou ADM realizar uma distribuição, seus números aparecerão aqui automaticamente.</p>
          </div>
        </div>
      )}
    </>
  );
}

function DistributionConfirmationModal({
  pending,
  sending,
  onClose,
  onContinue,
  onBack,
  onSend
}: {
  pending: PendingDistribution;
  sending: boolean;
  onClose: () => void;
  onContinue: () => void;
  onBack: () => void;
  onSend: () => void;
}) {
  return (
    <Modal
      title={pending.stage === "review" ? "1ª confirmação · revisar envio" : "2ª confirmação · autorizar distribuição"}
      description={pending.stage === "review" ? "Confira cuidadosamente os agentes e a quantidade antes de continuar." : "Esta etapa cria os tickets e registra o envio no histórico."}
      onClose={onClose}
    >
      {pending.stage === "review" ? (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <ReviewValue label="Agentes" value={pending.employeeIds.length.toLocaleString("pt-BR")} />
            <ReviewValue label="Por agente" value={pending.ticketsPerEmployee.toLocaleString("pt-BR")} />
            <ReviewValue label="Total" value={pending.totalTickets.toLocaleString("pt-BR")} highlight />
          </div>
          <div className="mt-3 max-h-48 overflow-y-auto rounded-xl border border-border bg-slate-50 p-3">
            <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-muted">Agentes selecionados</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {pending.employeeNames.map((name) => <p key={name} className="flex items-center gap-1.5 text-xs font-bold text-navy-950"><Check className="h-3.5 w-3.5 text-emerald-600" /> {name}</p>)}
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="premium-control h-10 px-4 text-sm font-extrabold text-navy-950">Cancelar</button>
            <button type="button" onClick={onContinue} className="premium-button h-10 px-4 text-sm font-extrabold">Continuar</button>
          </div>
        </>
      ) : (
        <>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold leading-relaxed text-amber-900">
            Serão distribuídos <strong>{pending.totalTickets.toLocaleString("pt-BR")} tickets únicos</strong> entre {pending.employeeIds.length} agentes ADS. Os números serão sorteados somente após a confirmação.
          </div>
          <p className="mt-4 text-sm font-semibold leading-6 text-muted">Revise o total acima e clique em confirmar para concluir. Não é necessário digitar nenhuma frase.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" disabled={sending} onClick={onBack} className="premium-control h-10 px-4 text-sm font-extrabold text-navy-950">Voltar</button>
            <button type="button" disabled={sending} onClick={onSend} className="premium-button inline-flex h-10 items-center gap-2 px-4 text-sm font-extrabold disabled:cursor-not-allowed disabled:opacity-50">
              <ShieldCheck className="h-4 w-4" /> {sending ? "Distribuindo..." : "Confirmar e distribuir"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function TicketDeletionModal({
  ticket,
  deleting,
  onClose,
  onDelete
}: {
  ticket: PendingTicketDeletion;
  deleting: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <Modal
      title="Excluir ticket"
      description="O número ficará disponível novamente para futuros sorteios desta campanha."
      onClose={onClose}
    >
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-xs font-extrabold uppercase tracking-wide text-red-700">Ticket selecionado</p>
        <p className="mt-1 font-mono text-2xl font-black tracking-wider text-navy-950">{formatRaffleNumber(ticket.number)}</p>
        <p className="mt-2 text-sm font-bold text-red-800">{ticket.employeeName} · {ticket.wbLogin}</p>
      </div>
      <p className="mt-4 text-sm font-semibold leading-6 text-muted">A exclusão será registrada na auditoria. Não é necessário digitar nenhuma frase para confirmar.</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" disabled={deleting} onClick={onClose} className="premium-control h-10 px-4 text-sm font-extrabold text-navy-950">Cancelar</button>
        <button type="button" disabled={deleting} onClick={onDelete} className="inline-flex h-10 items-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-extrabold text-white shadow-soft transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">
          <Trash2 className="h-4 w-4" /> {deleting ? "Excluindo..." : "Excluir ticket"}
        </button>
      </div>
    </Modal>
  );
}

function Modal({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-navy-950/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Fechar" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-2xl border border-white/70 bg-white p-5 shadow-2xl">
        <button type="button" onClick={onClose} className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-xl border border-border text-muted hover:bg-slate-50" aria-label="Fechar"><X className="h-4 w-4" /></button>
        <div className="pr-12">
          <h2 className="text-xl font-black text-navy-950">{title}</h2>
          <p className="mt-1 text-sm font-semibold text-muted">{description}</p>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

function ReviewValue({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return <div className={cn("rounded-xl border p-3", highlight ? "border-blue-200 bg-blue-50" : "border-border bg-white")}><p className="text-[11px] font-extrabold uppercase tracking-wide text-muted">{label}</p><p className="mt-1 text-xl font-black text-navy-950">{value}</p></div>;
}

function Alert({ tone, children }: { tone: "error" | "success"; children: React.ReactNode }) {
  return <div className={cn("flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold", tone === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700")}>{tone === "success" ? <CheckCircle2 className="h-4 w-4" /> : <X className="h-4 w-4" />}{children}</div>;
}

function CampaignLoading() {
  return <div className="space-y-4"><div className="h-16 animate-pulse rounded-2xl bg-slate-100" /><div className="grid gap-3 sm:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-2xl bg-slate-100" />)}</div><div className="h-[420px] animate-pulse rounded-2xl bg-slate-100" /></div>;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

function createIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `raffle-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
