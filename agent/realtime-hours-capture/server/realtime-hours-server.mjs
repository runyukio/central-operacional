#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const defaultRoot = process.env.ProgramData
  ? path.join(process.env.ProgramData, "CentralOperacional", "RealtimeHoursServer")
  : path.join(process.cwd(), ".runtime", "RealtimeHoursServer");

const cli = parseArgs(process.argv.slice(2));
const configPath = cli.config || process.env.REALTIME_HOURS_SERVER_CONFIG || path.join(defaultRoot, "config.json");
const rootDir = cli.root || process.env.REALTIME_HOURS_SERVER_ROOT || path.dirname(configPath);
const queueDir = path.join(rootDir, "queue");
const sentDir = path.join(rootDir, "sent");
const failedDir = path.join(rootDir, "failed");
const logDir = path.join(rootDir, "logs");
const logPath = path.join(logDir, "server.log");

let config = await loadConfig(configPath);
let uploadInProgress = false;

await ensureFolders();

if (cli.mode === "upload-once") {
  await uploadPendingSnapshots();
  process.exit(0);
}

if (cli.mode === "health") {
  const stats = await getQueueStats();
  console.log(JSON.stringify(stats, null, 2));
  process.exit(0);
}

const server = http.createServer(async (request, response) => {
  try {
    await routeRequest(request, response);
  } catch (error) {
    if (error.status) {
      sendJson(response, error.status, { success: false, error: error.message });
      return;
    }
    await writeLog(`Unhandled request error: ${error.stack || error.message}`, "ERROR");
    sendJson(response, 500, { success: false, error: "Erro interno no servidor local." });
  }
});

server.listen(Number(config.port), config.bindHost, async () => {
  await writeLog(`Realtime hours local server listening on ${config.bindHost}:${config.port}`);
  if (config.uploadEnabled) {
    const firstDelayMs = Math.min(30_000, Math.max(5_000, Number(config.uploadIntervalMinutes) * 60_000));
    setTimeout(() => uploadPendingSnapshots().catch((error) => writeLog(`Upload inicial falhou: ${error.message}`, "WARN")), firstDelayMs);
  }
});

setInterval(async () => {
  config = await loadConfig(configPath);
  await pruneOldSentFiles();
  if (config.uploadEnabled) {
    await uploadPendingSnapshots();
  }
}, Math.max(60_000, Number(config.uploadIntervalMinutes) * 60_000));

process.on("SIGINT", async () => {
  await writeLog("Servidor encerrado por SIGINT.");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await writeLog("Servidor encerrado por SIGTERM.");
  process.exit(0);
});

async function routeRequest(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (request.method === "GET" && url.pathname === "/health") {
    const stats = await getQueueStats();
    sendJson(response, 200, { success: true, ...stats });
    return;
  }

  if (request.method === "POST" && url.pathname === "/snapshot") {
    const auth = validateLocalToken(request.headers.authorization);
    if (!auth.ok) {
      sendJson(response, auth.status, { success: false, error: auth.error });
      return;
    }

    const body = await readJsonBody(request);
    const accepted = await acceptSnapshot(body);
    sendJson(response, 202, accepted);
    return;
  }

  if (request.method === "POST" && url.pathname === "/upload-now") {
    const auth = validateLocalToken(request.headers.authorization);
    if (!auth.ok) {
      sendJson(response, auth.status, { success: false, error: auth.error });
      return;
    }
    const result = await uploadPendingSnapshots();
    sendJson(response, result.success ? 200 : 502, result);
    return;
  }

  sendJson(response, 404, { success: false, error: "Endpoint nao encontrado." });
}

async function acceptSnapshot(body) {
  const capturedAt = parseDate(body?.capturedAt) || new Date();
  const records = Array.isArray(body?.records)
    ? body.records
    : body?.record
      ? [body.record]
      : [body].filter(Boolean);

  const normalized = [];
  const errors = [];
  for (let index = 0; index < records.length; index += 1) {
    const result = normalizeRecord(records[index], capturedAt);
    if (result.error) {
      errors.push({ rowNumber: index + 1, error: result.error });
    } else {
      normalized.push(result.record);
    }
  }

  if (!normalized.length) {
    throw httpError(400, "Nenhum registro valido recebido.");
  }

  const envelope = {
    source: body?.source || "windows-workstation-agent",
    capturedAt: capturedAt.toISOString(),
    receivedAt: new Date().toISOString(),
    records: normalized,
    errors
  };
  const fileName = `${formatCompactDate(new Date())}_${crypto.randomUUID()}.json`;
  await fs.writeFile(path.join(queueDir, fileName), JSON.stringify(envelope), "utf8");
  await writeLog(`Snapshot recebido: ${normalized.length} registro(s), ${errors.length} erro(s).`);

  return {
    success: true,
    acceptedRecords: normalized.length,
    rejectedRecords: errors.length,
    queuedFile: fileName,
    errors
  };
}

