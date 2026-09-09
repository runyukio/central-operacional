"use client";
import { useState } from "react";
import { FormInput } from "@/components/modules/shared";
import type { SpaceCoverage } from "@/lib/meu-espaco-coverage";
import { compareSpaceValues, spaceAge, spaceAgePriority } from "@/lib/meu-espaco-order";
import { dateLabel, SpaceButtons, SpaceLoad, useSpaceRead } from "./shared";
import styles from "./space.module.css";

const labels = { pending: "Déficit em aberto", covered: "Cobertura atendida", ended_deficit: "Turno encerrado com déficit", invalid_shift: "Revisar horário do turno" };

export function SpaceCoveragePanel({ supervisorId }: { supervisorId: string }) {
  const [startDate, setStartDate] = useState(""), [endDate, setEndDate] = useState("");
  const [period, setPeriod] = useState({ startDate: "", endDate: "" }), [state, setState] = useState("pending"), [order, setOrder] = useState("asc");
  const query = new URLSearchParams({ supervisorId });
  if (period.startDate) query.set("startDate", period.startDate); if (period.endDate) query.set("endDate", period.endDate);
  const read = useSpaceRead<SpaceCoverage>(`/api/meu-espaco/requerido?${query}`);
  const oldest = read.data?.data.filter((row) => row.state === "pending").map((row) => row.date).sort()[0];
  const rows = read.data?.data.filter((row) => state === "all" || (state === "pending" ? row.state === "pending" : row.state !== "pending"))
    .sort((a, b) => compareSpaceValues(a.date, b.date, order === "desc" ? "desc" : "asc") || a.lob.localeCompare(b.lob) || a.id.localeCompare(b.id)) ?? [];
  return <section className="space-y-4" aria-label="Requerido por LOB e turno">
    <div className="card space-y-3 p-4"><div><h3 className="font-extrabold">Requerido · atenção à cobertura</h3><p className="mt-1 text-xs text-muted">Déficit da operação/turno · não exige justificativa. Encerra ao atender a cobertura ou terminar o turno.</p></div>
      <div className={styles.compactFilters}>
        <SpaceButtons label="Situação da cobertura" value={state} onChange={setState} options={[{ id: "pending", label: `Em aberto${read.data ? ` (${read.data.pending})` : ""}` }, { id: "closed", label: "Encerrados / atendidos" }, { id: "all", label: "Todos" }]} />
        <SpaceButtons label="Ordem do Requerido" value={order} onChange={setOrder} options={[{ id: "asc", label: "Mais antigos" }, { id: "desc", label: "Mais recentes" }]} />
      </div>
      <details><summary className="cursor-pointer text-xs font-bold text-blue-600">Período: {dateLabel(read.data?.period.startDate)} a {dateLabel(read.data?.period.endDate)} · alterar</summary>
        <div className="mt-3 flex flex-wrap items-end gap-3"><FormInput label="Data inicial do Requerido" type="date" value={startDate || read.data?.period.startDate || ""} onChange={setStartDate} /><FormInput label="Data final do Requerido" type="date" value={endDate || read.data?.period.endDate || ""} onChange={setEndDate} /><button type="button" className={styles.chip} onClick={() => setPeriod({ startDate: startDate || read.data?.period.startDate || "", endDate: endDate || read.data?.period.endDate || "" })}>Aplicar período</button><button type="button" className={styles.chip} onClick={() => { setPeriod({ startDate: "", endDate: "" }); setStartDate(""); setEndDate(""); }}>Hoje até fim do mês</button></div>
      </details>
    </div>
    <SpaceLoad {...read} />
    {!read.loading && !read.error && read.data ? <>
      {read.data.warnings.length ? <div role="status" className="card p-4 text-sm text-muted">{read.data.warnings.map((text) => <p key={text}>{text}</p>)}</div> : null}
      {!rows.length ? <p className="card p-5 text-muted">Nenhum alerta de cobertura para este filtro. Confira os avisos de cadastro acima.</p> : null}
      {rows.map((row) => <article key={row.id} className="card p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-bold">{row.lob} · {row.shift} · {dateLabel(row.date)}</h4><p className="mt-1 text-xs text-muted">{row.supervisors.map((s) => s.name).join(" · ")}</p></div><span className={styles.ageBadge} data-priority={spaceAgePriority(row.date, read.data!.today, row.date === oldest, row.state === "pending")}>{spaceAge(row.date, read.data!.today)} · {labels[row.state]}{row.state === "pending" && row.date === oldest ? " · Mais antiga" : ""}</span></div>
        <div className="mt-4 grid grid-cols-3 gap-3 text-sm"><p>Requerido<strong className="block text-2xl">{row.required}</strong></p><p>Disponível<strong className="block text-2xl">{row.available}</strong></p><p>Faltam<strong className="block text-2xl">{row.deficit}</strong></p></div>
        {row.notes.length ? <details className="mt-3 border-t border-border pt-3 text-xs"><summary className="cursor-pointer font-bold">Registros anteriores ({row.notes.length})</summary><ol className="mt-3 space-y-2">{row.notes.map((note) => <li key={note.id}><p className="text-muted">{new Date(note.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · {note.actor}</p><p>{note.text}</p></li>)}</ol></details> : null}
      </article>)}
    </> : null}
  </section>;
}
