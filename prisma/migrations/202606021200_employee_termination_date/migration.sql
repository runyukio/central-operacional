ALTER TABLE "EmployeeProfile"
  ADD COLUMN "terminationDate" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "EmployeeProfile_terminationDate_idx" ON "EmployeeProfile"("terminationDate");
