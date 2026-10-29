import type { AlertAgent } from "./ads-productivity-alert-core";
import { moderationMinutesLabel } from "./ads-productivity-alert-core";
import { addAdsDays, adsReportLabel, adsWeekDays, type AdsAlertPlan, type AdsAlertRow, type AdsOperationalReport, type AdsAlertGroup, type AdsAlertCell } from "./ads-operational-alerts-core";
import { WORK_HOUR_TOLERANCE_MINUTES } from "./work-hours-rules";

const count = (value: number) => value.toLocaleString("pt-BR");
const seconds = (value: number) => `${value.toFixed(1).replace(".", ",")}s`;
const minutes = (value: number) => { const n = Math.max(0, Math.round(value)); return n >= 60 ? `${Math.floor(n / 60)}h${String(n % 60).padStart(2, "0")}m` : `${n} min`; };
const cell = (value: string, color: AdsAlertCell["color"] = "text", ratio?: number): AdsAlertCell => ({ value, color, ratio });
const noCases = (name: string): AdsAlertGroup[] => [{ title: "Resultado do período", rows: [{ name, detail: "Nenhum caso fictício foi incluído.", cells: [cell("—", "muted"), cell("Sem desvio", "blue")] }] }];
function bySupervisor(rows: Array<AdsAlertRow & { supervisor?: string | null }>): AdsAlertGroup[] {
  const groups = new Map<string, AdsAlertRow[]>();
  for (const row of rows) { const group = row.supervisor || "Sem supervisor cadastrado"; groups.set(group, [...(groups.get(group) ?? []), row]); }
  return [...groups].map(([title, items]) => ({ title, rows: items }));
}
const base = (plan: AdsAlertPlan, title: string): Pick<AdsOperationalReport, "kind" | "periodKey" | "title" | "subtitle"> =>
  ({ kind: plan.kind, periodKey: plan.periodKey, title, subtitle: adsReportLabel(plan) });

