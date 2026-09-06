"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Coins } from "lucide-react";
import { EmptyState, MetricPill, PageHeader, Panel, SimpleTable, StatusBadge } from "@/components/ui/primitives";
import { canEditAdvanceRecords } from "@/lib/permissions";
import { MONTHLY_ADVANCE_ENDED_MESSAGE, isMonthlyAdvanceReferenceMonthAvailable } from "@/lib/monthly-advance-constants";
import { FormInput, IMPORT_PREVIEW_ROW_LIMIT, ImportIssueSummary, MonthlyAdvanceRecordClient, SystemSettings, apiJson, currencyFormatter, currentOperationalMonthInput, downloadFile } from './shared';
type MonthlyAdvanceListResponse = {
  data: MonthlyAdvanceRecordClient[];
  summary: { total: number; optIn: number; optOut: number; amount: number };
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  referenceMonth: string;
  canManage: boolean;
  canExport: boolean;
  message?: string;
};


type MonthlyAdvanceImportPreview = {
  totalRows: number;
  validRows: number;
  errorRows: number;
  createdRows: number;
  updatedRows: number;
  foundEmployees: number;
  missingEmployees: number;
  rows: Array<{
    rowNumber: number;
    wbLogin: string;
    referenceMonth: string;
    optIn: boolean | null;
    amount: number | null;
    observation: string;
    employeeId?: string;
    employeeName?: string;
    contractType?: string;
    action?: "create" | "update";
    errors: string[];
    warnings: string[];
  }>;
};


function addMonthInput(value: string, delta: number) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}


