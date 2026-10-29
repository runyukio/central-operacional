import { isWorkHoursAllowedForSchedule } from "./work-hours-rules";

export type AdsAlertKind = "volume" | "productivity" | "aht" | "lateness" | "hours" | "required";
export type AdsAlertChannel = "hourly" | "shift";
export type AdsAlertPlan = { kind: AdsAlertKind; referenceDate: string; start: string; end: string; periodKey: string };
export type AdsAlertCell = { value: string; color?: "text" | "red" | "orange" | "blue" | "green" | "muted"; ratio?: number };
export type AdsAlertRow = { name: string; detail: string; cells: AdsAlertCell[] };
export type AdsAlertGroup = { title: string; rows: AdsAlertRow[] };
export type AdsOperationalReport = {
  kind: AdsAlertKind; periodKey: string; title: string; subtitle: string;
  metrics: { label: string; value: string }[]; summary: string;
  headings: string[]; groups: AdsAlertGroup[]; notes: string[]; pending?: boolean;
};
export const ADS_OPERATIONAL_LIMITS = { ahtDeviationPercent: 20, ahtCurrentSubmits: 10,
  ahtHistoryDays: 3, ahtHistorySubmits: 100, lateToleranceMinutes: 5 } as const;
// Attendance outcomes must not erase a person from the planned staffing count.
export const ADS_PLANNED_SCHEDULE_STATUSES = ["ESCALADO","PRESENTE","ATRASO","SAIDA_ANTECIPADA","FALTA","FALTA_JUSTIFICADA",
  "FALTA_INJUSTIFICADA","TROCA_APROVADA","VENDA_FOLGA_APROVADA","VENDA_DE_FOLGA_APROVADA"] as const;

