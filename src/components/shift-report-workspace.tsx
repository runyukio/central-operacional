"use client";

import {
  AlertTriangle,
  ClipboardCheck,
  Download,
  Eye,
  FileText,
  Frown,
  Loader2,
  Meh,
  Plus,
  RefreshCw,
  Search,
  Send,
  Smile,
  Trash2,
  UserCheck,
  Users,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader, Panel, StatCard, StatusBadge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type PersonOption = { id: string; name: string; wbLogin: string; role: string; roleLabel: string };
type ShiftOption = { id: string; name: string; startsAt: string; endsAt: string };
type WorkspaceOptions = {
  permissions: { canSubmit: boolean; canViewPanel: boolean };
  currentEmployeeId: string | null;
  lobs: Array<{ id: string; name: string }>;
  shifts: ShiftOption[];
  responsibles: PersonOption[];
  leaders: PersonOption[];
};
type ReportItem = {
  id: string;
  reportDate: string;
  reportDateIso: string;
  submittedAt: string;
  submittedBy: string;
  shift: string;
  lob: string;
  responsibleId: string;
  responsible: string;
  importance: string;
  onlineAgents: number;
  absCount: number;
  absences: Array<{ id: string; wbLogin: string; employee: string; reason: string }>;
  queueStatusStart: string;
  queueStatusEnd: string;
  occurrence: string;
  pendingTasks: string;
  generalMood: string;
  leaders: Array<{ id: string; name: string; role: string }>;
  createdAt: string;
};
type Summary = { total: number; onlineAgents: number; absTotal: number; attention: number; critical: number };
type ReportPayload = { data: ReportItem[]; summary: Summary; permissions: WorkspaceOptions["permissions"] };
type FormState = {
  reportDate: string;
  shiftId: string;
  lobId: string;
  responsibleId: string;
  importance: "REPORT" | "ATTENTION" | "CRITICAL";
  onlineAgents: string;
  absences: Array<{ wbLogin: string; reason: string }>;
  queueStatusStart: "ON_TARGET" | "OVER_TARGET";
  queueStatusEnd: "ON_TARGET" | "OVER_TARGET";
  occurrence: string;
  pendingTasks: string;
  generalMood: "HAPPY" | "NEUTRAL" | "SAD";
  leaderIds: string[];
};
type Filters = {
  startDate: string;
  endDate: string;
  shift: string;
  lob: string;
  responsible: string;
  importance: string;
  mood: string;
  search: string;
};

const emptySummary: Summary = { total: 0, onlineAgents: 0, absTotal: 0, attention: 0, critical: 0 };

function saoPauloDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function initialForm(): FormState {
  return {
    reportDate: saoPauloDate(),
    shiftId: "",
    lobId: "",
    responsibleId: "",
    importance: "REPORT",
    onlineAgents: "",
    absences: [],
    queueStatusStart: "ON_TARGET",
    queueStatusEnd: "ON_TARGET",
    occurrence: "",
    pendingTasks: "",
    generalMood: "NEUTRAL",
    leaderIds: []
  };
}

const initialFilters: Filters = {
  startDate: "",
  endDate: "",
  shift: "Todos",
  lob: "Todos",
  responsible: "Todos",
  importance: "Todos",
  mood: "Todos",
  search: ""
};

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const issue = payload?.issues?.fieldErrors
      ? Object.values(payload.issues.fieldErrors).flat().filter(Boolean)[0]
      : null;
    throw new Error(String(issue || payload.error || "Não foi possível concluir a operação."));
  }
  return payload as T;
}

function queryString(filters: Filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value && value !== "Todos") params.set(key, value);
  });
  return params.toString();
}