export function AdvanceManagementPage() {
  const { data: session } = useSession();
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [message, setMessage] = useState("");
  const [advanceRows, setAdvanceRows] = useState<MonthlyAdvanceRecordClient[]>([]);
  const [advanceSummary, setAdvanceSummary] = useState<MonthlyAdvanceListResponse["summary"] | null>(null);
  const [advanceReferenceMonth, setAdvanceReferenceMonth] = useState(() => currentOperationalMonthInput());
  const [lobFilter, setLobFilter] = useState("Todos");
  const [supervisorFilter, setSupervisorFilter] = useState("Todos");
  const [advanceOptInFilter, setAdvanceOptInFilter] = useState("Todos");
  const [advanceSearch, setAdvanceSearch] = useState("");
  const [advanceLoading, setAdvanceLoading] = useState(false);
  const [advanceImportRows, setAdvanceImportRows] = useState<Array<Record<string, unknown>>>([]);
  const [advancePreview, setAdvancePreview] = useState<MonthlyAdvanceImportPreview | null>(null);
  const [advanceImporting, setAdvanceImporting] = useState(false);
  const [advanceEditingId, setAdvanceEditingId] = useState("");
  const canManageMonthlyAdvance = canEditAdvanceRecords({ role: session?.user?.role });
  const canDeleteMonthlyAdvance = canManageMonthlyAdvance;
  const lobs = ["Todos", ...(settings?.lobs.filter((lob) => lob.status !== "INACTIVE").map((lob) => lob.name) ?? [])];
  const supervisors = settings?.supervisors?.filter((supervisor) => supervisor.status !== "INACTIVE") ?? [];
  const currentMonth = currentOperationalMonthInput();
  const nextMonth = addMonthInput(currentMonth, 1);
  const isSelectedAdvanceMonthAvailable = isMonthlyAdvanceReferenceMonthAvailable(advanceReferenceMonth);
  const canExportCurrentAdvanceMonth = isMonthlyAdvanceReferenceMonthAvailable(currentMonth);
  const canExportNextAdvanceMonth = isMonthlyAdvanceReferenceMonthAvailable(nextMonth);

  useEffect(() => {
    void loadMonthlyAdvances();
    apiJson<{ data: SystemSettings }>("/api/settings")
      .then((payload) => setSettings(payload.data))
      .catch(() => setSettings(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadMonthlyAdvances(options?: { nextReferenceMonth?: string; nextLob?: string; nextSupervisor?: string; nextOptIn?: string; nextSearch?: string }) {
    setAdvanceLoading(true);
    const nextReferenceMonth = options?.nextReferenceMonth ?? advanceReferenceMonth;
    const nextLob = options?.nextLob ?? lobFilter;
    const nextSupervisor = options?.nextSupervisor ?? supervisorFilter;
    const nextOptIn = options?.nextOptIn ?? advanceOptInFilter;
    const nextSearch = options?.nextSearch ?? advanceSearch;
    const params = new URLSearchParams({ referenceMonth: nextReferenceMonth, limit: "100" });
    if (nextLob !== "Todos") params.set("lob", nextLob);
    if (nextSupervisor !== "Todos") params.set("supervisorId", nextSupervisor);
    if (nextOptIn !== "Todos") params.set("optIn", nextOptIn);
    if (nextSearch.trim()) params.set("search", nextSearch.trim());
    try {
      const payload = await apiJson<MonthlyAdvanceListResponse>(`/api/monthly-advance?${params.toString()}`);
      setAdvanceRows(payload.data);
      setAdvanceSummary(payload.summary);
      if (payload.message) setMessage(payload.message);
      else setMessage((previous) => previous === MONTHLY_ADVANCE_ENDED_MESSAGE ? "" : previous);
    } catch (error) {
      setAdvanceRows([]);
      setAdvanceSummary(null);
      setMessage(error instanceof Error ? error.message : "Não foi possível carregar adiantamento mensal.");
    } finally {
      setAdvanceLoading(false);
    }
  }

  async function previewMonthlyAdvanceImport(file: File | null) {
    if (!file || advanceImporting || !canManageMonthlyAdvance) return;
    setAdvanceImporting(true);
    setMessage("");
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer());
      const sheetName = workbook.SheetNames.find((name) => /adiantamento/i.test(name)) ?? workbook.SheetNames[0];
      const rows = sheetName ? XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: "" }) : [];
      const formData = new FormData();
      formData.append("file", file);
      formData.append("referenceMonth", advanceReferenceMonth);
      const payload = await apiJson<MonthlyAdvanceImportPreview>("/api/monthly-advance/import/preview", { method: "POST", body: formData });
      setAdvanceImportRows(rows);
      setAdvancePreview(payload);
      setMessage(payload.errorRows ? "Preview do adiantamento gerado com linhas para revisar." : "Preview do adiantamento gerado sem erros.");
    } catch (error) {
      setAdvancePreview(null);
      setAdvanceImportRows([]);
      setMessage(error instanceof Error ? error.message : "Não foi possível validar o arquivo de adiantamento.");
    } finally {
      setAdvanceImporting(false);
    }
  }

  async function commitMonthlyAdvanceImport() {
    if (!advancePreview || advanceImporting || !canManageMonthlyAdvance) return;
    setAdvanceImporting(true);
    setMessage("");
    try {
      const payload = await apiJson<{ data: { importedRows: number; createdRows: number; updatedRows: number } }>("/api/monthly-advance/import/commit", {
        method: "POST",
        body: JSON.stringify({ rows: advanceImportRows, referenceMonth: advanceReferenceMonth })
      });
      setMessage(`Adiantamento importado: ${payload.data.importedRows} linha(s), ${payload.data.createdRows} criada(s), ${payload.data.updatedRows} atualizada(s).`);
      setAdvancePreview(null);
      setAdvanceImportRows([]);
      await loadMonthlyAdvances();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível importar adiantamento mensal.");
    } finally {
      setAdvanceImporting(false);
    }
  }

  async function editMonthlyAdvance(record: MonthlyAdvanceRecordClient) {
    if (!canManageMonthlyAdvance || advanceEditingId) return;
    let optIn = record.optIn;
    let observation = record.observation ?? "";

    const optInAnswer = window.prompt("Aderente? Digite Sim ou Não.", record.optIn ? "Sim" : "Não");
    if (!optInAnswer) return;
    const normalizedOptIn = optInAnswer.trim().toLowerCase();
    if (!["sim", "s", "true", "1", "não", "nao", "n", "false", "0"].includes(normalizedOptIn)) {
      setMessage("Aderente deve ser Sim ou Não.");
      return;
    }
    optIn = ["sim", "s", "true", "1"].includes(normalizedOptIn);
    observation = window.prompt("Observação opcional.", record.observation ?? "") ?? "";

    setAdvanceEditingId(record.id);
    try {
      await apiJson<{ data: MonthlyAdvanceRecordClient }>("/api/monthly-advance", {
        method: "PATCH",
        body: JSON.stringify({
          employeeId: record.employeeId,
          referenceMonth: record.referenceMonth,
          optIn,
          observation
        })
      });
      setMessage("Adiantamento mensal atualizado.");
      await loadMonthlyAdvances();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível atualizar adiantamento mensal.");
    } finally {
      setAdvanceEditingId("");
    }
  }

  async function removeMonthlyAdvanceRecord(record: MonthlyAdvanceRecordClient) {
    if (!canDeleteMonthlyAdvance || advanceEditingId) return;
    if (!window.confirm("Tem certeza que deseja remover este registro de adiantamento? Esta ação não altera dados do parceiro.")) return;
    setAdvanceEditingId(record.id);
    try {
      await apiJson<{ data: MonthlyAdvanceRecordClient }>("/api/monthly-advance", {
        method: "DELETE",
        body: JSON.stringify({ id: record.id })
      });
      setMessage("Registro de adiantamento removido.");
      await loadMonthlyAdvances();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível remover adiantamento mensal.");
    } finally {
      setAdvanceEditingId("");
    }
  }

  function exportMonthlyAdvanceXlsx(referenceMonth = advanceReferenceMonth) {
    const params = new URLSearchParams({ referenceMonth });
    if (lobFilter !== "Todos") params.set("lob", lobFilter);
    if (supervisorFilter !== "Todos") params.set("supervisorId", supervisorFilter);
    if (advanceOptInFilter !== "Todos") params.set("optIn", advanceOptInFilter);
    if (advanceSearch.trim()) params.set("search", advanceSearch.trim());
    window.location.href = `/api/monthly-advance/export?${params.toString()}`;
  }

  return (
    <div>
      <PageHeader
        title="Adiantamento"
        description="Gestão mensal de adesão, valores e exportações para parceiros PJ."
        icon={Coins}
        actions={(
          <div className="flex flex-wrap gap-2">
            {canExportCurrentAdvanceMonth ? <button type="button" onClick={() => exportMonthlyAdvanceXlsx(currentMonth)} className="premium-control h-10 px-4 text-sm font-extrabold text-navy-950">Exportar mês atual</button> : null}
            {canExportNextAdvanceMonth ? <button type="button" onClick={() => exportMonthlyAdvanceXlsx(nextMonth)} className="premium-control h-10 px-4 text-sm font-extrabold text-navy-950">Exportar próximo mês</button> : null}
          </div>
        )}
      />
      {message ? <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{message}</div> : null}
      <div className="space-y-5">
        <Panel title="Filtros e importação">
          {!isSelectedAdvanceMonthAvailable ? (
            <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{MONTHLY_ADVANCE_ENDED_MESSAGE}</div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <FormInput label="Mês de referência" type="month" value={advanceReferenceMonth} onChange={setAdvanceReferenceMonth} />
            <label className="block">
              <span className="mb-1.5 block text-sm font-bold text-muted">LOB</span>
              <select value={lobFilter} onChange={(event) => setLobFilter(event.target.value)} className="h-11 w-full rounded-lg border border-border px-3 text-sm font-bold">
                {lobs.map((lob) => <option key={lob} value={lob}>{lob === "Todos" ? "Todas as LOBs" : lob}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-bold text-muted">Supervisor</span>
              <select value={supervisorFilter} onChange={(event) => setSupervisorFilter(event.target.value)} className="h-11 w-full rounded-lg border border-border px-3 text-sm font-bold">
                <option value="Todos">Todos</option>
                <option value="SEM_SUPERVISOR">Sem supervisor</option>
                {supervisors.map((supervisor) => <option key={supervisor.id} value={supervisor.id}>{supervisor.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-bold text-muted">Aderente</span>
              <select value={advanceOptInFilter} onChange={(event) => setAdvanceOptInFilter(event.target.value)} className="h-11 w-full rounded-lg border border-border px-3 text-sm font-bold">
                <option value="Todos">Todos</option>
                <option value="Sim">Sim</option>
                <option value="Não">Não</option>
              </select>
            </label>
            <FormInput label="Parceiro / WB/Login" value={advanceSearch} onChange={setAdvanceSearch} />
            <div className="flex items-end gap-2">
              <button type="button" onClick={() => loadMonthlyAdvances()} className="h-11 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white">Buscar</button>
              <button type="button" disabled={!isSelectedAdvanceMonthAvailable} onClick={() => exportMonthlyAdvanceXlsx()} className="h-11 rounded-lg border border-border bg-white px-4 text-sm font-bold text-navy-950 disabled:cursor-not-allowed disabled:opacity-50">Exportar filtros</button>
            </div>
          </div>
          {canManageMonthlyAdvance && isSelectedAdvanceMonthAvailable ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => downloadFile("/api/monthly-advance/template", "template_adiantamento_mensal.xlsx")} className="h-10 rounded-lg border border-border bg-white px-4 text-sm font-bold text-navy-950">Baixar template</button>
              <label className="grid h-10 cursor-pointer place-items-center rounded-lg border border-blue-200 bg-blue-50 px-4 text-sm font-bold text-blue-700">
                {advanceImporting ? "Importando..." : "Importar template"}
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={advanceImporting} onChange={(event) => void previewMonthlyAdvanceImport(event.target.files?.[0] ?? null)} />
              </label>
            </div>
          ) : null}
        </Panel>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <MetricPill value={advanceSummary?.optIn ?? 0} label="Total aderentes" />
          <MetricPill value={advanceSummary?.optOut ?? 0} label="Total não aderentes" />
          <MetricPill value={currencyFormatter.format(advanceSummary?.amount ?? 0)} label="Valor total previsto" />
        </div>

        {advancePreview ? (
          <Panel title="Preview da importação">
            <div className="flex max-h-[72vh] flex-col overflow-hidden">
              <div className="shrink-0 pb-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-bold text-blue-700">
                    Preview: {advancePreview.validRows} válida(s), {advancePreview.errorRows} com erro, {advancePreview.createdRows} criação(ões), {advancePreview.updatedRows} atualização(ões).
                  </p>
                  <div className="flex gap-2">
                    <button type="button" disabled={advanceImporting || !advancePreview.validRows} onClick={commitMonthlyAdvanceImport} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Confirmar importação</button>
                    <button type="button" disabled={advanceImporting} onClick={() => { setAdvancePreview(null); setAdvanceImportRows([]); }} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-navy-950 disabled:opacity-50">Cancelar</button>
                  </div>
                </div>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                <ImportIssueSummary rows={advancePreview.rows} title="Corrija estas linhas do adiantamento" />
                <div className="max-h-[48vh] overflow-y-auto">
                  <SimpleTable
                    columns={["Linha", "WB/Login", "Parceiro", "Contrato", "Mês", "Aderente", "Valor", "Ação", "Erros"]}
                    rows={advancePreview.rows.slice(0, IMPORT_PREVIEW_ROW_LIMIT).map((row) => [
                      row.rowNumber,
                      row.wbLogin || "-",
                      row.employeeName ?? "Não encontrado",
                      row.contractType || "-",
                      row.referenceMonth || "-",
                      row.optIn === null ? "-" : row.optIn ? "Sim" : "Não",
                      row.amount == null ? "-" : currencyFormatter.format(row.amount),
                      row.action === "update" ? "Atualizar" : "Criar",
                      row.errors.length ? <span key={`${row.rowNumber}-errors`} className="text-red-600">{row.errors.join(" ")}</span> : "OK"
                    ])}
                  />
                </div>
                {advancePreview.rows.length > IMPORT_PREVIEW_ROW_LIMIT ? <p className="text-xs font-semibold text-muted">Exibindo as primeiras {IMPORT_PREVIEW_ROW_LIMIT} linhas do preview. O arquivo completo será processado na confirmação.</p> : null}
              </div>
            </div>
          </Panel>
        ) : null}

        <Panel title="Registros de Adiantamento">
          {advanceLoading ? (
            <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm font-bold text-blue-700">Carregando adiantamento mensal...</div>
          ) : advanceRows.length ? (
            <SimpleTable
              columns={["Mês", "Nome", "WB/Login", "Contrato", "E-mail", "LOB", "Supervisor", "Aderente", "Valor", "Observação", "Atualizado por", "Atualizado em", "Ações"]}
              rows={advanceRows.map((record) => [
                record.monthLabel,
                record.employeeName,
                record.wbLogin,
                record.contractType || "PJ",
                record.email ?? "-",
                record.lob ?? "-",
                record.supervisor,
                <StatusBadge key={`${record.id}-opt`} status={record.optInLabel} />,
                currencyFormatter.format(record.amount),
                record.observation ?? "-",
                record.updatedBy ?? "-",
                record.updatedAt,
                canManageMonthlyAdvance ? (
                  <div key={`${record.id}-actions`} className="flex flex-wrap gap-1">
                    <button disabled={advanceEditingId === record.id} onClick={() => editMonthlyAdvance(record)} className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-blue-700 disabled:opacity-50">Editar</button>
                    {canDeleteMonthlyAdvance ? <button disabled={advanceEditingId === record.id} onClick={() => removeMonthlyAdvanceRecord(record)} className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-bold text-red-700 disabled:opacity-50">Excluir</button> : null}
                  </div>
                ) : "Visualizar"
              ])}
            />
          ) : (
            <EmptyState title="Nenhum adiantamento encontrado" description="Use os filtros ou importe o template para criar os registros mensais." />
          )}
        </Panel>
      </div>
    </div>
  );
}
