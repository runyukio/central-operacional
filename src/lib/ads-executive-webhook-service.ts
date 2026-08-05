import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

import {
  buildAdsBacklogHourlyReportSnapshot,
  buildAdsBacklogKwaiTalkPayload
} from "@/lib/ads-backlog-hourly-report-core";
import {
  buildAdsExecutiveReportSnapshot,
  parseAdsExecutiveCycle,
  type AdsExecutiveAgentRow,
  type AdsExecutiveForecastPoint,
  type AdsExecutiveRequirement,
  type AdsExecutiveQueueRow,
  type ExecutiveReportLob
} from "@/lib/ads-executive-report-core";
import { renderAdsExecutiveReportPng } from "@/lib/ads-executive-report-image";
import { buildAdsOnlineProductivityReportSnapshot } from "@/lib/ads-online-productivity-report-core";
import { renderAdsOnlineProductivityReportPng } from "@/lib/ads-online-productivity-report-image";
import { calculateForecastModelWeights, predictForecastHour, type ForecastActual } from "@/lib/performance-forecast-core";
import { prisma } from "@/lib/prisma";
import { QUEUE_METADATA } from "@/lib/queue-metadata";
import { QUEUE_REPORT_METADATA } from "@/lib/queue-report-metadata";
import { getRealtimeSnapshot } from "@/lib/realtime-service";
import { uploadPublicObject } from "@/lib/supabase-storage";

const DAY_MS = 24 * 60 * 60 * 1000;
const FORECAST_HISTORY_DAYS = 120;
const DEFAULT_TIMEOUT_MS = 30_000;

const automationActor = {
  email: "realtime-api@central.local",
  name: "Real Time API",
  role: "ADMIN" as const
};

type WebhookPayloadMode = "multipart" | "json" | "kwaitalk";
type WebhookReportType = "ADS_EXECUTIVE" | "VIDEO_EXECUTIVE" | "ADS_ONLINE_PRODUCTIVITY";
type ExecutiveWebhookConfig = {
  lob: ExecutiveReportLob;
  envPrefix: "ADS_EXECUTIVE_WEBHOOK" | "VIDEO_EXECUTIVE_WEBHOOK";
  reportType: WebhookReportType;
  storagePath: string;
};

const ADS_WEBHOOK_CONFIG: ExecutiveWebhookConfig = {
  lob: "ADS",
  envPrefix: "ADS_EXECUTIVE_WEBHOOK",
  reportType: "ADS_EXECUTIVE",
  storagePath: "automation/ads-executive/latest.png"
};

const VIDEO_WEBHOOK_CONFIG: ExecutiveWebhookConfig = {
  lob: "VIDEO",
  envPrefix: "VIDEO_EXECUTIVE_WEBHOOK",
  reportType: "VIDEO_EXECUTIVE",
  storagePath: "automation/video-executive/latest.png"
};

const ADS_ONLINE_PRODUCTIVITY_STORAGE_PATH = "automation/ads-online-productivity/latest.png";

type KwaiTalkWebhookResponse = {
  code?: number | string;
  message?: string;
  msg?: string;
  success?: boolean;
  ok?: boolean;
};

export type AdsExecutiveWebhookResult = {
  sent: boolean;
  skipped: boolean;
  selectedCycle: string | null;
  fileName: string | null;
  bytes: number;
  status: number | null;
  message: string;
};

export async function sendLatestAdsExecutiveReport(): Promise<AdsExecutiveWebhookResult> {
  return sendLatestExecutiveReport(ADS_WEBHOOK_CONFIG);
}

export async function sendLatestVideoExecutiveReport(): Promise<AdsExecutiveWebhookResult> {
  return sendLatestExecutiveReport(VIDEO_WEBHOOK_CONFIG);
}