export function productivityOperationalReport(plan: AdsAlertPlan, evaluated: AlertAgent[], excluded: number): AdsOperationalReport {
  const offenders = evaluated.filter(a => a.submit > 0 && a.submit < 35 && a.moderationMs < 2_700_000);
  const rows = offenders.map(a => ({ name: a.name, detail: a.wbLogin, supervisor: a.supervisorName,
    cells: [cell(String(a.submit), "red", a.submit / 35), cell(moderationMinutesLabel(a.moderationMs), "orange", a.moderationMs / 2_700_000)] }));
  return { ...base(plan, "Produtividade no intervalo"), metrics: [{ label: "SUBMITS", value: "Menos de 35" }, { label: "MODERATION DURATION", value: "Menos de 45 minutos" }],
    summary: `${rows.length} agentes abaixo dos dois limites · escala elegível · zero excluído`, headings: ["AGENTE / WB", "SUBMITS", "MODERAÇÃO · MIN / SEG"],
    groups: rows.length ? bySupervisor(rows) : noCases("Sem ocorrência elegível"), notes: [
      "13 coletas de 5 minutos da hora encerrada; contadores e origem validados pelo núcleo de cálculo do site.",
      `${evaluated.length} avaliados; ${evaluated.filter(a => !a.submit).length} com zero submit fora do alerta; ${excluded} sem jornada comparável ou leitura válida. Pausas e mudanças de fila exigem conferência.`] };
}
export type AdsAhtCase = { agent: AlertAgent; baseline: number; actual: number; deviation: number };
export function ahtOperationalReport(plan: AdsAlertPlan, sample: AdsAhtCase[]): AdsOperationalReport {
  const flagged = sample.filter(a => Math.abs(a.deviation) > 20).sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));
  const rows = flagged.map(a => ({ name: a.agent.name, detail: `${a.agent.wbLogin} · ${a.agent.submit} submits no corte`, supervisor: a.agent.supervisorName,
    cells: [cell(seconds(a.baseline), "muted", a.baseline / Math.max(a.baseline, a.actual) / 1.1), cell(seconds(a.actual), a.deviation > 0 ? "red" : "blue", a.actual / Math.max(a.baseline, a.actual) / 1.1), cell(`${a.deviation > 0 ? "+" : ""}${a.deviation.toFixed(1).replace(".", ",")}%`, a.deviation > 0 ? "red" : "blue")] }));
  const start = addAdsDays(plan.referenceDate, -14), end = addAdsDays(plan.referenceDate, -1);
  const groups = rows.length ? bySupervisor(rows) : [{ title: "Resultado do período", rows: [{ name: "Sem desvio elegível", detail: `${sample.length} agentes com amostra suficiente.`, cells: [cell("—", "muted"), cell("—", "muted"), cell("Sem desvio", "blue")] }] }];
  return { ...base(plan, "AHT x média das duas semanas"), metrics: [{ label: "MÉDIA DO PRÓPRIO AGENTE", value: `${start.slice(8)}/${start.slice(5, 7)} a ${end.slice(8)}/${end.slice(5, 7)} · 14 dias` }, { label: "FAIXA DE ACOMPANHAMENTO", value: "Desvios fora de ±20%" }],
    summary: `${rows.length} desvios · ${flagged.filter(a => a.deviation > 0).length} acima · ${flagged.filter(a => a.deviation < 0).length} abaixo`, headings: ["AGENTE / WB", "MÉDIA 14 DIAS", "AHT NO CORTE", "DESVIO"], groups,
    notes: ["Histórico ponderado: soma da moderação / soma dos submits, excluindo o dia do corte. Comparação para cima e para baixo.", "Amostra mínima: 10 submits no corte; 3 dias e 100 submits históricos. Mudanças de fila e qualidade precisam de conferência; o desvio não confirma falha."] };
}
export type AdsLatenessRow = { name: string; wb: string; supervisor: string | null; first: string | null; delay: number | null; pending?: boolean };
export function latenessOperationalReport(plan: AdsAlertPlan, entries: AdsLatenessRow[]): AdsOperationalReport {
  const flagged = entries.filter(a => !a.pending && a.delay !== null && a.delay > 5).sort((a, b) => b.delay! - a.delay!);
  const missing = entries.filter(a => !a.pending && !a.first), pending = entries.filter(a => a.pending);
  const groups = bySupervisor(flagged.map(a => ({ name: a.name, detail: a.wb, supervisor: a.supervisor,
    cells: [cell(`${plan.start.slice(11)} / ${a.first!.slice(11, 16)}`), cell(minutes(Math.floor(a.delay!)), "orange", a.delay! / 60)] })));
  if (missing.length) groups.push({ title: "Sem registro até o corte · a conferir", rows: missing.map(a => ({ name: a.name, detail: a.wb, cells: [cell(`${plan.start.slice(11)} / —`, "muted"), cell("Sem registro", "muted")] })) });
  if (pending.length) groups.push({ title: "Jornada divergente · fora da classificação", rows: pending.map(a => ({ name: a.name, detail: a.wb, cells: [cell("—", "muted"), cell("A validar", "blue")] })) });
  return { ...base(plan, "Início da jornada · sinais a validar"), metrics: [{ label: "TOLERÂNCIA", value: "Após 5 minutos" }, { label: "EVIDÊNCIA", value: "Primeira sessão capturada" }],
    summary: `${flagged.length} sinais após a tolerância · ${missing.length} sem registro até ${plan.end.slice(11)}`, headings: ["AGENTE / WB", "ESCALA / SESSÃO", "DIFERENÇA OBSERV."], groups: groups.length ? groups : noCases("Sem sinal de atraso no corte"),
    notes: ["Sessão Windows é evidência de triagem; não comprova chegada ou login na operação. Conferir reinício do monitor, reentrada e justificativa.", "Sem registro não confirma falta ou atraso. O horário do relatório não é tolerância de uma hora."] };
}
export type AdsHoursRow = { name: string; wb: string; supervisor: string | null; planned: number | null; effective: number | null; deficit: number | null; pending: string | null };
export function hoursOperationalReport(plan: AdsAlertPlan, entries: AdsHoursRow[]): AdsOperationalReport {
  const deficits = entries.filter(a => !a.pending && a.deficit !== null && a.deficit > WORK_HOUR_TOLERANCE_MINUTES).sort((a, b) => b.deficit! - a.deficit!);
  const groups = bySupervisor(deficits.map(a => ({ name: a.name, detail: `${a.wb} · previsto ${minutes(a.planned! * 60)}`, supervisor: a.supervisor,
    cells: [cell(minutes(a.effective! * 60), "orange", a.effective! / a.planned!), cell(minutes(a.deficit!), "orange", a.deficit! / 60)] })));
  const pending = entries.filter(a => a.pending);
  if (pending.length) groups.push({ title: "Pendências · fora da classificação", rows: pending.map(a => ({ name: a.name, detail: `${a.wb} · ${a.pending}`, cells: [cell("—", "muted"), cell("A validar", "blue")] })) });
  return { ...base(plan, "Horas cumpridas · turno encerrado"), metrics: [{ label: "REFERÊNCIA", value: "Jornada encerrada" }, { label: "TOLERÂNCIA DO SITE", value: `Déficit maior que ${WORK_HOUR_TOLERANCE_MINUTES} min` }],
    summary: `${deficits.length} déficit(s) a conferir · ${pending.length} pendência(s) separadas`, headings: ["AGENTE / WB", "HORAS EFETIVAS", "DÉFICIT REGISTRADO"], groups: groups.length ? groups : noCases("Sem déficit elegível no turno"),
    notes: ["Usa horas efetivas já calculadas pelo site, com ajustes existentes, para o turno concluído. Registros sem consolidação após o fim do turno ficam pendentes.", "Jornada divergente, ajustes pendentes e justificativas já respondidas não geram conclusão de descumprimento. Conferir captura e justificativas."] };
}
export type AdsRequiredRow = { day: string; shift: string; startsAt: string; endsAt: string; required: number | null; planned: number | null };
export function requiredOperationalReport(plan: AdsAlertPlan, entries: AdsRequiredRow[]): AdsOperationalReport {
  const days = adsWeekDays(plan.referenceDate);
  const groups = days.map(day => ({ title: new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "2-digit", month: "2-digit" }).format(new Date(`${day}T00:00:00Z`)),
    rows: entries.filter(a => a.day === day).map(a => { const gap = a.required === null || a.planned === null ? null : a.planned - a.required;
      return { name: a.shift, detail: `${a.startsAt} a ${a.endsAt}`, cells: [cell(a.required === null ? "—" : count(a.required)), cell(a.planned === null ? "—" : count(a.planned), gap !== null && gap < 0 ? "red" : "text"), cell(gap === null ? "Pendente" : `${gap >= 0 ? "+" : ""}${gap}`, gap === null ? "muted" : gap < 0 ? "red" : "green")] }; }) }));
  const deficits = entries.filter(a => a.required !== null && a.planned !== null && a.planned < a.required).length;
  return { ...base(plan, "Requerido x previstos na semana"), subtitle: `${plan.referenceDate.split("-").reverse().join("/")} a ${days.at(-1)!.split("-").reverse().join("/")} · Brasília`,
    metrics: [{ label: "HORIZONTE DO PLANEJAMENTO", value: `${days.length} dias · ${entries.length} turnos` }, { label: "TURNOS COM DÉFICIT", value: `${deficits} de ${entries.length} turnos` }], summary: "Previstos = agentes escalados; inclui trocas e vendas aprovadas", headings: ["TURNO / JORNADA", "REQUERIDO", "PREVISTOS", "SALDO"], groups,
    notes: ["Previstos são pessoas escaladas; o registro de presença ou falta não altera essa contagem. Folgas ficam fora; não usa plannedStaff nem converte jornada parcial em equivalente integral.", "Excedente de um turno não compensa déficit de outro. Às 00h, a referência é o dia anterior. Segunda às 00h mostra domingo; a semana nova começa segunda às 09h. Dados ausentes ficam pendentes."] };
}
export function volumeOperationalReport(plan: AdsAlertPlan, values: { backlog: number; forecast: number; input: number }): AdsOperationalReport {
  const difference = values.input - values.forecast;
  const deviation = values.forecast > 0 ? `${difference >= 0 ? "+" : ""}${((values.input / values.forecast - 1) * 100).toFixed(1).replace(".", ",")}%` : "Sem base";
  return { ...base(plan, "Volume da hora · toda a ADS"), metrics: [{ label: "BACKLOG FINAL", value: `${count(values.backlog)} itens` }, { label: "FORECAST DA HORA", value: `${count(values.forecast)} itens` }, { label: "ENTRADAS NA HORA", value: `${count(values.input)} itens` }],
    summary: "Mesma hora e mesma fonte do Executive · toda a LOB ADS", headings: ["LOB / REFERÊNCIA", "FORECAST", "ENTRADAS", "DESVIO"],
    groups: [{ title: "ADS · entrada realizada x previsão", rows: [{ name: `ADS · ${plan.start.slice(11, 13)}H`, detail: "Todas as filas da LOB no intervalo", cells: [cell(count(values.forecast)), cell(count(values.input)), cell(deviation, difference > 0 ? "orange" : "blue")] }] }],
    notes: [`Diferença de ${difference >= 0 ? "+" : ""}${count(difference)} itens. Backlog é estoque ao fim da hora; não soma saldos nem mistura a hora em andamento.`, "A variação de volume é informativa; não há limite de criticidade aprovado."] };
}
