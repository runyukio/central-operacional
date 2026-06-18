#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
let XLSX;

try {
  XLSX = require("xlsx");
} catch {
  XLSX = require("/Users/lucaskawakami/Documents/New project/node_modules/xlsx");
}

const [queuePath, auditorPath, runStartedAt, outputPath] = process.argv.slice(2);

if (!queuePath || !auditorPath || !runStartedAt || !outputPath) {
  console.error("Usage: kap-realtime-bundle.js <queue-xlsx> <auditor-xlsx> <run-started-at> <output-xlsx>");
  process.exit(1);
}

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

function parseRunDate(value) {
  const date = new Date(value.replace(
    /^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})$/,
    "$1T$2:$3:$4",
  ));
  if (Number.isNaN(date.getTime())) {
    console.error(`Invalid run timestamp: ${value}`);
    process.exit(1);
  }
  return date;
}

function readRows(xlsxPath, label, runDate) {
  const workbook = XLSX.readFile(xlsxPath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = sheet ? XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true }) : [];
  return rows.map((row) => ({
    ciclo_download: formatLocalDateTime(floorToHalfHour(runDate)).slice(0, 16),
    data_execucao: formatLocalDateTime(runDate),
    tipo_base: label,
    arquivo_origem: path.basename(xlsxPath),
    ...row,
  }));
}

const runDate = parseRunDate(runStartedAt);
const queueRows = readRows(queuePath, "queue", runDate);
const auditorRows = readRows(auditorPath, "auditor", runDate);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(queueRows), "Filas");
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(auditorRows), "Agentes");
XLSX.writeFile(workbook, outputPath);

console.log(`Real Time workbook: ${outputPath}`);
console.log(`Filas: ${queueRows.length}`);
console.log(`Agentes: ${auditorRows.length}`);
