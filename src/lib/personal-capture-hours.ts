type CaptureIdentity = { employeeId: string; wbLogin: string; data: string };
export type CanonicalPersonalCaptureRow = CaptureIdentity & {
  activeMs: number; lastSeenAt: string;
  segments: Array<{ type: string; start: string; end: string }>;
};
type Employee = { id: string; wbLogin: string };
type CaptureHour = { start: string; end: string; capturedMs: number | null };
const normalizeWb = (value: string) => value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "");

export function selectOwnCaptureRows<T extends CaptureIdentity>(rows: T[], employee: Employee, date: string) {
  return rows.filter((row) => row.data === date && (row.employeeId
    ? row.employeeId === employee.id
    : !!employee.wbLogin && normalizeWb(row.wbLogin) === normalizeWb(employee.wbLogin)));
}

/** Identical scalar used by Captura de Horas; no second schedule clipping. */
export function capturedHoursTotal(rows: Array<{ activeMs: number }>) {
  return rows.reduce((sum, row) => sum + row.activeMs, 0);
}

export function canonicalPersonalCapture(rows: CanonicalPersonalCaptureRow[], employee: Employee, date: string,
  window: { start: string; end: string }) {
  const own = selectOwnCaptureRows(rows, employee, date);
  const segments = own.flatMap((row) => row.segments);
  const start = Math.min(Date.parse(window.start), ...segments.map((segment) => Date.parse(segment.start)).filter(Number.isFinite));
  const end = Math.max(Date.parse(window.end), ...segments.map((segment) => Date.parse(segment.end)).filter(Number.isFinite));
  const latest = own.map((row) => row.lastSeenAt).filter((value) => Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ?? null;
  return {
    rows: own, start: new Date(start).toISOString(), end: new Date(end).toISOString(),
    summary: {
      status: !own.length ? "unavailable" as const : !latest || end - Date.parse(latest) > 180_000 ? "partial" as const : "complete" as const,
      capturedMs: own.length ? capturedHoursTotal(own) : null, lastSeenAt: latest
    }
  };
}

/** Carry subsecond remainders so hourly display sums to the canonical total. */
export function allocateCapturedHours<T extends CaptureHour>(rows: CanonicalPersonalCaptureRow[], hours: T[]) {
  const sums = hours.map(() => 0), known = hours.map(() => false);
  let complete = true;
  for (const row of rows) {
    const raw = hours.map((hour) => row.segments.filter((segment) => segment.type === "ACTIVE").reduce((sum, segment) =>
      sum + Math.max(0, Math.min(Date.parse(segment.end), Date.parse(hour.end)) - Math.max(Date.parse(segment.start), Date.parse(hour.start))), 0));
    if (Math.floor(raw.reduce((sum, value) => sum + value, 0) / 1_000) * 1_000 !== row.activeMs) {
      complete = false;
      continue;
    }
    let cumulative = 0, allocated = 0;
    hours.forEach((hour, index) => {
      const observed = row.segments.some((segment) => Date.parse(segment.start) < Date.parse(hour.end) && Date.parse(segment.end) > Date.parse(hour.start))
        || Date.parse(row.lastSeenAt) >= Date.parse(hour.start) && Date.parse(row.lastSeenAt) <= Date.parse(hour.end);
      cumulative += raw[index];
      const whole = Math.floor(cumulative / 1_000) * 1_000;
      sums[index] += whole - allocated;
      allocated = whole;
      known[index] ||= observed;
    });
  }
  return { complete, intervals: hours.map((hour, index) => ({ ...hour, capturedMs: complete && known[index] ? sums[index] : null })) };
}

export function formatCapturedHours(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value / 1_000)) : 0;
  return [Math.floor(seconds / 3_600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, "0")).join(":");
}
