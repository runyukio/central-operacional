"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CircleDollarSign, Download, Eye, FileSpreadsheet, FileText, LockKeyhole, Pencil, RefreshCw, Save, Search, Send, SlidersHorizontal, Trash2, Upload, X } from "lucide-react";

import {
  BillingFiscalInvoiceUpload,
  billingFiscalUploadIsReady,
  EMPTY_BILLING_FISCAL_UPLOAD,
  type BillingFiscalInvoiceUploadValue
} from "@/components/billing-fiscal-invoice-upload";
import { EmptyState, PageHeader, Panel, StatCard, StatusBadge } from "@/components/ui/primitives";
import { calculateBillingFiscalExpectedAmount } from "@/lib/billing-fiscal-invoice";
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
    filterOptions: {
      lobs: Array<{ value: string; label: string }>;
      supervisors: Array<{ value: string; label: string }>;
      roleTitles: string[];
      skills: string[];
      shifts: Array<{ value: string; label: string }>;
      billingRules: Array<{ value: string; label: string }>;
      adjustmentTypes: string[];
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
      email: string;
      roleTitle: string;
      employeeStatus: string;
      lob: string;
      lobId: string | null;
      supervisor: string;
      supervisorId: string;
      skill: string;
      officialShift: string;
      officialShiftId: string | null;
      status: string;
      statusLabel: string;
      approvedMinutes: number;
      projectedMinutes: number;
      totalConsideredMinutes: number;
      hourlyRate: number;
      billingRule: string;
      billingRuleLabel: string;
      billingRateSource: string;
      billingWarning?: string;
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
      approvedByEmployeeAt: string;
      hasOpenAdjustment: boolean;
      adjustmentTypes: string[];
      fiscalInvoice: null | {
        id: string;
        accessKey: string;
        invoiceNumber: string;
        grossAmount: number;
        serviceDescription: string;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        submittedAt: string;
        downloadUrl: string;
      };
      hourDetails?: Array<{
        kind: "APPROVED" | "PROJECTED";
        date: string;
        shift: string;
        minutes: number;
        amount: number;
      }>;
    }>;
    adjustments: Array<{
      id: string;
      type: string;
      description: string;
      observation: string;
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
      active: boolean;
      group: string;
      skillKey: string;
      displayName: string;
      shiftBucket: string;
      effectiveFrom: string;
      updatedBy: string;
      updatedAt: string;
    }>;
    permissions: {
      canManageBilling: boolean;
    };
  };
};

type TabKey = "lob" | "employees" | "hours" | "adjustments" | "rates";

type BillingFiscalDraft = BillingFiscalInvoiceUploadValue;

type BulkAdjustmentResult = {
  fileName: string;
  referenceMonth: string;
  rowsTotal: number;
  rowsCreated: number;
  rowsError: number;
  errors: Array<{ rowNumber: number; wbLogin: string; error: string }>;
};

function billingQueryParam(name: string) {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(name) ?? "";
}

function billingInitialTab(): TabKey {
  const tab = billingQueryParam("tab");
  return tab === "employees" || tab === "hours" || tab === "adjustments" || tab === "rates" ? tab : "lob";
}

