"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Flag, Pencil, Plus, RefreshCw, Users, X } from "lucide-react";
import { Panel } from "@/components/ui/primitives";
import { addWaveDays, waveDayOffset, waveLobColor, wavePlanSchema, waveSegment, type WavePlanInput, type WavePlanItem, type WavePlansResponse } from "@/lib/wave-planning";
import { apiJson, currentOperationalDateInput } from "./shared";

const control = "h-9 rounded-lg border border-border bg-white px-3 text-xs font-bold text-navy-950 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-50";
const stages = [{ label: "Treinamento", color: "#7c3aed" }, { label: "Nesting", color: "#d97706" }, { label: "Entrada em operação", color: "#059669" }];
const displayDate = (value: string) => value.split("-").reverse().join("/");
function shiftMonth(month: string, offset: number) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

export function WavePlanningCalendar({ selectedLob = "Todos" }: { selectedLob?: string }) {
  const [month, setMonth] = useState(() => currentOperationalDateInput().slice(0, 7));
  const [lob, setLob] = useState("Todos");
  const [payload, setPayload] = useState<WavePlansResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<WavePlanItem | "new" | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    apiJson<WavePlansResponse>(`/api/wave-plans?month=${month}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setPayload(data); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Não foi possível carregar as waves."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [month, revision]);

  const monthStart = `${month}-01`;
  const monthEnd = shiftMonth(month, 1) + "-01";
  const days = waveDayOffset(monthStart, monthEnd);
  const today = currentOperationalDateInput();
  const activeLob = selectedLob !== "Todos" ? selectedLob : lob;
  const waves = (payload?.data ?? []).filter((wave) => activeLob === "Todos" || wave.lob === activeLob);
  const visibleLobs = Array.from(new Set(waves.map((wave) => wave.lob)));
  const goLives = waves.filter((wave) => wave.goLiveDate >= monthStart && wave.goLiveDate < monthEnd);
  const todayIndex = waveDayOffset(monthStart, today);
  const monthLabel = new Date(`${monthStart}T00:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <Panel title="Calendário de waves • Novas turmas">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-muted">Planeje as próximas turmas, do treinamento até a entrada em operação.</p>
          <p className="mt-1 text-[11px] text-muted">Calendário independente do período de faltas e attrition • {activeLob === "Todos" ? "Todas as LOBs" : activeLob}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedLob === "Todos" && <select aria-label="LOB das waves" className={control} value={lob} onChange={(event) => setLob(event.target.value)}><option value="Todos">Todas as LOBs</option>{payload?.lobs.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select>}
          <button type="button" className={control} aria-label="Recarregar waves" disabled={loading} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={14} /></button>
          {payload?.canManage && <button type="button" disabled={loading || Boolean(error)} className="flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-extrabold text-white hover:bg-blue-700 disabled:opacity-50" onClick={() => { setNotice(""); setEditor("new"); }}><Plus size={15} />Nova wave</button>}
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" className={`${control} !px-2`} aria-label="Mês anterior" disabled={month <= "2000-01"} onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} /></button>
          <label className="relative"><span className="sr-only">Mês do calendário de waves</span><input type="month" min="2000-01" max="2100-12" value={month} onChange={(event) => { if (/^\d{4}-\d{2}$/.test(event.target.value) && event.target.value >= "2000-01" && event.target.value <= "2100-12") setMonth(event.target.value); }} className={control} /></label>
          <button type="button" className={`${control} !px-2`} aria-label="Próximo mês" disabled={month >= "2100-12"} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} /></button>
          <button type="button" className={control} onClick={() => setMonth(today.slice(0, 7))}>Hoje</button>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold text-slate-600" aria-label="Legenda das etapas">{stages.map((stage) => <span key={stage.label} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: stage.color }} />{stage.label}</span>)}</div>
      </div>
      {notice && <p role="status" className="mb-3 rounded-lg bg-emerald-50 p-2 text-xs font-bold text-emerald-700">{notice}</p>}
      {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error} <button type="button" className="font-bold underline" onClick={() => setRevision((value) => value + 1)}>Tentar novamente</button></div> : loading ? <p role="status" className="py-12 text-center text-sm font-semibold text-muted">Carregando calendário de waves…</p> : <>
        <div className="mb-3 flex flex-wrap gap-2 text-[11px] font-bold text-slate-600">
          <span className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2"><CalendarDays size={14} />{waves.length} {waves.length === 1 ? "wave no mês" : "waves no mês"}</span>
          <span className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2"><Users size={14} />{waves.reduce((sum, wave) => sum + wave.headcount, 0)} pessoas previstas nas turmas</span>
          <span className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700"><Flag size={14} />{goLives.reduce((sum, wave) => sum + wave.headcount, 0)} pessoas com entrada em operação no mês</span>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border" tabIndex={0} role="region" aria-label={`Cronograma de waves de ${monthLabel}. Role horizontalmente para ver todos os dias.`}>
          <table className="w-full min-w-[1160px] table-fixed border-collapse text-xs">
            <caption className="sr-only">Waves de {monthLabel}. Treinamento e nesting terminam na véspera da próxima etapa. Quantidades são previstas.</caption>
            <colgroup><col style={{ width: 240 }} /><col /></colgroup>
            <thead><tr className="bg-slate-50"><th scope="col" className="sticky left-0 z-20 border-r border-border bg-slate-50 px-4 text-left text-[11px] font-black uppercase text-muted">Wave / LOB / Pessoas</th><th scope="col" className="p-0"><div className="flex">{Array.from({ length: days }, (_, index) => { const date = addWaveDays(monthStart, index); const weekend = [0, 6].includes(new Date(date).getUTCDay()); return <div key={date} className={`min-w-0 flex-1 border-r border-border/50 py-2 text-center ${date === today ? "bg-blue-600 text-white" : weekend ? "bg-slate-100 text-slate-500" : "text-muted"}`}><span className="block text-[9px] font-semibold">{new Date(date).toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" }).replace(".", "")}</span><span className="mt-0.5 block text-[11px] font-black">{index + 1}</span></div>; })}</div></th></tr></thead>
            <tbody>{waves.map((wave) => {
              const training = waveSegment(wave.trainingStartDate, wave.nestingStartDate, monthStart, days);
              const nesting = waveSegment(wave.nestingStartDate, wave.goLiveDate, monthStart, days);
              const liveDay = waveDayOffset(monthStart, wave.goLiveDate);
              const description = `${wave.name}, ${wave.lob}, ${wave.headcount} pessoas previstas. Treinamento: ${displayDate(wave.trainingStartDate)} a ${displayDate(addWaveDays(wave.nestingStartDate, -1))}. Nesting: ${displayDate(wave.nestingStartDate)} a ${displayDate(addWaveDays(wave.goLiveDate, -1))}. Entrada em operação: ${displayDate(wave.goLiveDate)}.${wave.notes ? ` Observações: ${wave.notes}` : ""}`;
              return <tr key={wave.id} className="border-t border-border/70">
                <th scope="row" className="sticky left-0 z-20 border-r border-border bg-white p-0 text-left align-middle"><button type="button" disabled={!payload?.canManage} onClick={() => { setNotice(""); setEditor(wave); }} title={description} aria-label={`${payload?.canManage ? "Editar " : ""}${description}`} className="group flex w-full items-start gap-3 px-4 py-4 text-left hover:bg-slate-50 disabled:cursor-default"><span className="mt-0.5 h-10 w-1 shrink-0 rounded-full" style={{ background: waveLobColor(wave.lob) }} /><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2 font-extrabold text-navy-950"><span className="truncate">{wave.name}</span>{payload?.canManage && <Pencil size={12} className="shrink-0 text-slate-400" />}</span><span className="mt-1 flex flex-wrap items-center gap-2 text-[10px]"><span className="rounded px-1.5 py-0.5 font-black" style={{ background: `${waveLobColor(wave.lob)}14`, color: waveLobColor(wave.lob) }}>{wave.lob}</span><span className="font-semibold text-muted">{wave.headcount} pessoas</span></span><span className="mt-1 block text-[10px] font-semibold text-muted">Operação: {displayDate(wave.goLiveDate)}</span></span></button></th>
                <td className="p-0"><div className="relative min-h-[96px]" role="img" aria-label={description} title={description}>
                  <div aria-hidden="true" className="absolute inset-0 flex">{Array.from({ length: days }, (_, index) => <div key={index} className={`flex-1 border-r border-border/50 ${[0, 6].includes(new Date(addWaveDays(monthStart, index)).getUTCDay()) ? "bg-slate-50" : ""}`} />)}</div>
                  {todayIndex >= 0 && todayIndex < days && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-10 border-l-2 border-dashed border-blue-400" style={{ left: `${(todayIndex + 0.5) / days * 100}%` }} />}
                  {training && <div className="absolute top-5 flex h-7 items-center justify-center overflow-hidden rounded-l-md bg-violet-600 px-1 text-[10px] font-extrabold text-white shadow-sm" style={training}><span className="truncate">Treinamento</span></div>}
                  {nesting && <div className="absolute top-5 flex h-7 items-center justify-center overflow-hidden rounded-r-md bg-amber-600 px-1 text-[10px] font-extrabold text-white shadow-sm" style={nesting}><span className="truncate">Nesting</span></div>}
                  {liveDay >= 0 && liveDay < days && <div className="absolute top-[52px] flex -translate-x-1/2 flex-col items-center text-emerald-700" style={{ left: `${(liveDay + 0.5) / days * 100}%` }}><Flag size={14} fill="currentColor" /><span className="mt-0.5 whitespace-nowrap text-[9px] font-black">Go-live</span></div>}
                </div></td>
              </tr>;
            })}</tbody>
          </table>
          {!waves.length && <div className="flex flex-col items-center gap-2 px-4 py-10 text-center"><CalendarDays size={28} className="text-blue-400" /><p className="font-extrabold text-navy-950">Nenhuma wave prevista para este mês</p><p className="max-w-md text-xs text-muted">{payload?.canManage ? "Use Nova wave para informar a turma, a quantidade de pessoas e as datas de cada etapa." : "As turmas cadastradas pela gestão aparecerão aqui. Você também pode consultar outros meses."}</p></div>}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] font-semibold text-muted"><div className="flex flex-wrap gap-3">{visibleLobs.map((name) => <span className="inline-flex items-center gap-1" key={name}><span className="h-2 w-2 rounded-full" style={{ background: waveLobColor(name) }} />{name}</span>)}</div><span>Fins de semana em cinza • Linha azul: hoje • Quantidades previstas</span></div>
      </>}
      {editor && payload && <WaveEditor key={typeof editor === "string" ? "new" : editor.id} wave={editor === "new" ? null : editor} lobs={payload.lobs} defaultLob={activeLob} defaultDate={monthStart > today ? monthStart : today} onClose={() => setEditor(null)} onSaved={(message, nextMonth) => { setEditor(null); setNotice(message); if (nextMonth) setMonth(nextMonth); setRevision((value) => value + 1); }} />}
    </Panel>
  );
}

function WaveEditor({ wave, lobs, defaultLob, defaultDate, onClose, onSaved }: { wave: WavePlanItem | null; lobs: WavePlansResponse["lobs"]; defaultLob: string; defaultDate: string; onClose: () => void; onSaved: (message: string, month?: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<WavePlanInput>(() => wave ?? { name: "", lobId: lobs.find((item) => item.name === defaultLob)?.id ?? lobs[0]?.id ?? "", headcount: 1, trainingStartDate: defaultDate, nestingStartDate: addWaveDays(defaultDate, 7), goLiveDate: addWaveDays(defaultDate, 14), notes: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    const parsed = wavePlanSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setBusy(true); setError("");
    try {
      await apiJson("/api/wave-plans", { method: wave ? "PUT" : "POST", body: JSON.stringify({ ...parsed.data, ...(wave ? { id: wave.id, updatedAt: wave.updatedAt } : {}) }) });
      onSaved(wave ? "Wave atualizada." : "Wave cadastrada.", wave ? undefined : draft.trainingStartDate.slice(0, 7));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível salvar a wave."); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!wave) return;
    setBusy(true); setError("");
    try { await apiJson("/api/wave-plans", { method: "DELETE", body: JSON.stringify({ id: wave.id, updatedAt: wave.updatedAt }) }); onSaved("Wave excluída."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível excluir a wave."); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} aria-labelledby="wave-editor-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-border bg-white p-0 text-navy-950 shadow-popover backdrop:bg-navy-950/40 backdrop:backdrop-blur-sm">
    <form onSubmit={save} className="p-5">
      <div className="mb-5 flex items-start justify-between gap-3"><div><h3 id="wave-editor-title" className="text-lg font-extrabold">{wave ? "Editar wave" : "Nova wave"}</h3><p className="mt-1 text-xs text-muted">Defina a turma e o início de cada etapa.</p></div><button type="button" aria-label="Fechar cadastro de wave" disabled={busy} onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100"><X size={18} /></button></div>
      <fieldset disabled={busy} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="text-xs font-bold sm:col-span-2">Nome da wave<input autoFocus required maxLength={100} className={`${control} mt-1 block w-full`} placeholder="Ex.: Wave 12 • Novembro" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label className="text-xs font-bold">LOB<select required className={`${control} mt-1 block w-full`} value={draft.lobId} onChange={(event) => setDraft({ ...draft, lobId: event.target.value })}><option value="">Selecione a LOB</option>{lobs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-xs font-bold">Pessoas previstas<input type="number" required min={1} max={10000} step={1} className={`${control} mt-1 block w-full`} value={draft.headcount || ""} onChange={(event) => setDraft({ ...draft, headcount: Number(event.target.value) })} /></label>
        <div className="grid gap-3 sm:col-span-2 sm:grid-cols-3">{([{ key: "trainingStartDate", label: "Início do treinamento" }, { key: "nestingStartDate", label: "Início do nesting" }, { key: "goLiveDate", label: "Entrada em operação" }] as const).map((field, index) => <label key={field.key} className="text-xs font-bold"><span className="mb-1 inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: stages[index].color }} />{field.label}</span><input type="date" min="2000-01-01" max="2100-12-31" required className={`${control} block w-full !px-2`} value={draft[field.key]} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} /></label>)}</div>
        <p className="text-[11px] font-medium text-muted sm:col-span-2">Cada etapa termina na véspera do início da próxima. As datas incluem fins de semana.</p>
        <label className="text-xs font-bold sm:col-span-2">Observações <span className="font-normal text-muted">(opcional)</span><textarea maxLength={1000} rows={3} className={`${control} mt-1 block !h-auto w-full py-2`} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
      </fieldset>
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-xs font-bold text-red-700">{error}</p>}
      {confirmDelete ? <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3"><p className="text-xs font-bold text-red-700">Excluir {wave?.name} do calendário?</p><div className="mt-3 flex gap-2"><button type="button" disabled={busy} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50" onClick={() => void remove()}>{busy ? "Excluindo…" : "Excluir wave"}</button><button type="button" disabled={busy} className={control} onClick={() => setConfirmDelete(false)}>Manter wave</button></div></div> : <div className="mt-5 flex flex-wrap items-center justify-between gap-2">{wave ? <button type="button" disabled={busy} className="text-xs font-bold text-red-600" onClick={() => setConfirmDelete(true)}>Excluir wave</button> : <span />}<div className="flex gap-2"><button type="button" disabled={busy} className={control} onClick={onClose}>Cancelar</button><button type="submit" disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-extrabold text-white disabled:opacity-50">{busy ? "Salvando…" : "Salvar wave"}</button></div></div>}
    </form>
  </dialog>;
}
