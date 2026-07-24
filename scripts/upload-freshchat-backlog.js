#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const filePattern = /^total_chat_conversations_(\d+)\.csv$/i;

function findLatestFreshChatExport(directory) {
  if (!fs.existsSync(directory)) return null;

  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const match = entry.name.match(filePattern);
      return match ? { filePath: path.join(directory, entry.name), generatedAtMs: Number(match[1]) } : null;
    })
    .filter((entry) => entry && Number.isSafeInteger(entry.generatedAtMs))
    .sort((left, right) => right.generatedAtMs - left.generatedAtMs)[0] ?? null;
}

function currentCycleFromTimestamp(timestampMs) {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(timestampMs)).map((part) => [part.type, part.value]));
  const minute = Number(parts.minute) >= 30 ? "30" : "00";
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${minute}`;
}

function buildFreshChatPayload(filePath, generatedAtMs) {
  return {
    cycleDownload: currentCycleFromTimestamp(generatedAtMs),
    fileName: path.basename(filePath),
    source: "fresh-chat-csv-local",
    generatedDate: new Date(generatedAtMs).toISOString(),
    rawText: fs.readFileSync(filePath, "utf8")
  };
}

function readLastUploadedTimestamp(stateFile) {
  try {
    const value = Number(fs.readFileSync(stateFile, "utf8").trim());
    return Number.isSafeInteger(value) ? value : 0;
  } catch {
    return 0;
  }
}

async function uploadLatestFreshChatExport(options = {}) {
  const directory = options.directory || process.env.FRESHCHAT_EXPORT_DIR || path.join(process.env.HOME || "", "Downloads");
  const stateFile = options.stateFile || process.env.FRESHCHAT_UPLOAD_STATE_FILE || path.join(directory, ".freshchat-last-uploaded");
  const siteUrl = String(options.siteUrl || process.env.REALTIME_SITE_URL || "").replace(/\/+$/, "");
  const token = String(options.token || process.env.REALTIME_IMPORT_TOKEN || "").trim();
  const latest = findLatestFreshChatExport(directory);

  if (!latest) return { success: true, skipped: true, reason: "Nenhum export Freshchat encontrado." };
  if (latest.generatedAtMs <= readLastUploadedTimestamp(stateFile)) {
    return { success: true, skipped: true, reason: "O export Freshchat mais recente já foi enviado.", fileName: path.basename(latest.filePath) };
  }
  if (!siteUrl || !token) throw new Error("REALTIME_SITE_URL e REALTIME_IMPORT_TOKEN são obrigatórios para enviar Freshchat.");

  const payload = buildFreshChatPayload(latest.filePath, latest.generatedAtMs);
  const response = await fetch(`${siteUrl}/api/realtime/fresh-chat/import`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45_000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.success !== true) {
    throw new Error(result?.message || result?.error || `Upload Freshchat respondeu HTTP ${response.status}.`);
  }

  fs.writeFileSync(stateFile, String(latest.generatedAtMs), { encoding: "utf8", mode: 0o600 });
  return {
    success: true,
    skipped: false,
    fileName: payload.fileName,
    cycleDownload: result.cycleDownload,
    assignedCount: result.assignedCount,
    newCount: result.newCount,
    totalBacklog: result.totalBacklog
  };
}

if (require.main === module) {
  uploadLatestFreshChatExport()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  buildFreshChatPayload,
  currentCycleFromTimestamp,
  findLatestFreshChatExport,
  uploadLatestFreshChatExport
};
