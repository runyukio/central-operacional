import assert from "node:assert/strict";
import test from "node:test";

import type { AdsExecutiveAgentRow } from "./ads-executive-report-core";
import {
  buildAdsOnlineProductivityReportSnapshot,
  buildTnsOnlineProductivityReportSnapshot
} from "./ads-online-productivity-report-core";

test("builds the ADS online productivity ranking with hourly and shift metrics", () => {
  const report = buildAdsOnlineProductivityReportSnapshot({
    selectedCycle: "2026-07-29 14:58",
    agentRows: [
      agent({
        name: "Amanda Ribeiro",
        wbLogin: "wb_amandar",
        skill: "Material Queues",
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
        skill: "Nesting",
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
        skill: "Nesting",
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
  assert.equal(report.productiveAgentCount, 3);
  assert.deepEqual(report.rows.map((row) => row.wbLogin), ["wb_amandar", "wb_rafaelo", "wb_camilas"]);
  assert.deepEqual(report.rows.map((row) => row.skill), ["Material Queues", "Nesting", "Nesting"]);
  assert.deepEqual(report.rows.map((row) => row.currentSubmit), [26, 24, 23]);
  assert.deepEqual(report.rows.map((row) => row.previousSubmit), [20, 20, 20]);
  assert.equal(report.rows[0].comparisonPercent, 30);
  assert.equal(report.rows[0].comparison, "up");
  assert.equal(report.rows[0].shiftTotal, 126);
  assert.equal(report.rows[0].ahtMs, 84_000);
  assert.equal(report.rows[0].moderationMs, 2_184_000);
  assert.equal(report.currentIntervalSubmit, 73);
  assert.equal(report.previousIntervalSubmit, 60);
  assert.equal(report.submitComparisonPercent, 22);
  assert.equal(report.totalShiftSubmit, 313);
  assert.ok(Math.abs(report.averageSubmitPerHour - 24.397260273972602) < 0.0001);
  assert.equal(report.currentIntervalModerationMs, 6_460_000);
  assert.ok(report.currentIntervalAhtMs !== null);
  assert.ok(Math.abs(report.currentIntervalAhtMs - 88_493.1506849315) < 0.001);
  assert.ok(report.ahtDeltaMs !== null);
  assert.ok(report.ahtDeltaMs < 0);
  assert.deepEqual(report.skillAverages, [
    { skill: "Material Queues", averageSubmit: 26, agentCount: 1 },
    { skill: "Nesting", averageSubmit: 23.51063829787234, agentCount: 2 }
  ]);
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

test("keeps the operational shift total when the China-day counter resets at 13h", () => {
  const report = buildAdsOnlineProductivityReportSnapshot({
    selectedCycle: "2026-08-27 13:30",
    agentRows: [
      agent({
        name: "Morning agent",
        wbLogin: "wb_morning",
        shift: "Manhã",
        presenceStatus: "Online",
        history: [
          history("2026-08-27 07:30", 120, 50_000),
          history("2026-08-27 08:00", 120, 50_000),
          history("2026-08-27 12:30", 447, 50_000),
          history("2026-08-27 13:00", 27, 50_000),
          history("2026-08-27 13:30", 69, 50_000)
        ]
      })
    ]
  });

  assert.equal(report.rows[0].currentSubmit, 69);
  assert.equal(report.rows[0].shiftTotal, 396);
  assert.equal(report.rows[0].ahtMs, 50_000);
  assert.equal(report.totalShiftSubmit, 396);
});

test("keeps the night shift total across Sao Paulo midnight", () => {
  const report = buildAdsOnlineProductivityReportSnapshot({
    selectedCycle: "2026-08-27 00:30",
    agentRows: [
      agent({
        name: "Night agent",
        wbLogin: "wb_night_shift",
        shift: "Noite",
        presenceStatus: "Online",
        history: [
          history("2026-08-26 22:30", 600, 60_000),
          history("2026-08-26 23:00", 610, 60_000),
          history("2026-08-26 23:30", 650, 60_000),
          history("2026-08-27 00:00", 690, 60_000),
          history("2026-08-27 00:30", 730, 60_000)
        ]
      })
    ]
  });

  assert.equal(report.rows[0].shiftTotal, 130);
  assert.equal(report.rows[0].ahtMs, 60_000);
});

test("builds TNS productivity with VIDEO and COMMENTS while AHT uses VIDEO only", () => {
  const report = buildTnsOnlineProductivityReportSnapshot({
    selectedCycle: "2026-08-26 14:58",
    agentRows: [
      agent({
        name: "Video agent",
        wbLogin: "wb_video",
        lob: "VIDEO",
        skill: "Premium",
        presenceStatus: "Online",
        history: [
          history("2026-08-26 12:58", 10, 50_000),
          history("2026-08-26 13:58", 30, 50_000),
          history("2026-08-26 14:58", 60, 50_000)
        ]
      }),
      agent({
        name: "Comments agent",
        wbLogin: "wb_comments",
        lob: "COMMENTS",
        skill: "Comments QA",
        presenceStatus: "Pausa",
        history: [
          history("2026-08-26 12:58", 8, 200_000),
          history("2026-08-26 13:58", 28, 200_000),
          history("2026-08-26 14:58", 52, 200_000)
        ]
      }),
      agent({
        name: "ADS agent",
        wbLogin: "wb_ads",
        lob: "ADS",
        presenceStatus: "Online",
        history: [history("2026-08-26 14:58", 99, 70_000)]
      })
    ]
  });

  assert.equal(report.reportScope, "TNS");
  assert.equal(report.productiveAgentCount, 2);
  assert.deepEqual(report.rows.map((row) => row.wbLogin), ["wb_video", "wb_comments"]);
  assert.deepEqual(report.rows.map((row) => row.skill), ["VIDEO", "COMMENTS"]);
  assert.deepEqual(report.rows.map((row) => row.currentSubmit), [30, 24]);
  assert.equal(report.rows[0].ahtMs, 50_000);
  assert.equal(report.rows[1].ahtMs, null);
  assert.equal(report.currentIntervalSubmit, 54);
  assert.equal(report.currentIntervalModerationMs, 6_300_000);
  assert.equal(report.currentIntervalAhtMs, 50_000);
  assert.deepEqual(report.skillAverages, [
    { skill: "VIDEO", averageSubmit: 30, agentCount: 1 },
    { skill: "COMMENTS", averageSubmit: 24, agentCount: 1 }
  ]);
});

test("excludes agents with zero submit from the report and averages", () => {
  const report = buildAdsOnlineProductivityReportSnapshot({
    selectedCycle: "2026-07-29 09:30",
    agentRows: [
      agent({
        name: "Submitting agent",
        wbLogin: "wb_submitting",
        skill: "Nesting",
        presenceStatus: "Online",
        history: [
          history("2026-07-29 07:30", 10, 60_000),
          history("2026-07-29 08:30", 30, 60_000),
          history("2026-07-29 09:30", 50, 60_000)
        ]
      }),
      agent({
        name: "Paused agent",
        wbLogin: "wb_paused",
        presenceStatus: "Tela bloqueada",
        history: [
          history("2026-07-29 07:30", 0, 60_000),
          history("2026-07-29 08:30", 15, 60_000),
          history("2026-07-29 09:30", 15, 60_000)
        ]
      }),
      agent({
        name: "No submit agent",
        wbLogin: "wb_no_submit",
        presenceStatus: "Online",
        history: [
          history("2026-07-29 07:30", 5, 60_000),
          history("2026-07-29 08:30", 5, 60_000),
          history("2026-07-29 09:30", 5, 60_000)
        ]
      })
    ]
  });

  assert.equal(report.productiveAgentCount, 1);
  assert.deepEqual(report.rows.map((row) => row.wbLogin), ["wb_submitting"]);
  assert.equal(report.currentIntervalSubmit, 20);
  assert.equal(report.previousIntervalSubmit, 20);
  assert.equal(report.averageSubmitPerHour, 20);
  assert.equal(report.submitComparisonPercent, 0);
  assert.deepEqual(report.skillAverages, [
    { skill: "Nesting", averageSubmit: 20, agentCount: 1 }
  ]);
});

function agent(input: {
  name: string;
  wbLogin: string;
  lob?: string;
  skill?: string;
  shift?: string;
  presenceStatus?: string;
  isSchedulePresent?: boolean;
  history: AdsExecutiveAgentRow["history"];
}): AdsExecutiveAgentRow {
  return {
    displayName: input.name,
    wbLogin: input.wbLogin,
    rawWbLogin: input.wbLogin,
    skill: input.skill ?? "",
    lob: input.lob ?? "ADS",
    crossingStatus: "Encontrado",
    personType: "Agente",
    employeeStatus: "Ativo",
    presenceStatus: input.presenceStatus ?? "Offline",
    isSchedulePresent: input.isSchedulePresent ?? false,
    shift: input.shift,
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
