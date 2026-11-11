export type RealtimeCycleGrouping = "hour" | "original";

type CycleOption = { value: string; importedAt: Date | string };

export function realtimeCycleHour(value: string) {
  return /^(\d{4}-\d{2}-\d{2})[ T_](\d{2}):\d{2}$/.exec(value)?.slice(1).join(" ") ?? value;
}

// Prefer the exact hour for comparisons. If it is missing, keep the latest
// available snapshot and its actual timestamp.
export function groupRealtimeCycles<T extends CycleOption>(cycles: T[], grouping?: RealtimeCycleGrouping): T[] {
  if (grouping !== "hour") return cycles;
  const hours = new Map<string, T>();
  for (const cycle of cycles) {
    const hour = realtimeCycleHour(cycle.value);
    const current = hours.get(hour);
    if (!current) {
      hours.set(hour, cycle);
      continue;
    }

    const isFullHour = cycle.value.endsWith(":00");
    const currentIsFullHour = current.value.endsWith(":00");
    const shouldReplace = isFullHour !== currentIsFullHour
      ? isFullHour
      : cycle.value > current.value || (cycle.value === current.value
        && new Date(cycle.importedAt).getTime() > new Date(current.importedAt).getTime());
    if (shouldReplace) hours.set(hour, cycle);
  }
  return Array.from(hours.values()).sort((a, b) => b.value.localeCompare(a.value));
}

export function selectRealtimeCycle(cycles: Array<{ value: string }>, requested?: string, grouping?: RealtimeCycleGrouping) {
  return cycles.find((cycle) => cycle.value === requested)?.value
    ?? (grouping === "hour" && requested
      ? cycles.find((cycle) => realtimeCycleHour(cycle.value) === realtimeCycleHour(requested))?.value : undefined)
    ?? cycles[0]?.value ?? "";
}