export function BillingPage() {
  const [referenceMonth, setReferenceMonth] = useState(billingQueryParam("referenceMonth") || "2026-07");
  const [employeeId] = useState(billingQueryParam("employeeId"));
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [employeeStatus, setEmployeeStatus] = useState("Todos");
  const [invoiceStatus, setInvoiceStatus] = useState("Todos");
  const [roleTitle, setRoleTitle] = useState("Todos");
  const [skill, setSkill] = useState("Todos");
  const [lob, setLob] = useState("Todos");
  const [supervisorId, setSupervisorId] = useState("Todos");
  const [shiftId, setShiftId] = useState("Todos");
  const [billingRule, setBillingRule] = useState("Todos");
  const [adjustmentType, setAdjustmentType] = useState("Todos");
  const [payload, setPayload] = useState<BillingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>(billingInitialTab);
  const [rateDraft, setRateDraft] = useState<Record<string, string>>({});
  const [adjustmentDraft, setAdjustmentDraft] = useState({ type: "Correção", description: "", amount: "", employeeInvoiceId: "" });
  const [bulkAdjustmentResult, setBulkAdjustmentResult] = useState<BulkAdjustmentResult | null>(null);
  const [editingAdjustment, setEditingAdjustment] = useState<BillingPayload["data"]["adjustments"][number] | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<BillingPayload["data"]["invoices"][number] | null>(null);
  const [selectedFiscalInvoice, setSelectedFiscalInvoice] = useState<BillingPayload["data"]["invoices"][number] | null>(null);
  const [employeePage, setEmployeePage] = useState(1);
  const bulkAdjustmentInputRef = useRef<HTMLInputElement | null>(null);
  const employeePageSize = 12;
  const data = payload?.data;
  const expectedFiscalTotal = data
    ? calculateBillingFiscalExpectedAmount({
      referenceMonth: data.referenceMonth,
      wbLogin: "",
      grossAmount: data.summary.grossAmount,
      correctionAmount: 0,
      advanceAmount: data.summary.advanceAmount,
      finalAmount: data.summary.finalAmount
    })
    : 0;
  const canManageBilling = Boolean(data?.permissions.canManageBilling);
  const billingButtonClass = "inline-flex items-center justify-center gap-2 leading-none";
  const tabs = useMemo<Array<[TabKey, string]>>(() => {
    const base: Array<[TabKey, string]> = [
      ["lob", "Consolidado por LOB"],
      ["employees", "Por colaborador"],
      ["hours", "Detalhamento de horas"]
    ];
    return canManageBilling
      ? [...base, ["adjustments", "Ajustes"], ["rates", "Configurações de valores"]]
      : base;
  }, [canManageBilling]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ referenceMonth });
    params.set("section", activeTab);
    if (employeeId) params.set("employeeId", employeeId);
    if (search.trim()) params.set("search", search.trim());
    if (employeeStatus !== "Todos") params.set("employeeStatus", employeeStatus);
    if (invoiceStatus !== "Todos") params.set("invoiceStatus", invoiceStatus);
    if (roleTitle !== "Todos") params.set("roleTitle", roleTitle);
    if (skill !== "Todos") params.set("skill", skill);
    if (lob !== "Todos") params.set("lob", lob);
    if (supervisorId !== "Todos") params.set("supervisorId", supervisorId);
    if (shiftId !== "Todos") params.set("shiftId", shiftId);
    if (billingRule !== "Todos") params.set("billingRule", billingRule);
    if (adjustmentType !== "Todos") params.set("adjustmentType", adjustmentType);
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
  }, [referenceMonth, employeeId, search, employeeStatus, invoiceStatus, roleTitle, skill, lob, supervisorId, shiftId, billingRule, adjustmentType, activeTab]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!data || canManageBilling) return;
    if (activeTab === "adjustments" || activeTab === "rates") setActiveTab("lob");
  }, [activeTab, canManageBilling, data]);

  useEffect(() => {
    if (!data?.rateConfigs.length) return;
    setRateDraft(Object.fromEntries(data.rateConfigs.map((rate) => [rate.key, String(rate.value).replace(".", ",")])));
  }, [data?.rateConfigs]);

  useEffect(() => {
    setEmployeePage(1);
  }, [search, employeeStatus, invoiceStatus, roleTitle, skill, lob, supervisorId, shiftId, billingRule, adjustmentType, referenceMonth]);

  useEffect(() => {
    if (!employeeId || !data?.invoices.length) return;
    const invoice = data.invoices.find((item) => item.employeeId === employeeId);
    if (invoice) setSelectedInvoice(invoice);
  }, [data?.invoices, employeeId]);

  useEffect(() => {
    if (!data?.invoices.length) return;
    setSelectedInvoice((current) => {
      if (!current) return current;
      return data.invoices.find((item) => item.employeeId === current.employeeId) ?? current;
    });
  }, [data?.invoices]);

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
    const target = adjustmentDraft.employeeInvoiceId;
    const employeeId = target.startsWith("employee:") ? target.replace("employee:", "") : null;
    const employeeInvoiceId = target && !employeeId ? target : null;
    await postBilling({
      action: "create-adjustment",
      referenceMonth,
      type: adjustmentDraft.type,
      description: adjustmentDraft.description,
      amount: Number(adjustmentDraft.amount.replace(",", ".")),
      employeeInvoiceId,
      employeeId
    }, "Ajuste manual criado.");
    setAdjustmentDraft({ type: "Correção", description: "", amount: "", employeeInvoiceId: "" });
  }

  async function uploadBulkAdjustments(file?: File | null) {
    if (!file) return;
    setSaving(true);
    setError("");
    setMessage("");
    setBulkAdjustmentResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("referenceMonth", referenceMonth);
      const response = await fetch("/api/billing/adjustments/bulk", {
        method: "POST",
        body: formData
      });
      const next = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(next.error ?? "Não foi possível importar os ajustes.");
      setBulkAdjustmentResult(next.data);
      setMessage(`Importação concluída: ${next.data.rowsCreated ?? 0} ajuste(s) criado(s), ${next.data.rowsError ?? 0} erro(s).`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível importar os ajustes.");
    } finally {
      if (bulkAdjustmentInputRef.current) bulkAdjustmentInputRef.current.value = "";
      setSaving(false);
    }
  }

  async function createEmployeeAdjustment(invoice: BillingPayload["data"]["invoices"][number], draft: { type: string; description: string; amount: string }) {
    await postBilling({
      action: "create-adjustment",
      referenceMonth,
      type: draft.type,
      description: draft.description,
      amount: Number(draft.amount.replace(",", ".")),
      employeeInvoiceId: invoice.id || null,
      employeeId: invoice.employeeId
    }, "Ajuste individual criado.");
  }

  async function updateAdjustment(draft: { id: string; type: string; description: string; amount: string }) {
    await postBilling({
      action: "update-adjustment",
      id: draft.id,
      type: draft.type,
      description: draft.description,
      amount: Number(draft.amount.replace(",", "."))
    }, "Ajuste manual atualizado.");
    setEditingAdjustment(null);
  }

  async function deleteAdjustment(adjustment: BillingPayload["data"]["adjustments"][number]) {
    const confirmed = window.confirm(`Excluir o ajuste "${adjustment.type}" de ${formatCurrency(adjustment.amount)}?`);
    if (!confirmed) return;
    await postBilling({ action: "delete-adjustment", id: adjustment.id }, "Ajuste manual excluído.");
  }

  async function setEmployeeInvoiceFinalized(
    invoice: BillingPayload["data"]["invoices"][number],
    finalized: boolean,
    fiscalDraft?: BillingFiscalDraft
  ) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const request = finalized
        ? (() => {
          const form = new FormData();
          form.append("action", "set-employee-invoice-finalized");
          form.append("referenceMonth", referenceMonth);
          form.append("employeeId", invoice.employeeId);
          form.append("finalized", "true");
          form.append("validationToken", fiscalDraft?.validationToken ?? "");
          if (fiscalDraft?.file) form.append("file", fiscalDraft.file);
          return { method: "POST", body: form };
        })()
        : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "set-employee-invoice-finalized",
            referenceMonth,
            employeeId: invoice.employeeId,
            finalized: false
          })
        };
      const response = await fetch("/api/billing", request);
      const next = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(next.error ?? "Não foi possível atualizar o invoice.");
      setMessage(finalized
        ? "Invoice individual finalizado manualmente, sem envio ao Omie."
        : "Invoice reaberto: a nota fiscal anterior foi removida e o colaborador já pode enviar uma nova.");
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível atualizar o invoice.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function releaseEmployeeInvoiceForReview(invoice: BillingPayload["data"]["invoices"][number]) {
    await postBilling({
      action: "release-employee-invoice-review",
      referenceMonth,
      employeeId: invoice.employeeId
    }, "Invoice individual liberado para conferência.");
  }

  const exportHref = useMemo(() => {
    const params = new URLSearchParams({ referenceMonth });
    if (employeeId) params.set("employeeId", employeeId);
    if (search.trim()) params.set("search", search.trim());
    if (employeeStatus !== "Todos") params.set("employeeStatus", employeeStatus);
    if (invoiceStatus !== "Todos") params.set("invoiceStatus", invoiceStatus);
    if (roleTitle !== "Todos") params.set("roleTitle", roleTitle);
    if (skill !== "Todos") params.set("skill", skill);
    if (lob !== "Todos") params.set("lob", lob);
    if (supervisorId !== "Todos") params.set("supervisorId", supervisorId);
    if (shiftId !== "Todos") params.set("shiftId", shiftId);
    if (billingRule !== "Todos") params.set("billingRule", billingRule);
    if (adjustmentType !== "Todos") params.set("adjustmentType", adjustmentType);
    return `/api/billing/export?${params.toString()}`;
  }, [referenceMonth, employeeId, search, employeeStatus, invoiceStatus, roleTitle, skill, lob, supervisorId, shiftId, billingRule, adjustmentType]);

  if (loading && !payload) {
    return (
      <>
        <PageHeader title="Billing" description="Carregando cálculo mensal com base nas horas aprovadas." icon={CircleDollarSign} />
        <BillingSkeleton />
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
        description="Cálculo de invoice para colaboradores PJ com base nas horas aprovadas oficiais."
        icon={CircleDollarSign}
        actions={<StatusBadge status="Acesso restrito" />}
      />

      <section className="card p-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <Label text="Mês de referência">
            <input type="month" min="2026-06" value={referenceMonth} onChange={(event) => setReferenceMonth(event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold" />
          </Label>
          <Label text="Buscar colaborador">
            <div className="premium-control flex h-10 items-center gap-2 px-3">
              <Search className="h-4 w-4 text-muted" />
              <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Nome, WB, e-mail, skill..." className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none" />
            </div>
          </Label>
          <Label text="Status do colaborador">
            <select value={employeeStatus} onChange={(event) => setEmployeeStatus(event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold">
              <option>Todos</option>
              <option>Ativo</option>
              <option>Afastado</option>
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
              <option value="FECHADO">Fechado</option>
            </select>
          </Label>
          <Label text="Cargo/Função">
            <select value={roleTitle} onChange={(event) => setRoleTitle(event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold">
              <option>Todos</option>
              {data?.filterOptions.roleTitles.map((item) => <option key={item}>{item}</option>)}
            </select>
          </Label>
          <Label text="Skill">
            <select value={skill} onChange={(event) => setSkill(event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold">
              <option>Todos</option>
              {data?.filterOptions.skills.map((item) => <option key={item}>{item}</option>)}
            </select>
          </Label>
          <Label text="LOB">
            <select value={lob} onChange={(event) => setLob(event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold">
              <option>Todos</option>
              {data?.filterOptions.lobs.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </Label>
          <Label text="Supervisor">
            <select value={supervisorId} onChange={(event) => setSupervisorId(event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold">
              <option>Todos</option>
              {data?.filterOptions.supervisors.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </Label>
          <Label text="Turno oficial">
            <select value={shiftId} onChange={(event) => setShiftId(event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold">
              <option>Todos</option>
              {data?.filterOptions.shifts.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </Label>
          <Label text="Regra Billing">
            <select value={billingRule} onChange={(event) => setBillingRule(event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold">
              <option>Todos</option>
              {data?.filterOptions.billingRules.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </Label>
          <Label text="Tipo de ajuste">
            <select value={adjustmentType} onChange={(event) => setAdjustmentType(event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold">
              <option>Todos</option>
              {data?.filterOptions.adjustmentTypes.map((item) => <option key={item}>{item}</option>)}
            </select>
          </Label>
          <div className="flex items-end gap-2">
            <button type="button" onClick={() => void load()} disabled={saving || loading} className={cn("premium-button h-10 flex-1 px-3 text-sm font-extrabold", billingButtonClass)}>
              <RefreshCw className="h-4 w-4" /> Aplicar
            </button>
            <a href={exportHref} className="premium-control inline-flex h-10 items-center justify-center gap-2 px-3 text-sm font-extrabold leading-none text-blue-700">
              <Download className="h-4 w-4" /> XLSX
            </a>
          </div>
        </div>
        <p className="mt-2 text-xs font-semibold text-muted">Billing disponível a partir de Junho/2026 apenas para colaboradores PJ. Ciclos anteriores ficam bloqueados.</p>
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
            <StatCard title="Valor NFS-e" value={formatCurrency(expectedFiscalTotal)} helper="total esperado nas notas" icon={FileText} tone="blue" />
          </div>

          <section className="grid gap-3 xl:grid-cols-[1fr_360px]">
            <div className="card overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                {tabs.map(([key, label]) => (
                  <button key={key} type="button" onClick={() => setActiveTab(key)} className={cn("inline-flex items-center justify-center rounded-lg px-3 py-2 text-xs font-black leading-none", activeTab === key ? "bg-blue-600 text-white" : "text-muted hover:bg-blue-50 hover:text-blue-700")}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="p-3">
                {activeTab === "lob" ? <LobTable rows={data.byLob} /> : null}
                {activeTab === "employees" ? (
                  <EmployeeTable
                    rows={data.invoices}
                    page={employeePage}
                    pageSize={employeePageSize}
                    onPageChange={setEmployeePage}
                    onSelect={setSelectedInvoice}
                    onOpenFiscalInvoice={setSelectedFiscalInvoice}
                  />
                ) : null}
                {activeTab === "hours" ? <HourDetailsTable rows={data.invoices} /> : null}
                {activeTab === "adjustments" ? (
                  <div className="space-y-4">
                    <AdjustmentForm draft={adjustmentDraft} setDraft={setAdjustmentDraft} invoices={data.invoices} saving={saving} onSubmit={createAdjustment} />
                    <BulkAdjustmentUpload
                      inputRef={bulkAdjustmentInputRef}
                      saving={saving}
                      result={bulkAdjustmentResult}
                      onUpload={uploadBulkAdjustments}
                    />
                    <AdjustmentsTable rows={data.adjustments} saving={saving} onEdit={setEditingAdjustment} onDelete={deleteAdjustment} />
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
                {canManageBilling ? (
                  <div className="mt-3 grid gap-2">
                    <button disabled={saving} onClick={() => postBilling({ action: "set-cycle-status", referenceMonth, status: "EM_REVISAO" }, "Ciclo marcado como Em revisão.")} className="premium-control inline-flex h-9 items-center justify-center gap-2 px-3 text-xs font-black leading-none text-navy-950">Marcar em revisão</button>
                    <button disabled={saving} onClick={() => postBilling({ action: "set-cycle-status", referenceMonth, status: "FINALIZADO_CONFERENCIA" }, "Ciclo liberado para conferência dos colaboradores.")} className="premium-button inline-flex h-9 items-center justify-center gap-2 px-3 text-xs font-black leading-none">
                      <Send className="h-4 w-4" /> Liberar conferência
                    </button>
                    <button disabled={saving} onClick={() => postBilling({ action: "set-cycle-status", referenceMonth, status: "FECHADO" }, "Ciclo fechado.")} className="premium-control inline-flex h-9 items-center justify-center gap-2 px-3 text-xs font-black leading-none text-navy-950">Fechar ciclo</button>
                  </div>
                ) : (
                  <p className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
                    Visualização restrita ao time vinculado ao seu perfil de supervisor.
                  </p>
                )}
              </Panel>
              <Panel title="Exportar Billing">
                <p className="text-sm font-semibold text-muted">Gera XLSX com Consolidado, Por LOB, Por Colaborador, Detalhamento de Horas, Ajustes, Aprovações e Configurações.</p>
                <a href={exportHref} className="premium-button mt-3 inline-flex h-10 w-full items-center justify-center gap-2 px-3 text-sm font-extrabold leading-none">
                  <Download className="h-4 w-4" /> Exportar XLSX
                </a>
              </Panel>
            </div>
          </section>
          {selectedInvoice ? (
            <EmployeeBillingDetail
              invoice={selectedInvoice}
              referenceMonth={referenceMonth}
              saving={saving}
              detailsLoaded={activeTab === "hours"}
              exportHref={`/api/billing/export?referenceMonth=${encodeURIComponent(referenceMonth)}&employeeId=${encodeURIComponent(selectedInvoice.employeeId)}`}
              canManageBilling={canManageBilling}
              onClose={() => setSelectedInvoice(null)}
              onLoadHourDetails={() => setActiveTab("hours")}
              onCreateAdjustment={(draft) => createEmployeeAdjustment(selectedInvoice, draft)}
              onReleaseForReview={() => releaseEmployeeInvoiceForReview(selectedInvoice)}
              onSetFinalized={(finalized, fiscalDraft) => setEmployeeInvoiceFinalized(selectedInvoice, finalized, fiscalDraft)}
            />
          ) : null}
          {selectedFiscalInvoice ? (
            <FiscalInvoiceModal invoice={selectedFiscalInvoice} onClose={() => setSelectedFiscalInvoice(null)} />
          ) : null}
          {editingAdjustment ? (
            <AdjustmentEditModal
              adjustment={editingAdjustment}
              saving={saving}
              onClose={() => setEditingAdjustment(null)}
              onSave={updateAdjustment}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Label({ text, children }: { text: React.ReactNode; children: React.ReactNode }) {
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

function EmployeeTable({
  rows,
  page,
  pageSize,
  onPageChange,
  onSelect,
  onOpenFiscalInvoice
}: {
  rows: BillingPayload["data"]["invoices"];
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onSelect: (row: BillingPayload["data"]["invoices"][number]) => void;
  onOpenFiscalInvoice: (row: BillingPayload["data"]["invoices"][number]) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);
  if (!rows.length) return <EmptyState title="Sem colaboradores" description="Não há invoices para os filtros selecionados." />;
  return (
    <div className="space-y-3">
      <Table
        columns={["Nome", "WB/Login", "Cargo", "Skill", "LOB", "Supervisor", "Status", "Turno", "Regra", "Valor/h", "Horas", "Final", "Invoice", "Ações"]}
        rows={pagedRows.map((row) => [
          row.employeeName,
          row.wbLogin,
          row.roleTitle,
          row.skill || "-",
          row.lob,
          row.supervisor,
          row.employeeStatus,
          row.officialShift,
          row.billingRuleLabel || row.billingRule,
          formatCurrency(row.hourlyRate),
          minutesToHours(row.totalConsideredMinutes),
          formatCurrency(row.finalAmount),
          <StatusBadge key={`${row.employeeId}-status`} status={row.statusLabel} />,
          <div key={`${row.employeeId}-actions`} className="flex items-center gap-2">
            {row.fiscalInvoice ? (
              <button
                type="button"
                onClick={() => onOpenFiscalInvoice(row)}
                className="premium-control inline-flex h-8 w-8 shrink-0 items-center justify-center p-0 text-blue-700"
                title="Ver nota fiscal"
                aria-label={`Ver nota fiscal de ${row.employeeName}`}
              >
                <FileText className="h-4 w-4" />
              </button>
            ) : null}
            <button type="button" onClick={() => onSelect(row)} className="premium-button inline-flex h-8 items-center justify-center gap-2 px-3 text-xs font-black leading-none">
              <Eye className="h-3.5 w-3.5" /> Detalhe
            </button>
          </div>
        ])}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-muted">
        <span>{rows.length} colaborador(es) encontrados</span>
        <div className="flex items-center gap-2">
          <button type="button" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)} className="premium-control h-8 px-3 disabled:opacity-50">Anterior</button>
          <span>Página {safePage} de {totalPages}</span>
          <button type="button" disabled={safePage >= totalPages} onClick={() => onPageChange(safePage + 1)} className="premium-control h-8 px-3 disabled:opacity-50">Próxima</button>
        </div>
      </div>
    </div>
  );
}

function FiscalInvoiceModal({
  invoice,
  onClose
}: {
  invoice: BillingPayload["data"]["invoices"][number];
  onClose: () => void;
}) {
  const fiscalInvoice = invoice.fiscalInvoice;
  if (!fiscalInvoice) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Fechar nota fiscal"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-navy-950/40 backdrop-blur-sm"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="fiscal-invoice-title"
        className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
              <FileText className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 id="fiscal-invoice-title" className="text-lg font-black text-navy-950">Nota fiscal</h2>
              <p className="truncate text-sm font-semibold text-muted">{invoice.employeeName} • {invoice.wbLogin}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="premium-control inline-flex h-9 w-9 shrink-0 items-center justify-center p-0" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <FiscalInvoiceField label="Chave de acesso da NFS-e">
              <p className="break-all font-mono text-sm font-black leading-6 text-navy-950">{fiscalInvoice.accessKey || "-"}</p>
            </FiscalInvoiceField>
            <FiscalInvoiceField label="Número da NFS-e">
              <p className="break-all font-mono text-sm font-black leading-6 text-navy-950">{fiscalInvoice.invoiceNumber}</p>
            </FiscalInvoiceField>
            <FiscalInvoiceField label="Valor do serviço na nota">
              <p className="text-lg font-black text-navy-950">{formatCurrency(fiscalInvoice.grossAmount)}</p>
            </FiscalInvoiceField>
          </div>

          <FiscalInvoiceField label="Descrição do serviço">
            <p className="whitespace-pre-wrap break-words text-sm font-bold leading-6 text-navy-950">{fiscalInvoice.serviceDescription}</p>
          </FiscalInvoiceField>

          <div className="flex flex-col gap-3 rounded-xl border border-border bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-blue-700 shadow-sm">
                <FileText className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="break-all text-sm font-black text-navy-950">{fiscalInvoice.fileName}</p>
                <p className="mt-0.5 text-xs font-semibold text-muted">
                  {formatFileSize(fiscalInvoice.sizeBytes)} • enviado em {fiscalInvoice.submittedAt}
                </p>
              </div>
            </div>
            <a
              href={fiscalInvoice.downloadUrl}
              download
              className="premium-button inline-flex h-10 shrink-0 items-center justify-center gap-2 px-4 text-sm font-black leading-none"
            >
              <Download className="h-4 w-4" /> Baixar nota
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

function FiscalInvoiceField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-white p-3">
      <p className="text-[11px] font-black uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function HourDetailsTable({ rows }: { rows: BillingPayload["data"]["invoices"] }) {
  const details = rows.flatMap((row) => row.hourDetails?.map((detail) => [detail.date, row.employeeName, row.wbLogin, row.lob, detail.kind === "PROJECTED" ? "Projetado" : "Aprovado", minutesToHours(detail.minutes), formatCurrency(detail.amount)]) ?? []);
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
          {invoices.map((invoice) => <option key={invoice.id || invoice.employeeId} value={invoice.id || `employee:${invoice.employeeId}`}>{invoice.employeeName}</option>)}
        </select>
        <input value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} placeholder="Valor R$" className="premium-control h-10 px-3 text-sm font-bold" />
        <button disabled={saving} onClick={onSubmit} className="premium-button inline-flex h-10 items-center justify-center gap-2 px-3 text-sm font-extrabold leading-none"><Save className="h-4 w-4" /> Criar ajuste</button>
      </div>
      <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Descrição do ajuste" className="premium-control mt-2 min-h-[72px] w-full px-3 py-2 text-sm font-semibold" />
    </div>
  );
}

function BulkAdjustmentUpload({
  inputRef,
  saving,
  result,
  onUpload
}: {
  inputRef: { current: HTMLInputElement | null };
  saving: boolean;
  result: BulkAdjustmentResult | null;
  onUpload: (file?: File | null) => void | Promise<void>;
}) {
  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-navy-950">Importar bônus e correções em lote</h3>
          <p className="mt-1 text-xs font-semibold text-muted">
            Aceita colunas <span className="font-black text-navy-950">wb_login</span>, <span className="font-black text-navy-950">correcao</span> ou <span className="font-black text-navy-950">bonus</span> e <span className="font-black text-navy-950">motivo</span>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href="/api/billing/adjustments/template" className="premium-control inline-flex h-9 items-center justify-center gap-2 px-3 text-xs font-black leading-none text-blue-700">
            <Download className="h-4 w-4" /> Baixar template
          </a>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(event) => void onUpload(event.target.files?.[0])}
          />
          <button
            type="button"
            disabled={saving}
            onClick={() => inputRef.current?.click()}
            className="premium-button inline-flex h-9 items-center justify-center gap-2 px-3 text-xs font-black leading-none"
          >
            <FileSpreadsheet className="h-4 w-4" /> Importar XLSX
          </button>
        </div>
      </div>
      {result ? (
        <div className="mt-3 rounded-lg border border-border bg-white p-3">
          <div className="grid gap-2 text-xs font-black text-navy-950 sm:grid-cols-3">
            <span>{result.rowsTotal} linha(s) lida(s)</span>
            <span className="text-emerald-700">{result.rowsCreated} ajuste(s) criado(s)</span>
            <span className={result.rowsError ? "text-red-700" : "text-muted"}>{result.rowsError} erro(s)</span>
          </div>
          {result.errors.length ? (
            <div className="mt-3 max-h-40 overflow-auto rounded-lg border border-red-100 bg-red-50 p-2">
              {result.errors.slice(0, 20).map((item) => (
                <p key={`${item.rowNumber}-${item.wbLogin}-${item.error}`} className="text-xs font-semibold text-red-800">
                  Linha {item.rowNumber}{item.wbLogin ? ` • ${item.wbLogin}` : ""}: {item.error}
                </p>
              ))}
              {result.errors.length > 20 ? <p className="mt-1 text-xs font-black text-red-800">+ {result.errors.length - 20} erro(s) não exibido(s)</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EmployeeBillingDetail({
  invoice,
  referenceMonth,
  saving,
  detailsLoaded,
  exportHref,
  canManageBilling,
  onClose,
  onLoadHourDetails,
  onCreateAdjustment,
  onReleaseForReview,
  onSetFinalized
}: {
  invoice: BillingPayload["data"]["invoices"][number];
  referenceMonth: string;
  saving: boolean;
  detailsLoaded: boolean;
  exportHref: string;
  canManageBilling: boolean;
  onClose: () => void;
  onLoadHourDetails: () => void;
  onCreateAdjustment: (draft: { type: string; description: string; amount: string }) => Promise<void>;
  onReleaseForReview: () => Promise<void>;
  onSetFinalized: (finalized: boolean, fiscalDraft?: BillingFiscalDraft) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState({ type: "Correção", amount: "", description: "" });
  const [localError, setLocalError] = useState("");
  const [finalizationOpen, setFinalizationOpen] = useState(false);
  const [fiscalError, setFiscalError] = useState("");
  const [fiscalDraft, setFiscalDraft] = useState<BillingFiscalDraft>(EMPTY_BILLING_FISCAL_UPLOAD);
  const finalized = invoice.status === "FECHADO";
  const alreadyReleasedForReview = ["DISPONIVEL_APROVACAO", "APROVADO_COLABORADOR", "AGUARDANDO_SUPERVISOR", "AGUARDANDO_ADMIN"].includes(invoice.status);
  const expectedFiscalAmount = calculateBillingFiscalExpectedAmount({
    referenceMonth,
    wbLogin: invoice.wbLogin,
    grossAmount: invoice.grossAmount,
    correctionAmount: invoice.correctionAmount,
    advanceAmount: invoice.advanceAmount,
    finalAmount: invoice.finalAmount
  });

  function openFinalizationForm() {
    setFiscalDraft(EMPTY_BILLING_FISCAL_UPLOAD);
    setFiscalError("");
    setFinalizationOpen(true);
  }

  async function finalizeInvoice() {
    setFiscalError("");
    if (!billingFiscalUploadIsReady(fiscalDraft, invoice.fiscalInvoice, expectedFiscalAmount)) {
      setFiscalError("Selecione a nota fiscal e aguarde a validação automática dos dados.");
      return;
    }
    const completed = await onSetFinalized(true, fiscalDraft);
    if (completed) setFinalizationOpen(false);
  }

  async function submit() {
    setLocalError("");
    if (finalized) {
      setLocalError("Invoice finalizado. Reabra antes de aplicar novos ajustes.");
      return;
    }
    if (!draft.description.trim()) {
      setLocalError("Descrição do ajuste é obrigatória.");
      return;
    }
    if (!Number.isFinite(Number(draft.amount.replace(",", ".")))) {
      setLocalError("Valor do ajuste é obrigatório.");
      return;
    }
    await onCreateAdjustment(draft);
    setDraft({ type: "Correção", amount: "", description: "" });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-navy-950/35 p-3 backdrop-blur-sm">
      <aside className="flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-blue-700">Detalhe individual</p>
            <h2 className="text-xl font-black text-navy-950">{invoice.employeeName}</h2>
            <p className="text-sm font-semibold text-muted">{invoice.wbLogin} • {invoice.roleTitle} • {invoice.skill || "Sem skill"} • {invoice.lob}</p>
          </div>
          <div className="flex items-center gap-2">
            {canManageBilling && !finalized ? (
              <button
                type="button"
                disabled={saving || alreadyReleasedForReview}
                onClick={() => void onReleaseForReview()}
                className="premium-control inline-flex h-9 items-center justify-center gap-2 px-3 text-xs font-black leading-none text-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Send className="h-4 w-4" /> {alreadyReleasedForReview ? "Conferência liberada" : "Liberar conferência"}
              </button>
            ) : null}
            {canManageBilling ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => finalized ? void onSetFinalized(false) : openFinalizationForm()}
                className={cn(
                  "inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-xs font-black leading-none",
                  finalized ? "border border-amber-200 bg-amber-50 text-amber-800" : "premium-button"
                )}
              >
                <LockKeyhole className="h-4 w-4" /> {finalized ? "Reabrir invoice" : "Finalizar invoice"}
              </button>
            ) : null}
            <a href={exportHref} className="premium-control inline-flex h-9 items-center justify-center gap-2 px-3 text-xs font-black leading-none text-blue-700">
              <Download className="h-4 w-4" /> Exportar
            </a>
            <button type="button" onClick={onClose} className="premium-control inline-flex h-9 w-9 items-center justify-center p-0">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {finalized ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">
              Invoice individual finalizado pelo Admin. Valores, horas e status ficam congelados até reabertura manual.
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <DetailMetric label="Horas aprovadas" value={minutesToHours(invoice.approvedMinutes)} />
            <DetailMetric label="Horas projetadas" value={minutesToHours(invoice.projectedMinutes)} />
            <DetailMetric label="Valor/hora" value={formatCurrency(invoice.hourlyRate)} helper={invoice.billingRuleLabel || invoice.billingRule} />
            <DetailMetric label="Valor bruto" value={formatCurrency(invoice.grossAmount)} />
            <DetailMetric label="Adiantamento" value={`-${formatCurrency(invoice.advanceAmount)}`} helper={invoice.manualAdvanceAmount ? `Manual: ${formatCurrency(invoice.manualAdvanceAmount)}` : "Automático/sem manual"} />
            <DetailMetric label="Campanhas" value={formatCurrency(invoice.campaignAmount)} />
            <DetailMetric label="Bônus" value={formatCurrency(invoice.bonusAmount)} />
            <DetailMetric label="Descontos" value={`-${formatCurrency(invoice.discountAmount)}`} />
            <DetailMetric label="Correções" value={formatCurrency(invoice.correctionAmount)} />
            <DetailMetric label="Ajustes" value={formatCurrency(invoice.adjustmentAmount)} />
            <DetailMetric label="Valor final" value={formatCurrency(invoice.finalAmount)} tone="green" />
            <DetailMetric label="Status invoice" value={invoice.statusLabel} />
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-[1fr_360px]">
            <Panel title="Regra aplicada">
              <div className="grid gap-2 text-sm font-semibold text-navy-950 md:grid-cols-2">
                <InfoLine label="Cargo/Função" value={invoice.roleTitle} />
                <InfoLine label="Skill" value={invoice.skill || "-"} />
                <InfoLine label="Turno oficial" value={invoice.officialShift} />
                <InfoLine label="Supervisor" value={invoice.supervisor} />
                <InfoLine label="Fonte do valor" value={invoice.billingRateSource || "-"} />
                <InfoLine label="Regra Billing" value={invoice.billingRuleLabel || invoice.billingRule} />
              </div>
              {invoice.billingWarning ? <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">{invoice.billingWarning}</p> : null}
            </Panel>

            {canManageBilling ? (
              <Panel title="Ajuste individual">
                <div className="space-y-2">
                  <select disabled={finalized} value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })} className="premium-control h-10 w-full px-3 text-sm font-bold disabled:opacity-60">
                    <option>Campanha</option>
                    <option>Adiantamento</option>
                    <option>Bônus</option>
                    <option>Desconto</option>
                    <option>Correção</option>
                  </select>
                  <input disabled={finalized} value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} placeholder="Valor R$" className="premium-control h-10 w-full px-3 text-sm font-bold disabled:opacity-60" />
                  <textarea disabled={finalized} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Descrição obrigatória" className="premium-control min-h-[92px] w-full px-3 py-2 text-sm font-semibold disabled:opacity-60" />
                  {localError ? <p className="text-xs font-bold text-red-600">{localError}</p> : null}
                  <button disabled={saving || finalized} onClick={() => void submit()} className="premium-button inline-flex h-10 w-full items-center justify-center gap-2 px-3 text-sm font-extrabold leading-none disabled:opacity-60">
                    <Save className="h-4 w-4" /> Aplicar ajuste
                  </button>
                  <p className="text-xs font-semibold text-muted">
                    {finalized ? "Reabra o invoice para aplicar novos ajustes." : "Desconto e Adiantamento reduzem o valor final mesmo se digitados como valor positivo."}
                  </p>
                </div>
              </Panel>
            ) : null}
          </div>

          <div className="mt-4">
            <Panel title="Composição das horas">
              {invoice.hourDetails?.length ? (
                <Table
                  columns={["Data", "Tipo", "Turno slot", "Horas", "Valor", "Regra"]}
                  rows={invoice.hourDetails.map((detail) => [detail.date, detail.kind === "PROJECTED" ? "Projetado" : "Aprovado", detail.shift || "-", minutesToHours(detail.minutes), formatCurrency(detail.amount), invoice.billingRuleLabel || invoice.billingRule])}
                />
              ) : (
                <div className="grid min-h-[150px] place-items-center rounded-xl border border-dashed border-border bg-gradient-to-b from-white to-slate-50 p-3 text-center">
                  <div>
                    <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-blue-50">
                      <RefreshCw className="h-5 w-5 text-blue-500" />
                    </div>
                    <h3 className="mt-2.5 text-sm font-bold text-navy-950">{detailsLoaded ? "Sem composição de horas" : "Detalhe sob demanda"}</h3>
                    <p className="mt-1 text-xs text-muted">
                      {detailsLoaded
                        ? "Não há horas aprovadas ou projetadas para exibir neste colaborador/ciclo."
                        : "Carregue a composição diária completa deste ciclo sem trazer todos os detalhes no primeiro load."}
                    </p>
                    {!detailsLoaded ? (
                      <button type="button" onClick={onLoadHourDetails} className="premium-button mt-3 inline-flex h-9 items-center justify-center gap-2 px-3 text-xs font-black leading-none">
                        <RefreshCw className="h-3.5 w-3.5" /> Carregar composição de horas
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
            </Panel>
          </div>
        </div>
      </aside>
      {finalizationOpen ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-navy-950/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="billing-finalization-title">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-blue-700">Fechamento manual</p>
                <h3 id="billing-finalization-title" className="mt-1 text-xl font-black text-navy-950">Finalizar invoice</h3>
                <p className="mt-1 text-sm font-semibold text-muted">{invoice.employeeName} • {invoice.wbLogin}</p>
              </div>
              <button type="button" disabled={saving} onClick={() => setFinalizationOpen(false)} className="premium-control inline-flex h-9 w-9 shrink-0 items-center justify-center p-0" aria-label="Fechar formulário">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <BillingFiscalInvoiceUpload
                referenceMonth={referenceMonth}
                employeeId={invoice.employeeId}
                expectedGrossAmount={expectedFiscalAmount}
                existing={invoice.fiscalInvoice}
                disabled={saving}
                value={fiscalDraft}
                onChange={setFiscalDraft}
              />
              {fiscalError ? <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{fiscalError}</p> : null}
              <p className="text-xs font-semibold text-muted">
                Basta anexar a nota. A chave, o número e o valor são lidos automaticamente; o fechamento só é liberado quando o valor do serviço confere com o valor esperado do Billing, reincorporando o adiantamento.
              </p>
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-slate-50 px-5 py-4">
              <button type="button" disabled={saving} onClick={() => setFinalizationOpen(false)} className="premium-control inline-flex h-10 items-center justify-center px-4 text-sm font-black text-navy-950 disabled:opacity-60">
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving || !billingFiscalUploadIsReady(fiscalDraft, invoice.fiscalInvoice, expectedFiscalAmount)}
                onClick={() => void finalizeInvoice()}
                className="premium-button inline-flex h-10 items-center justify-center gap-2 px-4 text-sm font-black disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
                {saving ? "Finalizando..." : "Confirmar e finalizar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DetailMetric({ label, value, helper, tone }: { label: string; value: string; helper?: string; tone?: "green" }) {
  return (
    <div className={cn("rounded-xl border border-border bg-white p-3", tone === "green" ? "bg-emerald-50/60" : "")}>
      <p className="text-[11px] font-black uppercase tracking-wide text-muted">{label}</p>
      <p className={cn("mt-1 text-lg font-black", tone === "green" ? "text-emerald-700" : "text-navy-950")}>{value}</p>
      {helper ? <p className="mt-1 text-xs font-semibold text-muted">{helper}</p> : null}
    </div>
  );
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

function AdjustmentsTable({
  rows,
  saving,
  onEdit,
  onDelete
}: {
  rows: BillingPayload["data"]["adjustments"];
  saving: boolean;
  onEdit: (row: BillingPayload["data"]["adjustments"][number]) => void;
  onDelete: (row: BillingPayload["data"]["adjustments"][number]) => void | Promise<void>;
}) {
  return (
    <Table
      columns={["Tipo", "Descrição", "Observação", "Colaborador", "LOB", "Valor", "Criado por", "Criado em", "Ações"]}
      rows={rows.map((row) => [
        row.type,
        row.description,
        row.observation || "-",
        row.employeeName || "-",
        row.lob || "-",
        formatCurrency(row.amount),
        row.createdBy || "-",
        row.createdAt,
        <div key={`${row.id}-actions`} className="flex items-center gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => onEdit(row)}
            className="premium-control inline-flex h-8 items-center justify-center gap-1.5 px-2 text-xs font-black leading-none text-blue-700 disabled:opacity-50"
          >
            <Pencil className="h-3.5 w-3.5" /> Editar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void onDelete(row)}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2 text-xs font-black leading-none text-red-700 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Excluir
          </button>
        </div>
      ])}
    />
  );
}

function AdjustmentEditModal({
  adjustment,
  saving,
  onClose,
  onSave
}: {
  adjustment: BillingPayload["data"]["adjustments"][number];
  saving: boolean;
  onClose: () => void;
  onSave: (draft: { id: string; type: string; description: string; amount: string }) => Promise<void>;
}) {
  const [draft, setDraft] = useState({
    id: adjustment.id,
    type: adjustment.type,
    description: adjustment.description,
    amount: String(adjustment.amount).replace(".", ",")
  });
  const [localError, setLocalError] = useState("");

  async function submit() {
    setLocalError("");
    if (!draft.type.trim()) {
      setLocalError("Tipo de ajuste é obrigatório.");
      return;
    }
    if (!draft.description.trim()) {
      setLocalError("Descrição do ajuste é obrigatória.");
      return;
    }
    if (!Number.isFinite(Number(draft.amount.replace(",", ".")))) {
      setLocalError("Valor do ajuste é obrigatório.");
      return;
    }
    await onSave(draft);
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-navy-950/35 p-3 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-white p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-blue-700">Editar ajuste manual</p>
            <h2 className="text-lg font-black text-navy-950">{adjustment.employeeName || adjustment.lob || "Ciclo/LOB geral"}</h2>
          </div>
          <button type="button" onClick={onClose} className="premium-control inline-flex h-9 w-9 items-center justify-center p-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Label text="Tipo">
            <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })} className="premium-control h-10 w-full px-3 text-sm font-bold">
              <option>Campanha</option>
              <option>Adiantamento</option>
              <option>Bônus</option>
              <option>Desconto</option>
              <option>Correção</option>
            </select>
          </Label>
          <Label text="Valor">
            <input value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} className="premium-control h-10 w-full px-3 text-sm font-bold" placeholder="Valor R$" />
          </Label>
        </div>
        <Label text="Descrição">
          <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className="premium-control mt-2 min-h-[96px] w-full px-3 py-2 text-sm font-semibold" />
        </Label>
        {localError ? <p className="mt-2 text-xs font-bold text-red-600">{localError}</p> : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="premium-control inline-flex h-10 items-center justify-center px-4 text-sm font-extrabold leading-none">Cancelar</button>
          <button type="button" disabled={saving} onClick={() => void submit()} className="premium-button inline-flex h-10 items-center justify-center gap-2 px-4 text-sm font-extrabold leading-none disabled:opacity-60">
            <Save className="h-4 w-4" /> Salvar edição
          </button>
        </div>
      </div>
    </div>
  );
}

function AdjustmentRequestsTable({ rows }: { rows: BillingPayload["data"]["adjustmentRequests"] }) {
  return <Table columns={["Solicitação", "Colaborador", "Item", "Status", "Valor final", "Criada em"]} rows={rows.map((row) => [row.requestCode || row.id, `${row.employeeName} (${row.wbLogin})`, row.questionedItem, <StatusBadge key={row.id} status={row.statusLabel} />, formatCurrency(row.finalAmount), row.createdAt])} />;
}

function RatesTable({ rows, draft, setDraft, saving, onSave }: { rows: BillingPayload["data"]["rateConfigs"]; draft: Record<string, string>; setDraft: (value: Record<string, string>) => void; saving: boolean; onSave: () => void }) {
  const special = rows.filter((row) => row.group === "SPECIAL");
  const agent = rows.filter((row) => row.group === "AGENT");
  const staffNames = Array.from(new Set(rows.filter((row) => row.group === "STAFF").map((row) => row.displayName))).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const rowByDisplayAndBucket = new Map(rows.filter((row) => row.group === "STAFF").map((row) => [`${row.displayName}|${row.shiftBucket}`, row]));
  return (
    <div className="space-y-3">
      <RateSection title="Valores especiais por Skill">
        <div className="grid gap-3 md:grid-cols-2">
          {special.map((rate) => <RateInput key={rate.key} rate={rate} draft={draft} setDraft={setDraft} />)}
        </div>
      </RateSection>
      <RateSection title="Valores de Agente por turno">
        <div className="grid gap-3 md:grid-cols-3">
          {agent.map((rate) => <RateInput key={rate.key} rate={rate} draft={draft} setDraft={setDraft} />)}
        </div>
      </RateSection>
      <RateSection title="Valores por Cargo/Função ou Skill staff">
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-black uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Regra</th>
                <th className="px-3 py-2">Valor Manhã/Tarde</th>
                <th className="px-3 py-2">Valor Noite</th>
                <th className="px-3 py-2">Última atualização</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white">
              {staffNames.map((name) => {
                const day = rowByDisplayAndBucket.get(`${name}|DIA`);
                const night = rowByDisplayAndBucket.get(`${name}|NOITE`);
                return (
                  <tr key={name}>
                    <td className="px-3 py-2 font-black text-navy-950">{name}</td>
                    <td className="px-3 py-2">{day ? <RateField rate={day} draft={draft} setDraft={setDraft} /> : "-"}</td>
                    <td className="px-3 py-2">{night ? <RateField rate={night} draft={draft} setDraft={setDraft} /> : "-"}</td>
                    <td className="px-3 py-2 text-xs font-semibold text-muted">{night?.updatedAt || day?.updatedAt || "valor padrão"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </RateSection>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold text-muted">Valores negativos são bloqueados no backend. Alterações ficam registradas no AuditLog.</p>
        <button disabled={saving} onClick={onSave} className="premium-button inline-flex h-10 items-center justify-center gap-2 px-4 text-sm font-extrabold leading-none"><Save className="h-4 w-4" /> Salvar valores</button>
      </div>
    </div>
  );
}

function RateSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-slate-50/70 p-3">
      <h3 className="mb-3 text-sm font-black text-navy-950">{title}</h3>
      {children}
    </section>
  );
}

function RateInput({ rate, draft, setDraft }: { rate: BillingPayload["data"]["rateConfigs"][number]; draft: Record<string, string>; setDraft: (value: Record<string, string>) => void }) {
  return (
    <label className="rounded-xl border border-border bg-white p-3">
      <span className="text-xs font-black uppercase tracking-wide text-muted">{rate.label}</span>
      <RateField rate={rate} draft={draft} setDraft={setDraft} />
      <span className="mt-1 block text-xs font-semibold text-muted">Atualizado: {rate.updatedAt || "valor padrão"}</span>
    </label>
  );
}

function RateField({ rate, draft, setDraft }: { rate: BillingPayload["data"]["rateConfigs"][number]; draft: Record<string, string>; setDraft: (value: Record<string, string>) => void }) {
  return (
    <input
      value={draft[rate.key] ?? ""}
      onChange={(event) => setDraft({ ...draft, [rate.key]: event.target.value })}
      className="premium-control mt-1 h-10 w-full min-w-[120px] px-3 text-sm font-black text-navy-950"
    />
  );
}

function BillingSkeleton() {
  return (
    <div className="space-y-4">
      <section className="card p-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded-xl bg-slate-100" />)}
        </div>
      </section>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-xl border border-border bg-white" />)}
      </div>
      <div className="grid gap-3 xl:grid-cols-[1fr_360px]">
        <div className="h-80 animate-pulse rounded-xl border border-border bg-white" />
        <div className="h-80 animate-pulse rounded-xl border border-border bg-white" />
      </div>
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
