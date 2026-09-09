"use client";

import { useState } from "react";
import { CalendarDays, Check, Search, UsersRound, X } from "lucide-react";
import { FormInput } from "@/components/modules/shared";
import type { SpacePeriod, SpaceSummary } from "@/lib/meu-espaco-contract";
import { spacePeriodOptions, spacePeriodPreset, spacePeriodSelection, spaceSearchMatches } from "@/lib/meu-espaco-slicers";
import { SpaceButtons } from "./shared";
import styles from "./space.module.css";

export function SpaceSupervisorSlicer({ value, options, onChange }: {
  value: string; options: SpaceSummary["supervisors"]; onChange: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const visible = options.filter((option) => spaceSearchMatches(option.name, search));
  const selected = options.find((option) => option.id === value);
  return <section className={styles.panel} aria-label="Filtro de supervisores">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className={styles.legend}><UsersRound className="h-4 w-4" />Supervisores ativos</h2><p className="text-xs text-muted">Selecione um time para filtrar todas as visões. Históricos de inativos permanecem nas telas originais.</p></div>
      <div className={styles.supervisorSearch}><Search aria-hidden className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" /><input aria-label="Buscar supervisor" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar supervisor…" className="premium-control w-full py-2.5 pl-9 pr-9 text-sm" />{search ? <button type="button" aria-label="Limpar busca de supervisor" onClick={() => setSearch("")} className="absolute right-2 top-2 p-1.5"><X className="h-4 w-4" /></button> : null}</div>
    </div>
    <div className="mb-3 flex flex-wrap items-center gap-3"><button type="button" aria-pressed={!value} className={styles.chip} onClick={() => onChange("")}><UsersRound className="h-4 w-4" />Todos os supervisores<span className={styles.badge}>{options.length}</span></button>{value ? <span className="text-xs text-muted">Selecionado: <strong className="text-ink">{selected?.name || "Supervisor selecionado"}</strong></span> : <span className="text-xs text-muted">Visão consolidada dos times</span>}</div>
    <div className={styles.supervisorGrid}>
      {visible.map((option) => <button key={option.id} type="button" aria-pressed={value === option.id} className={styles.supervisor} onClick={() => onChange(option.id)}>
        <span className="flex items-center gap-2.5"><span aria-hidden className={styles.avatar}>{option.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("")}</span><span className="min-w-0 flex-1 text-sm font-bold">{option.name}</span>{value === option.id ? <Check aria-hidden className="h-4 w-4 shrink-0 text-blue-600" /> : null}</span>
        <span className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><span>{option.teamSize} parceiros</span><span className={styles.badge}>{option.absences + option.hours} justificativas</span><span className={styles.badge}>{option.required ?? 0} Requerido</span></span>
      </button>)}
    </div>
    {!visible.length ? <p role="status" className="py-5 text-center text-sm text-muted">Nenhum supervisor encontrado. A busca não altera o time selecionado.</p> : null}
  </section>;
}

export function SpacePeriodSlicer({ value, today, onChange, label = "Período dos indicadores" }: {
  value: SpacePeriod; today: string; onChange: (period: SpacePeriod) => void; label?: string;
}) {
  const [shortcut, setShortcut] = useState("month");
  const shortcutPeriod = spacePeriodPreset(shortcut, today);
  const selected = shortcutPeriod.startDate === value.startDate && shortcutPeriod.endDate === value.endDate
    ? shortcut : spacePeriodSelection(value, today);
  return <section aria-label={label} className={styles.panel}>
    <h2 className={styles.legend}><CalendarDays className="h-4 w-4" />{label}</h2>
    <div className={styles.periodControls}>
      <SpaceButtons label="Atalhos de período" value={selected} options={[...spacePeriodOptions]} onChange={(preset) => { setShortcut(preset); onChange(spacePeriodPreset(preset, today)); }} />
      <div className={styles.dates}><FormInput label="De" type="date" value={value.startDate} onChange={(startDate) => onChange({ ...value, startDate })} /><FormInput label="Até" type="date" value={value.endDate} onChange={(endDate) => onChange({ ...value, endDate })} /></div>
      {selected === "custom" ? <span className={styles.badge}>Período personalizado</span> : null}
    </div>
  </section>;
}
