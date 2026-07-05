CREATE TABLE "PerformanceQueueVolumeRecord" (
  "id" TEXT NOT NULL,
  "bzTime" TIMESTAMP(3) NOT NULL,
  "bzDay" TIMESTAMP(3) NOT NULL,
  "queueId" TEXT NOT NULL,
  "inputCount" INTEGER NOT NULL DEFAULT 0,
  "volumeKey" TEXT NOT NULL,
  "importBatchId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PerformanceQueueVolumeRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PerformanceQueueVolumeRecord_volumeKey_key" ON "PerformanceQueueVolumeRecord"("volumeKey");
CREATE INDEX "PerformanceQueueVolumeRecord_bzTime_idx" ON "PerformanceQueueVolumeRecord"("bzTime");
CREATE INDEX "PerformanceQueueVolumeRecord_bzDay_idx" ON "PerformanceQueueVolumeRecord"("bzDay");
CREATE INDEX "PerformanceQueueVolumeRecord_queueId_idx" ON "PerformanceQueueVolumeRecord"("queueId");
CREATE INDEX "PerformanceQueueVolumeRecord_importBatchId_idx" ON "PerformanceQueueVolumeRecord"("importBatchId");
CREATE INDEX "PerformanceQueueVolumeRecord_queueId_bzDay_idx" ON "PerformanceQueueVolumeRecord"("queueId", "bzDay");

ALTER TABLE "PerformanceQueueVolumeRecord"
  ADD CONSTRAINT "PerformanceQueueVolumeRecord_importBatchId_fkey"
  FOREIGN KEY ("importBatchId") REFERENCES "PerformanceImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
