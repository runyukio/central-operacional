import { shiftCategoryName } from "@/lib/shift-display";
import { parseWorkHoursToMinutes } from "@/lib/work-hours-rules";

export type RealtimeHoursPresenceStatus = "ONLINE" | "LOCKED" | "OFFLINE" | "IDLE";
export type RealtimeHoursShiftFilter = "ALL" | "MANHA" | "TARDE" | "NOITE";
export type RealtimeHoursScheduleFilter = "ALL" | "SCHEDULED";
export const realtimeHoursTimeZone = "America/Sao_Paulo";

const millisecondsPerMinute = 60_000;
const millisecondsPerHour = 60 * millisecondsPerMinute;
const maximumSlotExtensionMs = 8 * millisecondsPerHour;
const scheduleStatusesWithoutPlannedWork = new Set([
  "AFASTADO",
  "DESLIGADO",
  "ERRO_ESCALA",
  "FERIADO",
  "FERIAS",
  "FOLGA",
  "FOLGA_APROVADA",
  "SEM_ESCALA"
]);
const saoPauloPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: realtimeHoursTimeZone,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

type TimelineSegment = {
  type: "ACTIVE" | "NO_ACTIVITY";
  start: string;
  end: string;
  durationMs: number;
};

export type RealtimeHoursPlannedShift = {
  id: string;
  start: string;
  end: string;
  startsAt: string;
  endsAt: string;
  status: string;
  shift: string;
  sourceDate: string;
  overnight: boolean;
};

export type RealtimeHoursTimelineFilterRow = {
  data: string;
  slotId: string | null;
  hostname: string;
  hostnames: string[];
  windowsUser: string;
  windowsUsers: string[];
  wbLogin: string;
  employeeId: string;
  employeeName: string;
  roleTitle: string;
  lob: string;
  shift: string;
  supervisor: string;
  ipAddress: string;
  currentStatus: string;
  lastSeenAt: string;
  activeMs: number;
  noActivityMs: number;
  entryAt: string | null;
  exitAt: string | null;
  arrivalDelayMs: number;
  earlyDepartureMs: number;
  sessionCount: number;
  plannedShifts: RealtimeHoursPlannedShift[];
  segments: TimelineSegment[];
};

export type RealtimeHoursTimelineFilters = {
  date: string;
  search?: string | null;
  lob?: string | null;
  presence?: string | null;
  supervisor?: string | null;
  shift?: string | null;
  schedule?: string | null;
};

export type RealtimeHoursShiftComparison = {
  label: string;
  tone: "green" | "blue" | "amber" | "red" | "slate";
  plannedShift: RealtimeHoursPlannedShift | null;
  firstActiveAt: number | null;
  lastActiveAt: number | null;
  arrivalDelayMs: number;
  earlyDepartureMs: number;
  observedUntil: number;
};

export type RealtimeHoursShiftDateActivity = {
  plannedShift: RealtimeHoursPlannedShift | null;
  rangeStart: number;
  rangeEnd: number;
  observedUntil: number;
  firstActiveAt: number | null;
  lastActiveAt: number | null;
  activeMs: number;
  noActivityMs: number;
  sessionCount: number;
};

const scheduledStatusKeys = new Set([
  "ESCALADO",
  "TROCA_APROVADA",
  "VENDA_FOLGA_APROVADA",
  "VENDA_DE_FOLGA_APROVADA"
]);

export function filterRealtimeHoursTimelineRows<T extends RealtimeHoursTimelineFilterRow>(
  rows: T[],
  filters: RealtimeHoursTimelineFilters
) {
  const search = normalizeFilterText(filters.search);
  const lob = normalizeFilterKey(filters.lob);
  const presence = normalizeFilterKey(filters.presence);
  const supervisor = normalizeFilterText(filters.supervisor);
  const shift = normalizeFilterKey(filters.shift);
  const schedule = normalizeFilterKey(filters.schedule);

  return rows.filter((row) => {
    if (row.data !== filters.date) return false;
    if (lob && lob !== "ALL" && lob !== "ALL_LOBS" && normalizeLob(row.lob) !== lob) return false;
    if (presence && presence !== "ALL" && normalizeFilterKey(row.currentStatus) !== presence) return false;
    if (supervisor && supervisor !== "all" && normalizeFilterText(row.supervisor || "Sem supervisor") !== supervisor) return false;
    if (shift && shift !== "ALL" && normalizeFilterKey(shiftCategoryName(row.shift)) !== shift) return false;
    if (schedule === "SCHEDULED" && !isRealtimeHoursRowScheduled(row, filters.date)) return false;

    if (!search) return true;
    return normalizeFilterText([
      row.hostname,
      ...row.hostnames,
      row.windowsUser,
      ...row.windowsUsers,
      row.wbLogin,
      row.employeeId,
      row.employeeName,
      row.roleTitle,
      row.lob,
      row.shift,
      row.supervisor,
      row.ipAddress
    ].join(" ")).includes(search);
  });
}

