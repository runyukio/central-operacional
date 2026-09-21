import { isRealtimeActiveEmployeeStatus } from "@/lib/realtime-employee-status";

const HOUR = 3_600_000;
export const ADS_ALERT_RULE = { submitBelow: 35, moderationBelowMs: 45 * 60_000 } as const;

export type AlertReading = {
  cycle: string;
  employeeId: string | null;
  name: string;
  wbLogin: string;
  lob: string;
  personType: string;
  employeeStatus: string;
  crossingStatus: string;
  submit: number | null;
  moderationMs: number | null;
  sourceValid: boolean;
  observedPresence: boolean;
  supervisorId: string | null;
  supervisorName: string | null;
  supervisorWb: string | null;
};

export type AlertAgent = Pick<AlertReading, "employeeId" | "name" | "wbLogin" | "supervisorId" | "supervisorName" | "supervisorWb"> & {
  submit: number;
  moderationMs: number;
};

export function alertCycle(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}

// Cycle strings are São Paulo wall-clock values, not UTC instants.
export function parseAlertCycle(cycle: string) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(cycle)) throw new Error("Invalid alert cycle.");
  const timestamp = Date.parse(`${cycle.replace(" ", "T")}:00Z`);
  if (!Number.isFinite(timestamp) || alertCycle(timestamp) !== cycle) throw new Error("Invalid alert cycle.");
  return timestamp;
}

