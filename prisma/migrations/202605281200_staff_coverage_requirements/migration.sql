ALTER TABLE "StaffCoverage"
  ADD COLUMN IF NOT EXISTS "observation" TEXT,
  ADD COLUMN IF NOT EXISTS "createdById" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedById" TEXT,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'StaffCoverage_createdById_fkey'
  ) THEN
    ALTER TABLE "StaffCoverage"
      ADD CONSTRAINT "StaffCoverage_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'StaffCoverage_updatedById_fkey'
  ) THEN
    ALTER TABLE "StaffCoverage"
      ADD CONSTRAINT "StaffCoverage_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "StaffCoverage_date_idx" ON "StaffCoverage"("date");
CREATE INDEX IF NOT EXISTS "StaffCoverage_lobId_idx" ON "StaffCoverage"("lobId");
CREATE INDEX IF NOT EXISTS "StaffCoverage_shiftId_idx" ON "StaffCoverage"("shiftId");
CREATE INDEX IF NOT EXISTS "StaffCoverage_date_lobId_idx" ON "StaffCoverage"("date", "lobId");
CREATE INDEX IF NOT EXISTS "StaffCoverage_date_shiftId_idx" ON "StaffCoverage"("date", "shiftId");
CREATE INDEX IF NOT EXISTS "StaffCoverage_date_lobId_shiftId_idx" ON "StaffCoverage"("date", "lobId", "shiftId");
CREATE INDEX IF NOT EXISTS "StaffCoverage_createdById_idx" ON "StaffCoverage"("createdById");
CREATE INDEX IF NOT EXISTS "StaffCoverage_updatedById_idx" ON "StaffCoverage"("updatedById");
