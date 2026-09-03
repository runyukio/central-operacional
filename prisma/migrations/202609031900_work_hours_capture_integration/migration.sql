BEGIN;

CREATE TABLE "WorkHourCaptureImportRun" (
    "id" TEXT NOT NULL,
    "startedById" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "filters" JSONB NOT NULL,
    "confirmedReprocessing" BOOLEAN NOT NULL DEFAULT false,
    "automaticRecords" INTEGER NOT NULL DEFAULT 0,
    "divergenceRecords" INTEGER NOT NULL DEFAULT 0,
    "ignoredRecords" INTEGER NOT NULL DEFAULT 0,
    "overlappingRecords" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkHourCaptureImportRun_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "WorkHourRecord" ADD COLUMN "captureReconciliationKey" TEXT;
CREATE UNIQUE INDEX "WorkHourRecord_captureReconciliationKey_key" ON "WorkHourRecord"("captureReconciliationKey");

CREATE TABLE "WorkHourCaptureDivergence" (
    "id" TEXT NOT NULL,
    "reconciliationKey" TEXT NOT NULL,
    "importRunId" TEXT,
    "employeeId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "slotKey" TEXT NOT NULL,
    "wbLogin" TEXT NOT NULL,
    "lob" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "scheduleStatus" TEXT NOT NULL,
    "plannedStart" TEXT,
    "plannedEnd" TEXT,
    "sourceDurationMs" INTEGER,
    "proposedHours" DOUBLE PRECISION,
    "reasons" JSONB NOT NULL,
    "suggestedActions" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resolutionAction" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkHourCaptureDivergence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkHourAdherenceJustification" (
    "id" TEXT NOT NULL,
    "reconciliationKey" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "supervisorId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "slotKey" TEXT NOT NULL,
    "wbLogin" TEXT NOT NULL,
    "lob" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "plannedStart" TEXT,
    "plannedEnd" TEXT,
    "sourceDurationMs" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "justification" TEXT,
    "answeredById" TEXT,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkHourAdherenceJustification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkHourCaptureDivergence_reconciliationKey_key" ON "WorkHourCaptureDivergence"("reconciliationKey");
CREATE INDEX "WorkHourCaptureDivergence_date_status_idx" ON "WorkHourCaptureDivergence"("date", "status");
CREATE INDEX "WorkHourCaptureDivergence_employeeId_date_idx" ON "WorkHourCaptureDivergence"("employeeId", "date");
CREATE INDEX "WorkHourCaptureDivergence_scheduleId_idx" ON "WorkHourCaptureDivergence"("scheduleId");
CREATE INDEX "WorkHourCaptureDivergence_importRunId_idx" ON "WorkHourCaptureDivergence"("importRunId");
CREATE INDEX "WorkHourCaptureDivergence_resolvedById_idx" ON "WorkHourCaptureDivergence"("resolvedById");

CREATE UNIQUE INDEX "WorkHourAdherenceJustification_reconciliationKey_key" ON "WorkHourAdherenceJustification"("reconciliationKey");
CREATE INDEX "WorkHourAdherenceJustification_date_status_idx" ON "WorkHourAdherenceJustification"("date", "status");
CREATE INDEX "WorkHourAdherenceJustification_employeeId_date_idx" ON "WorkHourAdherenceJustification"("employeeId", "date");
CREATE INDEX "WorkHourAdherenceJustification_supervisorId_status_date_idx" ON "WorkHourAdherenceJustification"("supervisorId", "status", "date");
CREATE INDEX "WorkHourAdherenceJustification_scheduleId_idx" ON "WorkHourAdherenceJustification"("scheduleId");
CREATE INDEX "WorkHourAdherenceJustification_answeredById_idx" ON "WorkHourAdherenceJustification"("answeredById");

CREATE INDEX "WorkHourCaptureImportRun_startedById_createdAt_idx" ON "WorkHourCaptureImportRun"("startedById", "createdAt");
CREATE INDEX "WorkHourCaptureImportRun_startDate_endDate_idx" ON "WorkHourCaptureImportRun"("startDate", "endDate");
CREATE INDEX "WorkHourCaptureImportRun_status_createdAt_idx" ON "WorkHourCaptureImportRun"("status", "createdAt");

ALTER TABLE "WorkHourCaptureImportRun" ADD CONSTRAINT "WorkHourCaptureImportRun_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkHourCaptureDivergence" ADD CONSTRAINT "WorkHourCaptureDivergence_importRunId_fkey" FOREIGN KEY ("importRunId") REFERENCES "WorkHourCaptureImportRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkHourCaptureDivergence" ADD CONSTRAINT "WorkHourCaptureDivergence_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkHourCaptureDivergence" ADD CONSTRAINT "WorkHourCaptureDivergence_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkHourCaptureDivergence" ADD CONSTRAINT "WorkHourCaptureDivergence_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkHourAdherenceJustification" ADD CONSTRAINT "WorkHourAdherenceJustification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkHourAdherenceJustification" ADD CONSTRAINT "WorkHourAdherenceJustification_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkHourAdherenceJustification" ADD CONSTRAINT "WorkHourAdherenceJustification_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkHourAdherenceJustification" ADD CONSTRAINT "WorkHourAdherenceJustification_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- These records are accessed only through the authorized Prisma server routes.
-- Do not expose import history or employee justifications through the Data API.
ALTER TABLE "WorkHourCaptureImportRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkHourCaptureDivergence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkHourAdherenceJustification" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "WorkHourCaptureImportRun", "WorkHourCaptureDivergence", "WorkHourAdherenceJustification" FROM anon, authenticated;

COMMIT;
