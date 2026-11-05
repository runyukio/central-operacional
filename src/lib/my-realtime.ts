import { buildRealtimeHoursPlannedShifts, type RealtimeHoursScheduleSlot } from "@/lib/realtime-hours-timeline";

export type PersonalSourceStatus = "complete" | "partial" | "unavailable";
type PersonalCounters = { submit: number; moderationMs: number; refresh: number; timeout: number };
export type PersonalMetrics = PersonalCounters & { ahtMs: number | null };
export type PersonalInterval = {
  start: string; end: string; cycle: string | null; hour?: string;
  metrics: PersonalMetrics | null; cpd: number | null;
  status: PersonalSourceStatus; capturedMs: number | null;
};
export type PersonalShift = {
  date: string; start: string; end: string; observedUntil: string; startsAt: string; endsAt: string;
};
export type MyRealtimePayload = {
  success: true;
  queriedAt: string;
  employee: { fullName: string; wbLogin: string; lob: string };
  kind: "moderation" | "cec";
  shiftState: "active" | "no_schedule" | "outside_shift";
  shift: PersonalShift | null;
  productivity: {
    status: PersonalSourceStatus; metrics: PersonalMetrics | null; cpd: number | null;
    lastCycle: string | null; importedAt: string | null; message?: string; resetCycles?: string[];
  };
  capture: { status: PersonalSourceStatus; capturedMs: number | null; lastSeenAt: string | null; message?: string };
  intervals: PersonalInterval[];
};

export const normalizePersonalWb = (value: string) => value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "");
export const normalizePersonalName = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");

export function resolvePersonalShift(schedules: RealtimeHoursScheduleSlot[], now: Date) {
  const planned = buildRealtimeHoursPlannedShifts(schedules);
  const active = planned.filter((shift) => Date.parse(shift.start) <= now.getTime() && now.getTime() < Date.parse(shift.end));
  if (active.length !== 1) return {
    shiftState: active.length > 1 || !schedules.length ? "no_schedule" as const : "outside_shift" as const,
    shift: null
  };
  const shift = active[0];
  return {
    shiftState: "active" as const,
    shift: { date: shift.sourceDate, start: shift.start, end: shift.end, observedUntil: now.toISOString(), startsAt: shift.startsAt, endsAt: shift.endsAt }
  };
}

// Cycle labels are local São Paulo wall-clock times, not UTC timestamps.
export function personalCycleTime(cycle: string) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(cycle)) return NaN;
  const at = Date.parse(`${cycle.replace(" ", "T")}:00-03:00`);
  return Number.isFinite(at) && new Date(at - 3 * 3_600_000).toISOString().slice(0, 16).replace("T", " ") === cycle ? at : NaN;
}

export type PersonalReading = {
  cycleDownload: string; importedAt: string;
  submit: number | null; moderationMs: number | null; refresh: number | null; timeout: number | null;
};

const emptyMetrics = (): PersonalMetrics => ({ submit: 0, moderationMs: 0, refresh: 0, timeout: 0, ahtMs: null });
const metricKeys = ["submit", "moderationMs", "refresh", "timeout"] as const;

function validMetrics(reading: PersonalReading): reading is PersonalReading & PersonalCounters {
  return metricKeys.every((key) => typeof reading[key] === "number" && Number.isFinite(reading[key]) && reading[key]! >= 0
    && (key === "moderationMs" || Number.isInteger(reading[key])));
}

