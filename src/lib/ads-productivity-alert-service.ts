import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  AlertReading, KimAlertDeliveryPayload, alertCycle, buildAdsAlertMessages, buildAdsAlertSummary, buildAdsAlertMentions, evaluateAdsProductivityHour,
  kimAcceptedMessageKey, latestClosedAlertHour, parseAlertCycle, validateAdsAlertWebhook
} from "@/lib/ads-productivity-alert-core";

type SourceRow = Omit<AlertReading, "sourceValid" | "observedPresence"> & {
  batchId: string; wbKey: string; sourceRows: number; importedAt: Date; sourceCycle?: string;
};
type RawSource = { batchId: string; wbLogin: string | null; status: string | null; rawData: Prisma.JsonValue };
const key = (batch: string, cycle: string, wb: string) => `${batch}|${cycle}|${wb.trim().toLowerCase().replace(/\s+/g, "")}`;

function rawField(raw: Record<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    const field = Object.keys(raw).find((name) => name.trim().toLowerCase() === alias.toLowerCase());
    if (field !== undefined) return raw[field];
  }
  return null;
}

function sourceNumber(raw: Record<string, unknown>, aliases: string[]) {
  const value = rawField(raw, aliases);
  if (value === null || value === undefined || String(value).trim() === "") return null;
  // Match the existing Real Time importer, but never default missing data to zero.
  const result = Number(String(value).trim().replace("%", "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(result) && result >= 0 ? result : null;
}

export function prepareAlertReadings(rows: SourceRow[], rawRows: RawSource[]): AlertReading[] {
  const sources = new Map<string, RawSource[]>();
  for (const row of rawRows) {
    if (!row.wbLogin || !row.rawData || typeof row.rawData !== "object" || Array.isArray(row.rawData)) continue;
    const raw = row.rawData as Record<string, unknown>;
    const cycle = String(rawField(raw, ["ciclo_download", "cycle_download", "ciclo download", "data_execucao"]) ?? "");
    const sourceKey = key(row.batchId, cycle, row.wbLogin);
    sources.set(sourceKey, [...(sources.get(sourceKey) ?? []), row]);
  }
  return rows.map((row) => {
    const rawSources = sources.get(key(row.batchId, row.sourceCycle ?? row.cycle, row.wbKey)) ?? [];
    const numbers = rawSources.map((source) => {
      const raw = source.rawData as Record<string, unknown>;
      const execution = String(rawField(raw, ["data_execucao"]) ?? "").replace(" ", "T");
      const executedAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(execution) ? Date.parse(`${execution}-03:00`) : NaN;
      const expectedAt = Date.parse(`${row.cycle.replace(" ", "T")}:00-03:00`);
      return { submit: sourceNumber(raw, ["审核量", "Revisados", "submit", "Submit"]),
        moderation: sourceNumber(raw, ["真实审核时长（毫秒）", "moderation_duration_ms"]),
        collectionValid: !row.sourceCycle || Math.abs(executedAt - expectedAt) <= 90_000 };
    });
    const sourceValid = row.sourceRows > 0 && rawSources.length === row.sourceRows
      && numbers.every((point) => point.collectionValid && point.submit !== null && Number.isInteger(point.submit) && point.moderation !== null)
      && numbers.reduce((sum, point) => sum + (point.submit ?? 0), 0) === row.submit
      && Math.abs(numbers.reduce((sum, point) => sum + (point.moderation ?? 0), 0) - (row.moderationMs ?? NaN)) < 0.01;
    // A pause still counts as presence. Never infer presence from the planned schedule.
    const observedPresence = rawSources.some((source) => ["presente", "online", "pausa", "revisando", "disponível", "refeição", "treinamento", "reunião", "审核", "审核中", "小休", "用餐", "就餐", "培训", "例会", "待命", "空闲"]
      .includes(String(source.status ?? "").trim().toLowerCase()));
    return { ...row, sourceValid, observedPresence };
  });
}

export async function readAdsProductivityAlert(now = new Date(), presenceOnly = true) {
  const interval = latestClosedAlertHour(now);
  const cycles = Array.from({ length: 13 }, (_, index) => alertCycle(parseAlertCycle(interval.start) + index * 300_000));
  const slots = cycles.map((cycle) => ({ cycle,
    sourceCycle: `${cycle.slice(0, 14)}${Number(cycle.slice(14)) < 30 ? "00" : "30"}`,
    at: new Date(`${cycle.replace(" ", "T")}:00-03:00`) }));
  // A nominal half-hour cycle is refreshed every five minutes. Latest-per-cycle
  // would compare e.g. 13:25 with 14:10 (45 minutes), creating false alerts.
  // Pick the successful collection nearest each five-minute boundary, globally.
  // The 90-second tolerance covers collector clock/upload jitter, not missing slots.
  const rows = await prisma.$queryRaw<SourceRow[]>(Prisma.sql`
    WITH slots(cycle, "sourceCycle", at) AS (VALUES ${Prisma.join(slots.map((slot) => Prisma.sql`(${slot.cycle}, ${slot.sourceCycle}, ${slot.at}::timestamp)`))}),
    picked AS (
      SELECT slots.*, b.id AS "batchId", b."importedAt"
      FROM slots
      JOIN LATERAL (
        SELECT b.id, b."importedAt" FROM "RealTimeImportBatch" b
        WHERE b.status = 'SUCCESS' AND b."agentRows" > 0
          AND b."importedAt" BETWEEN slots.at - interval '90 seconds' AND slots.at + interval '90 seconds'
          AND EXISTS (SELECT 1 FROM "RealTimeAgentCycleSummary" a WHERE a."batchId" = b.id AND a."cycleDownload" = slots."sourceCycle")
        ORDER BY abs(extract(epoch FROM b."importedAt" - slots.at)), b."importedAt" DESC, b.id DESC LIMIT 1
      ) b ON true
    )
    SELECT p.cycle, a."cycleDownload" AS "sourceCycle", a."batchId", a."wbLoginNormalized" AS "wbKey",
      a."employeeId", a."displayName" AS name, a."wbLogin", a.lob, a."personType",
      a."employeeStatus", a."crossingStatus", a.submit, a."moderationMs", a."sourceRows", p."importedAt",
      e."supervisorId", s."fullName" AS "supervisorName", s."wbLogin" AS "supervisorWb"
    FROM "RealTimeAgentCycleSummary" a
    JOIN picked p ON p."batchId" = a."batchId" AND p."sourceCycle" = a."cycleDownload"
    LEFT JOIN "EmployeeProfile" e ON e.id = a."employeeId" AND e."deletedAt" IS NULL
    LEFT JOIN "EmployeeProfile" s ON s.id = e."supervisorId" AND s."deletedAt" IS NULL
    WHERE upper(trim(a.lob)) = 'ADS'
    ORDER BY p.cycle, a."wbLoginNormalized", a.id
  `);
  const available = new Set(rows.map((row) => row.cycle));
  if (cycles.some((cycle) => !available.has(cycle))) {
    return { status: "skipped" as const, reason: "incomplete_hour", interval, missingCycles: cycles.filter((cycle) => !available.has(cycle)) };
  }
  const rawRows = await prisma.realTimeRecord.findMany({
    where: { recordType: "AGENT", batchId: { in: [...new Set(rows.map((row) => row.batchId))] } },
    select: { batchId: true, wbLogin: true, status: true, rawData: true }
  });
  const readings = prepareAlertReadings(rows, rawRows);
  // The confirmed rule excludes zero-submit agents altogether. A positive valid
  // submit delta itself proves activity, so capture/schedules need not be queried.
  const result = evaluateAdsProductivityHour(readings, interval, presenceOnly, 5);
  return { status: "ready" as const, result, messages: buildAdsAlertMessages(result),
    sourceBatchIds: [...new Set(rows.map((row) => row.batchId))] };
}

export type AlertDeliveryStore = {
  claim(key: string, digest: string): Promise<boolean>;
  finish(key: string, value: { status: "sent" | "uncertain"; messageKeys: string[] }): Promise<void>;
};

const deliveryStore: AlertDeliveryStore = {
  async claim(deliveryKey, digest) {
    try {
      await prisma.systemConfig.create({ data: { key: deliveryKey,
        description: "ADS hourly alert delivery receipt (server only)",
        value: { status: "claimed", digest, claimedAt: new Date().toISOString() } } });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
      throw error;
    }
  },
  async finish(deliveryKey, receipt) {
    await prisma.systemConfig.update({ where: { key: deliveryKey }, data: {
      value: { ...receipt, updatedAt: new Date().toISOString() }
    } });
  }
};

export async function deliverAdsAlertMessages(input: {
  webhook: string; intervalEnd: string; messages: KimAlertDeliveryPayload[];
  prepareMessages?: () => Promise<KimAlertDeliveryPayload[]>;
  store?: AlertDeliveryStore; fetcher?: typeof fetch;
}) {
  const webhook = validateAdsAlertWebhook(input.webhook);
  const store = input.store ?? deliveryStore;
  const fetcher = input.fetcher ?? fetch;
  let bodies = input.messages.map((message) => JSON.stringify(message));
  if (bodies.some((body) => Buffer.byteLength(body, "utf8") > 7900)) throw new Error("KIM alert exceeds safe message size.");
  if (!bodies.length) return { sent: 0, alreadyClaimed: 0 };
  // Claim the entire hour, not page numbers: a corrected import must not change
  // page boundaries and notify some of the same people twice on a retry.
  const deliveryKey = `ads-productivity-alert:v1:${input.intervalEnd}`;
  const digest = createHash("sha256").update(JSON.stringify(input.messages)).digest("hex");
  if (!await store.claim(deliveryKey, digest)) return { sent: 0, alreadyClaimed: 1 };
  const messageKeys: string[] = [];
  try {
    // The hour is claimed BEFORE rendering/uploading. All image uploads must
    // succeed before the first group message; failures cannot send a half-built card.
    if (input.prepareMessages) {
      bodies = (await input.prepareMessages()).map((message) => JSON.stringify(message));
      if (!bodies.length || bodies.some((body) => Buffer.byteLength(body, "utf8") > 7900)) throw new Error("Invalid prepared ADS alert size.");
    }
    for (let index = 0; index < bodies.length; index++) {
      const response = await fetcher(webhook, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json", "Idempotency-Key": `${deliveryKey}:${index + 1}` }, body: bodies[index]
      });
      // Never log the response body: providers may echo the secret webhook URL.
      const responseBody: unknown = await response.json();
      const messageKey = response.ok ? kimAcceptedMessageKey(responseBody) : null;
      if (!messageKey) throw new Error("KIM did not confirm alert delivery.");
      messageKeys.push(messageKey);
    }
    await store.finish(deliveryKey, { status: "sent", messageKeys });
  } catch {
    // KIM does not document idempotency guarantees. A timeout may mean it was sent.
    // Keep the claim and require manual reconciliation rather than notify twice.
    await store.finish(deliveryKey, { status: "uncertain", messageKeys }).catch(() => undefined);
    throw new Error("ADS alert delivery could not be confirmed. Automatic resend is blocked to avoid duplicates.");
  }
  return { sent: messageKeys.length, alreadyClaimed: 0 };
}

export async function sendAdsProductivityAlerts(options: { dryRun?: boolean; now?: Date } = {}) {
  const enabled = process.env.ADS_PRODUCTIVITY_ALERT_ENABLED?.trim().toLowerCase() === "true";
  if (!options.dryRun && !enabled) return { status: "skipped", reason: "disabled" };
  const webhook = options.dryRun ? "" : validateAdsAlertWebhook(process.env.ADS_PRODUCTIVITY_ALERT_WEBHOOK_URL ?? "");
  const presenceOnly = true;
  const evaluation = await readAdsProductivityAlert(options.now ?? new Date(), presenceOnly);
  if (evaluation.status === "skipped") return evaluation;
  const { result } = evaluation;
  const messages: KimAlertDeliveryPayload[] = result.offenders.length ? [buildAdsAlertSummary(result), ...buildAdsAlertMentions(result)] : [];
  const summary = { interval: result.interval, evaluated: result.evaluatedCount, offenders: result.offenders.length,
    excludedInvalid: result.issues.length, excludedNoPresence: result.outsideInterval, presenceOnly,
    sourceBatchIds: evaluation.sourceBatchIds };
  if (options.dryRun) return { status: "preview", ...summary, messages, issues: result.issues };
  if (!messages.length) return { status: "skipped", reason: result.evaluatedCount ? "no_offenders" : "no_valid_readings", ...summary };
  const delivery = await deliverAdsAlertMessages({ webhook, intervalEnd: result.interval.end, messages, prepareMessages: async () => {
    const { prepareAdsAlertDelivery } = await import("./ads-productivity-alert-kim");
    return prepareAdsAlertDelivery(result, webhook);
  } });
  return { status: delivery.sent ? "sent" : "already_claimed", ...summary, ...delivery };
}
