import { Prisma } from "@prisma/client";

export const realtimeCycleHeadsKey = "realtime:latest-successful-cycle-heads:v1";
type FeedHead = { cycleDownload: string; importedAt: string } | null;
export type RealtimeCycleHeads = { version: 1; queues: FeedHead; agents: FeedHead };
export type CycleHeadsReadDb = Pick<Prisma.TransactionClient,
  "systemConfig" | "realTimeQueueCycleSummary" | "realTimeAgentCycleSummary">;

function validHead(value: unknown): value is FeedHead {
  if (value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const head = value as Record<string, unknown>;
  return typeof head.cycleDownload === "string" && typeof head.importedAt === "string"
    && Number.isFinite(Date.parse(head.importedAt));
}

export function parseRealtimeCycleHeads(value: unknown): RealtimeCycleHeads | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const heads = value as Record<string, unknown>;
  return heads.version === 1 && validHead(heads.queues) && validHead(heads.agents)
    ? { version: 1, queues: heads.queues, agents: heads.agents } : null;
}

export async function queryRealtimeCycleHeads(db: CycleHeadsReadDb): Promise<RealtimeCycleHeads> {
  // Preserve the existing feed-specific selection exactly. A partial import may
  // contain only one feed, and cycle time is not the import ordering key.
  const [queues, agents] = await Promise.all([
    db.realTimeQueueCycleSummary.findFirst({ where: { batch: { status: "SUCCESS" } }, orderBy: [{ batch: { importedAt: "desc" } }, { cycleDownload: "desc" }, { createdAt: "desc" }], select: { cycleDownload: true, batch: { select: { importedAt: true } } } }),
    db.realTimeAgentCycleSummary.findFirst({ where: { batch: { status: "SUCCESS" } }, orderBy: [{ batch: { importedAt: "desc" } }, { cycleDownload: "desc" }, { createdAt: "desc" }], select: { cycleDownload: true, batch: { select: { importedAt: true } } } })
  ]);
  const head = (row: typeof queues): FeedHead => row
    ? { cycleDownload: row.cycleDownload, importedAt: row.batch.importedAt.toISOString() } : null;
  return { version: 1, queues: head(queues), agents: head(agents) };
}

export async function readRealtimeCycleHeads(db: CycleHeadsReadDb): Promise<RealtimeCycleHeads> {
  const stored = await db.systemConfig.findUnique({ where: { key: realtimeCycleHeadsKey }, select: { value: true } });
  // Compatibility for the first release or a malformed/removed checkpoint.
  // Read-only callers, including monitor dry runs, never create the checkpoint.
  return parseRealtimeCycleHeads(stored?.value) ?? queryRealtimeCycleHeads(db);
}

/** Call inside the same transaction as an import, backfill, or history prune. */
export async function refreshRealtimeCycleHeads(db: CycleHeadsReadDb & Pick<Prisma.TransactionClient, "$executeRaw">) {
  // Concurrent imports can finish out of order. Re-read committed summaries
  // after this lock instead of overwriting a newer import with its predecessor.
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('realtime:latest-successful-cycle-heads:v1'))`;
  const heads = await queryRealtimeCycleHeads(db);
  await db.systemConfig.upsert({
    where: { key: realtimeCycleHeadsKey },
    create: { key: realtimeCycleHeadsKey, value: heads as Prisma.InputJsonValue, description: "Latest successful Real Time queue/agent cycles; refreshed atomically with imports" },
    update: { value: heads as Prisma.InputJsonValue }
  });
  return heads;
}
