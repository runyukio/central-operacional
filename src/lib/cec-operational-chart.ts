import { cecFrtDay, emptyCecFrt, type CecFrtDashboard } from "./cec-frt";

export type CecOperationalPoint = CecFrtDashboard["trend"][number] & { label: string; periodLabel: string };
export const cecViewLabels = { daily: "Diário", weekly: "Semanal", monthly: "Mensal" } as const;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const shortDay = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)}`;
export const cecDateLabel = (value: string) => value.split("-").reverse().join("/");

/** Chart contract: operational trends, never average agent SLAs or mix SLA and CPD units.
 * Keep the requested range in full; missing periods are gaps, not measured zeroes.
 * SLA uses ticket creation dates; CPD uses production dates from the existing API.
 */
export function cecOperationalPoints(data: Pick<CecFrtDashboard, "period" | "view" | "trend">): CecOperationalPoint[] {
  const { startDate, endDate } = data.period;
  if (!cecFrtDay(startDate) || !cecFrtDay(endDate) || startDate > endDate) return [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  if (data.view === "weekly") cursor.setUTCDate(cursor.getUTCDate() - (cursor.getUTCDay() + 6) % 7);
  if (data.view === "monthly") cursor.setUTCDate(1);
  const source = new Map(data.trend.map((row) => [row.period, row]));
  const points: CecOperationalPoint[] = [];
  while (iso(cursor) <= endDate && points.length < 366) {
    const period = iso(cursor);
    const next = new Date(cursor);
    if (data.view === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
    else next.setUTCDate(next.getUTCDate() + (data.view === "weekly" ? 7 : 1));
    const bucketEnd = iso(new Date(+next - 86400000));
    const from = period < startDate ? startDate : period;
    const to = bucketEnd > endDate ? endDate : bucketEnd;
    const label = data.view === "monthly" ? `${period.slice(5, 7)}/${period.slice(0, 4)}` : shortDay(from);
    points.push({ ...(source.get(period) ?? { period, ...emptyCecFrt(), normalSla: null, urgentSla: null, output: null, cpd: null }),
      label, periodLabel: from === to ? cecDateLabel(from) : `${cecDateLabel(from)} – ${cecDateLabel(to)}` });
    cursor.setTime(+next);
  }
  return points;
}
