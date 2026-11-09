ALTER TABLE "WorkstationDeploymentGrantV2"
  DROP CONSTRAINT "WorkstationDeploymentGrantV2_expiry_check",
  ALTER COLUMN "expiresAt" DROP NOT NULL;
ALTER TABLE "WorkstationDeploymentGrantV2"
  ADD CONSTRAINT "WorkstationDeploymentGrantV2_expiry_check"
  CHECK ("expiresAt" IS NULL OR "expiresAt" > "createdAt");
