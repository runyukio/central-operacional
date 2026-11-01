// Real Time cycles are already wall-clock times in America/Sao_Paulo.
// Use UTC only as a timezone-independent arithmetic axis for those labels.
export type CaptureProductivitySlot = {
  id: string; wbLogin: string; date: string; startsAt: string | null; endsAt: string | null;
};

export type CaptureProductivity = {
  status: "complete" | "partial" | "unavailable";
  submit: number | null;
  moderationMs: number | null;
};

export type CaptureProductivityReading = {
  cycleDownload: string; wbLoginNormalized: string | null;
  submit: number | null; moderationMs: number | null;
};

export const normalizeProductivityWb = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "");

export function captureProductivityWindow(slot: CaptureProductivitySlot) {
  const validTime = (value: string | null): value is string => !!value && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (!validTime(slot.startsAt) || !validTime(slot.endsAt)) return null;
  const start = Date.parse(`${slot.date}T${slot.startsAt}:00Z`);
  let end = Date.parse(`${slot.date}T${slot.endsAt}:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (end <= start) end += 86_400_000;
  return { start, end };
}

export function calculateCaptureProductivity(slot: CaptureProductivitySlot, readings: CaptureProductivityReading[]): CaptureProductivity {
  const unavailable: CaptureProductivity = { status: "unavailable", submit: null, moderationMs: null };
  const window = captureProductivityWindow(slot);
  if (!window) return unavailable;
  const wb = normalizeProductivityWb(slot.wbLogin);
  const byCycle = new Map<string, CaptureProductivityReading | null>();
  for (const reading of readings) {
    if (!byCycle.has(reading.cycleDownload)) byCycle.set(reading.cycleDownload, null);
    if (reading.wbLoginNormalized === wb) byCycle.set(reading.cycleDownload, reading);
  }
  const points = [...byCycle].map(([cycle, reading]) => ({ at: Date.parse(`${cycle.replace(" ", "T")}:00Z`), reading }))
    .filter((point) => point.at >= window.start && point.at <= window.end).sort((a, b) => a.at - b.at);
  const valid = (reading: CaptureProductivityReading | null): reading is CaptureProductivityReading & { submit: number; moderationMs: number } =>
    reading !== null && Number.isInteger(reading.submit) && reading.submit! >= 0 && Number.isFinite(reading.moderationMs) && reading.moderationMs! >= 0;
  let complete = points[0]?.at === window.start && points[points.length - 1]?.at === window.end;
  let intervals = 0;
  let submit = 0;
  let moderationMs = 0;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const current = points[index];
    if (current.at - previous.at > 30 * 60_000 || !valid(previous.reading) || !valid(current.reading)) {
      complete = false;
      continue;
    }
    // Counters can reset within a shift. Sum each observed delta independently.
    submit += current.reading.submit >= previous.reading.submit ? current.reading.submit - previous.reading.submit : current.reading.submit;
    moderationMs += current.reading.moderationMs >= previous.reading.moderationMs ? current.reading.moderationMs - previous.reading.moderationMs : current.reading.moderationMs;
    intervals++;
  }
  return intervals ? { status: complete ? "complete" : "partial", submit, moderationMs } : unavailable;
}
