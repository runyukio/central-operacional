import assert from "node:assert/strict";
import test from "node:test";

import type { AdsExecutiveReportSnapshot } from "./ads-executive-report-core";
import { buildAdsExecutiveHealthMapXlsx } from "./ads-executive-xlsx";
import { xlsxDurationFormat } from "./xlsx-export";

test("exports the ADS hourly health map as one tabular row per hour", () => {
  const report = {
    lob: "ADS",
    latencyTargetMinutes: 120,
    selectedCycle: "2026-08-05 01:00",
    dateKey: "2026-08-05",
    dateLabel: "Aug 05, 2026",
    latestHourLabel: "2026-08-05 01:00",
    currentHour: 1,
    buckets: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: `${String(hour).padStart(2, "0")}h`,
      cycleDownload: hour <= 1 ? `2026-08-05 ${String(hour).padStart(2, "0")}:00` : null,
      input: hour === 1 ? 369 : null,
      output: hour === 1 ? 314 : null,
      forecast: 400 + hour,
      ahtMs: hour === 1 ? 75_000 : null,
      latencyMs: null,
      maxLatencyMs: hour === 1 ? 7_200_000 : null,
      backlog: hour === 1 ? 5_059 : null,
      required: 12,
      online: hour === 1 ? 18 : null
    })),
    cards: [],
    topAgents: [],
    lowAgents: []
  } satisfies AdsExecutiveReportSnapshot;

  const payload = buildAdsExecutiveHealthMapXlsx(report);

  assert.equal(payload.sheetName, "Hourly health map");
  assert.equal(payload.rows.length, 24);
  assert.equal(payload.headers.length, 13);
  assert.equal(payload.rows[1][3], 369);
  assert.equal(payload.rows[1][4], 401);
  assert.equal(payload.rows[1][5], 314);
  assert.equal(payload.rows[1][6], -55);
  assert.equal(payload.rows[1][10], 6);
  assert.equal(payload.rows[1][11], 5_059);
  assert.equal(payload.rows[1][7], 75_000 / 86_400_000);
  assert.equal(payload.columnFormats?.[7], xlsxDurationFormat);
  assert.equal(payload.columnFormats?.[12], xlsxDurationFormat);
  assert.match(payload.fileName, /^ads_hourly_health_map_2026-08-05_/);
});
