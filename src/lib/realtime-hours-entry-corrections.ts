type EntryCorrection = { date: string; employeeId: string; entryAt: string };
type Timeline = {
  date: string;
  rows: Array<{
    employeeId: string; data: string; entryAt: string | null; arrivalDelayMs: number;
    confirmedEntryAt: string | null;
    plannedShifts: Array<{ start: string; end: string }>;
  }>;
};

export function applyRealtimeHoursEntryCorrections<T extends Timeline>(timeline: T, corrections: EntryCorrection[]): T {
  return { ...timeline, rows: timeline.rows.map((row) => {
    const correction = corrections.find((item) => item.date === row.data && item.employeeId === row.employeeId);
    const at = correction ? new Date(correction.entryAt).getTime() : NaN;
    const shift = row.plannedShifts[0];
    // Do not apply an entry to another schedule slot or accept invalid timestamps.
    if (!correction || !shift || !Number.isFinite(at) || at < new Date(shift.start).getTime() || at >= new Date(shift.end).getTime()) return row;
    return { ...row, entryAt: correction.entryAt, confirmedEntryAt: correction.entryAt,
      arrivalDelayMs: Math.max(0, at - new Date(shift.start).getTime()) };
  }) };
}

export function parseRealtimeHoursEntryCorrection(value: unknown): EntryCorrection | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.date !== "string" || typeof item.employeeId !== "string" || typeof item.entryAt !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !item.employeeId || !Number.isFinite(new Date(item.entryAt).getTime())) return null;
  return { date: item.date, employeeId: item.employeeId, entryAt: item.entryAt };
}
