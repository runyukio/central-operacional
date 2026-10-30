CREATE TABLE "WorkstationDeploymentGrantV2" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "codeHash" TEXT NOT NULL UNIQUE,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "centralDeliveryAllowed" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkstationDeploymentGrantV2_expiry_check"
    CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + INTERVAL '7 days')
);
ALTER TABLE "WorkstationEnrollmentCodeV2"
  ADD COLUMN "deploymentGrantId" TEXT REFERENCES "WorkstationDeploymentGrantV2"("id"),
  ADD COLUMN "boundHostname" TEXT,
  ADD COLUMN "boundWindowsUser" TEXT;
ALTER TABLE "WorkstationDeviceV2"
  ADD COLUMN "deploymentGrantId" TEXT REFERENCES "WorkstationDeploymentGrantV2"("id");
CREATE INDEX "WorkstationEnrollmentCodeV2_deploymentGrantId_idx" ON "WorkstationEnrollmentCodeV2"("deploymentGrantId");
CREATE INDEX "WorkstationDeviceV2_deploymentGrantId_idx" ON "WorkstationDeviceV2"("deploymentGrantId");
ALTER TABLE "WorkstationDeploymentGrantV2" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "WorkstationDeploymentGrantV2" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "WorkstationDeploymentGrantV2" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "WorkstationDeploymentGrantV2" FROM authenticated;
  END IF;
END $$;
