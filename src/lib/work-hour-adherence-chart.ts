import { ADHERENCE_SUMMARY_SUPERVISORS, type AdherenceSummary } from "./work-hour-adherence-summary";

export function adherenceBarData(data: AdherenceSummary) {
  const counts = new Map<string, number>();
  const authorized = new Set(data.supervisors.map((supervisor) => supervisor.id));
  for (const day of data.days) {
    if (day.date < data.startDate || day.date > data.endDate) continue;
    for (const supervisor of day.supervisors) {
      if (authorized.has(supervisor.id)) counts.set(supervisor.id, (counts.get(supervisor.id) ?? 0) + supervisor.count);
    }
  }
  return ADHERENCE_SUMMARY_SUPERVISORS.map((supervisor) => ({
    ...supervisor, count: counts.get(supervisor.id) ?? 0, startDate: data.startDate, endDate: data.endDate
  }));
}
export const adherenceDateLabel = (date: string) => date.split("-").reverse().join("/");
export const adherenceImportTime = (date: string) => new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short"
}).format(new Date(date));
