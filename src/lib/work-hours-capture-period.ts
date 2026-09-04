export type CapturePeriod = { startDate: string; endDate: string };
export type CapturePeriodInput = Partial<CapturePeriod> & { shiftDate?: string };
export const MAX_CAPTURE_IMPORT_DAYS = 62;

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}

// Legacy single-day requests/links remain supported; dates always mean Shift Date.
export function resolveCapturePeriod(input: CapturePeriodInput): { error: string } | { period: CapturePeriod; dates: string[] } {
  const startDate = input.startDate ?? input.shiftDate ?? "";
  const endDate = input.endDate ?? input.shiftDate ?? "";
  if (!validDate(startDate) || !validDate(endDate)) {
    return { error: "Selecione uma data inicial e uma data final válidas para a captura." } as const;
  }
  if (input.shiftDate && (input.shiftDate !== startDate || input.shiftDate !== endDate)) {
    return { error: "Informe um intervalo ou um único Shift Date, sem datas conflitantes." } as const;
  }
  if (endDate < startDate) return { error: "A data final não pode ser anterior à data inicial." } as const;
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const days = Math.round((Date.parse(`${endDate}T00:00:00.000Z`) - +start) / 86_400_000) + 1;
  if (days > MAX_CAPTURE_IMPORT_DAYS) return { error: `Selecione um período de até ${MAX_CAPTURE_IMPORT_DAYS} dias por importação.` } as const;
  const dates = Array.from({ length: days }, (_, index) => new Date(+start + index * 86_400_000).toISOString().slice(0, 10));
  return { period: { startDate, endDate }, dates };
}
