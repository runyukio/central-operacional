import assert from "node:assert/strict";
import test from "node:test";

import { isPerformanceAdsQueueId, PERFORMANCE_ADS_QUEUE_IDS } from "@/lib/performance-ads-queues";

test("keeps every queue from the ADS Performance source list", () => {
  assert.equal(PERFORMANCE_ADS_QUEUE_IDS.length, 109);
  assert.equal(new Set(PERFORMANCE_ADS_QUEUE_IDS).size, 109);
  assert.equal(isPerformanceAdsQueueId("9527"), true);
  assert.equal(isPerformanceAdsQueueId("5653"), true);
  assert.equal(isPerformanceAdsQueueId("9626"), true);
});

test("does not classify queues outside the source list as ADS", () => {
  assert.equal(isPerformanceAdsQueueId("600001311"), false);
  assert.equal(isPerformanceAdsQueueId("9553"), false);
  assert.equal(isPerformanceAdsQueueId(null), false);
});