export function calculatePersonalModeration(shift: PersonalShift, readings: PersonalReading[]) {
  const start = Date.parse(shift.start), end = Date.parse(shift.observedUntil);
  const latest = new Map<string, PersonalReading>();
  for (const reading of readings) {
    const at = personalCycleTime(reading.cycleDownload);
    if (at < start || at > end || !Number.isFinite(at)) continue;
    const previous = latest.get(reading.cycleDownload);
    if (!previous || reading.importedAt > previous.importedAt) latest.set(reading.cycleDownload, reading);
  }
  const points = [...latest.values()].sort((a, b) => a.cycleDownload.localeCompare(b.cycleDownload));
  const intervals: PersonalInterval[] = [];
  let cursor = start;
  let validIntervals = 0;
  const totals = emptyMetrics();
  const resetCycles = new Set<string>();
  for (let index = 0; index < points.length; index++) {
    const current = points[index], at = personalCycleTime(current.cycleDownload), previous = points[index - 1];
    if (at === cursor) continue;
    const validPair = previous && personalCycleTime(previous.cycleDownload) === cursor
      && at - cursor <= 30 * 60_000 && validMetrics(previous) && validMetrics(current);
    // Same contract as the operational hourly alerts: upstream midnight is
    // 13:00 in São Paulo. Local midnight never resets the operational shift.
    const resetWindow = ["13:00", "13:05"].includes(current.cycleDownload.slice(11));
    const dropped = validPair && metricKeys.some((key) => current[key]! < previous[key]!);
    const known = validPair && (!dropped || resetWindow);
    const metrics = known ? emptyMetrics() : null;
    if (metrics && previous) {
      if (dropped) resetCycles.add(current.cycleDownload);
      // Keep production already observed before the upstream reset. A drop
      // outside that reset window is a correction/missing evidence, not output.
      for (const key of metricKeys) {
        metrics[key] = current[key]! >= previous[key]! ? current[key]! - previous[key]! : current[key]!;
        totals[key] += metrics[key];
      }
      metrics.ahtMs = metrics.submit > 0 ? metrics.moderationMs / metrics.submit : null;
      validIntervals++;
    }
    intervals.push({ start: new Date(cursor).toISOString(), end: new Date(at).toISOString(), cycle: current.cycleDownload,
      metrics, cpd: null, status: known ? "complete" : "partial", capturedMs: null });
    cursor = at;
  }
  if (cursor < end) intervals.push({ start: new Date(cursor).toISOString(), end: new Date(end).toISOString(), cycle: null,
    metrics: null, cpd: null, status: "partial", capturedMs: null });
  const last = points[points.length - 1];
  totals.ahtMs = totals.submit > 0 ? totals.moderationMs / totals.submit : null;
  return {
    intervals,
    productivity: {
      status: !validIntervals ? "unavailable" as const : intervals.some((item) => item.status !== "complete") ? "partial" as const : "complete" as const,
      metrics: validIntervals ? totals : null, cpd: null,
      lastCycle: last?.cycleDownload ?? null, importedAt: last?.importedAt ?? null, resetCycles: [...resetCycles]
    }
  };
}

/** Natural clock hours in chronological order, with no proportional estimates. */
export function personalHourlyIntervals(shift: PersonalShift, intervals: PersonalInterval[], kind: MyRealtimePayload["kind"]) {
  const start = Date.parse(shift.start), observed = Date.parse(shift.observedUntil);
  const firstHour = Math.floor(start / 3_600_000) * 3_600_000;
  const hours: PersonalInterval[] = [];
  let unallocated = false;
  for (let hour = firstHour; hour <= observed; hour += 3_600_000) {
    const left = Math.max(start, hour), right = Math.min(observed, hour + 3_600_000);
    const row: PersonalInterval = { hour: new Date(hour).toISOString(), start: new Date(left).toISOString(), end: new Date(right).toISOString(),
      cycle: null, metrics: null, cpd: null, status: "unavailable", capturedMs: null };
    if (kind === "cec") {
      // CPD remains a snapshot. Select the last cycle within this clock hour;
      // never sum snapshots or present their values as hourly production.
      const snapshots = intervals.filter((item) => item.cycle && personalCycleTime(item.cycle) >= left && personalCycleTime(item.cycle) < hour + 3_600_000
        && personalCycleTime(item.cycle) <= observed).sort((a, b) => a.cycle!.localeCompare(b.cycle!));
      const latest = snapshots[snapshots.length - 1];
      if (latest) Object.assign(row, { cycle: latest.cycle, cpd: latest.cpd, status: latest.status });
    } else {
      const pieces = intervals.filter((item) => Date.parse(item.start) < right && Date.parse(item.end) > left);
      const totals = emptyMetrics();
      let hasMetrics = false, complete = pieces.length > 0, coveredUntil = left;
      for (const piece of pieces) {
        const a = Date.parse(piece.start), b = Date.parse(piece.end);
        if (a < left || b > right) {
          // No reading at the hour boundary: preserve this observed piece in
          // the shift total, but do not arbitrarily allocate it between hours.
          if (piece.metrics) unallocated = true;
          complete = false;
          continue;
        }
        if (a !== coveredUntil || piece.status !== "complete") complete = false;
        coveredUntil = b;
        if (!piece.metrics) continue;
        hasMetrics = true;
        for (const key of metricKeys) totals[key] += piece.metrics[key];
        row.cycle = piece.cycle;
      }
      if (hasMetrics) {
        totals.ahtMs = totals.submit > 0 ? totals.moderationMs / totals.submit : null;
        row.metrics = totals;
      }
      row.status = hasMetrics && complete && coveredUntil === right && right === hour + 3_600_000 && left === hour ? "complete" : "partial";
    }
    hours.push(row);
  }
  return { intervals: hours, unallocated };
}

