import assert from "node:assert/strict";
import test from "node:test";

import { QUEUE_METADATA } from "./queue-metadata";
import { getQueueReportMetadataById } from "./queue-report-metadata";
import { getQueueIdByName, getQueueNameById, resolveQueueReference } from "./queue-dictionary";
import { allPerformanceQueueIds, getPerformanceQueueMetadataById } from "./performance-service";
import { isPerformanceAdsQueueId } from "./performance-ads-queues";

test("classifica a fila 600001263 no report TNS como COMMENTS com SLA de 168 horas", () => {
  assert.deepEqual(QUEUE_METADATA["600001263"], {
    lob: "COMMENTS",
    slaTargetMinutes: 168 * 60
  });
  assert.deepEqual(getQueueReportMetadataById("600001263"), {
    queueName: "Image Preliminary Review Routine Quality Check for the Brazil Language Cohort Large Model",
    department: "Comments QA",
    lob: "COMMENTS"
  });
});

// Filas Não Mapeadas!A2:I8, supplied on 2026-09-08. SLAs are minutes,
// not HH:mm; the saved global values match the explicit Performance values.
const septemberVideoQueues = [
  { id: "5857", name: "视频-安全二审-巴西桶-top", sla: 30 },
  { id: "9575", name: "视频-举报审-混合桶-初始", sla: 1440 },
  { id: "5853", name: "视频-安全二审-巴西桶-高危", sla: 2180 },
  { id: "5856", name: "视频-安全二审-巴西桶-长视频", sla: 360 },
  { id: "5896", name: "视频-安全一审-西班牙桶-高危", sla: 5130 },
  { id: "5864", name: "视频-安全二审-西班牙桶-高危", sla: 2380 },
  { id: "5886", name: "视频-安全一审-巴西桶-高危", sla: 7920 }
];

for (const queue of septemberVideoQueues) {
  test(`maps ${queue.id} consistently in Real Time, TNS reports and Performance`, () => {
    const expected = { lob: "VIDEO", slaTargetMinutes: queue.sla };
    assert.deepEqual(QUEUE_METADATA[queue.id], expected);
    assert.deepEqual(getPerformanceQueueMetadataById(` ${queue.id} `), expected);
    assert.equal(allPerformanceQueueIds().filter((id) => id === queue.id).length, 1);
    assert.equal(isPerformanceAdsQueueId(queue.id), false);
    assert.equal(getQueueNameById(queue.id), queue.name);
    assert.equal(getQueueIdByName(queue.name), queue.id);
    const reference = { queueId: queue.id, queueName: queue.name, ...expected };
    assert.deepEqual(resolveQueueReference(queue.id), reference);
    assert.deepEqual(resolveQueueReference(null, queue.name), reference);
    assert.deepEqual(getQueueReportMetadataById(queue.id), {
      queueName: queue.name, department: "Não informado", lob: "VIDEO"
    });
  });
}

test("new VIDEO queues preserve existing ADS and fifteen-minute TNS rules", () => {
  assert.deepEqual(getPerformanceQueueMetadataById("600003312"), { lob: "ADS", slaTargetMinutes: 120 });
  assert.deepEqual(getPerformanceQueueMetadataById("5860"), { lob: "VIDEO", slaTargetMinutes: 15 });
  assert.equal(getQueueReportMetadataById("5860").department, "Brazil Safety");
  assert.deepEqual(getPerformanceQueueMetadataById("missing"), { lob: "N/A", slaTargetMinutes: null });
});
