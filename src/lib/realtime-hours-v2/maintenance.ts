import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDateKeyDays, saoPauloDateKey, startOfSaoPauloDate } from "@/lib/realtime-hours-timeline";

export const maintenanceConfigPrefix = "realtime-hours-v2-maintenance:";
const dayPrefix = `${maintenanceConfigPrefix}day:`;
export const nonceBatchSize = 5_000;
export const nonceMaxBatches = 4;
export const nonceSafetyMarginMinutes = 10;

type SqlClient = {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
  $executeRaw(query: Prisma.Sql): Promise<number>;
};
export type MaintenanceClient = SqlClient & {
  $transaction<T>(run: (tx: SqlClient) => Promise<T>, options?: { timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<T>;
};
type Options = { client?: MaintenanceClient; maxBatches?: number; maxDays?: number; budgetMs?: number; includeAllDates?: boolean };
type DayFingerprint = { dateKey: string; sourceCount: number; fingerprint: string };
type DayCheckpoint = DayFingerprint & { summaryRows: number; processedAt: string };
const bounded = (value: number | undefined, fallback: number, max: number) => Number.isInteger(value) && value! > 0 ? Math.min(value!, max) : fallback;

async function saveState(client: SqlClient, key: string, value: unknown) {
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "WorkstationMaintenanceStateV2" ("key", "value", "updatedAt")
    VALUES (${key}, ${JSON.stringify(value)}::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = CURRENT_TIMESTAMP
  `);
}

/** Short transaction: expired TTL plus an additional ten-minute anti-replay margin. */
export function nonceCleanupBatchQuery(limit = nonceBatchSize) {
  return Prisma.sql`
    WITH candidates AS (
      SELECT ctid FROM "WorkstationRequestNonceV2"
      WHERE "expiresAt" < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '10 minutes'
      ORDER BY "expiresAt" LIMIT ${bounded(limit, nonceBatchSize, nonceBatchSize)}
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM "WorkstationRequestNonceV2" nonce USING candidates WHERE nonce.ctid = candidates.ctid
  `;
}

export async function cleanupRealtimeHoursV2Nonces(reference = new Date(), options: Options = {}) {
  const client: MaintenanceClient = options.client ?? prisma;
  const maxBatches = bounded(options.maxBatches, nonceMaxBatches, nonceMaxBatches);
  const budgetMs = bounded(options.budgetMs, 15_000, 20_000);
  const started = performance.now();
  const key = `${maintenanceConfigPrefix}last:nonces`;
  let expiredNonces = 0, batches = 0, lastBatch = 0;
  // Check persistence privileges before deleting; one bounded record per task, no personal data.
  await saveState(client, key, { status: "running", at: reference.toISOString() });
  try {
    while (batches < maxBatches && performance.now() - started < budgetMs) {
      lastBatch = await client.$transaction(async tx => {
        await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '5000ms'`);
        await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout = '500ms'`);
        return tx.$executeRaw(nonceCleanupBatchQuery());
      }, { timeout: 7_000 });
      expiredNonces += lastBatch;
      batches++;
      if (lastBatch < nonceBatchSize) break;
    }
    const result = {
      success: true, task: "nonces" as const, reference: reference.toISOString(), expiredNonces, batches,
      batchSize: nonceBatchSize, safetyMarginMinutes: nonceSafetyMarginMinutes,
      moreMayRemain: batches === 0 || lastBatch === nonceBatchSize, durationMs: Math.round(performance.now() - started)
    };
    await saveState(client, key, { status: "complete", ...result });
    return result;
  } catch (error) {
    await saveState(client, key, { status: "failed", at: reference.toISOString(), expiredNonces, batches }).catch(() => undefined);
    throw error;
  }
}

/** Hash only summary inputs: idempotent retries updating updatedAt do not dirty a day. */
export function dayFingerprintsQuery(dateKey?: string, sinceDateKey?: string) {
  const range = dateKey ? Prisma.sql`
    AND source."startedAt" < ${startOfSaoPauloDate(addDateKeyDays(dateKey, 1))}
    AND source."endedAt" > ${startOfSaoPauloDate(dateKey)}
  ` : sinceDateKey ? Prisma.sql`AND source."endedAt" > ${startOfSaoPauloDate(sinceDateKey)}` : Prisma.empty;
  const dayFilter = dateKey ? Prisma.sql`WHERE "dateKey" = ${dateKey}::date`
    : sinceDateKey ? Prisma.sql`WHERE "dateKey" >= ${sinceDateKey}::date` : Prisma.empty;
  return Prisma.sql`
    WITH slices AS (
      SELECT day_value::date AS "dateKey", source."deviceId", source."employeeId", source."wbLogin",
        source."sourceType", source."applicationName", source."domain",
        GREATEST(source."startedAt", ((day_value::date)::timestamp AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'UTC') AS "sliceStart",
        LEAST(source."endedAt", (((day_value::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'UTC')) AS "sliceEnd"
      FROM "WorkstationActivitySegmentV2" source
      CROSS JOIN LATERAL generate_series(
        ((source."startedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date,
        (((source."endedAt" - INTERVAL '1 millisecond') AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date,
        INTERVAL '1 day'
      ) AS day_value
      WHERE source."endedAt" > source."startedAt" ${range}
    )
    SELECT "dateKey"::text AS "dateKey", COUNT(*)::int AS "sourceCount",
      md5(concat_ws('|', COUNT(*)::text, SUM(hashtextextended(jsonb_build_array(
        "deviceId", "employeeId", "wbLogin", "sourceType", "applicationName", "domain", "sliceStart", "sliceEnd"
      )::text, 0)::numeric)::text)) AS fingerprint
    FROM slices ${dayFilter} GROUP BY "dateKey" ORDER BY "dateKey"
  `;
}

export function rebuildDaySummaryQuery(dateKey: string) {
  const start = startOfSaoPauloDate(dateKey), end = startOfSaoPauloDate(addDateKeyDays(dateKey, 1));
  return Prisma.sql`
    WITH grouped AS (
      SELECT "deviceId", "employeeId", "wbLogin", "sourceType", "applicationName", "domain",
        SUM(GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (LEAST("endedAt", ${end}) - GREATEST("startedAt", ${start}))))))::int AS "durationSeconds",
        COUNT(*)::int AS "segmentCount"
      FROM "WorkstationActivitySegmentV2" WHERE "startedAt" < ${end} AND "endedAt" > ${start}
      GROUP BY "deviceId", "employeeId", "wbLogin", "sourceType", "applicationName", "domain"
    )
    INSERT INTO "WorkstationDailySummaryV2" (
      "id", "dateKey", "deviceId", "employeeId", "wbLogin", "sourceType", "applicationName", "domain",
      "durationSeconds", "segmentCount", "createdAt", "updatedAt"
    )
    SELECT md5(concat_ws('|', ${dateKey}::text, "deviceId", COALESCE("employeeId", ''), COALESCE("wbLogin", ''), "sourceType", COALESCE("applicationName", ''), COALESCE("domain", ''))),
      ${dateKey}::date, "deviceId", "employeeId", "wbLogin", "sourceType", "applicationName", "domain",
      "durationSeconds", "segmentCount", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM grouped WHERE "durationSeconds" > 0
  `;
}

function checkpoint(value: unknown): DayCheckpoint | undefined {
  if (!value || typeof value !== "object") return;
  const row = value as Partial<DayCheckpoint>;
  return typeof row.dateKey === "string" && typeof row.fingerprint === "string" && typeof row.sourceCount === "number" ? row as DayCheckpoint : undefined;
}

export async function maintainRealtimeHoursV2History(reference = new Date(), options: Options = {}) {
  const client: MaintenanceClient = options.client ?? prisma;
  const started = performance.now(), budgetMs = bounded(options.budgetMs, 35_000, 40_000), maxDays = bounded(options.maxDays, 8, 16);
  const key = `${maintenanceConfigPrefix}last:history`;
  await saveState(client, key, { status: "running", at: reference.toISOString() });
  try {
    // Ingestion accepts at most 14-day-old intervals. Keep an extra date boundary;
    // old raw history remains intact and can be explicitly backfilled separately.
    const sinceDateKey = options.includeAllDates ? undefined : addDateKeyDays(saoPauloDateKey(reference), -15);
    const current = await client.$transaction(async tx => {
      await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '15000ms'`);
      return tx.$queryRaw<DayFingerprint[]>(dayFingerprintsQuery(undefined, sinceDateKey));
    }, { timeout: 20_000 });
    const saved = await client.$queryRaw<Array<{ key: string; value: unknown }>>(Prisma.sql`
      SELECT "key", "value" FROM "WorkstationMaintenanceStateV2" WHERE "key" LIKE ${`${dayPrefix}%`}
    `);
    const previous = new Map(saved.map(row => [row.key.slice(dayPrefix.length), checkpoint(row.value)]));
    // Recent dates first so a legacy incomplete day cannot starve current activity.
    const dirty = current.filter(day => previous.get(day.dateKey)?.fingerprint !== day.fingerprint)
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
    const rebuilt: string[] = [], preserved: string[] = [], locked: string[] = [];
    let summaryRows = 0, attempted = 0, unchangedDuringRun = 0;
    for (const day of dirty) {
      if (attempted >= maxDays || performance.now() - started >= budgetMs) break;
      attempted++;
      const result = await client.$transaction(async tx => {
        await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '15000ms'`);
        await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout = '500ms'`);
        const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>(Prisma.sql`
          SELECT pg_try_advisory_xact_lock(843211, hashtext(${day.dateKey})) AS acquired
        `);
        if (!lock?.acquired) return { status: "locked" as const, rows: 0 };
        // Each consolidated day is atomic, with a consistent source snapshot.
        const [source] = await tx.$queryRaw<DayFingerprint[]>(dayFingerprintsQuery(day.dateKey));
        const [stored] = await tx.$queryRaw<Array<{ value: unknown }>>(Prisma.sql`
          SELECT "value" FROM "WorkstationMaintenanceStateV2" WHERE "key" = ${`${dayPrefix}${day.dateKey}`}
        `);
        const before = checkpoint(stored?.value);
        if (source && source.fingerprint === before?.fingerprint) return { status: "unchanged" as const, rows: 0 };
        const [existing] = await tx.$queryRaw<Array<{ segmentCount: number }>>(Prisma.sql`
          SELECT COALESCE(SUM("segmentCount"), 0)::int AS "segmentCount" FROM "WorkstationDailySummaryV2" WHERE "dateKey" = ${day.dateKey}::date
        `);
        if (!source || source.sourceCount < Math.max(before?.sourceCount ?? 0, existing?.segmentCount ?? 0)) {
          return { status: "preserved" as const, rows: 0 };
        }
        await tx.$executeRaw(Prisma.sql`DELETE FROM "WorkstationDailySummaryV2" WHERE "dateKey" = ${day.dateKey}::date`);
        const rows = await tx.$executeRaw(rebuildDaySummaryQuery(day.dateKey));
        await saveState(tx, `${dayPrefix}${day.dateKey}`, { ...source, summaryRows: rows, processedAt: reference.toISOString() });
        return { status: "rebuilt" as const, rows };
      }, { timeout: 20_000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      if (result.status === "rebuilt") { rebuilt.push(day.dateKey); summaryRows += result.rows; }
      else if (result.status === "preserved") preserved.push(day.dateKey);
      else if (result.status === "locked") locked.push(day.dateKey);
      else unchangedDuringRun++;
    }
    const result = {
      success: true, task: "history" as const, reference: reference.toISOString(), rawHistoryPreserved: true,
      detailedRowsDeleted: 0, scannedSinceDateKey: sinceDateKey ?? null,
      daysChecked: current.length, unchangedDays: current.length - dirty.length + unchangedDuringRun,
      rebuiltDays: rebuilt, preservedDaysWithIncompleteSource: preserved, lockedDays: locked, summaryRows,
      remainingDirtyDays: Math.max(0, dirty.length - rebuilt.length - unchangedDuringRun), durationMs: Math.round(performance.now() - started)
    };
    await saveState(client, key, { status: "complete", ...result });
    return result;
  } catch (error) {
    await saveState(client, key, { status: "failed", at: reference.toISOString() }).catch(() => undefined);
    throw error;
  }
}

/** Daily compatibility entrypoint. Minute schedulers must select the nonce-only task. */
export async function maintainRealtimeHoursV2(reference = new Date(), options: Options = {}) {
  const nonces = await cleanupRealtimeHoursV2Nonces(reference, options);
  const history = await maintainRealtimeHoursV2History(reference, options);
  return { ...history, expiredNonces: nonces.expiredNonces, nonces };
}
