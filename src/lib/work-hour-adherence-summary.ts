import { resolveCapturePeriod, type CapturePeriod } from "./work-hours-capture-period";

export type AdherenceSummaryGroup = {
  date: string;
  supervisorId: string | null;
  supervisor: string | null;
  count: number;
};

export type AdherenceSummary = CapturePeriod & {
  days: Array<{
    date: string;
    supervisors: Array<{ id: string; name: string; count: number }>;
    total: number;
  }>;
  total: number;
};

// Receives disjoint COUNT(DISTINCT justification.id) groups, never paginated rows.
export function buildAdherenceSummary(period: CapturePeriod, groups: AdherenceSummaryGroup[]): AdherenceSummary {
  const resolved = resolveCapturePeriod(period);
  if ("error" in resolved) throw new Error(resolved.error);
  const byDay = new Map(resolved.dates.map((date) => [date, new Map<string, { id: string; name: string; count: number }>()]));
  for (const group of groups) {
    const supervisors = byDay.get(group.date);
    if (!supervisors || group.count <= 0) continue;
    const id = group.supervisorId ?? "__none__";
    const entry = supervisors.get(id) ?? { id, name: group.supervisor ?? "Sem supervisor", count: 0 };
    entry.count += group.count;
    supervisors.set(id, entry);
  }
  const days = Array.from(byDay, ([date, supervisors]) => ({
    date,
    supervisors: Array.from(supervisors.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id)),
    total: Array.from(supervisors.values()).reduce((sum, row) => sum + row.count, 0)
  }));
  return { ...period, days, total: days.reduce((sum, day) => sum + day.total, 0) };
}
