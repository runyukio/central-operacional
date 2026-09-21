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

test("ADS emphasizes interval moderation and keeps each agent's shift total smaller underneath", () => {
  const report = buildAdsOnlineProductivityReportSnapshot({ selectedCycle: "2026-09-21 11:30", agentRows: [] });
  report.rows = [{ name: "Preview Agent", wbLogin: "wb_preview", skill: "Material Queues", currentSubmit: 10, previousSubmit: 5, comparisonPercent: 100, comparison: "up", shiftTotal: 100, shiftModerationMs: 13_515_500, ahtMs: 60_000, moderationMs: 600_000 }];
  const markup = renderToStaticMarkup(createElement(AdsOnlineProductivityReportImage, { report }));
  assert.doesNotMatch(markup, /TOTAL SHIFT MODERATION/);
  assert.match(markup, /INTERVAL · MIN/);
  const interval = markup.match(/<span style="([^"]+)">10 min<\/span>/);
  const shiftTotal = markup.match(/<span style="([^"]+)">03:45 shift total<\/span>/);
  assert.ok(interval, "interval moderation must be the main value");
  assert.ok(shiftTotal, "shift moderation must remain visible per agent");
  assert.match(interval[1], /font-size:22px/);
  assert.match(shiftTotal[1], /font-size:14px/);
  assert.ok(markup.indexOf(interval[0]) < markup.indexOf(shiftTotal[0]), "interval appears above the shift total");
  assert.doesNotMatch(markup, /SHIFT TOTAL · HH:MM|10 min interval/);
  const tnsMarkup = renderToStaticMarkup(createElement(AdsOnlineProductivityReportImage, { report: { ...report, reportScope: "TNS" } }));
  assert.match(tnsMarkup, /MODERATION \(MIN\)/);
  assert.doesNotMatch(tnsMarkup, /INTERVAL · MIN|03:45 shift total|TOTAL SHIFT MODERATION/);
});