export type PersonalCaptureRow = {
  employeeId: string; wbLogin: string; lastSeenAt: string;
  segments: Array<{ type: string; start: string; end: string }>;
};

export function personalCapture(rows: PersonalCaptureRow[], employee: { id: string; wbLogin: string }, start: string, end: string) {
  const left = Date.parse(start), right = Date.parse(end);
  const own = rows.filter((row) => row.employeeId ? row.employeeId === employee.id : normalizePersonalWb(row.wbLogin) === normalizePersonalWb(employee.wbLogin));
  const signals = own.map((row) => row.lastSeenAt).filter((at) => Date.parse(at) >= left && Date.parse(at) <= right).sort();
  const active = own.flatMap((row) => row.segments).filter((segment) => segment.type === "ACTIVE")
    .map((segment) => [Math.max(left, Date.parse(segment.start)), Math.min(right, Date.parse(segment.end))])
    .filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  if (!signals.length && !active.length) return { status: "unavailable" as const, capturedMs: null, lastSeenAt: null };
  let capturedMs = 0, coveredUntil = left;
  for (const [a, b] of active) {
    capturedMs += Math.max(0, b - Math.max(a, coveredUntil));
    coveredUntil = Math.max(coveredUntil, b);
  }
  const lastSeenAt = signals[signals.length - 1] ?? null;
  return { status: !lastSeenAt || right - Date.parse(lastSeenAt) > 180_000 ? "partial" as const : "complete" as const,
    capturedMs, lastSeenAt };
}

// CPD imports identify people by full name. Never use fuzzy/partial matching.
export function personalCecCpd(raw: unknown, fullName: string, matchingProfiles: number): number | null {
  if (matchingProfiles !== 1 || !raw || typeof raw !== "object") return null;
  const data = raw as { agents?: unknown; tickets?: unknown };
  const name = normalizePersonalName(fullName);
  if (!name || name === "sem agente") return null;
  if (Array.isArray(data.agents)) {
    const matches = data.agents.filter((agent): agent is { agentName: string; cpd: number } =>
      !!agent && typeof agent === "object" && typeof agent.agentName === "string" && normalizePersonalName(agent.agentName) === name);
    return matches.length === 1 && Number.isInteger(matches[0].cpd) && matches[0].cpd >= 0 ? matches[0].cpd : null;
  }
  if (!Array.isArray(data.tickets)) return null;
  const ids = new Set<string>();
  for (const ticket of data.tickets) {
    if (ticket && typeof ticket === "object" && typeof ticket.agentName === "string" && normalizePersonalName(ticket.agentName) === name
      && typeof ticket.ticket === "string" && ticket.ticket.trim()) ids.add(normalizePersonalName(ticket.ticket));
  }
  // Absence in an export is not proof of a zero count.
  return ids.size ? ids.size : null;
}
