-- The web application writes through Prisma using the database owner. Browser
-- roles must not read or mutate employee availability data through PostgREST.
ALTER TABLE "RealTimeHoursImportBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RealTimeHoursRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RealTimeHoursIdentityMapping" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE "RealTimeHoursImportBatch" FROM anon;
    REVOKE ALL PRIVILEGES ON TABLE "RealTimeHoursRecord" FROM anon;
    REVOKE ALL PRIVILEGES ON TABLE "RealTimeHoursIdentityMapping" FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE "RealTimeHoursImportBatch" FROM authenticated;
    REVOKE ALL PRIVILEGES ON TABLE "RealTimeHoursRecord" FROM authenticated;
    REVOKE ALL PRIVILEGES ON TABLE "RealTimeHoursIdentityMapping" FROM authenticated;
  END IF;
END
$$;

CREATE INDEX "RealTimeHoursRecord_hostname_windowsUser_capturedAt_idx"
  ON "RealTimeHoursRecord"("hostname", "windowsUser", "capturedAt");
