import type { ExecutiveForecastPoint } from "@/lib/executive-forecast-core";

export const CAPACITY_HOUR = 3600000;
export const CAPACITY_DAY = 24 * CAPACITY_HOUR;
export const CAPACITY_SHIFTS = ["Manhã", "Tarde", "Noite"] as const;
export type CapacityShift = typeof CAPACITY_SHIFTS[number];
export type CapacitySchedule = {
  id: string; date: string; employeeId: string; wbLogin: string; name: string; skill: string;
  shift: string; status: string; statusLabel: string; start: number | null; end: number | null;
};
export type CapacityProduction = { employeeId: string; at: number; submit: number; valid: boolean };
export type CapacityRate = {
  rate: number | null; source: "individual" | "skill" | "missing"; validShifts: number; hours: number; submit: number;
  incompleteShifts: number; outsideSubmit: number;
};
export type CapacityAgent = CapacitySchedule & CapacityRate & { plannedHours: number | null; capacity: number | null };
export type CapacityRow = {
  key: string; date: string; shift: string; scheduled: number; required: number | null;
  capacity: number; forecast: number | null; gap: number | null; coverage: number | null; calculatedRequired: number | null;
  peopleGap: number | null; registeredGap: number | null; missing: number; individual: number; skill: number;
  state: "sufficient" | "deficit" | "incomplete"; agents: CapacityAgent[];
};

export const capacityDate = (value: number) => new Date(value).toISOString().slice(0, 10);
export const capacityDay = (date: string) => Date.parse(`${date}T00:00:00Z`);
export const addCapacityDays = (date: string, days: number) => capacityDate(capacityDay(date) + days * CAPACITY_DAY);
export const capacitySkill = (skill: string) => skill.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");

/** Imported Brasiltime and schedule dates are local wall-clock fields encoded in UTC. Do not apply a second -03 offset. */
export function capacityClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const p = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
}

export function capacityHistoryPeriod(today: string) {
  const weekday = new Date(capacityDay(today)).getUTCDay();
  const monday = addCapacityDays(today, -(weekday + 6) % 7);
  return { startDate: addCapacityDays(monday, -14), endDate: addCapacityDays(monday, -1) };
}

export function capacityPeriod(query: { startDate?: string; endDate?: string; shift?: string }, today: string) {
  const startDate = query.startDate || today, endDate = query.endDate || addCapacityDays(startDate, 13);
  for (const value of [startDate, endDate]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(capacityDay(value)) || capacityDate(capacityDay(value)) !== value) throw new Error("Informe datas válidas.");
  }
  if (startDate < today || endDate < startDate || (capacityDay(endDate) - capacityDay(startDate)) / CAPACITY_DAY >= 31) throw new Error("Selecione de 1 a 31 dias, a partir de hoje.");
  const shift = query.shift || "Todos";
  if (shift !== "Todos" && !CAPACITY_SHIFTS.includes(shift as CapacityShift)) throw new Error("Turno inválido.");
  return { startDate, endDate, shift };
}

/** Assign overlapping minutes once, to the earliest-starting schedule (stable ID tie-break). */
export function uniqueCapacityIntervals(schedules: CapacitySchedule[]) {
  const lastEnd = new Map<string, number>(), ids = new Set<string>();
  return [...schedules].sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity) || a.id.localeCompare(b.id)).flatMap<CapacitySchedule>((row) => {
    if (ids.has(row.id)) return []; ids.add(row.id);
    if (row.start === null || row.end === null || row.end <= row.start) return [{ ...row, start: null, end: null }];
    const start = Math.max(row.start, lastEnd.get(row.employeeId) ?? -Infinity);
    lastEnd.set(row.employeeId, Math.max(row.end, lastEnd.get(row.employeeId) ?? -Infinity));
    return start < row.end ? [{ ...row, start }] : [];
  });
}

