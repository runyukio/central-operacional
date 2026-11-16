import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { isRealtimeActiveEmployeeStatus } from "@/lib/realtime-employee-status";
import { prisma } from "@/lib/prisma";
import type { AdsExecutiveRankingRow, ExecutiveReportLob } from "@/lib/ads-executive-report-core";

const minute = 60_000;
const hour = 60 * minute;
const checkpoint = 5 * minute;
const tolerance = 90_000;

type Batch = { id: string; cycleDownload: string; localAt: number; importedAt: number };
type Reading = Batch & { at: number };
type QueueTotals = {
  batchId: string; input: number; output: number; ahtTotal: number | null;
  maxLatencyMs: number | null; backlog: number | null;
};
type Agent = {
  batchId: string; wbLoginNormalized: string; displayName: string; wbLogin: string; rawWbLogin: string;
  employeeStatus: string; submit: number; moderationMs: number;
};
export type ExecutiveInterval = {
  hour: number;
  cycleDownload: string;
  partial: boolean;
  input: number | null;
  output: number | null;
  ahtMs: number | null;
  maxLatencyMs: number | null;
  backlog: number | null;
  online: number | null;
};
export type ExecutiveHourlyData = {
  dateKey: string;
  lob: ExecutiveReportLob;
  hours: ExecutiveInterval[];
  previousDayHour: ExecutiveInterval | null;
  activeWbs: string[];
  topAgents: AdsExecutiveRankingRow[];
  lowAgents: AdsExecutiveRankingRow[];
  importedAt: string | null;
};

function clockLabel(at: number) {
  return new Date(at).toISOString().slice(0, 16).replace("T", " ");
}

function wallClock(value: string) {
  return Date.parse(value.replace(" ", "T") + ":00Z");
}

export function pickExecutiveReadings(batches: Batch[]) {
  const readings = new Map<number, Reading>();
  for (const batch of batches) {
    const collected = batch.localAt;
    const at = Math.round(collected / checkpoint) * checkpoint;
    if (!Number.isFinite(at) || Math.abs(collected - at) > tolerance) continue;
    const halfHour = Math.floor(at / (hour / 2)) * (hour / 2);
    if (batch.cycleDownload !== clockLabel(halfHour) && batch.cycleDownload !== clockLabel(at)) continue;
    const prior = readings.get(at);
    const distance = Math.abs(collected - at);
    const priorDistance = prior ? Math.abs(prior.localAt - at) : Infinity;
    if (distance < priorDistance || (distance === priorDistance && prior && batch.importedAt > prior.importedAt)) {
      readings.set(at, { ...batch, at });
    }
  }
  return readings;
}

function counterChanges(values: Array<number | null | undefined>, readings: Reading[]) {
  let total = 0;
  for (let index = 1; index < values.length; index++) {
    const before = values[index - 1];
    const after = values[index];
    if (before == null || after == null) return null;
    if (after >= before) {
      total += after - before;
    } else if (/ 13:0[05]$/.test(clockLabel(readings[index].at))) {
      total += after;
    } else {
      return null;
    }
  }
  return total;
}

export function executiveReadingWindows(readings: Map<number, Reading>, day: number, cutoff?: number) {
  const latest = Math.max(...readings.keys());
  const through = cutoff === undefined ? latest : Math.min(latest, cutoff);
  const windows: Reading[][] = [];
  for (let start = day - hour; start < day + 24 * hour && start < through; start += hour) {
    const end = Math.min(start + hour, through);
    // A historical hour needs its own closing reading. An open hour uses the
    // latest checkpoint available and keeps the same baseline as it updates.
    const opening = readings.get(start);
    const closing = readings.get(end);
    if (!opening || !closing) continue;
    const resetCheckpoint = new Date(start).getUTCHours() === 13 && start + checkpoint < end
      ? readings.get(start + checkpoint) : undefined;
    windows.push(resetCheckpoint ? [opening, resetCheckpoint, closing] : [opening, closing]);
  }
  return windows;
}

