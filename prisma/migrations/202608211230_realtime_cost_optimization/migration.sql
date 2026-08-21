-- Preserve daily Captura de Horas history before pruning high-frequency raw
-- heartbeats, and add indexes used by retention and historical lookups.

CREATE TABLE "RealTimeHoursArchiveDay" (
    "dateKey" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "calculationEnd" TIMESTAMP(3) NOT NULL,
    "sourceRecords" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RealTimeHoursArchiveDay_pkey" PRIMARY KEY ("dateKey")
);

CREATE TABLE "RealTimeHoursArchiveRow" (
    "dateKey" TEXT NOT NULL,
    "rowKey" TEXT NOT NULL,
    "employeeId" TEXT,
    "wbLoginNormalized" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RealTimeHoursArchiveRow_pkey" PRIMARY KEY ("dateKey", "rowKey")
);

ALTER TABLE "RealTimeHoursArchiveRow"
  ADD CONSTRAINT "RealTimeHoursArchiveRow_dateKey_fkey"
  FOREIGN KEY ("dateKey") REFERENCES "RealTimeHoursArchiveDay"("dateKey")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "RealTimeHoursArchiveDay_generatedAt_idx"
  ON "RealTimeHoursArchiveDay"("generatedAt");
CREATE INDEX "RealTimeHoursArchiveRow_employeeId_dateKey_idx"
  ON "RealTimeHoursArchiveRow"("employeeId", "dateKey");
CREATE INDEX "RealTimeHoursArchiveRow_wbLoginNormalized_dateKey_idx"
  ON "RealTimeHoursArchiveRow"("wbLoginNormalized", "dateKey");

CREATE INDEX IF NOT EXISTS "RealTimeRecord_createdAt_idx"
  ON "RealTimeRecord"("createdAt");
CREATE INDEX IF NOT EXISTS "RealTimeHoursImportBatch_status_capturedAt_importedAt_idx"
  ON "RealTimeHoursImportBatch"("status", "capturedAt", "importedAt");
CREATE INDEX IF NOT EXISTS "RealTimeHoursRecord_employeeId_capturedAt_idx"
  ON "RealTimeHoursRecord"("employeeId", "capturedAt");
CREATE INDEX IF NOT EXISTS "RealTimeHoursRecord_wbLogin_capturedAt_idx"
  ON "RealTimeHoursRecord"("wbLogin", "capturedAt");

ALTER TABLE "RealTimeHoursArchiveDay" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RealTimeHoursArchiveRow" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE "RealTimeHoursArchiveDay" FROM anon;
    REVOKE ALL PRIVILEGES ON TABLE "RealTimeHoursArchiveRow" FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE "RealTimeHoursArchiveDay" FROM authenticated;
    REVOKE ALL PRIVILEGES ON TABLE "RealTimeHoursArchiveRow" FROM authenticated;
  END IF;
END
$$;
