const saoPauloDatePartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export type DateRangeInput = {
  startDate: string;
  endDate: string;
};

export function getDefaultDateRange(now = new Date()): DateRangeInput {
  const today = operationalDateFromParts(saoPauloTodayParts(now));
  const end = new Date(today);
  end.setUTCDate(today.getUTCDate() - 1);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1, 12));
  return {
    startDate: dateInputFromUtc(start),
    endDate: dateInputFromUtc(end)
  };
}

export function getDefaultDatePeriod(now = new Date()) {
  const range = getDefaultDateRange(now);
  return {
    start: parseDateInput(range.startDate) ?? new Date(),
    end: parseDateInput(range.endDate) ?? new Date()
  };
}

function saoPauloTodayParts(now: Date) {
  const parts = saoPauloDatePartsFormatter.formatToParts(now);
  const numberPart = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: numberPart("year"), month: numberPart("month"), day: numberPart("day") };
}

function operationalDateFromParts(parts: { year: number; month: number; day: number }) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
}

function parseDateInput(value: string) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function dateInputFromUtc(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
