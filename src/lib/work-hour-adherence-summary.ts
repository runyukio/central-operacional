import { resolveCapturePeriod, type CapturePeriod } from "./work-hours-capture-period";

export type AdherenceSummaryGroup = {
  date: string;
  supervisorId: string | null;
  supervisor: string | null;
  count: number;
};

export type AdherenceSummarySupervisor = { id: string; name: string };
export type AdherenceSummaryImport = { id: string; shiftDate: string; importedAt: string };
export type AdherenceSummaryResponse = { data: AdherenceSummary | null; latestImport: AdherenceSummaryImport | null };

// Exact registered identities, not a first-name match that could hide a homonym.
export function isExcludedAdherenceSummarySupervisor(wbLogin: string) {
  return ["wb_hellida", "guilhereme.ramos"].includes(wbLogin.trim().toLowerCase());
}

export type AdherenceSummary = CapturePeriod & {
  supervisors: AdherenceSummarySupervisor[];
  days: Array<{
    date: string;
    supervisors: Array<{ id: string; name: string; count: number }>;
    total: number;
  }>;
  total: number;
};

// Receives disjoint COUNT(DISTINCT justification.id) groups, never paginated rows.
export function buildAdherenceSummary(period: CapturePeriod, groups: AdherenceSummaryGroup[], roster?: AdherenceSummarySupervisor[]): AdherenceSummary {
  const resolved = resolveCapturePeriod(period);
  if ("error" in resolved) throw new Error(resolved.error);
  const registered = roster ? new Map(roster.map((supervisor) => [supervisor.id, supervisor])) : null;
  const byDay = new Map(resolved.dates.map((date) => [date, new Map<string, { id: string; name: string; count: number }>(
    Array.from(registered?.values() ?? [], (supervisor) => [supervisor.id, { ...supervisor, count: 0 }])
  )]));
  for (const group of groups) {
    const supervisors = byDay.get(group.date);
    if (!supervisors || group.count <= 0) continue;
    const id = group.supervisorId ?? "__none__";
    if (registered && !registered.has(id)) continue;
    const entry = supervisors.get(id) ?? { id, name: group.supervisor ?? "Sem supervisor", count: 0 };
    entry.count += group.count;
    supervisors.set(id, entry);
  }
  const days = Array.from(byDay, ([date, supervisors]) => ({
    date,
    supervisors: Array.from(supervisors.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id)),
    total: Array.from(supervisors.values()).reduce((sum, row) => sum + row.count, 0)
  }));
  const supervisors = Array.from(new Map(days.flatMap((day) => day.supervisors.map(({ id, name }) => [id, { id, name }] as const))).values())
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id));
  return { ...period, supervisors, days, total: days.reduce((sum, day) => sum + day.total, 0) };
}
