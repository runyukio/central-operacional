import type { ScheduleStatus } from "@prisma/client";

/** Empty selection means all slots. Keep the existing single-value URL compatible. */
export function parseScheduleSlotFilter(value?: string): string[] {
  return [...new Set((value ?? "").split(",").map((item) => item.trim()).filter((item) => item && item !== "Todos"))];
}

export function serializeScheduleSlotFilter(values: string[]): string {
  return parseScheduleSlotFilter(values.join(",")).join(",") || "Todos";
}

export function toggleScheduleSlotFilter(value: string, option: string): string {
  const values = parseScheduleSlotFilter(value);
  return serializeScheduleSlotFilter(values.includes(option) ? values.filter((item) => item !== option) : [...values, option]);
}

export type ScheduleStatusFilter = ScheduleStatus | { in: ScheduleStatus[] };

export function resolveScheduleStatusFilter(value: string | undefined, statusMap: Record<string, ScheduleStatus>): ScheduleStatusFilter | undefined {
  const labels = parseScheduleSlotFilter(value);
  if (!labels.length) return undefined;
  const statuses = [...new Set(labels.filter((label) => Object.prototype.hasOwnProperty.call(statusMap, label)).map((label) => statusMap[label]))];
  // Unknown values must not accidentally turn a filtered query into "all slots".
  return statuses.length === 1 ? statuses[0] : { in: statuses };
}

/** The quantity card has always excluded "Sem cronograma", including mixed selections. */
export function validScheduleSlotCountFilter(filter: ScheduleStatusFilter | undefined): { not: "SEM_ESCALA" } | { in: ScheduleStatus[] } {
  if (!filter) return { not: "SEM_ESCALA" };
  return { in: (typeof filter === "string" ? [filter] : filter.in).filter((status) => status !== "SEM_ESCALA") };
}
