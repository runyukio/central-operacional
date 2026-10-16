import { CAPACITY_HOUR, capacityDate, capacityDay, uniqueCapacityIntervals, type CapacitySchedule } from "./ads-capacity-core";
import type { ExecutiveForecastPoint } from "./executive-forecast-core";
import { isAbsenceStatus, normalizeOperationalStatus } from "./attendance-calculation";

export const ADS_GLIDE_ABS_RATE = 0.075;
export const ADS_GLIDE_STALE_MINUTES = 90;
export type AdsGlideAgent = CapacitySchedule & { rate: number | null };
export type AdsBacklogGlidePoint = {
  /** Operational São Paulo wall clock encoded as UTC, matching the imported sources. */
  timestamp: number;
  intervalStart: number;
  durationHours: number;
  dateKey: string;
  hour: number;
  forecast: number | null;
  scheduledAgents: number;
  effectiveAgentHours: number;
  averageProductivity: number | null;
  capacity: number | null;
  backlog: number | null;
  missingAgents: number;
};
export type AdsBacklogGlideState = "projected" | "no-clearance" | "incomplete" | "stale";

export function resolveGlideAttendance(agents: AdsGlideAgent[], snapshotTimestamp: number, attendances: Array<{ scheduleId: string | null; employeeId: string; date: string; status: unknown }>) {
  const byEmployeeDate = new Map(agents.map((agent) => [`${agent.employeeId}|${agent.date}`, agent]));
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const confirmedPresent = new Set<string>(), unavailable = new Set<string>();
  const apply = (agent: AdsGlideAgent, value: unknown) => {
    const status = normalizeOperationalStatus(value);
    if (isAbsenceStatus(status) || ["AFASTADO", "FERIAS", "FOLGA", "TREINAMENTO"].includes(status ?? "")) unavailable.add(agent.id);
    if (agent.start !== null && agent.start <= snapshotTimestamp) {
      if (["PRESENTE", "ATRASO"].includes(status ?? "")) confirmedPresent.add(agent.id);
      if (status === "SAIDA_ANTECIPADA") unavailable.add(agent.id);
    }
  };
  for (const agent of agents) apply(agent, agent.status);
  for (const attendance of attendances) {
    const agent = attendance.scheduleId ? byId.get(attendance.scheduleId) : byEmployeeDate.get(`${attendance.employeeId}|${attendance.date}`);
    if (agent) apply(agent, attendance.status);
  }
  return { confirmedPresent, unavailable };
}

/** Presence belongs to the saved shift, never to every future shift of the employee. */
export function buildAdsBacklogGlide(input: {
  snapshotTimestamp: number;
  endTimestamp: number;
  currentBacklog: number | null;
  agents: AdsGlideAgent[];
  forecast: ExecutiveForecastPoint[];
  confirmedPresent?: Set<string>;
  unavailable?: Set<string>;
  stale?: boolean;
  absRate?: number;
}) {
  const absRate = input.absRate ?? ADS_GLIDE_ABS_RATE;
  if (!Number.isFinite(absRate) || absRate < 0 || absRate > 1) throw new Error("ABS inválido.");
  if (!Number.isFinite(input.snapshotTimestamp) || !Number.isFinite(input.endTimestamp) || input.endTimestamp <= input.snapshotTimestamp) {
    return { points: [] as AdsBacklogGlidePoint[], clearanceAt: null, reaccumulates: false, state: (input.stale ? "stale" : "incomplete") as AdsBacklogGlideState };
  }
  const rates = new Map(input.agents.map((agent) => [agent.id, agent.rate]));
  const available = input.agents.filter((agent) => !input.unavailable?.has(agent.id));
  const invalidSchedules = available.some((agent) => agent.start === null || agent.end === null || agent.end <= agent.start);
  const agents = uniqueCapacityIntervals(available);
  const forecasts = new Map<string, number>();
  const invalidForecasts = new Set<string>();
  for (const point of input.forecast) {
    const key = `${point.dateKey}|${point.hour}`;
    if (forecasts.has(key) || !Number.isFinite(point.input) || point.input < 0) invalidForecasts.add(key);
    else forecasts.set(key, point.input);
  }
  let backlog: number | null = input.currentBacklog !== null && Number.isFinite(input.currentBacklog) && input.currentBacklog >= 0 ? input.currentBacklog : null;
  let incomplete = backlog === null || invalidSchedules;
  let firstZero: number | null = backlog === 0 ? input.snapshotTimestamp : null;
  let reaccumulates = false;
  const points: AdsBacklogGlidePoint[] = [];
  for (let start = input.snapshotTimestamp; start < input.endTimestamp;) {
    const hourStart = Math.floor(start / CAPACITY_HOUR) * CAPACITY_HOUR;
    const end = Math.min(hourStart + CAPACITY_HOUR, input.endTimestamp);
    const durationHours = (end - start) / CAPACITY_HOUR;
    const dateKey = capacityDate(start), hour = new Date(start).getUTCHours();
    const key = `${dateKey}|${hour}`, incoming = forecasts.get(key);
    const forecast = incoming === undefined || invalidForecasts.has(key) ? null : incoming * durationHours;
    const active = agents.filter((agent) => agent.start !== null && agent.end !== null && agent.start < end && agent.end > start);
    let effectiveAgentHours = 0, knownCapacity = 0;
    const missing = new Set<string>();
    for (const agent of active) {
      const hours = (Math.min(end, agent.end!) - Math.max(start, agent.start!)) / CAPACITY_HOUR;
      // Confirmed attendance only removes uncertainty for the shift that has already started.
      const present = agent.start! <= input.snapshotTimestamp && (input.confirmedPresent?.has(agent.id) || ["PRESENTE", "ATRASO"].includes(agent.status));
      const effectiveHours = hours * (present ? 1 : 1 - absRate);
      effectiveAgentHours += effectiveHours;
      const rate = rates.get(agent.id);
      if (rate === null || rate === undefined || !Number.isFinite(rate) || rate < 0) missing.add(agent.employeeId);
      else knownCapacity += rate * effectiveHours;
    }
    const capacity = missing.size || invalidSchedules ? null : knownCapacity;
    if (forecast === null || capacity === null) incomplete = true;
    backlog = backlog !== null && forecast !== null && capacity !== null ? Math.max(0, backlog + forecast - capacity) : null;
    if (backlog === 0 && firstZero === null) firstZero = end;
    if (firstZero !== null && backlog !== null && backlog > 0) reaccumulates = true;
    points.push({ timestamp: end, intervalStart: start, durationHours, dateKey, hour, forecast,
      scheduledAgents: new Set(active.map((agent) => agent.employeeId)).size,
      effectiveAgentHours, averageProductivity: capacity !== null && effectiveAgentHours > 0 ? capacity / effectiveAgentHours : null,
      capacity, backlog, missingAgents: missing.size });
    start = end;
  }
  const state: AdsBacklogGlideState = input.stale ? "stale" : incomplete ? "incomplete" : firstZero === null ? "no-clearance" : "projected";
  return { points, clearanceAt: state === "projected" ? firstZero : null, reaccumulates, state };
}

export function glideForecastDates(startTimestamp: number, endTimestamp: number) {
  const dates: string[] = [];
  for (let day = capacityDay(capacityDate(startTimestamp)); day < endTimestamp; day += 24 * CAPACITY_HOUR) dates.push(capacityDate(day));
  return dates;
}
