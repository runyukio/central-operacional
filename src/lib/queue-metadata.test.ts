import assert from "node:assert/strict";
import test from "node:test";

import { QUEUE_METADATA } from "./queue-metadata";
import { getQueueReportMetadataById } from "./queue-report-metadata";

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
