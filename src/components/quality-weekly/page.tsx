"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, CheckCircle2, Download, FileBarChart, FileSpreadsheet, History, Loader2, ShieldCheck, Upload } from "lucide-react";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { dayAdd, metrics, number, rate, SECTION_NAMES } from "@/lib/quality-weekly/domain";
import type { Issue, MappingEntry, Section, Snapshot, Validation } from "@/lib/quality-weekly/domain";
import { QualityMappingView } from "./mapping-view";

const QualityReportView = dynamic(() => import("./report-view").then(module => module.QualityReportView), { loading: () => <p className="p-8 text-muted">Loading report preview…</p> });
type Status = { user: { name: string }; mapping: { id: string; filename: string; entries: MappingEntry[]; createdBy: string; createdAt: string } | null };
type Imported = { id: string; filename: string; mappingId: string | null; validation: Validation };
type Preview = { draftId: string; snapshot: Snapshot; previous: Snapshot | null; unchanged: boolean; existingId: string | null };
type HistoryRow = { id: string; weekStart: string; weekNumber: number; version: number; createdAt: string; createdBy: string; active: boolean };
type Selection = { assetId: string; filename: string; kind: "source" | "mapping"; sheets: { name: string; headers: string[]; rows: number }[] };
const endpoint = "/api/quality-weekly/";
class ApiError extends Error { constructor(message: string, public details?: { issues?: Issue[] }) { super(message); } }
async function api<T>(path: string, data?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(endpoint + path, { method: data === undefined ? "GET" : "POST", cache: "no-store", signal,
    ...(data !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {}) });
  const result = await response.json().catch(() => ({ error: "Your session may have expired. Refresh the page and sign in again." }));
  if (!response.ok) throw new ApiError(result.error || "Request failed. Please retry.", result.details);
  return result as T;
}
const dateTime = (value: string) => new Date(value).toLocaleString("en-GB", { timeZone: "America/Sao_Paulo" });

function Issues({ issues }: { issues: Issue[] }) {
  return <div className="max-h-80 overflow-auto rounded-lg border border-border"><table className="w-full text-left text-xs text-navy-950"><thead className="sticky top-0 bg-slate-50 text-muted"><tr><th className="p-3">Excel row</th><th className="p-3">Field</th><th className="p-3">Issue</th></tr></thead><tbody className="divide-y divide-border">{issues.map((issue, i) => <tr key={i}><td className="whitespace-nowrap p-3 align-top">{issue.row ?? "Workbook"}</td><td className="p-3 align-top font-bold">{issue.field}</td><td className="p-3"><span className={issue.severity === "error" ? "font-bold text-red-600" : "font-bold text-amber-600"}>{issue.severity === "error" ? "Blocking" : "Warning"}: </span>{issue.message}</td></tr>)}</tbody></table></div>;
}

