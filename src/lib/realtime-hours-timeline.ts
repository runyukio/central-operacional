import { shiftCategoryName } from "@/lib/shift-display";

export type RealtimeHoursPresenceStatus = "ONLINE" | "LOCKED" | "OFFLINE" | "IDLE";
export type RealtimeHoursShiftFilter = "ALL" | "MANHA" | "TARDE" | "NOITE";
export type RealtimeHoursScheduleFilter = "ALL" | "SCHEDULED";

type TimelineSegment = {
  type: "ACTIVE" | "NO_ACTIVITY";
  start: string;
  end: string;
  durationMs: number;
};

export type RealtimeHoursPlannedShift = {
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
  row: Pick<RealtimeHoursTimelineFilterRow, "plannedShifts" | "segments">,
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
  const activeSegments = row.segments
    .filter((segment) => segment.type === "ACTIVE")
    .map((segment) => ({ start: new Date(segment.start).getTime(), end: new Date(segment.end).getTime() }))
    .filter((segment) => segment.end > plannedStart && segment.start < plannedEnd);
  const firstActiveAt = activeSegments.length ? Math.max(plannedStart, activeSegments[0].start) : null;
  const lastActiveAt = activeSegments.length ? Math.min(plannedEnd, activeSegments[activeSegments.length - 1].end) : null;
  const arrivalDelayMs = firstActiveAt !== null
    ? Math.max(0, firstActiveAt - plannedStart)
    : observedUntil > plannedStart
      ? Math.max(0, Math.min(observedUntil, plannedEnd) - plannedStart)
      : 0;
  const shiftFinished = observedUntil >= plannedEnd;
  const earlyDepartureMs = shiftFinished && lastActiveAt !== null ? Math.max(0, plannedEnd - lastActiveAt) : 0;
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
