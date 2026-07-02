"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleDollarSign, Clock, FileText, Send, WalletCards } from "lucide-react";

import { EmptyState, PageHeader, Panel, StatCard, StatusBadge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type MyInvoicePayload = {
  data: {
    referenceMonth: string;
    monthLabel: string;
    cycle: null | { status: string; statusLabel: string };
    invoice: {
      id: string;
      status: string;
      canApprove: boolean;
      canRequestAdjustment: boolean;
      approvedMinutes: number;
      projectedMinutes: number;
      projectedDays: number;
      totalConsideredMinutes: number;
      hourlyRate: number;
      billingRule: string;
      grossAmount: number;
      advanceAmount: number;
      automaticAdvanceAmount: number;
      manualAdvanceAmount: number;
      campaignAmount: number;
      bonusAmount: number;
      discountAmount: number;
      correctionAmount: number;
      otherAdjustmentAmount: number;
      adjustmentAmount: number;
      finalAmount: number;
    };
    weeklyApprovedHours: Array<{ week: string; period: string; minutes: number; hours: string }>;
    composition: Array<{ label: string; hours: string; value: number; tone: string }>;
    adjustmentDetails: Array<{
      id: string;
      type: string;
      description: string;
      observation: string;
      amount: number;
      target: string;
      createdBy: string;
      createdAt: string;
    }>;
    adjustmentRequests: Array<{
      id: string;
      requestCode: string;
      type: string;
      questionedItem: string;
      description: string;
      statusLabel: string;
      createdAt: string;
      adminFinalResponse: string;
    }>;
    history: Array<{ id: string; monthLabel: string; status: string; finalAmount: number; approvedAt: string }>;
  };
};

function invoiceQueryParam(name: string) {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(name) ?? "";
}

export function MyInvoicePage() {
  const [referenceMonth, setReferenceMonth] = useState(invoiceQueryParam("referenceMonth") || "2026-06");
  const [payload, setPayload] = useState<MyInvoicePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [adjustment, setAdjustment] = useState({ type: "Horas não consideradas", questionedItem: "Horas aprovadas", description: "" });
  const data = payload?.data;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/billing/my-invoice?referenceMonth=${encodeURIComponent(referenceMonth)}`, { cache: "no-store" });
      const next = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(next.error ?? "Não foi possível carregar seu invoice.");
      setPayload(next);
    } catch (err) {
      setPayload(null);
      setError(err instanceof Error ? err.message : "Não foi possível carregar seu invoice.");
    } finally {
      setLoading(false);
    }
  }, [referenceMonth]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(action: string, body: Record<string, unknown>, success: string) {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/billing/my-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, referenceMonth, ...body })
      });
      const next = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(next.error ?? "Não foi possível salvar.");
      setMessage(success);
      setAdjustmentOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !payload) {
    return (
      <>
        <PageHeader title="Invoice do mês" description="Carregando previsão e conferência." icon={FileText} />
        <EmptyState title="Carregando invoice" description="Buscando horas aprovadas, projeções, adiantamento e ajustes." />
      </>
    );
  }

  if (error && !payload) {
    return (
      <>
        <PageHeader title="Invoice do mês" description="Billing disponível a partir de Junho/2026 para colaboradores PJ." icon={FileText} />
        <EmptyState title="Invoice indisponível" description={error} />
      </>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Invoice do mês"
        description="Confira sua previsão PJ e, quando liberado, aprove ou solicite ajuste."
        icon={FileText}
        actions={<Link href="/meu-perfil" className="premium-control inline-flex h-9 items-center px-3 text-sm font-extrabold text-blue-700">Voltar ao perfil</Link>}
      />

      <section className="card p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <label className="block max-w-[220px]">
              <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">Mês de referência</span>
              <input type="month" min="2026-06" value={referenceMonth} onChange={(event) => setReferenceMonth(event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={data.cycle?.statusLabel ?? "Em previsão"} />
            <StatusBadge status={invoiceStatusLabel(data.invoice.status)} />
          </div>
        </div>
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700">
          {data.invoice.canApprove || data.invoice.canRequestAdjustment ? "Invoice disponível para sua conferência." : "Esta é apenas uma previsão. Os valores podem mudar até o fechamento do Billing."}
        </p>
      </section>

      {message || error ? (
        <div className={cn("rounded-xl border px-3 py-2 text-sm font-bold", error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700")}>{error || message}</div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <StatCard title="Horas aprovadas" value={minutesToHours(data.invoice.approvedMinutes)} helper="oficiais" icon={CheckCircle2} tone="green" />
        <StatCard title="Horas projetadas" value={minutesToHours(data.invoice.projectedMinutes)} helper={`${data.invoice.projectedDays} dia(s)`} icon={Clock} tone="blue" />
        <StatCard title="Total de horas" value={minutesToHours(data.invoice.totalConsideredMinutes)} helper="aprovadas + projeção" icon={FileText} tone="purple" />
        <StatCard title="Valor/hora" value={formatCurrency(data.invoice.hourlyRate)} helper={billingRuleLabel(data.invoice.billingRule)} icon={CircleDollarSign} tone="orange" />
        <StatCard title="Valor final" value={formatCurrency(data.invoice.finalAmount)} helper="previsão/invoice" icon={WalletCards} tone="green" />
      </div>

      <section className="card overflow-hidden">
        <div className="border-b border-border px-3 py-2">
          <h2 className="text-sm font-black text-navy-950">Resumo financeiro</h2>
        </div>
        <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <FinancialMetric label="Valor bruto" value={data.invoice.grossAmount} />
          <FinancialMetric label="Adiantamento" value={-data.invoice.advanceAmount} helper={data.invoice.manualAdvanceAmount ? `Manual: ${formatCurrency(data.invoice.manualAdvanceAmount)}` : "Desconto no invoice"} tone="orange" />
          <FinancialMetric label="Campanha" value={data.invoice.campaignAmount} tone="green" />
          <FinancialMetric label="Bônus" value={data.invoice.bonusAmount} tone="green" />
          <FinancialMetric label="Correção" value={data.invoice.correctionAmount} tone={data.invoice.correctionAmount < 0 ? "red" : "green"} />
          <FinancialMetric label="Desconto" value={-data.invoice.discountAmount} tone="red" />
          <FinancialMetric label="Outros ajustes" value={data.invoice.otherAdjustmentAmount} tone={data.invoice.otherAdjustmentAmount < 0 ? "red" : "green"} />
          <FinancialMetric label="Valor final" value={data.invoice.finalAmount} tone="green" highlight />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Panel title="Composição do invoice">
            <Table columns={["Descrição", "Horas", "Valor"]} rows={[
              ...data.composition.map((row) => [row.label, row.hours, <Amount key={row.label} value={row.value} />]),
              ["Valor bruto", minutesToHours(data.invoice.totalConsideredMinutes), <Amount key="gross" value={data.invoice.grossAmount} />],
              ["Valor final", "-", <Amount key="final" value={data.invoice.finalAmount} highlight />]
            ]} />
          </Panel>

          <Panel title="Detalhes dos lançamentos">
            {data.adjustmentDetails.length ? (
              <div className="grid gap-2">
                {data.adjustmentDetails.map((item) => (
                  <div key={item.id} className="rounded-xl border border-border bg-white p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-blue-700">{item.type}</span>
                          <span className="text-xs font-bold text-muted">{item.target} • {item.createdAt}</span>
                        </div>
                        <p className="mt-2 text-sm font-black text-navy-950">{item.description}</p>
                        {item.observation ? <p className="mt-1 text-xs font-semibold text-muted">{item.observation}</p> : null}
                      </div>
                      <Amount value={item.amount} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm font-semibold text-muted">Sem campanhas, bônus, correções ou descontos lançados neste ciclo.</p>
            )}
          </Panel>

          {adjustmentOpen ? (
            <Panel title="Solicitar ajuste de invoice">
              <div className="grid gap-3 md:grid-cols-2">
                <label>
                  <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">Tipo do ajuste</span>
                  <select value={adjustment.type} onChange={(event) => setAdjustment({ ...adjustment, type: event.target.value })} className="premium-control h-10 w-full px-3 text-sm font-bold">
                    <option>Horas não consideradas</option>
                    <option>Valor incorreto</option>
                    <option>Adiantamento incorreto</option>
                    <option>Campanha/Bônus</option>
                    <option>Outro</option>
                  </select>
                </label>
                <label>
                  <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">Item questionado</span>
                  <select value={adjustment.questionedItem} onChange={(event) => setAdjustment({ ...adjustment, questionedItem: event.target.value })} className="premium-control h-10 w-full px-3 text-sm font-bold">
                    <option>Horas aprovadas</option>
                    <option>Valor/hora</option>
                    <option>Adiantamento</option>
                    <option>Campanha</option>
                    <option>Valor final</option>
                    <option>Outro</option>
                  </select>
                </label>
              </div>
              <textarea value={adjustment.description} onChange={(event) => setAdjustment({ ...adjustment, description: event.target.value })} placeholder="Descreva claramente o que está sendo questionado." className="premium-control mt-3 min-h-[120px] w-full px-3 py-2 text-sm font-semibold" />
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button onClick={() => setAdjustmentOpen(false)} className="premium-control h-10 px-4 text-sm font-extrabold text-navy-950">Cancelar</button>
                <button disabled={saving} onClick={() => post("request-adjustment", adjustment, "Solicitação de ajuste enviada para o supervisor.")} className="premium-button inline-flex h-10 items-center justify-center gap-2 px-4 text-sm font-extrabold leading-none">
                  <Send className="h-4 w-4" /> Enviar solicitação
                </button>
              </div>
            </Panel>
          ) : null}
        </div>

        <div className="space-y-4">
          <Panel title="Ações">
            <div className="grid gap-2">
              <button disabled={!data.invoice.canApprove || saving} onClick={() => post("approve", {}, "Invoice aprovado com sucesso.")} className="premium-button inline-flex h-10 w-full items-center justify-center gap-2 px-3 text-sm font-extrabold leading-none disabled:cursor-not-allowed disabled:opacity-50">
                <CheckCircle2 className="h-4 w-4" /> Aprovar invoice
              </button>
              <button disabled={!data.invoice.canRequestAdjustment || saving} onClick={() => setAdjustmentOpen(true)} className="premium-control inline-flex h-10 w-full items-center justify-center px-3 text-sm font-extrabold leading-none text-orange-700 disabled:cursor-not-allowed disabled:opacity-50">
                Solicitar ajuste
              </button>
            </div>
            <p className="mt-3 text-xs font-semibold text-muted">Enquanto o invoice estiver disponível para conferência, você pode enviar novas solicitações de ajuste. Após aprovar, novos ajustes dependem de reabertura pelo Admin Central.</p>
          </Panel>

          <Panel title="Solicitações de ajuste">
            {data.adjustmentRequests.length ? (
              <div className="space-y-2">
                {data.adjustmentRequests.map((request) => (
                  <div key={request.id} className="rounded-xl border border-border bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-navy-950">{request.requestCode || request.type}</p>
                        <p className="mt-1 text-xs font-semibold text-muted">{request.questionedItem} • {request.createdAt}</p>
                      </div>
                      <StatusBadge status={request.statusLabel} />
                    </div>
                    <p className="mt-2 text-sm font-semibold text-muted">{request.description}</p>
                    {request.adminFinalResponse ? <p className="mt-2 text-sm font-bold text-emerald-700">Resposta Admin: {request.adminFinalResponse}</p> : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm font-semibold text-muted">Nenhum ajuste solicitado neste ciclo.</p>
            )}
          </Panel>

        </div>
      </section>
    </div>
  );
}

function Table({ columns, rows }: { columns: string[]; rows: Array<Array<React.ReactNode>> }) {
  if (!rows.length) return <EmptyState title="Sem dados" description="Não há registros para este período." />;
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="min-w-full divide-y divide-border text-left text-sm">
        <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-wide text-muted">
          <tr>{columns.map((column) => <th key={column} className="whitespace-nowrap px-3 py-2">{column}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border bg-white">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-2 font-bold text-navy-950">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Amount({ value, highlight = false }: { value: number; highlight?: boolean }) {
  return <span className={cn("font-black", value < 0 ? "text-red-600" : highlight ? "text-emerald-700" : "text-navy-950")}>{formatCurrency(value)}</span>;
}

function FinancialMetric({ label, value, helper, tone, highlight = false }: { label: string; value: number; helper?: string; tone?: "green" | "red" | "orange"; highlight?: boolean }) {
  const color = value < 0 || tone === "red"
    ? "text-red-700"
    : tone === "green" || highlight
      ? "text-emerald-700"
      : tone === "orange"
        ? "text-orange-700"
        : "text-navy-950";
  const bg = tone === "red" || value < 0
    ? "bg-red-50/70"
    : tone === "green" || highlight
      ? "bg-emerald-50/70"
      : tone === "orange"
        ? "bg-orange-50/70"
        : "bg-white";
  return (
    <div className={cn("rounded-xl border border-border p-3", bg)}>
      <p className="text-[11px] font-black uppercase tracking-wide text-muted">{label}</p>
      <p className={cn("mt-1 text-lg font-black", color)}>{formatCurrency(value)}</p>
      {helper ? <p className="mt-1 text-xs font-semibold text-muted">{helper}</p> : null}
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

function billingRuleLabel(value: string) {
  const labels: Record<string, string> = {
    BILINGUAL: "Bilingual",
    RA: "RA",
    TURNO_MANHA: "Turno Manhã",
    TURNO_TARDE: "Turno Tarde",
    TURNO_NOITE: "Turno Noite"
  };
  return labels[value] ?? value;
}

function invoiceStatusLabel(value: string) {
  const labels: Record<string, string> = {
    EM_PREVISAO: "Em previsão",
    DISPONIVEL_APROVACAO: "Disponível para aprovação",
    APROVADO_COLABORADOR: "Aprovado pelo colaborador",
    AGUARDANDO_SUPERVISOR: "Aguardando supervisor",
    AGUARDANDO_ADMIN: "Aguardando Admin",
    AJUSTE_CONCLUIDO: "Ajuste concluído"
  };
  return labels[value] ?? value;
}
