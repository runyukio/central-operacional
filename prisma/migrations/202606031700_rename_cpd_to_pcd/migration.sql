ALTER TABLE "EmployeeProfile"
ADD COLUMN IF NOT EXISTS "isPcd" TEXT;

UPDATE "EmployeeProfile"
SET "isPcd" = COALESCE("isPcd", "isCpd")
WHERE "isCpd" IS NOT NULL;

ALTER TABLE "EmployeeProfile"
DROP COLUMN IF EXISTS "isCpd";

ALTER TABLE "EmployeeRegistrationRequest"
ADD COLUMN IF NOT EXISTS "isPcd" TEXT;

UPDATE "EmployeeRegistrationRequest"
SET "isPcd" = COALESCE("isPcd", "isCpd")
WHERE "isCpd" IS NOT NULL;

ALTER TABLE "EmployeeRegistrationRequest"
DROP COLUMN IF EXISTS "isCpd";
