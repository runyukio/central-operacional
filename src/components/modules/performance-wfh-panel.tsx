"use client";

import dynamic from "next/dynamic";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { type LucideIcon, AlertTriangle, ArrowDown, ArrowUp, CalendarCheck, CalendarDays, CheckCircle2, Clock, ClipboardList, Download, FileSpreadsheet, Plus, RefreshCw, ShieldCheck, Target, Trophy, Upload, UsersRound, XCircle } from "lucide-react";
import { TopActions } from "@/components/layout/app-shell";
import { EmptyState, MetricPill, PageHeader, Panel, SimpleTable, StatCard, StatusBadge } from "@/components/ui/primitives";
import { parseWbLoginBatch, serializeWbLogins } from "@/lib/batch-wb-filter";
import { canAccessPerformance } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { FormInput, IMPORT_PREVIEW_ROW_LIMIT, ImportIssueSummary, apiJson, downloadFile, initialDateRangeFromUrl, normalizePerformanceSheetName, queryParam } from './shared';
const CartesianGrid = dynamic(() => import("@/components/ui/lazy-recharts").then((module) => module.ChartCartesianGrid), { ssr: false });

const Line = dynamic(() => import("@/components/ui/lazy-recharts").then((module) => module.ChartLine), { ssr: false });

const LineChart = dynamic(() => import("@/components/ui/lazy-recharts").then((module) => module.ChartLineChart), { ssr: false });

const ResponsiveContainer = dynamic(() => import("@/components/ui/lazy-recharts").then((module) => module.ChartResponsiveContainer), { ssr: false });

const Tooltip = dynamic(() => import("@/components/ui/lazy-recharts").then((module) => module.ChartTooltip), { ssr: false });

const XAxis = dynamic(() => import("@/components/ui/lazy-recharts").then((module) => module.ChartXAxis), { ssr: false });

const YAxis = dynamic(() => import("@/components/ui/lazy-recharts").then((module) => module.ChartYAxis), { ssr: false });

const PERFORMANCE_IMPORT_CHUNK_SIZE = 250;


export function PerformanceWfhPanel() {
  return <PerformanceLegacyPage embeddedWfh />;
}


