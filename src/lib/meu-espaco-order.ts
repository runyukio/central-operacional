export type SpaceSortDirection = "asc" | "desc";
export const spaceHoursSortKeys = ["employeeName", "plannedHours", "capturedHours", "effectiveHours", "futureHours", "projectedHours", "differenceMinutes", "status"] as const;
export type SpaceHoursSortKey = typeof spaceHoursSortKeys[number];
export function compareSpaceValues(a: string | number | null | undefined, b: string | number | null | undefined, direction: SpaceSortDirection) {
  const missing = (value: typeof a) => value == null || (typeof value === "number" && !Number.isFinite(value));
  if (missing(a) || missing(b)) return missing(a) === missing(b) ? 0 : missing(a) ? 1 : -1;
  const value = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "pt-BR", { numeric: true });
  return direction === "desc" ? -value : value;
}
export function spaceAge(date: string, today: string) {
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000);
  return days === 0 ? "Hoje" : days > 0 ? `há ${days} dia${days === 1 ? "" : "s"}` : `em ${-days} dia${days === -1 ? "" : "s"}`;
}
