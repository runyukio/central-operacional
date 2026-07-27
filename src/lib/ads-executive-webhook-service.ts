import { Prisma } from "@prisma/client";

import {
  buildAdsExecutiveReportSnapshot,
  parseAdsExecutiveCycle,
  type AdsExecutiveAgentRow,
  type AdsExecutiveForecastPoint,
  type AdsExecutiveQueueRow
} from "@/lib/ads-executive-report-core";
import { renderAdsExecutiveReportPng } from "@/lib/ads-executive-report-image";
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
  if (!isWebhookEnabled()) {
    return {
      sent: false,
      skipped: true,
      selectedCycle: null,
      fileName: null,
      bytes: 0,
      status: null,
      message: "Envio do report Executivo ADS desabilitado."
    };
  }

  const webhookUrl = resolveWebhookUrl();
  if (!webhookUrl) {
    throw new Error("ADS_EXECUTIVE_WEBHOOK_URL não configurada.");
  }

  const realtime = await getRealtimeSnapshot(automationActor, { view: "both" });
  if ("error" in realtime && realtime.error) throw new Error(realtime.error);
  const data = "data" in realtime ? realtime.data : null;
  const selectedCycle = data?.queueView.selectedCycle || data?.agents.selectedCycle;
  if (!data?.summary.hasData || !selectedCycle) {
    throw new Error("Não há snapshot válido do Real Time para gerar o report Executivo ADS.");
  }

  const parsedCycle = parseAdsExecutiveCycle(selectedCycle);
  const [forecast, requirements] = await Promise.all([
    loadAdsForecast(parsedCycle.dateKey),
    loadAdsRequirements(parsedCycle.dateKey)
  ]);
  const report = buildAdsExecutiveReportSnapshot({
    selectedCycle,
    queueRows: mapQueueRows(data.queueView.rows),
    agentRows: mapAgentRows(data.agents.rows),
    forecast,
    requirements
  });
  const image = await renderAdsExecutiveReportPng(report);
  const fileName = `ads_executive_${safeFilePart(selectedCycle)}.png`;
  const idempotencyKey = `ads-executive:${selectedCycle}`;
  const mode = resolvePayloadMode();
  const imageUrl = mode === "kwaitalk"
    ? await publishKwaiTalkImage(image, fileName, selectedCycle)
    : null;
  const response = await postWebhook({
    url: webhookUrl,
    image,
    fileName,
    idempotencyKey,
    mode,
    token: resolveWebhookToken(),
    imageUrl,
    metadata: {
      reportType: "ADS_EXECUTIVE",
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
    message: "Report Executivo ADS enviado ao webhook."
  };
}

function mapQueueRows(rows: Array<Record<string, unknown>>): AdsExecutiveQueueRow[] {
  return rows.map((row) => ({
    lob: String(row.lob ?? ""),
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

async function loadAdsForecast(dateKey: string): Promise<AdsExecutiveForecastPoint[]> {
  const queueIds = adsQueueIds();
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
  const rows = await prisma.adsHourlyRequirement.findMany({
    where: { date },
    orderBy: { hour: "asc" },
    select: { hour: true, requiredStaff: true }
  });
  return rows.map((row) => ({ hour: row.hour, required: row.requiredStaff }));
}

async function postWebhook(input: {
  url: string;
  image: Buffer;
  fileName: string;
  idempotencyKey: string;
  mode: WebhookPayloadMode;
  token: string | null;
  imageUrl: string | null;
  metadata: Record<string, string>;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resolveTimeoutMs());
  const headers = new Headers({
    Accept: "application/json, text/plain, */*",
    "Idempotency-Key": input.idempotencyKey,
    "X-Report-Type": "ADS_EXECUTIVE"
  });
  if (input.token) headers.set("Authorization", `Bearer ${input.token}`);

  let body: BodyInit;
  if (input.mode === "kwaitalk") {
    if (!input.imageUrl) throw new Error("A imagem publica do report nao foi gerada para o KwaiTalk.");
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(buildKwaiTalkMarkdownPayload({
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
    form.set("reportType", "ADS_EXECUTIVE");
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
      throw new Error(`Webhook excedeu o limite de ${resolveTimeoutMs()} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function adsQueueIds() {
  return Array.from(new Set([
    ...Object.entries(QUEUE_METADATA).filter(([, metadata]) => metadata.lob === "ADS").map(([queueId]) => queueId),
    ...Object.entries(QUEUE_REPORT_METADATA).filter(([, metadata]) => metadata.lob === "ADS").map(([queueId]) => queueId)
  ]));
}

function isWebhookEnabled() {
  return ["1", "true", "yes", "on"].includes(String(process.env.ADS_EXECUTIVE_WEBHOOK_ENABLED ?? "").trim().toLowerCase());
}

function resolveWebhookUrl() {
  return String(process.env.ADS_EXECUTIVE_WEBHOOK_URL ?? process.env.PROJECT_WEBHOOK_URL ?? "").trim();
}

function resolveWebhookToken() {
  const token = String(process.env.ADS_EXECUTIVE_WEBHOOK_TOKEN ?? process.env.PROJECT_WEBHOOK_TOKEN ?? "").trim();
  return token || null;
}

function resolvePayloadMode(): WebhookPayloadMode {
  const mode = String(process.env.ADS_EXECUTIVE_WEBHOOK_PAYLOAD_MODE ?? "multipart").trim().toLowerCase();
  if (mode === "json" || mode === "kwaitalk") return mode;
  return "multipart";
}

async function publishKwaiTalkImage(image: Buffer, fileName: string, selectedCycle: string) {
  const uploaded = await uploadPublicObject(
    "mural-media",
    "automation/ads-executive/latest.png",
    new File([new Uint8Array(image)], fileName, { type: "image/png" }),
    { upsert: true }
  );
  const version = encodeURIComponent(selectedCycle);
  return `${uploaded.publicUrl}${uploaded.publicUrl.includes("?") ? "&" : "?"}v=${version}`;
}

export function buildKwaiTalkMarkdownPayload(input: { imageUrl: string; selectedCycle: string; generatedAt: string }) {
  const generatedAt = formatKwaiTalkGeneratedAt(input.generatedAt);
  return {
    msgtype: "markdown",
    markdown: {
      content: [
        "### ADS Executive Report",
        `**Cycle:** ${input.selectedCycle}`,
        `**Generated:** ${generatedAt}`,
        `![ADS Executive Report](${input.imageUrl})`
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

function resolveTimeoutMs() {
  const parsed = Number(process.env.ADS_EXECUTIVE_WEBHOOK_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed >= 1_000 && parsed <= 120_000 ? Math.round(parsed) : DEFAULT_TIMEOUT_MS;
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
