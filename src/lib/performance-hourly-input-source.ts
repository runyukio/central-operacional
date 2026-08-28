export type HourlyInputRow = {
  key: string;
  input: number;
};

export function realtimeHourlyInputFallbackRows(
  importedInputBuckets: ReadonlySet<string>,
  realtimeRows: readonly HourlyInputRow[]
) {
  return realtimeRows.filter((row) => !importedInputBuckets.has(row.key));
}
