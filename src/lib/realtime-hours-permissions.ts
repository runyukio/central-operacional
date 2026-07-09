const realtimeHoursMappingAllowedEmails = new Set(["runyukio@gmail.com"]);

export function canManageRealtimeHoursMappings(email?: string | null) {
  return realtimeHoursMappingAllowedEmails.has(String(email ?? "").trim().toLowerCase());
}
