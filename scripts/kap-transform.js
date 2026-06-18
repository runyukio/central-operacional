#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
let XLSX;

try {
  XLSX = require("xlsx");
} catch {
  XLSX = require("/Users/lucaskawakami/Documents/New project/node_modules/xlsx");
}

const [label, xlsxPath, runStartedAt] = process.argv.slice(2);

if (!label || !xlsxPath || !runStartedAt) {
  console.error("Usage: kap-transform.js <queue|auditor> <xlsx-path> <run-started-at>");
  process.exit(1);
}

const outputDir = process.env.KAP_OUTPUT_DIR || path.join(process.env.HOME || "", "Downloads", "KAP");
const historyDir = path.join(outputDir, "history");
const sourceFile = path.basename(xlsxPath);

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatLocalDateTime(date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + " " + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join(":");
}

function floorToHalfHour(date) {
  const cycle = new Date(date);
  cycle.setMinutes(cycle.getMinutes() < 30 ? 0 : 30, 0, 0);
  return cycle;
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsvLine(row, headers) {
  return headers.map((header) => csvEscape(row[header])).join(",");
}

const runDate = new Date(runStartedAt.replace(
  /^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})$/,
  "$1T$2:$3:$4",
));
if (Number.isNaN(runDate.getTime())) {
  console.error(`Invalid run timestamp: ${runStartedAt}`);
  process.exit(1);
}

fs.mkdirSync(historyDir, { recursive: true });

const workbook = XLSX.readFile(xlsxPath, { cellDates: true });
const firstSheetName = workbook.SheetNames[0];
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
  defval: "",
  raw: true,
});

const cycleDownload = formatLocalDateTime(floorToHalfHour(runDate)).slice(0, 16);
const dataExecucao = formatLocalDateTime(runDate);
const metaHeaders = ["ciclo_download", "data_execucao", "tipo_base", "arquivo_origem"];
const sourceHeaders = rows.length > 0 ? Object.keys(rows[0]) : [];
const headers = [...metaHeaders, ...sourceHeaders];
const normalizedRows = rows.map((row) => ({
  ciclo_download: cycleDownload,
  data_execucao: dataExecucao,
  tipo_base: label,
  arquivo_origem: sourceFile,
  ...row,
}));

const latestPath = path.join(historyDir, `${label}_latest_layout.csv`);
const historyPath = path.join(historyDir, `${label}_history.csv`);
const latestCsv = [headers.join(","), ...normalizedRows.map((row) => toCsvLine(row, headers))].join("\n") + "\n";

fs.writeFileSync(latestPath, latestCsv);

if (!fs.existsSync(historyPath)) {
  fs.writeFileSync(historyPath, latestCsv);
} else if (normalizedRows.length > 0) {
  fs.appendFileSync(historyPath, normalizedRows.map((row) => toCsvLine(row, headers)).join("\n") + "\n");
}

console.log(`${label} layout rows: ${normalizedRows.length}`);
console.log(`Latest layout: ${latestPath}`);
console.log(`History: ${historyPath}`);