export async function sendLatestAdsOnlineProductivityReport(): Promise<AdsExecutiveWebhookResult> {
  if (!isWebhookEnabled(ADS_WEBHOOK_CONFIG)) {
    return {
      sent: false,
      skipped: true,
      selectedCycle: null,
      fileName: null,
      bytes: 0,
      status: null,
      message: "ADS online productivity report delivery is disabled."
    };
  }

  const webhookUrl = resolveWebhookUrl(ADS_WEBHOOK_CONFIG);
  if (!webhookUrl) throw new Error("ADS_EXECUTIVE_WEBHOOK_URL is not configured.");

  const realtime = await getRealtimeSnapshot(automationActor, { view: "both" });
  if ("error" in realtime && realtime.error) throw new Error(realtime.error);
  const data = "data" in realtime ? realtime.data : null;
  const selectedCycle = data?.agents.selectedCycle || data?.queueView.selectedCycle;
  if (!data?.summary.hasData || !selectedCycle) {
    throw new Error("There is no valid Real Time snapshot for the ADS online productivity report.");
  }

  const report = buildAdsOnlineProductivityReportSnapshot({
    selectedCycle,
    agentRows: mapAgentRows(data.agents.rows)
  });
  const image = await renderAdsOnlineProductivityReportPng(report);
  const fileName = `ads_online_productivity_${safeFilePart(selectedCycle)}.png`;
  const idempotencyKey = `ads-online-productivity:${selectedCycle}`;
  const mode = resolvePayloadMode(ADS_WEBHOOK_CONFIG);
  const imageUrl = mode === "kwaitalk"
    ? await publishKwaiTalkImage(image, fileName, selectedCycle, ADS_ONLINE_PRODUCTIVITY_STORAGE_PATH)
    : null;
  const response = await postWebhook({
    url: webhookUrl,
    image,
    fileName,
    idempotencyKey,
    mode,
    token: resolveWebhookToken(ADS_WEBHOOK_CONFIG),
    imageUrl,
    lob: "ADS",
    reportTitle: "ADS Online Productivity",
    reportType: "ADS_ONLINE_PRODUCTIVITY",
    timeoutMs: resolveTimeoutMs(ADS_WEBHOOK_CONFIG),
    metadata: {
      reportType: "ADS_ONLINE_PRODUCTIVITY",
      selectedCycle,
      date: report.dateKey,
      generatedAt: new Date().toISOString(),
      contentType: "image/png"
    }
  });

  return {
    sent: true,
    skipped: false,
    selectedCycle,
    fileName,
    bytes: image.byteLength,
    status: response.status,
    message: "ADS online productivity report sent to the webhook."
  };
}

export async function sendLatestAdsBacklogHourlyReport(): Promise<AdsExecutiveWebhookResult> {
  if (!isAdsBacklogWebhookEnabled()) {
    return {
      sent: false,
      skipped: true,
      selectedCycle: null,
      fileName: null,
      bytes: 0,
      status: null,
      message: "ADS backlog hourly report delivery is disabled."
    };
  }

  const webhookUrl = String(process.env.ADS_BACKLOG_WEBHOOK_URL ?? "").trim();
  if (!webhookUrl) throw new Error("ADS_BACKLOG_WEBHOOK_URL is not configured.");

  const realtime = await getRealtimeSnapshot(automationActor, { view: "both" });
  if ("error" in realtime && realtime.error) throw new Error(realtime.error);
  const data = "data" in realtime ? realtime.data : null;
  const selectedCycle = data?.queueView.selectedCycle || data?.agents.selectedCycle;
  if (!data?.summary.hasData || !selectedCycle) {
    throw new Error("There is no valid Real Time snapshot for the ADS backlog hourly report.");
  }

  const report = buildAdsBacklogHourlyReportSnapshot({
    selectedCycle,
    queueRows: mapQueueRows(data.queueView.rows),
    agentRows: mapAgentRows(data.agents.rows)
  });
  if (!report) {
    return {
      sent: false,
      skipped: true,
      selectedCycle,
      fileName: null,
      bytes: 0,
      status: null,
      message: "The selected cycle is outside the ADS backlog plan or does not have complete live data."
    };
  }

  const response = await postAdsBacklogWebhook({
    url: webhookUrl,
    payload: buildAdsBacklogKwaiTalkPayload(report),
    idempotencyKey: `ads-backlog-hourly:${selectedCycle}`,
    timeoutMs: resolveAdsBacklogTimeoutMs()
  });

  return {
    sent: true,
    skipped: false,
    selectedCycle,
    fileName: null,
    bytes: 0,
    status: response.status,
    message: "ADS backlog hourly report sent to the webhook."
  };
}

