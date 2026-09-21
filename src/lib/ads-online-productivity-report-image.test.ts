import assert from "node:assert/strict";
import test from "node:test";
import { formatModerationHours } from "./ads-online-productivity-report-image";

test("moderation duration formats a sum in hh:mm without wrapping at 24 hours", () => {
  assert.equal(formatModerationHours(0), "00:00");
  assert.equal(formatModerationHours(13_515_500), "03:45");
  assert.equal(formatModerationHours(90_120_000), "25:02");
  assert.equal(formatModerationHours(3_599_999), "01:00");
  assert.equal(formatModerationHours(360_000_000), "100:00");
  for (const value of [NaN, Infinity, -1]) assert.equal(formatModerationHours(value), "N/A");
});