export function addAdsDays(day: string, amount: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + amount * 86_400_000).toISOString().slice(0, 10);
}
export function adsBrazilClock(now: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map(part => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}
// Operational source dates are wall-clock values; never let the server timezone interpret them.
export const adsWallInstant = (wall: string) => new Date(`${wall.replace(" ", "T")}:00-03:00`);
const wall = (day: string, hour: number) => `${day} ${String(hour).padStart(2, "0")}:00`;
export function adsAlertPlans(now: Date, channel: AdsAlertChannel): AdsAlertPlan[] {
  const { day, hour, minute } = adsBrazilClock(now);
  const previous = addAdsDays(day, -1);
  const make = (kind: AdsAlertKind, referenceDate: string, start: string, end: string): AdsAlertPlan =>
    ({ kind, referenceDate, start, end, periodKey: `${kind}:${kind === "required" ? `${referenceDate}:${wall(day, hour)}` : end}` });
  if (channel === "hourly") {
    if (minute < 3 || minute >= 13) return [];
    const start = hour ? wall(day, hour - 1) : wall(previous, 23);
    return (["volume", "productivity", "aht"] as const).map(kind => make(kind, start.slice(0, 10), start, wall(day, hour)));
  }
  if (minute >= 10 || ![0, 9, 15, 18].includes(hour)) return [];
  const plans: AdsAlertPlan[] = [];
  if (hour === 0) {
    plans.push(make("lateness", previous, wall(previous, 23), wall(day, 0)));
    plans.push(make("hours", previous, wall(previous, 14), wall(previous, 23)));
  } else if (hour === 9) {
    plans.push(make("lateness", day, wall(day, 8), wall(day, 9)));
    plans.push(make("hours", previous, wall(previous, 23), wall(day, 8)));
  } else if (hour === 15) plans.push(make("lateness", day, wall(day, 14), wall(day, 15)));
  else plans.push(make("hours", day, wall(day, 8), wall(day, 17)));
  if (hour !== 18) {
    const reference = hour === 0 ? previous : day;
    plans.push(make("required", reference, wall(reference, 0), wall(day, hour)));
  }
  return plans;
}
export function adsWeekDays(referenceDate: string) {
  const weekday = (new Date(`${referenceDate}T00:00:00Z`).getUTCDay() + 6) % 7;
  return Array.from({ length: 7 - weekday }, (_, index) => addAdsDays(referenceDate, index));
}
export function adsPreviewDispatchTime(now: Date, channel: AdsAlertChannel) {
  const { day,hour }=adsBrazilClock(now);
  const previewHour=channel==="hourly"?hour:[0,9,15,18].filter(value=>value<=hour).at(-1)!;
  return new Date(adsWallInstant(wall(day,previewHour)).getTime()+(channel==="hourly"?180_000:0));
}
export type AdsSchedule = {
  employeeId: string; day: string; status: string; startsAt: string | null; endsAt: string | null;
  profileStart: string | null; profileEnd: string | null; wbLogin: string; name: string; supervisor: string | null;
};
export function adsScheduleWindow(day: string, start: string | null, end: string | null) {
  if (!/^\d{2}:\d{2}$/.test(start ?? "") || !/^\d{2}:\d{2}$/.test(end ?? "")) return null;
  const from = adsWallInstant(`${day} ${start}`).getTime();
  let to = adsWallInstant(`${day} ${end}`).getTime();
  if (to <= from) to += 86_400_000;
  return { from, to };
}
export function adsProductiveSchedule(row: AdsSchedule) {
  return isWorkHoursAllowedForSchedule({ status: row.status, startsAt: row.startsAt, endsAt: row.endsAt });
}
export function adsScheduleConflict(row: AdsSchedule, excludedWbs: ReadonlySet<string>) {
  return excludedWbs.has(row.wbLogin.trim().toLowerCase()) || !row.profileStart || !row.profileEnd
    || row.startsAt !== row.profileStart || row.endsAt !== row.profileEnd;
}
export function adsEligibleForHour(row: AdsSchedule, plan: AdsAlertPlan, excludedWbs: ReadonlySet<string>) {
  if (!adsProductiveSchedule(row) || excludedWbs.has(row.wbLogin.trim().toLowerCase())) return false;
  const daily = adsScheduleWindow(row.day, row.startsAt, row.endsAt);
  const profile = adsScheduleWindow(row.day, row.profileStart, row.profileEnd);
  const start = adsWallInstant(plan.start).getTime(), end = adsWallInstant(plan.end).getTime();
  return Boolean(daily && profile && daily.from <= start && daily.to >= end && profile.from <= start && profile.to >= end);
}
export function adsAhtComparison(current: { submit: number; moderationMs: number }, historical?: { submits: number; seconds: number; days: number }) {
  if (!historical || ![current.submit,current.moderationMs,historical.submits,historical.seconds,historical.days].every(Number.isFinite)
    || current.moderationMs<0 || current.submit < ADS_OPERATIONAL_LIMITS.ahtCurrentSubmits || historical.days < ADS_OPERATIONAL_LIMITS.ahtHistoryDays
    || historical.submits < ADS_OPERATIONAL_LIMITS.ahtHistorySubmits || historical.seconds <= 0) return null;
  const baseline = historical.seconds / historical.submits;
  const actual = current.moderationMs / 1000 / current.submit;
  const deviation = (actual / baseline - 1) * 100;
  if (!Number.isFinite(baseline) || baseline<=0 || !Number.isFinite(actual) || !Number.isFinite(deviation)) return null;
  return { baseline, actual, deviation, alert: Math.abs(deviation) > ADS_OPERATIONAL_LIMITS.ahtDeviationPercent };
}
export function adsReportLabel(plan: AdsAlertPlan) {
  const day = plan.referenceDate.split("-").reverse().join("/");
  return `${day} · ${plan.start.slice(11)} a ${plan.end.slice(11)}${plan.start.slice(0, 10) !== plan.end.slice(0, 10) ? " (dia seguinte)" : ""} · Brasília`;
}
export function adsPendingReport(plan: AdsAlertPlan, reason = "Fonte ainda não consolidada para este período."): AdsOperationalReport {
  const titles = { volume: "Volume da hora", productivity: "Produtividade no intervalo", aht: "AHT x média das duas semanas",
    lateness: "Início da jornada", hours: "Horas cumpridas", required: "Requerido x previstos na semana" };
  return { kind: plan.kind, periodKey: plan.periodKey, title: titles[plan.kind], subtitle: adsReportLabel(plan), pending: true,
    metrics: [{ label: "DADOS DO PERÍODO", value: "Pendentes" }, { label: "CLASSIFICAÇÃO", value: "Aguardando dados" }],
    summary: "Dados pendentes · nenhuma conclusão de desempenho", headings: ["REFERÊNCIA", "SITUAÇÃO", "RESULTADO"],
    groups: [{ title: "Validação da fonte", rows: [{ name: "ADS", detail: reason, cells: [{ value: "Pendente", color: "muted" }, { value: "A conferir", color: "blue" }] }] }],
    notes: ["Ausência de dados não foi tratada como zero, atraso, falta ou descumprimento."] };
}
