import assert from "node:assert/strict";
import test from "node:test";
import { activityWindowIncludesToday } from "./activity-refresh";

test("live polling follows the São Paulo date, including windows ending today", () => {
  const now = new Date("2026-11-10T02:59:59Z");
  assert.equal(activityWindowIncludesToday("2026-11-09", undefined, now), true);
  assert.equal(activityWindowIncludesToday("2026-11-01", "2026-11-09", now), true);
  assert.equal(activityWindowIncludesToday("2026-11-08", undefined, now), false);
  assert.equal(activityWindowIncludesToday("2026-11-10", undefined, now), false);
  assert.equal(activityWindowIncludesToday("2026-11-09", undefined, new Date("2026-11-10T03:00:00Z")), false);
  assert.equal(activityWindowIncludesToday("", "2026-11-09", now), false);
});
