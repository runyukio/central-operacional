import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import { capacityClock, capacityDate, capacityDay } from "./ads-capacity-core";
import { parseAdsExecutiveCycle } from "./ads-executive-report-core";

const MINUTE = 60_000;
const MAX_GAP = 30 * MINUTE;
const MAX_AGE = 90 * MINUTE;
const FUTURE_TOLERANCE = 5 * MINUTE;
export const ADS_FORECAST_REALTIME_SOURCE_VERSION = "ads-rt-input-v3-snapshot-integrity-reset13";

export type AdsForecastRealtimeRequest = {
  dateKey: string;
  now: Date;
  asOfCycle?: string;
  /** Authoritative ADS mapping supplied by the canonical forecast service. */
  queueIds: readonly string[];
};
export type AdsForecastRealtimeSource = {
  status: "active" | "unavailable" | "stale";
  /** Current-frame integrity is separate from complete intraday input coverage. */
  snapshotIntegrity: "verified" | "incomplete" | "unknown";
  snapshotWarnings: string[];
  /** Brazil wall-clock encoded in UTC, matching imported forecast timestamps. */
  snapshotTimestamp: number | null;
  cycle: string | null;
  /** Actual UTC import time; it must not receive another Brazil offset. */
  importedAt: string | null;
  intervals: Array<{ start: number; end: number; input: number }>;
  fingerprint: string;
  warnings: string[];
};

/** Internal SQL grain only. Queue and batch identifiers never leave the reader. */
export type AdsForecastRealtimeRow = {
  cycleDownload: string;
  queueKey: string;
  input: number;
  batchId: string;
  importedAt: Date | string;
};

function parseCycle(value: string) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) return null;
  const parsed = parseAdsExecutiveCycle(value);
  const date = new Date(parsed.timestamp);
  return Number.isFinite(parsed.timestamp) && capacityDate(parsed.timestamp) === parsed.dateKey
    && date.getUTCHours() === parsed.hour && date.getUTCMinutes() === parsed.minute ? parsed : null;
}

function sourceBounds(request: AdsForecastRealtimeRequest) {
  const start = capacityDay(request.dateKey);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.dateKey) || !Number.isFinite(start) || capacityDate(start) !== request.dateKey
    || !Number.isFinite(request.now.getTime())) throw new Error("Data operacional inválida para o Real Time do forecast ADS.");
  const clock = capacityClock(request.now);
  const asOf = request.asOfCycle === undefined ? null : parseCycle(request.asOfCycle);
  if (request.asOfCycle !== undefined && (!asOf || asOf.dateKey !== request.dateKey)) throw new Error("Ciclo inválido para o Real Time do forecast ADS.");
  const end = Math.min(clock, start + 86_400_000 - MINUTE, asOf?.timestamp ?? Infinity);
  const endDate = new Date(end);
  const endCycle = `${capacityDate(end)} ${String(endDate.getUTCHours()).padStart(2, "0")}:${String(endDate.getUTCMinutes()).padStart(2, "0")}`;
  const queueIds = [...new Set(request.queueIds.map((id) => id.trim()).filter(Boolean))].sort();
  return { start, end, endCycle, clock, asOf, queueIds };
}

/**
 * One consistent read of successful parent batches and their queue summaries.
 * Choose each cycle globally before filtering ADS. A newer batch without ADS
 * must survive as an invalid sentinel, rather than reviving an older ADS frame.
 */
export function adsForecastRealtimeQuery(request: AdsForecastRealtimeRequest) {
  const bounds = sourceBounds(request);
  if (!bounds.queueIds.length) throw new Error("Sem filas ADS mapeadas para a leitura de Real Time.");
  return Prisma.sql`
    WITH latest_batches AS (
      SELECT DISTINCT ON (q."cycleDownload") q."cycleDownload", q."batchId"
      FROM "RealTimeQueueCycleSummary" q
      JOIN "RealTimeImportBatch" b ON b.id=q."batchId"
      WHERE b.status='SUCCESS' AND b."queueRows">0 AND b."importedAt"<=${request.now}
        AND q."cycleDownload">=${`${request.dateKey} 00:00`} AND q."cycleDownload"<=${bounds.endCycle}
      ORDER BY q."cycleDownload", b."importedAt" DESC, b.id DESC
    )
    SELECT latest."cycleDownload",COALESCE(q."queueKey",'') AS "queueKey",
      COALESCE(q.input,-1) AS input,latest."batchId",b."importedAt"
    FROM latest_batches latest
    LEFT JOIN "RealTimeQueueCycleSummary" q ON q."batchId"=latest."batchId" AND q."cycleDownload"=latest."cycleDownload"
      AND q."queueId" IN (${Prisma.join(bounds.queueIds)})
    JOIN "RealTimeImportBatch" b ON b.id=latest."batchId"
    ORDER BY latest."cycleDownload",q."queueKey"
  `;
}

