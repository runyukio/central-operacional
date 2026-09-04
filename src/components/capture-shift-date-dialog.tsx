"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { MAX_CAPTURE_IMPORT_DAYS, resolveCapturePeriod, type CapturePeriod } from "@/lib/work-hours-capture-period";

export function CaptureShiftDateDialog({ open, onOpenChange, onContinue }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContinue: (period: CapturePeriod) => void;
}) {
  const [period, setPeriod] = useState<CapturePeriod>({ startDate: "", endDate: "" });
  const [error, setError] = useState("");
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-white p-5 shadow-xl">
          <form onSubmit={(event) => {
            event.preventDefault();
            const result = resolveCapturePeriod(period);
            if ("error" in result) { setError(result.error); return; }
            setError("");
            onOpenChange(false);
            onContinue(result.period);
          }}>
            <Dialog.Title className="text-sm font-extrabold text-navy-950">Período da Captura de Horas</Dialog.Title>
            <p className="mt-2 text-sm text-muted">Selecione até {MAX_CAPTURE_IMPORT_DAYS} dias. Cada jornada será importada na sua própria data de turno (Shift Date), inclusive as que atravessam a meia-noite.</p>
            <label htmlFor="capture-start-date" className="mt-4 block text-sm font-bold text-navy-950">Data inicial</label>
            <input id="capture-start-date" type="date" required value={period.startDate} onChange={(event) => { const value = event.target.value; setPeriod((current) => ({ startDate: value, endDate: current.endDate || value })); setError(""); }} className="mt-2 h-11 w-full rounded-lg border border-border bg-white px-3 text-navy-950" />
            <label htmlFor="capture-end-date" className="mt-3 block text-sm font-bold text-navy-950">Data final</label>
            <input id="capture-end-date" type="date" required min={period.startDate || undefined} value={period.endDate} onChange={(event) => { setPeriod((current) => ({ ...current, endDate: event.target.value })); setError(""); }} className="mt-2 h-11 w-full rounded-lg border border-border bg-white px-3 text-navy-950" />
            {error ? <p role="alert" className="mt-2 text-sm font-semibold text-red-600">{error}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close asChild><button type="button" className="rounded-lg border border-border px-4 py-2 text-sm font-bold text-navy-950">Cancelar</button></Dialog.Close>
              <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white">Continuar</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