export function QualityWeeklyPage({ accessError }: { accessError?: string }) {
  const [tab, setTab] = useState("upload");
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(accessError || "");
  const [notice, setNotice] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [imported, setImported] = useState<Imported | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [sheet, setSheet] = useState("");
  const [dateColumn, setDateColumn] = useState("");
  const [week, setWeek] = useState("");
  const [weekNumber, setWeekNumber] = useState("");
  const [complete, setComplete] = useState(false);
  const [replace, setReplace] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saved, setSaved] = useState<Snapshot | null>(null);
  const [reportSection, setReportSection] = useState<Section>("CD");
  const [reportView, setReportView] = useState("queues");
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const sourceRef = useRef<HTMLInputElement>(null);
  const mappingRef = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  async function run(label: string, action: (signal: AbortSignal) => Promise<void>) {
    controller.current?.abort();
    const active = new AbortController(); controller.current = active;
    setBusy(label); setError(""); setNotice(""); setIssues([]);
    try { await action(active.signal); }
    catch (error) { if (!active.signal.aborted) { setError(error instanceof Error ? error.message : "Request failed."); if (error instanceof ApiError) setIssues(error.details?.issues || []); } }
    finally { if (!active.signal.aborted) setBusy(""); }
  }
  useEffect(() => {
    if (accessError) return;
    const active = new AbortController(); controller.current = active;
    setBusy("Loading workspace");
    const query = new URLSearchParams(window.location.search);
    const reportId = query.get("report");
    const section = query.get("section");
    if (section && Object.hasOwn(SECTION_NAMES, section)) setReportSection(section as Section);
    if (query.get("view") === "agents") setReportView("agents");
    Promise.all([api<Status>("status", undefined, active.signal), reportId ? api<{ snapshot: Snapshot }>(`reports/${encodeURIComponent(reportId)}`, undefined, active.signal) : Promise.resolve(null)])
      .then(([info, report]) => { setStatus(info); if (report) { setSaved(report.snapshot); setTab("preview"); } })
      .catch(error => { if (!active.signal.aborted) setError(error.message); })
      .finally(() => { if (!active.signal.aborted) setBusy(""); });
    return () => active.abort();
  }, [accessError]);

  async function finishSelection(selected: Selection, selectedSheet: string, selectedDateColumn: string, signal: AbortSignal) {
    if (selected.kind === "mapping") {
      const result = await api<{ unchanged: boolean; pendingCount: number }>("mappings", { assetId: selected.assetId, sheet: selectedSheet }, signal);
      setStatus(await api<Status>("status", undefined, signal));
      setNotice((result.unchanged ? "This mapping is already saved. No new mapping version was created." : "Queue mapping saved. Existing report versions were preserved. Revalidate any previous upload to use this mapping.") + (result.pendingCount ? ` ${result.pendingCount} queues have required fields pending before use in a weekly report. Review the fields below.` : ""));
      setTab("mapping");
    } else {
      const result = await api<Imported>("imports", { assetId: selected.assetId, sheet: selectedSheet, dateColumn: selectedDateColumn || undefined }, signal);
      setImported(result); setPreview(null); setSaved(null); setComplete(false); setReplace(false); setWeek(result.validation.dates[0]?.start || ""); setWeekNumber(""); setTab("upload");
    }
    setSelection(null);
  }
  function upload(file: File | undefined, kind: "source" | "mapping") {
    if (!file) return;
    void run("Uploading and inspecting workbook", async signal => {
      const transfer = await api<{ id: string; url: string; local: boolean }>("transfers", { filename: file.name, size: file.size, kind }, signal);
      const uploaded = await fetch(transfer.url, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" }, signal });
      if (!uploaded.ok) throw new Error("The upload did not complete. Please select the file again.");
      const inspection = await api<{ sheets: Selection["sheets"] }>("inspect", { assetId: transfer.id }, signal);
      const selected: Selection = { assetId: transfer.id, filename: file.name, kind, sheets: inspection.sheets };
      if (selected.sheets.length !== 1) { setSelection(selected); setSheet(selected.sheets[0]?.name || ""); setDateColumn(""); }
      else await finishSelection(selected, selected.sheets[0].name, "", signal);
    });
  }
  async function loadHistory(signal: AbortSignal, before?: string) {
    const result = await api<{ reports: HistoryRow[]; next: string | null }>(`reports${before ? `?before=${encodeURIComponent(before)}` : ""}`, undefined, signal);
    setHistory(previous => before ? [...previous, ...result.reports] : result.reports); setNext(result.next);
  }
  function openVersion(id: string) { void run("Opening preserved version", async signal => {
    setSaved((await api<{ snapshot: Snapshot }>(`reports/${id}`, undefined, signal)).snapshot); setPreview(null); setTab("preview");
    window.history.replaceState(null, "", `/weekly-quality-report?report=${encodeURIComponent(id)}`);
  }); }
  const snapshot = saved || preview?.snapshot;
  const validation = imported?.validation;
  const validationCounts = validation?.distinctCounts ?? validation?.sourceCounts;
  const sourceMetrics = validationCounts ? metrics(validationCounts) : null;
  return <div lang="en" className="space-y-4">
    <PageHeader title="Weekly Quality Report" description="ER BPO · Validate, review and preserve weekly quality results" icon={FileBarChart} actions={<span className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-bold text-muted"><ShieldCheck className="h-4 w-4" />ADM / WFM only</span>} />
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><div className="flex items-start gap-2"><AlertTriangle className="h-5 w-5 shrink-0" /><p>{error}</p></div>{issues.length > 0 && <div className="mt-3"><Issues issues={issues} /></div>}{!accessError && <button className="mt-3 underline" onClick={() => void run("Reloading workspace", async signal => setStatus(await api<Status>("status", undefined, signal)))}>Retry connection</button>}</div>}
    {notice && <div role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700">{notice}</div>}
    {accessError ? null : <>
      <nav aria-label="Weekly Quality navigation" className="flex flex-wrap gap-2">
        {[["upload", "Upload & validation"], ["preview", "Report preview"], ["history", "Version history"], ["mapping", "Queue mapping"]].map(([key, title]) => <button type="button" key={key} disabled={Boolean(busy)} aria-pressed={tab === key} className={`${tab === key ? "premium-button" : "premium-control text-navy-950"} px-4 py-2 text-sm font-extrabold disabled:opacity-50`} onClick={() => { setTab(key); if (key === "history") void run("Loading history", signal => loadHistory(signal)); }}>{title}</button>)}
      </nav>
      {busy && <p role="status" className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />{busy}…</p>}
      {tab === "upload" && <>
        <div className="grid items-start gap-4 lg:grid-cols-[1.25fr_1fr]">
          <Panel title="1. Upload KwaiBI export"><div className="rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/40 p-6">
            <FileSpreadsheet className="mb-3 h-8 w-8 text-blue-600" /><h2 className="font-extrabold text-navy-950">Moderator&apos;s Details of QA indicators</h2>
            <p className="mt-2 text-sm text-muted">Complete XLSX export, up to 10 MB. Validation runs on the server and does not replace any saved report.</p>
            <input ref={sourceRef} type="file" accept=".xlsx" className="sr-only" aria-label="KwaiBI export" disabled={!status || Boolean(busy)} onChange={e => { upload(e.target.files?.[0], "source"); e.target.value = ""; }} />
            <button type="button" className="premium-button mt-5 inline-flex items-center gap-2 px-4 py-2 text-sm font-bold disabled:opacity-50" disabled={!status || Boolean(busy)} onClick={() => sourceRef.current?.click()}><Upload className="h-4 w-4" />Select XLSX export</button>
            {imported && <p className="mt-3 break-all text-xs text-muted">Last inspected: {imported.filename}</p>}
          </div></Panel>
          <Panel title="Required before weekly generation"><ul className="space-y-3 text-sm text-navy-950">
            <li className="flex gap-2"><CheckCircle2 className="h-5 w-5 shrink-0 text-blue-600" /><span>Active ADM/WFM access is enabled through the operational site&apos;s login.</span></li>
            <li className="flex gap-2"><FileSpreadsheet className="h-5 w-5 shrink-0 text-muted" /><span>Export the moderation date (<code>audit_time(年月日)</code> is accepted) and both distinct text IDs: <code>质检case_order_id</code> and <code>audit_case_order_id</code>. One ID never substitutes the other.</span></li>
            <li className="flex gap-2"><FileSpreadsheet className="h-5 w-5 shrink-0 text-muted" /><span>{status?.mapping ? `Queue mapping available: ${status.mapping.entries.length} queues.` : "Queue mapping is still required: queue ID and name. Report section and category are optional; Industry A/B is required for Accounts only."}</span></li>
          </ul><p className="mt-4 border-t border-border pt-3 text-xs text-muted">No dates or queue classifications will be inferred. Missing prior weeks remain absent. RCA is not part of this report.</p></Panel>
        </div>
        {validation && <Panel title="2. Validation & source reconciliation">
          <div className="mb-4 flex flex-wrap gap-3 text-sm font-bold"><span className={validation.valid ? "text-emerald-600" : "text-red-600"}>{validation.valid ? "Ready for weekly selection" : "Generation blocked"}</span><span className="text-muted">{validation.errorCount} errors · {validation.warningCount} warnings · {validation.duplicates} identical duplicates · {validation.resultVariations ?? 0} additional outcomes · {validation.summaryRows} summary rows excluded</span></div>
          <p className="mb-3 text-xs text-muted">{validation.distinctCounts ? `${number(validation.rows)} source rows → ${number(validation.distinctCounts.n)} distinct cases. Each result is counted once per case; Correct counts whenever present, regardless of row order. Result categories may overlap.` : "Source row totals below are for reconciliation only. Resolve validation issues to calculate distinct case metrics."} Select a week below to generate the official weekly report.</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">{[[validation.distinctCounts ? "Distinct cases" : "Source rows", number(sourceMetrics!.n)], ["Correct", number(sourceMetrics!.correct)], ["Leakage", number(sourceMetrics!.leakage)], ["False Positive", number(sourceMetrics!.falsePositive)], ["Mislabeled", number(sourceMetrics!.mislabeled)], ["Accuracy incl.", rate(sourceMetrics?.accuracy)], ["Accuracy excl.", rate(sourceMetrics?.adjustedAccuracy)]].map(([label, value]) => <div key={label} className="rounded-lg border border-border p-3"><p className="text-xs text-muted">{label}</p><p className="mt-1 text-lg font-extrabold text-navy-950">{value}</p></div>)}</div>
          {validation.controlTotals.length > 0 && <details className="mt-4 text-sm text-muted"><summary className="cursor-pointer font-bold">Preserved 汇总 control totals</summary><pre className="mt-2 overflow-x-auto rounded-lg border border-border p-3 text-xs">{JSON.stringify(validation.controlTotals, null, 2)}</pre></details>}
          {validation.issues.length > 0 && <div className="mt-4"><Issues issues={validation.issues} />{validation.errorCount + validation.warningCount > validation.issues.length && <p className="mt-2 text-xs text-muted">First {validation.issues.length} issues shown. Correct them and revalidate to see remaining issues.</p>}</div>}
          {validation.unknownQueues.length > 0 && <p className="mt-3 break-words text-xs text-muted">Unmapped queue IDs: {validation.unknownQueues.join(", ")}</p>}
          <div className="mt-4 flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-xs font-bold text-muted">Moderation date column (only if a different header is used)<select aria-label="Moderation date column" className="premium-control mt-1 w-full px-3 py-2 text-sm" value={dateColumn} onChange={e => setDateColumn(e.target.value)}><option value="">Use recognized moderation date header</option>{validation.headers.filter(Boolean).map((h, i) => <option key={i} value={h}>{h}</option>)}</select></label><button type="button" disabled={Boolean(busy)} className="premium-control px-4 py-2 text-sm font-bold disabled:opacity-50" onClick={() => void run("Revalidating preserved source", async signal => {
            const result = await api<Imported>(`imports/${imported!.id}/revalidate`, { dateColumn: dateColumn || undefined }, signal); setImported(result); setPreview(null); setComplete(false); setWeek(result.validation.dates[0]?.start || "");
          })}>Revalidate with current mapping</button></div>
        </Panel>}
        {validation?.valid && <Panel title="3. Select the operation's reporting week"><div className="grid gap-3 md:grid-cols-3">
          <label className="text-xs font-bold text-muted">Moderation week (Monday – Sunday)<select aria-label="Moderation week" className="premium-control mt-1 w-full px-3 py-2 text-sm" value={week} onChange={e => { setWeek(e.target.value); setComplete(false); setPreview(null); }}><option value="">Select week</option>{validation.dates.map(d => <option key={d.start} value={d.start}>{d.start} → {d.end} ({number(d.count)} cases)</option>)}</select></label>
          <label className="text-xs font-bold text-muted">Manual week number<input aria-label="Manual week number" type="number" min={1} max={53} placeholder="Operation calendar" className="premium-control mt-1 w-full px-3 py-2 text-sm" value={weekNumber} onChange={e => { setWeekNumber(e.target.value); setPreview(null); }} /></label>
          <p className="self-center text-xs text-muted">Observed dates: {validation.dates.find(d => d.start === week)?.days.join(", ") || "Select a week"}</p>
        </div><label className="mt-4 flex items-start gap-2 text-sm text-navy-950"><input type="checkbox" className="mt-1" checked={complete} onChange={e => setComplete(e.target.checked)} />I confirm this is the complete export for {week || "the selected Monday"} to {week ? dayAdd(week, 6) : "Sunday"}, not a partial or filtered update.</label>
          <button type="button" disabled={Boolean(busy) || !complete || !week || !weekNumber} className="premium-button mt-4 px-4 py-2 text-sm font-bold disabled:opacity-50" onClick={() => void run("Calculating server preview", async signal => {
            const result = await api<Preview>("preview", { uploadId: imported!.id, start: week, weekNumber: Number(weekNumber), complete }, signal);
            setPreview(result); setSaved(null); setReplace(false); setTab("preview");
          })}>Calculate preview</button>
        </Panel>}
      </>}
      {selection && <Panel title="Select worksheet"><p className="mb-3 break-all text-sm text-muted">{selection.filename}</p><select aria-label="Worksheet" className="premium-control px-3 py-2" value={sheet} onChange={e => setSheet(e.target.value)}>{selection.sheets.map(s => <option key={s.name} value={s.name}>{s.name} ({number(s.rows)} rows)</option>)}</select><button type="button" disabled={Boolean(busy)} className="premium-button ml-3 px-4 py-2 text-sm font-bold" onClick={() => void run("Validating worksheet", signal => finishSelection(selection, sheet, dateColumn, signal))}>Validate worksheet</button></Panel>}
      {tab === "mapping" && <Panel title="Queue mapping · separate from operational Performance">
        <p className="text-sm text-muted">Report section and category are optional. Recognized categories retain their separate results, including Material and Unit. Queues without a recognized classification appear in Other queues and remain in the totals. Blank queue names are completed from the site registry when available. Only Accounts requires Industry A/B; conflicting queue IDs still block the upload.</p>
        <div className="mt-4 flex flex-wrap gap-3"><a className="premium-control inline-flex items-center gap-2 px-4 py-2 text-sm font-bold" href={endpoint + "mapping-template"}><Download className="h-4 w-4" />Download CSV template</a><input ref={mappingRef} type="file" accept=".xlsx,.csv" className="sr-only" aria-label="Queue mapping upload" onChange={e => { upload(e.target.files?.[0], "mapping"); e.target.value = ""; }} /><button type="button" disabled={!status || Boolean(busy)} className="premium-button px-4 py-2 text-sm font-bold disabled:opacity-50" onClick={() => mappingRef.current?.click()}>Upload approved mapping</button></div>
        {status?.mapping ? <><p className="my-4 text-xs text-muted">Latest saved mapping: {status.mapping.filename} · {dateTime(status.mapping.createdAt)} BRT · {status.mapping.createdBy}. Previous reports keep their original mapping.</p><QualityMappingView entries={status.mapping.entries} /></> : <div className="mt-5"><EmptyState title="Queue mapping pending" description="Upload your de-para to review the categories and any missing fields. No classification or Industry A/B will be guessed." /></div>}
      </Panel>}
      {tab === "preview" && (snapshot ? <>
        <div className="card flex flex-wrap items-center justify-between gap-3 p-4"><div><h2 className="font-extrabold text-navy-950">Week {snapshot.weekNumber} · Version {snapshot.version} · {saved ? "Preserved report" : "Unsaved preview"}</h2><p className="mt-1 text-xs text-muted">{snapshot.start} → {snapshot.end} · {snapshot.createdBy} · {dateTime(snapshot.createdAt)} BRT · {snapshot.ruleVersion}</p></div>{saved && <div className="flex flex-wrap gap-2"><a className="premium-control px-3 py-2 text-xs font-bold" href={`${endpoint}reports/${saved.id}/source`}>Original XLSX</a><a className="premium-control px-3 py-2 text-xs font-bold" href={`${endpoint}reports/${saved.id}/mapping`}>Preserved mapping</a><button type="button" disabled={Boolean(busy)} className="premium-button inline-flex items-center gap-2 px-4 py-2 text-sm font-bold" onClick={() => void run("Generating Word from preserved results", async signal => { await api(`reports/${saved.id}/document`, {}, signal); window.location.assign(`${endpoint}reports/${saved.id}/document`); })}><Download className="h-4 w-4" />Download Word</button></div>}</div>
        <QualityReportView key={snapshot.id} snapshot={snapshot} initialSection={reportSection} initialView={reportView} />
        {preview && !saved && <Panel title="Review before saving">
          {preview.previous ? <><p className="mb-3 text-sm text-muted">Compare with active version {preview.previous.version}. Saving creates a new version; the previous report remains available.</p><div className="overflow-x-auto"><table className="w-full text-left text-sm text-navy-950"><thead><tr><th className="p-2">Metric</th><th className="p-2">Active version</th><th className="p-2">New preview</th></tr></thead><tbody>{(["n", "correct", "leakage", "falsePositive", "mislabeled"] as const).map(key => <tr key={key} className="border-t border-border"><th className="p-2">{{ n: "Sampling Amount", correct: "Correct", leakage: "Leakage", falsePositive: "False Positive", mislabeled: "Mislabeled" }[key]}</th><td className="p-2">{number(preview.previous!.metrics[key])}</td><td className="p-2">{number(preview.snapshot.metrics[key])}</td></tr>)}</tbody></table></div><p className="mt-3 text-xs text-muted">Mapping version: {preview.previous.mappingId === snapshot.mappingId ? "Unchanged" : "Changed"}. Source digest: {preview.previous.digest === snapshot.digest ? "Unchanged" : "Changed"}. Week number: {preview.previous.weekNumber} → {snapshot.weekNumber}. Previous-week context: {preview.previous.trend.slice(0, 3).map(t => t.reportId).join() === snapshot.trend.slice(0, 3).map(t => t.reportId).join() ? "Unchanged" : "Changed"}.</p></> : <p className="text-sm text-muted">This is the first saved version for this moderation week.</p>}
          {preview.unchanged ? <p className="mt-4 text-sm font-bold text-blue-600">This content is already active. The existing version will be opened without duplication.</p> : <label className="mt-4 flex gap-2 text-sm text-navy-950"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />I reviewed this preview and confirm the full weekly load{preview.previous ? " and replacement of the active version" : ""}.</label>}
          <button type="button" disabled={Boolean(busy) || (!preview.unchanged && !replace)} className="premium-button mt-4 px-4 py-2 text-sm font-bold disabled:opacity-50" onClick={() => void run("Saving immutable report version", async signal => {
            const result = await api<{ id: string }>("commit", { draftId: preview.draftId, complete: true, replace }, signal);
            setSaved((await api<{ snapshot: Snapshot }>(`reports/${result.id}`, undefined, signal)).snapshot); setPreview(null); window.history.replaceState(null, "", `/weekly-quality-report?report=${result.id}`); setNotice("Report preserved. You can now download the complete Word document.");
          })}>{preview.unchanged ? "Open existing version" : "Confirm & save report"}</button>
          <button type="button" disabled={Boolean(busy)} className="premium-control ml-2 mt-4 px-4 py-2 text-sm font-bold" onClick={() => { setTab("upload"); setPreview(null); }}>Back to validation</button>
        </Panel>}
      </> : <EmptyState title="No report preview yet" description="Upload the expanded export, resolve validation issues and select the operation's week to calculate the preview." />)}
      {tab === "history" && <Panel title="Shared version history"><p className="mb-4 text-sm text-muted">Every saved version retains its source, mapping, period, rules and responsible user. All dates below use BRT.</p>{history.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm text-navy-950"><thead className="bg-slate-50 text-muted"><tr>{["Moderation week", "Week no.", "Version", "Saved by", "Saved at", ""].map((h, i) => <th key={i} className="p-3">{h}</th>)}</tr></thead><tbody>{history.map(row => <tr key={row.id} className="border-t border-border"><td className="p-3">{row.weekStart}</td><td className="p-3">{row.weekNumber}</td><td className="p-3">v{row.version} · {row.active ? "Active" : "Previous"}</td><td className="p-3">{row.createdBy}</td><td className="p-3">{dateTime(row.createdAt)}</td><td className="p-3"><button type="button" disabled={Boolean(busy)} className="premium-control px-3 py-2 text-xs font-bold" onClick={() => openVersion(row.id)}>Open version</button></td></tr>)}</tbody></table></div> : <EmptyState title="No saved report versions" description="Only validated, confirmed weekly reports appear here. Uploads and previews never replace the active report." />}{next && <button type="button" className="premium-control mt-4 px-4 py-2 text-sm font-bold" disabled={Boolean(busy)} onClick={() => void run("Loading older versions", signal => loadHistory(signal, next))}><History className="mr-2 inline h-4 w-4" />Load older versions</button>}</Panel>}
    </>}
  </div>;
}
