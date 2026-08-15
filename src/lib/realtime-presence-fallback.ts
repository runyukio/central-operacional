import { isAgentJobTitle } from "@/lib/job-title-normalization";
import { isRealtimeActiveEmployeeStatus } from "@/lib/realtime-employee-status";

type ExistingRealtimeAgentRow = {
  employeeId: string;
  wbLogin: string;
  rawWbLogin: string;
};

export type RealtimeOperationalPresenceCandidate = {
  employeeId: string;
  employeeName: string;
  wbLogin: string;
  roleTitle: string;
  skill: string;
  lob: string;
  shift: string;
  supervisor: string;
  employeeStatus: string;
  status: "ONLINE" | "IDLE" | "LOCKED" | "OFFLINE";
};

export type RealtimePresenceFallbackRow = {
  key: string;
  employeeId: string;
  displayName: string;
  wbLogin: string;
  rawWbLogin: string;
  crossingStatus: "Encontrado";
  personType: "Agente" | "Staff";
  employeeStatus: string;
  presenceStatus: "Online" | "Tela bloqueada" | "Ocioso";
  isScheduled: false;
  isSchedulePresent: false;
  lob: string;
  supervisor: string;
  shift: string;
  skill: string;
  roleTitle: string;
  current: {
    submit: 0;
    ahtMs: null;
    moderationMs: 0;
    timeout: 0;
    refresh: 0;
    queueCount: 0;
    sourceRows: 0;
  };
  previous: null;
  deltas: {
    submit: null;
    ahtMs: null;
    moderationMs: null;
    timeout: null;
    refresh: null;
  };
  history: Array<{
    cycleDownload: string;
    queueIds: string[];
    submit: 0;
    ahtMs: null;
    moderationMs: 0;
    timeout: 0;
    refresh: 0;
  }>;
  queueBreakdown: [];
};

const maximumCurrentCycleAgeMinutes = 60;
const maximumFutureCycleMinutes = 5;

export function buildRealtimePresenceFallbackRows({
  existingRows,
  candidates,
  selectedCycle,
  now = Date.now()
}: {
  existingRows: ExistingRealtimeAgentRow[];
  candidates: RealtimeOperationalPresenceCandidate[];
  selectedCycle: string;
  now?: number;
}): RealtimePresenceFallbackRow[] {
  if (!isCurrentRealtimeCycle(selectedCycle, now)) return [];

  const employeeIds = new Set(existingRows.map((row) => row.employeeId).filter(Boolean));
  const wbLogins = new Set(existingRows.flatMap((row) => [row.wbLogin, row.rawWbLogin]).map(normalizeWbLogin).filter(Boolean));
  const additions: RealtimePresenceFallbackRow[] = [];

  for (const candidate of candidates) {
    const wbLogin = candidate.wbLogin.trim();
    const wbLoginNormalized = normalizeWbLogin(wbLogin);
    if (!candidate.employeeId || !wbLoginNormalized || !candidate.employeeName.trim()) continue;
    if (!isRealtimeActiveEmployeeStatus(candidate.employeeStatus)) continue;
    if (candidate.status === "OFFLINE") continue;
    if (employeeIds.has(candidate.employeeId) || wbLogins.has(wbLoginNormalized)) continue;

    employeeIds.add(candidate.employeeId);
    wbLogins.add(wbLoginNormalized);
    additions.push({
      key: wbLoginNormalized,
      employeeId: candidate.employeeId,
      displayName: candidate.employeeName,
      wbLogin,
      rawWbLogin: wbLogin,
      crossingStatus: "Encontrado",
      personType: isAgentJobTitle(candidate.roleTitle) ? "Agente" : "Staff",
      employeeStatus: candidate.employeeStatus,
      presenceStatus: mapPresenceStatus(candidate.status),
      isScheduled: false,
      isSchedulePresent: false,
      lob: candidate.lob || "Não encontrado",
      supervisor: candidate.supervisor || "Sem supervisor",
      shift: candidate.shift || "Não encontrado",
      skill: candidate.skill || "Não encontrado",
      roleTitle: candidate.roleTitle || "Não encontrado",
      current: {
        submit: 0,
        ahtMs: null,
        moderationMs: 0,
        timeout: 0,
        refresh: 0,
        queueCount: 0,
        sourceRows: 0
      },
      previous: null,
      deltas: {
        submit: null,
        ahtMs: null,
        moderationMs: null,
        timeout: null,
        refresh: null
      },
      history: [{
        cycleDownload: selectedCycle,
        queueIds: [],
        submit: 0,
        ahtMs: null,
        moderationMs: 0,
        timeout: 0,
        refresh: 0
      }],
      queueBreakdown: []
    });
  }

  return additions.sort((left, right) => left.displayName.localeCompare(right.displayName, "pt-BR", { sensitivity: "base" }));
}

function isCurrentRealtimeCycle(value: string, now: number) {
  const match = String(value ?? "").match(/(\d{4})-(\d{2})-(\d{2})[ T_](\d{2}):(\d{2})/);
  if (!match) return false;
  const [, year, month, day, hour, minute] = match;
  const timestamp = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:00-03:00`);
  if (!Number.isFinite(timestamp)) return false;
  const ageMinutes = (now - timestamp) / 60_000;
  return ageMinutes >= -maximumFutureCycleMinutes && ageMinutes <= maximumCurrentCycleAgeMinutes;
}

function mapPresenceStatus(status: RealtimeOperationalPresenceCandidate["status"]): RealtimePresenceFallbackRow["presenceStatus"] {
  if (status === "LOCKED") return "Tela bloqueada";
  if (status === "IDLE") return "Ocioso";
  return "Online";
}

function normalizeWbLogin(value: string) {
  return value.trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, "");
}
