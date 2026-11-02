import { isDirectWfmRequest } from "./request-routing";

const HOUR = 3_600_000;
const wfmStatuses = new Set(["EM_ANALISE", "AGUARDANDO_APROVACAO", "AJUSTE_SOLICITADO"]);
const closedStatuses = new Set(["CONCLUIDO", "RECUSADO", "CANCELADO", "Concluído", "Recusado", "Cancelado"]);
const localParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
});

function parts(date: Date) {
  return Object.fromEntries(localParts.formatToParts(date).map(p => [p.type, Number(p.value)]));
}

function fromLocalWallTime(wall: number) {
  let result = wall;
  for (let i = 0; i < 3; i++) {
    const q = parts(new Date(result));
    result += wall - Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute, q.second);
  }
  return new Date(result);
}

/** Find the next São Paulo midnight without depending on the server's timezone. */
function nextMidnight(date: Date) {
  const p = parts(date);
  return fromLocalWallTime(Date.UTC(p.year, p.month - 1, p.day + 1));
}

export function requestDateBoundary(value: string, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const wall = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(+wall) || wall.toISOString().slice(0, 10) !== value) return null;
  const start = fromLocalWallTime(+wall);
  return endOfDay ? new Date(+nextMidnight(start) - 1) : start;
}

function isWeekend(date: Date) {
  const p = parts(date);
  return [0, 6].includes(new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay());
}

export function businessMillisecondsBetween(start: Date, end: Date): number {
  if (end < start) return -businessMillisecondsBetween(end, start);
  let cursor = start;
  let elapsed = 0;
  while (cursor < end) {
    const p = parts(cursor);
    const week = 7 * 24 * HOUR;
    const weeks = Math.floor((end.getTime() - cursor.getTime()) / week);
    if (weeks > 0 && p.hour === 0 && p.minute === 0 && p.second === 0 && cursor.getMilliseconds() === 0) {
      const afterWeeks = new Date(cursor.getTime() + weeks * week);
      const q = parts(afterWeeks);
      if (q.hour === 0 && q.minute === 0) {
        elapsed += weeks * 5 * 24 * HOUR;
        cursor = afterWeeks;
        continue;
      }
    }
    const boundary = new Date(Math.min(nextMidnight(cursor).getTime(), end.getTime()));
    if (!isWeekend(cursor)) elapsed += boundary.getTime() - cursor.getTime();
    cursor = boundary;
  }
  return elapsed;
}

export function addBusinessHours(start: Date, hours = 48) {
  let cursor = start;
  let remaining = hours * HOUR;
  while (remaining > 0) {
    const midnight = nextMidnight(cursor);
    if (!isWeekend(cursor)) {
      const available = midnight.getTime() - cursor.getTime();
      if (remaining <= available) return new Date(cursor.getTime() + remaining);
      remaining -= available;
    }
    cursor = midnight;
  }
  return cursor;
}

export type RequestTimingEvent = { createdAt: Date; from?: string | null; to: string };
export type RequestSla = {
  receivedAt: string | null;
  closedAt: string | null;
  dueAt: string | null;
  state: "WAITING_WFM" | "WITHIN_DEADLINE" | "OVERDUE" | "UNRECORDED" | "NOT_APPLICABLE";
  closed: boolean;
  remainingBusinessMinutes: number | null;
};

export function calculateRequestSla(input: {
  type: string; status: string; createdAt: Date; payload?: Record<string, unknown> | null;
  history: RequestTimingEvent[];
}, now = new Date()): RequestSla {
  const events = [...input.history].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const entry = events.find(e => wfmStatuses.has(e.to) && !wfmStatuses.has(e.from ?? ""));
  // The paired swap payload is also authoritative evidence of supervisor approval.
  const approvedAt = input.payload?.supervisorApprovedAt;
  const pairedEntry = typeof approvedAt === "string" && Number.isFinite(Date.parse(approvedAt)) ? new Date(approvedAt) : null;
  const received = isDirectWfmRequest(input.type) ? input.createdAt : entry?.createdAt ?? pairedEntry;
  const closed = closedStatuses.has(input.status);
  const closing = closed ? events.find(e => e.to === input.status || e.to === ({ "Concluído": "CONCLUIDO", "Recusado": "RECUSADO", "Cancelado": "CANCELADO" }[input.status]))?.createdAt ?? null : null;
  const result: RequestSla = {
    receivedAt: received?.toISOString() ?? null, closedAt: closing?.toISOString() ?? null,
    dueAt: null, state: "UNRECORDED", closed, remainingBusinessMinutes: null
  };
  if (!received) {
    const beforeWfm = ["ABERTO", "Aberto"].includes(input.status) || ["PARTNER", "SUPERVISOR"].includes(String(input.payload?.stage));
    const endedBeforeWfm = closing && events.some(e => e.createdAt.getTime() === closing.getTime() && e.from === "ABERTO");
    if (beforeWfm && !closed) result.state = "WAITING_WFM";
    else if (endedBeforeWfm) result.state = "NOT_APPLICABLE";
    return result;
  }
  result.dueAt = addBusinessHours(received).toISOString();
  if ((closed && !closing) || (closing && closing < received) || received > now) return result;
  const elapsed = businessMillisecondsBetween(received, closing ?? now);
  result.remainingBusinessMinutes = (48 * HOUR - elapsed) / 60_000;
  result.state = elapsed <= 48 * HOUR ? "WITHIN_DEADLINE" : "OVERDUE";
  return result;
}

