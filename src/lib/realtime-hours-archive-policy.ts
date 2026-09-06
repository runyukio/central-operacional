/** Change whenever timeline rules or their input projections change. */
export const REALTIME_HOURS_ARCHIVE_VERSION = "preserved-raw-v2";

export function isRealtimeHoursArchiveFresh(
  archivedFingerprint: string | null | undefined,
  currentFingerprint: string | null | undefined
) {
  return Boolean(archivedFingerprint && currentFingerprint && archivedFingerprint === currentFingerprint);
}

export function selectRealtimeHoursArchiveDates(
  requiredDates: string[],
  existing: Array<{ dateKey: string; updatedAt: Date }>,
  limit: number
) {
  const byDate = new Map(existing.map((day) => [day.dateKey, day]));
  return [...requiredDates].sort((left, right) => {
    const leftDay = byDate.get(left);
    const rightDay = byDate.get(right);
    if (!leftDay && rightDay) return -1;
    if (leftDay && !rightDay) return 1;
    return (leftDay?.updatedAt.getTime() ?? 0) - (rightDay?.updatedAt.getTime() ?? 0)
      || left.localeCompare(right);
  }).slice(0, limit);
}
