import assert from "node:assert/strict";
import test from "node:test";

import type { AdsExecutiveAgentRow, AdsExecutiveQueueRow } from "./ads-executive-report-core";
import {
  ADS_BACKLOG_PLAN,
  buildAdsBacklogHourlyReportSnapshot,
  buildAdsBacklogKwaiTalkPayload,
  isMaterialQueuesSkill
} from "./ads-backlog-hourly-report-core";

test("rebuilds the workbook as 58 continuous hours ending on Aug 7 at 05:00", () => {
  assert.equal(ADS_BACKLOG_PLAN.length, 58);
  assert.deepEqual(ADS_BACKLOG_PLAN[0], {
    timestamp: Date.UTC(2026, 7, 4, 20),
    dateKey: "2026-08-04",
    hour: 20,
    plannedBacklog: 3863,
    forecastVolume: 561
  });
  assert.deepEqual(ADS_BACKLOG_PLAN.at(-1), {
    timestamp: Date.UTC(2026, 7, 7, 5),
    dateKey: "2026-08-07",
    hour: 5,
    plannedBacklog: 0,
    forecastVolume: 438
  });
});

test("projects the next hour with ADS backlog, remaining forecast and Material-only hourly productivity", () => {
  const report = buildAdsBacklogHourlyReportSnapshot({
    selectedCycle: "2026-08-04 20:30",
    queueRows: [queueRow()],
    agentRows: [
      agent("Material agent", "wb_material", "Material Queues", 100, 220),
      agent("Second material agent", "wb_material2", "Material Queues", 50, 110),
      agent("Nesting agent", "wb_nesting", "Nesting", 100, 350)
    ]
  });

  assert.ok(report);
  assert.equal(report.reportHourLabel, "04/08 20:00");
  assert.equal(report.nextHourLabel, "04/08 21:00");
  assert.equal(report.currentBacklog, 4000);
  assert.equal(report.plannedBacklog, 3863);
  assert.equal(report.actualIncomingVolume, 300);
  assert.equal(report.forecastedVolume, 561);
  assert.equal(report.materialAverageSubmitPerHour, 90);
  assert.equal(report.materialTotalSubmitPerHour, 180);
  assert.equal(report.materialProductiveAgentCount, 2);
  assert.equal(report.expectedNextHourBacklog, 4191);
  assert.equal(report.expectedClearanceLabel, "Aug 7 at 5:00 AM");
});

test("builds an English Kim message with the next-hour projection", () => {
  const report = buildAdsBacklogHourlyReportSnapshot({
    selectedCycle: "2026-08-04 20:30",
    queueRows: [queueRow()],
    agentRows: [agent("Material agent", "wb_material", "Material Queues", 100, 220)]
  });
  assert.ok(report);

  const payload = buildAdsBacklogKwaiTalkPayload(report);
  assert.equal(payload.msgtype, "markdown");
  assert.match(payload.markdown.content, /ADS Backlog Update — 20:00/);
  assert.match(payload.markdown.content, /Current productivity:.*120 submits\/hour\/agent \(Material only\)/);
  assert.match(payload.markdown.content, /Expected backlog at 21:00:.*4,221/);
  assert.match(payload.markdown.content, /Expected clearance:.*Aug 7 at 5:00 AM/);
});

test("matches only the Material Queues skill", () => {
  assert.equal(isMaterialQueuesSkill("Material Queues"), true);
  assert.equal(isMaterialQueuesSkill("  MATERIAL QUÉUES "), true);
  assert.equal(isMaterialQueuesSkill("Nesting"), false);
  assert.equal(isMaterialQueuesSkill("Project"), false);
});

function queueRow(): AdsExecutiveQueueRow {
  return {
    lob: "ADS",
    history: [
      {
        cycleDownload: "2026-08-04 19:30",
        input: 1000,
        output: 1000,
        ahtMs: 60_000,
        latencyMs: 60_000,
        maxLatencyMs: 120_000,
        backlog: 3800
      },
      {
        cycleDownload: "2026-08-04 20:30",
        input: 1300,
        output: 1100,
        ahtMs: 60_000,
        latencyMs: 60_000,
        maxLatencyMs: 120_000,
        backlog: 4000
      }
    ]
  };
}

function agent(name: string, wbLogin: string, skill: string, previousSubmit: number, currentSubmit: number): AdsExecutiveAgentRow {
  return {
    displayName: name,
    wbLogin,
    rawWbLogin: wbLogin,
    skill,
    lob: "ADS",
    crossingStatus: "Encontrado",
    personType: "Agente",
    employeeStatus: "Ativo",
    presenceStatus: "Online",
    history: [
      {
        cycleDownload: "2026-08-04 19:30",
        submit: previousSubmit,
        ahtMs: 60_000,
        moderationMs: previousSubmit * 60_000
      },
      {
        cycleDownload: "2026-08-04 20:30",
        submit: currentSubmit,
        ahtMs: 60_000,
        moderationMs: currentSubmit * 60_000
      }
    ]
  };
}
