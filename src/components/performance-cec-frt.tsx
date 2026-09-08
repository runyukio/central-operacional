"use client";

import { useEffect, useState } from "react";
import { Download, RefreshCw, UploadCloud, X } from "lucide-react";
import type { CecFrtDashboard } from "@/lib/cec-frt";

const number = (value: number | null | undefined, suffix = "") => value == null ? "Sem dados" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}${suffix}`;
const day = (value: string | null | undefined) => value ? value.split("-").reverse().join("/") : "Sem dados";
const button = "inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-bold disabled:opacity-40";
type ImportResult = { cecFrtRows: number; unmatchedRows: number; unmatchedLogins: number; startDate: string; endDate: string };

async function uploadRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(body?.error || "Falha na comunicação. A importação não foi confirmada; atualize a tela antes de reenviar.");
  return body as T;
}

export function CecFrtPanel({ refreshToken = 0 }: { refreshToken?: number }) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const [startDate, setStart] = useState(`${today.slice(0, 7)}-01`), [endDate, setEnd] = useState(today);
  const [view, setView] = useState<CecFrtDashboard["view"]>("daily");
  const [data, setData] = useState<CecFrtDashboard | null>(null), [error, setError] = useState("");
  const [loading, setLoading] = useState(false), [reload, setReload] = useState(0);
  const [upload, setUpload] = useState(false), [search, setSearch] = useState(""), [page, setPage] = useState(1);
  const params = new URLSearchParams({ startDate, endDate, view }).toString();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setData(null); setPage(1);
    uploadRequest<CecFrtDashboard>(`/api/performance/cec-frt?${params}`, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setData(value); })
      .catch((e) => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [params, reload, refreshToken]);
  const agents = (data?.agents ?? []).filter((row) => `${row.wbLogin} ${row.name}`.toLowerCase().includes(search.toLowerCase()));
  const pages = Math.max(1, Math.ceil(agents.length / 50)), safePage = Math.min(page, pages);
  return <div className="space-y-4" aria-label="CEC SLA FRT e CPD">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-bold text-muted">Início<input type="date" className="premium-control mt-1 block p-2" value={startDate} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="text-xs font-bold text-muted">Fim<input type="date" className="premium-control mt-1 block p-2" value={endDate} onChange={(e) => setEnd(e.target.value)} /></label>
        <div role="group" aria-label="Visão CEC" className="flex gap-1">{([['daily','Diário'],['weekly','Semanal'],['monthly','Mensal']] as const).map(([id,label]) => <button key={id} className={`${button} ${view === id ? "bg-blue-600 text-white" : ""}`} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}</div>
      </div>
      <div className="flex flex-wrap gap-2"><button className={button} onClick={() => setReload((v) => v + 1)}><RefreshCw className="h-4 w-4" />Atualizar CEC</button>
        {data?.canImport ? <button className={`${button} bg-blue-600 text-white`} onClick={() => setUpload(true)}><UploadCloud className="h-4 w-4" />Subir SLA/FRT CEC</button> : null}
        <a aria-disabled={!data} className={`${button} ${!data ? "pointer-events-none opacity-40" : ""}`} href={data ? `/api/performance/cec-frt?${params}&export=xlsx` : undefined}><Download className="h-4 w-4" />Download XLSX</a></div>
    </div>
    <div className="rounded-xl border border-border p-3 text-xs leading-6 text-muted">
      <p><strong>SLA/FRT:</strong> percentual dentro do prazo da primeira resposta. Normal: 24h (1.440 minutos). P0 + HM: 4h (240 minutos). Não é latência média em minutos.</p>
      <p>Base diária por <strong>data de criação do ticket</strong>; não possui visão por hora. CPD usa a data de produção da base já existente. Sem denominador válido, o resultado é “Sem dados”.</p>
      <p>Último upload SLA: {data?.lastImport ? new Date(data.lastImport.importedAt).toLocaleString("pt-BR") : "Sem dados"} · SLA até {day(data?.coverage.latestDay)} · CPD até {day(data?.coverage.latestCpdDay)}.</p>
    </div>
    {loading ? <p role="status" className="p-6 text-center text-muted">Carregando CEC...</p> : error ? <p role="alert" className="rounded-xl border border-red-300 p-4 text-red-600">{error}</p> : data ? <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric title="SLA/FRT · Normal" value={number(data.summary.normalSla, "%")} helper={`${number(data.summary.normalOver)} acima de 24h / ${number(data.summary.normalTotal)} com primeira resposta >0`} />
        <Metric title="SLA/FRT · P0 + HM" value={number(data.summary.urgentSla, "%")} helper={`${number(data.summary.urgentOver)} acima de 4h / ${number(data.summary.urgentTotal)} com primeira resposta >0`} />
        <Metric title="Output CEC" value={number(data.output)} helper="Tickets da base CPD no período" />
        <Metric title="CPD" value={number(data.cpd)} helper={`Tickets / ${number(data.agentDays)} dias-parceiro com produção positiva`} />
      </div>
      {data.coverage.unmatchedRows ? <p className="rounded-xl border border-border p-3 text-sm text-muted">{number(data.coverage.unmatchedRows)} registros de SLA no período sem vínculo no cadastro. Contam no total da fila, mas não são atribuídos a um supervisor.</p> : null}
      <DataTable title="Evolução no período" headers={["Período","Normal SLA/FRT","P0 + HM SLA/FRT","Output","CPD"]} rows={data.trend.map((row) => [day(row.period),number(row.normalSla,"%"),number(row.urgentSla,"%"),number(row.output),number(row.cpd)])} />
      <DataTable title="SLA/FRT por supervisor · time atual" headers={["Supervisor","Normal SLA/FRT","Normal: >1440 / total","P0 + HM SLA/FRT","P0 + HM: >240 / total"]} rows={data.supervisors.map((row) => [row.name,number(row.normalSla,"%"),`${number(row.normalOver)} / ${number(row.normalTotal)}`,number(row.urgentSla,"%"),`${number(row.urgentOver)} / ${number(row.urgentTotal)}`])} />
      <section className="space-y-3"><label className="flex flex-wrap items-center gap-2 text-sm font-bold">Buscar parceiro na tabela<input placeholder="Nome ou WB" value={search} className="premium-control p-2 font-normal" onChange={(e) => {setSearch(e.target.value);setPage(1);}} /></label>
        <DataTable title="Parceiros · vínculo atual" headers={["Parceiro / WB","Skill","Supervisor","Normal SLA/FRT","P0 + HM SLA/FRT","Output","CPD"]} rows={agents.slice((safePage-1)*50,safePage*50).map((row) => [`${row.name} · ${row.wbLogin}${row.linked ? "" : " (sem cadastro)"}`,row.skill || "—",row.supervisor,number(row.normalSla,"%"),number(row.urgentSla,"%"),number(row.output),number(row.cpd)])} />
        <div className="flex items-center justify-end gap-3 text-xs"><span>{agents.length} parceiros · página {safePage} de {pages}</span><button className={button} disabled={safePage<=1} onClick={() => setPage(safePage-1)}>Anterior</button><button className={button} disabled={safePage>=pages} onClick={() => setPage(safePage+1)}>Próxima</button></div>
      </section>
    </> : null}
    {upload ? <CecFrtUpload onClose={() => setUpload(false)} onImported={() => setReload((v) => v + 1)} /> : null}
  </div>;
}
function Metric({ title, value, helper }: { title: string; value: string; helper: string }) { return <div className="card p-4"><h3 className="text-xs font-bold text-muted">{title}</h3><p className="my-2 text-2xl font-black text-navy-950">{value}</p><p className="text-xs text-muted">{helper}</p></div>; }
function DataTable({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) {
  return <section className="card overflow-hidden"><h3 className="p-4 text-sm font-black">{title}</h3><div className="overflow-auto"><table className="w-full text-left text-xs"><thead className="border-y border-border bg-slate-50 text-muted"><tr>{headers.map((h) => <th key={h} className="whitespace-nowrap px-4 py-3">{h}</th>)}</tr></thead><tbody>{rows.map((row,i) => <tr key={i} className="border-b border-border">{row.map((cell,j) => <td key={j} className="px-4 py-3">{cell}</td>)}</tr>)}</tbody></table></div>{!rows.length ? <p className="p-6 text-center text-muted">Sem dados neste período.</p> : null}</section>;
}
function CecFrtUpload({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [file,setFile] = useState<File | null>(null), [progress,setProgress] = useState<number | null>(null), [error,setError] = useState("");
  const [result,setResult] = useState<ImportResult | null>(null);
  async function submit() {
    if (!file || progress !== null) return;
    if (!file.name.toLowerCase().endsWith(".xlsx") || !file.size || file.size > 30*1024*1024) { setError("Selecione um XLSX válido de até 30 MB."); return; }
    setProgress(0);setError("");
    try {
      const { uploadId } = await uploadRequest<{uploadId:string}>("/api/performance/import/manual?action=start",{method:"POST"});
      const size=2*1024*1024, totalChunks=Math.ceil(file.size/size);
      for(let i=0;i<totalChunks;i++) {
        const params=new URLSearchParams({action:"chunk",uploadId,fileType:"cecFrt",fileName:file.name,chunkIndex:String(i),totalChunks:String(totalChunks)});
        await uploadRequest(`/api/performance/import/manual?${params}`,{method:"POST",headers:{"content-type":"application/octet-stream"},body:file.slice(i*size,(i+1)*size)});
        setProgress(Math.round((i+1)/totalChunks*85));
      }
      setProgress(90);
      const imported = await uploadRequest<ImportResult>(`/api/performance/import/manual?action=finalize&uploadId=${encodeURIComponent(uploadId)}`,{method:"POST"});
      setResult(imported);onImported();
    } catch(e) {setError(e instanceof Error ? e.message : "Falha no upload.");} finally {setProgress(null);}
  }
  return <div className="fixed inset-0 z-[100] grid place-items-center overflow-auto bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="cec-frt-upload-title"><section className="card max-h-[90vh] w-full max-w-xl overflow-auto p-5">
    <div className="mb-4 flex items-center justify-between"><h2 id="cec-frt-upload-title" className="text-lg font-black">Subir SLA/FRT CEC</h2><button aria-label="Fechar" disabled={progress!==null} onClick={onClose}><X className="h-5 w-5" /></button></div>
    <p className="mb-4 text-sm text-muted">Este envio substitui somente a base SLA/FRT CEC. Envie o arquivo completo do período que deseja manter disponível. CPD, qualidade e ADS/TNS permanecem intactos.</p>
    <label className="block rounded-xl border border-dashed border-border p-4 text-sm font-bold">Planilha PO FRT<input className="mt-2 block w-full text-xs" type="file" accept=".xlsx" disabled={progress!==null} onChange={(e) => {setFile(e.target.files?.[0]??null);setError("");setResult(null);}} /></label>
    <p className="mt-3 text-xs text-muted">Normal usa &gt;1440 / &gt;0. P0/PO + HM usa &gt;240 / &gt;0. E-mail convertido para WB. Linhas inválidas ou duplicadas impedem a substituição e mostram o motivo.</p>
    {error ? <p role="alert" className="mt-3 max-h-48 overflow-auto rounded-lg border border-red-300 p-3 text-sm text-red-600">{error}</p> : null}
    {result ? <p role="status" className="mt-3 rounded-lg border border-border p-3 text-sm">{number(result.cecFrtRows)} linhas importadas: {day(result.startDate)} a {day(result.endDate)}. {result.unmatchedLogins} logins sem cadastro ({result.unmatchedRows} linhas), preservados nos totais das filas.</p> : null}
    <div className="mt-5 flex justify-end gap-2"><button className={button} disabled={progress!==null} onClick={onClose}>{result ? "Concluir" : "Cancelar"}</button>{!result ? <button className={`${button} bg-blue-600 text-white`} disabled={!file||progress!==null} onClick={() => void submit()}>{progress!==null ? `Validando e importando... ${progress}%` : "Confirmar e substituir SLA/FRT"}</button> : null}</div>
  </section></div>;
}