/** Missing queues/cycles never become zero arrivals. Counters reset at 13:00 BR, not 00:00. */
export function summarizeAdsForecastRealtime(request: AdsForecastRealtimeRequest, rows: readonly AdsForecastRealtimeRow[]): AdsForecastRealtimeSource {
  const bounds = sourceBounds(request);
  type ParsedRow = AdsForecastRealtimeRow & { timestamp: number; importedTimestamp: number };
  const parsedRows: ParsedRow[] = [];
  let invalid = false;
  let future: ParsedRow | null = null;
  for (const row of rows) {
    const parsed = parseCycle(row.cycleDownload);
    if (!parsed) { invalid = true; continue; }
    if (parsed.dateKey !== request.dateKey) continue;
    const importedTimestamp = row.importedAt instanceof Date ? row.importedAt.getTime() : Date.parse(row.importedAt);
    const value = { ...row, timestamp: parsed.timestamp, importedTimestamp };
    if (parsed.timestamp > bounds.clock + FUTURE_TOLERANCE) {
      if (!future || parsed.timestamp > future.timestamp) future = value;
      continue;
    }
    if (parsed.timestamp > bounds.end) continue;
    parsedRows.push(value);
  }
  const latestBatchByCycle = new Map<string, ParsedRow>();
  for (const row of parsedRows) {
    const previous = latestBatchByCycle.get(row.cycleDownload);
    if (!previous || row.importedTimestamp > previous.importedTimestamp
      || (row.importedTimestamp === previous.importedTimestamp && row.batchId > previous.batchId)) latestBatchByCycle.set(row.cycleDownload, row);
  }
  const selected = parsedRows.filter((row) => latestBatchByCycle.get(row.cycleDownload)?.batchId === row.batchId)
    .sort((a, b) => a.timestamp - b.timestamp || String(a.queueKey ?? "").localeCompare(String(b.queueKey ?? "")));
  const latest = future ?? selected.at(-1) ?? null;
  const frameInventory = (frame: ParsedRow[]) => {
    const keys = new Set<string>();
    let valid = frame.length > 0;
    for (const row of frame) {
      if (typeof row.queueKey !== "string" || !row.queueKey.trim()) { valid = false; continue; }
      if (keys.has(row.queueKey) || !Number.isSafeInteger(row.input) || row.input < 0
        || !Number.isFinite(row.importedTimestamp) || !row.batchId) valid = false;
      keys.add(row.queueKey);
    }
    return { keys, valid };
  };
  const assessSnapshot = (): Pick<AdsForecastRealtimeSource, "snapshotIntegrity" | "snapshotWarnings"> => {
    if (!latest || future) return { snapshotIntegrity: "unknown", snapshotWarnings: [] };
    const current = frameInventory(selected.filter((row) => row.timestamp === latest.timestamp));
    if (!current.valid) return { snapshotIntegrity: "incomplete", snapshotWarnings: ["O ciclo atual de ADS contém filas ausentes, duplicadas ou contadores inválidos. A integridade do backlog desse ciclo não pode ser confirmada."] };
    const knownKeys = new Set(selected.flatMap((row) => typeof row.queueKey === "string" && row.queueKey.trim() ? [row.queueKey] : []));
    if ([...knownKeys].some((key) => !current.keys.has(key))) return { snapshotIntegrity: "incomplete", snapshotWarnings: ["O ciclo atual de ADS perdeu filas presentes nas coletas anteriores. O backlog restante pode estar incompleto."] };
    const previousTimestamp = selected.findLast((row) => row.timestamp < latest.timestamp)?.timestamp;
    const resetTimestamp = bounds.start + 13 * 3_600_000;
    // A decrease whose reset explanation is impossible also invalidates the
    // current frame. A gap straddling 13:00 only invalidates historical input.
    if (previousTimestamp !== undefined && latest.timestamp - previousTimestamp <= MAX_GAP
      && !(previousTimestamp < resetTimestamp && latest.timestamp >= resetTimestamp)) {
      const before = new Map(selected.filter((row) => row.timestamp === previousTimestamp).map((row) => [row.queueKey, row.input]));
      if (selected.some((row) => row.timestamp === latest.timestamp && Number.isSafeInteger(before.get(row.queueKey))
        && before.get(row.queueKey)! >= 0 && row.input < before.get(row.queueKey)!)) return { snapshotIntegrity: "incomplete", snapshotWarnings: ["Um contador do ciclo atual de ADS recuou fora do reset de 13:00. A integridade desse snapshot não pode ser confirmada."] };
    }
    const baseline = frameInventory(selected.filter((row) => row.timestamp === bounds.start));
    if (baseline.valid && baseline.keys.size === current.keys.size && [...baseline.keys].every((key) => current.keys.has(key))) return { snapshotIntegrity: "verified", snapshotWarnings: [] };
    return { snapshotIntegrity: "unknown", snapshotWarnings: ["O inventário do ciclo atual de ADS não tem uma referência completa e compatível de 00:00 para verificação."] };
  };
  const snapshot = assessSnapshot();
  const result = (status: AdsForecastRealtimeSource["status"], warnings: string[], intervals: AdsForecastRealtimeSource["intervals"] = []): AdsForecastRealtimeSource => ({
    status, ...snapshot, snapshotTimestamp: latest?.timestamp ?? null, cycle: latest?.cycleDownload ?? null,
    importedAt: latest && Number.isFinite(latest.importedTimestamp) ? new Date(latest.importedTimestamp).toISOString() : null,
    intervals,
    fingerprint: createHash("sha256").update(JSON.stringify({
      method: ADS_FORECAST_REALTIME_SOURCE_VERSION, dateKey: request.dateKey, queueIds: bounds.queueIds, status, snapshotIntegrity: snapshot.snapshotIntegrity,
      rows: selected.map((row) => [row.cycleDownload, row.queueKey, row.input, row.batchId, row.importedTimestamp]),
      future: future ? [future.cycleDownload, future.batchId, future.importedTimestamp] : null
    })).digest("hex"),
    warnings
  });
  if (!bounds.queueIds.length || !latest) return result("unavailable", ["Ajuste horário ADS indisponível: não há ciclos de Real Time elegíveis para o dia. A ausência de dados não vira volume zero."]);
  if (future || latest.importedTimestamp > request.now.getTime() + FUTURE_TOLERANCE
    || bounds.clock - latest.timestamp > MAX_AGE || request.now.getTime() - latest.importedTimestamp > MAX_AGE) {
    return result("stale", ["Ajuste horário ADS suspenso: o ciclo do Real Time está há mais de 90 minutos sem atualização ou tem horário futuro inconsistente."]);
  }
  if (invalid || selected.some((row) => !Number.isFinite(row.importedTimestamp) || !row.batchId || typeof row.queueKey !== "string" || !row.queueKey.trim()
    || !Number.isSafeInteger(row.input) || row.input < 0)) return result("unavailable", ["Ajuste horário ADS indisponível: há contadores ou ciclos inconsistentes no Real Time."]);
  if (selected[0]?.timestamp !== bounds.start || (bounds.asOf && bounds.asOf.timestamp <= bounds.clock && latest.timestamp !== bounds.asOf.timestamp)) {
    return result("unavailable", ["Ajuste horário ADS indisponível: falta o ciclo de 00:00 ou o ciclo final solicitado. As lacunas não são estimadas como zero."]);
  }
  const inventory = new Set(selected.map((row) => row.queueKey));
  const cycles = new Map<number, Map<string, number>>();
  for (const row of selected) {
    const counters = cycles.get(row.timestamp) ?? new Map<string, number>();
    if (counters.has(row.queueKey)) return result("unavailable", ["Ajuste horário ADS indisponível: há filas duplicadas no mesmo ciclo de Real Time."]);
    counters.set(row.queueKey, row.input);
    cycles.set(row.timestamp, counters);
  }
  if ([...cycles.values()].some((counters) => counters.size !== inventory.size)) return result("unavailable", ["Ajuste horário ADS indisponível: a cobertura de filas mudou entre os ciclos do dia. Uma fila ausente não é considerada zerada."]);
  const ordered = [...cycles];
  if (ordered.length < 2) return result("unavailable", ["Ajuste horário ADS indisponível: ainda não há um intervalo completo de Real Time no dia."]);
  const intervals: AdsForecastRealtimeSource["intervals"] = [];
  for (let index = 1; index < ordered.length; index++) {
    const [start, previous] = ordered[index - 1], [end, current] = ordered[index];
    const date = new Date(end);
    const reset = date.getUTCHours() === 13 && date.getUTCMinutes() === 0;
    const resetTimestamp = bounds.start + 13 * 3_600_000;
    if (end - start > MAX_GAP || (start < resetTimestamp && end > resetTimestamp)) return result("unavailable", ["Ajuste horário ADS indisponível: há intervalo sem coleta ou sem o marco de reset de 13:00. As lacunas não viram zero."]);
    let input = 0;
    for (const [key, value] of current) {
      const before = previous.get(key)!;
      if (!reset && value < before) return result("unavailable", ["Ajuste horário ADS indisponível: um contador diminuiu fora do reset de 13:00. Correções não são tratadas como novas entradas."]);
      input += reset ? value : value - before;
    }
    if (!Number.isSafeInteger(input)) return result("unavailable", ["Ajuste horário ADS indisponível: a soma de entradas do intervalo é inconsistente."]);
    intervals.push({ start, end, input });
  }
  return result("active", [], intervals);
}

/** Internal aggregate-only reader. Public consumers retain their existing authorization. */
export async function readAdsForecastRealtime(request: AdsForecastRealtimeRequest): Promise<AdsForecastRealtimeSource> {
  const bounds = sourceBounds(request);
  if (!bounds.queueIds.length || bounds.end < bounds.start) return summarizeAdsForecastRealtime(request, []);
  try {
    const rows = await prisma.$queryRaw<AdsForecastRealtimeRow[]>(adsForecastRealtimeQuery(request));
    return summarizeAdsForecastRealtime(request, rows);
  } catch {
    const result = summarizeAdsForecastRealtime(request, []);
    return { ...result, warnings: ["O complemento horário do Real Time está temporariamente indisponível. O forecast histórico permanece como referência."] };
  }
}
