ALTER TABLE "EmployeeProfile"
  ADD COLUMN "terminationType" TEXT,
  ADD COLUMN "terminationReason" TEXT;

CREATE INDEX IF NOT EXISTS "EmployeeProfile_terminationType_idx" ON "EmployeeProfile"("terminationType");
