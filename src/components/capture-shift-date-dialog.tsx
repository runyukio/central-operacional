"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";

export function CaptureShiftDateDialog({ open, onOpenChange, onContinue }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContinue: (shiftDate: string) => void;
}) {
  const [shiftDate, setShiftDate] = useState("");
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-white p-5 shadow-xl">
          <form onSubmit={(event) => {
            event.preventDefault();
            if (!shiftDate) return;
            onOpenChange(false);
            onContinue(shiftDate);
          }}>
            <Dialog.Title asChild><label htmlFor="capture-shift-date" className="text-sm font-extrabold text-navy-950">Shift Date</label></Dialog.Title>
            <input id="capture-shift-date" type="date" required value={shiftDate} onChange={(event) => setShiftDate(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-border bg-white px-3 text-navy-950" />
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
