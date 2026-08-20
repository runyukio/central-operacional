import assert from "node:assert/strict";
import test from "node:test";

import { buildPerformanceAgentsExportPayload } from "./performance-agents-export";

test("exporta os indicadores filtrados dos agentes", () => {
  const payload = buildPerformanceAgentsExportPayload({
    period: { startDate: "2026-07-01", endDate: "2026-07-31" },
    view: "daily",
    selectedLob: "CEC",
    generatedAt: new Date("2026-07-30T12:00:00.000Z"),
    agents: [{
      periodStart: "2026-07-15",
      periodEnd: "2026-07-15",
      employeeName: "Agente Teste",
      wbLogin: "wb_teste",
      lob: "CEC",
      supervisor: "Supervisor Teste",
      shift: "Manhã",
      submit: 120,
      outputAveragePerDay: 30,
      daysWithData: 4,
      moderationSeconds: 0,
      ahtSeconds: 0,
      cpdAverage: 30,
      cpdTickets: 120,
      cpdDays: 4,
      quality: 95,
      qualityCorrect: 19,
      qualityTotal: 20,
      qualityErrors: 1
    }]
  });

  assert.equal(payload.fileName, "performance_agentes_cec_2026-07-01_2026-07-31_2026-07-30.xlsx");
  assert.equal(payload.sheetName, "Agentes");
  assert.equal(payload.autoFilter, true);
  assert.equal(payload.rows.length, 1);
  assert.equal(payload.rows[0]?.[0], "2026-07-15");
  assert.equal(payload.rows[0]?.[2], "Diária");
  assert.equal(payload.rows[0]?.[4], "wb_teste");
  assert.equal(payload.rows[0]?.[13], 30);
  assert.equal(payload.rows[0]?.[18], 20);
});

test("mantém uma linha por agente e por período da visão selecionada", () => {
  const baseAgent = {
    employeeName: "Agente Diário",
    wbLogin: "wb_diario",
    lob: "ADS",
    supervisor: "Supervisão",
    shift: "Manhã",
    submit: 65,
    outputAveragePerDay: 65,
    daysWithData: 1,
    moderationSeconds: 3_900,
    ahtSeconds: 60,
    quality: 96,
    qualityCorrect: 24,
    qualityTotal: 25,
    qualityErrors: 1
  };
  const payload = buildPerformanceAgentsExportPayload({
    period: { startDate: "2026-08-01", endDate: "2026-08-31" },
    view: "daily",
    selectedLob: "ADS",
    generatedAt: new Date("2026-08-31T12:00:00.000Z"),
    agents: [
      { ...baseAgent, periodStart: "2026-08-01", periodEnd: "2026-08-01" },
      { ...baseAgent, periodStart: "2026-08-02", periodEnd: "2026-08-02", submit: 80, outputAveragePerDay: 80 }
    ]
  });

  assert.equal(payload.rows.length, 2);
  assert.deepEqual(payload.rows.map((row) => row.slice(0, 3)), [
    ["2026-08-01", "2026-08-01", "Diária"],
    ["2026-08-02", "2026-08-02", "Diária"]
  ]);
});
