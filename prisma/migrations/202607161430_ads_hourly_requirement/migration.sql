CREATE TABLE IF NOT EXISTS "AdsHourlyRequirement" (
  "id" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "hour" INTEGER NOT NULL,
  "requiredStaff" INTEGER NOT NULL,
  "sourceFileName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AdsHourlyRequirement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AdsHourlyRequirement_date_hour_key"
  ON "AdsHourlyRequirement"("date", "hour");

CREATE INDEX IF NOT EXISTS "AdsHourlyRequirement_date_idx"
  ON "AdsHourlyRequirement"("date");

CREATE INDEX IF NOT EXISTS "AdsHourlyRequirement_date_hour_idx"
  ON "AdsHourlyRequirement"("date", "hour");
