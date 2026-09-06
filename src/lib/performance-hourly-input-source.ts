export type HourlyInputRow = {
  key: string;
  input: number;
};

export function needsRealtimeHourlyInputFallback(imported: ReadonlySet<string>, start: Date, end: Date) {
  const last = new Date(end);
  last.setUTCHours(23, 0, 0, 0);
  for (let at = start.getTime(); at <= last.getTime(); at += 3_600_000) {
    const date = new Date(at);
    const key = `${date.toISOString().slice(0, 10)} ${String(date.getUTCHours()).padStart(2, "0")}:00`;
    if (!imported.has(key)) return true;
  }
  return false;
}

export function realtimeHourlyInputFallbackRows(
  importedInputBuckets: ReadonlySet<string>,
  realtimeRows: readonly HourlyInputRow[]
) {
  return realtimeRows.filter((row) => !importedInputBuckets.has(row.key));
}