export function requestNextAction(input: { type: string; status: string; payload?: Record<string, unknown> | null; supervisor?: string | null; assignee?: string | null }) {
  const status = input.status;
  if (["APROVADO", "Aprovado"].includes(status)) return { nextStep: "Aguardando conclusão", nextOwner: "WFM/Admin" };
  if (closedStatuses.has(status)) return { nextStep: status === "CONCLUIDO" || status === "Concluído" ? "Concluída" : status === "RECUSADO" || status === "Recusado" ? "Encerrada por recusa" : "Cancelada", nextOwner: "Sem próxima ação" };
  if (input.payload?.stage === "PARTNER") return { nextStep: "Aceite do parceiro", nextOwner: String(input.payload.partnerName ?? "Parceiro") };
  if (isDirectWfmRequest(input.type) || wfmStatuses.has(status) || status === "Em análise" || input.payload?.stage === "WFM") {
    return { nextStep: "Análise WFM", nextOwner: input.assignee || "WFM" };
  }
  return { nextStep: "Aprovação do supervisor", nextOwner: input.supervisor || "Supervisor responsável" };
}

export type PipelineRecord = {
  id: string; type: string; title?: string; status: string; requester: string; requesterWbLogin?: string;
  requesterEmail?: string; description?: string; area?: string; supervisor?: string; assignee?: string;
  nextStep?: string; nextOwner?: string; createdAtIso?: string; sla?: RequestSla;
};
export type PipelineSummary = {
  total: number; byStatus: Record<string, number>; open: number; inAnalysis: number;
  awaitingCompletion: number; withinDeadline: number; overdue: number;
  oldestPending: { id: string; createdAt: string } | null;
};

export function requestMatchesSearch(record: PipelineRecord, search = "") {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const haystack = normalize([record.id, record.type, record.title, record.requester, record.requesterWbLogin,
    record.requesterEmail, record.description, record.area, record.supervisor, record.assignee, record.nextOwner, record.nextStep].filter(Boolean).join(" "));
  return normalize(search).trim().split(/\s+/).every(term => haystack.includes(term));
}

export function requestMatchesDeadline(record: PipelineRecord, deadline?: string) {
  if (!deadline || deadline === "Todos") return true;
  return !record.sla?.closed && record.sla?.state === deadline;
}

export function summarizePipeline(records: PipelineRecord[]): PipelineSummary {
  const summary: PipelineSummary = { total: records.length, byStatus: {}, open: 0, inAnalysis: 0, awaitingCompletion: 0, withinDeadline: 0, overdue: 0, oldestPending: null };
  for (const record of records) {
    summary.byStatus[record.status] = (summary.byStatus[record.status] ?? 0) + 1;
    if (record.status === "Aberto") summary.open++;
    if (record.status === "Em análise") summary.inAnalysis++;
    if (record.status === "Aprovado") summary.awaitingCompletion++;
    if (closedStatuses.has(record.status)) continue;
    if (record.sla?.state === "WITHIN_DEADLINE") summary.withinDeadline++;
    if (record.sla?.state === "OVERDUE") summary.overdue++;
    if (record.createdAtIso && (!summary.oldestPending || record.createdAtIso < summary.oldestPending.createdAt)) {
      summary.oldestPending = { id: record.id, createdAt: record.createdAtIso };
    }
  }
  return summary;
}

export function selectPipeline<T extends PipelineRecord>(records: T[], filters: { search?: string; deadline?: string; status?: string; sort?: string; page?: string | number; limit?: string | number }) {
  const base = records.filter(record => requestMatchesSearch(record, filters.search) && requestMatchesDeadline(record, filters.deadline));
  const matching = base.filter(record => !filters.status || filters.status === "Todos" || (filters.status === "Pendentes" ? !closedStatuses.has(record.status) : record.status === filters.status));
  matching.sort((a, b) => {
    if (filters.sort === "oldest") {
      if (!a.createdAtIso && b.createdAtIso) return 1;
      if (!b.createdAtIso && a.createdAtIso) return -1;
      return (a.createdAtIso ?? "").localeCompare(b.createdAtIso ?? "") || a.id.localeCompare(b.id);
    }
    if (filters.sort === "deadline") {
      const aDue = a.sla?.dueAt ? Date.parse(a.sla.dueAt) : Infinity;
      const bDue = b.sla?.dueAt ? Date.parse(b.sla.dueAt) : Infinity;
      if (aDue === Infinity && bDue !== Infinity) return 1;
      if (bDue === Infinity && aDue !== Infinity) return -1;
      const activeA = a.sla?.closed ? 1 : 0;
      const activeB = b.sla?.closed ? 1 : 0;
      if (activeA !== activeB) return activeA - activeB;
      if (aDue !== bDue) return aDue - bDue;
    }
    return (b.createdAtIso ?? "").localeCompare(a.createdAtIso ?? "") || b.id.localeCompare(a.id);
  });
  const requestedLimit = Number(filters.limit);
  const limit = [25, 50, 100].includes(requestedLimit) ? requestedLimit : 50;
  const totalPages = Math.max(1, Math.ceil(matching.length / limit));
  const page = Math.min(totalPages, Math.max(1, Math.floor(Number(filters.page) || 1)));
  return {
    data: matching.slice((page - 1) * limit, page * limit), total: matching.length, page, limit, totalPages,
    summary: summarizePipeline(matching), statusSummary: summarizePipeline(base), calculatedAt: new Date().toISOString()
  };
}

export function formatPipelineDate(value?: string | null) {
  return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";
}

export function formatPipelineDuration(minutes: number) {
  const rounded = Math.ceil(Math.abs(minutes));
  return `${Math.floor(rounded / 60)}h ${String(rounded % 60).padStart(2, "0")}min`;
}
