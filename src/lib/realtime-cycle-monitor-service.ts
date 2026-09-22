import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { kimAcceptedMessageKey, validateAdsAlertWebhook } from "@/lib/ads-productivity-alert-core";
import { evaluateCycle, monitorMessage, transitionCycles, type MonitorState } from "./realtime-cycle-monitor-core";
const stateKey = "realtime-cycle-monitor:v1:state";
const receiptKey = (id: string) => `realtime-cycle-monitor:v1:delivery:${id}`;

export async function readCycleHealth(now = new Date(), db: Pick<Prisma.TransactionClient, "realTimeQueueCycleSummary" | "realTimeAgentCycleSummary"> = prisma) {
  const [q, a] = await Promise.all([
    db.realTimeQueueCycleSummary.findFirst({ where: { batch: { status: "SUCCESS" } }, orderBy: [{ cycleDownload: "desc" }, { createdAt: "desc" }], select: { cycleDownload: true, batch: { select: { importedAt: true } } } }),
    db.realTimeAgentCycleSummary.findFirst({ where: { batch: { status: "SUCCESS" } }, orderBy: [{ cycleDownload: "desc" }, { createdAt: "desc" }], select: { cycleDownload: true, batch: { select: { importedAt: true } } } })
  ]);
  return [evaluateCycle({ feed: "queues", cycle: q?.cycleDownload ?? null, importedAt: q?.batch.importedAt.toISOString() ?? null }, now), evaluateCycle({ feed: "agents", cycle: a?.cycleDownload ?? null, importedAt: a?.batch.importedAt.toISOString() ?? null }, now)];
}

// Claims are committed BEFORE sending. KIM has no documented idempotency
// guarantee: an uncertain delivery must be reconciled, never blindly retried.
async function deliver(id: string, content: string, webhook: string, fetcher: typeof fetch) {
  try {
    const response = await fetcher(webhook, { method: "POST", redirect: "error", signal: AbortSignal.timeout(12_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ msgtype: "text", text: { content } }) });
    const messageKey = response.ok ? kimAcceptedMessageKey(await response.json()) : null;
    if (!messageKey) throw new Error("No KIM receipt");
    await prisma.systemConfig.update({ where: { key: receiptKey(id) }, data: { value: { status: "sent", messageKey, at: new Date().toISOString() } } });
    return { status: "sent", messageKey };
  } catch {
    await prisma.systemConfig.update({ where: { key: receiptKey(id) }, data: { value: { status: "uncertain", at: new Date().toISOString() } } }).catch(() => undefined);
    return { status: "uncertain" };
  }
}

export async function runCycleMonitor(options: { dryRun?: boolean; testId?: string; now?: Date; fetcher?: typeof fetch } = {}) {
  const now = options.now ?? new Date();
  const enabled = process.env.REALTIME_CYCLE_MONITOR_ENABLED === "true";
  if (!options.dryRun && !enabled && !options.testId) return { status: "disabled" };
  const webhook = options.dryRun ? "" : validateAdsAlertWebhook(process.env.REALTIME_CYCLE_MONITOR_KIM_URL ?? "");
  if (options.testId) {
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(options.testId)) throw new Error("Invalid test ID");
    const id = `test:${options.testId}`;
    try { await prisma.systemConfig.create({ data: { key: receiptKey(id), value: { status: "claimed", at: now.toISOString() }, description: "Real Time monitor test receipt" } }); }
    catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { status: "already_claimed" }; throw e; }
    return deliver(id, monitorMessage(null, now), webhook, options.fetcher ?? fetch);
  }
  if (options.dryRun) return { status: "preview", enabled, health: await readCycleHealth(now) };
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('realtime-cycle-monitor:v1'))`;
    // Read after locking so overlapping invocations cannot apply stale evaluations.
    const checkedAt = options.now ?? new Date();
    const health = await readCycleHealth(checkedAt, tx);
    const previous = await tx.systemConfig.findUnique({ where: { key: stateKey } });
    const { state, events } = transitionCycles((previous?.value ?? {}) as MonitorState, health, checkedAt);
    if (events.length) await tx.systemConfig.upsert({ where: { key: stateKey }, create: { key: stateKey, value: state as Prisma.InputJsonValue }, update: { value: state as Prisma.InputJsonValue } });
    for (const event of events) await tx.systemConfig.create({ data: { key: receiptKey(event.id), value: { status: "claimed", at: now.toISOString(), kind: event.kind, feed: event.health.feed }, description: "Real Time monitor delivery receipt" } });
    return { health, events };
  }, { timeout: 20_000 });
  const deliveries = [];
  for (const event of result.events) deliveries.push({ feed: event.health.feed, kind: event.kind, ...await deliver(event.id, monitorMessage(event, now), webhook, options.fetcher ?? fetch) });
  return { status: deliveries.some(d => d.status === "uncertain") ? "uncertain" : deliveries.length ? "sent" : "unchanged", health: result.health, deliveries };
}
