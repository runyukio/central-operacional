"use client";

import { Download, ExternalLink, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, Panel } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { siteClassifications, siteClassificationLabels, type SiteClassification } from "@/lib/workstation-site-classification";
import type { SiteUsage } from "@/lib/workstation-sites-service";
import { activityWindowIncludesToday } from "@/lib/activity-refresh";

type HubData = {
  sites: SiteUsage[];
  summary: { totalSeconds: number; productiveSeconds: number; unproductiveSeconds: number; unclassifiedSeconds: number; domains: number };
};

export function SiteClassificationBadge({ classification = "UNCLASSIFIED" }: { classification?: SiteClassification }) {
  return <span className={cn("inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold",
    classification === "PRODUCTIVE" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : classification === "UNPRODUCTIVE" ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-slate-50 text-slate-600")}>{siteClassificationLabels[classification]}</span>;
}

export function WorkstationSitesHub({ date, lob, shift, agentKey, refresh, onClassified, onFilterOptions }: {
  date: string; lob: string; shift: string; agentKey?: string; refresh: number;
  onClassified: (domain: string, classification: SiteClassification) => void;
  onFilterOptions: (options: { lobs: string[]; shifts: string[] }) => void;
}) {
  const [startDate, setStartDate] = useState(date);
  const [endDate, setEndDate] = useState(date);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [classification, setClassification] = useState("");
  const [data, setData] = useState<HubData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const requestGeneration = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setStartDate(date); setEndDate(date); }, [date]);
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(search), 300); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden && activityWindowIncludesToday(startDate, endDate)) setRevision((value) => value + 1);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [startDate, endDate]);
  const params = useMemo(() => {
    const value = new URLSearchParams({ startDate, endDate, lob, shift, search: debouncedSearch, classification });
    if (agentKey) value.set("agentKey", agentKey);
    return value.toString();
  }, [startDate, endDate, lob, shift, debouncedSearch, classification, agentKey]);

  useEffect(() => {
    const controller = new AbortController();
    const generation = ++requestGeneration.current;
    setLoading(true); setError(""); setData(null); setPage(0);
    void fetch(`/api/realtime-hours/activity/sites?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error || "Não foi possível carregar os sites.");
        if (generation === requestGeneration.current && !controller.signal.aborted) { setData(body); if (body.filterOptions) onFilterOptions(body.filterOptions); }
      }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Falha ao carregar os sites."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [params, refresh, revision, onFilterOptions]);

  async function classify(domain: string, next: SiteClassification) {
    setSaving(domain); setError(""); setNotice("");
    try {
      const response = await fetch("/api/realtime-hours/activity/sites/classifications", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain, classification: next })
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || "Não foi possível salvar a classificação.");
      if (!mounted.current) return;
      onClassified(domain, next); setNotice(`${domain}: ${siteClassificationLabels[next]}.`); setRevision((value) => value + 1);
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Falha ao salvar."); }
    finally { if (mounted.current) setSaving(null); }
  }

  async function exportReport() {
    setExporting(true); setError("");
    try {
      const response = await fetch(`/api/realtime-hours/activity/sites?${params}&export=xlsx`, { cache: "no-store" });
      if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error || "Não foi possível exportar o relatório."); }
      if (!response.headers.get("Content-Type")?.includes("spreadsheetml")) throw new Error("Sua sessão expirou. Entre novamente para exportar.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = `atividades_sites_${startDate}_${endDate}.xlsx`;
      document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Falha ao exportar."); }
    finally { if (mounted.current) setExporting(false); }
  }

  const pages = Math.max(1, Math.ceil((data?.sites.length ?? 0) / 50));
  const currentPage = Math.min(page, pages - 1);
  return <div className="space-y-4">
    <Panel title="Hub de links acessados">
      <p className="mb-4 text-sm text-muted">Classifique os domínios acessados. A tag é compartilhada entre as equipes e aparece nos sites dos agentes.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-bold text-muted">De<input aria-label="Início do relatório" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="premium-control mt-1 block h-10 px-3 text-sm" /></label>
        <label className="text-xs font-bold text-muted">Até<input aria-label="Fim do relatório" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="premium-control mt-1 block h-10 px-3 text-sm" /></label>
        <label className="relative min-w-48 flex-1"><span className="sr-only">Buscar site</span><Search className="absolute left-3 top-3 h-4 w-4 text-muted" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar domínio" aria-label="Buscar site" className="premium-control h-10 w-full pl-9 pr-3 text-sm" /></label>
        <label><span className="sr-only">Filtrar classificação</span><select aria-label="Filtrar classificação" value={classification} onChange={(event) => setClassification(event.target.value)} className="premium-control h-10 px-3 text-sm"><option value="">Todas as classificações</option>{siteClassifications.map((value) => <option key={value} value={value}>{siteClassificationLabels[value]}</option>)}</select></label>
        <button type="button" onClick={() => void exportReport()} disabled={exporting || loading || !data?.sites.length || !!saving || search !== debouncedSearch} className="premium-button inline-flex h-10 items-center gap-2 px-4 text-sm font-bold disabled:opacity-50">{exporting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Exportar relatório</button>
      </div>
      <p className="mt-3 text-xs text-muted">Até 31 dias, conforme a retenção da captura. São exibidos domínios; caminhos das páginas não são coletados. O relatório inclui resumo, sites e detalhamento por agente.</p>
    </Panel>
    {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}
    <p role="status" className="text-sm text-emerald-700">{notice}</p>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
      ["Tempo em sites", data?.summary.totalSeconds], ["Produtivo", data?.summary.productiveSeconds],
      ["Improdutivo", data?.summary.unproductiveSeconds], ["Sem classificação", data?.summary.unclassifiedSeconds]
    ].map(([label, seconds]) => <div key={label} className="rounded-xl border border-border bg-white p-4"><p className="text-xs font-bold text-muted">{label}</p><p className="mt-1 text-xl font-extrabold text-navy-950">{typeof seconds === "number" ? duration(seconds) : "—"}</p></div>)}</div>
    <Panel title={`Sites${data ? ` · ${data.summary.domains}` : ""}`}>
      {loading ? <p role="status" className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted"><RefreshCw className="h-4 w-4 animate-spin" />Carregando sites...</p> : !data?.sites.length ? <EmptyState title={error ? "Consulta indisponível" : "Nenhum site encontrado"} description="Ajuste o período e os filtros para consultar os registros disponíveis." /> : <>
        <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[750px] text-left"><thead className="bg-slate-50 text-xs text-muted"><tr>{["Site", "Badge", "Tempo", "Agentes/estações", "Registros", "Classificar"].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-border">
          {data.sites.slice(currentPage * 50, (currentPage + 1) * 50).map((site) => <tr key={site.domain}>
            <td className="px-4 py-3"><a href={`https://${site.domain}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 whitespace-nowrap text-sm font-bold text-blue-700 hover:underline">{site.domain}<ExternalLink className="h-3 w-3 shrink-0" /><span className="sr-only">Abre em nova aba</span></a></td>
            <td className="px-4 py-3"><SiteClassificationBadge classification={site.classification} /></td><td className="whitespace-nowrap px-4 py-3 text-sm font-semibold">{duration(site.seconds)}</td><td className="px-4 py-3 text-sm">{site.agents}</td><td className="px-4 py-3 text-sm">{site.segments}</td>
            <td className="px-4 py-3"><select aria-label={`Classificar ${site.domain}`} value={site.classification} disabled={!!saving} onChange={(event) => void classify(site.domain, event.target.value as SiteClassification)} className="premium-control h-9 px-2 text-xs disabled:opacity-50">{siteClassifications.map((value) => <option key={value} value={value}>{siteClassificationLabels[value]}</option>)}</select>{saving === site.domain ? <span className="ml-2 text-xs text-muted">Salvando...</span> : null}</td>
          </tr>)}
        </tbody></table></div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted"><p>Página {currentPage + 1} de {pages} · A exportação inclui todas as páginas.</p><div className="flex gap-2"><button type="button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)} className="rounded-lg border border-border px-3 py-2 disabled:opacity-40">Anterior</button><button type="button" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)} className="rounded-lg border border-border px-3 py-2 disabled:opacity-40">Próxima</button></div></div>
        <p className="mt-3 text-xs text-muted">Registros são intervalos capturados, não visitas. A classificação atual do domínio se aplica a todo o período consultado.</p>
      </>}
    </Panel>
  </div>;
}

function duration(value: number) {
  const total = Math.max(0, Math.round(value));
  return `${Math.floor(total / 3600)}h ${String(Math.floor(total % 3600 / 60)).padStart(2, "0")}min ${String(total % 60).padStart(2, "0")}s`;
}