export function ShiftReportWorkspace() {
  const [options, setOptions] = useState<WorkspaceOptions | null>(null);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [form, setForm] = useState<FormState>(initialForm);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(initialFilters);
  const [activeView, setActiveView] = useState<"submit" | "monitor">("submit");
  const [selected, setSelected] = useState<ReportItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const loadReports = useCallback(async (nextFilters: Filters) => {
    const payload = await jsonRequest<ReportPayload>(`/api/shift-reports?${queryString(nextFilters)}`);
    setReports(payload.data);
    setSummary(payload.summary);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const nextOptions = await jsonRequest<WorkspaceOptions>("/api/shift-reports/options");
      setOptions(nextOptions);
      setActiveView(nextOptions.permissions.canSubmit ? "submit" : "monitor");
      setForm((current) => ({
        ...current,
        shiftId: current.shiftId || nextOptions.shifts[0]?.id || "",
        lobId: current.lobId || nextOptions.lobs[0]?.id || "",
        responsibleId: current.responsibleId || (nextOptions.responsibles.some((person) => person.id === nextOptions.currentEmployeeId)
          ? nextOptions.currentEmployeeId || ""
          : nextOptions.responsibles[0]?.id || "")
      }));
      await loadReports(appliedFilters);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Não foi possível carregar o Report de Turno." });
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, loadReports]);

  useEffect(() => {
    void load();
  }, [load]);

  const formReady = Boolean(
    form.reportDate && form.shiftId && form.lobId && form.responsibleId && form.onlineAgents !== ""
    && form.absences.every((absence) => absence.wbLogin.trim() && absence.reason.trim())
  );

  async function submitReport() {
    if (!formReady) {
      setMessage({ tone: "error", text: "Preencha os campos obrigatórios e complete todas as ausências." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const result = await jsonRequest<{ message: string }>("/api/shift-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, onlineAgents: Number(form.onlineAgents) })
      });
      setMessage({ tone: "success", text: result.message });
      setForm((current) => ({
        ...initialForm(),
        reportDate: current.reportDate,
        shiftId: current.shiftId,
        lobId: current.lobId,
        responsibleId: current.responsibleId
      }));
      await loadReports(appliedFilters);
      setActiveView("monitor");
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Não foi possível enviar o report." });
    } finally {
      setSaving(false);
    }
  }

  async function deleteReport(id: string) {
    if (!window.confirm("Excluir este report de turno? Esta ação ficará registrada na auditoria.")) return;
    setDeletingId(id);
    try {
      const result = await jsonRequest<{ message: string }>(`/api/shift-reports?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setMessage({ tone: "success", text: result.message });
      if (selected?.id === id) setSelected(null);
      await loadReports(appliedFilters);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Não foi possível excluir o report." });
    } finally {
      setDeletingId(null);
    }
  }

  function applyFilters() {
    setAppliedFilters(filters);
    setLoading(true);
    loadReports(filters)
      .catch((error) => setMessage({ tone: "error", text: error instanceof Error ? error.message : "Não foi possível filtrar." }))
      .finally(() => setLoading(false));
  }

  function clearFilters() {
    setFilters(initialFilters);
    setAppliedFilters(initialFilters);
    setLoading(true);
    loadReports(initialFilters)
      .catch((error) => setMessage({ tone: "error", text: error instanceof Error ? error.message : "Não foi possível limpar os filtros." }))
      .finally(() => setLoading(false));
  }

  if (loading && !options) {
    return <div className="grid min-h-[320px] place-items-center"><Loader2 className="h-7 w-7 animate-spin text-blue-600" /></div>;
  }

  return (
    <div className="pb-8">
      <PageHeader
        title="Report de Turno"
        description="Registro operacional da passagem de turno e acompanhamento gerencial."
        icon={ClipboardCheck}
        actions={(
          <button type="button" onClick={() => void load()} className="premium-control inline-flex h-9 items-center gap-2 px-3 text-sm font-extrabold text-navy-950">
            <RefreshCw className="h-4 w-4" /> Atualizar
          </button>
        )}
      />

      {message ? (
        <div className={cn("mb-3 rounded-lg border px-3 py-2 text-sm font-bold", message.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700")}>{message.text}</div>
      ) : null}

      {options?.permissions.canSubmit ? (
        <div className="mb-4 inline-flex rounded-lg border border-border bg-slate-100 p-1">
          <button type="button" onClick={() => setActiveView("submit")} className={cn("h-9 rounded-md px-4 text-sm font-extrabold", activeView === "submit" ? "bg-white text-blue-700 shadow-soft" : "text-muted")}>Enviar report</button>
          <button type="button" onClick={() => setActiveView("monitor")} className={cn("h-9 rounded-md px-4 text-sm font-extrabold", activeView === "monitor" ? "bg-white text-blue-700 shadow-soft" : "text-muted")}>{options.permissions.canViewPanel ? "Acompanhar" : "Meus reports"}</button>
        </div>
      ) : null}

      {activeView === "submit" && options?.permissions.canSubmit ? (
        <SubmitWorkspace form={form} setForm={setForm} options={options} saving={saving} formReady={formReady} onSubmit={submitReport} />
      ) : (
        <MonitorWorkspace
          reports={reports}
          summary={summary}
          filters={filters}
          setFilters={setFilters}
          options={options}
          loading={loading}
          deletingId={deletingId}
          exportHref={`/api/shift-reports/export?${queryString(appliedFilters)}`}
          onApply={applyFilters}
          onClear={clearFilters}
          onSelect={setSelected}
          onDelete={deleteReport}
        />
      )}

      {selected ? <ReportDetail report={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function SubmitWorkspace({
  form,
  setForm,
  options,
  saving,
  formReady,
  onSubmit
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  options: WorkspaceOptions;
  saving: boolean;
  formReady: boolean;
  onSubmit: () => void;
}) {
  function field<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  function updateAbsence(index: number, key: "wbLogin" | "reason", value: string) {
    field("absences", form.absences.map((absence, currentIndex) => currentIndex === index ? { ...absence, [key]: value } : absence));
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,.55fr)]">
      <Panel title="Dados do turno">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Field label="LOB">
            <select value={form.lobId} onChange={(event) => field("lobId", event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold">
              {options.lobs.map((lob) => <option key={lob.id} value={lob.id}>{lob.name}</option>)}
            </select>
          </Field>
          <Field label="Data do turno">
            <input type="date" value={form.reportDate} onChange={(event) => field("reportDate", event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold" />
          </Field>
          <Field label="Turno">
            <select value={form.shiftId} onChange={(event) => field("shiftId", event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold">
              {options.shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name}</option>)}
            </select>
          </Field>
          <Field label="Importância">
            <select value={form.importance} onChange={(event) => field("importance", event.target.value as FormState["importance"])} className="premium-control h-10 w-full px-3 text-sm font-bold">
              <option value="REPORT">Report</option><option value="ATTENTION">Atenção</option><option value="CRITICAL">Crítico</option>
            </select>
          </Field>
          <Field label="Responsável">
            <select value={form.responsibleId} onChange={(event) => field("responsibleId", event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold">
              {options.responsibles.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}
            </select>
          </Field>
          <Field label="Agentes online">
            <input min={0} type="number" inputMode="numeric" value={form.onlineAgents} onChange={(event) => field("onlineAgents", event.target.value)} className="premium-control h-10 w-full px-3 text-sm font-bold" placeholder="0" />
          </Field>
          <Field label="Filas no início do turno">
            <select value={form.queueStatusStart} onChange={(event) => field("queueStatusStart", event.target.value as FormState["queueStatusStart"])} className="premium-control h-10 w-full px-3 text-sm font-bold">
              <option value="ON_TARGET">Latência no target</option><option value="OVER_TARGET">Latência estourada</option>
            </select>
          </Field>
          <Field label="Filas no final do turno">
            <select value={form.queueStatusEnd} onChange={(event) => field("queueStatusEnd", event.target.value as FormState["queueStatusEnd"])} className="premium-control h-10 w-full px-3 text-sm font-bold">
              <option value="ON_TARGET">Latência no target</option><option value="OVER_TARGET">Latência estourada</option>
            </select>
          </Field>
          <Field label="Humor geral do turno">
            <MoodSelector value={form.generalMood} onChange={(value) => field("generalMood", value)} />
          </Field>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <Field label="Ocorrência (opcional)">
            <textarea rows={4} value={form.occurrence} onChange={(event) => field("occurrence", event.target.value)} className="premium-control w-full px-3 py-2 text-sm font-semibold" placeholder="Registre fatos relevantes do turno." />
          </Field>
          <Field label="Tarefas pendentes (opcional)">
            <textarea rows={4} value={form.pendingTasks} onChange={(event) => field("pendingTasks", event.target.value)} className="premium-control w-full px-3 py-2 text-sm font-semibold" placeholder="O que precisa ser continuado pelo próximo turno?" />
          </Field>
        </div>
      </Panel>

      <div className="space-y-4">
        <Panel title="Líderes presentes no turno">
          <div className="max-h-[225px] space-y-1.5 overflow-y-auto pr-1">
            {options.leaders.length ? options.leaders.map((leader) => {
              const checked = form.leaderIds.includes(leader.id);
              return (
                <label key={leader.id} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2", checked ? "border-blue-200 bg-blue-50" : "border-border bg-white hover:bg-slate-50")}>
                  <input type="checkbox" checked={checked} onChange={() => field("leaderIds", checked ? form.leaderIds.filter((id) => id !== leader.id) : [...form.leaderIds, leader.id])} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-navy-950">{leader.name}</span><span className="block text-[11px] font-semibold text-muted">{leader.role}</span></span>
                </label>
              );
            }) : <p className="text-sm font-semibold text-muted">Nenhum líder ativo disponível.</p>}
          </div>
        </Panel>
        <div className="rounded-lg border border-blue-100 bg-blue-50/70 p-3 text-xs font-semibold leading-relaxed text-blue-800">
          O report registra a passagem do turno. WBs informados em ABS são validados no cadastro antes do envio.
        </div>
      </div>

      <div className="xl:col-span-2">
        <Panel title="ABS do turno">
          <div className="space-y-2">
            {form.absences.map((absence, index) => (
              <div key={index} className="grid gap-2 rounded-lg border border-border bg-slate-50/55 p-2 md:grid-cols-[minmax(180px,.35fr)_minmax(260px,1fr)_40px]">
                <input value={absence.wbLogin} onChange={(event) => updateAbsence(index, "wbLogin", event.target.value)} className="premium-control h-10 px-3 text-sm font-bold" placeholder="WB/Login válido" />
                <input value={absence.reason} onChange={(event) => updateAbsence(index, "reason", event.target.value)} className="premium-control h-10 px-3 text-sm font-bold" placeholder="Motivo/observação da falta" />
                <button type="button" onClick={() => field("absences", form.absences.filter((_, currentIndex) => currentIndex !== index))} className="premium-control grid h-10 w-10 place-items-center text-red-600" title="Remover ausência"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <button type="button" onClick={() => field("absences", [...form.absences, { wbLogin: "", reason: "" }])} className="premium-control inline-flex h-9 items-center gap-2 px-3 text-sm font-extrabold text-blue-700"><Plus className="h-4 w-4" /> Adicionar ausência</button>
          </div>
        </Panel>
      </div>

      <div className="xl:col-span-2 flex justify-end">
        <button type="button" disabled={!formReady || saving} onClick={onSubmit} className="premium-button inline-flex h-11 min-w-[190px] items-center justify-center gap-2 px-5 text-sm font-extrabold disabled:cursor-not-allowed disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar report
        </button>
      </div>
    </div>
  );
}

function MonitorWorkspace({
  reports,
  summary,
  filters,
  setFilters,
  options,
  loading,
  deletingId,
  exportHref,
  onApply,
  onClear,
  onSelect,
  onDelete
}: {
  reports: ReportItem[];
  summary: Summary;
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  options: WorkspaceOptions | null;
  loading: boolean;
  deletingId: string | null;
  exportHref: string;
  onApply: () => void;
  onClear: () => void;
  onSelect: (report: ReportItem) => void;
  onDelete: (id: string) => void;
}) {
  function field<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard title="Reports enviados" value={summary.total} icon={FileText} tone="blue" />
        <StatCard title="Agentes online" value={summary.onlineAgents} icon={Users} tone="green" />
        <StatCard title="ABS registrados" value={summary.absTotal} icon={UserCheck} tone="orange" />
        <StatCard title="Em atenção" value={summary.attention} icon={AlertTriangle} tone="gold" />
        <StatCard title="Críticos" value={summary.critical} icon={AlertTriangle} tone="red" />
      </div>

      <Panel title={options?.permissions.canViewPanel ? "Filtros de acompanhamento" : "Meus reports"}>
        {!options?.permissions.canViewPanel ? <p className="mb-3 text-sm font-semibold text-muted">Acompanhe os reports que você registrou e consulte todos os detalhes de cada envio.</p> : null}
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
          <Field label="Data inicial"><input type="date" value={filters.startDate} onChange={(event) => field("startDate", event.target.value)} className="premium-control h-10 w-full px-2 text-sm font-bold" /></Field>
          <Field label="Data final"><input type="date" value={filters.endDate} onChange={(event) => field("endDate", event.target.value)} className="premium-control h-10 w-full px-2 text-sm font-bold" /></Field>
          <Field label="LOB"><FilterSelect value={filters.lob} onChange={(value) => field("lob", value)} options={options?.lobs.map((item) => ({ value: item.id, label: item.name })) ?? []} /></Field>
          <Field label="Turno"><FilterSelect value={filters.shift} onChange={(value) => field("shift", value)} options={options?.shifts.map((item) => ({ value: item.id, label: item.name })) ?? []} /></Field>
          <Field label="Responsável"><FilterSelect value={filters.responsible} onChange={(value) => field("responsible", value)} options={options?.responsibles.map((item) => ({ value: item.id, label: item.name })) ?? []} /></Field>
          <Field label="Importância"><FilterSelect value={filters.importance} onChange={(value) => field("importance", value)} options={[{ value: "REPORT", label: "Report" }, { value: "ATTENTION", label: "Atenção" }, { value: "CRITICAL", label: "Crítico" }]} /></Field>
          <Field label="Humor"><FilterSelect value={filters.mood} onChange={(value) => field("mood", value)} options={[{ value: "HAPPY", label: "Feliz" }, { value: "NEUTRAL", label: "Normal" }, { value: "SAD", label: "Triste" }]} /></Field>
          <Field label="Busca"><div className="premium-control flex h-10 items-center gap-2 px-2"><Search className="h-4 w-4 text-muted" /><input value={filters.search} onChange={(event) => field("search", event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onApply(); }} className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none" placeholder="Ocorrência ou ABS" /></div></Field>
        </div>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClear} className="premium-control h-9 px-3 text-sm font-extrabold text-navy-950">Limpar</button>
          <a href={exportHref} className="premium-control inline-flex h-9 items-center gap-2 px-3 text-sm font-extrabold text-navy-950"><Download className="h-4 w-4" /> Exportar XLSX</a>
          <button type="button" onClick={onApply} disabled={loading} className="premium-button inline-flex h-9 items-center gap-2 px-4 text-sm font-extrabold disabled:opacity-60">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Aplicar</button>
        </div>
      </Panel>

      <section className="card overflow-hidden">
        <div className="border-b border-border px-3 py-2.5"><h2 className="text-sm font-black text-navy-950">{options?.permissions.canViewPanel ? "Reports de turno" : "Meus reports enviados"}</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] border-collapse text-left text-[12.5px]">
            <thead><tr className="border-b border-border bg-slate-50 text-[10.5px] font-black uppercase tracking-wide text-muted">
              {['Data','Turno','LOB','Importância','Responsável','Online','ABS','Filas início','Filas final','Humor','Enviado por','Ações'].map((title) => <th key={title} className="px-3 py-2.5">{title}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-border/70">
              {reports.map((report) => (
                <tr key={report.id} className="hover:bg-blue-50/35">
                  <td className="px-3 py-2.5 font-bold text-navy-950">{report.reportDate}</td><td className="px-3 py-2.5">{report.shift}</td><td className="px-3 py-2.5 font-bold">{report.lob}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={report.importance} /></td><td className="px-3 py-2.5">{report.responsible}</td><td className="px-3 py-2.5 font-black">{report.onlineAgents}</td><td className="px-3 py-2.5 font-black">{report.absCount}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={report.queueStatusStart} /></td><td className="px-3 py-2.5"><StatusBadge status={report.queueStatusEnd} /></td><td className="px-3 py-2.5">{report.generalMood}</td><td className="px-3 py-2.5">{report.submittedBy}</td>
                  <td className="px-3 py-2.5"><div className="flex gap-1.5"><button type="button" onClick={() => onSelect(report)} className="premium-control grid h-8 w-8 place-items-center text-blue-700" title="Ver detalhe"><Eye className="h-4 w-4" /></button>{options?.permissions.canSubmit ? <button type="button" onClick={() => onDelete(report.id)} disabled={deletingId === report.id} className="premium-control grid h-8 w-8 place-items-center text-red-600" title="Excluir report">{deletingId === report.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button> : null}</div></td>
                </tr>
              ))}
              {!reports.length ? <tr><td colSpan={12} className="px-4 py-12 text-center text-sm font-semibold text-muted">Nenhum report encontrado para os filtros selecionados.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ReportDetail({ report, onClose }: { report: ReportItem; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-navy-950/45 p-3 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-border bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-white/95 px-4 py-3 backdrop-blur">
          <div><p className="text-[10px] font-black uppercase tracking-[.18em] text-blue-600">Report de turno</p><h2 className="mt-1 text-xl font-black text-navy-950">{report.lob} · {report.shift} · {report.reportDate}</h2><p className="mt-1 text-xs font-semibold text-muted">Responsável: {report.responsible} · enviado por {report.submittedBy}</p></div>
          <button type="button" onClick={onClose} className="premium-control grid h-9 w-9 shrink-0 place-items-center text-navy-950"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <DetailMetric label="Importância" value={report.importance} /><DetailMetric label="Agentes online" value={String(report.onlineAgents)} /><DetailMetric label="ABS" value={String(report.absCount)} /><DetailMetric label="Humor" value={report.generalMood} />
            <DetailMetric label="Filas no início" value={report.queueStatusStart} /><DetailMetric label="Filas no final" value={report.queueStatusEnd} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="ABS e observações">{report.absences.length ? <div className="space-y-2">{report.absences.map((absence) => <div key={absence.id} className="rounded-lg border border-border bg-slate-50 p-2.5"><p className="text-sm font-black text-navy-950">{absence.employee} <span className="text-blue-600">· {absence.wbLogin}</span></p><p className="mt-1 text-xs font-semibold text-muted">{absence.reason}</p></div>)}</div> : <p className="text-sm font-semibold text-muted">Nenhuma ausência registrada.</p>}</Panel>
            <Panel title="Líderes presentes">{report.leaders.length ? <div className="space-y-2">{report.leaders.map((leader) => <div key={leader.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2"><span className="text-sm font-bold text-navy-950">{leader.name}</span><StatusBadge status={leader.role || "Liderança"} /></div>)}</div> : <p className="text-sm font-semibold text-muted">Nenhum líder informado.</p>}</Panel>
          </div>
          <div className="space-y-4">
            <ReportNarrative label="Ocorrência" value={report.occurrence} emptyValue="Sem ocorrência registrada." />
            <ReportNarrative label="Tarefas pendentes" value={report.pendingTasks} emptyValue="Sem pendências registradas." />
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block min-w-0"><span className="mb-1.5 block text-[10.5px] font-black uppercase tracking-wide text-muted">{label}</span>{children}</label>;
}

function FilterSelect({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} className="premium-control h-10 w-full px-2 text-sm font-bold"><option value="Todos">Todos</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
}

function MoodSelector({ value, onChange }: { value: FormState["generalMood"]; onChange: (value: FormState["generalMood"]) => void }) {
  const choices = useMemo(() => [
    { value: "HAPPY" as const, label: "Feliz", icon: Smile, style: "text-emerald-600" },
    { value: "NEUTRAL" as const, label: "Normal", icon: Meh, style: "text-blue-600" },
    { value: "SAD" as const, label: "Triste", icon: Frown, style: "text-red-600" }
  ], []);
  return <div className="grid grid-cols-3 gap-1.5">{choices.map((choice) => { const Icon = choice.icon; return <button key={choice.value} type="button" onClick={() => onChange(choice.value)} className={cn("flex h-10 items-center justify-center gap-1.5 rounded-lg border text-xs font-extrabold", value === choice.value ? "border-blue-300 bg-blue-50 shadow-soft" : "border-border bg-white hover:bg-slate-50", choice.style)}><Icon className="h-4 w-4" />{choice.label}</button>; })}</div>;
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-lg border border-border bg-slate-50/70 p-3"><p className="text-[10px] font-black uppercase tracking-wide text-muted">{label}</p><p className="mt-1 break-words text-sm font-extrabold text-navy-950">{value}</p></div>;
}

function ReportNarrative({ label, value, emptyValue }: { label: string; value: string; emptyValue: string }) {
  return (
    <section className="rounded-xl border border-border bg-slate-50/70 p-4">
      <h3 className="text-[10px] font-black uppercase tracking-[.12em] text-muted">{label}</h3>
      <p className={cn("mt-2 whitespace-pre-wrap break-words text-sm font-semibold leading-6", value ? "text-navy-950" : "text-muted")}>{value || emptyValue}</p>
    </section>
  );
}
