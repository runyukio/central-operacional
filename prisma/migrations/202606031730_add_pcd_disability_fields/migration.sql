ALTER TABLE "EmployeeProfile"
ADD COLUMN IF NOT EXISTS "pcdDisabilityType" TEXT,
ADD COLUMN IF NOT EXISTS "pcdDisabilityOther" TEXT;

ALTER TABLE "EmployeeRegistrationRequest"
ADD COLUMN IF NOT EXISTS "pcdDisabilityType" TEXT,
ADD COLUMN IF NOT EXISTS "pcdDisabilityOther" TEXT;