async function uploadPendingSnapshots() {
  if (uploadInProgress) {
    return { success: true, skipped: true, reason: "Upload ja em andamento." };
  }
  uploadInProgress = true;
  try {
    config = await loadConfig(configPath);
    const siteUrl = String(config.siteUrl || "").trim().replace(/\/+$/, "");
    const importToken = String(config.importToken || "").trim();
    if (!siteUrl || !importToken) {
      await writeLog("Upload ignorado: siteUrl/importToken nao configurados.", "WARN");
      return { success: false, error: "siteUrl/importToken nao configurados." };
    }

    const files = (await fs.readdir(queueDir))
      .filter((fileName) => fileName.endsWith(".json"))
      .sort()
      .slice(0, Number(config.maxFilesPerUpload));
    if (!files.length) {
      return { success: true, uploaded: false, rowsProcessed: 0 };
    }

    const records = [];
    const sourceNames = new Set();
    for (const fileName of files) {
      const fullPath = path.join(queueDir, fileName);
      try {
        const envelope = JSON.parse(await fs.readFile(fullPath, "utf8"));
        sourceNames.add(envelope.source || "windows-workstation-agent");
        for (const record of envelope.records || []) {
          records.push(record);
          if (records.length >= Number(config.maxRecordsPerUpload)) break;
        }
      } catch (error) {
        await moveFile(fullPath, path.join(failedDir, fileName));
        await writeLog(`Arquivo invalido movido para failed: ${fileName}. ${error.message}`, "WARN");
      }
      if (records.length >= Number(config.maxRecordsPerUpload)) break;
    }

    if (!records.length) {
      return { success: true, uploaded: false, rowsProcessed: 0 };
    }

    const payload = {
      source: config.uploadSource || `${defaultSourceName()}:${Array.from(sourceNames).join(",")}`,
      capturedAt: new Date().toISOString(),
      records
    };

    const response = await fetch(`${siteUrl}/api/realtime-hours/import`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${importToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const responseText = await response.text();
    let responseBody;
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = { body: responseText };
    }

    if (!response.ok || responseBody?.success === false) {
      await writeLog(`Upload recusado pelo site: HTTP ${response.status} ${JSON.stringify(responseBody)}`, "WARN");
      return { success: false, error: "Upload recusado pelo site.", status: response.status, details: responseBody };
    }

    for (const fileName of files) {
      const fullPath = path.join(queueDir, fileName);
      try {
        await moveFile(fullPath, path.join(sentDir, fileName));
      } catch {
        // If the file was already moved as invalid, ignore it.
      }
    }

    await writeLog(`Upload concluido: batch ${responseBody.batchId}, ${responseBody.rowsValid} registro(s) validos.`);
    return {
      success: true,
      uploaded: true,
      batchId: responseBody.batchId,
      rowsProcessed: responseBody.rowsProcessed,
      rowsValid: responseBody.rowsValid,
      rowsError: responseBody.rowsError
    };
  } catch (error) {
    await writeLog(`Upload falhou: ${error.stack || error.message}`, "ERROR");
    return { success: false, error: error.message };
  } finally {
    uploadInProgress = false;
  }
}

function normalizeRecord(record, capturedAt) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { error: "Registro precisa ser um objeto JSON." };
  }
  const hostname = stringOrEmpty(record.hostname || record.computerName).slice(0, 120);
  if (!hostname) return { error: "hostname obrigatorio." };

  return {
    record: {
      hostname,
      windowsUser: stringOrNull(record.windowsUser, 120),
      wbLogin: normalizeLogin(record.wbLogin),
      employeeId: stringOrNull(record.employeeId, 120),
      ipAddress: stringOrNull(record.ipAddress, 64),
      isSessionActive: Boolean(record.isSessionActive),
      idleSeconds: nonNegativeIntegerOrNull(record.idleSeconds, 86_400),
      activeWindowTitle: stringOrNull(record.activeWindowTitle, 300),
      activeProcessName: stringOrNull(record.activeProcessName, 120),
      lastActivityAt: parseDate(record.lastActivityAt)?.toISOString() || capturedAt.toISOString(),
      identitySource: stringOrNull(record.identitySource, 80),
      identityConfidence: normalizeIdentityConfidence(record.identityConfidence),
      machineCapturedAt: capturedAt.toISOString(),
      serverReceivedAt: new Date().toISOString()
    }
  };
}

function validateLocalToken(header) {
  const localToken = String(config.localToken || "").trim();
  if (!localToken) {
    return { ok: false, status: 503, error: "REALTIME_HOURS_LOCAL_TOKEN nao configurado no servidor local." };
  }
  const match = String(header || "").match(/^Bearer\s+(.+)$/i);
  const provided = match?.[1]?.trim() || "";
  if (!provided || !safeEqualString(provided, localToken)) {
    return { ok: false, status: 401, error: "Token local invalido." };
  }
  return { ok: true };
}