export function isRealtimeHoursRowScheduled(
  row: Pick<RealtimeHoursTimelineFilterRow, "plannedShifts">,
  date: string
) {
  return row.plannedShifts.some((plannedShift) => (
    plannedShift.sourceDate === date
    && scheduledStatusKeys.has(normalizeScheduleStatus(plannedShift.status))
  ));
}

export function primaryRealtimeHoursPlannedShift(
  row: Pick<RealtimeHoursTimelineFilterRow, "plannedShifts">,
  date: string
) {
  return row.plannedShifts.find((shift) => shift.sourceDate === date) ?? row.plannedShifts[0] ?? null;
}

export function realtimeHoursPlannedShiftLabel(
  row: Pick<RealtimeHoursTimelineFilterRow, "plannedShifts">,
  date: string
) {
  const shift = primaryRealtimeHoursPlannedShift(row, date);
  return shift ? `${shift.startsAt} - ${shift.endsAt}` : "Sem escala";
}

export function realtimeHoursShiftDateActivity(
  row: Pick<RealtimeHoursTimelineFilterRow, "plannedShifts" | "segments">,
  date: string,
  calculationEnd: string
): RealtimeHoursShiftDateActivity {
  const plannedShift = primaryRealtimeHoursPlannedShift(row, date);
  const fallbackStart = new Date(`${date}T00:00:00.000-03:00`).getTime();
  const fallbackEnd = new Date(`${date}T23:59:59.999-03:00`).getTime();
  const rangeStart = plannedShift ? new Date(plannedShift.start).getTime() : fallbackStart;
  const rangeEnd = plannedShift ? new Date(plannedShift.end).getTime() : fallbackEnd;
  const calculationEndMs = new Date(calculationEnd).getTime();
  const observedUntil = Math.min(
    rangeEnd,
    Math.max(rangeStart, Number.isFinite(calculationEndMs) ? calculationEndMs : rangeEnd)
  );
  const activeSegments = row.segments
    .filter((segment) => segment.type === "ACTIVE")
    .map((segment) => ({
      start: Math.max(rangeStart, new Date(segment.start).getTime()),
      end: Math.min(observedUntil, new Date(segment.end).getTime())
    }))
    .filter((segment) => segment.end > segment.start)
    .sort((left, right) => left.start - right.start);
  const activeMs = activeSegments.reduce((sum, segment) => sum + segment.end - segment.start, 0);

  return {
    plannedShift,
    rangeStart,
    rangeEnd,
    observedUntil,
    firstActiveAt: activeSegments[0]?.start ?? null,
    lastActiveAt: activeSegments[activeSegments.length - 1]?.end ?? null,
    activeMs,
    noActivityMs: Math.max(0, observedUntil - rangeStart - activeMs),
    sessionCount: activeSegments.length
  };
}

export function realtimeHoursScheduleStatusLabel(status: string) {
  const key = normalizeScheduleStatus(status);
  const labels: Record<string, string> = {
    ATRASO: "Atraso",
    ESCALADO: "Escalado",
    FALTA: "Falta",
    FALTA_INJUSTIFICADA: "Falta injustificada",
    FALTA_JUSTIFICADA: "Falta justificada",
    NESTING: "Nesting",
    PRESENTE: "Presente",
    SAIDA_ANTECIPADA: "Saída antecipada",
    TREINAMENTO: "Treinamento",
    TROCA_APROVADA: "Troca aprovada",
    VENDA_FOLGA_APROVADA: "Venda de folga aprovada",
    VENDA_DE_FOLGA_APROVADA: "Venda de folga aprovada"
  };
  return labels[key] ?? String(status ?? "").trim().replaceAll("_", " ").toLowerCase();
}

