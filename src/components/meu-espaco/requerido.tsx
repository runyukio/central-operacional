"use client";
import { useState } from "react";
import { apiJson, FormInput } from "@/components/modules/shared";
import type { SpaceCoverage, SpaceCoverageRow } from "@/lib/meu-espaco-coverage";
import { compareSpaceValues, spaceAge } from "@/lib/meu-espaco-order";
import { dateLabel, SpaceButtons, SpaceLoad, useSpaceRead } from "./shared";
import styles from "./space.module.css";

const labels = { pending: "Déficit em aberto", covered: "Cobertura atendida", ended_deficit: "Turno encerrado com déficit", invalid_shift: "Revisar horário do turno" };
function CoverageDetail({ row, scopeId, canRespond, onSaved }: { row: SpaceCoverageRow; scopeId: string; canRespond: boolean; onSaved: () => void }) {
  const [supervisor, setSupervisor] = useState(row.supervisors[0]?.id || ""), [text, setText] = useState(""), [requestId, setRequestId] = useState("");
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (saving) return;
    const token = requestId || crypto.randomUUID(); setRequestId(token); setSaving(true); setError("");
    try {
      await apiJson(`/api/meu-espaco/requerido/${encodeURIComponent(row.id)}?${new URLSearchParams({ supervisorId: scopeId })}`, { method: "POST", body: JSON.stringify({ supervisorId: supervisor, text, requestId: token }) });
      setText(""); setRequestId(""); onSaved();
    } catch (error) { setError(error instanceof Error ? error.message : "Não foi possível salvar. Sua justificativa foi mantida."); }
    finally { setSaving(false); }
  }
  return <details className="mt-3 border-t border-border pt-3 text-sm"><summary className="cursor-pointer font-bold">Justificativa e histórico {row.notes.length ? `(${row.notes.length})` : ""}</summary>
    {row.state === "pending" && canRespond ? <form onSubmit={save} className="mt-3 space-y-3">
      {row.supervisors.length > 1 ? <SpaceButtons label="Supervisor da justificativa" value={supervisor} onChange={(id) => { setSupervisor(id); setRequestId(""); }} options={row.supervisors.map((s) => ({ id: s.id, label: s.name }))} /> : null}
      <label className="block font-bold">Justificativa do déficit<textarea className="premium-control mt-2 min-h-24 w-full p-3 font-normal" required minLength={5} maxLength={10000} value={text} onChange={(e) => { setText(e.target.value); setRequestId(""); }} /></label>
      <p className="text-xs text-muted">Justificar não encerra o alerta nem muda a escala. Ele sai quando a cobertura for atendida ou o turno terminar.</p>
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
      <button disabled={saving} className={styles.chip} type="submit">{saving ? "Salvando…" : "Registrar justificativa"}</button>
    </form> : <p className="mt-3 text-muted">{row.state !== "pending" ? "Alerta encerrado automaticamente; nenhuma justificativa é exigida." : "Seu perfil acompanha este alerta em modo de consulta."}</p>}
    <ol className="mt-4 space-y-3">{row.notes.map((note) => <li key={note.id} className="border-l-2 border-border pl-3"><p className="text-xs text-muted">{new Date(note.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · {note.actor} · Supervisor: {note.supervisor}</p><p className="whitespace-pre-wrap">{note.text}</p></li>)}</ol>
    {!row.notes.length ? <p className="mt-3 text-xs text-muted">Nenhuma justificativa registrada.</p> : null}
  </details>;
}

export function SpaceCoveragePanel({ supervisorId, onAnswered }: { supervisorId: string; onAnswered: () => void }) {
  const [startDate, setStartDate] = useState(""), [endDate, setEndDate] = useState("");
  const [period, setPeriod] = useState({ startDate: "", endDate: "" }), [state, setState] = useState("pending"), [order, setOrder] = useState("asc"), [revision, setRevision] = useState(0);
  const query = new URLSearchParams({ supervisorId });
  if (period.startDate) query.set("startDate", period.startDate); if (period.endDate) query.set("endDate", period.endDate);
  const read = useSpaceRead<SpaceCoverage>(`/api/meu-espaco/requerido?${query}`, true, revision);
  const oldest = read.data?.data.filter((row) => row.state === "pending").map((row) => row.date).sort()[0];
  const rows = read.data?.data.filter((row) => state === "all" || (state === "pending" ? row.state === "pending" : row.state !== "pending"))
    .sort((a, b) => compareSpaceValues(a.date, b.date, order === "desc" ? "desc" : "asc") || a.lob.localeCompare(b.lob) || a.id.localeCompare(b.id)) ?? [];
  return <section className="space-y-4" aria-label="Requerido por LOB e turno">
    <div className="card space-y-4 p-4"><div><h3 className="font-extrabold">Requerido · atenção à cobertura</h3><p className="mt-1 text-xs text-muted">Déficit total da LOB/turno cadastrado do supervisor, não apenas do seu time. Hoje até o fim do mês; inclui o turno noturno anterior se ainda estiver em andamento.</p></div>
      <div className="flex flex-wrap items-end gap-3"><FormInput label="Data inicial do Requerido" type="date" value={startDate || read.data?.period.startDate || ""} onChange={setStartDate} /><FormInput label="Data final do Requerido" type="date" value={endDate || read.data?.period.endDate || ""} onChange={setEndDate} /><button className={styles.chip} onClick={() => setPeriod({ startDate: startDate || read.data?.period.startDate || "", endDate: endDate || read.data?.period.endDate || "" })}>Aplicar período</button><button className={styles.chip} onClick={() => { setPeriod({ startDate: "", endDate: "" }); setStartDate(""); setEndDate(""); }}>Hoje até fim do mês</button></div>
      <SpaceButtons label="Situação da cobertura" value={state} onChange={setState} options={[{ id: "pending", label: `Em aberto${read.data ? ` (${read.data.pending})` : ""}` }, { id: "closed", label: "Encerrados / atendidos" }, { id: "all", label: "Todos" }]} />
      <SpaceButtons label="Ordem do Requerido" value={order} onChange={setOrder} options={[{ id: "asc", label: "Mais antigos primeiro" }, { id: "desc", label: "Mais recentes primeiro" }]} />
    </div>
    <SpaceLoad {...read} />
    {!read.loading && !read.error && read.data ? <>
      {read.data.warnings.length ? <div role="status" className="card p-4 text-sm text-muted">{read.data.warnings.map((text) => <p key={text}>{text}</p>)}</div> : null}
      {!rows.length ? <p className="card p-5 text-muted">Nenhum alerta de cobertura para este filtro. Confira os avisos de cadastro acima.</p> : null}
      {rows.map((row) => <article key={row.id} className="card p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-bold">{row.lob} · {row.shift} · {dateLabel(row.date)}</h4><p className="mt-1 text-xs text-muted">{row.supervisors.map((s) => s.name).join(" · ")}</p></div><span className={styles.badge}>{spaceAge(row.date, read.data!.today)} · {labels[row.state]}{row.state === "pending" && row.date === oldest ? " · Mais antiga" : ""}</span></div>
        <div className="mt-4 grid grid-cols-3 gap-3 text-sm"><p>Requerido<strong className="block text-2xl">{row.required}</strong></p><p>Disponível<strong className="block text-2xl">{row.available}</strong></p><p>Faltam<strong className="block text-2xl">{row.deficit}</strong></p></div>
        <CoverageDetail row={row} scopeId={supervisorId} canRespond={read.data!.canRespond} onSaved={() => { setRevision((v) => v + 1); onAnswered(); }} />
      </article>)}
    </> : null}
  </section>;
}
