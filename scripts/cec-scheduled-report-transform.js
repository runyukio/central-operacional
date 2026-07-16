#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const [, , inputPath, outputPath, cycleArgument] = process.argv;

if (!inputPath || !outputPath) {
  console.error("Uso: node cec-scheduled-report-transform.js <arquivo> <saida.json> [ciclo]");
  process.exit(1);
}

function normalizeHeader(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findValue(row, aliases) {
  const entries = Object.entries(row ?? {});
  for (const alias of aliases) {
    const match = entries.find(([key]) => normalizeHeader(key) === alias);
    if (match && String(match[1] ?? "").trim()) return match[1];
  }
  return "";
}

function findRowsInJson(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    if (value.some((item) => item && typeof item === "object" && !Array.isArray(item))) return value;
    for (const item of value) {
      const rows = findRowsInJson(item, depth + 1);
      if (rows.length) return rows;
    }
    return [];
  }
  if (typeof value !== "object") return [];
  for (const child of Object.values(value)) {
    const rows = findRowsInJson(child, depth + 1);
    if (rows.length) return rows;
  }
  return [];
}

function readRows(filePath) {
  const buffer = fs.readFileSync(filePath);
  const preview = buffer.toString("utf8", 0, Math.min(buffer.length, 512)).trimStart();

  if (preview.startsWith("{") || preview.startsWith("[")) {
    const parsed = JSON.parse(buffer.toString("utf8"));
    const rows = findRowsInJson(parsed);
    if (rows.length) return rows;
  }

  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: false });
}

function normalizeStatus(value) {
  const normalized = normalizeHeader(value);
  if (["on hold", "onhold", "pending", "pendente"].includes(normalized)) return "On Hold";
  if (["open", "aberto", "aberta"].includes(normalized)) return "Open";
  if (["new", "novo", "nova"].includes(normalized)) return "New";
  if (!normalized) return "Sem status";
  return String(value).trim();
}

function currentCycle() {
  if (cycleArgument && cycleArgument.trim()) return cycleArgument.trim();
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const minute = Number(parts.minute) >= 30 ? "30" : "00";
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${minute}`;
}

const sourceRows = readRows(inputPath);
const ticketAliases = ["ticket", "ticket id", "ticket number", "id"];
const agentAliases = ["agent name", "agent", "agente", "nome do agente"];
const statusAliases = ["status", "ticket status", "estado"];
const seen = new Set();
const tickets = [];

sourceRows.forEach((row, index) => {
  const ticket = String(findValue(row, ticketAliases) ?? "").trim();
  const agentName = String(findValue(row, agentAliases) ?? "").trim() || "Sem agente";
  const status = normalizeStatus(findValue(row, statusAliases));
  if (!ticket && agentName === "Sem agente" && status === "Sem status") return;
  const key = ticket ? `ticket:${ticket.toLowerCase()}` : `row:${index}:${agentName.toLowerCase()}:${status.toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  tickets.push({ ticket: ticket || `linha-${index + 2}`, agentName, status });
});

if (!tickets.length) {
  console.error("Nenhuma linha CEC reconhecida. Headers esperados: ticket, agent name e status.");
  process.exit(2);
}

const statusCounts = tickets.reduce((accumulator, ticket) => {
  accumulator[ticket.status] = (accumulator[ticket.status] || 0) + 1;
  return accumulator;
}, {});
const agentCounts = tickets.reduce((accumulator, ticket) => {
  accumulator[ticket.agentName] = (accumulator[ticket.agentName] || 0) + 1;
  return accumulator;
}, {});
const total = tickets.length;
const payload = {
  cycleDownload: currentCycle(),
  fileName: path.basename(inputPath),
  source: "freshdesk-scheduled-report",
  generatedDate: new Date().toISOString(),
  groups: [{
    key: "normal",
    label: "Backlog Normal",
    backlog: total,
    onHold: statusCounts["On Hold"] || 0,
    open: statusCounts.Open || 0,
    new: statusCounts.New || 0
  }],
  departments: Object.entries(agentCounts)
    .map(([name, backlog]) => ({ name, group: "normal", backlog, percent: total ? (backlog / total) * 100 : 0 }))
    .sort((left, right) => right.backlog - left.backlog || left.name.localeCompare(right.name)),
  tickets
};

fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
console.log(JSON.stringify({
  success: true,
  cycleDownload: payload.cycleDownload,
  tickets: total,
  agents: payload.departments.length,
  statuses: statusCounts
}, null, 2));