export function compareRealtimeHoursPlannedShift(
  row: Pick<
    RealtimeHoursTimelineFilterRow,
    "plannedShifts" | "segments" | "entryAt" | "exitAt" | "arrivalDelayMs" | "earlyDepartureMs"
  >,
  date: string,
  calculationEnd: string
): RealtimeHoursShiftComparison {
  const plannedShift = primaryRealtimeHoursPlannedShift(row, date);
  const observedUntil = new Date(calculationEnd).getTime();
  if (!plannedShift) {
    return {
      label: "Sem escala",
      tone: "slate",
      plannedShift: null,
      firstActiveAt: null,
      lastActiveAt: null,
      arrivalDelayMs: 0,
      earlyDepartureMs: 0,
      observedUntil
    };
  }

  const plannedStart = new Date(plannedShift.start).getTime();
  const plannedEnd = new Date(plannedShift.end).getTime();
  const activity = realtimeHoursShiftDateActivity(row, date, calculationEnd);
  const firstActiveAt = activity.firstActiveAt;
  const lastActiveAt = activity.lastActiveAt;
  const arrivalDelayMs = firstActiveAt !== null
    ? Math.max(0, firstActiveAt - plannedStart)
    : observedUntil > plannedStart
      ? Math.max(0, Math.min(observedUntil, plannedEnd) - plannedStart)
      : 0;
  const shiftFinished = observedUntil >= plannedEnd;
  const earlyDepartureMs = shiftFinished ? Math.max(0, row.earlyDepartureMs) : 0;
  const toleranceMs = 5 * 60_000;

  if (observedUntil < plannedStart) {
    return { label: `Inicia às ${plannedShift.startsAt}`, tone: "blue", plannedShift, firstActiveAt, lastActiveAt, arrivalDelayMs, earlyDepartureMs, observedUntil };
  }
  if (!firstActiveAt) {
    return {
      label: shiftFinished ? "Sem atividade no turno" : "Aguardando entrada",
      tone: shiftFinished ? "red" : "amber",
      plannedShift,
      firstActiveAt,
      lastActiveAt,
      arrivalDelayMs,
      earlyDepartureMs,
      observedUntil
    };
  }
  if (arrivalDelayMs > toleranceMs && earlyDepartureMs > toleranceMs) {
    return {
      label: `${formatCompactMinutes(arrivalDelayMs)} atraso · ${formatCompactMinutes(earlyDepartureMs)} saída`,
      tone: "red",
      plannedShift,
      firstActiveAt,
      lastActiveAt,
      arrivalDelayMs,
      earlyDepartureMs,
      observedUntil
    };
  }
  if (arrivalDelayMs > toleranceMs) {
    return { label: `${formatCompactMinutes(arrivalDelayMs)} de atraso`, tone: "amber", plannedShift, firstActiveAt, lastActiveAt, arrivalDelayMs, earlyDepartureMs, observedUntil };
  }
  if (earlyDepartureMs > toleranceMs) {
    return { label: `${formatCompactMinutes(earlyDepartureMs)} antes`, tone: "red", plannedShift, firstActiveAt, lastActiveAt, arrivalDelayMs, earlyDepartureMs, observedUntil };
  }
  return {
    label: shiftFinished ? "No horário" : "Em jornada",
    tone: shiftFinished ? "green" : "blue",
    plannedShift,
    firstActiveAt,
    lastActiveAt,
    arrivalDelayMs,
    earlyDepartureMs,
    observedUntil
  };
}

export type RealtimeHoursScheduleSlot = {
  id: string;
  employeeId: string;
  date: Date;
  startsAt: string | null;
  endsAt: string | null;
  status: string;
  shift: {
    name: string;
    startsAt: string;
    endsAt: string;
  } | null;
};

export type RealtimeHoursSlotAssignmentWindow = {
  shift: RealtimeHoursPlannedShift;
  assignmentStart: number;
  assignmentEnd: number;
};

