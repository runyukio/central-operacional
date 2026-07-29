import assert from "node:assert/strict";
import test from "node:test";

import { buildCecHourlyCpd } from "@/lib/realtime-cec-cpd";
import {
  getCecCycleForDate,
  getCecScheduledReportGeneratedAt,
  parseCecScheduledReport
} from "@/lib/realtime-cec-freshdesk";

test("conta Ticket ID distinto dentro de cada agente", () => {
  const result = buildCecHourlyCpd([
    { ticket: "101", agentName: "Ana" },
    { ticket: "101", agentName: " Ana " },
    { ticket: "102", agentName: "ANA" },
    { ticket: "201", agentName: "Bruno" }
  ]);

  assert.equal(result.totalCpd, 3);
  assert.equal(result.activeAgents, 2);
  assert.equal(result.averageCpd, 1.5);
  assert.deepEqual(
    result.agents.map(({ agentName, cpd }) => ({ agentName, cpd })),
    [
      { agentName: "Ana", cpd: 2 },
      { agentName: "Bruno", cpd: 1 }
    ]
  );
});

test("o mesmo Ticket ID em agentes diferentes conta uma vez para cada agente", () => {
  const result = buildCecHourlyCpd([
    { ticket: "301", agentName: "Ana" },
    { ticket: "301", agentName: "Bruno" }
  ]);

  assert.equal(result.totalCpd, 2);
  assert.deepEqual(result.agents.map((agent) => agent.cpd), [1, 1]);
});

test("ignora linhas sem Ticket ID e mantém tickets sem agente em grupo próprio", () => {
  const result = buildCecHourlyCpd([
    { ticket: "", agentName: "Ana" },
    { ticket: "401", agentName: "" }
  ]);

  assert.equal(result.totalCpd, 1);
  assert.equal(result.agents[0]?.agentName, "Sem agente");
});

test("lê as colunas reais do Data Export Freshdesk", () => {
  const tickets = parseCecScheduledReport(Buffer.from([
    '"Ticket ID","Agent name","Status"',
    '"501","Ana","Open"',
    '"502","Bruno","Closed"'
  ].join("\n")));

  assert.deepEqual(tickets, [
    { ticket: "501", agentName: "Ana", status: "Open" },
    { ticket: "502", agentName: "Bruno", status: "Closed" }
  ]);
});

test("usa a hora em que o arquivo do Freshdesk foi gerado como ciclo do CPD", () => {
  const generatedAt = getCecScheduledReportGeneratedAt("tickets_1785298442316.csv");

  assert.equal(generatedAt?.toISOString(), "2026-07-29T04:14:02.316Z");
  assert.equal(getCecCycleForDate(generatedAt as Date), "2026-07-29 01:00");
});

test("mantém o fallback seguro quando o nome não contém timestamp", () => {
  assert.equal(getCecScheduledReportGeneratedAt("cec_export.csv"), null);
});
