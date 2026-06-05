CREATE TABLE "TnsQualityRecord" (
  "id" TEXT NOT NULL,
  "auditDate" TIMESTAMP(3) NOT NULL,
  "wbLogin" TEXT NOT NULL,
  "employeeId" TEXT,
  "lobId" TEXT,
  "rawLob" TEXT,
  "sampling" INTEGER NOT NULL DEFAULT 0,
  "mislabeled" INTEGER NOT NULL DEFAULT 0,
  "leakage" INTEGER NOT NULL DEFAULT 0,
  "falsePositive" INTEGER NOT NULL DEFAULT 0,
  "sourceKey" TEXT,
  "importBatchId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TnsQualityRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TnsQualityRecord_employeeId_idx" ON "TnsQualityRecord"("employeeId");
CREATE INDEX "TnsQualityRecord_wbLogin_idx" ON "TnsQualityRecord"("wbLogin");
CREATE INDEX "TnsQualityRecord_auditDate_idx" ON "TnsQualityRecord"("auditDate");
CREATE INDEX "TnsQualityRecord_lobId_idx" ON "TnsQualityRecord"("lobId");
CREATE INDEX "TnsQualityRecord_sourceKey_idx" ON "TnsQualityRecord"("sourceKey");
CREATE INDEX "TnsQualityRecord_employeeId_auditDate_idx" ON "TnsQualityRecord"("employeeId", "auditDate");

ALTER TABLE "TnsQualityRecord"
  ADD CONSTRAINT "TnsQualityRecord_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TnsQualityRecord"
  ADD CONSTRAINT "TnsQualityRecord_lobId_fkey"
  FOREIGN KEY ("lobId") REFERENCES "Lob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TnsQualityRecord"
  ADD CONSTRAINT "TnsQualityRecord_importBatchId_fkey"
  FOREIGN KEY ("importBatchId") REFERENCES "PerformanceImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
