"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleDollarSign, Download, FileSpreadsheet, LockKeyhole, RefreshCw, Save, Send, SlidersHorizontal } from "lucide-react";

import { EmptyState, PageHeader, Panel, StatCard, StatusBadge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type BillingPayload = {
  data: {
    referenceMonth: string;
    monthLabel: string;
    startMonth: string;
    cycle: {
      id: string;
      referenceMonth: string;
      status: string;
      statusLabel: string;
      updatedAt: string;
    };
    summary: {
      grossAmount: number;
      advanceAmount: number;
      adjustmentAmount: number;
      finalAmount: number;
      approvedMinutes: number;
      agentsWithHours: number;
      cycleStatusLabel: string;
    };
    byLob: Array<{
      lob: string;
      agents: number;
      approvedMinutes: number;
      grossAmount: number;
      advanceAmount: number;
      adjustmentAmount: number;
      finalAmount: number;
    }>;
    invoices: Array<{
      id: string;
      employeeId: string;
      employeeName: string;
      wbLogin: string;
      employeeStatus: string;
      lob: string;
      supervisor: string;
      skill: string;
      officialShift: string;
      status: string;
      statusLabel: string;
      approvedMinutes: number;
      projectedMinutes: number;
      totalConsideredMinutes: number;
      hourlyRate: number;
      billingRule: string;
      grossAmount: number;
      advanceAmount: number;
      campaignAmount: number;
      adjustmentAmount: number;
      finalAmount: number;
      approvedByEmployeeAt: string;
      hasOpenAdjustment: boolean;
    }>;
    adjustments: Array<{
      id: string;
      type: string;
      description: string;
      amount: number;
      employeeName: string;
      lob: string;
      createdBy: string;
      createdAt: string;
    }>;
    adjustmentRequests: Array<{
      id: string;
      requestCode: string;
      employeeName: string;
      wbLogin: string;
      type: string;
      questionedItem: string;
      description: string;
      supervisorObservation: string;
      adminFinalResponse: string;
      status: string;
      statusLabel: string;
      createdAt: string;
      finalAmount: number;
    }>;
    rateConfigs: Array<{
      id: string;
      key: string;
      label: string;
      value: number;
      updatedBy: string;
      updatedAt: string;
    }>;
  };
};

type TabKey = "lob" | "employees" | "hours" | "adjustments" | "rates";

export function BillingPage() {
  const [referenceMonth, setReferenceMonth] = useState("2026-06");
  const [search, setSearch] = useState("");
  const [employeeStatus, setEmployeeStatus] = useState("Ambos");
  const [invoiceStatus, setInvoiceStatus] = useState("Todos");
  const [payload, setPayload] = useState<BillingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("lob");
  const [rateDraft, setRateDraft] = useState<Record<string, string>>({});
  const [adjustmentDraft, setAdjustmentDraft] = useState({ type: "Correção", description: "", amount: "", employeeInvoiceId: "" });
  const data = payload?.data;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ referenceMonth });
    if (search.trim()) params.set("search", search.trim());
    if (employeeStatus !== "Ambos") params.set("employeeStatus", employeeStatus);
    if (invoiceStatus !== "Todos") params.set("invoiceStatus", invoiceStatus);
    try {
      const response = await fetch(`/api/billing?${params.toString()}`, { cache: "no-store" });
      const next = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(next.error ?? "Não foi possível carregar Billing.");
      setPayload(next);
    } catch (err) {
      setPayload(null);
      setError(err instanceof Error ? err.message : "Não foi possível carregar Billing.");
    } finally {
      setLoading(false);
    }
  }, [referenceMonth, search, employeeStatus, invoiceStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!data?.rateConfigs.length) return;
    setRateDraft(Object.fromEntries(data.rateConfigs.map((rate) => [rate.key, String(rate.value).replace(".", ",")])));
  }, [data?.rateConfigs]);

  async function postBilling(body: Record<string, unknown>, success: string) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const next = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(next.error ?? "Não foi possível salvar.");
      setMessage(success);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function saveRates() {
    const rates = Object.fromEntries(Object.entries(rateDraft).map(([key, value]) => [key, Number(value.replace(",", "."))]));
    await postBilling({ action: "save-rates", rates }, "Configurações de valores atualizadas.");
  }

  async function createAdjustment() {
    await postBilling({
      action: "create-adjustment",
      referenceMonth,
      type: adjustmentDraft.type,
      description: adjustmentDraft.description,
      amount: Number(adjustmentDraft.amount.replace(",", ".")),
      employeeInvoiceId: adjustmentDraft.employeeInvoiceId || null
    }, "Ajuste manual criado.");
    setAdjustmentDraft({ type: "Correção", description: "", amount: "", employeeInvoiceId: "" });
  }

  const exportHref = useMemo(() => {
    const params = new URLSearchParams({ referenceMonth });
    if (search.trim()) params.set("search", search.trim());
    if (employeeStatus !== "Ambos") params.set("employeeStatus", employeeStatus);
    if (invoiceStatus !== "Todos") params.set("invoiceStatus", invoiceStatus);
    return `/api/billing/export?${params.toString()}`;
  }, [referenceMonth, search, employeeStatus, invoiceStatus]);

  if (loading && !payload) {
    return (
      <>
        <PageHeader title="Billing" description="Carregando cálculo mensal com base nas horas aprovadas." icon={CircleDollarSign} />
        <EmptyState title="Carregando Billing" description="Buscando horas aprovadas, adiantamentos e ajustes do ciclo." />
      </>
    );
  }

  if (error && !payload) {
    return (
      <>
        <PageHeader title="Billing" description="Acesso restrito ao Admin Central." icon={LockKeyhole} />
        <EmptyState title="Billing indisponível" description={error} />
      </>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Billing"
        description="Cálculo de invoice com base nas horas aprovadas oficiais."
        icon={CircleDollarSign}
        actions={<StatusBadge status="Acesso restrito" />}
      />

      <section className="card p-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Label text="Mês de referência">
            <input type="month" min="2026-06" value={referenceMonth} onChange={(event) => setReferenceMonth(event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold" />
          </Label>
          <Label text="Status do colaborador">
            <select value={employeeStatus} onChange={(event) => setEmployeeStatus(event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold">
              <option>Ambos</option>
              <option>Ativo</option>
              <option>Desligado</option>
            </select>
          </Label>
          <Label text="Status do invoice">
            <select value={invoiceStatus} onChange={(event) => setInvoiceStatus(event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold">
              <option>Todos</option>
              <option value="EM_PREVISAO">Em previsão</option>
              <option value="DISPONIVEL_APROVACAO">Disponível para aprovação</option>
              <option value="APROVADO_COLABORADOR">Aprovado pelo colaborador</option>
              <option value="AGUARDANDO_SUPERVISOR">Aguardando supervisor</option>
              <option value="AGUARDANDO_ADMIN">Aguardando Admin</option>
            </select>
          </Label>
          <Label text="Colaborador / WB-Login">
            <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void load()} placeholder="Buscar colaborador" className="premium-control h-10 w-full px-3 text-sm font-bold" />
          </Label>
          <div className="flex items-end gap-2">
            <button type="button" onClick={() => void load()} disabled={saving || loading} className="premium-button h-10 flex-1 px-3 text-sm font-extrabold">
              <RefreshCw className="h-4 w-4" /> Aplicar
            </button>
            <a href={exportHref} className="premium-control inline-flex h-10 items-center gap-2 px-3 text-sm font-extrabold text-blue-700">
              <Download className="h-4 w-4" /> XLSX
            </a>
          </div>
        </div>
        <p className="mt-2 text-xs font-semibold text-muted">Billing disponível a partir de Junho/2026. Ciclos anteriores ficam bloqueados.</p>
      </section>

      {message || error ? (
        <div className={cn("rounded-xl border px-3 py-2 text-sm font-bold", error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700")}>
          {error || message}
        </div>
      ) : null}

      {data ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <StatCard title="Valor bruto" value={formatCurrency(data.summary.grossAmount)} helper={data.monthLabel} icon={CircleDollarSign} tone="blue" />
            <StatCard title="Adiantamento" value={`-${formatCurrency(data.summary.advanceAmount)}`} helper="desconto automático" icon={SlidersHorizontal} tone="orange" />
            <StatCard title="Ajustes" value={formatCurrency(data.summary.adjustmentAmount)} helper="campanhas e correções" icon={FileSpreadsheet} tone={data.summary.adjustmentAmount < 0 ? "red" : "green"} />
            <StatCard title="Valor final" value={formatCurrency(data.summary.finalAmount)} helper="invoice" icon={CheckCircle2} tone="green" />
            <StatCard title="Horas aprovadas" value={minutesToHours(data.summary.approvedMinutes)} helper="oficiais" icon={RefreshCw} tone="purple" />
            <StatCard title="Status ciclo" value={data.cycle.statusLabel} helper={data.cycle.updatedAt} icon={LockKeyhole} tone="orange" />
          </div>

          <section className="grid gap-3 xl:grid-cols-[1fr_360px]">
            <div className="card overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                {([
                  ["lob", "Consolidado por LOB"],
                  ["employees", "Por colaborador"],
                  ["hours", "Detalhamento de horas"],
                  ["adjustments", "Ajustes"],
                  ["rates", "Configurações de valores"]
                ] as Array<[TabKey, string]>).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => setActiveTab(key)} className={cn("rounded-lg px-3 py-2 text-xs font-black", activeTab === key ? "bg-blue-600 text-white" : "text-muted hover:bg-blue-50 hover:text-blue-700")}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="p-3">
                {activeTab === "lob" ? <LobTable rows={data.byLob} /> : null}
                {activeTab === "employees" ? <EmployeeTable rows={data.invoices} /> : null}
                {activeTab === "hours" ? <HourDetailsTable rows={data.invoices} /> : null}
                {activeTab === "adjustments" ? (
                  <div className="space-y-4">
                    <AdjustmentForm draft={adjustmentDraft} setDraft={setAdjustmentDraft} invoices={data.invoices} saving={saving} onSubmit={createAdjustment} />
                    <AdjustmentsTable rows={data.adjustments} />
                    <AdjustmentRequestsTable rows={data.adjustmentRequests} />
                  </div>
                ) : null}
                {activeTab === "rates" ? (
                  <RatesTable rows={data.rateConfigs} draft={rateDraft} setDraft={setRateDraft} saving={saving} onSave={saveRates} />
                ) : null}
              </div>
            </div>

            <div className="space-y-3">
              <Panel title="Resumo do ciclo">
                <div className="space-y-2 text-sm">
                  <InfoLine label="Mês" value={data.monthLabel} />
                  <InfoLine label="Status" value={<StatusBadge status={data.cycle.statusLabel} />} />
                  <InfoLine label="Agentes com horas" value={data.summary.agentsWithHours} />
                  <InfoLine label="Valor final" value={formatCurrency(data.summary.finalAmount)} />
                </div>
                <div className="mt-3 grid gap-2">
                  <button disabled={saving} onClick={() => postBilling({ action: "set-cycle-status", referenceMonth, status: "EM_REVISAO" }, "Ciclo marcado como Em revisão.")} className="premium-control h-9 px-3 text-xs font-black text-navy-950">Marcar em revisão</button>
                  <button disabled={saving} onClick={() => postBilling({ action: "set-cycle-status", referenceMonth, status: "FINALIZADO_CONFERENCIA" }, "Ciclo liberado para conferência dos colaboradores.")} className="premium-button h-9 px-3 text-xs font-black">
                    <Send className="h-4 w-4" /> Liberar conferência
                  </button>
                  <button disabled={saving} onClick={() => postBilling({ action: "set-cycle-status", referenceMonth, status: "FECHADO" }, "Ciclo fechado.")} className="premium-control h-9 px-3 text-xs font-black text-navy-950">Fechar ciclo</button>
                </div>
              </Panel>
              <Panel title="Exportar Billing">
                <p className="text-sm font-semibold text-muted">Gera XLSX com Consolidado, Por LOB, Por Colaborador, Detalhamento de Horas, Ajustes, Aprovações e Configurações.</p>
                <a href={exportHref} className="premium-button mt-3 inline-flex h-10 w-full items-center justify-center gap-2 px-3 text-sm font-extrabold">
                  <Download className="h-4 w-4" /> Exportar XLSX
                </a>
              </Panel>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">{text}</span>
      {children}
    </label>
  );
}

function InfoLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/70 py-2 last:border-b-0">
      <span className="text-xs font-black uppercase tracking-wide text-muted">{label}</span>
      <span className="text-right text-sm font-extrabold text-navy-950">{value}</span>
    </div>
  );
}

function LobTable({ rows }: { rows: BillingPayload["data"]["byLob"] }) {
  return <Table columns={["LOB", "Agentes", "Horas", "Bruto", "Adiant.", "Ajustes", "Final"]} rows={rows.map((row) => [row.lob, row.agents, minutesToHours(row.approvedMinutes), formatCurrency(row.grossAmount), formatCurrency(row.advanceAmount), formatCurrency(row.adjustmentAmount), formatCurrency(row.finalAmount)])} />;
}

function EmployeeTable({ rows }: { rows: BillingPayload["data"]["invoices"] }) {
  return <Table columns={["Colaborador", "WB/Login", "LOB", "Status", "Horas", "Valor/h", "Final", "Invoice"]} rows={rows.map((row) => [row.employeeName, row.wbLogin, row.lob, row.employeeStatus, minutesToHours(row.totalConsideredMinutes), formatCurrency(row.hourlyRate), formatCurrency(row.finalAmount), <StatusBadge key={row.id} status={row.statusLabel} />])} />;
}

function HourDetailsTable({ rows }: { rows: BillingPayload["data"]["invoices"] }) {
  const details = rows.flatMap((row) => (row as any).hourDetails?.map((detail: any) => [detail.date, row.employeeName, row.wbLogin, row.lob, detail.kind === "PROJECTED" ? "Projetado" : "Aprovado", minutesToHours(detail.minutes), formatCurrency(detail.amount)]) ?? []);
  return <Table columns={["Data", "Colaborador", "WB/Login", "LOB", "Tipo", "Horas", "Valor"]} rows={details} />;
}

function AdjustmentForm({ draft, setDraft, invoices, saving, onSubmit }: { draft: { type: string; description: string; amount: string; employeeInvoiceId: string }; setDraft: (value: { type: string; description: string; amount: string; employeeInvoiceId: string }) => void; invoices: BillingPayload["data"]["invoices"]; saving: boolean; onSubmit: () => void }) {
  return (
    <div className="rounded-xl border border-border bg-slate-50 p-3">
      <h3 className="text-sm font-black text-navy-950">Novo ajuste manual</h3>
      <div className="mt-3 grid gap-2 md:grid-cols-4">
        <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })} className="premium-control h-10 px-3 text-sm font-bold">
          <option>Campanha</option>
          <option>Adiantamento</option>
          <option>Bônus</option>
          <option>Desconto</option>
          <option>Correção</option>
        </select>
        <select value={draft.employeeInvoiceId} onChange={(event) => setDraft({ ...draft, employeeInvoiceId: event.target.value })} className="premium-control h-10 px-3 text-sm font-bold">
          <option value="">Ciclo/LOB geral</option>
          {invoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.employeeName}</option>)}
        </select>
        <input value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} placeholder="Valor R$" className="premium-control h-10 px-3 text-sm font-bold" />
        <button disabled={saving} onClick={onSubmit} className="premium-button h-10 px-3 text-sm font-extrabold"><Save className="h-4 w-4" /> Criar ajuste</button>
      </div>
      <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Descrição do ajuste" className="premium-control mt-2 min-h-[72px] w-full px-3 py-2 text-sm font-semibold" />
    </div>
  );
}

