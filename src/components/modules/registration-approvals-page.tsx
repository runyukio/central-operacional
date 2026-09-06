"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, Download, LockKeyhole, RefreshCw, UserPlus, Upload, XCircle } from "lucide-react";
import { EmptyState, MetricPill, PageHeader, Panel, SimpleTable, StatCard, StatusBadge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { cleanShiftOptions } from "@/lib/shift-display";
import { ApiRequestError, IMPORT_PREVIEW_ROW_LIMIT, ImportIssueSummary, InfoLine, RegistrationItem, SystemSettings, apiJson, currentOperationalDateInput, downloadFile, employeeOperationalStatusOptions } from './shared';
type RegistrationSummary = {
  pending: number;
  active: number;
  adjust: number;
  refused: number;
};


type EmployeeImportPreview = {
  totalRows: number;
  validRows: number;
  errorRows: number;
  warningRows?: number;
  usuariosCriar?: number;
  colaboradoresCriar?: number;
  registrosAtualizar?: number;
  duplicidades?: number;
  rows: Array<{
    rowNumber: number;
    errors: string[];
    warnings: string[];
    changes?: string[];
    keptFields?: string[];
    action?: string;
    status?: string;
    preview: {
      name: string;
      email: string;
      cpf: string;
      wbLogin: string;
      role: string;
      lob: string;
      supervisor: string;
      skill: string;
      wave: string;
      workStartTime?: string;
      workEndTime?: string;
      isPcd?: string;
      pcdDisabilityType?: string;
      pcdDisabilityOther?: string;
      createUser: boolean;
      passwordProvided: boolean;
      currentStatus?: string;
      newStatus?: string;
      userWillBeInactivated?: boolean;
      terminationDate?: string;
    };
  }>;
};


function normalizeExcelKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}


function normalizeEmployeeImportSheetRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeExcelKey(key), value]));
}


function normalizeClockTime(value: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}


