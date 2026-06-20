CREATE TABLE "RealTimeAgentCycleSummary" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "cycleDownload" TEXT NOT NULL,
    "wbLoginNormalized" TEXT NOT NULL,
    "rawWbLogin" TEXT NOT NULL,
    "employeeId" TEXT,
    "displayName" TEXT NOT NULL,
    "wbLogin" TEXT NOT NULL,
    "crossingStatus" TEXT NOT NULL,
    "personType" TEXT NOT NULL,
    "employeeStatus" TEXT NOT NULL,
    "lob" TEXT NOT NULL,
    "supervisor" TEXT NOT NULL,
    "shift" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "roleTitle" TEXT NOT NULL,
    "submit" INTEGER NOT NULL DEFAULT 0,
    "ahtMs" DOUBLE PRECISION,
    "moderationMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "timeout" INTEGER NOT NULL DEFAULT 0,
    "refresh" INTEGER NOT NULL DEFAULT 0,
    "queueCount" INTEGER NOT NULL DEFAULT 0,
    "sourceRows" INTEGER NOT NULL DEFAULT 0,
    "queueBreakdown" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RealTimeAgentCycleSummary_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RealTimeQueueCycleSummary" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "cycleDownload" TEXT NOT NULL,
    "queueKey" TEXT NOT NULL,
    "queueId" TEXT NOT NULL,
    "queueName" TEXT NOT NULL,
    "lob" TEXT NOT NULL,
    "slaTargetMinutes" DOUBLE PRECISION,
    "status" TEXT NOT NULL,
    "input" INTEGER NOT NULL DEFAULT 0,
    "output" INTEGER NOT NULL DEFAULT 0,
    "ahtMs" DOUBLE PRECISION,
    "latencyMs" DOUBLE PRECISION,
    "maxLatencyMs" DOUBLE PRECISION,
    "maxLatencyRowNumber" INTEGER NOT NULL DEFAULT 0,
    "backlog" INTEGER NOT NULL DEFAULT 0,
    "sourceRows" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RealTimeQueueCycleSummary_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RealTimeAgentCycleSummary_batchId_idx" ON "RealTimeAgentCycleSummary"("batchId");
CREATE INDEX "RealTimeAgentCycleSummary_cycleDownload_idx" ON "RealTimeAgentCycleSummary"("cycleDownload");
CREATE INDEX "RealTimeAgentCycleSummary_wbLoginNormalized_idx" ON "RealTimeAgentCycleSummary"("wbLoginNormalized");
CREATE INDEX "RealTimeAgentCycleSummary_employeeId_idx" ON "RealTimeAgentCycleSummary"("employeeId");
CREATE INDEX "RealTimeAgentCycleSummary_lob_idx" ON "RealTimeAgentCycleSummary"("lob");
CREATE INDEX "RealTimeAgentCycleSummary_supervisor_idx" ON "RealTimeAgentCycleSummary"("supervisor");
CREATE INDEX "RealTimeAgentCycleSummary_shift_idx" ON "RealTimeAgentCycleSummary"("shift");
CREATE INDEX "RealTimeAgentCycleSummary_skill_idx" ON "RealTimeAgentCycleSummary"("skill");
CREATE INDEX "RealTimeAgentCycleSummary_roleTitle_idx" ON "RealTimeAgentCycleSummary"("roleTitle");
CREATE INDEX "RealTimeAgentCycleSummary_crossingStatus_idx" ON "RealTimeAgentCycleSummary"("crossingStatus");
CREATE INDEX "RealTimeAgentCycleSummary_personType_idx" ON "RealTimeAgentCycleSummary"("personType");
CREATE INDEX "RealTimeAgentCycleSummary_employeeStatus_idx" ON "RealTimeAgentCycleSummary"("employeeStatus");
CREATE INDEX "RealTimeAgentCycleSummary_cycleDownload_wbLoginNormalized_idx" ON "RealTimeAgentCycleSummary"("cycleDownload", "wbLoginNormalized");
CREATE INDEX "RealTimeAgentCycleSummary_batchId_cycleDownload_idx" ON "RealTimeAgentCycleSummary"("batchId", "cycleDownload");

CREATE INDEX "RealTimeQueueCycleSummary_batchId_idx" ON "RealTimeQueueCycleSummary"("batchId");
CREATE INDEX "RealTimeQueueCycleSummary_cycleDownload_idx" ON "RealTimeQueueCycleSummary"("cycleDownload");
CREATE INDEX "RealTimeQueueCycleSummary_queueId_idx" ON "RealTimeQueueCycleSummary"("queueId");
CREATE INDEX "RealTimeQueueCycleSummary_queueKey_idx" ON "RealTimeQueueCycleSummary"("queueKey");
CREATE INDEX "RealTimeQueueCycleSummary_lob_idx" ON "RealTimeQueueCycleSummary"("lob");
CREATE INDEX "RealTimeQueueCycleSummary_status_idx" ON "RealTimeQueueCycleSummary"("status");
CREATE INDEX "RealTimeQueueCycleSummary_slaTargetMinutes_idx" ON "RealTimeQueueCycleSummary"("slaTargetMinutes");
CREATE INDEX "RealTimeQueueCycleSummary_cycleDownload_queueKey_idx" ON "RealTimeQueueCycleSummary"("cycleDownload", "queueKey");
CREATE INDEX "RealTimeQueueCycleSummary_batchId_cycleDownload_idx" ON "RealTimeQueueCycleSummary"("batchId", "cycleDownload");

ALTER TABLE "RealTimeAgentCycleSummary"
    ADD CONSTRAINT "RealTimeAgentCycleSummary_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "RealTimeImportBatch"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RealTimeQueueCycleSummary"
    ADD CONSTRAINT "RealTimeQueueCycleSummary_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "RealTimeImportBatch"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