async function sendLatestExecutiveReport(config: ExecutiveWebhookConfig): Promise<AdsExecutiveWebhookResult> {
  if (!isWebhookEnabled(config)) {
    return {
      sent: false,
      skipped: true,
      selectedCycle: null,
      fileName: null,
      bytes: 0,
      status: null,
      message: `Envio do report Executivo ${config.lob} desabilitado.`
    };
  }

  const webhookUrl = resolveWebhookUrl(config);
  if (!webhookUrl) {
    throw new Error(`${config.envPrefix}_URL não configurada.`);
  }

  const realtime = await getRealtimeSnapshot(automationActor, { view: "both" });
  if ("error" in realtime && realtime.error) throw new Error(realtime.error);
  const data = "data" in realtime ? realtime.data : null;
  const selectedCycle = data?.queueView.selectedCycle || data?.agents.selectedCycle;
  if (!data?.summary.hasData || !selectedCycle) {
    throw new Error(`Não há snapshot válido do Real Time para gerar o report Executivo ${config.lob}.`);
  }

  const parsedCycle = parseAdsExecutiveCycle(selectedCycle);
  const [forecast, requirements] = await Promise.all([
    loadExecutiveForecast(config.lob, parsedCycle.dateKey),
    loadExecutiveRequirements(config.lob, parsedCycle.dateKey)
  ]);
  const report = buildAdsExecutiveReportSnapshot({
    lob: config.lob,
    selectedCycle,
    queueRows: mapQueueRows(data.queueView.rows),
    agentRows: mapAgentRows(data.agents.rows),
    forecast,
    requirements
  });
  const image = await renderAdsExecutiveReportPng(report);
  const lobKey = config.lob.toLowerCase();
  const fileName = `${lobKey}_executive_${safeFilePart(selectedCycle)}.png`;
  const idempotencyKey = `${lobKey}-executive:${selectedCycle}`;
  const mode = resolvePayloadMode(config);
  const imageUrl = mode === "kwaitalk"
    ? await publishKwaiTalkImage(image, fileName, selectedCycle, config.storagePath)
    : null;
  const response = await postWebhook({
    url: webhookUrl,
    image,
    fileName,
    idempotencyKey,
    mode,
    token: resolveWebhookToken(config),
    imageUrl,
    lob: config.lob,
    reportType: config.reportType,
    timeoutMs: resolveTimeoutMs(config),
    metadata: {
      reportType: config.reportType,
      selectedCycle,
      date: report.dateKey,
      generatedAt: new Date().toISOString(),
      contentType: "image/png"
    }
  });

  return {
    sent: true,
    skipped: false,
    selectedCycle,
    fileName,
    bytes: image.byteLength,
    status: response.status,
    message: `Report Executivo ${config.lob} enviado ao webhook.`
  };
}

function mapQueueRows(rows: Array<Record<string, unknown>>): AdsExecutiveQueueRow[] {
  return rows.map((row) => ({
    lob: String(row.lob ?? ""),
    slaTargetMinutes: nullableFinite(row.slaTargetMinutes),
    history: Array.isArray(row.history)
      ? row.history.map((item) => {
        const history = objectValue(item);
        return {
          cycleDownload: String(history.cycleDownload ?? ""),
          input: finite(history.input),
          output: finite(history.output),
          ahtMs: nullableFinite(history.ahtMs),
          latencyMs: nullableFinite(history.latencyMs),
          maxLatencyMs: nullableFinite(history.maxLatencyMs),
          backlog: finite(history.backlog)
        };
      })
      : []
  }));
}

function mapAgentRows(rows: Array<Record<string, unknown>>): AdsExecutiveAgentRow[] {
  return rows.map((row) => ({
    displayName: String(row.displayName ?? ""),
    wbLogin: String(row.wbLogin ?? ""),
    rawWbLogin: String(row.rawWbLogin ?? ""),
    skill: String(row.skill ?? ""),
    lob: String(row.lob ?? ""),
    crossingStatus: String(row.crossingStatus ?? ""),
    personType: String(row.personType ?? ""),
    employeeStatus: String(row.employeeStatus ?? ""),
    presenceStatus: String(row.presenceStatus ?? ""),
    isSchedulePresent: Boolean(row.isSchedulePresent),
    history: Array.isArray(row.history)
      ? row.history.map((item) => {
        const history = objectValue(item);
        return {
          cycleDownload: String(history.cycleDownload ?? ""),
          submit: finite(history.submit),
          ahtMs: nullableFinite(history.ahtMs),
          moderationMs: finite(history.moderationMs)
        };
      })
      : []
  }));
}

