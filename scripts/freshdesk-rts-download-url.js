#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const reportUrl = process.env.FRESHDESK_REPORT_URL || "https://freshdesk-us.freshreports.com/api/v1/reportgroups/1438838/download?pages=3";
const authTokenFile = process.env.FRESHDESK_AUTH_TOKEN_FILE || path.join(os.homedir(), ".freshdesk_auth_token");
const bodyFile = process.env.FRESHDESK_BODY_FILE || path.join(os.homedir(), ".freshdesk_report_body.json");
const logDir = process.env.FRESHDESK_RTS_LOG_DIR || path.join(os.homedir(), "Downloads", "CEC", "logs");
const timeoutSeconds = positiveInteger(process.env.FRESHDESK_RTS_TIMEOUT_SECONDS, 90);

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  if (typeof WebSocket !== "function") {
    throw new Error("Node.js WebSocket global não disponível. Use Node 22+ para escutar o RTS da Freshworks.");
  }

  const requestBody = readJson(bodyFile, "Freshdesk request body");
  const authToken = fs.readFileSync(authTokenFile, "utf8").trim();
  const rtsToken = String(requestBody.rts_token || "");
  const channelId = String(requestBody.channel_id || "");

  if (!rtsToken || !channelId) {
    throw new Error("Freshdesk request body precisa conter rts_token e channel_id.");
  }

  const rtsPayload = decodeJwtPayload(rtsToken);
  const rtsEndpoint = String(rtsPayload.rtsEndpoint || "");
  const accId = String(rtsPayload.accId || "");
  const userId = String(rtsPayload.userId || "");

  if (!rtsEndpoint || !accId || !userId) {
    throw new Error("rts_token não contém rtsEndpoint, accId ou userId.");
  }

  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `freshdesk_rts_${timestampForFile()}.jsonl`);
  const traceId = randomCompactId();

  let posted = false;
  let settled = false;
  let timeoutHandle;
  const ws = new WebSocket(buildWsUrl({ rtsEndpoint, accId, userId, rtsToken, traceId }));

  const finish = (code, result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutHandle);
    try {
      ws.close();
    } catch {}

    if (code === 0 && result) {
      process.stdout.write(result);
    }
    setTimeout(() => process.exit(code), 25);
  };

  timeoutHandle = setTimeout(() => {
    writeLog(logFile, { type: "timeout", timeoutSeconds, posted });
    console.error(`Freshdesk RTS listener timed out after ${timeoutSeconds}s.`);
    finish(2);
  }, timeoutSeconds * 1000);

  ws.addEventListener("open", () => {
    writeLog(logFile, { type: "open" });
    ws.send(JSON.stringify({
      event: "subscribe",
      channel: channelId,
      serviceId: "rts",
      ti: `${traceId}-2`,
      accId,
      userId,
      clientId: crypto.randomUUID(),
      opt: 0
    }));
  });

  ws.addEventListener("message", (event) => {
    const payload = parseJson(event.data);
    if (!payload) return;

    writeLog(logFile, { type: "message", data: payload });

    if (payload.event === "subscribe" && payload.statusCode === 200 && !posted) {
      posted = true;
      setTimeout(() => {
        postFreshdeskRequest(reportUrl, requestBody, authToken, logFile).catch((error) => {
          writeLog(logFile, { type: "post-error", error: error instanceof Error ? error.message : String(error) });
          console.error(error instanceof Error ? error.message : String(error));
          finish(1);
        });
      }, 500);
      return;
    }

    const downloadUrl = extractDownloadUrl(payload);
    if (downloadUrl) {
      writeLog(logFile, { type: "download-url-found" });
      finish(0, downloadUrl);
    }
  });

  ws.addEventListener("error", (event) => {
    writeLog(logFile, { type: "websocket-error", error: String(event?.message || event) });
  });

  ws.addEventListener("close", (event) => {
    writeLog(logFile, { type: "close", code: event.code, reason: event.reason });
    if (!settled && !posted) {
      console.error("Freshdesk RTS connection closed before report request was posted.");
      finish(2);
    }
  });
}

async function postFreshdeskRequest(url, requestBody, authToken, logFile) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Accept": "application/json, */*",
      "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
      "Content-Type": "application/json; charset=utf-8",
      "Origin": "https://freshdesk-us.freshreports.com",
      "Pragma": "no-cache",
      "Referer": "https://freshdesk-us.freshreports.com/",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15",
      "api-request-id": crypto.randomUUID(),
      "x-auth-token": authToken
    },
    body: JSON.stringify(requestBody)
  });
  const text = await response.text();
  writeLog(logFile, { type: "post-response", status: response.status, body: text.slice(0, 1000) });

  if (!response.ok) {
    throw new Error(`Freshdesk report request failed with HTTP ${response.status}.`);
  }
}

function buildWsUrl({ rtsEndpoint, accId, userId, rtsToken, traceId }) {
  const query = new URLSearchParams({
    rcid: "",
    accId,
    serviceId: "rts",
    userId,
    ti: `${traceId}-1`,
    token: rtsToken,
    cv: "2.0.16",
    pv: "0",
    nocookie: "true"
  });
  return `${rtsEndpoint.replace(/^http/, "ws")}/ws?${query.toString()}`;
}

function extractDownloadUrl(payload) {
  const message = typeof payload?.msg === "string" ? parseJson(payload.msg) : payload?.msg;
  const candidates = [];

  if (message?.s3Link) {
    const s3Links = Array.isArray(message.s3Link) ? message.s3Link : [message.s3Link];
    for (const item of s3Links) {
      if (typeof item === "string" && item.includes(".")) {
        const decoded = decodeJwtPayload(item);
        collectUrls(decoded, candidates);
      } else {
        collectUrls(item, candidates);
      }
    }
  }

  collectUrls(payload, candidates);
  return candidates.find((url) => /\.pdf(?:[?#]|$)/i.test(url)) || candidates[0] || "";
}

function collectUrls(value, urls) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectUrls(item, urls));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectUrls(item, urls));
    return;
  }
  if (typeof value === "string" && /^https?:\/\//i.test(value.trim())) {
    urls.push(value.trim());
  }
}

function decodeJwtPayload(token) {
  const segment = String(token).split(".")[1];
  if (!segment) return {};
  const padded = segment + "=".repeat((4 - segment.length % 4) % 4);
  return JSON.parse(Buffer.from(padded, "base64url").toString("utf8"));
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} inválido em ${filePath}: ${error instanceof Error ? error.message : error}`);
  }
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function writeLog(filePath, event) {
  fs.appendFileSync(filePath, `${JSON.stringify(sanitizeEvent({ ...event, at: new Date().toISOString() }))}\n`);
}

function sanitizeEvent(value) {
  if (Array.isArray(value)) return value.map(sanitizeEvent);
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && value.length > 180) return `${value.slice(0, 80)}...[truncated]`;
    return value;
  }

  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (/token|authorization|cookie|s3link/i.test(key)) return [key, "[redacted]"];
    return [key, sanitizeEvent(child)];
  }));
}

function randomCompactId(length = 16) {
  return crypto.randomBytes(length).toString("base64url").slice(0, length);
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