export function buildExecutiveIntervals(
  selectedCycle: string,
  lob: ExecutiveReportLob,
  windows: Reading[][],
  queueTotals: QueueTotals[],
  agents: Agent[]
): ExecutiveHourlyData {
  const dateKey = selectedCycle.slice(0, 10);
  const queues = new Map(queueTotals.map((row) => [row.batchId, row]));
  const agentsByBatch = new Map<string, Map<string, Agent>>();
  for (const agent of agents) {
    if (!agent.wbLoginNormalized || !isRealtimeActiveEmployeeStatus(agent.employeeStatus)) continue;
    const batch = agentsByBatch.get(agent.batchId) ?? new Map<string, Agent>();
    batch.set(agent.wbLoginNormalized, agent);
    agentsByBatch.set(agent.batchId, batch);
  }
  const hours: ExecutiveInterval[] = [];
  let previousDayHour: ExecutiveInterval | null = null;
  let ranked: Array<AdsExecutiveRankingRow & { key: string }> = [];
  let importedAt: string | null = null;
  for (const readings of windows) {
    const opening = readings[0];
    const closing = readings[readings.length - 1];
    const snapshots = readings.map((reading) => queues.get(reading.id));
    const lastQueue = snapshots[snapshots.length - 1];
    const input = counterChanges(snapshots.map((row) => row?.input), readings);
    const output = counterChanges(snapshots.map((row) => row?.output), readings);
    const ahtTotal = counterChanges(snapshots.map((row) => row && (row.output === 0 ? 0 : row.ahtTotal)), readings);
    const agentSnapshots = readings.map((reading) => agentsByBatch.get(reading.id));
    const closingAgents = agentSnapshots[agentSnapshots.length - 1];
    const active = [];
    for (const [key, agent] of closingAgents ?? []) {
      const submit = counterChanges(agentSnapshots.map((snapshot) => snapshot?.get(key)?.submit), readings);
      if (submit === null || submit <= 0) continue;
      const moderation = counterChanges(agentSnapshots.map((snapshot) => snapshot?.get(key)?.moderationMs), readings);
      active.push({ key, name: agent.displayName, wbLogin: agent.wbLogin || agent.rawWbLogin, submit, ahtMs: moderation === null ? null : moderation / submit });
    }
    const interval: ExecutiveInterval = {
      hour: new Date(opening.at).getUTCHours(),
      cycleDownload: clockLabel(closing.at),
      partial: closing.at !== opening.at + hour,
      input,
      output,
      ahtMs: output !== null && output > 0 && ahtTotal !== null ? ahtTotal / output : null,
      maxLatencyMs: lastQueue?.maxLatencyMs ?? null,
      backlog: lastQueue?.backlog ?? null,
      online: agentSnapshots.every(Boolean) ? active.length : null
    };
    if (clockLabel(opening.at).slice(0, 10) === dateKey) {
      hours.push(interval);
      ranked = active;
      importedAt = new Date(closing.importedAt).toISOString();
    } else {
      previousDayHour = interval;
    }
  }
  const byName = (a: AdsExecutiveRankingRow, b: AdsExecutiveRankingRow) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
  return {
    lob, dateKey, hours, previousDayHour, importedAt,
    activeWbs: ranked.map((row) => row.key),
    topAgents: [...ranked].sort((a, b) => b.submit - a.submit || byName(a, b)).slice(0, 5),
    lowAgents: [...ranked].sort((a, b) => a.submit - b.submit || byName(a, b)).slice(0, 5)
  };
}

export async function readExecutiveIntervals(options: {
  selectedCycle: string; lob: ExecutiveReportLob; latest: boolean; latestImportId?: string;
}) {
  const { selectedCycle, lob, latest } = options;
  const day = wallClock(selectedCycle.slice(0, 10) + " 00:00");
  if (!Number.isFinite(day)) return buildExecutiveIntervals(selectedCycle, lob, [], [], []);
  const cutoff = latest ? undefined : Math.floor(wallClock(selectedCycle) / hour) * hour + hour;
  const start = new Date(day - hour - tolerance);
  const end = new Date((cutoff ?? day + 24 * hour) + tolerance);
  // Import times track the KAP's five-minute collection boundaries. Accept a
  // reading only inside the clock tolerance and with a matching source cycle.
  const batches = await prisma.$queryRaw<Batch[]>`
    SELECT id, "cycleDownload",
      (extract(epoch FROM "importedAt") * 1000)::float8 AS "importedAt",
      (extract(epoch FROM ("importedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')) * 1000)::float8 AS "localAt"
    FROM "RealTimeImportBatch"
    WHERE status = 'SUCCESS' AND "queueRows" > 0 AND "cycleDownload" IS NOT NULL
      AND "importedAt" BETWEEN
        (${start}::timestamp AT TIME ZONE 'America/Sao_Paulo' AT TIME ZONE 'UTC')
        AND (${end}::timestamp AT TIME ZONE 'America/Sao_Paulo' AT TIME ZONE 'UTC')
    ORDER BY "importedAt" DESC, id DESC
  `;
  const windows = executiveReadingWindows(pickExecutiveReadings(batches), day, cutoff);
  const ids = [...new Set(windows.flatMap((window) => window.map((reading) => reading.id)))];
  if (!ids.length) return buildExecutiveIntervals(selectedCycle, lob, [], [], []);
  const [queues, agents] = await Promise.all([
    prisma.$queryRaw<QueueTotals[]>(Prisma.sql`
      SELECT q."batchId", SUM(q.input)::float8 AS input, SUM(q.output)::float8 AS output,
        CASE WHEN count(*) FILTER (WHERE q.output > 0 AND q."ahtMs" IS NULL) = 0
          THEN SUM(COALESCE(q."ahtMs", 0) * q.output) END AS "ahtTotal",
        MAX(q."maxLatencyMs") FILTER (WHERE ${lob} = 'ADS' OR q."slaTargetMinutes" = 15) AS "maxLatencyMs",
        (SUM(q.backlog) FILTER (WHERE ${lob} = 'ADS' OR q."slaTargetMinutes" = 15))::float8 AS backlog
      FROM "RealTimeQueueCycleSummary" q
      JOIN "RealTimeImportBatch" b ON b.id = q."batchId" AND b."cycleDownload" = q."cycleDownload"
      WHERE q."batchId" IN (${Prisma.join(ids)}) AND q.lob = ${lob}
      GROUP BY q."batchId"
    `),
    prisma.$queryRaw<Agent[]>(Prisma.sql`
      SELECT a."batchId", a."wbLoginNormalized", a."displayName", a."wbLogin",
        a."rawWbLogin", a."employeeStatus", a.submit, a."moderationMs"
      FROM "RealTimeAgentCycleSummary" a
      JOIN "RealTimeImportBatch" b ON b.id = a."batchId" AND b."cycleDownload" = a."cycleDownload"
      WHERE a."batchId" IN (${Prisma.join(ids)}) AND a.lob = ${lob}
        AND a."personType" = 'Agente' AND a."crossingStatus" = 'Encontrado'
    `)
  ]);
  return buildExecutiveIntervals(selectedCycle, lob, windows, queues, agents);
}

export const getExecutiveHourlyData = unstable_cache(readExecutiveIntervals, ["realtime-executive-intervals"], { revalidate: 60 });