export function RegistrationApprovalsPage() {
  const employeeImportInputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<RegistrationItem[]>([]);
  const [registrationPagination, setRegistrationPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });
  const [registrationFilters, setRegistrationFilters] = useState({ search: "", status: "Todos" });
  const [registrationSummary, setRegistrationSummary] = useState<RegistrationSummary>({ pending: 0, active: 0, adjust: 0, refused: 0 });
  const [selected, setSelected] = useState<RegistrationItem | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [showEmployeeImport, setShowEmployeeImport] = useState(false);
  const [employeeImportRows, setEmployeeImportRows] = useState<Array<Record<string, unknown>>>([]);
  const [employeeImportPreview, setEmployeeImportPreview] = useState<EmployeeImportPreview | null>(null);
  const [employeeImportFileName, setEmployeeImportFileName] = useState("");
  const [employeeImportError, setEmployeeImportError] = useState("");
  const [registrationSettings, setRegistrationSettings] = useState<SystemSettings | null>(null);
  const [importingEmployees, setImportingEmployees] = useState(false);
  const [downloadingEmployeeTemplate, setDownloadingEmployeeTemplate] = useState(false);
  const [allowPartialEmployeeImport, setAllowPartialEmployeeImport] = useState(false);
  const [reviewingAction, setReviewingAction] = useState<"approve" | "reject" | "request_adjustment" | null>(null);
  const [deletingRegistration, setDeletingRegistration] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("Dados conferidos. Aprovação liberada para ativação.");
  const [reviewFieldErrors, setReviewFieldErrors] = useState<Record<string, string>>({});
	  const [operational, setOperational] = useState({
	    wbLogin: "",
	    lob: "CEC",
	    supervisor: "",
	    shift: "Manhã",
	    workStartTime: "",
	    workEndTime: "",
	    skill: "",
	    wave: "",
	    roleTitle: "Agente",
    employeeStatus: "Ativo",
    contractType: "PJ",
    admissionDate: currentOperationalDateInput(),
    nestingStartDate: currentOperationalDateInput(),
    goLiveDate: currentOperationalDateInput(),
    internalNotes: "Complementado por RH/Admin/WFM."
  });

  useEffect(() => {
    refreshRegistrations();
    apiJson<{ data: SystemSettings }>("/api/settings")
      .then((payload) => setRegistrationSettings(payload.data))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) return;
    const op = selected.operationalData ?? {};
	    setOperational({
	      wbLogin: op.wbLogin ?? selected.email.split("@")[0],
	      lob: op.lob ?? "CEC",
	      supervisor: op.supervisor ?? "",
	      shift: op.shift ?? "Manhã",
	      workStartTime: op.workStartTime ?? "",
	      workEndTime: op.workEndTime ?? "",
	      skill: op.skill ?? "",
	      wave: op.wave ?? "",
	      roleTitle: op.roleTitle ?? "Agente",
      employeeStatus: op.employeeStatus === "Pendente de Cadastro" ? "Ativo" : op.employeeStatus ?? "Ativo",
      contractType: op.contractType ?? "PJ",
      admissionDate: op.admissionDate ?? currentOperationalDateInput(),
      nestingStartDate: op.nestingStartDate ?? currentOperationalDateInput(),
      goLiveDate: op.goLiveDate ?? currentOperationalDateInput(),
      internalNotes: op.internalNotes ?? "Complementado por RH/Admin/WFM."
    });
    setReviewFieldErrors({});
  }, [selected]);

  async function refreshRegistrations(nextPage = registrationPagination.page, nextLimit = registrationPagination.limit, nextFilters = registrationFilters) {
    const params = new URLSearchParams({
      page: String(nextPage),
      limit: String(nextLimit)
    });
    if (nextFilters.search.trim()) params.set("search", nextFilters.search.trim());
    if (nextFilters.status !== "Todos") params.set("status", nextFilters.status);
    const payload = await apiJson<{ data: RegistrationItem[]; total: number; page: number; limit: number; totalPages: number; summary?: RegistrationSummary }>(`/api/employee-registrations?${params.toString()}`);
    setItems(payload.data);
    setRegistrationPagination({ total: payload.total, page: payload.page, limit: payload.limit, totalPages: payload.totalPages });
    setRegistrationSummary(payload.summary ?? {
      pending: payload.data.filter((item) => item.status === "Pendente de Aprovação").length,
      active: payload.data.filter((item) => item.status === "Ativo" || item.status === "Aprovado").length,
      adjust: payload.data.filter((item) => item.status === "Ajuste Solicitado").length,
      refused: payload.data.filter((item) => item.status === "Recusado").length
    });
    setSelected((current) => current && payload.data.some((item) => item.id === current.id) ? current : payload.data[0] ?? null);
  }

  async function handleEmployeeImportFile(file?: File) {
    if (!file) return;
    setImportingEmployees(true);
    setMessage("");
    setEmployeeImportError("");
    setEmployeeImportPreview(null);
    setEmployeeImportRows([]);
    setEmployeeImportFileName(file.name);
    setShowEmployeeImport(true);
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer);
      const sheetName = workbook.SheetNames.find((name) => ["parceiros", "colaboradores"].includes(normalizeExcelKey(name))) ?? workbook.SheetNames[0];
      if (!sheetName) throw new Error("O arquivo não possui abas para leitura.");
      const sheet = workbook.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const rows = rawRows
        .map(normalizeEmployeeImportSheetRow)
        .filter((row) => Object.values(row).some((value) => String(value ?? "").trim() !== ""));
      if (!rows.length) throw new Error("Nenhuma linha de parceiro encontrada. Verifique se a aba parceiros possui dados.");
      const payload = await apiJson<{ data: EmployeeImportPreview }>("/api/employee-registrations/import/preview", {
        method: "POST",
        body: JSON.stringify({ rows })
      });
      setEmployeeImportRows(rows);
      setEmployeeImportPreview(payload.data);
      setShowEmployeeImport(true);
    } catch (err) {
      setMessageTone("error");
      const errorMessage = err instanceof ApiRequestError ? err.message : err instanceof Error ? err.message : "Não foi possível ler o arquivo de parceiros.";
      setEmployeeImportError(errorMessage);
      setMessage(errorMessage);
      setShowEmployeeImport(true);
    } finally {
      setImportingEmployees(false);
      if (employeeImportInputRef.current) employeeImportInputRef.current.value = "";
    }
  }

  async function downloadEmployeeTemplate() {
    setDownloadingEmployeeTemplate(true);
    setMessage("");
    try {
      await downloadFile("/api/employee-registrations/template", "template_parceiros.xlsx");
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "Não foi possível baixar o template. Tente novamente.");
    } finally {
      setDownloadingEmployeeTemplate(false);
    }
  }

  async function confirmEmployeeImport() {
    if (!employeeImportRows.length || importingEmployees) return;
    setImportingEmployees(true);
    setMessage("");
    setEmployeeImportError("");
    try {
      const chunkSize = 25;
      const chunks = Array.from({ length: Math.ceil(employeeImportRows.length / chunkSize) }, (_, index) => employeeImportRows.slice(index * chunkSize, (index + 1) * chunkSize));
      const summary = { colaboradoresCriados: 0, usuariosCriados: 0, registrosAtualizados: 0, ignoredRows: 0 };
      let processedRows = 0;
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        setMessageTone("success");
        setMessage(`Importando parceiros... lote ${index + 1}/${chunks.length} (${processedRows}/${employeeImportRows.length} linhas processadas).`);
        const payload = await apiJson<{ data: EmployeeImportPreview & { colaboradoresCriados: number; usuariosCriados: number; registrosAtualizados: number; ignoredRows?: number; importBatchId: string } }>("/api/employee-registrations/import/commit", {
          method: "POST",
          body: JSON.stringify({ rows: chunk, allowPartial: allowPartialEmployeeImport })
        });
        summary.colaboradoresCriados += payload.data.colaboradoresCriados;
        summary.usuariosCriados += payload.data.usuariosCriados;
        summary.registrosAtualizados += payload.data.registrosAtualizados;
        summary.ignoredRows += payload.data.ignoredRows ?? 0;
        processedRows += chunk.length;
      }
      setMessageTone("success");
      setMessage(`Importação concluída: ${summary.colaboradoresCriados} parceiro(es), ${summary.usuariosCriados} usuário(s), ${summary.registrosAtualizados} registro(s) atualizado(s), ${summary.ignoredRows} linha(s) ignorada(s).`);
      setShowEmployeeImport(false);
      await refreshRegistrations(1);
    } catch (err) {
      setMessageTone("error");
      const errorMessage = err instanceof ApiRequestError ? err.message : err instanceof Error ? err.message : "Não foi possível importar parceiros.";
      setEmployeeImportError(errorMessage);
      setMessage(errorMessage);
      setShowEmployeeImport(true);
    } finally {
      setImportingEmployees(false);
    }
  }

  async function review(action: "approve" | "reject" | "request_adjustment") {
    if (!selected) return;
    setReviewFieldErrors({});
    if ((action === "reject" || action === "request_adjustment") && !reviewNotes.trim()) {
      setMessageTone("error");
      setMessage(action === "reject" ? "Informe o motivo da recusa." : "Informe o comentário do ajuste solicitado.");
      return;
    }
    if (action === "approve" && selected.hasPassword === false) {
      setMessageTone("error");
      setMessage("Este cadastro não possui senha cadastrada. Solicite ajuste ao parceiro.");
      return;
    }
    if (action === "approve") {
      const fieldLabels: Record<string, string> = {
        wbLogin: "WB/Login",
        lob: "LOB",
        shift: "Turno",
        workStartTime: "Horário de entrada",
        workEndTime: "Horário de saída",
        roleTitle: "Cargo/Função",
        employeeStatus: "Status",
        admissionDate: "Admissão",
        nestingStartDate: "Início de Nesting",
        goLiveDate: "Go Live"
      };
      const requiredKeys = Object.keys(fieldLabels) as Array<keyof typeof operational>;
      const nextErrors: Record<string, string> = {};
      requiredKeys.forEach((key) => {
        if (!String(operational[key] ?? "").trim()) nextErrors[key] = `${fieldLabels[key]} é obrigatório.`;
      });
      if (operational.workStartTime && !normalizeClockTime(operational.workStartTime)) nextErrors.workStartTime = "Horário de entrada inválido.";
      if (operational.workEndTime && !normalizeClockTime(operational.workEndTime)) nextErrors.workEndTime = "Horário de saída inválido.";
      const missing = Object.entries(nextErrors).map(([key]) => fieldLabels[key] ?? key);
      if (missing.length) {
        setReviewFieldErrors(nextErrors);
        setMessageTone("error");
        setMessage(`Preencha os dados operacionais obrigatórios antes de aprovar: ${missing.join(", ")}.`);
        return;
      }
      setOperational((current) => ({
        ...current,
        workStartTime: normalizeClockTime(current.workStartTime),
        workEndTime: normalizeClockTime(current.workEndTime)
      }));
    }

    setReviewingAction(action);
    setMessage("");
    try {
      const payload = await apiJson<{ data: RegistrationItem }>("/api/employee-registrations/status", {
        method: "PATCH",
        body: JSON.stringify({
          id: selected.id,
          action,
          reviewNotes,
          operationalData: action === "approve" ? operational : undefined
        })
      });
      setItems((current) => current.map((item) => (item.id === payload.data.id ? payload.data : item)));
      setSelected(payload.data);
      setMessageTone("success");
      setMessage(action === "approve" ? "Cadastro aprovado, usuário liberado e Mapa de Parceiros atualizado." : action === "reject" ? "Cadastro recusado com justificativa registrada." : "Ajuste solicitado ao parceiro.");
    } catch (err) {
      setMessageTone("error");
      if (err instanceof ApiRequestError) setReviewFieldErrors(err.fields ?? {});
      setMessage(err instanceof ApiRequestError ? err.message : err instanceof Error ? err.message : "Não foi possível revisar o cadastro.");
    } finally {
      setReviewingAction(null);
    }
  }

  async function deleteRegistration() {
    if (!selected || deletingRegistration) return;
    const confirmed = window.confirm("Tem certeza que deseja excluir este cadastro? Esta ação não deve ser usada para parceiros ativos.");
    if (!confirmed) return;

    setDeletingRegistration(true);
    setMessage("");
    try {
      const payload = await apiJson<{ message: string }>("/api/employee-registrations", {
        method: "DELETE",
        body: JSON.stringify({ id: selected.id })
      });
      setMessageTone("success");
      setMessage(payload.message ?? "Cadastro removido.");
      const nextItems = items.filter((item) => item.id !== selected.id);
      setItems(nextItems);
      setSelected(nextItems[0] ?? null);
      await refreshRegistrations();
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof ApiRequestError ? err.message : err instanceof Error ? err.message : "Não foi possível excluir o cadastro.");
    } finally {
      setDeletingRegistration(false);
    }
  }

  const counts = {
    pending: registrationSummary.pending,
    active: registrationSummary.active,
    adjust: registrationSummary.adjust,
    refused: registrationSummary.refused
  };
  const selectedReviewClosed = selected ? ["Aprovado", "Ativo", "Recusado"].includes(selected.status) : false;
  const registrationLobOptions = registrationSettings?.lobs.filter((lob) => lob.status !== "INACTIVE").map((lob) => lob.name) ?? ["ALL", "CEC", "TNS", "ADS"];
  const registrationShiftOptions = cleanShiftOptions(registrationSettings?.shifts.filter((shift) => shift.status !== "INACTIVE").map((shift) => shift.name), true);
  const registrationRoleTitleOptions = registrationSettings?.roleTitles.filter((title) => title.status !== "INACTIVE").map((title) => title.name) ?? ["Agente", "Supervisor", "WFM", "Qualidade", "RH"];
  const registrationStart = registrationPagination.total ? (registrationPagination.page - 1) * registrationPagination.limit + 1 : 0;
  const registrationEnd = Math.min(registrationPagination.page * registrationPagination.limit, registrationPagination.total);

  return (
    <div>
      <PageHeader
        title="Cadastros de Parceiros"
        description="Aprove, recuse, solicite ajustes e complemente dados operacionais antes de liberar acesso."
        icon={UserPlus}
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            <button onClick={() => { window.location.href = "/cadastro-colaborador"; }} className="premium-control h-11 px-4 text-sm font-extrabold text-navy-950">Novo cadastro manual</button>
            <button onClick={() => employeeImportInputRef.current?.click()} className="flex h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-extrabold text-white shadow-soft">
              <Upload className="h-4 w-4" />
              Importar parceiros
            </button>
            <button type="button" disabled={downloadingEmployeeTemplate} onClick={downloadEmployeeTemplate} className="premium-control flex h-11 items-center gap-2 px-4 text-sm font-extrabold text-navy-950 disabled:cursor-not-allowed disabled:opacity-60">
              <Download className="h-4 w-4" />
              {downloadingEmployeeTemplate ? "Baixando..." : "Baixar template"}
            </button>
          </div>
        }
      />
      <input ref={employeeImportInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => void handleEmployeeImportFile(event.target.files?.[0])} />
      <div className="mb-5 grid gap-4 md:grid-cols-4">
        <StatCard title="Pendentes" value={counts.pending} helper="aguardando RH/Admin/WFM" icon={Clock} tone="orange" />
        <StatCard title="Ativos" value={counts.active} helper="liberados no mapa" icon={CheckCircle2} tone="green" />
        <StatCard title="Ajustes" value={counts.adjust} helper="retorno ao parceiro" icon={RefreshCw} tone="blue" />
        <StatCard title="Recusados" value={counts.refused} helper="com justificativa" icon={XCircle} tone="red" />
      </div>
      {message ? <div className={cn("mb-5 rounded-lg border px-4 py-3 text-sm font-bold", messageTone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700")}>{message}</div> : null}
      <section className="card mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_140px_160px]">
          <input
            value={registrationFilters.search}
            onChange={(event) => setRegistrationFilters({ ...registrationFilters, search: event.target.value })}
            className="h-10 rounded-lg border border-border px-3 text-sm outline-none"
            placeholder="Buscar por nome, e-mail ou CPF"
          />
          <select
            value={registrationFilters.status}
            onChange={(event) => setRegistrationFilters({ ...registrationFilters, status: event.target.value })}
            className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none"
          >
            {["Todos", "Pendente de Aprovação", "Ajuste Solicitado", "Aprovado", "Ativo", "Recusado", "Inativo"].map((status) => <option key={status}>{status}</option>)}
          </select>
          <select
            value={registrationPagination.limit}
            onChange={(event) => {
              const limit = Number(event.target.value);
              setRegistrationPagination((current) => ({ ...current, limit, page: 1 }));
              void refreshRegistrations(1, limit);
            }}
            className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none"
          >
            {[25, 50, 100].map((limit) => <option key={limit} value={limit}>{limit}/página</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => void refreshRegistrations(1)} className="rounded-lg bg-blue-600 px-3 text-sm font-bold text-white">Filtrar</button>
            <button
              onClick={() => {
                setRegistrationFilters({ search: "", status: "Todos" });
                setRegistrationPagination((current) => ({ ...current, page: 1 }));
                void refreshRegistrations(1, registrationPagination.limit, { search: "", status: "Todos" });
              }}
              className="rounded-lg border border-border bg-white px-3 text-sm font-bold"
            >
              Limpar
            </button>
          </div>
        </div>
      </section>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
        <Panel title="Esteira de aprovação cadastral">
          {items.length ? (
            <div className="space-y-4">
              <SimpleTable
                columns={["Protocolo", "Nome", "E-mail", "Cidade/UF", "Status", "Envio"]}
                rows={items.map((item) => [
                  <button key={item.id} onClick={() => setSelected(item)} className="font-extrabold text-blue-600">{item.id}</button>,
                  <button key={`${item.id}-name`} onClick={() => setSelected(item)} className="text-left font-extrabold text-navy-950 hover:text-blue-700">{item.fullName}</button>,
                  <button key={`${item.id}-email`} onClick={() => setSelected(item)} className="text-left text-blue-700">{item.email}</button>,
                  `${item.city}/${item.stateUf}`,
                  <StatusBadge key={`${item.id}-status`} status={item.status} />,
                  item.submittedAt
                ])}
              />
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm text-muted">
                <span>Exibindo {registrationStart}-{registrationEnd} de {registrationPagination.total} registros • Página {registrationPagination.page} de {registrationPagination.totalPages}</span>
                <div className="flex flex-wrap gap-2">
                  <button disabled={registrationPagination.page <= 1} onClick={() => void refreshRegistrations(1)} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-navy-950 disabled:opacity-40">Primeira</button>
                  <button disabled={registrationPagination.page <= 1} onClick={() => void refreshRegistrations(registrationPagination.page - 1)} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-navy-950 disabled:opacity-40">Anterior</button>
                  <button disabled={registrationPagination.page >= registrationPagination.totalPages} onClick={() => void refreshRegistrations(registrationPagination.page + 1)} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-navy-950 disabled:opacity-40">Próxima</button>
                  <button disabled={registrationPagination.page >= registrationPagination.totalPages} onClick={() => void refreshRegistrations(registrationPagination.totalPages)} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-navy-950 disabled:opacity-40">Última</button>
                </div>
              </div>
            </div>
          ) : <EmptyState title="Nenhum cadastro encontrado" description="Nenhum cadastro encontrado para os filtros selecionados." />}
        </Panel>
        <Panel title="Validação e dados operacionais">
          {selected ? (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">{selected.id}</p>
                <h2 className="mt-1 text-xl font-black text-navy-950">{selected.fullName}</h2>
                <p className="text-sm text-muted">{selected.email} • {selected.primaryPhone}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <InfoLine label="CPF" value={selected.cpf} />
                <InfoLine label="CNPJ" value={selected.cnpj} />
                <InfoLine label="Nascimento" value={selected.birthDate} />
                <InfoLine label="Escolaridade" value={selected.educationLevel} />
                <InfoLine label="Senha cadastrada" value={selected.hasPassword ? "Sim" : "Não"} />
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-700">
                <LockKeyhole className="mr-2 inline h-4 w-4" />
                Dados pessoais, bancários e familiares só aparecem para perfis autorizados.
              </div>
              <div className="rounded-lg border border-border bg-slate-50 p-3">
                <p className="mb-2 text-sm font-bold text-navy-950">Dados cadastrais adicionais</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <InfoLine label="Etnia" value={selected.ethnicity || "Não informado"} />
                  <InfoLine label="Orientação sexual" value={selected.sexualOrientation || "Não informado"} />
                  <InfoLine label="PCD" value={selected.isPcd || "Não informado"} />
                  {selected.isPcd === "Sim" ? <InfoLine label="Tipo de deficiência" value={selected.pcdDisabilityType || "Não informado"} /> : null}
                  {selected.isPcd === "Sim" && selected.pcdDisabilityType === "Outra" ? <InfoLine label="Especificação da deficiência" value={selected.pcdDisabilityOther || "Não informado"} /> : null}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {[
	                  ["WB/Login", "wbLogin"],
	                  ["LOB", "lob"],
	                  ["Supervisor", "supervisor"],
	                  ["Turno", "shift"],
	                  ["Horário de entrada", "workStartTime"],
	                  ["Horário de saída", "workEndTime"],
	                  ["Skill", "skill"],
	                  ["Wave", "wave"],
	                  ["Cargo/Função", "roleTitle"],
                  ["Status", "employeeStatus"],
                  ["Contrato", "contractType"],
                  ["Admissão", "admissionDate"],
                  ["Início de Nesting", "nestingStartDate"],
                  ["Go Live", "goLiveDate"]
                ].map(([label, key]) => (
                  <label key={key} className="block">
                    <span className="mb-1 block text-xs font-bold text-muted">{label}</span>
                    {key === "lob" || key === "shift" || key === "roleTitle" || key === "employeeStatus" ? (
                      <select value={operational[key as keyof typeof operational]} onChange={(event) => setOperational({ ...operational, [key]: event.target.value })} className={cn("h-10 w-full rounded-lg border px-3 text-sm outline-none", reviewFieldErrors[key] || reviewFieldErrors[`operationalData.${key}`] ? "border-red-300 bg-red-50/40" : "border-border")}>
                        {(key === "lob" ? registrationLobOptions : key === "shift" ? registrationShiftOptions : key === "roleTitle" ? registrationRoleTitleOptions : employeeOperationalStatusOptions).map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    ) : (
                      <input value={operational[key as keyof typeof operational]} onChange={(event) => setOperational({ ...operational, [key]: event.target.value })} className={cn("h-10 w-full rounded-lg border px-3 text-sm outline-none", reviewFieldErrors[key] || reviewFieldErrors[`operationalData.${key}`] ? "border-red-300 bg-red-50/40" : "border-border")} placeholder={key === "workStartTime" || key === "workEndTime" ? "HH:mm" : undefined} />
                    )}
                    {reviewFieldErrors[key] || reviewFieldErrors[`operationalData.${key}`] ? <span className="mt-1 block text-xs font-bold text-red-600">{reviewFieldErrors[key] ?? reviewFieldErrors[`operationalData.${key}`]}</span> : null}
                  </label>
                ))}
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-muted">Justificativa / observações de revisão</span>
                <textarea value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} className="min-h-24 w-full rounded-lg border border-border p-3 text-sm outline-none" />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button disabled={!!reviewingAction || selectedReviewClosed || selected.hasPassword === false} onClick={() => review("approve")} className="rounded-lg bg-emerald-600 px-3 py-3 text-sm font-bold text-white disabled:opacity-50">{reviewingAction === "approve" ? "Aprovando..." : "Aprovar"}</button>
                <button disabled={!!reviewingAction || selectedReviewClosed} onClick={() => review("request_adjustment")} className="rounded-lg bg-amber-500 px-3 py-3 text-sm font-bold text-white disabled:opacity-50">{reviewingAction === "request_adjustment" ? "Enviando..." : "Solicitar ajuste"}</button>
                <button disabled={!!reviewingAction || selectedReviewClosed} onClick={() => review("reject")} className="rounded-lg bg-red-600 px-3 py-3 text-sm font-bold text-white disabled:opacity-50">{reviewingAction === "reject" ? "Recusando..." : "Recusar"}</button>
              </div>
              <button disabled={deletingRegistration} onClick={deleteRegistration} className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm font-bold text-red-700 disabled:opacity-50">
                {deletingRegistration ? "Removendo..." : selected.status === "Aprovado" || selected.status === "Ativo" ? "Inativar cadastro" : "Excluir cadastro"}
              </button>
              <div className="rounded-lg border border-border bg-slate-50 p-3">
                <p className="mb-2 text-sm font-bold text-navy-950">Histórico</p>
                {(selected.history ?? []).slice(0, 4).map((event) => (
                  <p key={`${event.at}-${event.action}`} className="text-xs text-muted">{event.at} • {event.actor}: {event.action}{event.notes ? ` (${event.notes})` : ""}</p>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState title="Nenhum cadastro selecionado" description="Quando um parceiro enviar cadastro, a análise aparecerá aqui." />
          )}
        </Panel>
      </div>
      {showEmployeeImport ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden">
            <div className="shrink-0 border-b border-border px-5 py-4">
              <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Importar parceiros</h2>
                <p className="text-sm text-muted">{employeeImportFileName || "Arquivo Excel"} • preview antes de salvar</p>
              </div>
              <button onClick={() => setShowEmployeeImport(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {importingEmployees && !employeeImportPreview ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">
                  Validando arquivo... Aguarde enquanto leio a planilha e confiro as linhas.
                </div>
                <EmptyState title="Processando importação" description="O preview aparecerá aqui assim que a validação terminar." />
              </div>
            ) : employeeImportError && !employeeImportPreview ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                  {employeeImportError}
                </div>
                <EmptyState title="Não foi possível validar o arquivo" description="Revise a aba parceiros e os cabeçalhos mínimos, depois selecione o arquivo novamente." />
              </div>
            ) : employeeImportPreview ? (
              <div className="space-y-5">
                <div className="grid gap-3 md:grid-cols-4">
                  <MetricPill value={employeeImportPreview.totalRows} label="Total de linhas" />
                  <MetricPill value={employeeImportPreview.validRows} label="Linhas válidas" />
                  <MetricPill value={employeeImportPreview.errorRows} label="Linhas com erro" />
                  <MetricPill value={employeeImportPreview.warningRows ?? employeeImportPreview.rows.filter((row) => !row.errors.length && row.warnings.length).length} label="Linhas com alerta" />
                  <MetricPill value={employeeImportPreview.usuariosCriar ?? employeeImportPreview.rows.filter((row) => !row.errors.length && row.preview.createUser).length} label="Usuários a criar" />
                  <MetricPill value={employeeImportPreview.colaboradoresCriar ?? employeeImportPreview.rows.filter((row) => !row.errors.length && row.action === "criar").length} label="Parceiros a criar" />
                  <MetricPill value={employeeImportPreview.registrosAtualizar ?? employeeImportPreview.rows.filter((row) => !row.errors.length && row.action === "atualizar").length} label="Atualizações" />
                  <MetricPill value={employeeImportPreview.duplicidades ?? employeeImportPreview.rows.filter((row) => [...row.errors, ...row.warnings].some((message) => /duplic|existente|uso/i.test(message))).length} label="Duplicidades" />
                </div>
                <ImportIssueSummary rows={employeeImportPreview.rows} title="Corrija estas linhas do arquivo de parceiros" />
                {employeeImportPreview.errorRows ? (
                  <label className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-700">
                    <input type="checkbox" checked={allowPartialEmployeeImport} onChange={(event) => setAllowPartialEmployeeImport(event.target.checked)} />
                  Importar somente linhas válidas e ignorar linhas com erro
                </label>
              ) : null}
                <div className="max-h-[52vh] overflow-y-auto pr-1">
                  <SimpleTable
                    columns={["Linha", "Nome", "WB/Login", "E-mail", "Status", "Ação", "Atualiza", "Mantém", "Status atual", "Novo status", "Usuário inativado", "Desligamento", "CPF", "Role", "LOB", "Supervisor", "Entrada", "Saída", "Skill", "Wave", "PCD", "Tipo deficiência", "Usuário", "Validação"]}
                    rows={employeeImportPreview.rows.slice(0, IMPORT_PREVIEW_ROW_LIMIT).map((row) => [
                      row.rowNumber,
                      row.preview.name || "-",
                      row.preview.wbLogin || "-",
                      row.preview.email || "-",
                      <StatusBadge key={`${row.rowNumber}-status`} status={row.status ?? (row.errors.length ? "Erro" : row.warnings.length ? "Alerta" : "Válida")} />,
                      row.action === "inativar_acesso" ? "Inativar acesso e atualizar status" : row.action ?? (row.errors.length ? "ignorar" : "criar"),
                      row.changes?.length ? <div key={`${row.rowNumber}-changes`} className="max-w-48 space-y-1 text-xs font-semibold text-blue-700">{row.changes.slice(0, 3).map((change) => <p key={change}>{change}</p>)}{row.changes.length > 3 ? <p>+{row.changes.length - 3} campos</p> : null}</div> : "-",
                      row.keptFields?.length ? <div key={`${row.rowNumber}-kept`} className="max-w-44 text-xs font-semibold text-slate-500">{row.keptFields.slice(0, 5).join(", ")}{row.keptFields.length > 5 ? "..." : ""}</div> : "-",
                      row.preview.currentStatus || "-",
                      row.preview.newStatus || "-",
                      row.preview.userWillBeInactivated ? "Sim" : "Não",
                      row.preview.terminationDate || "-",
                      row.preview.cpf || "CPF pendente",
                      row.preview.role || "-",
                      row.preview.lob || "-",
                      row.preview.supervisor || "Sem supervisor",
                      row.preview.workStartTime || "-",
                      row.preview.workEndTime || "-",
                      row.preview.skill || "-",
                      row.preview.wave || "-",
                      row.preview.isPcd || "-",
                      row.preview.isPcd === "Sim" ? [row.preview.pcdDisabilityType || "-", row.preview.pcdDisabilityType === "Outra" && row.preview.pcdDisabilityOther ? `(${row.preview.pcdDisabilityOther})` : ""].filter(Boolean).join(" ") : "-",
                      row.preview.createUser ? (row.preview.passwordProvided ? "Sim" : "Senha ausente") : "Não",
                      row.errors.length ? (
                        <div key={`${row.rowNumber}-errors`} className="space-y-1 text-xs font-bold text-red-600">
                          {row.errors.map((error) => <p key={error}>{error}</p>)}
                        </div>
                      ) : row.warnings.length ? (
                        <div key={`${row.rowNumber}-warnings`} className="space-y-1 text-xs font-bold text-amber-600">
                          {row.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                        </div>
                      ) : <StatusBadge key={`${row.rowNumber}-ok`} status="Válida" />
                    ])}
                  />
                </div>
                {employeeImportPreview.rows.length > IMPORT_PREVIEW_ROW_LIMIT ? (
                  <p className="text-xs font-semibold text-muted">Exibindo as primeiras {IMPORT_PREVIEW_ROW_LIMIT} linhas do preview. O arquivo completo será processado na confirmação.</p>
                ) : null}
                <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
                  Campos vazios no arquivo não sobrescrevem dados existentes. Eles aparecem como mantidos no preview. CPF vazio é permitido e aparece como CPF pendente. Quando `criar_usuario = sim`, a coluna `senha_temporaria` é obrigatória e será salva apenas como hash. O Admin deve comunicar a senha manualmente.
                </div>
                <div className="sticky bottom-0 z-10 -mx-5 -mb-5 flex flex-wrap justify-end gap-3 border-t border-border bg-white/95 px-5 py-3 backdrop-blur">
                  <button onClick={() => setShowEmployeeImport(false)} className="rounded-lg border border-border px-4 py-3 text-sm font-bold">Cancelar</button>
                  <button
                    disabled={importingEmployees || (!allowPartialEmployeeImport && employeeImportPreview.errorRows > 0)}
                    onClick={confirmEmployeeImport}
                    className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {importingEmployees ? "Importando..." : "Confirmar importação"}
                  </button>
                </div>
              </div>
            ) : <EmptyState title="Nenhum preview disponível" description="Selecione um arquivo de parceiros para validar antes da importação." />}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
