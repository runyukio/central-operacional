import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { addDateKeyDays, saoPauloDateKey, startOfSaoPauloDate } from "@/lib/realtime-hours-timeline";

const detailedRetentionDays = 7;
const aggregationLookbackDays = 8;

export async function maintainRealtimeHoursV2(reference = new Date()) {
  const today = saoPauloDateKey(reference);
  const startDateKey = addDateKeyDays(today, -aggregationLookbackDays);
  const endDateKey = today;
  const rangeStart = startOfSaoPauloDate(startDateKey);
  const rangeEnd = startOfSaoPauloDate(addDateKeyDays(endDateKey, 1));
  const retentionCutoff = startOfSaoPauloDate(addDateKeyDays(today, -detailedRetentionDays));

  return prisma.$transaction(async (tx) => {
    const expiredNonces = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "WorkstationRequestNonceV2"
      WHERE "expiresAt" < CURRENT_TIMESTAMP
    `);

    await tx.$executeRaw(Prisma.sql`
      DELETE FROM "WorkstationDailySummaryV2"
      WHERE "dateKey" >= ${startDateKey}::date
        AND "dateKey" <= ${endDateKey}::date
    `);

    const summaryRows = await tx.$executeRaw(Prisma.sql`
      WITH source AS (
        SELECT *
        FROM "WorkstationActivitySegmentV2"
        WHERE "startedAt" < ${rangeEnd}
          AND "endedAt" > ${rangeStart}
      ), split AS (
        SELECT
          day_value::date AS "dateKey",
          source."deviceId",
          source."employeeId",
          source."wbLogin",
          source."sourceType",
          source."applicationName",
          source."domain",
          GREATEST(
            source."startedAt",
            ((day_value::date)::timestamp AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'UTC'
          ) AS "sliceStart",
          LEAST(
            source."endedAt",
            (((day_value::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'UTC'
          ) AS "sliceEnd"
        FROM source
        CROSS JOIN LATERAL generate_series(
          ((source."startedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date,
          (((source."endedAt" - INTERVAL '1 millisecond') AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date,
          INTERVAL '1 day'
        ) AS day_value
      ), grouped AS (
        SELECT
          "dateKey",
          "deviceId",
          "employeeId",
          "wbLogin",
          "sourceType",
          "applicationName",
          "domain",
          SUM(GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ("sliceEnd" - "sliceStart")))::int))::int AS "durationSeconds",
          COUNT(*)::int AS "segmentCount"
        FROM split
        WHERE "sliceEnd" > "sliceStart"
        GROUP BY "dateKey", "deviceId", "employeeId", "wbLogin", "sourceType", "applicationName", "domain"
      )
      INSERT INTO "WorkstationDailySummaryV2" (
        "id", "dateKey", "deviceId", "employeeId", "wbLogin", "sourceType",
        "applicationName", "domain", "durationSeconds", "segmentCount", "createdAt", "updatedAt"
      )
      SELECT
        md5(concat_ws('|', "dateKey"::text, "deviceId", COALESCE("employeeId", ''), COALESCE("wbLogin", ''), "sourceType", COALESCE("applicationName", ''), COALESCE("domain", ''))),
        "dateKey", "deviceId", "employeeId", "wbLogin", "sourceType",
        "applicationName", "domain", "durationSeconds", "segmentCount", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM grouped
      WHERE "durationSeconds" > 0
    `);

    const detailedRowsDeleted = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "WorkstationActivitySegmentV2"
      WHERE "endedAt" < ${retentionCutoff}
    `);

    const abandonedPendingDevices = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "WorkstationDeviceV2"
      WHERE "status" = 'PENDING'
        AND "enrolledAt" < CURRENT_TIMESTAMP - INTERVAL '1 day'
        AND "lastSeenAt" IS NULL
    `);

    const expiredCodesDeleted = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "WorkstationEnrollmentCodeV2"
      WHERE ("expiresAt" < CURRENT_TIMESTAMP OR "revokedAt" IS NOT NULL)
        AND "updatedAt" < CURRENT_TIMESTAMP - INTERVAL '30 days'
    `);

    return {
      success: true,
      reference: reference.toISOString(),
      aggregatedRange: { startDateKey, endDateKey },
      detailedRetentionDays,
      expiredNonces,
      summaryRows,
      detailedRowsDeleted,
      abandonedPendingDevices,
      expiredCodesDeleted
    };
  }, { timeout: 60_000 });
}
