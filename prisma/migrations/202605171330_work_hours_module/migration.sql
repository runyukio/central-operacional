-- Horas Operacionais
DO $$ BEGIN
  CREATE TYPE "WorkHourRecordStatus" AS ENUM (
    'IMPORTED',
    'OK',
    'DIVERGENT',
    'NO_SCHEDULE',
    'MISSING_WORK_HOURS',
    'ADJUSTMENT_REQUESTED',
    'ADJUSTMENT_APPROVED',
    'ADJUSTMENT_REJECTED',
    'MANUALLY_CORRECTED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "WorkHourAdjustmentStatus" AS ENUM (
    'ABERTO',
    'EM_ANALISE',
    'APROVADO',
    'RECUSADO',
    'CANCELADO'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "WorkHourImportStatus" AS ENUM (
    'IMPORTED',
    'PARTIAL',
    'FAILED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "WorkHourImportBatch" (
  "id" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "totalRows" INTEGER NOT NULL,
  "validRows" INTEGER NOT NULL,
  "errorRows" INTEGER NOT NULL,
  "warningRows" INTEGER NOT NULL DEFAULT 0,
  "createdRows" INTEGER NOT NULL DEFAULT 0,
  "updatedRows" INTEGER NOT NULL DEFAULT 0,
  "status" "WorkHourImportStatus" NOT NULL DEFAULT 'IMPORTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkHourImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WorkHourRecord" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "scheduleId" TEXT,
  "wbLogin" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "plannedStart" TEXT,
  "plannedEnd" TEXT,
  "plannedHours" DOUBLE PRECISION,
  "actualStart" TEXT,
  "actualEnd" TEXT,
  "actualHours" DOUBLE PRECISION NOT NULL,
  "adjustedStart" TEXT,
  "adjustedEnd" TEXT,
  "adjustedHours" DOUBLE PRECISION,
  "effectiveStart" TEXT,
  "effectiveEnd" TEXT,
  "effectiveHours" DOUBLE PRECISION NOT NULL,
  "differenceMinutes" INTEGER,
  "status" "WorkHourRecordStatus" NOT NULL DEFAULT 'IMPORTED',
  "source" TEXT,
  "observation" TEXT,
  "importBatchId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkHourRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WorkHourAdjustmentRequest" (
  "id" TEXT NOT NULL,
  "workHourRecordId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "approvedById" TEXT,
  "rejectedById" TEXT,
  "status" "WorkHourAdjustmentStatus" NOT NULL DEFAULT 'ABERTO',
  "currentActualStart" TEXT,
  "currentActualEnd" TEXT,
  "currentActualHours" DOUBLE PRECISION NOT NULL,
  "requestedActualStart" TEXT,
  "requestedActualEnd" TEXT,
  "requestedActualHours" DOUBLE PRECISION NOT NULL,
  "reason" TEXT NOT NULL,
  "justification" TEXT NOT NULL,
  "rejectionReason" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkHourAdjustmentRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WorkHourHistory" (
  "id" TEXT NOT NULL,
  "workHourRecordId" TEXT NOT NULL,
  "changedById" TEXT,
  "action" TEXT NOT NULL,
  "previousValue" JSONB,
  "newValue" JSONB,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkHourHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkHourRecord_employeeId_date_key" ON "WorkHourRecord"("employeeId", "date");
CREATE INDEX IF NOT EXISTS "WorkHourImportBatch_uploadedById_createdAt_idx" ON "WorkHourImportBatch"("uploadedById", "createdAt");
CREATE INDEX IF NOT EXISTS "WorkHourImportBatch_status_createdAt_idx" ON "WorkHourImportBatch"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "WorkHourRecord_employeeId_idx" ON "WorkHourRecord"("employeeId");
CREATE INDEX IF NOT EXISTS "WorkHourRecord_wbLogin_idx" ON "WorkHourRecord"("wbLogin");
CREATE INDEX IF NOT EXISTS "WorkHourRecord_date_idx" ON "WorkHourRecord"("date");
CREATE INDEX IF NOT EXISTS "WorkHourRecord_status_idx" ON "WorkHourRecord"("status");
CREATE INDEX IF NOT EXISTS "WorkHourRecord_importBatchId_idx" ON "WorkHourRecord"("importBatchId");
CREATE INDEX IF NOT EXISTS "WorkHourAdjustmentRequest_workHourRecordId_idx" ON "WorkHourAdjustmentRequest"("workHourRecordId");
CREATE INDEX IF NOT EXISTS "WorkHourAdjustmentRequest_employeeId_idx" ON "WorkHourAdjustmentRequest"("employeeId");
CREATE INDEX IF NOT EXISTS "WorkHourAdjustmentRequest_requestedById_idx" ON "WorkHourAdjustmentRequest"("requestedById");
CREATE INDEX IF NOT EXISTS "WorkHourAdjustmentRequest_status_createdAt_idx" ON "WorkHourAdjustmentRequest"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "WorkHourHistory_workHourRecordId_createdAt_idx" ON "WorkHourHistory"("workHourRecordId", "createdAt");
CREATE INDEX IF NOT EXISTS "WorkHourHistory_changedById_createdAt_idx" ON "WorkHourHistory"("changedById", "createdAt");

DO $$ BEGIN
  ALTER TABLE "WorkHourImportBatch"
    ADD CONSTRAINT "WorkHourImportBatch_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WorkHourRecord"
    ADD CONSTRAINT "WorkHourRecord_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WorkHourRecord"
    ADD CONSTRAINT "WorkHourRecord_scheduleId_fkey"
    FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WorkHourRecord"
    ADD CONSTRAINT "WorkHourRecord_importBatchId_fkey"
    FOREIGN KEY ("importBatchId") REFERENCES "WorkHourImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WorkHourAdjustmentRequest"
    ADD CONSTRAINT "WorkHourAdjustmentRequest_workHourRecordId_fkey"
    FOREIGN KEY ("workHourRecordId") REFERENCES "WorkHourRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WorkHourAdjustmentRequest"
    ADD CONSTRAINT "WorkHourAdjustmentRequest_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WorkHourAdjustmentRequest"
    ADD CONSTRAINT "WorkHourAdjustmentRequest_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WorkHourAdjustmentRequest"
    ADD CONSTRAINT "WorkHourAdjustmentRequest_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WorkHourAdjustmentRequest"
    ADD CONSTRAINT "WorkHourAdjustmentRequest_rejectedById_fkey"
    FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WorkHourHistory"
    ADD CONSTRAINT "WorkHourHistory_workHourRecordId_fkey"
    FOREIGN KEY ("workHourRecordId") REFERENCES "WorkHourRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WorkHourHistory"
    ADD CONSTRAINT "WorkHourHistory_changedById_fkey"
    FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
