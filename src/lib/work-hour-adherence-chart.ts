import type { AdherenceSummary } from "./work-hour-adherence-summary";

// Site colors plus dash patterns: the requested roster is not truncated to a top-N.
const colors = ["#2563eb", "#d97706", "#db2777", "#4d7c0f", "#ea580c", "#7c3aed", "#0891b2", "#0d9488", "#9333ea", "#b45309", "#be185d", "#1d4ed8", "#64748b"];
export function adherenceChartSeries(data: AdherenceSummary) {
  return data.supervisors.map((supervisor, index) => ({ ...supervisor, key: `supervisor${index}`,
    color: colors[index] ?? `hsl(${Math.round(index * 137.508) % 360}, 65%, 45%)`, dash: [undefined, "6 3", "2 3"][index % 3] }));
}
export function adherenceBarData(data: AdherenceSummary) {
  return [...(data.days[0]?.supervisors ?? [])].map((supervisor) => ({ ...supervisor, date: data.startDate }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id));
}
export function adherenceLineData(data: AdherenceSummary) {
  const series = adherenceChartSeries(data);
  return data.days.map((day) => {
    const counts = new Map(day.supervisors.map((supervisor) => [supervisor.id, supervisor.count]));
    return { date: day.date, ...Object.fromEntries(series.map((supervisor) => [supervisor.key, counts.get(supervisor.id) ?? 0])) };
  });
}
export const adherenceDateLabel = (date: string) => date.split("-").reverse().join("/");
export const adherenceImportTime = (date: string) => new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short"
}).format(new Date(date));
