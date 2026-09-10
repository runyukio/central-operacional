CREATE TABLE "PerformanceUrRecord" (
  "id" TEXT NOT NULL,
  "shiftDate" DATE NOT NULL,
  "wbLogin" TEXT NOT NULL,
  "shiftKey" TEXT NOT NULL,
  "employeeId" TEXT,
  "actualModerateHours" DOUBLE PRECISION NOT NULL,
  "shiftHours" DOUBLE PRECISION NOT NULL,
  "importBatchId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PerformanceUrRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PerformanceUrRecord_hours_check" CHECK ("actualModerateHours" >= 0 AND "actualModerateHours" < 'Infinity'::double precision AND "shiftHours" = 8)
);
CREATE UNIQUE INDEX "PerformanceUrRecord_agent_day_key" ON "PerformanceUrRecord"("importBatchId", "shiftDate", "wbLogin");
CREATE INDEX "PerformanceUrRecord_employeeId_shiftDate_idx" ON "PerformanceUrRecord"("employeeId", "shiftDate");
CREATE INDEX "PerformanceUrRecord_shiftDate_idx" ON "PerformanceUrRecord"("shiftDate");
ALTER TABLE "PerformanceUrRecord" ADD CONSTRAINT "PerformanceUrRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PerformanceUrRecord" ADD CONSTRAINT "PerformanceUrRecord_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "PerformanceImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Existing authenticated server routes enforce role and employee scope. No public Data API access.
ALTER TABLE "PerformanceUrRecord" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PerformanceUrRecord" FROM PUBLIC, anon, authenticated;
