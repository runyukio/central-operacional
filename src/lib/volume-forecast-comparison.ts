/** Compare actual volume with the issued reference, never with observed-plus-nowcast hours. */
export function forecastComparisonPoints<T>(series: { baselinePoints?: T[]; points?: T[] } | null | undefined): T[] {
  return series?.baselinePoints ?? series?.points ?? [];
}
