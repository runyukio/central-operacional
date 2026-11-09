/** Historical windows refresh on user action/focus, not on the live-data timer. */
export function activityWindowIncludesToday(startDate: string, endDate = startDate, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(now);
  return /^\d{4}-\d{2}-\d{2}$/.test(startDate)
    && /^\d{4}-\d{2}-\d{2}$/.test(endDate)
    && startDate <= today && today <= endDate;
}
