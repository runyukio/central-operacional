import { cecFrtDay, cecFrtLogin } from "./cec-frt";

export const UR_TARGET = 60;
export const UR_SHIFT_HOURS = 8;
export type UrHours = { actualModerateHours: number; shiftHours: number };
export type UrRow = UrHours & { day: string; wbLogin: string; shiftKey: string };
export function urPercent(value?: UrHours | null) {
  return value && Number.isFinite(value.actualModerateHours) && value.actualModerateHours >= 0
    && Number.isFinite(value.shiftHours) && value.shiftHours > 0
    ? value.actualModerateHours / value.shiftHours * 100 : null;
}
export function sumUr(rows: UrHours[]): UrHours {
  // A missing denominator must not contribute an orphan numerator to the aggregate.
  return rows.reduce((sum, row) => urPercent(row) === null ? sum : {
    actualModerateHours: sum.actualModerateHours + row.actualModerateHours, shiftHours: sum.shiftHours + row.shiftHours
  }, { actualModerateHours: 0, shiftHours: 0 });
}
const normalize = (value: string) => value.toLowerCase().replace(/\([^)]*\)|（[^）]*）/g, "").replace(/[\s_/]+/g, "");
const aliases = {
  day: ["Brazil Shift Date", "shift_date", "Shift Date"],
  login: ["employee", "wbLogin", "agentname", "email"],
  actual: ["实际审核时长线上线下_Actual_moderate_hours", "实际审核时长线上/线下_actual_moderate_duration", "actual_moderate_hours", "actual_moderate_duration"],
  shift: ["排班时长_shift_hours", "shift_hours"],
  shiftKey: ["shifts", "shift"], start: ["Shift_start_time_br"], end: ["Shift_end_time_br"]
};
const amount = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value
  : typeof value === "string" && /^\d+(?:[.,]\d+)?$/.test(value.trim()) ? Number(value.trim().replace(",", ".")) : null;
const dateKey = (value: unknown) => cecFrtDay(typeof value === "string" ? value.trim().slice(0, 10) : value);
const text = (value: unknown) => value instanceof Date ? value.toISOString() : String(value ?? "").trim();

export function parseUrRows(raw: Record<string, unknown>[]) {
  if (!raw.length) throw new Error("A base UR está vazia.");
  const columns = Object.fromEntries(Object.entries(aliases).map(([key, names]) => {
    const found = Object.keys(raw[0]).filter((h) => names.map(normalize).includes(normalize(h)));
    if (found.length > 1) throw new Error(`Mais de uma coluna para ${key}. Mantenha apenas o campo oficial.`);
    return [key, found[0]];
  }));
  for (const key of ["day", "login", "actual"]) if (!columns[key]) throw new Error(`Coluna obrigatória da UR ausente: ${aliases[key as keyof typeof aliases][0]}.`);
  const records = new Map<string, UrRow>(), errors: string[] = [];
  let duplicates = 0, ignored = 0;
  raw.forEach((source, index) => {
    const get = (key: string) => source[columns[key]];
    if (Object.values(source).every((value) => value === null || value === undefined || value === "") || text(get("day")) === "汇总") { ignored++; return; }
    const day = dateKey(get("day")), wbLogin = cecFrtLogin(get("login"));
    const actualModerateHours = amount(get("actual")), shiftHours = UR_SHIFT_HOURS;
    const shiftKey = JSON.stringify([text(get("shiftKey")), text(get("start")), text(get("end"))]);
    if (!day || !/^[a-z0-9_.-]+$/.test(wbLogin) || ["null", "undefined", "n/a"].includes(wbLogin) || actualModerateHours === null) {
      errors.push(`Linha ${index + 2}: confira Shift Date, login e durações numéricas não negativas.`); return;
    }
    const row = { day, wbLogin, shiftKey, actualModerateHours, shiftHours }, key = JSON.stringify([day, wbLogin, shiftKey]);
    const previous = records.get(key);
    if (previous) {
      if (previous.actualModerateHours !== actualModerateHours || previous.shiftHours !== shiftHours) errors.push(`Linha ${index + 2}: mesmo parceiro, data e turno com valores conflitantes.`);
      else duplicates++;
      return;
    }
    records.set(key, row);
  });
  if (errors.length) throw new Error(`${errors.length} linhas inválidas na UR. ${errors.slice(0, 15).join(" ")} A base anterior foi preservada.`);
  // A partner has one fixed eight-hour denominator per Brazil Shift Date,
  // even when the export splits actual moderation into multiple shift rows.
  const days = new Map<string, UrRow>();
  for (const row of records.values()) {
    const key = JSON.stringify([row.day, row.wbLogin]), previous = days.get(key);
    if (previous) previous.actualModerateHours += row.actualModerateHours;
    else days.set(key, { ...row, shiftKey: "fixed-8h" });
  }
  const rows = [...days.values()];
  if (!rows.length) throw new Error("A base UR não contém registros válidos.");
  const warnings = [
    ...(rows.some((row) => row.actualModerateHours > UR_SHIFT_HOURS) ? [`${rows.filter((row) => row.actualModerateHours > UR_SHIFT_HOURS).length} dias-agente com moderação acima de 8h: UR acima de 100%, sem limitar ou corrigir o tempo exportado.`] : []),
    ...(duplicates ? [`${duplicates} duplicatas idênticas contadas uma única vez.`] : [])
  ];
  return { rows, warnings, ignored, duplicates };
}