export function buildRealtimeHoursPlannedShifts(schedules: RealtimeHoursScheduleSlot[]) {
  const shifts = schedules.flatMap((schedule) => {
    if (scheduleStatusesWithoutPlannedWork.has(normalizeScheduleStatus(schedule.status))) return [];

    const startMinutes = parseWorkHoursToMinutes(schedule.startsAt ?? schedule.shift?.startsAt);
    const endMinutes = parseWorkHoursToMinutes(schedule.endsAt ?? schedule.shift?.endsAt);
    if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) return [];

    const sourceDate = schedule.date.toISOString().slice(0, 10);
    const overnight = endMinutes <= startMinutes;
    const endDate = overnight ? addDateKeyDays(sourceDate, 1) : sourceDate;
    const start = saoPauloDateTime(sourceDate, startMinutes);
    const end = saoPauloDateTime(endDate, endMinutes);

    return [{
      id: schedule.id || `${schedule.employeeId}:${sourceDate}:${formatClockMinutes(startMinutes)}:${formatClockMinutes(endMinutes)}`,
      start: start.toISOString(),
      end: end.toISOString(),
      startsAt: formatClockMinutes(startMinutes),
      endsAt: formatClockMinutes(endMinutes),
      status: schedule.status,
      shift: schedule.shift?.name ?? "",
      sourceDate,
      overnight
    } satisfies RealtimeHoursPlannedShift];
  });

  return Array.from(new Map(shifts.map((shift) => [shift.id, shift])).values())
    .sort((left, right) => left.start.localeCompare(right.start));
}

export function buildRealtimeHoursSlotAssignmentWindows(shifts: RealtimeHoursPlannedShift[]) {
  const sorted = [...shifts].sort((left, right) => left.start.localeCompare(right.start));
  return sorted.map((shift, index) => {
    const slotStart = new Date(shift.start).getTime();
    const slotEnd = new Date(shift.end).getTime();
    const previousEnd = index > 0 ? new Date(sorted[index - 1].end).getTime() : null;
    const nextStart = index < sorted.length - 1 ? new Date(sorted[index + 1].start).getTime() : null;
    const previousBoundary = previousEnd === null
      ? slotStart - maximumSlotExtensionMs
      : previousEnd <= slotStart
        ? previousEnd + (slotStart - previousEnd) / 2
        : slotStart;
    const nextBoundary = nextStart === null
      ? slotEnd + maximumSlotExtensionMs
      : nextStart >= slotEnd
        ? slotEnd + (nextStart - slotEnd) / 2
        : slotEnd;

    return {
      shift,
      assignmentStart: Math.max(slotStart - maximumSlotExtensionMs, previousBoundary),
      assignmentEnd: Math.min(slotEnd + maximumSlotExtensionMs, nextBoundary)
    };
  });
}

export function matchRealtimeHoursPlannedShift(
  capturedAt: Date,
  windows: RealtimeHoursSlotAssignmentWindow[]
) {
  const instant = capturedAt.getTime();
  const candidates = windows.filter((window) => instant >= window.assignmentStart && instant < window.assignmentEnd);
  if (!candidates.length) return null;
  return candidates.reduce((best, candidate) => (
    distanceFromShift(instant, candidate.shift) < distanceFromShift(instant, best.shift) ? candidate : best
  )).shift;
}

export function addDateKeyDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0")
  ].join("-");
}

export function saoPauloDateKey(value: Date) {
  const parts = saoPauloDateTimeParts(value);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function startOfSaoPauloDate(dateKey: string) {
  return saoPauloDateTime(dateKey, 0);
}

export function saoPauloDateTime(dateKey: string, minutesAfterMidnight: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const hours = Math.floor(minutesAfterMidnight / 60);
  const minutes = minutesAfterMidnight % 60;
  const targetAsUtc = Date.UTC(year, month - 1, day, hours, minutes, 0, 0);
  let candidate = targetAsUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = saoPauloDateTimeParts(new Date(candidate));
    const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const difference = representedAsUtc - targetAsUtc;
    if (!difference) break;
    candidate -= difference;
  }

  return new Date(candidate);
}

export function normalizeScheduleStatus(value: unknown) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeLob(value: unknown) {
  return normalizeFilterKey(value) || "SEM_LOB";
}

function normalizeFilterKey(value: unknown) {
  return normalizeScheduleStatus(value);
}

function normalizeFilterText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function formatCompactMinutes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0m";
  const totalMinutes = Math.max(1, Math.round(value / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${hours}h`;
}

function saoPauloDateTimeParts(value: Date) {
  const entries = saoPauloPartsFormatter.formatToParts(value)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)] as const);
  const parts = Object.fromEntries(entries) as Record<string, number>;
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  };
}

function formatClockMinutes(minutes: number) {
  const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function distanceFromShift(instant: number, shift: RealtimeHoursPlannedShift) {
  const start = new Date(shift.start).getTime();
  const end = new Date(shift.end).getTime();
  if (instant < start) return start - instant;
  if (instant > end) return instant - end;
  return 0;
}
