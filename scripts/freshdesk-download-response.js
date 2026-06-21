#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const [responsePath, mode = "--summary"] = process.argv.slice(2);

if (!responsePath) {
  console.error("Usage: freshdesk-download-response.js <response-json> [--url|--filename|--summary]");
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(fs.readFileSync(responsePath, "utf8"));
} catch (error) {
  console.error(`Invalid JSON response: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const urls = [];
const fileNames = [];
walk(payload, []);

const pdfUrl = urls.find((item) => /\.pdf(?:[?#]|$)/i.test(item.value))
  ?? urls.find((item) => /download|export|report|freshreports|freshdesk|cloudfront|s3/i.test(item.value));
const fileName = fileNames[0]?.value || inferFileName(pdfUrl?.value) || "cec_freshdesk_report.pdf";

if (mode === "--url") {
  if (pdfUrl?.value) process.stdout.write(pdfUrl.value);
  process.exit(pdfUrl?.value ? 0 : 2);
}

if (mode === "--filename") {
  process.stdout.write(fileName);
  process.exit(0);
}

process.stdout.write(JSON.stringify({
  hasDownloadUrl: Boolean(pdfUrl?.value),
  downloadUrlPath: pdfUrl?.path ?? null,
  fileName,
  topLevelKeys: isPlainObject(payload) ? Object.keys(payload).sort() : []
}, null, 2));

function walk(value, trail) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, [...trail, String(index)]));
    return;
  }

  if (!isPlainObject(value)) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^https?:\/\//i.test(trimmed)) urls.push({ path: trail.join("."), value: trimmed });
      if (/\.(pdf|xlsx|csv)(?:[?#]|$)/i.test(trimmed) || /report|download|export/i.test(trail.at(-1) ?? "")) {
        fileNames.push({ path: trail.join("."), value: path.basename(trimmed.split("?")[0]) });
      }
    }
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    walk(child, [...trail, key]);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function inferFileName(url) {
  if (!url) return "";
  const withoutQuery = url.split("?")[0];
  const basename = path.basename(withoutQuery);
  return basename && basename !== "/" ? basename : "";
}
