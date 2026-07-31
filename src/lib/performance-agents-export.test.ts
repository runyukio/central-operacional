import assert from "node:assert/strict";
import test from "node:test";

import { buildPerformanceAgentsExportPayload } from "./performance-agents-export";

test("exporta os indicadores filtrados dos agentes", () => {
  const payload = buildPerformanceAgentsExportPayload({
    period: { startDate: "2026-07-01", endDate: "2026-07-31" },
    selectedLob: "CEC",
    generatedAt: new Date("2026-07-30T12:00:00.000Z"),
    agents: [{
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
  assert.equal(payload.rows[0]?.[3], "wb_teste");
  assert.equal(payload.rows[0]?.[12], 30);
  assert.equal(payload.rows[0]?.[17], 20);
});
