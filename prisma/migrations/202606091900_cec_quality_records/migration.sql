CREATE TABLE "CecQualityRecord" (
  "id" TEXT NOT NULL,
  "wbLogin" TEXT NOT NULL,
  "employeeId" TEXT,
  "weekNumber" INTEGER NOT NULL,
  "weekStartDate" TIMESTAMP(3) NOT NULL,
  "weekEndDate" TIMESTAMP(3) NOT NULL,
  "qualityDate" TIMESTAMP(3) NOT NULL,
  "passQuantity" INTEGER NOT NULL DEFAULT 0,
  "failQuantity" INTEGER NOT NULL DEFAULT 0,
  "lobId" TEXT,
  "importBatchId" TEXT,
  "originalRowNumber" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CecQualityRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CecQualityRecord_wbLogin_weekNumber_qualityDate_key" ON "CecQualityRecord"("wbLogin", "weekNumber", "qualityDate");
CREATE INDEX "CecQualityRecord_employeeId_idx" ON "CecQualityRecord"("employeeId");
CREATE INDEX "CecQualityRecord_wbLogin_idx" ON "CecQualityRecord"("wbLogin");
CREATE INDEX "CecQualityRecord_qualityDate_idx" ON "CecQualityRecord"("qualityDate");
CREATE INDEX "CecQualityRecord_weekNumber_idx" ON "CecQualityRecord"("weekNumber");
CREATE INDEX "CecQualityRecord_lobId_idx" ON "CecQualityRecord"("lobId");
CREATE INDEX "CecQualityRecord_importBatchId_idx" ON "CecQualityRecord"("importBatchId");
CREATE INDEX "CecQualityRecord_employeeId_qualityDate_idx" ON "CecQualityRecord"("employeeId", "qualityDate");
CREATE INDEX "CecQualityRecord_weekNumber_employeeId_idx" ON "CecQualityRecord"("weekNumber", "employeeId");
CREATE INDEX "CecQualityRecord_employeeId_weekNumber_idx" ON "CecQualityRecord"("employeeId", "weekNumber");

ALTER TABLE "CecQualityRecord"
  ADD CONSTRAINT "CecQualityRecord_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CecQualityRecord"
  ADD CONSTRAINT "CecQualityRecord_lobId_fkey"
  FOREIGN KEY ("lobId") REFERENCES "Lob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CecQualityRecord"
  ADD CONSTRAINT "CecQualityRecord_importBatchId_fkey"
  FOREIGN KEY ("importBatchId") REFERENCES "PerformanceImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
