"use client";
import React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
export function SpaceSortHeader({ label, column, sort, direction, onSort }: { label: string; column: string; sort: string; direction: "asc" | "desc"; onSort: (key: string) => void }) {
  const Icon = column !== sort ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown;
  return <th aria-sort={column === sort ? direction === "asc" ? "ascending" : "descending" : "none"}><button type="button" onClick={() => onSort(column)} className="inline-flex items-center gap-1.5 text-left hover:text-blue-600 focus-visible:outline-blue-500">{label}<Icon aria-hidden className="h-3.5 w-3.5 shrink-0" /></button></th>;
}
