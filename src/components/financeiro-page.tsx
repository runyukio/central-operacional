"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Building2,
  CalendarDays,
  Clock,
  Download,
  Eye,
  FileSpreadsheet,
  History,
  LockKeyhole,
  PencilLine,
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
  maxHoursCapacity: string;
  billableHoursTarget: string;
  billableHoursActual: string;
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
      costCenters: string[];
      sources: string[];
    };
    summary: {
      maxHoursCapacity: string;
      billableHoursTarget: string;
      billableHoursActual: string;
      adherencePercent: number;
      differenceHours: string;
      differenceMinutes: number;
      penaltyPercent: number;
      recordsCount: number;
    };
    records: FinanceiroRecord[];
    uploads: FinanceiroUpload[];
    allowedEmails: string[];
  };
};

type PreviewRow = {
  rowNumber: number;
  invoiceCycleMonth: string;
  costCenter: string;
  maxHoursCapacityMinutes: number;
  billableHoursTargetMinutes: number;
  billableHoursActualMinutes: number;
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
    billableHoursTarget: string;
    billableHoursActual: string;
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

const adjustmentFields = [
  { value: "maxHoursCapacityMinutes", label: "Max Hours (Capacity)" },
  { value: "billableHoursTargetMinutes", label: "Billable Hours (Meta)" },
  { value: "billableHoursActualMinutes", label: "Billable Hours (Real)" },
  { value: "adherencePercent", label: "Aderence %" },
  { value: "differenceMinutes", label: "Difference" },
  { value: "penaltyPercent", label: "Penalty %" },
  { value: "notes", label: "Notes" },
  { value: "source", label: "Source" }
];

const adjustmentTypes = ["Correção de horas", "Correção de aderence", "Correção de penalty", "Observação", "Outro"];

export function FinanceiroPage() {
  const [invoiceCycleMonth, setInvoiceCycleMonth] = useState(defaultMonth());
  const [costCenter, setCostCenter] = useState("Todos");
  const [source, setSource] = useState("Todos");
  const [search, setSearch] = useState("");
  const [payload, setPayload] = useState<FinanceiroPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<FinanceiroRecord | null>(null);
  const [adjustRecord, setAdjustRecord] = useState<FinanceiroRecord | null>(null);
  const [uploadsOpen, setUploadsOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [uploading, setUploading] = useState(false);
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Financeiro"
        description="Acompanhamento restrito por ciclo de invoice, cost center, horas billáveis e penalty percentual."
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
            <button type="button" onClick={() => setUploadOpen(true)} className="premium-button h-10 px-3 text-sm font-extrabold">
              <Upload className="mr-2 inline h-4 w-4" />
              Subir dados
            </button>
          </div>
        }
      />

      {toast ? <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700">{toast}</div> : null}
      {error ? <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</div> : null}

      <section className="card p-3">
        <div className="grid gap-3 xl:grid-cols-[1fr_1fr_1fr_1.4fr_auto_auto] xl:items-end">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">Ciclo da Invoice</span>
            <input type="month" value={invoiceCycleMonth} onChange={(event) => setInvoiceCycleMonth(event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold outline-none" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-muted">Cost center</span>
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
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cost center, fonte ou observação" className="premium-control h-10 w-full px-3 text-sm font-bold outline-none" />
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

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <StatCard title="Max Hours (Capacity)" value={summary?.maxHoursCapacity ?? "-"} helper="horas" icon={Clock} tone="purple" />
        <StatCard title="Billable Hours (Meta)" value={summary?.billableHoursTarget ?? "-"} helper="horas" icon={Target} tone="green" />
        <StatCard title="Billable Hours (Real)" value={summary?.billableHoursActual ?? "-"} helper="horas" icon={Clock} tone="blue" />
        <StatCard title="Aderence %" value={`${formatPercent(summary?.adherencePercent ?? 0)}%`} helper="Meta: 100%" icon={BarChart3} tone="green" />
        <StatCard title="Difference" value={summary?.differenceHours ?? "-"} helper="horas" icon={(summary?.differenceMinutes ?? 0) < 0 ? TrendingDown : TrendingUp} tone={(summary?.differenceMinutes ?? 0) < 0 ? "red" : "green"} />
        <StatCard title="Penalty %" value={`${formatPercent(summary?.penaltyPercent ?? 0)}%`} helper="percentual" icon={TrendingDown} tone={(summary?.penaltyPercent ?? 0) > 0 ? "red" : (summary?.penaltyPercent ?? 0) < 0 ? "green" : "orange"} />
      </div>

      <Panel title="Histórico por Ciclo da Invoice">
        {loading ? (
          <div className="grid gap-2">
            {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-12 animate-pulse rounded-xl bg-slate-100" />)}
          </div>
        ) : payload?.data.records.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-[1080px] w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Ciclo da Invoice</th>
                  <th className="px-3 py-2">Cost center</th>
                  <th className="px-3 py-2">Max Hours</th>
                  <th className="px-3 py-2">Billable Meta</th>
                  <th className="px-3 py-2">Billable Real</th>
                  <th className="px-3 py-2">Aderence %</th>
                  <th className="px-3 py-2">Difference</th>
                  <th className="px-3 py-2">Penalty %</th>
                  <th className="px-3 py-2">Fonte</th>
                  <th className="px-3 py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {payload.data.records.map((record) => (
                  <tr key={record.id} className="hover:bg-blue-50/40">
                    <td className="px-3 py-3 font-extrabold text-navy-950">{record.invoiceCycleLabel}</td>
                    <td className="px-3 py-3 font-bold text-muted">{record.costCenter}</td>
                    <td className="px-3 py-3 font-bold">{record.maxHoursCapacity}</td>
                    <td className="px-3 py-3 font-bold">{record.billableHoursTarget}</td>
                    <td className="px-3 py-3 font-bold">{record.billableHoursActual}</td>
                    <td className={cn("px-3 py-3 font-black", record.adherencePercent >= 100 ? "text-emerald-600" : "text-amber-600")}>{record.adherenceLabel}</td>
                    <td className={cn("px-3 py-3 font-black", record.differenceMinutes < 0 ? "text-red-600" : "text-emerald-600")}>{record.differenceHours}</td>
                    <td className={cn("px-3 py-3 font-black", record.penaltyPercent > 0 ? "text-red-600" : record.penaltyPercent < 0 ? "text-emerald-600" : "text-muted")}>{record.penaltyLabel}</td>
                    <td className="px-3 py-3 text-muted">{record.source || "-"}</td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setSelectedRecord(record)} className="premium-control grid h-9 w-9 place-items-center text-navy-950" title="Ver detalhes">
                          <Eye className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => setAdjustRecord(record)} className="premium-control grid h-9 w-9 place-items-center text-navy-950" title="Ajustar">
                          <PencilLine className="h-4 w-4" />
                        </button>
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

      <div className="rounded-2xl border border-blue-100 bg-blue-50/55 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-blue-600 shadow-soft"><LockKeyhole className="h-5 w-5" /></span>
            <div>
              <p className="text-sm font-black text-navy-950">Sobre a aba Financeiro</p>
              <p className="mt-1 max-w-3xl text-sm font-medium text-muted">Acompanhe capacidade, horas billáveis, aderência e penalty percentual por ciclo de invoice e cost center. Penalty é sempre percentual, nunca valor em dinheiro.</p>
            </div>
          </div>
          <div className="text-sm font-bold text-blue-700">
            <p className="mb-1 font-black">Permissões de acesso:</p>
            {(payload?.data.allowedEmails ?? ["wb_fernanda20@kuaishou.com", "runyukio@gmail.com"]).map((email) => <p key={email}>• {email}</p>)}
          </div>
        </div>
      </div>

      {selectedRecord ? <RecordDetailModal record={selectedRecord} onClose={() => setSelectedRecord(null)} onAdjust={() => { setAdjustRecord(selectedRecord); setSelectedRecord(null); }} /> : null}
      {adjustRecord ? <AdjustmentModal record={adjustRecord} onClose={() => setAdjustRecord(null)} onSaved={async (message) => { setToast(message); setAdjustRecord(null); await fetchData(); }} saving={savingAdjustment} setSaving={setSavingAdjustment} /> : null}
      {uploadOpen ? <UploadModal preview={preview} uploading={uploading} inputRef={fileInputRef} onClose={() => setUploadOpen(false)} onPreview={handlePreviewUpload} onCommit={handleCommitUpload} /> : null}
      {uploadsOpen ? <UploadsModal uploads={payload?.data.uploads ?? []} onClose={() => setUploadsOpen(false)} /> : null}
    </div>
  );
}

function RecordDetailModal({ record, onClose, onAdjust }: { record: FinanceiroRecord; onClose: () => void; onAdjust: () => void }) {
  return (
    <ModalShell title="Detalhe financeiro" onClose={onClose}>
      <div className="grid gap-3 md:grid-cols-2">
        <InfoBox label="Ciclo da Invoice" value={record.invoiceCycleLabel} />
        <InfoBox label="Cost center" value={record.costCenter} />
        <InfoBox label="Max Hours (Capacity)" value={record.maxHoursCapacity} />
        <InfoBox label="Billable Hours (Meta)" value={record.billableHoursTarget} />
        <InfoBox label="Billable Hours (Real)" value={record.billableHoursActual} />
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
        <button type="button" onClick={onAdjust} className="premium-button h-10 px-4 text-sm font-extrabold">Ajustar</button>
      </div>
    </ModalShell>
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
        Envie XLSX com ciclo, cost center, horas, aderence e penalty %. Penalty será importado somente como percentual.
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
            <table className="min-w-[980px] w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-2 py-2">Linha</th>
                  <th className="px-2 py-2">Ciclo</th>
                  <th className="px-2 py-2">Cost center</th>
                  <th className="px-2 py-2">Max</th>
                  <th className="px-2 py-2">Meta</th>
                  <th className="px-2 py-2">Real</th>
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
                    <td className="px-2 py-2">{row.display.maxHoursCapacity}</td>
                    <td className="px-2 py-2">{row.display.billableHoursTarget}</td>
                    <td className="px-2 py-2">{row.display.billableHoursActual}</td>
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

function defaultMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}
