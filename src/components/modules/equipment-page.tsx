"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Laptop, Plus, RefreshCw, Search, Upload, Wrench } from "lucide-react";
import { TopActions } from "@/components/layout/app-shell";
import { DonutLegend, EmptyState, PageHeader, Panel, SimpleTable, StatCard, StatusBadge } from "@/components/ui/primitives";
import { FormInput, FormSelect, IMPORT_PREVIEW_ROW_LIMIT, ImportIssueSummary, InfoLine, apiJson, downloadFile, queryParam } from './shared';
type EquipmentItem = {
  id?: string;
  code: string;
  serial?: string;
  type: string;
  model?: string;
  employeeId?: string;
  employee: string;
  employeeWbLogin?: string;
  employeeEmail?: string;
  status: string;
  delivered: string;
  deliveredAt?: string;
  impact: string;
  observation?: string;
};


type EquipmentSummary = {
  total: number;
  inUse: number;
  available: number;
  maintenance: number;
  returned: number;
  pending: number;
};


type EquipmentImportPreview = {
  success: boolean;
  message?: string;
  summary: {
    totalRows: number;
    validRows: number;
    errorRows: number;
    warningRows: number;
    createdRows: number;
    updatedRows: number;
  };
  rows: Array<{
    rowNumber: number;
    numeroSerie: string;
    type: string;
    model: string;
    status: string;
    responsible: string;
    deliveredAt: string;
    action: string;
    errors: string[];
    warnings: string[];
    normalized?: Record<string, unknown>;
  }>;
};


