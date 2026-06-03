ALTER TABLE "EmployeeProfile"
ADD COLUMN IF NOT EXISTS "ethnicity" TEXT,
ADD COLUMN IF NOT EXISTS "sexualOrientation" TEXT,
ADD COLUMN IF NOT EXISTS "isCpd" TEXT,
ADD COLUMN IF NOT EXISTS "firstJob" TEXT,
ADD COLUMN IF NOT EXISTS "hasTelemarketingExperience" TEXT,
ADD COLUMN IF NOT EXISTS "telemarketingWhere" TEXT,
ADD COLUMN IF NOT EXISTS "nestingStartDate" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "goLiveDate" TIMESTAMP(3);

ALTER TABLE "EmployeeRegistrationRequest"
ADD COLUMN IF NOT EXISTS "ethnicity" TEXT,
ADD COLUMN IF NOT EXISTS "sexualOrientation" TEXT,
ADD COLUMN IF NOT EXISTS "isCpd" TEXT,
ADD COLUMN IF NOT EXISTS "firstJob" TEXT,
ADD COLUMN IF NOT EXISTS "hasTelemarketingExperience" TEXT,
ADD COLUMN IF NOT EXISTS "telemarketingWhere" TEXT,
ADD COLUMN IF NOT EXISTS "nestingStartDate" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "goLiveDate" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "EmployeeMoodRecord" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "moodScore" INTEGER NOT NULL,
  "moodLabel" TEXT NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EmployeeMoodRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeMoodRecord_employeeId_date_key" ON "EmployeeMoodRecord"("employeeId", "date");
CREATE INDEX IF NOT EXISTS "EmployeeMoodRecord_date_idx" ON "EmployeeMoodRecord"("date");
CREATE INDEX IF NOT EXISTS "EmployeeMoodRecord_moodScore_idx" ON "EmployeeMoodRecord"("moodScore");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EmployeeMoodRecord_employeeId_fkey'
  ) THEN
    ALTER TABLE "EmployeeMoodRecord"
    ADD CONSTRAINT "EmployeeMoodRecord_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EmployeeMoodRecord_userId_fkey'
  ) THEN
    ALTER TABLE "EmployeeMoodRecord"
    ADD CONSTRAINT "EmployeeMoodRecord_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
