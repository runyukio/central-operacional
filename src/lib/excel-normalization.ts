export function hasExcelValue(value: unknown) {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value === "number") return Number.isFinite(value);
  return String(value ?? "").trim() !== "";
}

export function normalizeExcelDate(value: unknown) {
  if (!hasExcelValue(value)) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : dateOnly(value);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return dateOnly(new Date(excelEpoch + value * 24 * 60 * 60 * 1000));
  }

  const raw = String(value ?? "").trim();
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return buildUtcDate(Number(br[3]), Number(br[2]), Number(br[1]));

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return buildUtcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : dateOnly(parsed);
}

export function normalizeExcelTime(value: unknown) {
  if (!hasExcelValue(value)) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return formatTime(value.getUTCHours(), value.getUTCMinutes());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return timeFromExcelNumber(value);
  }

  const raw = String(value ?? "").trim();
  const time = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (time) {
    const hour = Number(time[1]);
    const minute = Number(time[2]);
    const second = Number(time[3] ?? 0);
    if (hour > 23 || minute > 59 || second > 59) return null;
    return formatTime(hour, minute);
  }

  if (/^-?\d+(?:[,.]\d+)?$/.test(raw)) {
    return timeFromExcelNumber(Number(raw.replace(",", ".")));
  }

  return null;
}

function buildUtcDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function dateOnly(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function timeFromExcelNumber(value: number) {
  if (!Number.isFinite(value) || value < 0) return null;
  const fraction = value - Math.floor(value);
  const normalizedFraction = value === 1 ? 1 : fraction;
  let totalMinutes = Math.round(normalizedFraction * 24 * 60);
  if (totalMinutes === 24 * 60) totalMinutes = 0;
  if (totalMinutes < 0 || totalMinutes > 24 * 60) return null;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return formatTime(hour, minute);
}

function formatTime(hour: number, minute: number) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