async function loadConfig(filePath) {
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    fileConfig = {};
  }
  return {
    bindHost: process.env.REALTIME_HOURS_BIND_HOST || fileConfig.bindHost || "0.0.0.0",
    port: Number(process.env.REALTIME_HOURS_LOCAL_PORT || fileConfig.port || 8787),
    siteUrl: process.env.REALTIME_HOURS_SITE_URL || fileConfig.siteUrl || "",
    importToken: process.env.REALTIME_HOURS_IMPORT_TOKEN || fileConfig.importToken || "",
    localToken: process.env.REALTIME_HOURS_LOCAL_TOKEN || fileConfig.localToken || "",
    uploadEnabled: boolValue(process.env.REALTIME_HOURS_UPLOAD_ENABLED ?? fileConfig.uploadEnabled ?? true),
    uploadIntervalMinutes: Number(process.env.REALTIME_HOURS_INTERVAL_MINUTES || fileConfig.uploadIntervalMinutes || 5),
    uploadSource: process.env.REALTIME_HOURS_UPLOAD_SOURCE || fileConfig.uploadSource || "local-windows-server",
    maxFilesPerUpload: Number(process.env.REALTIME_HOURS_MAX_FILES_PER_UPLOAD || fileConfig.maxFilesPerUpload || 500),
    maxRecordsPerUpload: Number(process.env.REALTIME_HOURS_MAX_RECORDS_PER_UPLOAD || fileConfig.maxRecordsPerUpload || 1000),
    sentRetentionDays: Number(process.env.REALTIME_HOURS_SENT_RETENTION_DAYS || fileConfig.sentRetentionDays || 7)
  };
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw httpError(413, "Payload grande demais.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw httpError(400, "JSON invalido.");
  }
}

async function ensureFolders() {
  await Promise.all([queueDir, sentDir, failedDir, logDir].map((dir) => fs.mkdir(dir, { recursive: true })));
}

async function getQueueStats() {
  const [queued, sent, failed] = await Promise.all([
    countJsonFiles(queueDir),
    countJsonFiles(sentDir),
    countJsonFiles(failedDir)
  ]);
  return {
    rootDir,
    queueDir,
    queuedFiles: queued,
    sentFiles: sent,
    failedFiles: failed,
    uploadEnabled: config.uploadEnabled,
    uploadIntervalMinutes: config.uploadIntervalMinutes,
    siteUrlConfigured: Boolean(config.siteUrl),
    importTokenConfigured: Boolean(config.importToken),
    localTokenConfigured: Boolean(config.localToken)
  };
}

async function countJsonFiles(dir) {
  try {
    return (await fs.readdir(dir)).filter((fileName) => fileName.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

async function pruneOldSentFiles() {
  const cutoff = Date.now() - Number(config.sentRetentionDays) * 24 * 60 * 60 * 1000;
  for (const dir of [sentDir, failedDir]) {
    const files = await fs.readdir(dir).catch(() => []);
    for (const fileName of files) {
      if (!fileName.endsWith(".json")) continue;
      const fullPath = path.join(dir, fileName);
      const stat = await fs.stat(fullPath).catch(() => null);
      if (stat && stat.mtimeMs < cutoff) {
        await fs.unlink(fullPath).catch(() => undefined);
      }
    }
  }
}

async function moveFile(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
  } catch {
    const parsed = path.parse(to);
    await fs.rename(from, path.join(parsed.dir, `${parsed.name}_${crypto.randomUUID()}${parsed.ext}`));
  }
}

async function writeLog(message, level = "INFO") {
  await fs.mkdir(logDir, { recursive: true });
  const line = `${new Date().toISOString()} [${level}] ${message}\n`;
  await fs.appendFile(logPath, line, "utf8").catch(() => undefined);
  if (level !== "INFO") console.error(line.trim());
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseArgs(args) {
  const parsed = { mode: "server" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--config") parsed.config = args[index + 1];
    if (arg === "--root") parsed.root = args[index + 1];
    if (arg === "--upload-once") parsed.mode = "upload-once";
    if (arg === "--health") parsed.mode = "health";
  }
  return parsed;
}

function stringOrEmpty(value) {
  return String(value ?? "").trim();
}

function stringOrNull(value, maxLength) {
  const normalized = stringOrEmpty(value);
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeLogin(value) {
  const normalized = stringOrEmpty(value).toLowerCase();
  return normalized ? normalized.slice(0, 120) : null;
}

function nonNegativeIntegerOrNull(value, maxValue) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.min(maxValue, Math.floor(number));
}

function normalizeIdentityConfidence(value) {
  const normalized = stringOrEmpty(value).toUpperCase();
  if (["HIGH", "MEDIUM", "LOW", "UNKNOWN"].includes(normalized)) return normalized;
  return "UNKNOWN";
}

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatCompactDate(date) {
  return date.toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
}

function safeEqualString(actual, expected) {
  const actualHash = crypto.createHash("sha256").update(actual).digest("hex");
  const expectedHash = crypto.createHash("sha256").update(expected).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(actualHash, "hex"), Buffer.from(expectedHash, "hex"));
}

function boolValue(value) {
  if (typeof value === "boolean") return value;
  return !["false", "0", "no", "nao", "nao"].includes(String(value).trim().toLowerCase());
}

function defaultSourceName() {
  return `local-windows-server-${os.hostname()}`;
}