async function loadExecutiveForecast(lob: ExecutiveReportLob, dateKey: string): Promise<AdsExecutiveForecastPoint[]> {
  const queueIds = queueIdsForLob(lob);
  if (!queueIds.length) return [];
  const dayStart = utcDate(dateKey);
  const historyStart = new Date(dayStart.getTime() - FORECAST_HISTORY_DAYS * DAY_MS);
  const rows = await prisma.$queryRaw<Array<{ at: Date; input: number }>>(Prisma.sql`
    SELECT
      date_trunc('hour', "bzTime") AS "at",
      COALESCE(SUM("inputCount"), 0)::double precision AS "input"
    FROM "PerformanceQueueVolumeRecord"
    WHERE "queueId" IN (${Prisma.join(queueIds)})
      AND "bzTime" >= ${historyStart}
      AND "bzTime" < ${dayStart}
    GROUP BY date_trunc('hour', "bzTime")
    ORDER BY date_trunc('hour', "bzTime") ASC
  `);
  const actuals = rows
    .map<ForecastActual>((row) => {
      const at = startOfUtcHour(row.at);
      return { at, timestamp: at.getTime(), input: Math.max(0, Number(row.input ?? 0)) };
    })
    .filter((row) => row.input > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
  const reference = actuals.at(-1);
  if (!reference || actuals.length < 48) return [];
  const weights = calculateForecastModelWeights(actuals, reference.at);
  return Array.from({ length: 24 }, (_, hour) => {
    const target = new Date(dayStart.getTime() + hour * 60 * 60 * 1000);
    return {
      dateKey,
      hour,
      input: Math.max(0, Math.round(predictForecastHour(actuals, target, reference.at, weights).forecast))
    };
  });
}

async function loadAdsRequirements(dateKey: string) {
  const date = utcDate(dateKey);
  const [rows, shiftFallback] = await Promise.all([
    prisma.adsHourlyRequirement.findMany({
      where: { date },
      orderBy: { hour: "asc" },
      select: { hour: true, requiredStaff: true }
    }),
    loadStaffCoverageRequirements("ADS", dateKey)
  ]);
  const hourlyRequirements = rows.map((row) => ({ hour: row.hour, required: row.requiredStaff }));
  const requirements = mergeExecutiveRequirements(hourlyRequirements, shiftFallback);
  const importedHours = new Set(hourlyRequirements.map((row) => row.hour));
  const fallbackHours = requirements.filter((row) => !importedHours.has(row.hour)).map((row) => row.hour);

  if (fallbackHours.length) {
    console.info("[ads-executive-report] Required HC fallback applied", {
      dateKey,
      importedHours: hourlyRequirements.length,
      fallbackHours
    });
  } else if (!requirements.length) {
    console.warn("[ads-executive-report] Required HC unavailable", { dateKey });
  }

  return requirements;
}

async function loadExecutiveRequirements(lob: ExecutiveReportLob, dateKey: string) {
  if (lob === "ADS") return loadAdsRequirements(dateKey);
  return loadStaffCoverageRequirements(lob, dateKey);
}

async function loadStaffCoverageRequirements(lob: ExecutiveReportLob, dateKey: string) {
  const rows = await prisma.staffCoverage.findMany({
    where: {
      date: utcDate(dateKey),
      lob: { name: { equals: lob, mode: "insensitive" } }
    },
    select: {
      requiredStaff: true,
      shift: { select: { name: true } }
    }
  });
  return expandExecutiveShiftRequirements(rows);
}

export function expandExecutiveShiftRequirements(rows: Array<{ requiredStaff: number; shift: { name: string } }>) {
  const requiredByHour = new Map<number, number>();
  for (const row of rows) {
    for (const hour of executiveShiftHours(row.shift.name)) {
      requiredByHour.set(hour, (requiredByHour.get(hour) ?? 0) + Math.max(0, row.requiredStaff));
    }
  }
  return Array.from(requiredByHour, ([hour, required]) => ({ hour, required })).sort((a, b) => a.hour - b.hour);
}

export function mergeExecutiveRequirements(
  primary: AdsExecutiveRequirement[],
  fallback: AdsExecutiveRequirement[]
) {
  const requiredByHour = new Map(fallback.map((row) => [row.hour, row.required]));
  for (const row of primary) requiredByHour.set(row.hour, row.required);
  return Array.from(requiredByHour, ([hour, required]) => ({ hour, required })).sort((a, b) => a.hour - b.hour);
}

async function postWebhook(input: {
  url: string;
  image: Buffer;
  fileName: string;
  idempotencyKey: string;
  mode: WebhookPayloadMode;
  token: string | null;
  imageUrl: string | null;
  lob: ExecutiveReportLob;
  reportTitle?: string;
  reportType: WebhookReportType;
  timeoutMs: number;
  metadata: Record<string, string>;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  const headers = new Headers({
    Accept: "application/json, text/plain, */*",
    "Idempotency-Key": input.idempotencyKey,
    "X-Report-Type": input.reportType
  });
  if (input.token) headers.set("Authorization", `Bearer ${input.token}`);

  let body: BodyInit;
  if (input.mode === "kwaitalk") {
    if (!input.imageUrl) throw new Error("A imagem publica do report nao foi gerada para o KwaiTalk.");
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(buildKwaiTalkMarkdownPayload({
      lob: input.lob,
      reportTitle: input.reportTitle,
      imageUrl: input.imageUrl,
      selectedCycle: input.metadata.selectedCycle,
      generatedAt: input.metadata.generatedAt
    }));
  } else if (input.mode === "json") {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify({
      ...input.metadata,
      fileName: input.fileName,
      mimeType: "image/png",
      imageBase64: input.image.toString("base64")
    });
  } else {
    const form = new FormData();
    form.set("reportType", input.reportType);
    form.set("cycle", input.metadata.selectedCycle);
    form.set("date", input.metadata.date);
    form.set("metadata", JSON.stringify(input.metadata));
    form.set("file", new Blob([new Uint8Array(input.image)], { type: "image/png" }), input.fileName);
    body = form;
  }

  try {
    const response = await fetch(input.url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow"
    });
    const responseText = await response.text();
    if (!response.ok) {
      const detail = sanitizeResponseBody(responseText);
      throw new Error(`Webhook respondeu HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    if (input.mode === "kwaitalk") assertKwaiTalkAccepted(responseText);
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Webhook excedeu o limite de ${input.timeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function postAdsBacklogWebhook(input: {
  url: string;
  payload: ReturnType<typeof buildAdsBacklogKwaiTalkPayload>;
  idempotencyKey: string;
  timeoutMs: number;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch(input.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
        "X-Report-Type": "ADS_BACKLOG_HOURLY"
      },
      body: JSON.stringify(input.payload),
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow"
    });
    const responseText = await response.text();
    if (!response.ok) {
      const detail = sanitizeResponseBody(responseText);
      throw new Error(`Webhook respondeu HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    assertKwaiTalkAccepted(responseText);
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Webhook excedeu o limite de ${input.timeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function queueIdsForLob(lob: ExecutiveReportLob) {
  return Array.from(new Set([
    ...Object.entries(QUEUE_METADATA).filter(([, metadata]) => metadata.lob === lob).map(([queueId]) => queueId),
    ...Object.entries(QUEUE_REPORT_METADATA).filter(([, metadata]) => metadata.lob === lob).map(([queueId]) => queueId)
  ]));
}

function isWebhookEnabled(config: ExecutiveWebhookConfig) {
  return ["1", "true", "yes", "on"].includes(String(process.env[`${config.envPrefix}_ENABLED`] ?? "").trim().toLowerCase());
}

function isAdsBacklogWebhookEnabled() {
  return ["1", "true", "yes", "on"].includes(
    String(process.env.ADS_BACKLOG_WEBHOOK_ENABLED ?? "").trim().toLowerCase()
  );
}

function resolveAdsBacklogTimeoutMs() {
  const parsed = Number(process.env.ADS_BACKLOG_WEBHOOK_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed >= 1_000 && parsed <= 120_000 ? Math.round(parsed) : DEFAULT_TIMEOUT_MS;
}

function resolveWebhookUrl(config: ExecutiveWebhookConfig) {
  const fallback = config.lob === "ADS" ? process.env.PROJECT_WEBHOOK_URL : "";
  return String(process.env[`${config.envPrefix}_URL`] ?? fallback ?? "").trim();
}

function resolveWebhookToken(config: ExecutiveWebhookConfig) {
  const fallback = config.lob === "ADS" ? process.env.PROJECT_WEBHOOK_TOKEN : "";
  const token = String(process.env[`${config.envPrefix}_TOKEN`] ?? fallback ?? "").trim();
  return token || null;
}

function resolvePayloadMode(config: ExecutiveWebhookConfig): WebhookPayloadMode {
  const mode = String(process.env[`${config.envPrefix}_PAYLOAD_MODE`] ?? "multipart").trim().toLowerCase();
  if (mode === "json" || mode === "kwaitalk") return mode;
  return "multipart";
}

async function publishKwaiTalkImage(image: Buffer, fileName: string, selectedCycle: string, storagePath: string) {
  const file = new File([new Uint8Array(image)], fileName, { type: "image/png" });
  const immutablePath = buildExecutiveReportStoragePath(
    storagePath,
    buildExecutiveReportDeliveryFileName(fileName, randomUUID())
  );
  const uploaded = await uploadPublicObject("mural-media", immutablePath, file);
  const version = encodeURIComponent(selectedCycle);
  return `${uploaded.publicUrl}${uploaded.publicUrl.includes("?") ? "&" : "?"}v=${version}`;
}

export function buildExecutiveReportStoragePath(latestPath: string, fileName: string) {
  const normalizedPath = latestPath.replace(/^\/+|\/+$/g, "");
  const directoryEnd = normalizedPath.lastIndexOf("/");
  const directory = directoryEnd >= 0 ? normalizedPath.slice(0, directoryEnd) : "";
  const safeFileName = fileName.replace(/^\/+/, "").replace(/\.\./g, "");
  return directory ? `${directory}/${safeFileName}` : safeFileName;
}

export function buildExecutiveReportDeliveryFileName(fileName: string, deliveryId: string) {
  const extensionIndex = fileName.lastIndexOf(".");
  const baseName = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : ".png";
  const safeBaseName = baseName.replace(/^\/+/, "").replace(/\.\./g, "");
  const safeDeliveryId = deliveryId.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${safeBaseName}_${safeDeliveryId || "delivery"}${extension}`;
}

export function buildKwaiTalkMarkdownPayload(input: {
  lob?: ExecutiveReportLob;
  reportTitle?: string;
  imageUrl: string;
  selectedCycle: string;
  generatedAt: string;
}) {
  const lob = input.lob ?? "ADS";
  const reportTitle = input.reportTitle ?? `${lob} Executive Report`;
  const generatedAt = formatKwaiTalkGeneratedAt(input.generatedAt);
  return {
    msgtype: "markdown",
    markdown: {
      content: [
        `### ${reportTitle}`,
        `**Cycle:** ${input.selectedCycle}`,
        `**Generated:** ${generatedAt}`,
        `![${reportTitle}](${input.imageUrl})`
      ].join("\n\n")
    }
  };
}

export function assertKwaiTalkAccepted(responseText: string) {
  if (!responseText.trim()) return;
  let payload: KwaiTalkWebhookResponse;
  try {
    payload = JSON.parse(responseText) as KwaiTalkWebhookResponse;
  } catch {
    return;
  }
  const code = payload.code === undefined ? null : Number(payload.code);
  const rejectedByCode = code !== null && ![0, 200].includes(code);
  const rejectedExplicitly = payload.success === false || payload.ok === false;
  if (rejectedByCode || rejectedExplicitly) {
    const detail = sanitizeResponseBody(String(payload.message ?? payload.msg ?? "resposta rejeitada"));
    throw new Error(`KwaiTalk rejeitou a mensagem${detail ? `: ${detail}` : ""}`);
  }
}

function formatKwaiTalkGeneratedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function resolveTimeoutMs(config: ExecutiveWebhookConfig) {
  const parsed = Number(process.env[`${config.envPrefix}_TIMEOUT_MS`] ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed >= 1_000 && parsed <= 120_000 ? Math.round(parsed) : DEFAULT_TIMEOUT_MS;
}

function executiveShiftHours(value: string) {
  const shift = normalizeShift(value);
  if (shift.includes("manha")) return Array.from({ length: 8 }, (_, index) => index + 6);
  if (shift.includes("tarde")) return Array.from({ length: 8 }, (_, index) => index + 14);
  if (shift.includes("noite")) return [22, 23, 0, 1, 2, 3, 4, 5];
  return [];
}

function normalizeShift(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function utcDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function startOfUtcHour(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()));
}

function safeFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finite(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableFinite(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeResponseBody(value: string) {
  return value.replace(/[\r\n\t]+/g, " ").trim().slice(0, 300);
}
