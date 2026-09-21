import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildAdsOnlineProductivityReportSnapshot } from "./ads-online-productivity-report-core";
import { AdsOnlineProductivityReportImage, formatModerationHours } from "./ads-online-productivity-report-image";

test("moderation duration formats a sum in hh:mm without wrapping at 24 hours", () => {
  assert.equal(formatModerationHours(0), "00:00");
  assert.equal(formatModerationHours(13_515_500), "03:45");
  assert.equal(formatModerationHours(90_120_000), "25:02");
  assert.equal(formatModerationHours(3_599_999), "01:00");
  assert.equal(formatModerationHours(360_000_000), "100:00");
  for (const value of [NaN, Infinity, -1]) assert.equal(formatModerationHours(value), "N/A");
});

test("ADS shows moderation per agent, preserves the interval and removes the aggregate KPI", () => {
  const report = buildAdsOnlineProductivityReportSnapshot({ selectedCycle: "2026-09-21 11:30", agentRows: [] });
  report.rows = [{ name: "Preview Agent", wbLogin: "wb_preview", skill: "Material Queues", currentSubmit: 10, previousSubmit: 5, comparisonPercent: 100, comparison: "up", shiftTotal: 100, shiftModerationMs: 13_515_500, ahtMs: 60_000, moderationMs: 600_000 }];
  const markup = renderToStaticMarkup(createElement(AdsOnlineProductivityReportImage, { report }));
  assert.doesNotMatch(markup, /TOTAL SHIFT MODERATION/);
  assert.match(markup, /SHIFT TOTAL · HH:MM/);
  assert.match(markup, />03:45</);
  assert.match(markup, /10 min interval/);
  const tnsMarkup = renderToStaticMarkup(createElement(AdsOnlineProductivityReportImage, { report: { ...report, reportScope: "TNS" } }));
  assert.match(tnsMarkup, /MODERATION \(MIN\)/);
  assert.doesNotMatch(tnsMarkup, /SHIFT TOTAL · HH:MM|03:45|TOTAL SHIFT MODERATION/);
});
