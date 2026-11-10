-- Old snapshots did not retain the queue. Keep their totals and classify on reimport.
ALTER TABLE "QualityRecord" ADD COLUMN "queueId" TEXT;
CREATE INDEX "QualityRecord_queueId_auditDate_idx" ON "QualityRecord"("queueId", "auditDate");
