CREATE TABLE "PerformanceImportBatch" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "rowsTotal" INTEGER NOT NULL DEFAULT 0,
  "rowsValid" INTEGER NOT NULL DEFAULT 0,
  "rowsError" INTEGER NOT NULL DEFAULT 0,
  "rowsInserted" INTEGER NOT NULL DEFAULT 0,
  "rowsUpdated" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'SUCCESS',
  "errorSummary" TEXT,
  "importedById" TEXT,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PerformanceImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QualityRecord" (
  "id" TEXT NOT NULL,
  "auditTime" TIMESTAMP(3) NOT NULL,
  "auditDate" TIMESTAMP(3) NOT NULL,
  "wbLogin" TEXT NOT NULL,
  "employeeId" TEXT,
  "finalResult" TEXT NOT NULL,
  "caseOrderId" TEXT NOT NULL,
  "auditCaseOrderId" TEXT NOT NULL,
  "concatKey" TEXT NOT NULL,
  "lobId" TEXT,
  "rawLob" TEXT,
  "importBatchId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QualityRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductionRecord" (
  "id" TEXT NOT NULL,
  "bzTime" TIMESTAMP(3) NOT NULL,
  "bzDay" TIMESTAMP(3) NOT NULL,
  "wbLogin" TEXT NOT NULL,
  "employeeId" TEXT,
  "ahtSeconds" DOUBLE PRECISION,
  "latencyMinutesSum" DOUBLE PRECISION,
  "submitNum" INTEGER NOT NULL,
  "queueId" TEXT NOT NULL,
  "moderationSeconds" DOUBLE PRECISION NOT NULL,
  "lobId" TEXT,
  "productionKey" TEXT NOT NULL,
  "importBatchId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductionRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QualityRecord_concatKey_key" ON "QualityRecord"("concatKey");
CREATE INDEX "QualityRecord_employeeId_idx" ON "QualityRecord"("employeeId");
CREATE INDEX "QualityRecord_wbLogin_idx" ON "QualityRecord"("wbLogin");
CREATE INDEX "QualityRecord_auditDate_idx" ON "QualityRecord"("auditDate");
CREATE INDEX "QualityRecord_lobId_idx" ON "QualityRecord"("lobId");
CREATE INDEX "QualityRecord_finalResult_idx" ON "QualityRecord"("finalResult");
CREATE INDEX "QualityRecord_employeeId_auditDate_idx" ON "QualityRecord"("employeeId", "auditDate");

CREATE UNIQUE INDEX "ProductionRecord_productionKey_key" ON "ProductionRecord"("productionKey");
CREATE INDEX "ProductionRecord_employeeId_idx" ON "ProductionRecord"("employeeId");
CREATE INDEX "ProductionRecord_wbLogin_idx" ON "ProductionRecord"("wbLogin");
CREATE INDEX "ProductionRecord_bzDay_idx" ON "ProductionRecord"("bzDay");
CREATE INDEX "ProductionRecord_lobId_idx" ON "ProductionRecord"("lobId");
CREATE INDEX "ProductionRecord_queueId_idx" ON "ProductionRecord"("queueId");
CREATE INDEX "ProductionRecord_employeeId_bzDay_idx" ON "ProductionRecord"("employeeId", "bzDay");

CREATE INDEX "PerformanceImportBatch_type_idx" ON "PerformanceImportBatch"("type");
CREATE INDEX "PerformanceImportBatch_importedAt_idx" ON "PerformanceImportBatch"("importedAt");
CREATE INDEX "PerformanceImportBatch_importedById_idx" ON "PerformanceImportBatch"("importedById");

ALTER TABLE "PerformanceImportBatch"
  ADD CONSTRAINT "PerformanceImportBatch_importedById_fkey"
  FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "QualityRecord"
  ADD CONSTRAINT "QualityRecord_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "QualityRecord"
  ADD CONSTRAINT "QualityRecord_lobId_fkey"
  FOREIGN KEY ("lobId") REFERENCES "Lob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "QualityRecord"
  ADD CONSTRAINT "QualityRecord_importBatchId_fkey"
  FOREIGN KEY ("importBatchId") REFERENCES "PerformanceImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductionRecord"
  ADD CONSTRAINT "ProductionRecord_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductionRecord"
  ADD CONSTRAINT "ProductionRecord_lobId_fkey"
  FOREIGN KEY ("lobId") REFERENCES "Lob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductionRecord"
  ADD CONSTRAINT "ProductionRecord_importBatchId_fkey"
  FOREIGN KEY ("importBatchId") REFERENCES "PerformanceImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
