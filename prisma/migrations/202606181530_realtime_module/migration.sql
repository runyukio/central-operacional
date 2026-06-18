CREATE TABLE "RealTimeImportBatch" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'kap-local',
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "rowsTotal" INTEGER NOT NULL DEFAULT 0,
    "queueRows" INTEGER NOT NULL DEFAULT 0,
    "agentRows" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "warnings" JSONB,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RealTimeImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RealTimeRecord" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "queueName" TEXT,
    "agentName" TEXT,
    "wbLogin" TEXT,
    "status" TEXT,
    "lob" TEXT,
    "supervisor" TEXT,
    "rawData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RealTimeRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RealTimeImportBatch_importedAt_idx" ON "RealTimeImportBatch"("importedAt");
CREATE INDEX "RealTimeImportBatch_status_idx" ON "RealTimeImportBatch"("status");
CREATE INDEX "RealTimeImportBatch_source_idx" ON "RealTimeImportBatch"("source");
CREATE INDEX "RealTimeRecord_batchId_idx" ON "RealTimeRecord"("batchId");
CREATE INDEX "RealTimeRecord_recordType_idx" ON "RealTimeRecord"("recordType");
CREATE INDEX "RealTimeRecord_queueName_idx" ON "RealTimeRecord"("queueName");
CREATE INDEX "RealTimeRecord_agentName_idx" ON "RealTimeRecord"("agentName");
CREATE INDEX "RealTimeRecord_wbLogin_idx" ON "RealTimeRecord"("wbLogin");
CREATE INDEX "RealTimeRecord_status_idx" ON "RealTimeRecord"("status");
CREATE INDEX "RealTimeRecord_lob_idx" ON "RealTimeRecord"("lob");
CREATE INDEX "RealTimeRecord_supervisor_idx" ON "RealTimeRecord"("supervisor");
CREATE INDEX "RealTimeRecord_batchId_recordType_idx" ON "RealTimeRecord"("batchId", "recordType");

ALTER TABLE "RealTimeRecord"
    ADD CONSTRAINT "RealTimeRecord_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "RealTimeImportBatch"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