export function latestClosedAlertHour(now: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23"
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const end = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:00`;
  const timestamp = parseAlertCycle(end);
  return { start: alertCycle(timestamp - HOUR), middle: alertCycle(timestamp - HOUR / 2), end };
}

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function eligible(row: AlertReading) {
  return normalized(row.lob) === "ads" && normalized(row.personType) === "agente"
    && normalized(row.crossingStatus) === "encontrado" && isRealtimeActiveEmployeeStatus(row.employeeStatus)
    && Boolean(row.employeeId);
}

function validNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function evaluateAdsProductivityHour(
  readings: AlertReading[],
  interval: ReturnType<typeof latestClosedAlertHour>,
  presenceOnly = false,
  checkpointMinutes: 5 | 30 = 30
) {
  const start = parseAlertCycle(interval.start);
  if (parseAlertCycle(interval.middle) - start !== HOUR / 2 || parseAlertCycle(interval.end) - start !== HOUR) {
    throw new Error("An alert requires one complete hour and its half-hour checkpoint.");
  }
  const cycles = Array.from({ length: 60 / checkpointMinutes + 1 }, (_, index) => alertCycle(start + index * checkpointMinutes * 60_000));
  const byAgent = new Map<string, Map<string, AlertReading[]>>();
  for (const row of readings) {
    if (!cycles.includes(row.cycle) || !row.employeeId) continue;
    const history = byAgent.get(row.employeeId) ?? new Map<string, AlertReading[]>();
    history.set(row.cycle, [...(history.get(row.cycle) ?? []), row]);
    byAgent.set(row.employeeId, history);
  }
  const issues: Array<{ employeeId: string; reason: string }> = [];
  const evaluated: AlertAgent[] = [];
  let outsideInterval = 0;
  for (const [employeeId, history] of byAgent) {
    const current = history.get(interval.end)?.[0];
    if (!current || !eligible(current)) continue;
    if (cycles.some((cycle) => history.get(cycle)?.length !== 1)) {
      issues.push({ employeeId, reason: "missing_or_duplicate_checkpoint" }); continue;
    }
    const points = cycles.map((cycle) => history.get(cycle)![0]);
    if (points.some((point) => !eligible(point) || !point.sourceValid || !validNumber(point.submit)
      || !Number.isInteger(point.submit) || !validNumber(point.moderationMs))) {
      issues.push({ employeeId, reason: "invalid_or_missing_source" }); continue;
    }
    let submit = 0;
    let moderationMs = 0;
    let invalid = false;
    for (let index = 1; index < points.length; index++) {
      const previous = points[index - 1];
      const next = points[index];
      const submitDrop = next.submit! < previous.submit!;
      const moderationDrop = next.moderationMs! < previous.moderationMs!;
      // Same reset-aware contract as the verified hourly ADS extraction.
      // Midnight is NOT a reset. Other counter corrections are not zero production.
      const resetWindow = next.cycle.slice(11) === "13:00" || (checkpointMinutes === 5 && next.cycle.slice(11) === "13:05");
      if ((submitDrop || moderationDrop) && !resetWindow) { invalid = true; break; }
      submit += submitDrop ? next.submit! : next.submit! - previous.submit!;
      moderationMs += moderationDrop ? next.moderationMs! : next.moderationMs! - previous.moderationMs!;
    }
    if (invalid) { issues.push({ employeeId, reason: "unexpected_counter_drop" }); continue; }
    if (presenceOnly && submit === 0 && moderationMs === 0 && !points.some((point) => point.observedPresence)) {
      outsideInterval++; continue;
    }
    evaluated.push({ employeeId, name: current.name, wbLogin: current.wbLogin, supervisorId: current.supervisorId,
      supervisorName: current.supervisorName, supervisorWb: current.supervisorWb, submit, moderationMs });
  }
  const offenders = evaluated.filter((row) => row.submit > 0 && row.submit < ADS_ALERT_RULE.submitBelow && row.moderationMs < ADS_ALERT_RULE.moderationBelowMs)
    .sort((a, b) => (a.supervisorName ?? "").localeCompare(b.supervisorName ?? "") || a.moderationMs - b.moderationMs || a.submit - b.submit || a.wbLogin.localeCompare(b.wbLogin));
  return { interval, evaluatedCount: evaluated.length, offenders, issues, outsideInterval };
}

function safeText(value: string | null, limit = 100) {
  // Imported names must never inject @all, @another-user, or extra message lines.
  return (value ?? "").replace(/[<>@\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

export function kimSupervisorMention(wb: string | null) {
  const username = (wb ?? "").trim();
  return /^[a-zA-Z0-9_.-]{1,80}$/.test(username) && username.toLowerCase() !== "all" ? `<@=username(${username})=>` : "";
}

export function moderationMinutesLabel(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}

export type KimAlertPayload = { msgtype: "text"; text: { content: string } };

export function buildAdsAlertMessages(result: ReturnType<typeof evaluateAdsProductivityHour>): KimAlertPayload[] {
  if (!result.offenders.length) return [];
  const date = result.interval.start.slice(0, 10).split("-").reverse().join("/");
  const endDate = result.interval.start.slice(0, 10) === result.interval.end.slice(0, 10) ? "" : " (dia seguinte)";
  const heading = `ADS | Alerta de produtividade\n${date} · ${result.interval.start.slice(11)} a ${result.interval.end.slice(11)}${endDate} · Brasília\n1 a 34 submits E menos de 45 min de moderação no intervalo.\n${result.offenders.length} agente(s) abaixo dos dois limites.`;
  const footer = `\nLimites fixos, sem desconto de pausas ou ajuste pela jornada.${result.issues.length ? `\n${result.issues.length} agente(s) sem leitura válida não foram classificados como zero.` : ""}`;
  const groups = new Map<string, AlertAgent[]>();
  for (const row of result.offenders) {
    const key = row.supervisorId ?? "missing-supervisor";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const bodies: string[] = [];
  let body = heading;
  for (const rows of groups.values()) {
    const first = rows[0];
    const mention = first.supervisorId ? kimSupervisorMention(first.supervisorWb) : "";
    const groupHeader = `\n\nSupervisor: ${mention ? `${mention} ` : ""}${safeText(first.supervisorName) || "Sem supervisor cadastrado"}${!mention && first.supervisorId ? " (WB KIM não disponível)" : ""}`;
    body += groupHeader;
    for (const row of rows) {
      const line = `\n• ${safeText(row.name)} (${safeText(row.wbLogin, 80)}): ${moderationMinutesLabel(row.moderationMs)} de moderação | ${row.submit} submits`;
      if (Buffer.byteLength(body + line + footer, "utf8") > 6800) {
        bodies.push(body + footer); body = heading + groupHeader;
      }
      body += line;
    }
  }
  bodies.push(body + footer);
  return bodies.map((content, index) => ({ msgtype: "text", text: { content: `${content}${bodies.length > 1 ? `\nParte ${index + 1}/${bodies.length}` : ""}` } }));
}

export function validateAdsAlertWebhook(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Invalid KIM alert webhook configuration."); }
  if (url.protocol !== "https:" || url.hostname !== "kim-robot.kwaitalk.com" || url.pathname !== "/api/robot/send"
    || url.username || url.password || url.port || !url.searchParams.get("key") || url.hash) {
    throw new Error("Invalid KIM alert webhook configuration.");
  }
  return url.toString();
}

export function kimAcceptedMessageKey(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.success === false || (record.status !== undefined && record.status !== 200) || (record.code !== undefined && record.code !== 0)) return null;
  const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : record;
  // KIM documents List<string>, and its example returns that list JSON-encoded.
  let messageKey: unknown = data.messageKey;
  if (typeof messageKey === "string" && messageKey.trim().startsWith("[")) {
    try { messageKey = JSON.parse(messageKey); } catch { return null; }
  }
  if (Array.isArray(messageKey)) return messageKey.length && messageKey.every((item) => typeof item === "string" && item.trim()) ? JSON.stringify(messageKey) : null;
  return typeof messageKey === "string" && messageKey.trim() ? messageKey : null;
}
