"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  Clock,
  DollarSign,
  Download,
  Eye,
  FileSpreadsheet,
  History,
  LockKeyhole,
  PencilLine,
  Plus,
  RefreshCw,
  Save,
  Target,
  TrendingDown,
  TrendingUp,
  Upload,
  X
} from "lucide-react";

import { EmptyState, PageHeader, Panel, StatCard, StatusBadge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type FinanceiroRecord = {
  id: string;
  invoiceCycleMonth: string;
  invoiceCycleLabel: string;
  costCenter: string;
  status: string;
  statusLabel: string;
  maxHoursCapacity: string;
  billableHoursActual: string;
  trainingHours: string;
  adherenceLabel: string;
  adherencePercent: number;
  differenceHours: string;
  differenceMinutes: number;
  penaltyLabel: string;
  penaltyPercent: number;
  notes: string;
  source: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  adjustments: Array<{
    id: string;
    fieldName: string;
    oldValue: string;
    newValue: string;
    adjustmentType: string;
    description: string;
    createdBy: string;
    createdAt: string;
  }>;
};

type FinanceiroUpload = {
  id: string;
  fileName: string;
  rowsTotal: number;
  rowsValid: number;
  rowsError: number;
  rowsInserted: number;
  rowsUpdated: number;
  uploadedBy: string;
  uploadedAt: string;
  status: string;
};

type FinanceiroPayload = {
  data: {
    filters: {
      invoiceCycleMonth: string;
      costCenter: string;
      source: string;
      search: string;
    };
    filterOptions: {
      months: string[];
      costCenters: string[];
      sources: string[];
    };
    summary: {
      maxHoursCapacity: string;
      billableHoursActual: string;
      trainingHours: string;
      adherencePercent: number;
      differenceHours: string;
      differenceMinutes: number;
      penaltyPercent: number;
      recordsCount: number;
    };
    analytics: FinanceiroAnalytics;
    records: FinanceiroRecord[];
    uploads: FinanceiroUpload[];
    canManage: boolean;
  };
};

type FinanceiroParameter = {
  id: string;
  invoiceCycleMonth: string;
  invoiceCycleLabel: string;
  costCenter: string;
  kwaiHourlyUsd: number;
  globalHourlyUsd: number;
  trainingHourlyUsd: number;
  exchangeRateUsdBrl: number;
  notes: string;
  updatedAt: string;
  isDefault: boolean;
};

type FinanceiroAnalyticsRow = {
  key: string;
  invoiceCycleMonth: string;
  invoiceCycleLabel: string;
  costCenter: string;
  status: string;
  statusLabel: string;
  parameters: FinanceiroParameter;
  hours: {
    maxHoursCapacity: string;
    billableActual: string;
    training: string;
  };
  values: {
    kwaiRevenueUsd: number;
    globalRevenueUsd: number;
    trainingRevenueUsd: number;
    penaltyPercent: number;
    penaltyUsd: number;
    penaltyBrl: number;
    totalRevenueUsd: number;
    totalRevenueBrl: number;
    exchangeRateUsdBrl: number;
  };
  costs: {
    approvedCostBrl: number;
    projectedCostBrl: number;
    billingNetCostBrl: number;
    grossAmountBrl: number;
    finalAmountBrl: number;
  };
  result: {
    resultBrl: number;
    marginPercent: number;
  };
};

type FinanceiroCostAnalyticsRow = {
  key: string;
  invoiceCycleMonth: string;
  invoiceCycleLabel: string;
  costCenter: string;
  status: string;
  statusLabel: string;
  costs: FinanceiroAnalyticsRow["costs"];
};

type FinanceiroAnalytics = {
  currentMonth: string;
  hoursSummary: { maxHoursCapacity: string; billableActual: string; training: string };
  valueSummary: { revenueUsd: number; revenueBrl: number };
  costSummary: { costBrl: number };
  resultSummary: { resultBrl: number; marginPercent: number };
  rows: FinanceiroAnalyticsRow[];
  costRows: FinanceiroCostAnalyticsRow[];
  parameters: FinanceiroParameter[];
};

type FinanceiroTab = "history" | "values" | "parameters";

type FinanceiroParameterForm = {
  invoiceCycleMonth: string;
  costCenter: string;
  kwaiHourlyUsd: string;
  globalHourlyUsd: string;
  trainingHourlyUsd: string;
  exchangeRateUsdBrl: string;
  notes: string;
};

type PreviewRow = {
  rowNumber: number;
  invoiceCycleMonth: string;
  costCenter: string;
  status: string;
  maxHoursCapacityMinutes: number;
  billableHoursActualMinutes: number;
  trainingHoursMinutes: number;
  adherencePercent: number;
  differenceMinutes: number;
  penaltyPercent: number;
  notes: string;
  source: string;
  action: "create" | "update" | "ignore";
  errors: string[];
  warnings: string[];
  display: {
    invoiceCycleMonth: string;
    maxHoursCapacity: string;
    billableHoursActual: string;
    trainingHours: string;
    status: string;
    adherencePercent: string;
    differenceHours: string;
    penaltyPercent: string;
  };
};

type PreviewPayload = {
  fileName: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  createdRows: number;
  updatedRows: number;
  rows: PreviewRow[];
};

type FinanceiroRecordForm = {
  id?: string;
  invoiceCycleMonth: string;
  costCenter: string;
  status: string;
  maxHoursCapacity: string;
  billableHoursActual: string;
  trainingHours: string;
  adherencePercent: string;
  differenceHours: string;
  penaltyPercent: string;
  notes: string;
  source: string;
};

const adjustmentFields = [
  { value: "maxHoursCapacityMinutes", label: "Max Hours (Capacity)" },
  { value: "billableHoursActualMinutes", label: "Billable Hours (Real)" },
  { value: "trainingHoursMinutes", label: "Training Hours" },
  { value: "adherencePercent", label: "Aderence %" },
  { value: "differenceMinutes", label: "Difference" },
  { value: "penaltyPercent", label: "Penalty %" },
  { value: "status", label: "Status" },
  { value: "notes", label: "Notes" },
  { value: "source", label: "Source" }
];

const adjustmentTypes = ["Correção de horas", "Correção de aderence", "Correção de penalty", "Observação", "Outro"];
const financeRecordStatusOptions = [
  { value: "PROJECAO", label: "Projeção" },
  { value: "EM_VALIDACAO", label: "Em validação" },
  { value: "FECHADO", label: "Fechado" }
];

export function FinanceiroPage() {
  const [activeTab, setActiveTab] = useState<FinanceiroTab>("history");
  const [invoiceCycleMonth, setInvoiceCycleMonth] = useState("");
  const [costCenter, setCostCenter] = useState("Todos");
  const [source, setSource] = useState("Todos");
  const [search, setSearch] = useState("");
  const [payload, setPayload] = useState<FinanceiroPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<FinanceiroRecord | null>(null);
  const [adjustRecord, setAdjustRecord] = useState<FinanceiroRecord | null>(null);
  const [recordForm, setRecordForm] = useState<FinanceiroRecordForm | null>(null);
  const [parameterForm, setParameterForm] = useState<FinanceiroParameterForm | null>(null);
  const [uploadsOpen, setUploadsOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [uploading, setUploading] = useState(false);
  const [savingRecord, setSavingRecord] = useState(false);
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [toast, setToast] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (invoiceCycleMonth) params.set("invoiceCycleMonth", invoiceCycleMonth);
    if (costCenter !== "Todos") params.set("costCenter", costCenter);
    if (source !== "Todos") params.set("source", source);
    if (search.trim()) params.set("search", search.trim());
    const response = await fetch(`/api/financeiro?${params.toString()}`, { cache: "no-store" });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(json.message || json.error || "Não foi possível carregar Financeiro.");
      setLoading(false);
      return;
    }
    setPayload(json);
    setLoading(false);
  }, [invoiceCycleMonth, costCenter, source, search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const exportHref = useMemo(() => {
    const params = new URLSearchParams();
    if (invoiceCycleMonth) params.set("invoiceCycleMonth", invoiceCycleMonth);
    if (costCenter !== "Todos") params.set("costCenter", costCenter);
    if (source !== "Todos") params.set("source", source);
    if (search.trim()) params.set("search", search.trim());
    return `/api/financeiro/export?${params.toString()}`;
  }, [invoiceCycleMonth, costCenter, source, search]);

  async function handlePreviewUpload(file?: File) {
    if (!file) return;
    setUploading(true);
    setPreview(null);
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch("/api/financeiro/import/preview", { method: "POST", body: formData });
    const json = await response.json().catch(() => ({}));
    setUploading(false);
    if (!response.ok) {
      setToast(json.message || json.error || "Não foi possível enviar o arquivo.");
      return;
    }
    setPreview(json);
  }

  async function handleCommitUpload() {
    if (!preview) return;
    setUploading(true);
    const response = await fetch("/api/financeiro/import/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: preview.fileName, rows: preview.rows })
    });
    const json = await response.json().catch(() => ({}));
    setUploading(false);
    if (!response.ok) {
      setToast(json.message || json.error || "Não foi possível confirmar o upload.");
      return;
    }
    setToast("Upload financeiro confirmado com sucesso.");
    setUploadOpen(false);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    await fetchData();
  }

  const summary = payload?.data.summary;
  const analytics = payload?.data.analytics;
  const canManage = payload?.data.canManage ?? false;
  const monthOptions = useMemo(
    () => buildMonthOptions(invoiceCycleMonth, payload?.data.filterOptions.months ?? payload?.data.records.map((record) => record.invoiceCycleMonth) ?? []),
    [invoiceCycleMonth, payload?.data.filterOptions.months, payload?.data.records]
  );

  function openNewRecordForm() {
    setRecordForm({
      invoiceCycleMonth: invoiceCycleMonth || defaultMonth(),
      costCenter: costCenter !== "Todos" ? costCenter : "",
      status: "PROJECAO",
      maxHoursCapacity: "",
      billableHoursActual: "",
      trainingHours: "0:00",
      adherencePercent: "",
      differenceHours: "",
      penaltyPercent: "0",
      notes: "",
      source: "Manual"
    });
  }

  function openEditRecordForm(record: FinanceiroRecord) {
    setRecordForm({
      id: record.id,
      invoiceCycleMonth: record.invoiceCycleMonth,
      costCenter: record.costCenter,
      status: record.status || "PROJECAO",
      maxHoursCapacity: record.maxHoursCapacity,
      billableHoursActual: record.billableHoursActual,
      trainingHours: record.trainingHours,
      adherencePercent: record.adherenceLabel.replace("%", ""),
      differenceHours: record.differenceHours,
      penaltyPercent: record.penaltyLabel.replace("%", ""),
      notes: record.notes,
      source: record.source || "Manual"
    });
  }

  async function saveRecord(form: FinanceiroRecordForm) {
    setSavingRecord(true);
    const response = await fetch("/api/financeiro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save-record", ...form })
    });
    const json = await response.json().catch(() => ({}));
    setSavingRecord(false);
    if (!response.ok) {
      setToast(json.message || json.error || "Não foi possível salvar o registro financeiro.");
      return;
    }
    setToast(form.id ? "Registro financeiro atualizado com sucesso." : "Registro financeiro criado com sucesso.");
    setRecordForm(null);
    await fetchData();
  }

  function openParameterForm(parameter?: FinanceiroParameter) {
    setParameterForm({
      invoiceCycleMonth: parameter?.invoiceCycleMonth || invoiceCycleMonth || defaultMonth(),
      costCenter: parameter?.costCenter || (costCenter !== "Todos" ? costCenter : ""),
      kwaiHourlyUsd: String(parameter?.kwaiHourlyUsd ?? 9.39).replace(".", ","),
      globalHourlyUsd: String(parameter?.globalHourlyUsd ?? 5.965).replace(".", ","),
      trainingHourlyUsd: String(parameter?.trainingHourlyUsd ?? 1.45).replace(".", ","),
      exchangeRateUsdBrl: String(parameter?.exchangeRateUsdBrl ?? 0).replace(".", ","),
      notes: parameter?.notes ?? ""
    });
  }

  async function saveParameter(form: FinanceiroParameterForm) {
    setSavingRecord(true);
    const response = await fetch("/api/financeiro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save-parameter", ...form })
    });
    const json = await response.json().catch(() => ({}));
    setSavingRecord(false);
    if (!response.ok) {
      setToast(json.message || json.error || "Não foi possível salvar os parâmetros.");
      return;
    }
    setToast("Parâmetros financeiros salvos com sucesso.");
    setParameterForm(null);
    await fetchData();
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Financeiro"
        description="Acompanhamento restrito por ciclo de invoice, LOB, receita, custos e penalty percentual."
        icon={LockKeyhole}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-extrabold text-blue-700">
              <LockKeyhole className="h-4 w-4" />
              Acesso restrito
            </span>
            <button type="button" onClick={() => setUploadsOpen(true)} className="premium-control h-10 px-3 text-sm font-extrabold text-navy-950">
              <History className="mr-2 inline h-4 w-4" />
              Histórico de uploads
            </button>
            {canManage ? (
              <>
                <a href="/api/financeiro/template" className="premium-control inline-flex h-10 items-center justify-center px-3 text-sm font-extrabold text-navy-950">
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Baixar template
                </a>
                <button type="button" onClick={openNewRecordForm} className="premium-control h-10 px-3 text-sm font-extrabold text-navy-950">
                  <Plus className="mr-2 inline h-4 w-4" />
                  Adicionar manualmente
                </button>
                <button type="button" onClick={() => setUploadOpen(true)} className="premium-button h-10 px-3 text-sm font-extrabold">
                  <Upload className="mr-2 inline h-4 w-4" />
                  Subir dados
                </button>
              </>
            ) : null}
          </div>
        }
      />

      {toast ? <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700">{toast}</div> : null}
      {error ? <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</div> : null}

      <section className="card p-3">
        <div className="grid gap-3 xl:grid-cols-[1fr_1fr_1fr_1.4fr_auto_auto] xl:items-end">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">Ciclo da Invoice</span>
            <MonthCyclePicker value={invoiceCycleMonth} onChange={setInvoiceCycleMonth} options={monthOptions} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">LOB</span>
            <select value={costCenter} onChange={(event) => setCostCenter(event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold outline-none">
              {(payload?.data.filterOptions.costCenters ?? ["Todos"]).map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">Fonte</span>
            <select value={source} onChange={(event) => setSource(event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold outline-none">
              {(payload?.data.filterOptions.sources ?? ["Todos"]).map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">Busca</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="LOB, fonte ou observação" className="premium-control h-10 w-full px-3 text-sm font-bold outline-none" />
          </label>
          <button type="button" onClick={fetchData} className="premium-control h-10 px-3 text-sm font-extrabold text-navy-950">
            <RefreshCw className={cn("mr-2 inline h-4 w-4", loading && "animate-spin")} />
            Atualizar
          </button>
          <a href={exportHref} className="premium-control inline-flex h-10 items-center justify-center px-3 text-sm font-extrabold text-navy-950">
            <Download className="mr-2 h-4 w-4" />
            Exportar XLSX
          </a>
        </div>
      </section>

      <FinanceiroTabs activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "history" ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <StatCard title="Max Hours (Meta)" value={summary?.maxHoursCapacity ?? "-"} helper="horas" icon={Target} tone="purple" />
            <StatCard title="Billable Hours (Real)" value={summary?.billableHoursActual ?? "-"} helper="horas" icon={Clock} tone="blue" />
            <StatCard title="Training Hours" value={summary?.trainingHours ?? "-"} helper="horas" icon={Clock} tone="green" />
            <StatCard title="Aderence %" value={`${formatPercent(summary?.adherencePercent ?? 0)}%`} helper="Meta: 100%" icon={BarChart3} tone="green" />
            <StatCard title="Difference" value={summary?.differenceHours ?? "-"} helper="horas" icon={(summary?.differenceMinutes ?? 0) < 0 ? TrendingDown : TrendingUp} tone={(summary?.differenceMinutes ?? 0) < 0 ? "red" : "green"} />
            <StatCard title="Penalty %" value={`${formatPercent(summary?.penaltyPercent ?? 0)}%`} helper="percentual" icon={TrendingDown} tone={(summary?.penaltyPercent ?? 0) > 0 ? "red" : (summary?.penaltyPercent ?? 0) < 0 ? "green" : "orange"} />
          </div>
          <FinanceiroHistoryPanel loading={loading} records={payload?.data.records ?? []} canManage={canManage} onView={setSelectedRecord} onEdit={openEditRecordForm} onAdjust={setAdjustRecord} />
        </>
      ) : null}

      {activeTab === "values" ? <ValuesPanel analytics={analytics} /> : null}
      {activeTab === "parameters" ? <ParametersPanel analytics={analytics} canManage={canManage} onEdit={openParameterForm} onNew={() => openParameterForm()} /> : null}

      {selectedRecord ? <RecordDetailModal record={selectedRecord} canManage={canManage} onClose={() => setSelectedRecord(null)} onEdit={() => { openEditRecordForm(selectedRecord); setSelectedRecord(null); }} onAdjust={() => { setAdjustRecord(selectedRecord); setSelectedRecord(null); }} /> : null}
      {canManage && recordForm ? <RecordFormModal form={recordForm} setForm={setRecordForm} monthOptions={monthOptions} saving={savingRecord} onClose={() => setRecordForm(null)} onSave={() => saveRecord(recordForm)} /> : null}
      {canManage && parameterForm ? <ParameterFormModal form={parameterForm} setForm={setParameterForm} monthOptions={monthOptions} saving={savingRecord} onClose={() => setParameterForm(null)} onSave={() => saveParameter(parameterForm)} /> : null}
      {canManage && adjustRecord ? <AdjustmentModal record={adjustRecord} onClose={() => setAdjustRecord(null)} onSaved={async (message) => { setToast(message); setAdjustRecord(null); await fetchData(); }} saving={savingAdjustment} setSaving={setSavingAdjustment} /> : null}
      {canManage && uploadOpen ? <UploadModal preview={preview} uploading={uploading} inputRef={fileInputRef} onClose={() => setUploadOpen(false)} onPreview={handlePreviewUpload} onCommit={handleCommitUpload} /> : null}
      {uploadsOpen ? <UploadsModal uploads={payload?.data.uploads ?? []} onClose={() => setUploadsOpen(false)} /> : null}
    </div>
  );
}

function FinanceiroTabs({ activeTab, onChange }: { activeTab: FinanceiroTab; onChange: (tab: FinanceiroTab) => void }) {
  const tabs: Array<{ value: FinanceiroTab; label: string }> = [
    { value: "history", label: "Histórico" },
    { value: "values", label: "Valores" },
    { value: "parameters", label: "Parâmetros" }
  ];
  return (
    <div className="inline-flex w-full gap-1 overflow-x-auto rounded-2xl border border-border/70 bg-white p-1 shadow-sm md:w-auto">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={cn("h-10 rounded-xl px-4 text-sm font-black transition", activeTab === tab.value ? "bg-blue-600 text-white shadow-sm" : "text-muted hover:bg-slate-50 hover:text-navy-950")}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function ValuesPanel({ analytics }: { analytics?: FinanceiroAnalytics }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <StatCard title="Receita USD" value={formatUsd(analytics?.valueSummary.revenueUsd ?? 0)} helper="Global + treinamento - penalty" icon={DollarSign} tone="green" />
        <StatCard title="Receita BRL" value={formatCurrency(analytics?.valueSummary.revenueBrl ?? 0)} helper="líquida de penalty" icon={TrendingUp} tone="green" />
        <StatCard title="Câmbio" value={analytics?.rows[0]?.values.exchangeRateUsdBrl ? formatNumberValue(analytics.rows[0].values.exchangeRateUsdBrl) : "-"} helper="USD → BRL" icon={RefreshCw} tone="blue" />
      </div>
      <Panel title="Receita por ciclo e LOB">
        <FinanceAnalyticsTable
          rows={analytics?.rows ?? []}
          columns={[
            ["Ciclo", (row) => row.invoiceCycleLabel],
            ["LOB", (row) => row.costCenter],
            ["Status", (row) => row.statusLabel],
            ["Billable Hours", (row) => row.hours.billableActual],
            ["Training Hours", (row) => row.hours.training],
            ["Kwai USD", (row) => formatUsd(row.values.kwaiRevenueUsd)],
            ["Global USD", (row) => formatUsd(row.values.globalRevenueUsd)],
            ["Treinamento USD", (row) => formatUsd(row.values.trainingRevenueUsd)],
            ["Penalty %", (row) => `${formatPercent(row.values.penaltyPercent)}%`],
            ["Penalty BRL", (row) => formatCurrency(row.values.penaltyBrl)],
            ["Total USD", (row) => formatUsd(row.values.totalRevenueUsd)],
            ["Total BRL", (row) => formatCurrency(row.values.totalRevenueBrl)]
          ]}
          emptyTitle="Sem dados de receita"
        />
      </Panel>
    </div>
  );
}

function ParametersPanel({ analytics, canManage, onEdit, onNew }: { analytics?: FinanceiroAnalytics; canManage: boolean; onEdit: (parameter: FinanceiroParameter) => void; onNew: () => void }) {
  return (
    <Panel title="Parâmetros mensais" action={canManage ? "Adicionar parâmetro" : undefined} actionOnClick={canManage ? onNew : undefined}>
      <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
        Parâmetros são por ciclo e LOB. Câmbio zero mantém valores em USD e deixa BRL zerado até você configurar o mês.
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[980px] w-full text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Ciclo</th>
              <th className="px-3 py-2">LOB</th>
              <th className="px-3 py-2">Kwai USD/h</th>
              <th className="px-3 py-2">Global USD/h</th>
              <th className="px-3 py-2">Treinamento USD/h</th>
              <th className="px-3 py-2">Câmbio</th>
              <th className="px-3 py-2">Origem</th>
              {canManage ? <th className="px-3 py-2 text-right">Ações</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {(analytics?.parameters ?? []).map((parameter) => (
              <tr key={`${parameter.invoiceCycleMonth}-${parameter.costCenter}`} className="hover:bg-blue-50/40">
                <td className="px-3 py-3 font-extrabold text-navy-950">{parameter.invoiceCycleLabel}</td>
                <td className="px-3 py-3 font-bold text-muted">{parameter.costCenter}</td>
                <td className="px-3 py-3 font-bold">{formatUsd(parameter.kwaiHourlyUsd)}</td>
                <td className="px-3 py-3 font-bold">{formatUsd(parameter.globalHourlyUsd)}</td>
                <td className="px-3 py-3 font-bold">{formatUsd(parameter.trainingHourlyUsd)}</td>
                <td className="px-3 py-3 font-bold">{parameter.exchangeRateUsdBrl ? formatNumberValue(parameter.exchangeRateUsdBrl) : "-"}</td>
                <td className="px-3 py-3"><StatusBadge status={parameter.isDefault ? "Padrão" : "Salvo"} /></td>
                {canManage ? (
                  <td className="px-3 py-3 text-right">
                    <button type="button" onClick={() => onEdit(parameter)} className="premium-control h-9 px-3 text-xs font-extrabold text-navy-950">Editar</button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {analytics?.parameters.length ? null : <EmptyState title="Sem parâmetros" description="Adicione o primeiro parâmetro mensal para converter receita e resultado." />}
    </Panel>
  );
}

function FinanceiroHistoryPanel({ loading, records, canManage, onView, onEdit, onAdjust }: { loading: boolean; records: FinanceiroRecord[]; canManage: boolean; onView: (record: FinanceiroRecord) => void; onEdit: (record: FinanceiroRecord) => void; onAdjust: (record: FinanceiroRecord) => void }) {
  return (
    <Panel title="Histórico por Ciclo da Invoice">
      {loading ? (
        <div className="grid gap-2">
          {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-12 animate-pulse rounded-xl bg-slate-100" />)}
        </div>
      ) : records.length ? (
        <div className="overflow-x-auto">
          <table className="min-w-[1080px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Ciclo da Invoice</th>
                <th className="px-3 py-2">LOB</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Max Hours</th>
                <th className="px-3 py-2">Billable Hours</th>
                <th className="px-3 py-2">Training Hours</th>
                <th className="px-3 py-2">Aderence %</th>
                <th className="px-3 py-2">Difference</th>
                <th className="px-3 py-2">Penalty %</th>
                <th className="px-3 py-2">Fonte</th>
                <th className="px-3 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {records.map((record) => (
                <tr key={record.id} className="hover:bg-blue-50/40">
                  <td className="px-3 py-3 font-extrabold text-navy-950">{record.invoiceCycleLabel}</td>
                  <td className="px-3 py-3 font-bold text-muted">{record.costCenter}</td>
                  <td className="px-3 py-3"><StatusBadge status={record.statusLabel} /></td>
                  <td className="px-3 py-3 font-bold">{record.maxHoursCapacity}</td>
                  <td className="px-3 py-3 font-bold">{record.billableHoursActual}</td>
                  <td className="px-3 py-3 font-bold">{record.trainingHours}</td>
                  <td className={cn("px-3 py-3 font-black", record.adherencePercent >= 100 ? "text-emerald-600" : "text-amber-600")}>{record.adherenceLabel}</td>
                  <td className={cn("px-3 py-3 font-black", record.differenceMinutes < 0 ? "text-red-600" : "text-emerald-600")}>{record.differenceHours}</td>
                  <td className={cn("px-3 py-3 font-black", record.penaltyPercent > 0 ? "text-red-600" : record.penaltyPercent < 0 ? "text-emerald-600" : "text-muted")}>{record.penaltyLabel}</td>
                  <td className="px-3 py-3 text-muted">{record.source || "-"}</td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => onView(record)} className="premium-control grid h-9 w-9 place-items-center text-navy-950" title="Ver detalhes">
                        <Eye className="h-4 w-4" />
                      </button>
                      {canManage ? (
                        <>
                          <button type="button" onClick={() => onEdit(record)} className="premium-control grid h-9 w-9 place-items-center text-navy-950" title="Editar">
                            <PencilLine className="h-4 w-4" />
                          </button>
                          <button type="button" onClick={() => onAdjust(record)} className="premium-control h-9 px-2 text-xs font-extrabold text-navy-950" title="Ajustar">Ajustar</button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="Nenhum registro financeiro encontrado" description="Suba uma planilha histórica ou ajuste os filtros para visualizar os ciclos." />
      )}
    </Panel>
  );
}

function FinanceAnalyticsTable<Row extends { key: string }>({ rows, columns, emptyTitle }: { rows: Row[]; columns: Array<[string, (row: Row) => React.ReactNode]>; emptyTitle: string }) {
  if (!rows.length) return <EmptyState title={emptyTitle} description="Ajuste filtros, registros ou parâmetros para preencher esta visão." />;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[900px] w-full text-left text-sm">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-muted">
          <tr>
            {columns.map(([label]) => <th key={label} className="px-3 py-2">{label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {rows.map((row) => (
            <tr key={row.key} className="hover:bg-blue-50/40">
              {columns.map(([label, render]) => <td key={label} className="px-3 py-3 font-bold text-navy-950">{render(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecordDetailModal({ record, canManage, onClose, onEdit, onAdjust }: { record: FinanceiroRecord; canManage: boolean; onClose: () => void; onEdit: () => void; onAdjust: () => void }) {
  return (
    <ModalShell title="Detalhe financeiro" onClose={onClose}>
      <div className="grid gap-3 md:grid-cols-2">
        <InfoBox label="Ciclo da Invoice" value={record.invoiceCycleLabel} />
        <InfoBox label="LOB" value={record.costCenter} />
        <InfoBox label="Status" value={record.statusLabel} />
        <InfoBox label="Max Hours (Capacity)" value={record.maxHoursCapacity} />
        <InfoBox label="Billable Hours (Real)" value={record.billableHoursActual} />
        <InfoBox label="Training Hours" value={record.trainingHours} />
        <InfoBox label="Aderence %" value={record.adherenceLabel} />
        <InfoBox label="Difference" value={record.differenceHours} tone={record.differenceMinutes < 0 ? "red" : "green"} />
        <InfoBox label="Penalty %" value={record.penaltyLabel} tone={record.penaltyPercent > 0 ? "red" : record.penaltyPercent < 0 ? "green" : "neutral"} />
      </div>
      <div className="rounded-xl border border-border/70 bg-slate-50 p-3">
        <p className="text-[11px] font-extrabold uppercase tracking-wide text-muted">Notes</p>
        <p className="mt-1 whitespace-pre-wrap text-sm font-semibold text-navy-950">{record.notes || "Sem observações."}</p>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-black text-navy-950">Histórico de ajustes</h3>
        {record.adjustments.length ? (
          <div className="max-h-64 overflow-auto rounded-xl border border-border/70">
            {record.adjustments.map((adjustment) => (
              <div key={adjustment.id} className="border-b border-border/70 p-3 last:border-b-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-black text-navy-950">{adjustment.adjustmentType}</p>
                  <span className="text-xs font-bold text-muted">{adjustment.createdAt}</span>
                </div>
                <p className="mt-1 text-xs font-bold text-muted">{adjustment.fieldName}: {adjustment.oldValue || "-"} → {adjustment.newValue || "-"}</p>
                <p className="mt-1 text-sm font-medium text-navy-950">{adjustment.description}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Sem ajustes" description="Este registro ainda não possui ajustes manuais." />
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="premium-control h-10 px-4 text-sm font-extrabold text-navy-950">Fechar</button>
        {canManage ? <button type="button" onClick={onEdit} className="premium-control h-10 px-4 text-sm font-extrabold text-navy-950">Editar</button> : null}
        {canManage ? <button type="button" onClick={onAdjust} className="premium-button h-10 px-4 text-sm font-extrabold">Ajustar</button> : null}
      </div>
    </ModalShell>
  );
}

function RecordFormModal({
  form,
  setForm,
  monthOptions,
  saving,
  onClose,
  onSave
}: {
  form: FinanceiroRecordForm;
  setForm: (value: FinanceiroRecordForm) => void;
  monthOptions: Array<{ value: string; label: string }>;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const isEdit = Boolean(form.id);
  const setField = (field: keyof FinanceiroRecordForm, value: string) => setForm({ ...form, [field]: value });
  return (
    <ModalShell title={isEdit ? "Editar registro financeiro" : "Adicionar registro financeiro"} onClose={onClose}>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">Ciclo da Invoice</span>
          <select value={form.invoiceCycleMonth} onChange={(event) => setField("invoiceCycleMonth", event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold outline-none">
            {monthOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">LOB</span>
          <input value={form.costCenter} onChange={(event) => setField("costCenter", event.target.value)} placeholder="ADS, CEC ou TNS" className="premium-control h-10 w-full px-3 text-sm font-bold outline-none" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">Status</span>
          <select value={form.status} onChange={(event) => setField("status", event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold outline-none">
            {financeRecordStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <FormInput label="Max Hours (Meta)" value={form.maxHoursCapacity} onChange={(value) => setField("maxHoursCapacity", value)} placeholder="12000:00" />
        <FormInput label="Billable Hours (Real)" value={form.billableHoursActual} onChange={(value) => setField("billableHoursActual", value)} placeholder="8742:30" />
        <FormInput label="Training Hours" value={form.trainingHours} onChange={(value) => setField("trainingHours", value)} placeholder="0:00" />
        <FormInput label="Penalty %" value={form.penaltyPercent} onChange={(value) => setField("penaltyPercent", value)} placeholder="5, -3 ou 0" />
        <FormInput label="Aderence % (opcional)" value={form.adherencePercent} onChange={(value) => setField("adherencePercent", value)} placeholder="Calcula automático se vazio" />
        <FormInput label="Difference (opcional)" value={form.differenceHours} onChange={(value) => setField("differenceHours", value)} placeholder="Calcula automático se vazio" />
        <label className="block md:col-span-2">
          <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">Fonte</span>
          <input value={form.source} onChange={(event) => setField("source", event.target.value)} placeholder="Manual" className="premium-control h-10 w-full px-3 text-sm font-bold outline-none" />
        </label>
        <label className="block md:col-span-2">
          <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">Observações</span>
          <textarea value={form.notes} onChange={(event) => setField("notes", event.target.value)} rows={4} className="premium-control w-full px-3 py-2 text-sm font-bold outline-none" placeholder="Observação do ciclo, se necessário." />
        </label>
      </div>
      <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
        Max Hours é a meta do ciclo. Billable Hours e Training Hours aceitam formatos como 12000:00, 8742:30 ou decimal. Penalty é percentual e nunca valor em dinheiro.
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="premium-control h-10 px-4 text-sm font-extrabold text-navy-950">Cancelar</button>
        <button type="button" disabled={saving} onClick={onSave} className="premium-button h-10 px-4 text-sm font-extrabold disabled:opacity-60">
          <Save className="mr-2 inline h-4 w-4" />
          {saving ? "Salvando..." : isEdit ? "Salvar edição" : "Adicionar"}
        </button>
      </div>
    </ModalShell>
  );
}

function ParameterFormModal({
  form,
  setForm,
  monthOptions,
  saving,
  onClose,
  onSave
}: {
  form: FinanceiroParameterForm;
  setForm: (value: FinanceiroParameterForm) => void;
  monthOptions: Array<{ value: string; label: string }>;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const setField = (field: keyof FinanceiroParameterForm, value: string) => setForm({ ...form, [field]: value });
  return (
    <ModalShell title="Parâmetros financeiros do ciclo" onClose={onClose}>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">Ciclo da Invoice</span>
          <select value={form.invoiceCycleMonth} onChange={(event) => setField("invoiceCycleMonth", event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold outline-none">
            {monthOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <FormInput label="LOB" value={form.costCenter} onChange={(value) => setField("costCenter", value)} placeholder="ADS, CEC ou TNS" />
        <FormInput label="Kwai USD/h" value={form.kwaiHourlyUsd} onChange={(value) => setField("kwaiHourlyUsd", value)} placeholder="9,39" />
        <FormInput label="Global USD/h" value={form.globalHourlyUsd} onChange={(value) => setField("globalHourlyUsd", value)} placeholder="5,965" />
        <FormInput label="Treinamento USD/h" value={form.trainingHourlyUsd} onChange={(value) => setField("trainingHourlyUsd", value)} placeholder="1,45" />
        <FormInput label="Câmbio USD/BRL" value={form.exchangeRateUsdBrl} onChange={(value) => setField("exchangeRateUsdBrl", value)} placeholder="5,40" />
        <label className="block md:col-span-2">
          <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">Observações</span>
          <textarea value={form.notes} onChange={(event) => setField("notes", event.target.value)} rows={3} className="premium-control w-full px-3 py-2 text-sm font-bold outline-none" placeholder="Fonte do câmbio, regra do mês ou observação." />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="premium-control h-10 px-4 text-sm font-extrabold text-navy-950">Cancelar</button>
        <button type="button" disabled={saving} onClick={onSave} className="premium-button h-10 px-4 text-sm font-extrabold disabled:opacity-60">
          <Save className="mr-2 inline h-4 w-4" />
          {saving ? "Salvando..." : "Salvar parâmetros"}
        </button>
      </div>
    </ModalShell>
  );
}

function FormInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="premium-control h-10 w-full px-3 text-sm font-bold outline-none" />
    </label>
  );
}

function AdjustmentModal({ record, onClose, onSaved, saving, setSaving }: { record: FinanceiroRecord; onClose: () => void; onSaved: (message: string) => void | Promise<void>; saving: boolean; setSaving: (value: boolean) => void }) {
  const [fieldName, setFieldName] = useState("penaltyPercent");
  const [adjustmentType, setAdjustmentType] = useState("Correção de penalty");
  const [newValue, setNewValue] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    if (!description.trim()) {
      setError("Descrição do ajuste é obrigatória.");
      return;
    }
    setSaving(true);
    const response = await fetch("/api/financeiro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create-adjustment", recordId: record.id, fieldName, adjustmentType, newValue, description })
    });
    const json = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setError(json.message || json.error || "Não foi possível salvar o ajuste.");
      return;
    }
    await onSaved("Ajuste financeiro salvo com sucesso.");
  }

  return (
    <ModalShell title={`Ajustar ${record.costCenter} • ${record.invoiceCycleLabel}`} onClose={onClose}>
      {error ? <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</div> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">Campo ajustado</span>
          <select value={fieldName} onChange={(event) => setFieldName(event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold outline-none">
            {adjustmentFields.map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">Tipo de ajuste</span>
          <select value={adjustmentType} onChange={(event) => setAdjustmentType(event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold outline-none">
            {adjustmentTypes.map((type) => <option key={type}>{type}</option>)}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">Valor novo</span>
        <input value={newValue} onChange={(event) => setNewValue(event.target.value)} placeholder="Ex.: 5%, -3%, 10200:00 ou observação" className="premium-control h-10 w-full px-3 text-sm font-bold outline-none" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">Descrição obrigatória</span>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} className="premium-control w-full px-3 py-2 text-sm font-bold outline-none" placeholder="Explique o motivo do ajuste." />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="premium-control h-10 px-4 text-sm font-extrabold text-navy-950">Cancelar</button>
        <button type="button" onClick={submit} disabled={saving} className="premium-button h-10 px-4 text-sm font-extrabold disabled:opacity-60">
          <Save className="mr-2 inline h-4 w-4" />
          {saving ? "Salvando..." : "Salvar ajuste"}
        </button>
      </div>
    </ModalShell>
  );
}

function UploadModal({ preview, uploading, inputRef, onClose, onPreview, onCommit }: { preview: PreviewPayload | null; uploading: boolean; inputRef: React.RefObject<HTMLInputElement>; onClose: () => void; onPreview: (file?: File) => void; onCommit: () => void }) {
  return (
    <ModalShell title="Upload histórico financeiro" onClose={onClose} wide>
      <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm font-semibold text-blue-800">
        Envie XLSX com ciclo, LOB, status, Max Hours, Billable Hours, Training Hours, aderence e penalty %. Penalty será importado somente como percentual.
      </div>
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">Arquivo XLSX</span>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={(event) => onPreview(event.target.files?.[0])} className="premium-control w-full px-3 py-2 text-sm font-bold outline-none" />
      </label>
      {uploading ? <div className="h-24 animate-pulse rounded-xl bg-slate-100" /> : null}
      {preview ? (
        <div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-5">
            <PreviewStat label="Total" value={preview.totalRows} />
            <PreviewStat label="Válidas" value={preview.validRows} tone="green" />
            <PreviewStat label="Erros" value={preview.errorRows} tone="red" />
            <PreviewStat label="Criar" value={preview.createdRows} />
            <PreviewStat label="Atualizar" value={preview.updatedRows} />
          </div>
          <div className="max-h-[420px] overflow-auto rounded-xl border border-border/70">
            <table className="min-w-[1080px] w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-2 py-2">Linha</th>
                  <th className="px-2 py-2">Ciclo</th>
                  <th className="px-2 py-2">LOB</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Max</th>
                  <th className="px-2 py-2">Real</th>
                  <th className="px-2 py-2">Training</th>
                  <th className="px-2 py-2">Aderence</th>
                  <th className="px-2 py-2">Difference</th>
                  <th className="px-2 py-2">Penalty %</th>
                  <th className="px-2 py-2">Ação/erros</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {preview.rows.map((row) => (
                  <tr key={row.rowNumber}>
                    <td className="px-2 py-2 font-bold">{row.rowNumber}</td>
                    <td className="px-2 py-2">{row.display.invoiceCycleMonth}</td>
                    <td className="px-2 py-2">{row.costCenter}</td>
                    <td className="px-2 py-2">{row.display.status}</td>
                    <td className="px-2 py-2">{row.display.maxHoursCapacity}</td>
                    <td className="px-2 py-2">{row.display.billableHoursActual}</td>
                    <td className="px-2 py-2">{row.display.trainingHours}</td>
                    <td className="px-2 py-2">{row.display.adherencePercent}</td>
                    <td className="px-2 py-2">{row.display.differenceHours}</td>
                    <td className="px-2 py-2 font-black">{row.display.penaltyPercent}</td>
                    <td className="px-2 py-2">
                      {row.errors.length ? <span className="font-bold text-red-600">{row.errors.join(" ")}</span> : <StatusBadge status={row.action === "update" ? "Atualizar" : "Criar"} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="premium-control h-10 px-4 text-sm font-extrabold text-navy-950">Fechar</button>
        <button type="button" disabled={!preview || preview.validRows === 0 || uploading} onClick={onCommit} className="premium-button h-10 px-4 text-sm font-extrabold disabled:opacity-60">
          <FileSpreadsheet className="mr-2 inline h-4 w-4" />
          Confirmar importação
        </button>
      </div>
    </ModalShell>
  );
}

function UploadsModal({ uploads, onClose }: { uploads: FinanceiroUpload[]; onClose: () => void }) {
  return (
    <ModalShell title="Histórico de uploads" onClose={onClose}>
      {uploads.length ? (
        <div className="max-h-[520px] overflow-auto rounded-xl border border-border/70">
          <table className="min-w-[760px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Arquivo</th>
                <th className="px-3 py-2">Usuário</th>
                <th className="px-3 py-2">Linhas</th>
                <th className="px-3 py-2">Criados</th>
                <th className="px-3 py-2">Atualizados</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {uploads.map((upload) => (
                <tr key={upload.id}>
                  <td className="px-3 py-3 font-bold text-navy-950">{upload.fileName}</td>
                  <td className="px-3 py-3 text-muted">{upload.uploadedBy || "-"}</td>
                  <td className="px-3 py-3">{upload.rowsValid}/{upload.rowsTotal}</td>
                  <td className="px-3 py-3">{upload.rowsInserted}</td>
                  <td className="px-3 py-3">{upload.rowsUpdated}</td>
                  <td className="px-3 py-3"><StatusBadge status={upload.status} /></td>
                  <td className="px-3 py-3 text-muted">{upload.uploadedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="Sem uploads" description="Nenhum upload financeiro foi registrado ainda." />
      )}
    </ModalShell>
  );
}

function ModalShell({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-navy-950/40 p-4 backdrop-blur-sm">
      <div className={cn("card max-h-[92dvh] w-full overflow-y-auto", wide ? "max-w-6xl" : "max-w-3xl")}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border/70 bg-white px-4 py-3">
          <h2 className="text-base font-black text-navy-950">{title}</h2>
          <button type="button" onClick={onClose} className="premium-control grid h-9 w-9 place-items-center text-navy-950">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-4">{children}</div>
      </div>
    </div>
  );
}

function InfoBox({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "red" | "green" }) {
  return (
    <div className="rounded-xl border border-border/70 bg-slate-50 p-3">
      <p className="text-[11px] font-extrabold uppercase tracking-wide text-muted">{label}</p>
      <p className={cn("mt-1 text-lg font-black", tone === "red" ? "text-red-600" : tone === "green" ? "text-emerald-600" : "text-navy-950")}>{value}</p>
    </div>
  );
}

function PreviewStat({ label, value, tone = "blue" }: { label: string; value: number; tone?: "blue" | "green" | "red" }) {
  return (
    <div className={cn("rounded-xl border px-3 py-2", tone === "green" ? "border-emerald-100 bg-emerald-50 text-emerald-700" : tone === "red" ? "border-red-100 bg-red-50 text-red-600" : "border-blue-100 bg-blue-50 text-blue-700")}>
      <p className="text-[11px] font-extrabold uppercase tracking-wide">{label}</p>
      <p className="text-xl font-black">{value}</p>
    </div>
  );
}

function MonthCyclePicker({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  const [open, setOpen] = useState(false);
  const selectedLabel = value ? formatMonthLabel(value) : "Todos os ciclos";
  const groupedByYear = options.reduce<Record<string, Array<{ value: string; label: string }>>>((acc, option) => {
    const year = option.value.split("-")[0] || "";
    if (!year) return acc;
    acc[year] = acc[year] ?? [];
    acc[year].push(option);
    return acc;
  }, {});
  const years = Object.keys(groupedByYear).sort((a, b) => Number(b) - Number(a));

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((current) => !current)} className="premium-control flex h-10 w-full items-center justify-between gap-2 px-3 text-left text-sm font-bold text-navy-950">
        <span className="flex min-w-0 items-center gap-2">
          <CalendarDays className="h-4 w-4 shrink-0 text-blue-600" />
          <span className="truncate">{selectedLabel}</span>
        </span>
        {value ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              onChange("");
              setOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onChange("");
                setOpen(false);
              }
            }}
            className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-muted"
          >
            Limpar
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute left-0 top-12 z-40 w-[min(420px,calc(100vw-2rem))] rounded-3xl border border-slate-200 bg-white p-3 shadow-2xl">
          <button type="button" onClick={() => { onChange(""); setOpen(false); }} className={cn("mb-3 flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm font-black", !value ? "bg-blue-50 text-blue-700" : "hover:bg-slate-50")}>
            <CalendarDays className="h-4 w-4" />
            Todos os ciclos
          </button>
          <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
            {years.map((year) => (
              <div key={year}>
                <p className="px-1 text-xs font-black uppercase tracking-wide text-muted">{year}</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {groupedByYear[year].map((option) => (
                    <button key={option.value} type="button" onClick={() => { onChange(option.value); setOpen(false); }} className={cn("rounded-2xl border px-3 py-2 text-left text-xs font-black capitalize transition", value === option.value ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-100 hover:bg-slate-50")}>
                      {new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(monthDate(option.value)).replace(".", "")}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function defaultMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function buildMonthOptions(selectedMonth?: string, availableMonths: string[] = []) {
  const now = new Date();
  const minMonth = "2026-06";
  const historicalYears = availableMonths
    .filter((month) => /^\d{4}-\d{2}$/.test(month))
    .map((month) => Number(month.slice(0, 4)))
    .filter(Number.isFinite);
  const startYear = Math.min(2026, now.getFullYear() - 2, ...historicalYears);
  const endYear = now.getFullYear() + 2;
  const values = new Set<string>();
  availableMonths.forEach((month) => {
    if (/^\d{4}-\d{2}$/.test(month)) values.add(month);
  });
  for (let year = endYear; year >= startYear; year -= 1) {
    for (let month = 12; month >= 1; month -= 1) {
      const value = `${year}-${String(month).padStart(2, "0")}`;
      if (value >= minMonth) values.add(value);
    }
  }
  if (selectedMonth && /^\d{4}-\d{2}$/.test(selectedMonth)) {
    values.add(selectedMonth);
  }
  return Array.from(values)
    .sort((a, b) => b.localeCompare(a))
    .map((value) => ({ value, label: formatMonthLabel(value) }));
}

function monthDate(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year || 2000, (month || 1) - 1, 1));
}

function formatMonthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number.isFinite(value) ? value : 0);
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number.isFinite(value) ? value : 0);
}

function formatNumberValue(value: number) {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 4 }).format(Number.isFinite(value) ? value : 0);
}
