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

// Fixed reporting roster, resolved against EmployeeProfile IDs. Display labels
// and order are intentional; names/WBs never determine the association.
export const ADHERENCE_SUMMARY_SUPERVISORS: readonly AdherenceSummarySupervisor[] = [
  { id: "cmpr3xlnj00lg13eevxkeoqyp", name: "Priscilla" },
  { id: "cmpbf8cx8005ci38n42kims14", name: "Diógenes" },
  { id: "cmpbf81lv004wi38na5tdkl28", name: "João Lucas" },
  { id: "cmpbf8stn000739ojpefw8j7t", name: "Glauce" },
  { id: "cmpbf9fo1001339ojixg1wt8k", name: "William" },
  { id: "cmpb4s3lm00nqwqfcm636mca5", name: "Jessica" },
  { id: "cmpbf8imf005ki38n8ix91l2i", name: "Fernanda Bencice" }
];

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
export function buildAdherenceSummary(period: CapturePeriod, groups: AdherenceSummaryGroup[], roster: readonly AdherenceSummarySupervisor[] = ADHERENCE_SUMMARY_SUPERVISORS): AdherenceSummary {
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
    supervisors: Array.from(supervisors.values()),
    total: Array.from(supervisors.values()).reduce((sum, row) => sum + row.count, 0)
  }));
  const supervisors = Array.from(new Map(days.flatMap((day) => day.supervisors.map(({ id, name }) => [id, { id, name }] as const))).values());
  return { ...period, supervisors, days, total: days.reduce((sum, day) => sum + day.total, 0) };
}
