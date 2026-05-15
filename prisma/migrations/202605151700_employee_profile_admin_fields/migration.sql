ALTER TABLE "EmployeeProfile"
  ADD COLUMN "socialName" TEXT,
  ADD COLUMN "primaryPhone" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "stateUf" TEXT,
  ADD COLUMN "preferredSchedule" TEXT,
  ADD COLUMN "trainingStartDate" TIMESTAMP(3),
  ADD COLUMN "contractType" TEXT,
  ADD COLUMN "siteOperation" TEXT,
  ADD COLUMN "internalNotes" TEXT;
