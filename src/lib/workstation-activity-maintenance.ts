import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export function activityRetentionDays(value = process.env.REALTIME_HOURS_ACTIVITY_RETENTION_DAYS) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(90, parsed)) : 7;
}

export function activityRetentionBatch(cutoff: Date, limit = 5_000) {
  const safeLimit = Math.max(1, Math.min(10_000, Math.floor(limit) || 5_000));
  return Prisma.sql`
    WITH expired AS (
      SELECT "id" FROM "agent_activity"."WorkstationActivitySegment"
      WHERE "endedAt" < ${cutoff}
      ORDER BY "endedAt", "id"
      LIMIT ${safeLimit}
      FOR UPDATE SKIP LOCKED
    ), removed AS (
      DELETE FROM "agent_activity"."WorkstationActivitySegment" AS activity
      USING expired WHERE activity."id" = expired."id"
      RETURNING activity."id"
    ) SELECT count(*)::int AS deleted FROM removed
  `;
}

export async function maintainWorkstationActivity(options: { now?: Date; batchSize?: number; maxBatches?: number } = {}) {
  const retentionDays = activityRetentionDays();
  const cutoff = new Date((options.now ?? new Date()).getTime() - retentionDays * 86_400_000);
  const maxBatches = Math.max(1, Math.min(10, Math.floor(options.maxBatches ?? 4)));
  const batchSize = Math.max(1, Math.min(10_000, Math.floor(options.batchSize ?? 5_000)));
  let deleted = 0;
  let batches = 0;
  const started = Date.now();
  while (batches < maxBatches && Date.now() - started < 20_000) {
    const count = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '1s'`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
      const [row] = await tx.$queryRaw<Array<{ deleted: number }>>(activityRetentionBatch(cutoff, batchSize));
      return row?.deleted ?? 0;
    }, { timeout: 8_000 });
    deleted += count;
    batches++;
    if (count < batchSize) break;
  }
  return { success: true, retentionDays, cutoff: cutoff.toISOString(), deleted, batches };
}
