"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronRight, Clock, ClipboardList, Download, Headphones, RefreshCw, ShieldCheck, Target, Upload, UserCheck, UsersRound, XCircle } from "lucide-react";
import { TopActions } from "@/components/layout/app-shell";
import { EmptyState, MetricPill, PageHeader, Panel, StatCard, StatusBadge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { FormInput, IMPORT_PREVIEW_ROW_LIMIT, ImportIssueSummary, apiJson, coverageTerminology, currentOperationalDateInput, dateInputFromUtc, downloadFile, parseDateInput } from './shared';
export function StaffCoveragePage() {
  const initialRange = currentStaffCoverageWeekRange();
  const staffInitialRange = currentMonthRemainingRange();
  const [view, setView] = useState<"AGENTS" | "STAFF">("AGENTS");
  const [payload, setPayload] = useState<StaffCoverageResponse | null>(null);
  const [staffPayload, setStaffPayload] = useState<RequiredStaffCoverageResponse | null>(null);
  const [filters, setFilters] = useState({
    startDate: initialRange.startDate,
    endDate: initialRange.endDate,
    lob: "Todos",
    shift: "Todos",
    supervisor: "Todos",
    staffCoverage: "Todos",
    skill: "Todas",
    roleTitle: "Agente"
  });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [staffLoading, setStaffLoading] = useState(false);
  const [showRtaCoverage, setShowRtaCoverage] = useState(true);
  const [dateFilterTouched, setDateFilterTouched] = useState(false);
  const [message, setMessage] = useState("");
  const [adsUpdateSummary, setAdsUpdateSummary] = useState("");
  const [importing, setImporting] = useState(false);
  const [updatingAdsRequirement, setUpdatingAdsRequirement] = useState(false);
  const [preview, setPreview] = useState<StaffCoveragePreviewResponse | null>(null);
  const [previewFileName, setPreviewFileName] = useState("");
  const [details, setDetails] = useState<StaffCoverageDetailsResponse | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadCoverage = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      startDate: filters.startDate,
      endDate: filters.endDate,
      lob: filters.lob,
      shift: filters.shift,
      supervisor: filters.supervisor,
      skill: filters.skill,
      roleTitle: filters.roleTitle,
      page: String(page),
      limit: "50"
    });
    try {
      const data = await apiJson<StaffCoverageResponse>(`/api/staff-coverage?${params.toString()}`);
      setPayload(data);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? coverageTerminology(error.message) : "Não foi possível carregar Necessidade.");
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  const loadStaffCoverage = useCallback(async () => {
    setStaffLoading(true);
    const params = new URLSearchParams({
      startDate: filters.startDate,
      endDate: filters.endDate,
      lob: filters.lob,
      shift: filters.shift,
      supervisor: filters.supervisor,
      includeRta: showRtaCoverage ? "true" : "false",
      coverageStatus: filters.staffCoverage
    });
    try {
      const data = await apiJson<RequiredStaffCoverageResponse>(`/api/staff-coverage/staff?${params.toString()}`);
      setStaffPayload(data);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível carregar cobertura STAFF.");
    } finally {
      setStaffLoading(false);
    }
  }, [filters.endDate, filters.lob, filters.shift, filters.staffCoverage, filters.startDate, filters.supervisor, showRtaCoverage]);

  useEffect(() => {
    if (view === "AGENTS") void loadCoverage();
  }, [loadCoverage, view]);

  useEffect(() => {
    if (view === "STAFF") void loadStaffCoverage();
  }, [loadStaffCoverage, view]);

  const updateFilter = (key: keyof typeof filters, value: string) => {
    if (key === "startDate" || key === "endDate") setDateFilterTouched(true);
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const changeRequiredView = (nextView: "AGENTS" | "STAFF") => {
    setView(nextView);
    if (nextView === "STAFF" && !dateFilterTouched) {
      setFilters((current) => ({ ...current, startDate: staffInitialRange.startDate, endDate: staffInitialRange.endDate }));
      setPage(1);
    }
  };

  const previewRequirementFile = async (file?: File | null) => {
    if (!file) return;
    setImporting(true);
    setPreviewFileName(file.name);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const result = await apiJson<StaffCoveragePreviewResponse>("/api/staff-coverage/import/preview", { method: "POST", body: formData });
      setPreview(result);
      setMessage(result.summary.errorRows ? "Revise os erros do preview antes de confirmar." : "Preview gerado. Confirme para importar a necessidade.");
    } catch (error) {
      setMessage(error instanceof Error ? coverageTerminology(error.message) : "Não foi possível validar o arquivo de necessidade.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const commitRequirementImport = async () => {
    if (!preview || preview.summary.errorRows || importing) return;
    setImporting(true);
    try {
      const result = await apiJson<{ success: boolean; createdRows: number; updatedRows: number; importedRows: number }>("/api/staff-coverage/import/commit", {
        method: "POST",
        body: JSON.stringify({ rows: preview.rows, fileName: previewFileName })
      });
      setMessage(`Necessidade importada: ${result.createdRows} criada(s), ${result.updatedRows} atualizada(s).`);
      setPreview(null);
      await loadCoverage();
    } catch (error) {
      setMessage(error instanceof Error ? coverageTerminology(error.message) : "Não foi possível importar a necessidade.");
    } finally {
      setImporting(false);
    }
  };

  const exportCoverage = async () => {
    const params = new URLSearchParams(filters);
    try {
      await downloadFile(`/api/staff-coverage/export?${params.toString()}`, "necessidade.xlsx", "Não foi possível exportar Necessidade.");
    } catch (error) {
      setMessage(error instanceof Error ? coverageTerminology(error.message) : "Não foi possível exportar Necessidade.");
    }
  };

  const refreshAdsRequirement = async () => {
    if (updatingAdsRequirement) return;
    const confirmed = window.confirm(
      `Atualizar automaticamente a necessidade ADS de ${filters.startDate} pelos próximos 14 dias?\n\nOs valores atuais de ADS para Manhã, Tarde e Noite nesse período serão substituídos.`
    );
    if (!confirmed) return;

    setUpdatingAdsRequirement(true);
    setAdsUpdateSummary("");
    try {
      const result = await apiJson<{
        success: boolean;
        updatedRows: number;
        period: { startDate: string; endDate: string };
        ahtSeconds: number;
        ahtPeriod: { startDate: string; endDate: string };
      }>("/api/staff-coverage/ads/refresh", {
        method: "POST",
        body: JSON.stringify({ startDate: filters.startDate })
      });
      setDateFilterTouched(true);
      setFilters((current) => ({
        ...current,
        startDate: result.period.startDate,
        endDate: result.period.endDate,
        lob: "ADS",
        shift: "Todos",
        supervisor: "Todos",
        skill: "Todas",
        roleTitle: "Agente"
      }));
      setPage(1);
      setView("AGENTS");
      setAdsUpdateSummary(
        `Necessidade ADS atualizada: ${result.updatedRows} turno(s), AHT ${result.ahtSeconds.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}s ` +
        `(${result.ahtPeriod.startDate} a ${result.ahtPeriod.endDate}).`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível atualizar automaticamente a necessidade ADS.");
    } finally {
      setUpdatingAdsRequirement(false);
    }
  };

  const openDetails = async (row: StaffCoverageRowClient) => {
    setDetailsLoading(true);
    const params = new URLSearchParams({
      date: row.date,
      lob: row.lob,
      shift: row.shift,
      supervisor: filters.supervisor,
      skill: filters.skill,
      page: "1",
      limit: "50"
    });
    try {
      const result = await apiJson<StaffCoverageDetailsResponse>(`/api/staff-coverage/details?${params.toString()}`);
      setDetails(result);
    } catch (error) {
      setMessage(error instanceof Error ? coverageTerminology(error.message) : "Não foi possível abrir o detalhe da Necessidade.");
    } finally {
      setDetailsLoading(false);
    }
  };

  const summary = payload?.summary;
  const rows = payload?.data ?? [];
  const lobs = optionList(view === "STAFF" ? staffPayload?.filters.lobs : payload?.filters.lobs, filters.lob);
  const supervisors = optionList(view === "STAFF" ? staffPayload?.filters.staff : payload?.filters.supervisors, filters.supervisor);
  const staffCoverageStatuses = optionList(staffPayload?.filters.coverageStatuses, filters.staffCoverage);
  const skills = optionList(payload?.filters.skills, filters.skill);
  const shifts = ["Todos", "Manhã", "Tarde", "Noite"];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Necessidade"
        description="Necessidade operacional e cobertura de staff por escala."
        icon={UsersRound}
        actions={<TopActions />}
      />

      <div className="inline-flex rounded-xl border border-border bg-white p-1 shadow-sm">
        {(["AGENTS", "STAFF"] as const).map((item) => (
          <button
            key={item}
            onClick={() => changeRequiredView(item)}
            className={cn(
              "h-9 rounded-lg px-4 text-xs font-extrabold transition",
              view === item ? "bg-blue-600 text-white shadow-sm" : "text-muted hover:bg-blue-50 hover:text-blue-700"
            )}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-white p-3 shadow-sm">
        <div className={cn("grid gap-2 md:grid-cols-3", view === "AGENTS" ? "xl:grid-cols-[140px_140px_140px_140px_170px_140px_130px_1fr]" : "xl:grid-cols-[140px_140px_140px_140px_190px_170px_1fr]")}>
          <FormInput label="Data inicial" type="date" value={filters.startDate} onChange={(value) => updateFilter("startDate", value)} />
          <FormInput label="Data final" type="date" value={filters.endDate} onChange={(value) => updateFilter("endDate", value)} />
          <label className="text-xs font-bold text-muted">
            LOB
            <select value={filters.lob} onChange={(event) => updateFilter("lob", event.target.value)} className="premium-control mt-1 h-9 w-full px-3 text-sm font-bold text-navy-950">
              {lobs.map((lob) => <option key={lob} value={lob}>{lob === "Todos" ? "Todas as LOBs" : lob}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-muted">
            Turno
            <select value={filters.shift} onChange={(event) => updateFilter("shift", event.target.value)} className="premium-control mt-1 h-9 w-full px-3 text-sm font-bold text-navy-950">
              {shifts.map((shift) => <option key={shift} value={shift}>{shift === "Todos" ? "Todos os turnos" : shift}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-muted">
            {view === "STAFF" ? "Supervisor/POC/RTA" : "Supervisor"}
            <select value={filters.supervisor} onChange={(event) => updateFilter("supervisor", event.target.value)} className="premium-control mt-1 h-9 w-full px-3 text-sm font-bold text-navy-950">
              {supervisors.map((supervisor) => <option key={supervisor} value={supervisor}>{supervisor === "Todos" ? (view === "STAFF" ? "Todos os staff" : "Todos os supervisores") : supervisor}</option>)}
            </select>
          </label>
          {view === "STAFF" ? (
            <label className="text-xs font-bold text-muted">
              Cobertura
              <select value={filters.staffCoverage} onChange={(event) => updateFilter("staffCoverage", event.target.value)} className="premium-control mt-1 h-9 w-full px-3 text-sm font-bold text-navy-950">
                {staffCoverageStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status === "Todos" ? "Todas as cores" : status === "Verde" ? "Verde - com supervisor" : status === "Amarelo" ? "Amarelo - POC/RTA" : status === "Vermelho" ? "Vermelho - sem cobertura" : "Sem supervisor na LOB"}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {view === "AGENTS" ? (
            <>
              <label className="text-xs font-bold text-muted">
                Skill
                <select value={filters.skill} onChange={(event) => updateFilter("skill", event.target.value)} className="premium-control mt-1 h-9 w-full px-3 text-sm font-bold text-navy-950">
                  {skills.map((skill) => <option key={skill} value={skill}>{skill === "Todas" ? "Todas as skills" : skill}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-muted">
                Cargo/Função
                <select value={filters.roleTitle} onChange={(event) => updateFilter("roleTitle", event.target.value)} className="premium-control mt-1 h-9 w-full px-3 text-sm font-bold text-navy-950">
                  <option value="Agente">Agente</option>
                </select>
              </label>
            </>
          ) : null}
          <div className="flex flex-wrap items-end justify-end gap-2">
            {view === "AGENTS" && payload?.permissions.canImport ? (
              <>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => void previewRequirementFile(event.target.files?.[0])} />
                <button onClick={() => void downloadFile("/api/staff-coverage/template", "template_necessidade.xlsx").catch((error) => setMessage(error instanceof Error ? coverageTerminology(error.message) : "Não foi possível baixar o template."))} className="premium-control h-9 px-3 text-xs font-extrabold text-navy-950">
                  Template
                </button>
                <button onClick={() => fileInputRef.current?.click()} disabled={importing} className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-xs font-extrabold text-white disabled:opacity-60">
                  <Upload className="h-4 w-4" /> Importar
                </button>
              </>
            ) : null}
            {view === "AGENTS" && payload?.permissions.canAutoUpdate ? (
              <button
                type="button"
                onClick={() => void refreshAdsRequirement()}
                disabled={updatingAdsRequirement}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-extrabold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={cn("h-4 w-4", updatingAdsRequirement && "animate-spin")} />
                {updatingAdsRequirement ? "Calculando..." : "Atualizar necessidade ADS"}
              </button>
            ) : null}
            {view === "AGENTS" ? <button onClick={() => void exportCoverage()} className="premium-control inline-flex h-9 items-center gap-2 px-3 text-xs font-extrabold text-navy-950">
              <Download className="h-4 w-4" /> Exportar
            </button> : null}
            {view === "STAFF" ? (
              <button type="button" onClick={() => setShowRtaCoverage((current) => !current)} className={cn("inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-extrabold transition", showRtaCoverage ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-600")}>
                <Headphones className="h-4 w-4" /> {showRtaCoverage ? "COM RTA" : "SEM RTA"}
              </button>
            ) : null}
            <button onClick={() => view === "AGENTS" ? void loadCoverage() : void loadStaffCoverage()} className="inline-flex h-9 items-center gap-2 rounded-lg bg-navy-950 px-3 text-xs font-extrabold text-white">
              <RefreshCw className={cn("h-4 w-4", (view === "AGENTS" ? loading : staffLoading) && "animate-spin")} /> Atualizar
            </button>
          </div>
        </div>
      </div>

      {adsUpdateSummary ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{adsUpdateSummary}</div> : null}
      {message ? <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{message}</div> : null}

      {view === "STAFF" ? (
        <RequiredStaffCoverageView payload={staffPayload} loading={staffLoading} showRta={showRtaCoverage} />
      ) : (
      <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <StatCard title="Necessidade total" value={summary?.totalRequired ?? 0} helper="arquivo semanal" icon={ClipboardList} tone="blue" />
        <StatCard title="Total programado" value={summary?.totalAvailable ?? 0} helper="agentes no cronograma" icon={UserCheck} tone="green" />
        <StatCard title="Gap total" value={formatGap(summary?.totalGap ?? 0)} helper="programado - necessidade" icon={Target} tone={(summary?.totalGap ?? 0) < 0 ? "red" : "green"} />
        <StatCard title="Dias com déficit" value={summary?.deficitDays ?? 0} helper="datas abaixo da necessidade" icon={CalendarDays} tone="orange" />
        <StatCard title="Turnos com déficit" value={summary?.deficitShifts ?? 0} helper="LOB + turno" icon={AlertTriangle} tone="red" />
        <StatCard title="Maior déficit" value={formatGap(summary?.biggestDeficit ?? 0)} helper="pior linha do período" icon={ShieldCheck} tone={(summary?.biggestDeficit ?? 0) < 0 ? "red" : "green"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_.8fr]">
        <Panel title="Necessidade por data, LOB e turno">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-extrabold uppercase text-muted">
                  {["Data", "LOB", "Turno", "Necessidade", "Programado", "Gap", "Status", "Observação"].map((column) => (
                    <th key={column} className="px-3 py-2">{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-sm font-bold text-muted">Carregando cobertura...</td></tr>
                ) : rows.length ? rows.map((row) => (
                  <tr key={`${row.date}-${row.lob}-${row.shift}`} onClick={() => void openDetails(row)} className="cursor-pointer border-b border-slate-100 text-navy-950 transition hover:bg-blue-50/60">
                    <td className="px-3 py-2 font-bold">
                      {row.dateLabel}
                      <p className="text-xs font-semibold text-muted">{row.weekday}</p>
                    </td>
                    <td className="px-3 py-2 font-bold">{row.lob}</td>
                    <td className="px-3 py-2">{row.shift}</td>
                    <td className="px-3 py-2 text-center font-extrabold">{row.required}</td>
                    <td className="px-3 py-2 text-center font-extrabold">{row.available}</td>
                    <td className={cn("px-3 py-2 text-center font-extrabold", row.gap < 0 ? "text-red-600" : row.gap > 0 ? "text-emerald-600" : "text-navy-950")}>{formatGap(row.gap)}</td>
                    <td className="px-3 py-2"><span className={cn("rounded-full px-2 py-1 text-xs font-extrabold", staffCoverageStatusTone(row.status))}>{staffCoverageStatusLabel(row.status)}</span></td>
                    <td className="max-w-[220px] truncate px-3 py-2 text-muted" title={row.observation}>{row.observation || "-"}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={8} className="px-3 py-8"><EmptyState title="Nenhuma necessidade encontrada" description="Importe a necessidade semanal ou ajuste os filtros do período." /></td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-xs font-bold text-muted">
            <span>{payload?.pagination.total ?? 0} linha(s) no período filtrado.</span>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="premium-control h-8 px-3 disabled:opacity-50">Anterior</button>
              <span>Página {payload?.pagination.page ?? page} de {payload?.pagination.totalPages ?? 1}</span>
              <button disabled={!payload || page >= payload.pagination.totalPages} onClick={() => setPage((current) => current + 1)} className="premium-control h-8 px-3 disabled:opacity-50">Próxima</button>
            </div>
          </div>
        </Panel>

        <Panel title="Matriz semanal de gap">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-extrabold uppercase text-muted">
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2 text-center">Manhã</th>
                  <th className="px-3 py-2 text-center">Tarde</th>
                  <th className="px-3 py-2 text-center">Noite</th>
                  <th className="px-3 py-2 text-center">Total</th>
                </tr>
              </thead>
              <tbody>
                {(payload?.matrix ?? []).map((row) => (
                  <tr key={row.date} className="border-b border-slate-100">
                    <td className="px-3 py-2 font-bold text-navy-950">{row.label}</td>
                    {(["Manhã", "Tarde", "Noite", "total"] as const).map((key) => (
                      <td key={key} className={cn("px-3 py-2 text-center font-extrabold", row[key] < 0 ? "text-red-600" : row[key] > 0 ? "text-emerald-600" : "text-navy-950")}>{formatGap(row[key])}</td>
                    ))}
                  </tr>
                ))}
                {payload?.matrix.length === 0 ? <tr><td colSpan={5} className="px-3 py-8 text-center text-sm font-bold text-muted">Sem dados para a matriz.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Resumo por dia">
          <StaffCoverageSummaryList rows={payload?.byDay ?? []} />
        </Panel>
        <Panel title="Resumo por LOB">
          <StaffCoverageSummaryList rows={payload?.byLob ?? []} />
        </Panel>
        <Panel title="Resumo por turno">
          <StaffCoverageSummaryList rows={payload?.byShift ?? []} />
        </Panel>
      </div>
      </>
      )}

      {preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/45 p-4">
          <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Preview da necessidade semanal</h2>
                <p className="text-sm font-semibold text-muted">{previewFileName || "Arquivo importado"} · {preview.summary.totalRows} linha(s)</p>
              </div>
              <button onClick={() => setPreview(null)} className="rounded-lg border border-border px-3 py-2 text-sm font-bold text-navy-950">Fechar</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="grid gap-3 md:grid-cols-5">
                <MetricPill value={preview.summary.validRows} label="Linhas válidas" />
                <MetricPill value={preview.summary.errorRows} label="Com erro" />
                <MetricPill value={preview.summary.warningRows} label="Alertas" />
                <MetricPill value={preview.summary.createdRows} label="Novos" />
                <MetricPill value={preview.summary.updatedRows} label="Atualizações" />
              </div>
              <ImportIssueSummary rows={preview.rows.map((row) => ({ rowNumber: row.rowNumber, errors: row.errors, warnings: row.warnings }))} />
              <div className="mt-4 max-h-[52vh] overflow-auto rounded-xl border border-border">
                <table className="w-full min-w-[920px] text-sm">
                  <thead className="sticky top-0 bg-white text-left text-xs font-extrabold uppercase text-muted">
                    <tr>
                      {["Linha", "Data", "LOB", "Turno", "Necessidade", "Ação", "Erro/alerta"].map((column) => <th key={column} className="px-3 py-2">{column}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, IMPORT_PREVIEW_ROW_LIMIT).map((row) => (
                      <tr key={row.rowNumber} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-bold">{row.rowNumber}</td>
                        <td className="px-3 py-2">{row.date}</td>
                        <td className="px-3 py-2">{row.lob}</td>
                        <td className="px-3 py-2">{row.shift}</td>
                        <td className="px-3 py-2 text-center font-bold">{row.required ?? "-"}</td>
                        <td className="px-3 py-2"><StatusBadge status={row.action === "update" ? "Atualizar" : row.action === "create" ? "Criar" : "Ignorar"} /></td>
                        <td className={cn("px-3 py-2 text-xs font-bold", row.errors.length ? "text-red-600" : "text-amber-600")}>{[...row.errors, ...row.warnings].join(" | ") || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.rows.length > IMPORT_PREVIEW_ROW_LIMIT ? <p className="mt-2 text-xs font-bold text-muted">Exibindo as primeiras {IMPORT_PREVIEW_ROW_LIMIT} linhas do preview. O arquivo completo será processado na confirmação.</p> : null}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
              <button onClick={() => setPreview(null)} className="premium-control h-9 px-4 text-sm font-extrabold text-navy-950">Cancelar</button>
              <button disabled={Boolean(preview.summary.errorRows) || importing} onClick={() => void commitRequirementImport()} className="h-9 rounded-lg bg-navy-950 px-4 text-sm font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-50">
                Confirmar importação
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {details || detailsLoading ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/45 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Agentes programados</h2>
                <p className="text-sm font-semibold text-muted">{details ? `${details.summary.dateLabel} · ${details.summary.lob} · ${details.summary.shift}` : "Carregando..."}</p>
              </div>
              <button onClick={() => setDetails(null)} className="rounded-lg border border-border px-3 py-2 text-sm font-bold text-navy-950">Fechar</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {detailsLoading ? <p className="text-sm font-bold text-muted">Carregando agentes...</p> : details ? (
                <>
                  <div className="mb-4 grid gap-3 md:grid-cols-4">
                    <MetricPill value={details.summary.required} label="Necessidade" />
                    <MetricPill value={details.summary.available} label="Programado" />
                    <MetricPill value={formatGap(details.summary.gap)} label="Gap" />
                    <MetricPill value={details.summary.gap < 0 ? `Faltam ${Math.abs(details.summary.gap)}` : details.summary.gap > 0 ? `Sobram ${details.summary.gap}` : "Exato"} label="Interpretação" />
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full min-w-[760px] text-sm">
                      <thead className="bg-slate-50 text-left text-xs font-extrabold uppercase text-muted">
                        <tr>{["Nome", "WB/Login", "Supervisor", "Skill", "Status", "Turno"].map((column) => <th key={column} className="px-3 py-2">{column}</th>)}</tr>
                      </thead>
                      <tbody>
                        {details.data.map((agent) => (
                          <tr key={agent.id} className="border-t border-slate-100">
                            <td className="px-3 py-2 font-bold text-navy-950">{agent.name}</td>
                            <td className="px-3 py-2">{agent.wbLogin}</td>
                            <td className="px-3 py-2">{agent.supervisor}</td>
                            <td className="px-3 py-2">{agent.skill || "-"}</td>
                            <td className="px-3 py-2"><StatusBadge status={agent.scheduleStatus} /></td>
                            <td className="px-3 py-2">{agent.shift}</td>
                          </tr>
                        ))}
                        {!details.data.length ? <tr><td colSpan={6} className="px-3 py-8"><EmptyState title="Nenhum agente encontrado" description="Não há agentes programados para essa combinação." /></td></tr> : null}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}


type StaffCoverageAgentClient = {
  id: string;
  name: string;
  wbLogin: string;
  supervisor: string;
  skill: string;
  lob: string;
  shift: string;
  scheduleStatus: string;
};


type StaffCoverageRowClient = {
  date: string;
  dateLabel: string;
  weekday: string;
  lobId: string;
  lob: string;
  shift: "Manhã" | "Tarde" | "Noite";
  required: number;
  available: number;
  gap: number;
  coveragePercent: number;
  risk: string;
  status: string;
  observation: string;
  availableAgents: StaffCoverageAgentClient[];
};


type StaffCoverageSummaryRow = {
  label: string;
  required: number;
  available: number;
  gap: number;
};


type StaffCoverageResponse = {
  data: StaffCoverageRowClient[];
  summary: {
    totalRequired: number;
    totalAvailable: number;
    totalGap: number;
    deficitDays: number;
    deficitShifts: number;
    biggestDeficit: number;
  };
  byDay: StaffCoverageSummaryRow[];
  byLob: StaffCoverageSummaryRow[];
  byShift: StaffCoverageSummaryRow[];
  matrix: Array<{ date: string; label: string; Manhã: number; Tarde: number; Noite: number; total: number }>;
  pagination: { page: number; limit: number; total: number; totalPages: number };
  filters: { lobs: string[]; shifts: string[]; supervisors: string[]; skills: string[] };
  permissions: { canImport: boolean; canExport: boolean; canAutoUpdate: boolean };
};


type StaffCoveragePreviewResponse = {
  success: boolean;
  rows: Array<{
    rowNumber: number;
    date: string;
    lob: string;
    lobId?: string;
    shift: string;
    shiftId?: string;
    required: number | null;
    observation: string;
    action: "create" | "update" | "ignore";
    errors: string[];
    warnings: string[];
  }>;
  summary: { totalRows: number; validRows: number; errorRows: number; warningRows: number; createdRows: number; updatedRows: number };
};


type StaffCoverageDetailsResponse = {
  summary: { date: string; dateLabel: string; lob: string; shift: string; required: number; available: number; gap: number };
  data: StaffCoverageAgentClient[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};


type RequiredStaffPersonClient = {
  id: string;
  name: string;
  wbLogin: string;
  skill: string;
  lob: "ADS" | "CEC" | "TNS";
  role: "SUPERVISOR" | "POC" | "RTA";
  shift: "Manhã" | "Tarde" | "Noite";
  scheduleStatus: string;
};


type RequiredStaffLobCellClient = {
  lob: "ADS" | "CEC" | "TNS";
  status: "COMPLETE" | "PARTIAL_SUPERVISOR" | "PARTIAL_POC" | "NONE";
  label: string;
  supervisors: RequiredStaffPersonClient[];
  pocs: RequiredStaffPersonClient[];
  rtas: RequiredStaffPersonClient[];
};


type RequiredStaffShiftRowClient = {
  date: string;
  dateLabel: string;
  weekday: string;
  isWeekend: boolean;
  shift: "Manhã" | "Tarde" | "Noite";
  companySupervisors: RequiredStaffPersonClient[];
  supervisorStatus: "OK" | "CRITICAL";
  rtas: RequiredStaffPersonClient[];
  lobs: RequiredStaffLobCellClient[];
};


type RequiredStaffCriticalRowClient = {
  date: string;
  dateLabel: string;
  weekday: string;
  shift: "Manhã" | "Tarde" | "Noite";
  lob: "ADS" | "CEC" | "TNS" | "Geral";
  severity: "Crítico" | "Alto" | "Médio" | "Baixo";
  problem: string;
  observation: string;
  score: number;
};


type RequiredStaffCoverageResponse = {
  period: { startDate: string; endDate: string };
  summary: {
    shiftsWithSupervisor: number;
    shiftsWithoutSupervisor: number;
    completeCoverage: number;
    partialCoverage: number;
    noCoverage: number;
    mostCriticalLob: string;
    criticalDay: string;
    weekendRisk: number;
  };
  rows: RequiredStaffShiftRowClient[];
  critical: RequiredStaffCriticalRowClient[];
  filters: { lobs: string[]; shifts: string[]; staff: string[]; coverageStatuses?: string[] };
};


function RequiredStaffCoverageView({ payload, loading, showRta }: { payload: RequiredStaffCoverageResponse | null; loading: boolean; showRta: boolean }) {
  const [showCriticalDays, setShowCriticalDays] = useState(true);
  const rows = payload?.rows ?? [];
  const lobs = rows.length ? Array.from(new Set(rows.flatMap((row) => row.lobs.map((cell) => cell.lob)))) : ["ADS", "CEC", "TNS"];
  const summary = payload?.summary;

  if (loading && !payload) {
    return <div className="rounded-xl border border-border bg-white p-8 text-center text-sm font-bold text-muted">Carregando cobertura STAFF...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <StatCard title="Turnos com supervisor" value={summary?.shiftsWithSupervisor ?? 0} helper="mínimo na empresa" icon={ShieldCheck} tone="green" />
        <StatCard title="Sem supervisor" value={summary?.shiftsWithoutSupervisor ?? 0} helper="turnos críticos" icon={AlertTriangle} tone={(summary?.shiftsWithoutSupervisor ?? 0) > 0 ? "red" : "green"} />
        <StatCard title="Com supervisor" value={summary?.completeCoverage ?? 0} helper="verde no heatmap" icon={UserCheck} tone="green" />
        <StatCard title="POC/RTA" value={summary?.partialCoverage ?? 0} helper={showRta ? "amarelo: POC ou RTA" : "amarelo: POC"} icon={Clock} tone="orange" />
        <StatCard title="Sem cobertura" value={summary?.noCoverage ?? 0} helper={showRta ? "sem Supervisor/POC/RTA" : "sem Supervisor/POC"} icon={XCircle} tone={(summary?.noCoverage ?? 0) > 0 ? "red" : "green"} />
        <StatCard title="Risco fim de semana" value={summary?.weekendRisk ?? 0} helper={`LOB crítica: ${summary?.mostCriticalLob ?? "-"}`} icon={CalendarDays} tone={(summary?.weekendRisk ?? 0) > 0 ? "red" : "blue"} />
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={() => setShowCriticalDays((current) => !current)} className="premium-control inline-flex h-9 items-center gap-2 px-3 text-xs font-extrabold text-navy-950">
          {showCriticalDays ? <ChevronRight className="h-4 w-4 rotate-90" /> : <ChevronRight className="h-4 w-4" />}
          {showCriticalDays ? "Ocultar dias críticos" : "Mostrar dias críticos"}
        </button>
      </div>

      <div className={cn("grid gap-4", showCriticalDays && "xl:grid-cols-[minmax(0,1fr)_360px]")}>
        <Panel title="Heatmap de cobertura STAFF">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-bold text-muted">
            <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">Verde = Supervisor</span>
            <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">{showRta ? "Amarelo = POC ou RTA" : "Amarelo = POC"}</span>
            <span className="rounded-full bg-red-50 px-2 py-1 text-red-700">{showRta ? "Vermelho = sem Supervisor/POC/RTA" : "Vermelho = sem Supervisor/POC"}</span>
            {showRta ? <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">RTA ativo na cobertura</span> : null}
            <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">Supervisor mínimo é geral por turno</span>
          </div>
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-[1120px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-extrabold uppercase text-muted">
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Turno</th>
                  <th className="px-3 py-2">Supervisor empresa</th>
                  {lobs.map((lob) => <th key={lob} className="px-3 py-2 text-center">{lob}</th>)}
                  {showRta ? <th className="px-3 py-2 text-center">RTA</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.date}-${row.shift}`} className={cn("border-b border-slate-100 align-top", row.isWeekend && "bg-slate-50/60")}>
                    <td className="px-3 py-2 font-bold text-navy-950">
                      {row.dateLabel}
                      <p className="text-xs font-semibold text-muted">{row.weekday}{row.isWeekend ? " · fim de semana" : ""}</p>
                    </td>
                    <td className="px-3 py-2 font-extrabold text-navy-950">{row.shift}</td>
                    <td className="px-3 py-2">
                      <span className={cn("rounded-full px-2 py-1 text-xs font-extrabold", row.companySupervisors.length ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>
                        {row.companySupervisors.length ? "OK" : "Crítico"}
                      </span>
                      <div className="mt-2 max-h-28 max-w-[190px] overflow-y-auto pr-1">
                        <StaffNameList items={row.companySupervisors} empty="Sem Supervisor" />
                      </div>
                    </td>
                    {lobs.map((lob) => {
                      const cell = row.lobs.find((item) => item.lob === lob);
                      return (
                        <td key={lob} className="px-2 py-2">
                          {cell ? <RequiredStaffCoverageCell cell={cell} showRta={showRta} /> : <div className="min-h-[132px] rounded-xl border border-dashed border-slate-200 bg-slate-50/60" />}
                        </td>
                      );
                    })}
                    {showRta ? (
                      <td className="px-3 py-2 text-center">
                        <span className={cn("rounded-full px-2 py-1 text-xs font-extrabold", row.rtas.length ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-muted")}>
                          {row.rtas.length ? `${row.rtas.length} RTA` : "Sem RTA"}
                        </span>
                        <div className="mx-auto mt-2 max-h-28 max-w-[180px] overflow-y-auto pr-1 text-left">
                          <StaffNameList items={row.rtas} empty="-" />
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
                {!rows.length ? <tr><td colSpan={showRta ? 7 : 6} className="px-3 py-8"><EmptyState title="Sem escala STAFF" description="Não foram encontrados Supervisores, POCs ou RTAs por skill no período filtrado." /></td></tr> : null}
              </tbody>
            </table>
          </div>
        </Panel>

        {showCriticalDays ? (
          <Panel title="Dias mais críticos">
            <div className="max-h-[640px] space-y-2 overflow-y-auto pr-1">
              {(payload?.critical ?? []).map((item) => (
                <div key={`${item.date}-${item.shift}-${item.lob}-${item.problem}`} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-extrabold text-navy-950">{item.dateLabel} · {item.shift} · {item.lob}</p>
                      <p className="text-xs font-semibold text-muted">{item.weekday} · {item.problem}</p>
                    </div>
                    <span className={cn("rounded-full px-2 py-1 text-xs font-extrabold", severityTone(item.severity))}>{item.severity}</span>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-muted">{item.observation}</p>
                </div>
              ))}
              {!payload?.critical.length ? <EmptyState title="Sem criticidade" description="Nenhum ponto crítico no período filtrado." /> : null}
            </div>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}


function RequiredStaffCoverageCell({ cell, showRta }: { cell: RequiredStaffLobCellClient; showRta: boolean }) {
  return (
    <div className={cn("min-h-[132px] rounded-xl border p-3 text-left", requiredStaffCellTone(cell.status))}>
      <p className="text-xs font-extrabold uppercase">{cell.label}</p>
      <div className="mt-2 max-h-44 space-y-2 overflow-y-auto pr-1 text-xs font-semibold">
        <StaffRoleGroup label="Supervisor" items={cell.supervisors} />
        <StaffRoleGroup label="POC" items={cell.pocs} />
        {showRta ? <StaffRoleGroup label="RTA" items={cell.rtas} /> : null}
      </div>
    </div>
  );
}


function StaffRoleGroup({ label, items }: { label: string; items: RequiredStaffPersonClient[] }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-black uppercase tracking-wide opacity-70">{label}</p>
      <StaffNameList items={items} empty="-" />
    </div>
  );
}


function StaffNameList({ items, empty }: { items: RequiredStaffPersonClient[]; empty: string }) {
  if (!items.length) return <p className="break-words text-xs font-semibold opacity-75">{empty}</p>;
  return (
    <div className="space-y-0.5" title={staffNames(items)}>
      {items.map((item) => (
        <p key={`${item.id}-${item.role}-${item.lob}`} className="break-words text-xs font-semibold leading-snug">
          {item.name}
        </p>
      ))}
    </div>
  );
}


function staffNames(items: RequiredStaffPersonClient[]) {
  return items.map((item) => item.name).join(", ");
}


function requiredStaffCellTone(status: RequiredStaffLobCellClient["status"]) {
  if (status === "COMPLETE") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "NONE") return "border-red-200 bg-red-50 text-red-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
}


function severityTone(severity: RequiredStaffCriticalRowClient["severity"]) {
  if (severity === "Crítico") return "bg-red-100 text-red-700";
  if (severity === "Alto") return "bg-orange-100 text-orange-700";
  if (severity === "Médio") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-muted";
}


function StaffCoverageSummaryList({ rows }: { rows: StaffCoverageSummaryRow[] }) {
  if (!rows.length) return <EmptyState title="Sem dados" description="Importe a necessidade ou ajuste os filtros." />;
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.label} className="rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-extrabold text-navy-950" title={row.label}>{row.label}</p>
            <span className={cn("rounded-full px-2 py-1 text-xs font-extrabold", row.gap < 0 ? "bg-red-50 text-red-700" : row.gap > 0 ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-navy-950")}>{formatGap(row.gap)}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-bold text-muted">
            <span>Necessidade: <b className="text-navy-950">{row.required}</b></span>
            <span>Programado: <b className="text-navy-950">{row.available}</b></span>
          </div>
        </div>
      ))}
    </div>
  );
}


function currentStaffCoverageWeekRange() {
  const anchor = parseDateInput(currentOperationalDateInput()) ?? new Date();
  const weekday = anchor.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const start = new Date(anchor);
  start.setUTCDate(anchor.getUTCDate() + mondayOffset);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { startDate: dateInputFromUtc(start), endDate: dateInputFromUtc(end) };
}


function currentMonthRemainingRange() {
  const start = parseDateInput(currentOperationalDateInput()) ?? new Date();
  const end = new Date(start);
  end.setUTCMonth(start.getUTCMonth() + 1, 0);
  return { startDate: dateInputFromUtc(start), endDate: dateInputFromUtc(end) };
}


function optionList(values: string[] | undefined, selected: string) {
  const set = new Set(values?.length ? values : []);
  if (!set.size) set.add(selected);
  if (selected && !set.has(selected)) set.add(selected);
  return Array.from(set);
}


function formatGap(value: number) {
  if (value > 0) return `+${value}`;
  return String(value);
}


function staffCoverageStatusTone(status: string) {
  if (status === "Déficit" || status === "Sem cobertura") return "bg-red-50 text-red-700";
  if (status === "Sobra") return "bg-emerald-50 text-emerald-700";
  if (status === "Sem requerido") return "bg-amber-50 text-amber-700";
  return "bg-blue-50 text-blue-700";
}


function staffCoverageStatusLabel(status: string) {
  return status === "Sem requerido" ? "Sem necessidade" : status;
}
