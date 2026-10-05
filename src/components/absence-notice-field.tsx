"use client";

import React, { useId } from "react";

export function AbsenceNoticeField({ value, onChange }: { value: boolean | null; onChange: (value: boolean) => void }) {
  const groupName = useId();
  return <fieldset className="space-y-2">
    <legend className="text-sm font-bold">Foi avisado dentro de 48h? (obrigatório)</legend>
    <div className="flex gap-5">
      {[true, false].map((answer) => <label key={String(answer)} className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="radio" name={groupName} required checked={value === answer} onChange={() => onChange(answer)} />
        {answer ? "Sim" : "Não"}
      </label>)}
    </div>
    <p className="text-xs text-muted">Avaliação do supervisor sobre o prazo do aviso.</p>
  </fieldset>;
}
