import assert from "node:assert/strict";
import test from "node:test";

import type { AdsExecutiveAgentRow } from "./ads-executive-report-core";
import { buildAdsOnlineProductivityReportSnapshot } from "./ads-online-productivity-report-core";

test("builds the ADS online productivity ranking with hourly and shift metrics", () => {
  const report = buildAdsOnlineProductivityReportSnapshot({
    selectedCycle: "2026-07-29 14:58",
    agentRows: [
      agent({
        name: "Amanda Ribeiro",
        wbLogin: "wb_amandar",
        presenceStatus: "Online",
        history: [
          history("2026-07-29 12:58", 80, 84_000),
          history("2026-07-29 13:58", 100, 84_000),
          history("2026-07-29 14:58", 126, 84_000)
        ]
      }),
      agent({
        name: "Rafael Oliveira",
        wbLogin: "wb_rafaelo",
        isSchedulePresent: true,
        history: [
          history("2026-07-29 12:58", 60, 90_000),
          history("2026-07-29 13:58", 80, 90_000),
          history("2026-07-29 14:58", 104, 90_000)
        ]
      }),
      agent({
        name: "Camila Santos",
        wbLogin: "wb_camilas",
        history: [
          history("2026-07-29 12:58", 40, 92_000),
          history("2026-07-29 13:58", 60, 92_000),
          history("2026-07-29 14:58", 83, 92_000)
        ]
      }),
      agent({
        name: "Offline without current activity",
        wbLogin: "wb_offline",
        history: [history("2026-07-29 13:58", 40, 100_000)]
      }),
      agent({
        name: "Video agent",
        wbLogin: "wb_video",
        lob: "VIDEO",
        presenceStatus: "Online",
        history: [history("2026-07-29 14:58", 99, 80_000)]
      })
    ]
  });

  assert.equal(report.dateLabel, "29/07/2026");
  assert.equal(report.intervalLabel, "14:00–14:58");
  assert.equal(report.previousIntervalLabel, "13:00–13:58");
  assert.equal(report.currentHourLabel, "14H");
  assert.equal(report.previousHourLabel, "13H");
  assert.equal(report.onlineCount, 3);
  assert.deepEqual(report.rows.map((row) => row.wbLogin), ["wb_amandar", "wb_rafaelo", "wb_camilas"]);
  assert.deepEqual(report.rows.map((row) => row.currentSubmit), [26, 24, 23]);
  assert.deepEqual(report.rows.map((row) => row.previousSubmit), [20, 20, 20]);
  assert.equal(report.rows[0].comparisonPercent, 30);
  assert.equal(report.rows[0].comparison, "up");
  assert.equal(report.rows[0].shiftTotal, 126);
  assert.equal(report.rows[0].ahtMs, 84_000);
  assert.equal(report.currentIntervalSubmit, 73);
  assert.equal(report.previousIntervalSubmit, 60);
  assert.equal(report.submitComparisonPercent, 21.7);
  assert.equal(report.totalShiftSubmit, 313);
  assert.ok(Math.abs(report.averageSubmitPerHour - 24.333333333333332) < 0.0001);
  assert.ok(report.currentIntervalAhtMs !== null);
  assert.ok(Math.abs(report.currentIntervalAhtMs - 88_493.1506849315) < 0.001);
  assert.ok(report.ahtDeltaMs !== null);
  assert.ok(report.ahtDeltaMs < 0);
});

test("compares midnight with the previous day's 23h interval", () => {
  const report = buildAdsOnlineProductivityReportSnapshot({
    selectedCycle: "2026-07-30 00:58",
    agentRows: [
      agent({
        name: "Night agent",
        wbLogin: "wb_night",
        presenceStatus: "Online",
        history: [
          history("2026-07-29 22:58", 20, 90_000),
          history("2026-07-29 23:58", 38, 90_000),
          history("2026-07-30 00:58", 60, 90_000)
        ]
      })
    ]
  });

  assert.equal(report.intervalLabel, "00:00–00:58");
  assert.equal(report.previousIntervalLabel, "23:00–23:58");
  assert.equal(report.previousHourLabel, "23H");
  assert.equal(report.rows[0].currentSubmit, 22);
  assert.equal(report.rows[0].previousSubmit, 18);
});

function agent(input: {
  name: string;
  wbLogin: string;
  lob?: string;
  presenceStatus?: string;
  isSchedulePresent?: boolean;
  history: AdsExecutiveAgentRow["history"];
}): AdsExecutiveAgentRow {
  return {
    displayName: input.name,
    wbLogin: input.wbLogin,
    rawWbLogin: input.wbLogin,
    lob: input.lob ?? "ADS",
    crossingStatus: "Encontrado",
    personType: "Agente",
    employeeStatus: "Ativo",
    presenceStatus: input.presenceStatus ?? "Offline",
    isSchedulePresent: input.isSchedulePresent ?? false,
    history: input.history
  };
}

function history(cycleDownload: string, submit: number, ahtMs: number) {
  return {
    cycleDownload,
    submit,
    ahtMs,
    moderationMs: submit * ahtMs
  };
}
