import assert from "node:assert/strict";
import test from "node:test";

import { buildAdsExecutiveReportSnapshot } from "./ads-executive-report-core";

test("gera deltas horários do ADS a partir dos acumulados do Real Time", () => {
  const report = buildAdsExecutiveReportSnapshot({
    selectedCycle: "2026-07-21 10:30",
    queueRows: [
      {
        lob: "ADS",
        history: [
          metric("2026-07-21 09:30", 100, 80, 20),
          metric("2026-07-21 10:30", 165, 130, 12)
        ]
      },
      {
        lob: "VIDEO",
        history: [metric("2026-07-21 10:30", 9_999, 9_999, 9_999)]
      }
    ],
    agentRows: [
      {
        displayName: "Agente ADS",
        wbLogin: "wb_ads",
        rawWbLogin: "wb_ads",
        lob: "ADS",
        crossingStatus: "Encontrado",
        personType: "Agente",
        employeeStatus: "Ativo",
        presenceStatus: "Online",
        history: [
          { cycleDownload: "2026-07-21 09:30", submit: 80, ahtMs: 30_000, moderationMs: 2_400_000 },
          { cycleDownload: "2026-07-21 10:30", submit: 130, ahtMs: 28_000, moderationMs: 3_800_000 }
        ]
      }
    ],
    forecast: [{ dateKey: "2026-07-21", hour: 10, input: 60 }],
    requirements: [{ hour: 10, required: 4 }]
  });

  assert.equal(report.buckets.length, 24);
  assert.equal(report.buckets[10].input, 65);
  assert.equal(report.buckets[10].output, 50);
  assert.equal(report.buckets[10].backlog, 12);
  assert.equal(report.buckets[10].forecast, 60);
  assert.equal(report.buckets[10].required, 4);
  assert.equal(report.buckets[10].online, 1);
  assert.equal(report.cards[0].value, 50);
  assert.equal(report.topAgents[0].submit, 50);
});

test("ignora filas e agentes fora de ADS", () => {
  const report = buildAdsExecutiveReportSnapshot({
    selectedCycle: "2026-07-21 08:30",
    queueRows: [{ lob: "COMMENTS", history: [metric("2026-07-21 08:30", 100, 100, 100)] }],
    agentRows: [{
      displayName: "Agente Comments",
      wbLogin: "wb_comments",
      rawWbLogin: "wb_comments",
      lob: "COMMENTS",
      crossingStatus: "Encontrado",
      personType: "Agente",
      employeeStatus: "Ativo",
      presenceStatus: "Online",
      history: [{ cycleDownload: "2026-07-21 08:30", submit: 100, ahtMs: 10_000, moderationMs: 1_000_000 }]
    }]
  });

  assert.equal(report.buckets[8].input, null);
  assert.equal(report.cards[0].value, null);
  assert.deepEqual(report.topAgents, []);
});

test("no Executive conta quem esteve presente ou online na hora", () => {
  const report = buildAdsExecutiveReportSnapshot({
    selectedCycle: "2026-07-21 10:30",
    queueRows: [{ lob: "ADS", history: [metric("2026-07-21 10:30", 10, 10, 0)] }],
    agentRows: [
      agent("online", "Online", false, 0),
      agent("presente", "Offline", true, 0),
      agent("atividade", "Tela bloqueada", false, 10),
      agent("bloqueado", "Tela bloqueada", false, 0),
      agent("ocioso", "Ocioso", false, 0)
    ]
  });

  assert.equal(report.buckets[10].online, 3);
});

function metric(cycleDownload: string, input: number, output: number, backlog: number) {
  return {
    cycleDownload,
    input,
    output,
    ahtMs: 30_000,
    latencyMs: 60_000,
    maxLatencyMs: 120_000,
    backlog
  };
}

function agent(wbLogin: string, presenceStatus: string, isSchedulePresent: boolean, submit: number) {
  return {
    displayName: wbLogin,
    wbLogin,
    rawWbLogin: wbLogin,
    lob: "ADS",
    crossingStatus: "Encontrado",
    personType: "Agente",
    employeeStatus: "Ativo",
    presenceStatus,
    isSchedulePresent,
    history: [{ cycleDownload: "2026-07-21 10:30", submit, ahtMs: null, moderationMs: 0 }]
  };
}