export function buildCapacityRates(schedules: CapacitySchedule[], production: CapacityProduction[], presence: Set<string>, clock: number) {
  const rates = new Map<string, CapacityRate>();
  const hoursByEmployee = new Map<string, Map<number, { submit: number; valid: boolean }>>();
  for (const row of production) {
    const hours = hoursByEmployee.get(row.employeeId) ?? new Map();
    const hour = Math.floor(row.at / CAPACITY_HOUR) * CAPACITY_HOUR;
    const old = hours.get(hour);
    hours.set(hour, { submit: (old?.submit ?? 0) + row.submit, valid: (old?.valid ?? true) && row.valid && row.at === hour });
    hoursByEmployee.set(row.employeeId, hours);
  }
  const matchedHours = new Map<string, Set<number>>();
  for (const schedule of uniqueCapacityIntervals(schedules)) {
    const rate = rates.get(schedule.employeeId) ?? { rate: null, source: "missing" as const, validShifts: 0, hours: 0, submit: 0, incompleteShifts: 0, outsideSubmit: 0 };
    rates.set(schedule.employeeId, rate);
    if (schedule.start === null || schedule.end === null || schedule.end > clock) { rate.incompleteShifts++; continue; }
    const rows = hoursByEmployee.get(schedule.employeeId);
    const matched = matchedHours.get(schedule.employeeId) ?? new Set<number>();
    matchedHours.set(schedule.employeeId, matched);
    let submit = 0, observed = 0;
    // Partial boundary buckets cannot establish how many submits occurred inside the schedule.
    let complete = schedule.start % CAPACITY_HOUR === 0 && schedule.end % CAPACITY_HOUR === 0;
    for (let at = Math.floor(schedule.start / CAPACITY_HOUR) * CAPACITY_HOUR; at < schedule.end; at += CAPACITY_HOUR) {
      const row = rows?.get(at);
      if (row) matched.add(at);
      if (!row || !row.valid) { complete = false; continue; }
      submit += row.submit; observed++;
    }
    const worked = submit > 0 || presence.has(schedule.id) || ["PRESENTE", "ATRASO", "SAIDA_ANTECIPADA"].includes(schedule.status);
    if (!complete || !observed || !worked) { rate.incompleteShifts++; continue; }
    rate.validShifts++; rate.hours += (schedule.end - schedule.start) / CAPACITY_HOUR; rate.submit += submit;
  }
  for (const [id, rate] of rates) {
    for (const [hour, row] of hoursByEmployee.get(id) ?? []) if (!matchedHours.get(id)?.has(hour)) rate.outsideSubmit += row.submit;
    if (rate.validShifts >= 3 && rate.hours > 0) { rate.rate = rate.submit / rate.hours; rate.source = "individual"; }
  }
  const skillTotals = new Map<string, { submit: number; hours: number }>(), seen = new Set<string>();
  for (const schedule of schedules) {
    if (seen.has(schedule.employeeId)) continue; seen.add(schedule.employeeId);
    const rate = rates.get(schedule.employeeId), key = capacitySkill(schedule.skill);
    if (!key || rate?.source !== "individual") continue;
    const total = skillTotals.get(key) ?? { submit: 0, hours: 0 };
    total.submit += rate.submit; total.hours += rate.hours; skillTotals.set(key, total);
  }
  return { rates, skillTotals };
}

