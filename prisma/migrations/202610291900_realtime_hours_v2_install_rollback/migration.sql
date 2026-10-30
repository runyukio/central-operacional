ALTER TABLE "WorkstationDeviceV2" ADD COLUMN IF NOT EXISTS "replacedByDeviceId" TEXT;
CREATE INDEX IF NOT EXISTS "WorkstationDeviceV2_replacedByDeviceId_idx" ON "WorkstationDeviceV2"("replacedByDeviceId");