function PerformanceLegacyPage({ embeddedWfh = false }: { embeddedWfh?: boolean }) {
  const { data: session } = useSession();
  const requestedPerformanceView = embeddedWfh ? "wfh" : queryParam("view");
  const hasRequestedPerformanceView = requestedPerformanceView === "mine" || requestedPerformanceView === "wfh" || requestedPerformanceView === "framework";
  const defaultedTab = useRef(embeddedWfh || hasRequestedPerformanceView);
  const [activeTab, setActiveTab] = useState<"mine" | "wfh" | "framework">(requestedPerformanceView === "framework" ? "framework" : requestedPerformanceView === "wfh" ? "wfh" : "mine");
  const [filters, setFilters] = useState(() => ({
    ...initialDateRangeFromUrl(),
    lob: "Todos",
    supervisorId: "Todos",
    employeeId: queryParam("employeeId") || "Todos",
    role: "Todos",
    skill: "Todos",
    employeeStatus: "Todos",
    wfhStatus: "Todos",
    wbLogins: [] as string[]
  }));
  const [performanceSort, setPerformanceSort] = useState<PerformanceSortState>({ by: "", direction: "desc" });
  const [payload, setPayload] = useState<PerformanceDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [batchWbText, setBatchWbText] = useState("");
  const [batchWbOpen, setBatchWbOpen] = useState(false);
  const [qualityPreview, setQualityPreview] = useState<PerformancePreviewResponse | null>(null);
  const [tnsQualityPreview, setTnsQualityPreview] = useState<PerformancePreviewResponse | null>(null);
  const [cecQualityPreview, setCecQualityPreview] = useState<PerformancePreviewResponse | null>(null);
  const [productionPreview, setProductionPreview] = useState<PerformancePreviewResponse | null>(null);
  const [qualityFileName, setQualityFileName] = useState("");
  const [tnsQualityFileName, setTnsQualityFileName] = useState("");
  const [cecQualityFileName, setCecQualityFileName] = useState("");
  const [productionFileName, setProductionFileName] = useState("");
  const [cecQualityYear, setCecQualityYear] = useState(() => String(new Date().getFullYear()));
  const [importing, setImporting] = useState<"" | PerformanceImportKind>("");
  const [selectedAgent, setSelectedAgent] = useState<AgentPerformanceClient | null>(null);
  const qualityInputRef = useRef<HTMLInputElement | null>(null);
  const tnsQualityInputRef = useRef<HTMLInputElement | null>(null);
  const cecQualityInputRef = useRef<HTMLInputElement | null>(null);
  const productionInputRef = useRef<HTMLInputElement | null>(null);
  const qualityRawRowsRef = useRef<Array<Record<string, unknown>>>([]);
  const tnsQualityRawRowsRef = useRef<Array<Record<string, unknown>>>([]);
  const cecQualityRawRowsRef = useRef<Array<Record<string, unknown>>>([]);
  const productionRawRowsRef = useRef<Array<Record<string, unknown>>>([]);
  const sessionRole = String((session?.user as { role?: string } | undefined)?.role ?? "").toUpperCase();
  const isClientRole = sessionRole === "CLIENT";
  const sessionCanWfh = canAccessPerformance({ role: sessionRole });
  const sessionCanFramework = canAccessPerformance({ role: sessionRole });
  const visibleActiveTab = embeddedWfh ? "wfh" : isClientRole && activeTab !== "framework" ? "wfh" : activeTab;
  const shouldWaitForDefaultPerformanceTab = Boolean(!embeddedWfh && sessionRole && !hasRequestedPerformanceView && !defaultedTab.current);

  useEffect(() => {
    if (embeddedWfh) return;
    if (isClientRole && activeTab !== "wfh" && activeTab !== "framework") {
      setActiveTab("wfh");
      defaultedTab.current = true;
      return;
    }
    if (!defaultedTab.current && sessionRole) {
      setActiveTab(sessionCanWfh ? "wfh" : "mine");
      defaultedTab.current = true;
    }
  }, [activeTab, embeddedWfh, isClientRole, sessionCanWfh, sessionRole]);

  const loadPerformance = useCallback(async () => {
    if (!sessionRole || shouldWaitForDefaultPerformanceTab) return;
    const effectiveTab = isClientRole && activeTab !== "framework" ? "wfh" : activeTab;
    setLoading(true);
    const params = new URLSearchParams({
      view: effectiveTab,
      startDate: filters.startDate,
      endDate: filters.endDate
    });
    if (effectiveTab === "wfh") {
      if (filters.lob !== "Todos") params.set("lob", filters.lob);
      if (filters.supervisorId !== "Todos") params.set("supervisorId", filters.supervisorId);
      if (filters.employeeId !== "Todos") params.set("employeeId", filters.employeeId);
      if (filters.role !== "Todos") params.set("role", filters.role);
      if (filters.skill !== "Todos") params.set("skill", filters.skill);
      if (filters.employeeStatus !== "Todos") params.set("employeeStatus", filters.employeeStatus);
      if (filters.wfhStatus !== "Todos") params.set("wfhStatus", filters.wfhStatus);
      if (filters.wbLogins.length) params.set("wbLogins", serializeWbLogins(filters.wbLogins));
      if (performanceSort.by) {
        params.set("sortBy", performanceSort.by);
        params.set("sortDirection", performanceSort.direction);
      }
    }
    try {
      const data = await apiJson<PerformanceDashboardResponse>(`/api/performance?${params.toString()}`);
      setPayload(data);
      if (data.mode === "wfh" && data.filters.batchWb?.notFound.length) {
        setMessage(`${data.filters.batchWb.applied.length} login(s) aplicados. ${data.filters.batchWb.notFound.length} não encontrado(s): ${data.filters.batchWb.notFound.join(", ")}.`);
      } else {
        setMessage("");
      }
    } catch (error) {
      setPayload(null);
      setMessage(error instanceof Error ? error.message : "Não foi possível carregar Performance.");
    } finally {
      setLoading(false);
    }
  }, [activeTab, filters, isClientRole, performanceSort, sessionRole, shouldWaitForDefaultPerformanceTab]);

  useEffect(() => {
    void loadPerformance();
  }, [loadPerformance]);

  useEffect(() => {
    if (payload?.mode !== "wfh") return;
    setSelectedAgent((current) => current ? payload.ranking.find((agent) => agent.employeeId === current.employeeId) ?? null : null);
  }, [payload]);

  const canShowWfh = payload?.mode === "mine" ? payload.canAccessWfh : payload?.mode === "wfh" ? true : sessionCanWfh;
  const canShowFramework = payload?.mode === "framework" ? true : sessionCanFramework;
  const wfhPayload = payload?.mode === "wfh" ? payload : null;
  const minePayload = payload?.mode === "mine" ? payload : null;
  const frameworkPayload = payload?.mode === "framework" ? payload : null;
  const mineUsesCpd = isCecPerformanceRule(minePayload?.summary.mine.qualityRule);
  const wfhUsesCpd = wfhPayload?.ranking.length
    ? wfhPayload.ranking.every((agent) => isCecPerformanceRule(agent.qualityRule))
    : filters.lob.trim().toLowerCase() === "cec";

  async function previewPerformanceFile(type: PerformanceImportKind, file?: File | null) {
    if (!file) return;
    setImporting(type);
    if (type === "quality") setQualityFileName(file.name);
    else if (type === "tns-quality") setTnsQualityFileName(file.name);
    else if (type === "cec-quality") setCecQualityFileName(file.name);
    else setProductionFileName(file.name);
    try {
      const rawRows = await readPerformanceWorkbookRows(file, type);
      if (!rawRows.length) throw new Error("O arquivo não possui linhas para importar.");
      if (type === "quality") {
        qualityRawRowsRef.current = rawRows;
        setQualityPreview(null);
      } else if (type === "tns-quality") {
        tnsQualityRawRowsRef.current = rawRows;
        setTnsQualityPreview(null);
      } else if (type === "cec-quality") {
        cecQualityRawRowsRef.current = rawRows;
        setCecQualityPreview(null);
      } else {
        productionRawRowsRef.current = rawRows;
        setProductionPreview(null);
      }
      let aggregate = emptyPerformancePreview();
      for (let index = 0; index < rawRows.length; index += PERFORMANCE_IMPORT_CHUNK_SIZE) {
        setMessage(`Validando ${performanceImportLabel(type)}: ${Math.min(index + PERFORMANCE_IMPORT_CHUNK_SIZE, rawRows.length)} de ${rawRows.length} linha(s).`);
        const result = await apiJson<PerformancePreviewResponse>(`/api/performance/import/${type}/preview`, {
          method: "POST",
          body: JSON.stringify({ rows: rawRows.slice(index, index + PERFORMANCE_IMPORT_CHUNK_SIZE), rowOffset: index, yearReference: type === "cec-quality" ? cecQualityYear : undefined })
        });
        aggregate = mergePerformancePreview(aggregate, result);
      }
      if (type === "quality") setQualityPreview(aggregate);
      else if (type === "tns-quality") setTnsQualityPreview(aggregate);
      else if (type === "cec-quality") setCecQualityPreview(aggregate);
      else setProductionPreview(aggregate);
      const hiddenRows = aggregate.summary.totalRows > aggregate.rows.length ? ` Exibindo amostra de ${aggregate.rows.length} linha(s) para evitar payload grande.` : "";
      setMessage(aggregate.summary.errorRows ? `Revise os erros do preview antes de confirmar.${hiddenRows}` : `Preview gerado. Confirme para importar a base.${hiddenRows}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível validar o arquivo de Performance.");
    } finally {
      setImporting("");
      if (qualityInputRef.current) qualityInputRef.current.value = "";
      if (tnsQualityInputRef.current) tnsQualityInputRef.current.value = "";
      if (cecQualityInputRef.current) cecQualityInputRef.current.value = "";
      if (productionInputRef.current) productionInputRef.current.value = "";
    }
  }

  async function commitPerformanceImport(type: PerformanceImportKind) {
    const preview = type === "quality" ? qualityPreview : type === "tns-quality" ? tnsQualityPreview : type === "cec-quality" ? cecQualityPreview : productionPreview;
    if (!preview || preview.summary.errorRows || importing) return;
    setImporting(type);
    try {
      const rawRows = type === "quality" ? qualityRawRowsRef.current : type === "tns-quality" ? tnsQualityRawRowsRef.current : type === "cec-quality" ? cecQualityRawRowsRef.current : productionRawRowsRef.current;
      if (!rawRows.length) throw new Error("Arquivo original não encontrado para confirmar. Gere o preview novamente.");
      let batchId = "";
      let importedRows = 0;
      let createdRows = 0;
      let updatedRows = 0;
      for (let index = 0; index < rawRows.length; index += PERFORMANCE_IMPORT_CHUNK_SIZE) {
        setMessage(`Importando ${performanceImportLabel(type)}: ${Math.min(index + PERFORMANCE_IMPORT_CHUNK_SIZE, rawRows.length)} de ${rawRows.length} linha(s).`);
        const result = await apiJson<{ importedRows: number; createdRows: number; updatedRows: number; batchId: string }>(`/api/performance/import/${type}/commit`, {
          method: "POST",
          body: JSON.stringify({
            rawRows: rawRows.slice(index, index + PERFORMANCE_IMPORT_CHUNK_SIZE),
            fileName: type === "quality" ? qualityFileName : type === "tns-quality" ? tnsQualityFileName : type === "cec-quality" ? cecQualityFileName : productionFileName,
            batchId,
            rowOffset: index,
            yearReference: type === "cec-quality" ? cecQualityYear : undefined
          })
        });
        batchId = result.batchId;
        importedRows += result.importedRows;
        createdRows += result.createdRows;
        updatedRows += result.updatedRows;
      }
      setMessage(`Base importada: ${createdRows} criado(s), ${updatedRows} atualizado(s), ${importedRows} linha(s) válida(s).`);
      if (type === "quality") {
        qualityRawRowsRef.current = [];
        setQualityPreview(null);
      } else if (type === "tns-quality") {
        tnsQualityRawRowsRef.current = [];
        setTnsQualityPreview(null);
      } else if (type === "cec-quality") {
        cecQualityRawRowsRef.current = [];
        setCecQualityPreview(null);
      } else {
        productionRawRowsRef.current = [];
        setProductionPreview(null);
      }
      await loadPerformance();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível importar a base de Performance.");
    } finally {
      setImporting("");
    }
  }

  function updateFilter(key: string, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function addPerformanceBatchWbs() {
    const parsed = parseWbLoginBatch(batchWbText);
    if (!parsed.values.length) {
      setMessage("Cole um ou mais WB/Login para aplicar o filtro em lote.");
      return;
    }
    setFilters((current) => ({ ...current, wbLogins: Array.from(new Set([...current.wbLogins, ...parsed.values])) }));
    setBatchWbText("");
    setBatchWbOpen(false);
    setMessage(`${parsed.values.length} login(s) adicionados ao filtro em lote${parsed.duplicatesRemoved ? `; ${parsed.duplicatesRemoved} duplicado(s) ignorado(s)` : ""}.`);
  }

  function removePerformanceBatchWb(value: string) {
    setFilters((current) => ({ ...current, wbLogins: current.wbLogins.filter((item) => item !== value) }));
  }

  function updatePerformanceSort(by: PerformanceSortableMetric) {
    setPerformanceSort((current) => current.by === by ? { by, direction: current.direction === "desc" ? "asc" : "desc" } : { by, direction: "desc" });
  }

  function exportPerformance() {
    const params = new URLSearchParams({
      startDate: filters.startDate,
      endDate: filters.endDate
    });
    if (filters.lob !== "Todos") params.set("lob", filters.lob);
    if (filters.supervisorId !== "Todos") params.set("supervisorId", filters.supervisorId);
    if (filters.employeeId !== "Todos") params.set("employeeId", filters.employeeId);
    if (filters.role !== "Todos") params.set("role", filters.role);
    if (filters.skill !== "Todos") params.set("skill", filters.skill);
    if (filters.employeeStatus !== "Todos") params.set("employeeStatus", filters.employeeStatus);
    if (filters.wfhStatus !== "Todos") params.set("wfhStatus", filters.wfhStatus);
    if (filters.wbLogins.length) params.set("wbLogins", serializeWbLogins(filters.wbLogins));
    if (performanceSort.by) {
      params.set("sortBy", performanceSort.by);
      params.set("sortDirection", performanceSort.direction);
    }
    window.location.href = `/api/performance/export?${params.toString()}`;
  }

  return (
    <div className="space-y-4">
      {!embeddedWfh ? (
        <PageHeader
          title="Performance"
          description="Indicadores oficiais de Qualidade, Submit, AHT e ABS conectados ao cadastro e ao Cronograma."
          icon={Trophy}
          actions={<TopActions />}
        />
      ) : null}

      {!embeddedWfh ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-white p-2 shadow-sm">
          {!isClientRole ? <button onClick={() => setActiveTab("mine")} className={cn("rounded-lg px-4 py-2 text-sm font-extrabold", visibleActiveTab === "mine" ? "bg-blue-600 text-white" : "text-navy-950 hover:bg-blue-50")}>Minha Performance</button> : null}
          {canShowWfh ? <button onClick={() => setActiveTab("wfh")} className={cn("rounded-lg px-4 py-2 text-sm font-extrabold", visibleActiveTab === "wfh" ? "bg-blue-600 text-white" : "text-navy-950 hover:bg-blue-50")}>WFH</button> : null}
          {canShowFramework ? <button onClick={() => setActiveTab("framework")} className={cn("rounded-lg px-4 py-2 text-sm font-extrabold", visibleActiveTab === "framework" ? "bg-blue-600 text-white" : "text-navy-950 hover:bg-blue-50")}>Framework</button> : null}
        </div>
      ) : null}

      {visibleActiveTab !== "framework" ? (
        <div className="rounded-xl border border-border bg-white p-2.5 shadow-sm">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-[130px_130px_repeat(7,minmax(116px,1fr))_auto]">
            <FormInput label="Data inicial" type="date" value={filters.startDate} onChange={(value) => updateFilter("startDate", value)} />
            <FormInput label="Data final" type="date" value={filters.endDate} onChange={(value) => updateFilter("endDate", value)} />
            {visibleActiveTab === "wfh" ? (
              <>
                <PerformanceSelect label="LOB" value={filters.lob} onChange={(value) => updateFilter("lob", value)} options={wfhPayload?.filters.lobs ?? ["Todos"]} optionLabel={(value) => value === "Todos" ? "Todas as LOBs" : value} />
                <PerformanceSelect label="Supervisor" value={filters.supervisorId} onChange={(value) => updateFilter("supervisorId", value)} options={(wfhPayload?.filters.supervisors ?? [{ id: "Todos", name: "Todos os supervisores" }]).map((item) => item.id)} optionLabel={(value) => wfhPayload?.filters.supervisors.find((item) => item.id === value)?.name ?? value} />
                <PerformanceSelect label="Agente" value={filters.employeeId} onChange={(value) => updateFilter("employeeId", value)} options={(wfhPayload?.filters.employees ?? [{ id: "Todos", name: "Todos os agentes", wbLogin: "" }]).map((item) => item.id)} optionLabel={(value) => {
                  const item = wfhPayload?.filters.employees.find((employee) => employee.id === value);
                  return item ? (item.wbLogin ? `${item.name} · ${item.wbLogin}` : item.name) : value;
                }} />
                <PerformanceSelect label="Cargo/Função" value={filters.role} onChange={(value) => updateFilter("role", value)} options={wfhPayload?.filters.roles ?? ["Todos"]} optionLabel={(value) => value === "Todos" ? "Todos os cargos" : value} />
                <PerformanceSelect label="Skill" value={filters.skill} onChange={(value) => updateFilter("skill", value)} options={wfhPayload?.filters.skills ?? ["Todos"]} optionLabel={(value) => value === "Todos" ? "Todas as skills" : value === "SEM_SKILL" ? "Sem skill" : value} />
                <PerformanceSelect label="Status do agente" value={filters.employeeStatus} onChange={(value) => updateFilter("employeeStatus", value)} options={["Todos", "Ativo", "Afastado", "Desligado"]} />
                <PerformanceSelect label="WFH" value={filters.wfhStatus} onChange={(value) => updateFilter("wfhStatus", value)} options={["Todos", "Qualificado para Home", "Aguardando Validação", "Não Qualificado para Home", "Dados insuficientes", "Não aplicável"]} />
              </>
            ) : <div className="hidden lg:block lg:col-span-2 2xl:col-span-7" />}
            <div className="flex items-end justify-end gap-2 sm:col-span-2 lg:col-span-4 2xl:col-span-1">
              <button onClick={() => void loadPerformance()} className="inline-flex h-9 items-center gap-2 rounded-lg bg-navy-950 px-3 text-xs font-extrabold text-white">
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Atualizar
              </button>
              {visibleActiveTab === "wfh" && wfhPayload?.canExport ? <button onClick={exportPerformance} className="premium-control inline-flex h-9 items-center gap-2 px-3 text-xs font-extrabold text-navy-950"><Download className="h-4 w-4" /> Exportar</button> : null}
            </div>
          </div>
          {visibleActiveTab === "wfh" ? (
          <div className="mt-2 rounded-lg border border-dashed border-blue-200 bg-blue-50/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-black uppercase text-blue-700">Filtro em lote por WB/Login</p>
                <p className="text-xs font-semibold text-muted">Cole vários logins separados por linha, vírgula, ponto e vírgula, tab ou espaço.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setBatchWbOpen((current) => !current)} className="inline-flex h-8 items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 text-xs font-extrabold text-blue-700">
                  <Plus className="h-3.5 w-3.5" /> Adicionar múltiplos
                </button>
                {filters.wbLogins.length ? <button type="button" onClick={() => setFilters((current) => ({ ...current, wbLogins: [] }))} className="h-8 rounded-lg border border-border bg-white px-3 text-xs font-extrabold text-navy-950">Limpar todos</button> : null}
              </div>
            </div>
            {batchWbOpen ? (
              <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                <textarea value={batchWbText} onChange={(event) => setBatchWbText(event.target.value)} className="min-h-24 rounded-lg border border-border bg-white p-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" placeholder={"wb_joao01\nwb_maria02, wb_pedro03"} />
                <div className="flex items-end">
                  <button type="button" onClick={addPerformanceBatchWbs} className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-extrabold text-white">Aplicar lote</button>
                </div>
              </div>
            ) : null}
            {filters.wbLogins.length ? (
              <div className="mt-3 flex max-h-24 flex-wrap gap-2 overflow-y-auto pr-1">
                {filters.wbLogins.map((value) => (
                  <span key={value} className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-extrabold text-blue-700">
                    {value}
                    <button type="button" onClick={() => removePerformanceBatchWb(value)} className="text-blue-400 hover:text-red-600">×</button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          ) : null}
        </div>
      ) : null}

      {message ? <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{message}</div> : null}
      {loading ? <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">Carregando Performance...</div> : null}

      {minePayload ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Minha Qualidade" value={formatPerformancePercent(minePayload.summary.mine.quality)} helper={`${minePayload.summary.mine.qualityCorrect}/${minePayload.summary.mine.qualityTotal} tasks distintas`} icon={ShieldCheck} tone="green" />
            <StatCard title="Qualidade média LOB" value={formatPerformancePercent(minePayload.summary.lobAverage.quality)} helper="consolidado sem nomes" icon={UsersRound} tone="blue" />
            <StatCard title={mineUsesCpd ? "Meu CPD" : "Meu Submit/dia"} value={formatPerformanceNumber(minePayload.summary.mine.submit)} helper="média diária" icon={FileSpreadsheet} tone="purple" />
            <StatCard title={mineUsesCpd ? "CPD da LOB" : "Submit/dia LOB"} value={formatPerformanceNumber(minePayload.summary.lobAverage.submit)} helper="média diária da LOB" icon={ClipboardList} tone="cyan" />
            <StatCard title="Meu AHT" value={formatPerformanceAht(minePayload.summary.mine.ahtSeconds)} helper="moderação / submits" icon={Clock} tone="orange" />
            <StatCard title="AHT médio LOB" value={formatPerformanceAht(minePayload.summary.lobAverage.ahtSeconds)} helper="consolidado da LOB" icon={Target} tone="gold" />
            <StatCard title="Meu ABS" value={formatPerformancePercent(minePayload.summary.mine.abs)} helper={`${minePayload.summary.mine.absences}/${minePayload.summary.mine.scheduledDays} dias`} icon={AlertTriangle} tone={minePayload.summary.mine.abs > 0 ? "red" : "green"} />
            <StatCard title="ABS médio LOB" value={formatPerformancePercent(minePayload.summary.lobAverage.abs)} helper="faltas / escalas válidas" icon={CalendarCheck} tone="blue" />
          </div>

          {hasPerformanceData(minePayload.summary.mine) ? (
            <div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
              <Panel title="Minha evolução semanal">
                <div className="h-[290px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={minePayload.weekly}>
                      <CartesianGrid stroke="#E8EDF5" />
                      <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} />
                      <YAxis />
                      <Tooltip formatter={(value, name) => [formatPerformanceChartValue(Number(value), String(name)), performanceMetricLabel(String(name))]} />
                      <Line dataKey="quality" stroke="#10B981" strokeWidth={3} name="quality" />
                      <Line dataKey="abs" stroke="#EF4444" strokeWidth={3} name="abs" />
                      <Line dataKey="ahtSeconds" stroke="#F97316" strokeWidth={3} name="ahtSeconds" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
              <Panel title="Tabela semanal">
                <SimpleTable columns={["Semana", "Qualidade", mineUsesCpd ? "CPD" : "Submit/dia", "AHT", "ABS"]} rows={minePayload.summary.mine.weekly.map((week) => [week.weekLabel, formatPerformancePercent(week.quality), formatPerformanceNumber(week.submit), formatPerformanceAht(week.ahtSeconds), formatPerformancePercent(week.abs)])} />
              </Panel>
            </div>
          ) : (
            <EmptyState title="Ainda não há dados de performance para o período selecionado." description="Quando Qualidade, Produção e Cronograma estiverem disponíveis, seus indicadores aparecerão aqui." />
          )}
        </div>
      ) : null}

      {frameworkPayload ? (
        <div className="space-y-4">
          {frameworkPayload.sections.map((section) => (
            <Panel key={section.key} title={`Framework ${section.title}`}>
              <PerformanceFrameworkTable
                section={section}
                monthPeriods={frameworkPayload.monthPeriods}
                weekPeriods={frameworkPayload.weekPeriods}
              />
            </Panel>
          ))}
        </div>
      ) : null}

      {wfhPayload ? (
        <div className="space-y-3">
          <div className={cn("grid gap-2 sm:grid-cols-2 lg:grid-cols-4", isClientRole ? "2xl:grid-cols-5" : "2xl:grid-cols-7")}>
            <PerformanceMetricCard title="Qualidade média" value={formatPerformancePercent(wfhPayload.summary.quality)} helper={`${wfhPayload.summary.qualityCorrect}/${wfhPayload.summary.qualityTotal} tasks`} icon={ShieldCheck} tone="green" />
            <PerformanceMetricCard title="AHT médio" value={formatPerformanceAht(wfhPayload.summary.ahtSeconds)} helper="moderação / submit" icon={Clock} tone="orange" />
            <PerformanceMetricCard title={wfhUsesCpd ? "CPD médio" : "Submit diário"} value={formatPerformanceNumber(wfhPayload.summary.submit)} helper="média diária" icon={FileSpreadsheet} tone="purple" />
            <PerformanceMetricCard title="ABS médio" value={formatPerformancePercent(wfhPayload.summary.abs)} helper={`${wfhPayload.summary.absences}/${wfhPayload.summary.scheduledDays} dias`} icon={AlertTriangle} tone={wfhPayload.summary.abs > 0 ? "red" : "green"} />
            <PerformanceMetricCard title="Agentes com dados" value={wfhPayload.summary.agentsWithData} helper="base filtrada" icon={UsersRound} tone="blue" />
            {!isClientRole ? <PerformanceMetricCard title="Linhas importadas" value={formatPerformanceNumber(wfhPayload.summary.importedRows)} helper="últimos lotes" icon={Upload} tone="cyan" /> : null}
            {!isClientRole ? <PerformanceMetricCard title="Última importação" value={wfhPayload.summary.lastImport || "-"} helper="Qualidade ou produção" icon={CalendarDays} tone="gold" /> : null}
          </div>

          <Panel title="Ranking de Agentes">
            {wfhPayload.ranking.length ? (
              <PerformanceRankingTable rows={wfhPayload.ranking} sort={performanceSort} onSort={updatePerformanceSort} onSelect={setSelectedAgent} />
            ) : (
              <EmptyState title="Nenhum dado importado ainda." description="Importe uma base de Qualidade ou Produção para visualizar os indicadores." />
            )}
          </Panel>

          {!embeddedWfh ? (
            <>
              {wfhPayload.canImport ? (
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <PerformanceImportPanel
                title="Upload de Qualidade ADS"
                description="final_result, case_order_id e audit_case_order_id."
                inputRef={qualityInputRef}
                loading={importing === "quality"}
                onTemplate={() => void downloadFile("/api/performance/template?type=quality", "template_performance_qualidade.xlsx").catch((error) => setMessage(error instanceof Error ? error.message : "Não foi possível baixar o template."))}
                onFile={(file) => void previewPerformanceFile("quality", file)}
              />
              <PerformanceImportPanel
                title="Upload de Qualidade TNS"
                description="Sampling, Mislabeled, Leakage e False Positive."
                inputRef={tnsQualityInputRef}
                loading={importing === "tns-quality"}
                onTemplate={() => void downloadFile("/api/performance/template?type=tns-quality", "template_performance_qualidade_tns.xlsx").catch((error) => setMessage(error instanceof Error ? error.message : "Não foi possível baixar o template."))}
                onFile={(file) => void previewPerformanceFile("tns-quality", file)}
              />
              <PerformanceImportPanel
                title="Upload de Qualidade CEC"
                description="WB, Week, Pass Quantity e Fail Quantity."
                inputRef={cecQualityInputRef}
                loading={importing === "cec-quality"}
                extra={(
                  <FormInput
                    label="Ano de referência"
                    type="number"
                    value={cecQualityYear}
                    onChange={setCecQualityYear}
                  />
                )}
                onTemplate={() => void downloadFile("/api/performance/template?type=cec-quality", "template_performance_qualidade_cec.xlsx").catch((error) => setMessage(error instanceof Error ? error.message : "Não foi possível baixar o template."))}
                onFile={(file) => void previewPerformanceFile("cec-quality", file)}
              />
              <PerformanceImportPanel
                title="Upload de Produção, AHT e Volume"
                description="BZ_time, submit_num, queue_id, Moderation e Agentes."
                inputRef={productionInputRef}
                loading={importing === "production"}
                onTemplate={() => void downloadFile("/api/performance/template?type=production", "template_performance_producao.xlsx").catch((error) => setMessage(error instanceof Error ? error.message : "Não foi possível baixar o template."))}
                onFile={(file) => void previewPerformanceFile("production", file)}
              />
                </div>
              ) : null}

              <div className={cn("grid gap-3", isClientRole ? "xl:grid-cols-1" : "xl:grid-cols-[minmax(0,1fr)_420px]")}>
                <Panel title="Detalhamento Individual">
              {selectedAgent ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-extrabold text-navy-950">{selectedAgent.employeeName}</p>
                        <p className="text-xs font-bold text-blue-700">{selectedAgent.wbLogin} · {selectedAgent.lob} · {performanceQualityRuleLabel(selectedAgent.qualityRule)} · {selectedAgent.supervisor}</p>
                      </div>
                      <PerformanceWfhBadge status={selectedAgent.wfhStatus} label={selectedAgent.wfhStatusLabel} title={selectedAgent.wfhReasons.join(" | ")} />
                    </div>
                    <p className="mt-2 text-xs font-bold text-muted">Status: {selectedAgent.employeeStatus || "-"} · {isCecPerformanceRule(selectedAgent.qualityRule) ? "CPD" : "Submit médio/dia"}: {formatPerformanceNumber(selectedAgent.submitAveragePerDay)} · Monitoramento: {selectedAgent.wfhMonitoringLabel}</p>
                    {selectedAgent.wfhReasons.length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {selectedAgent.wfhReasons.map((reason) => <span key={reason} className="rounded-full border border-blue-100 bg-white px-2 py-1 text-[11px] font-bold text-navy-700">{reason}</span>)}
                      </div>
                    ) : null}
                  </div>
                  <SimpleTable
                    columns={["Semana", "Regra", "Qualidade", isCecPerformanceRule(selectedAgent.qualityRule) ? "CPD" : "Submit/dia", "AHT", "ABS"]}
                    rows={selectedAgent.weekly.map((week) => [
                      week.weekLabel,
                      performanceQualityRuleLabel(week.qualityRule),
                      <PerformanceMetricBadge key={`${week.weekStart}-quality`} metric="quality" metrics={week} />,
                      <PerformanceMetricBadge key={`${week.weekStart}-submit`} metric="submit" metrics={week} />,
                      <PerformanceMetricBadge key={`${week.weekStart}-aht`} metric="aht" metrics={week} />,
                      <PerformanceMetricBadge key={`${week.weekStart}-abs`} metric="abs" metrics={week} />
                    ])}
                  />
                </div>
              ) : (
                <EmptyState title="Selecione um agente" description="Clique em um nome do ranking para abrir o histórico semanal individual." />
              )}
                </Panel>
                {!isClientRole ? <Panel title="Histórico de Importações">
              {wfhPayload.imports.length ? (
                <div className="space-y-2">
                  {wfhPayload.imports.map((item) => (
                    <div key={item.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-extrabold text-navy-950" title={item.fileName}>{item.fileName}</p>
                          <p className="text-xs font-bold text-muted">{performanceImportBatchLabel(item.type)} · {item.importedAt}</p>
                        </div>
                        <StatusBadge status={item.status} />
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs font-bold text-muted">
                        <span>Válidas: <b className="text-navy-950">{item.rowsValid}</b></span>
                        <span>Novas: <b className="text-navy-950">{item.rowsInserted}</b></span>
                        <span>Atual.: <b className="text-navy-950">{item.rowsUpdated}</b></span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="Sem importações" description="O histórico aparecerá após o primeiro commit de Qualidade ou Produção." />
              )}
                </Panel> : null}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {qualityPreview ? (
        <PerformancePreviewModal title="Preview da base de Qualidade" fileName={qualityFileName} preview={qualityPreview} importing={importing === "quality"} onClose={() => setQualityPreview(null)} onCommit={() => void commitPerformanceImport("quality")} />
      ) : null}
      {tnsQualityPreview ? (
        <PerformancePreviewModal title="Preview da base de Qualidade TNS" fileName={tnsQualityFileName} preview={tnsQualityPreview} importing={importing === "tns-quality"} onClose={() => setTnsQualityPreview(null)} onCommit={() => void commitPerformanceImport("tns-quality")} />
      ) : null}
      {cecQualityPreview ? (
        <PerformancePreviewModal title="Preview da base de Qualidade CEC" fileName={cecQualityFileName} preview={cecQualityPreview} importing={importing === "cec-quality"} onClose={() => setCecQualityPreview(null)} onCommit={() => void commitPerformanceImport("cec-quality")} />
      ) : null}
      {productionPreview ? (
        <PerformancePreviewModal title="Preview da base de Produção" fileName={productionFileName} preview={productionPreview} importing={importing === "production"} onClose={() => setProductionPreview(null)} onCommit={() => void commitPerformanceImport("production")} />
      ) : null}
    </div>
  );
}


function PerformanceMetricCard({ title, value, helper, icon: Icon, tone }: { title: string; value: string | number; helper: string; icon: LucideIcon; tone: string }) {
  const toneClass = performanceToneClass(tone);
  return (
    <div className="rounded-lg border border-border bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-extrabold uppercase tracking-wide text-muted">{title}</p>
          <p className="mt-1 truncate text-xl font-black text-navy-950" title={String(value)}>{value}</p>
        </div>
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", toneClass)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-1 truncate text-[11px] font-bold text-muted" title={helper}>{helper}</p>
    </div>
  );
}


function performanceToneClass(tone: string) {
  const map: Record<string, string> = {
    green: "bg-emerald-50 text-emerald-600",
    blue: "bg-blue-50 text-blue-600",
    purple: "bg-purple-50 text-purple-600",
    cyan: "bg-cyan-50 text-cyan-600",
    orange: "bg-orange-50 text-orange-600",
    gold: "bg-amber-50 text-amber-600",
    red: "bg-red-50 text-red-600"
  };
  return map[tone] ?? "bg-slate-50 text-slate-600";
}


function PerformanceFrameworkTable({
  section,
  monthPeriods,
  weekPeriods
}: {
  section: PerformanceFrameworkResponse["sections"][number];
  monthPeriods: PerformanceFrameworkResponse["monthPeriods"];
  weekPeriods: PerformanceFrameworkResponse["weekPeriods"];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1180px] table-fixed border-separate border-spacing-0 text-center text-sm">
        <colgroup>
          <col className="w-[210px]" />
          {monthPeriods.map((period) => <col key={`month-${period.key}`} className="w-[86px]" />)}
          <col className="w-[78px]" />
          <col className="w-[86px]" />
          {weekPeriods.map((period) => <col key={`week-${period.key}`} className="w-[142px]" />)}
        </colgroup>
        <thead>
          <tr className="bg-slate-100 text-xs font-black uppercase tracking-wide text-muted">
            <th className="rounded-l-lg px-3 py-3 text-center">KPI</th>
            {monthPeriods.map((period) => <th key={period.key} className="px-3 py-3 text-center">{period.label}</th>)}
            <th className="px-3 py-3 text-center">Status</th>
            <th className="px-3 py-3 text-center">Target</th>
            {weekPeriods.map((period) => <th key={period.key} className="px-3 py-3 text-center">{period.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {section.rows.map((row, index) => (
            <tr key={row.key} className={cn(index % 2 === 0 ? "bg-white" : "bg-slate-50/70")}>
              <td className="border-b border-border px-3 py-3 text-center font-extrabold text-navy-950">{row.label}</td>
              {monthPeriods.map((period) => (
                <td key={period.key} className="border-b border-border px-3 py-3 text-center font-bold text-navy-900">{formatPerformanceFrameworkValue(row.values[period.key], row.kind)}</td>
              ))}
              <td className="border-b border-border px-3 py-3 text-center"><PerformanceFrameworkStatusBadge status={row.status} /></td>
              <td className="border-b border-border px-3 py-3 text-center font-bold text-muted">{row.targetLabel || "-"}</td>
              {weekPeriods.map((period) => (
                <td key={period.key} className="border-b border-border px-3 py-3 text-center font-bold text-navy-900">{formatPerformanceFrameworkValue(row.values[period.key], row.kind)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


function PerformanceFrameworkStatusBadge({ status }: { status: PerformanceFrameworkStatus }) {
  if (status === "ok") {
    return <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2 className="h-4 w-4" /></span>;
  }
  if (status === "fail") {
    return <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-red-100 text-red-700"><XCircle className="h-4 w-4" /></span>;
  }
  return <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-slate-100 px-2 text-xs font-black text-muted">-</span>;
}


function PerformanceWfhBadge({ status, label, title }: { status: WfhEligibilityClientStatus; label: string; title?: string }) {
  const className = status === "QUALIFIED"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : status === "NOT_APPLICABLE"
      ? "border-slate-200 bg-slate-50 text-slate-600"
      : status === "INSUFFICIENT_DATA" || status === "PENDING_VALIDATION"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-red-200 bg-red-50 text-red-700";
  return (
    <span title={title} className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-extrabold", className)}>
      {label}
    </span>
  );
}


function PerformanceMetricBadge({ metric, metrics }: { metric: PerformanceMetricKind; metrics: PerformanceMetricSummary }) {
  const assessment = assessPerformanceMetric(metric, metrics);
  const className = assessment.status === "PASS"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : assessment.status === "FAIL"
      ? "border-red-200 bg-red-50 text-red-700"
      : assessment.status === "MISSING"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <span title={assessment.title} className={cn("inline-flex min-w-[76px] items-center justify-center rounded-full border px-2.5 py-1 text-[11px] font-extrabold", className)}>
      {formatPerformanceMetricForBadge(metric, metrics)}
    </span>
  );
}


function PerformanceRankingTable({ rows, sort, onSort, onSelect }: { rows: AgentPerformanceClient[]; sort: PerformanceSortState; onSort: (by: PerformanceSortableMetric) => void; onSelect: (row: AgentPerformanceClient) => void }) {
  const columns: Array<{ key: string; label: string; sortBy?: PerformanceSortableMetric; align?: "right" }> = [
    { key: "agent", label: "Agente" },
    { key: "wb", label: "WB/Login" },
    { key: "lob", label: "LOB" },
    { key: "wfh", label: "WFH" },
    { key: "rule", label: "Regra" },
    { key: "supervisor", label: "Supervisor" },
    { key: "quality", label: "Qualidade", sortBy: "quality", align: "right" },
    { key: "submit", label: "Produtividade", sortBy: "submit", align: "right" },
    { key: "aht", label: "AHT", sortBy: "aht", align: "right" },
    { key: "abs", label: "ABS", sortBy: "abs", align: "right" }
  ];

  return (
    <div className="overflow-auto rounded-xl border border-border">
      <table className="w-full min-w-[1120px] text-sm">
        <thead className="sticky top-0 bg-white text-left text-[11px] font-extrabold uppercase text-muted">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={cn("px-3 py-2", column.align === "right" && "text-right")}>
                {column.sortBy ? (
                  <button onClick={() => onSort(column.sortBy!)} className={cn("inline-flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-blue-50 hover:text-blue-700", column.align === "right" && "justify-end")}>
                    {column.label}
                    {sort.by === column.sortBy ? (sort.direction === "desc" ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />) : <span className="h-3.5 w-3.5" />}
                  </button>
                ) : column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((agent) => (
            <tr key={agent.employeeId} className="border-t border-slate-100">
              <td className="px-3 py-2">
                <button onClick={() => onSelect(agent)} className="max-w-[190px] truncate font-extrabold text-blue-700" title={agent.employeeName}>{agent.employeeName}</button>
              </td>
              <td className="px-3 py-2 font-bold text-navy-950">{agent.wbLogin}</td>
              <td className="px-3 py-2">{agent.lob}</td>
              <td className="px-3 py-2"><PerformanceWfhBadge status={agent.wfhStatus} label={agent.wfhStatusLabel} title={agent.wfhReasons.join(" | ")} /></td>
              <td className="px-3 py-2">{performanceQualityRuleLabel(agent.qualityRule)}</td>
              <td className="max-w-[180px] truncate px-3 py-2" title={agent.supervisor}>{agent.supervisor}</td>
              <td className="px-3 py-2 text-right"><PerformanceMetricBadge metric="quality" metrics={agent} /></td>
              <td className="px-3 py-2 text-right"><PerformanceMetricBadge metric="submit" metrics={agent} /></td>
              <td className="px-3 py-2 text-right"><PerformanceMetricBadge metric="aht" metrics={agent} /></td>
              <td className="px-3 py-2 text-right"><PerformanceMetricBadge metric="abs" metrics={agent} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


function PerformanceSelect({ label, value, options, optionLabel, onChange }: { label: string; value: string; options: string[]; optionLabel?: (value: string) => string; onChange: (value: string) => void }) {
  return (
    <label className="text-xs font-bold text-muted">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="premium-control mt-1 h-9 w-full px-3 text-sm font-bold text-navy-950">
        {options.map((option) => <option key={option} value={option}>{optionLabel?.(option) ?? option}</option>)}
      </select>
    </label>
  );
}


function PerformanceImportPanel({ title, description, inputRef, loading, extra, onTemplate, onFile }: { title: string; description: string; inputRef: { current: HTMLInputElement | null }; loading: boolean; extra?: ReactNode; onTemplate: () => void; onFile: (file?: File | null) => void }) {
  return (
    <div className="rounded-lg border border-border bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold text-navy-950">{title}</p>
          <p className="mt-1 line-clamp-2 text-xs font-semibold text-muted">{description}</p>
        </div>
        <Upload className="h-4 w-4 shrink-0 text-blue-600" />
      </div>
      {extra ? <div className="mt-3">{extra}</div> : null}
      <input ref={(element) => { inputRef.current = element; }} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => onFile(event.target.files?.[0])} />
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={onTemplate} className="premium-control inline-flex h-8 items-center gap-2 px-2.5 text-xs font-extrabold text-navy-950"><Download className="h-3.5 w-3.5" /> Template</button>
        <button disabled={loading} onClick={() => inputRef.current?.click()} className="inline-flex h-8 items-center gap-2 rounded-lg bg-blue-600 px-2.5 text-xs font-extrabold text-white disabled:opacity-60"><Upload className="h-3.5 w-3.5" /> {loading ? "Validando..." : "Importar XLSX"}</button>
      </div>
    </div>
  );
}


function PerformancePreviewModal({ title, fileName, preview, importing, onClose, onCommit }: { title: string; fileName: string; preview: PerformancePreviewResponse; importing: boolean; onClose: () => void; onCommit: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/45 p-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-extrabold text-navy-950">{title}</h2>
            <p className="text-sm font-semibold text-muted">{fileName || "Arquivo importado"} · {preview.summary.totalRows} linha(s)</p>
          </div>
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-sm font-bold text-navy-950">Fechar</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid gap-3 md:grid-cols-6 xl:grid-cols-7">
            <MetricPill value={preview.summary.validRows} label="Linhas válidas" />
            <MetricPill value={preview.summary.errorRows} label="Com erro" />
            <MetricPill value={preview.summary.warningRows} label="Alertas" />
            <MetricPill value={preview.summary.createdRows} label="Novos" />
            <MetricPill value={preview.summary.updatedRows} label="Atualizações" />
            {preview.summary.expandedRows ? <MetricPill value={preview.summary.expandedRows} label="Registros gerados" /> : null}
            <MetricPill value={preview.summary.missingEmployees} label="WB/Login ausente" />
          </div>
          <ImportIssueSummary rows={preview.rows.map((row) => ({ rowNumber: row.rowNumber, errors: row.errors, warnings: row.warnings }))} />
          <div className="mt-4 max-h-[52vh] overflow-auto rounded-xl border border-border">
            <table className="w-full min-w-[1080px] text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs font-extrabold uppercase text-muted">
                <tr>{["Linha", "WB/Login", "Parceiro", "LOB", "Data", "Identificador", "Ação", "Erros/alertas"].map((column) => <th key={column} className="px-3 py-2">{column}</th>)}</tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, IMPORT_PREVIEW_ROW_LIMIT).map((row) => (
                  <tr key={row.rowNumber} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-bold">{row.rowNumber}</td>
                    <td className="px-3 py-2">{row.wbLogin || "-"}</td>
                    <td className="px-3 py-2">{row.employeeName || "-"}</td>
                    <td className="px-3 py-2">{row.lob || "-"}</td>
                    <td className="px-3 py-2">{row.date || "-"}</td>
                    <td className="max-w-[220px] truncate px-3 py-2" title={row.uniqueKey}>{row.uniqueKey || "-"}</td>
                    <td className="px-3 py-2"><StatusBadge status={row.action === "update" ? "Atualizar" : row.action === "create" ? "Criar" : "Ignorar"} /></td>
                    <td className={cn("px-3 py-2 text-xs font-bold", row.errors.length ? "text-red-600" : row.warnings.length ? "text-amber-600" : "text-muted")}>{[...row.errors, ...row.warnings].join(" | ") || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.summary.totalRows > preview.rows.length ? <p className="mt-2 text-xs font-bold text-muted">Exibindo amostra de {preview.rows.length} linha(s) de {preview.summary.totalRows}. A confirmação processa todas as linhas válidas em blocos pequenos.</p> : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button onClick={onClose} className="premium-control h-9 px-4 text-sm font-extrabold text-navy-950">Cancelar</button>
          <button disabled={Boolean(preview.summary.errorRows) || importing} onClick={onCommit} className="h-9 rounded-lg bg-navy-950 px-4 text-sm font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-50">Confirmar importação</button>
        </div>
      </div>
    </div>
  );
}


async function readPerformanceWorkbookRows(file: File, type: PerformanceImportKind) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const preferredSheets = type === "quality"
    ? ["qualidade", "quality"]
    : type === "tns-quality"
      ? ["qualidade_tns", "qualidade tns", "tns quality", "quality tns", "tns"]
      : type === "cec-quality"
        ? ["planilha1", "qualidade cec", "qualidade_cec", "cec quality", "quality cec", "cec"]
        : ["producao", "produção", "production"];
  const sheetName = workbook.SheetNames.find((name) => preferredSheets.includes(normalizePerformanceSheetName(name))) ?? workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) throw new Error(type === "quality" ? "Planilha de Qualidade não encontrada." : type === "tns-quality" ? "Planilha de Qualidade TNS não encontrada." : type === "cec-quality" ? "Planilha de Qualidade CEC não encontrada." : "Planilha de Produção não encontrada.");
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
}


function performanceImportLabel(type: PerformanceImportKind) {
  if (type === "quality") return "Qualidade ADS";
  if (type === "tns-quality") return "Qualidade TNS";
  if (type === "cec-quality") return "Qualidade CEC";
  return "Produção";
}


function performanceImportBatchLabel(type: string) {
  if (type === "QUALITY") return "Qualidade ADS";
  if (type === "TNS_QUALITY") return "Qualidade TNS";
  if (type === "CEC_QUALITY") return "Qualidade CEC";
  if (type === "PRODUCTION") return "Produção";
  return type;
}


function performanceQualityRuleLabel(rule?: string) {
  if (rule === "ADS_QUALITY") return "ADS";
  if (rule === "TNS_QUALITY") return "TNS";
  if (rule === "CEC_QUALITY") return "CEC";
  if (rule === "MIXED") return "Mista";
  return "Sem regra";
}


function isCecPerformanceRule(rule?: string) {
  return rule === "CEC_QUALITY";
}


function assessPerformanceMetric(metric: PerformanceMetricKind, metrics: PerformanceMetricSummary): PerformanceMetricAssessment {
  const targets = performanceTargetsForRule(metrics.qualityRule);
  if (!targets) return { status: "NEUTRAL", title: "Regra de meta não configurada para esta operação." };
  if (metric === "quality") {
    if (metrics.qualityDenominator <= 0) return { status: "MISSING", title: "Sem base de qualidade para avaliar a meta." };
    return metrics.quality >= targets.quality
      ? { status: "PASS", title: `Dentro da meta: qualidade >= ${targets.quality}%.` }
      : { status: "FAIL", title: `Fora da meta: qualidade precisa ser >= ${targets.quality}%.` };
  }
  if (metric === "submit") {
    const productivityUnit = isCecPerformanceRule(metrics.qualityRule) ? "CPD" : "por dia";
    return metrics.submit >= targets.submit
      ? { status: "PASS", title: `Dentro da meta: produtividade >= ${targets.submit} ${productivityUnit}.` }
      : { status: "FAIL", title: `Fora da meta: produtividade precisa ser >= ${targets.submit} ${productivityUnit}.` };
  }
  if (metric === "aht") {
    if (targets.ahtSeconds == null) return { status: "NEUTRAL", title: "AHT não é critério de classificação para esta operação." };
    return metrics.ahtSeconds <= targets.ahtSeconds
      ? { status: "PASS", title: `Dentro da meta: AHT <= ${targets.ahtSeconds}s.` }
      : { status: "FAIL", title: `Fora da meta: AHT precisa ser <= ${targets.ahtSeconds}s.` };
  }
  return metrics.abs <= targets.abs
    ? { status: "PASS", title: `Dentro da meta: ABS <= ${targets.abs}%. ABS 0% é válido e positivo.` }
    : { status: "FAIL", title: `Fora da meta: ABS precisa ser <= ${targets.abs}%.` };
}


function performanceTargetsForRule(rule?: string): null | { quality: number; submit: number; ahtSeconds?: number; abs: number } {
  if (rule === "CEC_QUALITY") return { quality: 95, submit: 60, abs: 5 };
  if (rule === "TNS_QUALITY") return { quality: 98, submit: 350, ahtSeconds: 60, abs: 5 };
  if (rule === "ADS_QUALITY") return { quality: 95, submit: 350, ahtSeconds: 60, abs: 5 };
  return null;
}


function formatPerformanceMetricForBadge(metric: PerformanceMetricKind, metrics: PerformanceMetricSummary) {
  if (metric === "quality") return formatPerformancePercent(metrics.quality);
  if (metric === "submit") return isCecPerformanceRule(metrics.qualityRule) ? `${formatPerformanceNumber(metrics.submit)} CPD` : `${formatPerformanceNumber(metrics.submit)}/dia`;
  if (metric === "aht") return formatPerformanceAht(metrics.ahtSeconds);
  return formatPerformancePercent(metrics.abs);
}


function emptyPerformancePreview(): PerformancePreviewResponse {
  return {
    success: true,
    rows: [],
    summary: {
      totalRows: 0,
      validRows: 0,
      errorRows: 0,
      warningRows: 0,
      createdRows: 0,
      updatedRows: 0,
      expandedRows: 0,
      foundEmployees: 0,
      missingEmployees: 0,
      missingWbLogins: []
    }
  };
}


function mergePerformancePreview(current: PerformancePreviewResponse, next: PerformancePreviewResponse): PerformancePreviewResponse {
  const missingWbLogins = Array.from(new Set([...current.summary.missingWbLogins, ...next.summary.missingWbLogins]));
  return {
    success: current.success && next.success,
    rows: [...current.rows, ...next.rows].slice(0, IMPORT_PREVIEW_ROW_LIMIT),
    summary: {
      totalRows: current.summary.totalRows + next.summary.totalRows,
      validRows: current.summary.validRows + next.summary.validRows,
      errorRows: current.summary.errorRows + next.summary.errorRows,
      warningRows: current.summary.warningRows + next.summary.warningRows,
      createdRows: current.summary.createdRows + next.summary.createdRows,
      updatedRows: current.summary.updatedRows + next.summary.updatedRows,
      expandedRows: current.summary.expandedRows + next.summary.expandedRows,
      foundEmployees: current.summary.foundEmployees + next.summary.foundEmployees,
      missingEmployees: missingWbLogins.length,
      missingWbLogins
    }
  };
}


type PerformanceMetricSummary = {
  quality: number;
  qualityRule: string;
  qualityNumerator: number;
  qualityDenominator: number;
  qualityErrors: number;
  qualityCorrect: number;
  qualityTotal: number;
  submit: number;
  submitTotal: number;
  ahtSeconds: number;
  moderationSeconds: number;
  abs: number;
  absences: number;
  unjustifiedAbsences: number;
  scheduledDays: number;
};


type PerformanceWeeklyMetric = PerformanceMetricSummary & {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  lobAverage?: PerformanceMetricSummary;
  operationAverage?: PerformanceMetricSummary;
};


type WfhEligibilityClientStatus = "QUALIFIED" | "PENDING_VALIDATION" | "NOT_QUALIFIED" | "NOT_APPLICABLE" | "INSUFFICIENT_DATA";

type WfhMonitoringClientStatus = "NOT_MONITORED" | "AT_RISK" | "RETURN_REQUIRED";


type AgentPerformanceClient = PerformanceMetricSummary & {
  employeeId: string;
  employeeName: string;
  wbLogin: string;
  lob: string;
  supervisor: string;
  roleTitle: string;
  skill: string;
  employeeStatus: string;
  wfhStatus: WfhEligibilityClientStatus;
  wfhStatusLabel: string;
  wfhMonitoringStatus: WfhMonitoringClientStatus;
  wfhMonitoringLabel: string;
  wfhRule: string;
  submitAveragePerDay: number;
  wfhFailedCriteria: string[];
  wfhReasons: string[];
  weekly: PerformanceWeeklyMetric[];
};


type PerformanceMineResponse = {
  mode: "mine";
  canAccessWfh: boolean;
  period: { startDate: string; endDate: string };
  summary: {
    mine: AgentPerformanceClient;
    lobAverage: PerformanceMetricSummary;
    operationAverage: PerformanceMetricSummary;
  };
  weekly: PerformanceWeeklyMetric[];
};


type PerformanceWfhResponse = {
  mode: "wfh";
  canImport: boolean;
  canExport: boolean;
  period: { startDate: string; endDate: string };
  summary: PerformanceMetricSummary & {
    agentsWithData: number;
    importedRows: number;
    lastImport: string;
  };
  ranking: AgentPerformanceClient[];
  weekly: PerformanceWeeklyMetric[];
  filters: {
    lobs: string[];
    skills: string[];
    roles: string[];
    supervisors: Array<{ id: string; name: string }>;
    employees: Array<{ id: string; name: string; wbLogin: string }>;
    batchWb?: { applied: string[]; notFound: string[]; duplicatesRemoved: number };
  };
  imports: Array<{
    id: string;
    type: string;
    fileName: string;
    rowsTotal: number;
    rowsValid: number;
    rowsError: number;
    rowsInserted: number;
    rowsUpdated: number;
    status: string;
    importedBy: string;
    importedAt: string;
  }>;
};


type PerformanceFrameworkMetricKind = "number" | "percent" | "seconds" | "minutes" | "hours";

type PerformanceFrameworkStatus = "ok" | "fail" | "neutral";


type PerformanceFrameworkResponse = {
  mode: "framework";
  period: { startDate: string; endDate: string };
  referenceDate: string;
  monthPeriods: Array<{ key: string; label: string }>;
  weekPeriods: Array<{ key: string; label: string }>;
  summary: { ok: number; fail: number; pending: number };
  sections: Array<{
    key: string;
    title: string;
    rows: Array<{
      key: string;
      label: string;
      kind: PerformanceFrameworkMetricKind;
      target: number | null;
      targetLabel: string;
      direction: "gte" | "lte" | null;
      status: PerformanceFrameworkStatus;
      values: Record<string, number | null>;
    }>;
  }>;
};


type PerformanceProductionSummary = {
  records: number;
  input: number;
  submit: number;
  moderationSeconds: number;
  moderationHours: number;
  ahtSeconds: number;
  latencyMinutes: number;
};


type PerformanceProductionGranularity = "hourly" | "daily" | "weekly" | "monthly";


type PerformanceProductionResponse = {
  mode: "production";
  granularity: PerformanceProductionGranularity;
  period: { startDate: string; endDate: string };
  panel: {
    dataRange: null | { startDate: string; endDate: string };
    lastDataAt: string | null;
    lastImport: null | {
      fileName: string;
      importedAt: string;
      rowsValid: number;
      rowsError: number;
      status: string;
      ageHours: number | null;
    };
    staleThresholdHours: number;
    isStale: boolean;
    totalRows: number;
    totalQueueIds: number;
    mappedQueueIds: number;
    unmappedQueues: Array<{
      queueId: string;
      productionRows: number;
      volumeRows: number;
      lastSeenAt: string | null;
    }>;
    alerts: Array<{ type: "OK" | "WARNING" | "CRITICAL"; title: string; description: string }>;
  };
  filters: { lobs: string[] };
  summary: PerformanceProductionSummary & {
    agents: number;
    queues: number;
    comparison: null | {
      currentLabel: string;
      previousLabel: string;
      inputDelta: number;
      submitDelta: number;
      moderationHoursDelta: number;
      ahtSecondsDelta: number;
      latencyMinutesDelta: number;
    };
    lastImport: null | {
      fileName: string;
      importedAt: string;
      rowsValid: number;
      status: string;
    };
  };
  trend: Array<PerformanceProductionSummary & { key: string; label: string }>;
  agents: Array<PerformanceProductionSummary & {
    employeeId: string;
    employeeName: string;
    wbLogin: string;
    cadastroLob: string;
    queueLobs: string;
    supervisor: string;
    roleTitle: string;
    skill: string;
    status: string;
    queueCount: number;
  }>;
  queues: Array<PerformanceProductionSummary & {
    queueId: string;
    queueName: string;
    lob: string;
    slaTargetMinutes: number | null;
    agents: number;
  }>;
};


type PerformanceDashboardResponse = PerformanceMineResponse | PerformanceWfhResponse | PerformanceFrameworkResponse | PerformanceProductionResponse;


type PerformanceImportKind = "quality" | "tns-quality" | "cec-quality" | "production";

type PerformanceSortableMetric = "quality" | "submit" | "aht" | "abs";

type PerformanceSortState = { by: "" | PerformanceSortableMetric; direction: "asc" | "desc" };

type PerformanceMetricKind = "quality" | "submit" | "aht" | "abs";

type PerformanceMetricAssessment = { status: "PASS" | "FAIL" | "MISSING" | "NEUTRAL"; title: string };


type PerformancePreviewResponse = {
  success: boolean;
  rows: Array<{
    rowNumber: number;
    type: "QUALITY" | "TNS_QUALITY" | "CEC_QUALITY" | "PRODUCTION" | "PRODUCTION_VOLUME";
    wbLogin: string;
    employeeId?: string;
    employeeName?: string;
    lob?: string;
    lobId?: string;
    date: string;
    uniqueKey: string;
    action: "create" | "update" | "ignore";
    errors: string[];
    warnings: string[];
    payload: Record<string, unknown>;
  }>;
  summary: {
    totalRows: number;
    validRows: number;
    errorRows: number;
    warningRows: number;
    createdRows: number;
    updatedRows: number;
    expandedRows: number;
    foundEmployees: number;
    missingEmployees: number;
    missingWbLogins: string[];
  };
};


function hasPerformanceData(metrics: PerformanceMetricSummary) {
  return metrics.qualityTotal > 0 || metrics.submit > 0 || metrics.scheduledDays > 0;
}


function formatPerformancePercent(value: number) {
  return `${Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: Number.isInteger(value) ? 0 : 1, maximumFractionDigits: 1 })}%`;
}


function formatPerformanceNumber(value: number) {
  return Number(value || 0).toLocaleString("pt-BR");
}


function formatPerformanceAht(seconds: number) {
  const total = Math.round(Number(seconds || 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes > 0 ? `${minutes}:${String(rest).padStart(2, "0")}` : `${rest}s`;
}


function formatPerformanceFrameworkValue(value: number | null | undefined, kind: PerformanceFrameworkMetricKind) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  if (kind === "percent") return formatPerformancePercent(Number(value));
  if (kind === "number") return formatPerformanceNumber(Number(value));
  if (kind === "seconds") return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  if (kind === "minutes") return `${formatPerformanceFrameworkUnitNumber(Number(value))} min`;
  if (kind === "hours") return `${formatPerformanceFrameworkUnitNumber(Number(value))} h`;
  return String(value);
}


function formatPerformanceFrameworkUnitNumber(value: number) {
  const hasFraction = Math.abs(value % 1) > 0.005;
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2
  });
}


function performanceMetricLabel(key: string) {
  const map: Record<string, string> = { quality: "Qualidade", submit: "Submit/dia", ahtSeconds: "AHT", abs: "ABS" };
  return map[key] ?? key;
}


function formatPerformanceChartValue(value: number, key: string) {
  if (key === "quality" || key === "abs") return formatPerformancePercent(value);
  if (key === "ahtSeconds") return formatPerformanceAht(value);
  return formatPerformanceNumber(value);
}
