/** Only the generic WFM request bypasses the supervisor approval stage. */
export function isDirectWfmRequest(type: string) {
  return type.trim().toUpperCase() === "WFM";
}
