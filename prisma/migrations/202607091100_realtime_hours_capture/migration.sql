CREATE TABLE "RealTimeHoursImportBatch" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'local-windows-server',
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL DEFAULT 'SUCCESS',
  "rowsTotal" INTEGER NOT NULL DEFAULT 0,
  "rowsValid" INTEGER NOT NULL DEFAULT 0,
  "rowsError" INTEGER NOT NULL DEFAULT 0,
  "errorSummary" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RealTimeHoursImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RealTimeHoursRecord" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "hostname" TEXT NOT NULL,
  "windowsUser" TEXT,
  "wbLogin" TEXT,
  "employeeId" TEXT,
  "ipAddress" TEXT,
  "isSessionActive" BOOLEAN NOT NULL DEFAULT false,
  "idleSeconds" INTEGER,
  "lastActivityAt" TIMESTAMP(3),
  "activeProcessName" TEXT,
  "activeWindowTitle" TEXT,
  "identitySource" TEXT,
  "identityConfidence" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "rawData" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RealTimeHoursRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RealTimeHoursImportBatch_source_idx" ON "RealTimeHoursImportBatch"("source");
CREATE INDEX "RealTimeHoursImportBatch_capturedAt_idx" ON "RealTimeHoursImportBatch"("capturedAt");
CREATE INDEX "RealTimeHoursImportBatch_importedAt_idx" ON "RealTimeHoursImportBatch"("importedAt");
CREATE INDEX "RealTimeHoursImportBatch_status_idx" ON "RealTimeHoursImportBatch"("status");
CREATE INDEX "RealTimeHoursImportBatch_status_importedAt_idx" ON "RealTimeHoursImportBatch"("status", "importedAt");

CREATE INDEX "RealTimeHoursRecord_batchId_idx" ON "RealTimeHoursRecord"("batchId");
CREATE INDEX "RealTimeHoursRecord_capturedAt_idx" ON "RealTimeHoursRecord"("capturedAt");
CREATE INDEX "RealTimeHoursRecord_hostname_idx" ON "RealTimeHoursRecord"("hostname");
CREATE INDEX "RealTimeHoursRecord_wbLogin_idx" ON "RealTimeHoursRecord"("wbLogin");
CREATE INDEX "RealTimeHoursRecord_employeeId_idx" ON "RealTimeHoursRecord"("employeeId");
CREATE INDEX "RealTimeHoursRecord_identityConfidence_idx" ON "RealTimeHoursRecord"("identityConfidence");
CREATE INDEX "RealTimeHoursRecord_capturedAt_employeeId_idx" ON "RealTimeHoursRecord"("capturedAt", "employeeId");
CREATE INDEX "RealTimeHoursRecord_capturedAt_wbLogin_idx" ON "RealTimeHoursRecord"("capturedAt", "wbLogin");
CREATE INDEX "RealTimeHoursRecord_hostname_capturedAt_idx" ON "RealTimeHoursRecord"("hostname", "capturedAt");

ALTER TABLE "RealTimeHoursRecord"
  ADD CONSTRAINT "RealTimeHoursRecord_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "RealTimeHoursImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
