CREATE TABLE "PerformanceCecCpdRecord" (
    "id" TEXT NOT NULL,
    "performanceTime" TIMESTAMP(3) NOT NULL,
    "performanceDay" TIMESTAMP(3) NOT NULL,
    "wbLogin" TEXT NOT NULL,
    "employeeId" TEXT,
    "ticketCount" INTEGER NOT NULL DEFAULT 0,
    "cpdKey" TEXT NOT NULL,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceCecCpdRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PerformanceCecCpdRecord_cpdKey_key" ON "PerformanceCecCpdRecord"("cpdKey");
CREATE INDEX "PerformanceCecCpdRecord_performanceTime_idx" ON "PerformanceCecCpdRecord"("performanceTime");
CREATE INDEX "PerformanceCecCpdRecord_performanceDay_idx" ON "PerformanceCecCpdRecord"("performanceDay");
CREATE INDEX "PerformanceCecCpdRecord_wbLogin_idx" ON "PerformanceCecCpdRecord"("wbLogin");
CREATE INDEX "PerformanceCecCpdRecord_employeeId_idx" ON "PerformanceCecCpdRecord"("employeeId");
CREATE INDEX "PerformanceCecCpdRecord_importBatchId_idx" ON "PerformanceCecCpdRecord"("importBatchId");
CREATE INDEX "PerformanceCecCpdRecord_employeeId_performanceDay_idx" ON "PerformanceCecCpdRecord"("employeeId", "performanceDay");

ALTER TABLE "PerformanceCecCpdRecord"
ADD CONSTRAINT "PerformanceCecCpdRecord_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PerformanceCecCpdRecord"
ADD CONSTRAINT "PerformanceCecCpdRecord_importBatchId_fkey"
FOREIGN KEY ("importBatchId") REFERENCES "PerformanceImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