export function EquipmentPage() {
  const equipmentFileInputRef = useRef<HTMLInputElement | null>(null);
  const [rows, setRows] = useState<EquipmentItem[]>([]);
  const [summary, setSummary] = useState<EquipmentSummary>({ total: 0, inUse: 0, available: 0, maintenance: 0, returned: 0, pending: 0 });
  const [canManage, setCanManage] = useState(false);
  const [equipmentMessage, setEquipmentMessage] = useState("");
  const emptyEquipmentFilters = { search: "", serialNumber: "", status: "Todos", type: "Todos", responsible: "", responsibleId: "", model: "", deliveredFrom: "", deliveredTo: "" };
  const initialEquipmentFilters = { ...emptyEquipmentFilters, responsibleId: queryParam("responsibleId") };
  const [equipmentFilters, setEquipmentFilters] = useState(initialEquipmentFilters);
  const [appliedEquipmentFilters, setAppliedEquipmentFilters] = useState(initialEquipmentFilters);
  const [equipmentForm, setEquipmentForm] = useState({
    id: "",
    numeroSerie: "",
    tipoEquipamento: "Notebook",
    modelo: "",
    responsavel: "",
    dataEntrega: new Date().toISOString().slice(0, 10),
    status: "Disponível",
    observacao: ""
  });
  const [equipmentPreview, setEquipmentPreview] = useState<EquipmentImportPreview | null>(null);
  const [savingEquipment, setSavingEquipment] = useState(false);
  const [importingEquipment, setImportingEquipment] = useState(false);
  const [equipmentPagination, setEquipmentPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });
  const [equipmentHistory, setEquipmentHistory] = useState<{ equipment: EquipmentItem; history: Array<{ id: string; action: string; reason: string; actor: string; createdAt: string }> } | null>(null);
  const [loadingEquipmentHistory, setLoadingEquipmentHistory] = useState(false);

  useEffect(() => {
    void refreshEquipment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshEquipment(filters = equipmentFilters, page = equipmentPagination.page) {
    const params = new URLSearchParams({ page: String(page), limit: String(equipmentPagination.limit) });
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== "Todos") params.set(key, value);
    });
    const payload = await apiJson<{ data: EquipmentItem[]; summary: EquipmentSummary; canManage: boolean; pagination?: typeof equipmentPagination }>(`/api/equipment?${params.toString()}`);
    if (!payload.data.length && (payload.pagination?.total ?? 0) > 0 && page > 1) {
      await refreshEquipment(filters, 1);
      return;
    }
    setRows(payload.data);
    setSummary(payload.summary);
    setCanManage(payload.canManage);
    setEquipmentPagination(payload.pagination ?? { page, limit: equipmentPagination.limit, total: payload.data.length, totalPages: 1 });
    setAppliedEquipmentFilters(filters);
  }

  async function saveEquipmentForm() {
    setSavingEquipment(true);
    try {
      const payload = await apiJson<{ message: string }>("/api/equipment", {
        method: equipmentForm.id ? "PATCH" : "POST",
        body: JSON.stringify({
          id: equipmentForm.id || undefined,
          numeroSerie: equipmentForm.numeroSerie,
          tipoEquipamento: equipmentForm.tipoEquipamento,
          modelo: equipmentForm.modelo,
          responsavelWbLogin: equipmentForm.responsavel,
          responsavelEmail: equipmentForm.responsavel,
          responsavelNome: equipmentForm.responsavel,
          dataEntrega: equipmentForm.dataEntrega,
          status: equipmentForm.status,
          observacao: equipmentForm.observacao
        })
      });
      setEquipmentMessage(payload.message);
      setEquipmentForm({ id: "", numeroSerie: "", tipoEquipamento: "Notebook", modelo: "", responsavel: "", dataEntrega: new Date().toISOString().slice(0, 10), status: "Disponível", observacao: "" });
      await refreshEquipment(equipmentFilters, equipmentPagination.page);
    } catch (error) {
      setEquipmentMessage(error instanceof Error ? error.message : "Não foi possível salvar o equipamento.");
    } finally {
      setSavingEquipment(false);
    }
  }

  function editEquipment(item: EquipmentItem) {
    setEquipmentForm({
      id: item.id ?? "",
      numeroSerie: item.serial ?? item.code,
      tipoEquipamento: item.type,
      modelo: item.model ?? "",
      responsavel: item.employeeWbLogin || item.employeeEmail || item.employee,
      dataEntrega: item.deliveredAt || new Date().toISOString().slice(0, 10),
      status: item.status,
      observacao: item.observation ?? ""
    });
  }

  async function inactivateEquipmentRow(id?: string) {
    if (!id) return;
    if (!window.confirm("Tem certeza que deseja inativar este equipamento? Ele continuará no histórico.")) return;
    const payload = await apiJson<{ message: string }>(`/api/equipment?id=${encodeURIComponent(id)}&action=inactivate`, { method: "DELETE" });
    setEquipmentMessage(payload.message);
    await refreshEquipment(equipmentFilters, equipmentPagination.page);
  }

  async function deleteEquipmentRow(id?: string) {
    if (!id) return;
    const reason = window.prompt("Informe o motivo da exclusão do equipamento.");
    if (!reason?.trim()) return;
    const payload = await apiJson<{ message: string }>(`/api/equipment?id=${encodeURIComponent(id)}&reason=${encodeURIComponent(reason.trim())}`, { method: "DELETE" });
    setEquipmentMessage(payload.message);
    await refreshEquipment(equipmentFilters, equipmentPagination.page);
  }

  async function openEquipmentHistory(id?: string) {
    if (!id) return;
    setLoadingEquipmentHistory(true);
    try {
      const payload = await apiJson<{ data: { equipment: EquipmentItem; history: Array<{ id: string; action: string; reason: string; actor: string; createdAt: string }> } }>(`/api/equipment?historyId=${encodeURIComponent(id)}`);
      setEquipmentHistory(payload.data);
    } catch (error) {
      setEquipmentMessage(error instanceof Error ? error.message : "Não foi possível carregar o histórico do equipamento.");
    } finally {
      setLoadingEquipmentHistory(false);
    }
  }

  async function previewEquipmentFile(file?: File) {
    if (!file) return;
    setEquipmentMessage(`Arquivo selecionado: ${file.name}`);
    const formData = new FormData();
    formData.append("file", file);
    setEquipmentPreview(await apiJson<EquipmentImportPreview>("/api/equipment/import/preview", { method: "POST", body: formData }));
  }

  async function commitEquipmentFile() {
    if (!equipmentPreview) return;
    setImportingEquipment(true);
    try {
      const payload = await apiJson<{ message: string; summary: { createdRows: number; updatedRows: number; skippedRows: number } }>("/api/equipment/import/commit", {
        method: "POST",
        body: JSON.stringify({ rows: equipmentPreview.rows })
      });
      setEquipmentMessage(`${payload.message} Criados: ${payload.summary.createdRows}. Atualizados: ${payload.summary.updatedRows}. Ignorados: ${payload.summary.skippedRows}.`);
      setEquipmentPreview(null);
      await refreshEquipment(equipmentFilters, 1);
    } catch (error) {
      setEquipmentMessage(error instanceof Error ? error.message : "Não foi possível importar equipamentos.");
    } finally {
      setImportingEquipment(false);
    }
  }

  const equipmentTypes = ["Todos", "Notebook", "Desktop", "Monitor", "Headset", "Mouse", "Teclado", "Cadeira", "Celular", "Outro"];
  const equipmentStatuses = ["Todos", "Disponível", "Em uso", "Em manutenção", "Devolvido", "Extraviado", "Inativo"];
  const activeEquipmentFilters = [
    appliedEquipmentFilters.search.trim() ? `Busca: ${appliedEquipmentFilters.search.trim()}` : "",
    appliedEquipmentFilters.serialNumber.trim() ? `Série: ${appliedEquipmentFilters.serialNumber.trim()}` : "",
    appliedEquipmentFilters.status !== "Todos" ? `Status: ${appliedEquipmentFilters.status}` : "",
    appliedEquipmentFilters.type !== "Todos" ? `Tipo: ${appliedEquipmentFilters.type}` : "",
    appliedEquipmentFilters.responsible.trim() ? `Responsável: ${appliedEquipmentFilters.responsible.trim()}` : "",
    appliedEquipmentFilters.model.trim() ? `Modelo: ${appliedEquipmentFilters.model.trim()}` : "",
    appliedEquipmentFilters.deliveredFrom ? `Entrega inicial: ${appliedEquipmentFilters.deliveredFrom}` : "",
    appliedEquipmentFilters.deliveredTo ? `Entrega final: ${appliedEquipmentFilters.deliveredTo}` : ""
  ].filter(Boolean);
  const hasEquipmentFilters = activeEquipmentFilters.length > 0;
  const equipmentCardContext = hasEquipmentFilters ? activeEquipmentFilters.length === 1 ? activeEquipmentFilters[0] : "Filtros aplicados" : "Base completa";
  const equipmentCardHelper = (defaultHelper: string) => hasEquipmentFilters ? equipmentCardContext : defaultHelper;
  function clearEquipmentFilters() {
    setEquipmentFilters(emptyEquipmentFilters);
    void refreshEquipment(emptyEquipmentFilters, 1);
  }
  const equipmentExportUrl = () => {
    const params = new URLSearchParams();
    Object.entries(appliedEquipmentFilters).forEach(([key, value]) => {
      if (value && value !== "Todos") params.set(key, value);
    });
    return `/api/equipment/export?${params.toString()}`;
  };

  return (
    <div>
      <PageHeader title="Equipamentos e Logística" description="Gerencie equipamentos, manutenções e logística operacional" icon={Laptop} actions={<TopActions />} />
      {equipmentMessage ? (
        <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{equipmentMessage}</div>
      ) : null}
      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <StatCard title={hasEquipmentFilters ? "Total filtrado" : "Total de equipamentos"} value={summary.total} helper={equipmentCardContext} icon={Laptop} tone="blue" />
        <StatCard title="Em uso" value={summary.inUse} helper={equipmentCardHelper("vinculados a responsável")} icon={CheckCircle2} tone="green" />
        <StatCard title="Disponíveis" value={summary.available} helper={equipmentCardHelper("prontos para entrega")} icon={Laptop} tone="cyan" />
        <StatCard title="Em manutenção" value={summary.maintenance} helper={equipmentCardHelper("atenção logística")} icon={Wrench} tone="orange" />
        <StatCard title="Devolvidos" value={summary.returned} helper={equipmentCardHelper("retornados ao estoque")} icon={RefreshCw} tone="purple" />
        <StatCard title="Sem responsável / Pendentes" value={summary.pending} helper={equipmentCardHelper("sem responsável/inativo")} icon={AlertTriangle} tone="red" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel title="Equipamentos">
          {canManage ? <input ref={equipmentFileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => void previewEquipmentFile(event.target.files?.[0])} /> : null}
          <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <div className="flex h-10 items-center gap-2 rounded-lg border border-border px-3 xl:col-span-2">
              <Search className="h-4 w-4 text-muted" />
              <input value={equipmentFilters.search} onChange={(event) => setEquipmentFilters({ ...equipmentFilters, search: event.target.value })} className="min-w-0 flex-1 text-sm outline-none" placeholder="Pesquisar série, modelo ou responsável" />
            </div>
            <input value={equipmentFilters.serialNumber} onChange={(event) => setEquipmentFilters({ ...equipmentFilters, serialNumber: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Número de série" />
            <select value={equipmentFilters.status} onChange={(event) => setEquipmentFilters({ ...equipmentFilters, status: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
              {equipmentStatuses.map((status) => <option key={status}>{status}</option>)}
            </select>
            <select value={equipmentFilters.type} onChange={(event) => setEquipmentFilters({ ...equipmentFilters, type: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
              {equipmentTypes.map((type) => <option key={type}>{type}</option>)}
            </select>
            <input value={equipmentFilters.responsible} onChange={(event) => setEquipmentFilters({ ...equipmentFilters, responsible: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Responsável ou WB/Login" />
            <input value={equipmentFilters.model} onChange={(event) => setEquipmentFilters({ ...equipmentFilters, model: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Modelo" />
            <label className="block">
              <span className="sr-only">Entrega inicial</span>
              <input type="date" value={equipmentFilters.deliveredFrom} onChange={(event) => setEquipmentFilters({ ...equipmentFilters, deliveredFrom: event.target.value })} className="h-10 w-full rounded-lg border border-border px-3 text-sm outline-none" />
            </label>
            <label className="block">
              <span className="sr-only">Entrega final</span>
              <input type="date" value={equipmentFilters.deliveredTo} onChange={(event) => setEquipmentFilters({ ...equipmentFilters, deliveredTo: event.target.value })} className="h-10 w-full rounded-lg border border-border px-3 text-sm outline-none" />
            </label>
            <div className="grid grid-cols-2 gap-2 xl:col-span-2">
              <button onClick={() => void refreshEquipment(equipmentFilters, 1)} className="h-10 rounded-lg bg-blue-600 px-3 text-sm font-bold text-white">Filtrar</button>
              <button onClick={clearEquipmentFilters} className="h-10 rounded-lg border border-border bg-white px-3 text-sm font-bold text-navy-950">Limpar filtros</button>
            </div>
          </div>
          {hasEquipmentFilters ? (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
              <span>Exibindo equipamentos filtrados</span>
              {activeEquipmentFilters.map((filter) => <span key={filter} className="rounded-md bg-white px-2 py-1 text-navy-950">{filter}</span>)}
            </div>
          ) : null}
          <div className="mb-4 flex flex-wrap gap-2">
            <a href={equipmentExportUrl()} className="flex h-10 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-bold"><Download className="h-4 w-4" />Exportar XLSX</a>
            {canManage ? (
              <>
                <button type="button" onClick={() => void downloadFile("/api/equipment/template", "template_equipamentos.xlsx").catch((error) => setEquipmentMessage(error.message))} className="flex h-10 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-bold"><FileSpreadsheet className="h-4 w-4" />Baixar template</button>
                <button type="button" onClick={() => equipmentFileInputRef.current?.click()} className="flex h-10 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-bold"><Upload className="h-4 w-4" />Importar</button>
              </>
            ) : null}
          </div>
          {rows.length ? (
            <>
              <SimpleTable
                columns={["Nº série", "Tipo", "Modelo", "Responsável", "WB/Login", "Entrega", "Status", "Ações"]}
                rows={rows.map((item) => [
                  <button key={`${item.code}-history`} type="button" onClick={() => void openEquipmentHistory(item.id)} className="font-extrabold text-blue-700 hover:underline">{item.serial ?? item.code}</button>,
                  item.type,
                  item.model ?? "",
                  item.employee,
                  item.employeeWbLogin ?? "",
                  item.delivered,
                  <StatusBadge key={`${item.code}-s`} status={item.status} />,
                  canManage ? (
                    <div key={`${item.code}-actions`} className="flex flex-wrap gap-2">
                      <button onClick={() => editEquipment(item)} className="rounded-lg border border-border px-2 py-1 text-xs font-bold">Editar</button>
                      <button onClick={() => void inactivateEquipmentRow(item.id)} className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">Inativar</button>
                      <button onClick={() => void deleteEquipmentRow(item.id)} className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-600">Excluir</button>
                    </div>
                  ) : "Visualização"
                ])}
              />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
                <span>
                  {equipmentPagination.total
                    ? `Exibindo ${(equipmentPagination.page - 1) * equipmentPagination.limit + 1}-${Math.min(equipmentPagination.page * equipmentPagination.limit, equipmentPagination.total)} de ${equipmentPagination.total} equipamentos`
                    : "Nenhum equipamento"}
                </span>
                <div className="flex flex-wrap gap-2">
                  <button disabled={equipmentPagination.page <= 1} onClick={() => void refreshEquipment(appliedEquipmentFilters, 1)} className="h-9 rounded-lg border border-border bg-white px-3 text-xs font-bold text-navy-950 disabled:cursor-not-allowed disabled:opacity-45">Primeira</button>
                  <button disabled={equipmentPagination.page <= 1} onClick={() => void refreshEquipment(appliedEquipmentFilters, equipmentPagination.page - 1)} className="h-9 rounded-lg border border-border bg-white px-3 text-xs font-bold text-navy-950 disabled:cursor-not-allowed disabled:opacity-45">Anterior</button>
                  <span className="grid h-9 min-w-24 place-items-center rounded-lg border border-blue-100 bg-blue-50 px-3 text-xs font-extrabold text-blue-700">
                    {equipmentPagination.page} de {equipmentPagination.totalPages}
                  </span>
                  <button disabled={equipmentPagination.page >= equipmentPagination.totalPages} onClick={() => void refreshEquipment(appliedEquipmentFilters, equipmentPagination.page + 1)} className="h-9 rounded-lg border border-border bg-white px-3 text-xs font-bold text-navy-950 disabled:cursor-not-allowed disabled:opacity-45">Próxima</button>
                  <button disabled={equipmentPagination.page >= equipmentPagination.totalPages} onClick={() => void refreshEquipment(appliedEquipmentFilters, equipmentPagination.totalPages)} className="h-9 rounded-lg border border-border bg-white px-3 text-xs font-bold text-navy-950 disabled:cursor-not-allowed disabled:opacity-45">Última</button>
                </div>
              </div>
            </>
          ) : (
            <EmptyState title={hasEquipmentFilters ? "Nenhum equipamento encontrado para os filtros selecionados." : "Nenhum equipamento cadastrado."} description={hasEquipmentFilters ? "Ajuste ou limpe os filtros para ampliar a busca." : "Cadastre ou importe equipamentos para começar."} />
          )}
        </Panel>
        <div className="space-y-5">
          {canManage ? (
            <Panel title={equipmentForm.id ? "Editar equipamento" : "Cadastrar equipamento"}>
              <div className="grid gap-3">
                <FormInput label="Número de série" value={equipmentForm.numeroSerie} onChange={(value) => setEquipmentForm({ ...equipmentForm, numeroSerie: value })} />
                <FormSelect label="Tipo" value={equipmentForm.tipoEquipamento} options={equipmentTypes.filter((type) => type !== "Todos")} onChange={(value) => setEquipmentForm({ ...equipmentForm, tipoEquipamento: value })} />
                <FormInput label="Modelo" value={equipmentForm.modelo} onChange={(value) => setEquipmentForm({ ...equipmentForm, modelo: value })} />
                <FormInput label="Responsável (WB/Login, e-mail ou nome)" value={equipmentForm.responsavel} onChange={(value) => setEquipmentForm({ ...equipmentForm, responsavel: value })} />
                <FormInput label="Data de entrega" type="date" value={equipmentForm.dataEntrega} onChange={(value) => setEquipmentForm({ ...equipmentForm, dataEntrega: value })} />
                <FormSelect label="Status" value={equipmentForm.status} options={equipmentStatuses.filter((status) => status !== "Todos")} onChange={(value) => setEquipmentForm({ ...equipmentForm, status: value })} />
                <label className="block">
                  <span className="mb-1.5 block text-sm font-bold text-muted">Observação</span>
                  <textarea value={equipmentForm.observacao} onChange={(event) => setEquipmentForm({ ...equipmentForm, observacao: event.target.value })} className="min-h-24 w-full rounded-lg border border-border p-3 text-sm outline-none" />
                </label>
                <button disabled={savingEquipment} onClick={saveEquipmentForm} className="flex h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-50">
                  <Plus className="h-4 w-4" />
                  {savingEquipment ? "Salvando..." : equipmentForm.id ? "Salvar alterações" : "Cadastrar equipamento"}
                </button>
              </div>
            </Panel>
          ) : null}
          <Panel title="Resumo logístico">
            <DonutLegend
              total={summary.total}
              items={[
                { label: "Em uso", value: String(summary.inUse), color: "#10B981" },
                { label: "Disponíveis", value: String(summary.available), color: "#2563EB" },
                { label: "Manutenção", value: String(summary.maintenance), color: "#F59E0B" },
                { label: "Devolvidos", value: String(summary.returned), color: "#8B5CF6" },
                { label: "Pendências", value: String(summary.pending), color: "#EF4444" }
              ]}
            />
          </Panel>
        </div>
      </div>
      {equipmentPreview ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden">
            <div className="shrink-0 flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Preview da importação de equipamentos</h2>
                <p className="text-sm text-muted">Total: {equipmentPreview.summary.totalRows} • Válidas: {equipmentPreview.summary.validRows} • Erros: {equipmentPreview.summary.errorRows} • Alertas: {equipmentPreview.summary.warningRows}</p>
              </div>
              <button onClick={() => setEquipmentPreview(null)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              <ImportIssueSummary rows={equipmentPreview.rows} title="Corrija estas linhas do arquivo de equipamentos" />
              <div className="max-h-[56vh] overflow-y-auto">
                <SimpleTable
                  columns={["Linha", "Série", "Tipo", "Modelo", "Responsável", "Status", "Ação", "Erros/alertas"]}
                  rows={equipmentPreview.rows.slice(0, IMPORT_PREVIEW_ROW_LIMIT).map((row) => [
                    row.rowNumber,
                    row.numeroSerie,
                    row.type,
                    row.model,
                    row.responsible,
                    <StatusBadge key={`${row.rowNumber}-status`} status={row.errors.length ? "Erro" : row.status} />,
                    row.action === "update" ? "Atualizar" : row.action === "create" ? "Criar" : "Ignorar",
                    [...row.errors, ...row.warnings].join(" | ") || "Linha válida"
                  ])}
                />
              </div>
              {equipmentPreview.rows.length > IMPORT_PREVIEW_ROW_LIMIT ? <p className="text-xs font-semibold text-muted">Exibindo as primeiras {IMPORT_PREVIEW_ROW_LIMIT} linhas do preview. O arquivo completo será processado na confirmação.</p> : null}
            </div>
            <div className="shrink-0 flex flex-wrap justify-end gap-3 border-t border-border bg-white px-5 py-3">
              <button onClick={() => setEquipmentPreview(null)} className="h-11 rounded-lg border border-border px-4 text-sm font-bold">Cancelar</button>
              <button disabled={importingEquipment || equipmentPreview.summary.errorRows > 0} onClick={commitEquipmentFile} className="h-11 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
                {importingEquipment ? "Importando..." : "Confirmar importação"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {equipmentHistory ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card max-h-[90vh] w-full max-w-3xl overflow-y-auto p-5">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Histórico do equipamento</h2>
                <p className="text-sm font-semibold text-muted">{equipmentHistory.equipment.serial ?? equipmentHistory.equipment.code} • {equipmentHistory.equipment.type} • {equipmentHistory.equipment.status}</p>
              </div>
              <button onClick={() => setEquipmentHistory(null)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            <div className="mb-4 grid gap-2 md:grid-cols-2">
              <InfoLine label="Modelo" value={equipmentHistory.equipment.model ?? "-"} />
              <InfoLine label="Responsável atual" value={equipmentHistory.equipment.employee} />
              <InfoLine label="WB/Login" value={equipmentHistory.equipment.employeeWbLogin ?? "-"} />
              <InfoLine label="Data de entrega" value={equipmentHistory.equipment.delivered} />
            </div>
            {loadingEquipmentHistory ? (
              <p className="rounded-lg border border-border p-4 text-sm font-bold text-muted">Carregando histórico...</p>
            ) : equipmentHistory.history.length ? (
              <div className="space-y-2">
                {equipmentHistory.history.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-border bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-extrabold text-navy-950">{entry.action}</p>
                      <p className="text-xs font-bold text-muted">{new Date(entry.createdAt).toLocaleString("pt-BR")}</p>
                    </div>
                    <p className="mt-1 text-xs font-semibold text-muted">Por {entry.actor}</p>
                    {entry.reason ? <p className="mt-2 text-sm text-navy-900">{entry.reason}</p> : null}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Sem histórico registrado" description="As próximas alterações de responsável, status ou dados do equipamento aparecerão aqui." />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