function AdjustmentsTable({ rows }: { rows: BillingPayload["data"]["adjustments"] }) {
  return <Table columns={["Tipo", "Descrição", "Colaborador", "LOB", "Valor", "Criado por", "Criado em"]} rows={rows.map((row) => [row.type, row.description, row.employeeName || "-", row.lob || "-", formatCurrency(row.amount), row.createdBy || "-", row.createdAt])} />;
}

function AdjustmentRequestsTable({ rows }: { rows: BillingPayload["data"]["adjustmentRequests"] }) {
  return <Table columns={["Solicitação", "Colaborador", "Item", "Status", "Valor final", "Criada em"]} rows={rows.map((row) => [row.requestCode || row.id, `${row.employeeName} (${row.wbLogin})`, row.questionedItem, <StatusBadge key={row.id} status={row.statusLabel} />, formatCurrency(row.finalAmount), row.createdAt])} />;
}

function RatesTable({ rows, draft, setDraft, saving, onSave }: { rows: BillingPayload["data"]["rateConfigs"]; draft: Record<string, string>; setDraft: (value: Record<string, string>) => void; saving: boolean; onSave: () => void }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((rate) => (
          <label key={rate.key} className="rounded-xl border border-border bg-white p-3">
            <span className="text-xs font-black uppercase tracking-wide text-muted">{rate.label}</span>
            <input value={draft[rate.key] ?? ""} onChange={(event) => setDraft({ ...draft, [rate.key]: event.target.value })} className="premium-control mt-2 h-10 w-full px-3 text-sm font-black text-navy-950" />
            <span className="mt-1 block text-xs font-semibold text-muted">Atualizado: {rate.updatedAt || "valor padrão"}</span>
          </label>
        ))}
      </div>
      <button disabled={saving} onClick={onSave} className="premium-button h-10 px-4 text-sm font-extrabold"><Save className="h-4 w-4" /> Salvar valores</button>
    </div>
  );
}

function Table({ columns, rows }: { columns: string[]; rows: Array<Array<React.ReactNode>> }) {
  if (!rows.length) return <EmptyState title="Sem dados" description="Não há registros para os filtros selecionados." />;
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="min-w-full divide-y divide-border text-left text-sm">
        <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-wide text-muted">
          <tr>{columns.map((column) => <th key={column} className="whitespace-nowrap px-3 py-2">{column}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border bg-white">
          {rows.map((row, index) => (
            <tr key={index} className="hover:bg-blue-50/40">
              {row.map((cell, cellIndex) => <td key={cellIndex} className="max-w-[260px] px-3 py-2 font-bold text-navy-950">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function minutesToHours(minutes: number) {
  const safe = Math.max(0, Math.round(minutes || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number.isFinite(value) ? value : 0);
}
