const absencePercentFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export function formatAbsencePercentage(scheduled: number, absences: number) {
  // Format the original counts so the API's one-decimal rate does not lose precision.
  const percentage = scheduled > 0 ? (absences / scheduled) * 100 : 0;
  return `${absencePercentFormatter.format(percentage)}%`;
}
