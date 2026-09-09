import type { SpacePeriod } from "./meu-espaco-contract";

export const spacePeriodOptions = [
  { id: "month", label: "Este mês" },
  { id: "today", label: "Hoje" },
  { id: "week", label: "Últimos 7 dias" }
] as const;

export function spacePeriodPreset(preset: string, today: string): SpacePeriod {
  if (preset === "today") return { startDate: today, endDate: today };
  if (preset === "week") {
    const start = new Date(`${today}T12:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 6);
    return { startDate: start.toISOString().slice(0, 10), endDate: today };
  }
  return { startDate: `${today.slice(0, 7)}-01`, endDate: today };
}

export function spacePeriodSelection(period: SpacePeriod, today: string) {
  return spacePeriodOptions.find(({ id }) => {
    const preset = spacePeriodPreset(id, today);
    return preset.startDate === period.startDate && preset.endDate === period.endDate;
  })?.id || "custom";
}

export function spaceSearchMatches(value: string, search: string) {
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
  return normalize(value).includes(normalize(search));
}
