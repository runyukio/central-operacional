-- Extend the existing isolated backend role to the new private grant table.
-- No access is added for public, anon or authenticated clients.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'realtime_hours_v2_hml') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE "WorkstationDeploymentGrantV2" TO realtime_hours_v2_hml;
    CREATE POLICY realtime_hours_v2_backend ON "WorkstationDeploymentGrantV2"
      FOR ALL TO realtime_hours_v2_hml USING (true) WITH CHECK (true);
  END IF;
END $$;