export function buildAdsCapacityPlan(input: {
  schedules: CapacitySchedule[]; history: ReturnType<typeof buildCapacityRates>;
  requirements: Array<{ date: string; shift: string; required: number }>;
  forecast: ExecutiveForecastPoint[]; startDate: string; endDate: string; shift: string;
  templates: Array<{ shift: string; startsAt: string; endsAt: string }>;
}) {
  const days: string[] = [];
  for (let d = input.startDate; d <= input.endDate; d = addCapacityDays(d, 1)) days.push(d);
  const rows = new Map<string, CapacityRow>();
  const makeRow = (date: string, shift: string): CapacityRow => ({ key: `${date}|${shift}`, date, shift, scheduled: 0, required: null, capacity: 0, forecast: input.forecast.length ? 0 : null, gap: null, coverage: null, calculatedRequired: null, peopleGap: null, registeredGap: null, missing: 0, individual: 0, skill: 0, state: "incomplete", agents: [] });
  for (const date of days) for (const shift of CAPACITY_SHIFTS) rows.set(`${date}|${shift}`, makeRow(date, shift));
  for (const requirement of input.requirements) {
    const row = rows.get(`${requirement.date}|${requirement.shift}`);
    if (row) row.required = requirement.required;
  }
  const schedules = uniqueCapacityIntervals(input.schedules);
  for (const schedule of schedules) {
    const row = rows.get(`${schedule.date}|${schedule.shift}`); if (!row) continue;
    let rate: CapacityRate = { ...(input.history.rates.get(schedule.employeeId) ?? { rate: null, source: "missing", validShifts: 0, hours: 0, submit: 0, incompleteShifts: 0, outsideSubmit: 0 }) };
    if (rate.rate === null) {
      const fallback = input.history.skillTotals.get(capacitySkill(schedule.skill));
      if (fallback && fallback.hours > 0) rate = { ...rate, rate: fallback.submit / fallback.hours, source: "skill" };
    }
    const plannedHours = schedule.start !== null && schedule.end !== null ? (schedule.end - schedule.start) / CAPACITY_HOUR : null;
    const capacity = plannedHours !== null && rate.rate !== null ? plannedHours * rate.rate : null;
    row.agents.push({ ...schedule, ...rate, plannedHours, capacity });
    row.capacity += capacity ?? 0; if (capacity === null) row.missing++; else row[rate.source === "individual" ? "individual" : "skill"]++;
  }
  // Include canonical windows even on a completely unstaffed day. No invented shift times.
  const bounds = days.flatMap((date) => input.templates.flatMap((template) => {
    const start = Date.parse(`${date}T${template.startsAt.slice(0, 5)}:00Z`);
    let end = Date.parse(`${date}T${template.endsAt.slice(0, 5)}:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
    if (end <= start) end += CAPACITY_DAY;
    return [start, end];
  }));
  for (const schedule of schedules) if (rows.has(`${schedule.date}|${schedule.shift}`) && schedule.start !== null && schedule.end !== null) bounds.push(schedule.start, schedule.end);
  const start = bounds.length ? Math.min(...bounds) : capacityDay(input.startDate);
  const end = bounds.length ? Math.max(...bounds) : capacityDay(addCapacityDays(input.endDate, 1));
  const anchor = start - capacityDay(input.startDate);
  let outsideForecast = 0, sourceForecast = 0, coveredMs = 0;
  for (const point of input.forecast) {
    const hour = capacityDay(point.dateKey) + point.hour * CAPACITY_HOUR;
    const a = Math.max(start, hour), b = Math.min(end, hour + CAPACITY_HOUR);
    if (b <= a) continue;
    coveredMs += b - a;
    const available = schedules.filter((s) => s.start !== null && s.end !== null && s.start < b && s.end > a);
    const boundaries = [...new Set([a, b, ...available.flatMap((s) => [Math.max(a, s.start!), Math.min(b, s.end!)])])].sort((x, y) => x - y);
    for (let i = 0; i < boundaries.length - 1; i++) {
      const left = boundaries[i], right = boundaries[i + 1], volume = point.input * (right - left) / CAPACITY_HOUR;
      sourceForecast += volume;
      const active = available.filter((s) => s.start! <= left && s.end! >= right);
      if (!active.length) {
        const date = [input.startDate, capacityDate(left - anchor), input.endDate].sort()[1];
        const key = `${date}|Sem cobertura`, row = rows.get(key) ?? makeRow(date, "Sem cobertura");
        row.forecast = (row.forecast ?? 0) + volume; rows.set(key, row);
      } else for (const schedule of active) {
        const row = rows.get(`${schedule.date}|${schedule.shift}`);
        if (row) row.forecast = (row.forecast ?? 0) + volume / active.length;
        else outsideForecast += volume / active.length;
      }
    }
  }
  const forecastComplete = coveredMs === end - start && input.forecast.length > 0;
  const data = [...rows.values()].map((row) => {
    row.scheduled = new Set(row.agents.map((a) => a.employeeId)).size;
    row.agents.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    if (!forecastComplete) row.forecast = null;
    if (row.required !== null) row.registeredGap = row.scheduled - row.required;
    if (row.forecast !== null && !row.missing) {
      row.gap = row.capacity - row.forecast;
      row.coverage = row.forecast > 0 ? row.capacity / row.forecast * 100 : null;
      if (row.capacity > 0 && row.scheduled > 0) row.calculatedRequired = Math.ceil(row.forecast / (row.capacity / row.scheduled));
      else if (row.forecast === 0 && row.scheduled > 0) row.calculatedRequired = 0;
      row.peopleGap = row.calculatedRequired !== null ? row.scheduled - row.calculatedRequired : null;
      row.state = row.gap >= -1e-8 ? "sufficient" : "deficit";
      if (row.scheduled === 0 && row.shift !== "Sem cobertura") row.state = "incomplete";
    }
    return row;
  }).filter((row) => input.shift === "Todos" || row.shift === input.shift)
    .sort((a, b) => a.date.localeCompare(b.date) || [...CAPACITY_SHIFTS, "Sem cobertura"].indexOf(a.shift) - [...CAPACITY_SHIFTS, "Sem cobertura"].indexOf(b.shift));
  const aggregate = (items: CapacityRow[]) => {
    const capacity = items.reduce((s, r) => s + r.capacity, 0), missing = items.reduce((s, r) => s + r.missing, 0);
    const forecast = forecastComplete ? items.reduce((s, r) => s + (r.forecast ?? 0), 0) : null;
    const agents = items.flatMap((r) => r.agents);
    const reference = { individual: new Set(agents.filter((a) => a.source === "individual").map((a) => a.employeeId)).size,
      skill: new Set(agents.filter((a) => a.source === "skill").map((a) => a.employeeId)).size,
      missing: new Set(agents.filter((a) => a.source === "missing").map((a) => a.employeeId)).size };
    return { capacity, forecast, gap: forecast !== null && !missing ? capacity - forecast : null, missing, reference,
      scheduled: items.reduce((s, r) => s + r.scheduled, 0), individual: items.reduce((s, r) => s + r.individual, 0), skill: items.reduce((s, r) => s + r.skill, 0),
      uncoveredForecast: forecastComplete ? items.filter((r) => r.shift === "Sem cobertura").reduce((s, r) => s + (r.forecast ?? 0), 0) : null };
  };
  return { data, summary: aggregate(data), byDay: days.map((date) => ({ date, ...aggregate(data.filter((row) => row.date === date)) })),
    reconciliation: { sourceForecast, outsideForecast, forecastComplete, start: new Date(start).toISOString(), end: new Date(end).toISOString() } };
}
