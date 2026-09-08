/** Stored/API values stay in minutes; display ADS and Comments in decimal hours. */
export function latencyUnit(lob: string) {
  return ["ADS", "PROJECT", "COMMENTS", "TNS_COMMENTS"].includes(lob.trim().toUpperCase()) ? "h" : "min";
}
export function latencyDisplayValue(minutes: number | null | undefined, lob: string) {
  return minutes == null ? null : minutes / (latencyUnit(lob) === "h" ? 60 : 1);
}
export function formatLatencyDisplay(minutes: number | null | undefined, lob: string) {
  const value = latencyDisplayValue(minutes, lob);
  return value === null ? "Sem dados" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${latencyUnit(lob)}`;
}
