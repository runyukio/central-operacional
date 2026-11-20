"use client";

import { useState } from "react";
import { SimpleTable } from "@/components/ui/primitives";
import type { SystemSettings } from "./shared";

const emptyDraft = { id: "", lobId: "", supervisorId: "", shift: "Manhã" as "Manhã" | "Tarde" | "Noite", startsOn: "", endsOn: "", active: true };

export function SupervisionMatrixFields({ settings, saving, onSave }: {
  settings: SystemSettings | null;
  saving: boolean;
  onSave: (body: Record<string, unknown>, success: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(emptyDraft);
  const [initialRows, setInitialRows] = useState<unknown[]>([]);
  const [fileError, setFileError] = useState("");
  const inputClass = "h-10 w-full rounded-lg border border-border px-3 text-sm";
  return <section className="mt-6 border-t border-border pt-5" aria-labelledby="supervision-matrix-title">
    <h3 id="supervision-matrix-title" className="font-bold">Responsabilidade por LOB, turno e vigência</h3>
    <p className="mb-4 text-sm text-slate-600">As datas inicial e final são inclusivas. Cada combinação deve ter uma única responsabilidade ativa na data da troca. Encerre o período anterior antes de cadastrar o próximo.</p>
    {settings && !settings.supervisionAssignments?.length ? (
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
        <label className="text-sm">Arquivo da matriz inicial
          <input type="file" accept=".json,application/json" className="mt-1 block max-w-full text-sm" onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            setInitialRows([]);
            setFileError("");
            if (!file) return;
            try {
              if (file.size > 100_000) throw new Error();
              const rows: unknown = JSON.parse(await file.text());
              if (!Array.isArray(rows) || !rows.length || rows.length > 100) throw new Error();
              setInitialRows(rows);
            } catch {
              setFileError("Selecione um arquivo de matriz válido, com 1 a 100 responsabilidades.");
            }
          }} />
        </label>
        <button type="button" disabled={saving || !initialRows.length} className="rounded-lg border border-border px-4 py-2 text-sm font-bold disabled:opacity-60"
          onClick={() => void onSave({ type: "importSupervisionMatrix", assignments: initialRows }, "Matriz inicial de supervisão importada.")}>
          {initialRows.length ? `Importar ${initialRows.length} responsabilidades` : "Importar matriz inicial"}
        </button>
        {fileError ? <p role="alert" className="text-sm text-red-700">{fileError}</p> : null}
      </div>
    ) : null}
    <form className="grid gap-3 md:grid-cols-3" onSubmit={(event) => {
      event.preventDefault();
      void onSave({ type: "supervisionAssignment", ...draft, endsOn: draft.endsOn || null }, "Responsabilidade de supervisão salva.");
    }}>
      <label className="text-sm">LOB<select required value={draft.lobId} onChange={(event) => setDraft({ ...draft, lobId: event.target.value })} className={inputClass}>
        <option value="">Selecione</option>{settings?.lobs.filter((lob) => lob.name !== "ALL").map((lob) => <option key={lob.id} value={lob.id}>{lob.name}</option>)}
      </select></label>
      <label className="text-sm">Turno<select value={draft.shift} onChange={(event) => setDraft({ ...draft, shift: event.target.value as typeof draft.shift })} className={inputClass}>
        {["Manhã", "Tarde", "Noite"].map((shift) => <option key={shift}>{shift}</option>)}
      </select></label>
      <label className="text-sm">Supervisor<select required value={draft.supervisorId} onChange={(event) => setDraft({ ...draft, supervisorId: event.target.value })} className={inputClass}>
        <option value="">Selecione</option>{settings?.supervisors?.map((supervisor) => <option key={supervisor.id} value={supervisor.id}>{supervisor.name}</option>)}
      </select></label>
      <label className="text-sm">Início<input required type="date" value={draft.startsOn} onChange={(event) => setDraft({ ...draft, startsOn: event.target.value })} className={inputClass} /></label>
      <label className="text-sm">Fim (opcional)<input type="date" value={draft.endsOn} min={draft.startsOn} onChange={(event) => setDraft({ ...draft, endsOn: event.target.value })} className={inputClass} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />Responsabilidade ativa</label>
      <button disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{draft.id ? "Salvar responsabilidade" : "Cadastrar responsabilidade"}</button>
      <button type="button" onClick={() => setDraft(emptyDraft)} className="rounded-lg border border-border px-4 py-2 text-sm">Novo cadastro</button>
    </form>
    <div className="mt-4"><SimpleTable columns={["LOB", "Turno", "Supervisor", "Início", "Fim", "Status", "Ação"]} rows={(settings?.supervisionAssignments ?? []).map((row) => [
      settings?.lobs.find((lob) => lob.id === row.lobId)?.name ?? row.lobId,
      row.shift,
      settings?.supervisors?.find((supervisor) => supervisor.id === row.supervisorId)?.name ?? row.supervisorId,
      row.startsOn.split("-").reverse().join("/"), row.endsOn?.split("-").reverse().join("/") ?? "Sem fim",
      row.active ? "Ativa" : "Inativa",
      <button type="button" key={row.id} onClick={() => setDraft({ ...row, endsOn: row.endsOn ?? "" })} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">Editar</button>
    ])} /></div>
    {!settings?.supervisionAssignments?.length ? <p className="mt-3 text-sm">Nenhuma responsabilidade configurada. Cadastre a matriz para permitir aprovações de troca de turno.</p> : null}
  </section>;
}
