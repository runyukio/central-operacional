"use client";

import { scheduleDisplayLabel } from "@/lib/schedule-display-label";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import { parseScheduleSlotFilter, toggleScheduleSlotFilter } from "@/lib/schedule-slot-filter";
import { cn } from "@/lib/utils";

export function ScheduleSlotStatusFilter({ value, options, onChange }: {
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  const selected = parseScheduleSlotFilter(value);
  const label = selected.length ? selected.map(scheduleDisplayLabel).join(", ") : "Todos os slots";
  const itemClass = "relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm font-semibold outline-none hover:bg-slate-100 focus:bg-slate-100";

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label={`Tipos de slot: ${label}`} title={label} className="flex h-9 min-w-0 items-center justify-between gap-2 rounded-lg border border-border bg-white px-3 text-sm font-bold text-navy-950 outline-none">
          <span className="min-w-0 truncate">{label}</span>
          {selected.length > 1 ? <span className="shrink-0 rounded bg-blue-50 px-1.5 text-xs text-blue-700">{selected.length}</span> : null}
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={6} collisionPadding={12} className="z-50 w-72 max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-border bg-white p-1.5 text-navy-950 shadow-xl">
          <DropdownMenu.Label className="px-2.5 py-2 text-xs font-bold text-muted">Selecione um ou mais tipos de slot</DropdownMenu.Label>
          <div className="max-h-[min(20rem,60vh)] overflow-y-auto">
            <DropdownMenu.CheckboxItem checked={!selected.length} onCheckedChange={() => onChange("Todos")} onSelect={(event) => event.preventDefault()} className={itemClass}>
              <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", !selected.length ? "border-blue-600 bg-blue-600 text-white" : "border-border")}><DropdownMenu.ItemIndicator><Check aria-hidden="true" className="h-3 w-3" /></DropdownMenu.ItemIndicator></span>
              Todos os slots
            </DropdownMenu.CheckboxItem>
            {options.map((option) => (
              <DropdownMenu.CheckboxItem key={option} checked={selected.includes(option)} onCheckedChange={() => onChange(toggleScheduleSlotFilter(value, option))} onSelect={(event) => event.preventDefault()} className={cn(itemClass, selected.includes(option) && "bg-blue-50 text-blue-700")}>
                <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", selected.includes(option) ? "border-blue-600 bg-blue-600 text-white" : "border-border")}><DropdownMenu.ItemIndicator><Check aria-hidden="true" className="h-3 w-3" /></DropdownMenu.ItemIndicator></span>
                {scheduleDisplayLabel(option)}
              </DropdownMenu.CheckboxItem>
            ))}
          </div>
          <DropdownMenu.Separator className="my-1.5 h-px bg-border" />
          <DropdownMenu.Item className="cursor-pointer rounded-md px-2.5 py-2 text-center text-sm font-bold text-blue-700 outline-none hover:bg-slate-100 focus:bg-slate-100">Concluir seleção</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
