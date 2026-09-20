import type { CapacityRow } from "@/lib/ads-capacity-core";

/** Presentation only: keep all shifts of each matching day, without recalculating totals. */
export function selectCapacityDisplay<Row extends Pick<CapacityRow, "date" | "state">, Day extends { date: string }>(rows: Row[], days: Day[], onlyDeficit: boolean) {
  const deficitDates = new Set(rows.filter(row => row.state === "deficit").map(row => row.date));
  return {
    rows: onlyDeficit ? rows.filter(row => deficitDates.has(row.date)) : rows,
    days: onlyDeficit ? days.filter(day => deficitDates.has(day.date)) : days,
    deficitDates,
  };
}
