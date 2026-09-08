CREATE TABLE "PerformanceCecFrtRecord" (
  "id" TEXT NOT NULL,
  "ticketCreatedDay" DATE NOT NULL,
  "wbLogin" TEXT NOT NULL,
  "employeeId" TEXT,
  "priority" TEXT NOT NULL,
  "total" INTEGER NOT NULL,
  "over240" INTEGER NOT NULL,
  "over1440" INTEGER NOT NULL,
  "importBatchId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PerformanceCecFrtRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PerformanceCecFrtRecord_priority_check" CHECK ("priority" IN ('NORMAL','P0','HM')),
  CONSTRAINT "PerformanceCecFrtRecord_counts_check" CHECK ("over1440" >= 0 AND "over1440" <= "over240" AND "over240" <= "total")
);
CREATE UNIQUE INDEX "PerformanceCecFrtRecord_importBatchId_ticketCreatedDay_wbLo_key" ON "PerformanceCecFrtRecord"("importBatchId", "ticketCreatedDay", "wbLogin", "priority");
CREATE INDEX "PerformanceCecFrtRecord_ticketCreatedDay_idx" ON "PerformanceCecFrtRecord"("ticketCreatedDay");
CREATE INDEX "PerformanceCecFrtRecord_employeeId_ticketCreatedDay_idx" ON "PerformanceCecFrtRecord"("employeeId", "ticketCreatedDay");
ALTER TABLE "PerformanceCecFrtRecord" ADD CONSTRAINT "PerformanceCecFrtRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PerformanceCecFrtRecord" ADD CONSTRAINT "PerformanceCecFrtRecord_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "PerformanceImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Read and write only via the authorized server routes (Prisma), never the public Data API.
ALTER TABLE "PerformanceCecFrtRecord" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PerformanceCecFrtRecord" FROM anon, authenticated;
