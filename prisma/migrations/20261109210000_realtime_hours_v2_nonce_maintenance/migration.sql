-- Apply only after confirming the intended V2 database. No activity/history is deleted.
-- Hosted Supabase ships/preloads pg_cron; verified as available on the V2 branch.
DO $preflight$
BEGIN
  IF to_regclass('public."WorkstationRequestNonceV2"') IS NULL
      THEN
    RAISE EXCEPTION 'V2 nonce maintenance requires the V2 nonce schema';
  END IF;
END;
$preflight$;

-- Only bounded maintenance state; never grants access to application settings.
CREATE TABLE IF NOT EXISTS public."WorkstationMaintenanceStateV2" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkstationMaintenanceStateV2_namespace_check" CHECK ("key" LIKE 'realtime-hours-v2-maintenance:%'),
  CONSTRAINT "WorkstationMaintenanceStateV2_object_check" CHECK (jsonb_typeof("value") = 'object')
);
ALTER TABLE public."WorkstationMaintenanceStateV2" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."WorkstationMaintenanceStateV2" FROM PUBLIC;
DO $runtime_access$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public."WorkstationMaintenanceStateV2" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public."WorkstationMaintenanceStateV2" FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'realtime_hours_v2_hml') THEN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'realtime_hours_v2_hml' AND (rolsuper OR rolbypassrls)) THEN
      RAISE EXCEPTION 'Maintenance runtime must not bypass RLS';
    END IF;
    GRANT SELECT, INSERT, UPDATE ON TABLE public."WorkstationMaintenanceStateV2" TO realtime_hours_v2_hml;
    DROP POLICY IF EXISTS realtime_hours_v2_maintenance_state ON public."WorkstationMaintenanceStateV2";
    CREATE POLICY realtime_hours_v2_maintenance_state ON public."WorkstationMaintenanceStateV2"
      FOR ALL TO realtime_hours_v2_hml
      USING ("key" LIKE 'realtime-hours-v2-maintenance:%')
      WITH CHECK ("key" LIKE 'realtime-hours-v2-maintenance:%');
  END IF;
END;
$runtime_access$;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
-- Use the extension creator's existing privileges. Verify the scheduled run before
-- proposing any additional permission; do not broaden access to unrelated jobs.

-- cron.schedule with the same job name updates the existing job instead of duplicating it.
SELECT cron.schedule(
  'realtime-hours-v2-nonce-cleanup',
  '* * * * *',
  $job$
    SET statement_timeout = '5s';
    SET lock_timeout = '500ms';
    WITH candidates AS (
      SELECT ctid FROM public."WorkstationRequestNonceV2"
      WHERE "expiresAt" < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '10 minutes'
      ORDER BY "expiresAt"
      LIMIT 5000
      FOR UPDATE SKIP LOCKED
    ), deleted AS (
      DELETE FROM public."WorkstationRequestNonceV2" nonce
      USING candidates WHERE nonce.ctid = candidates.ctid
      RETURNING 1
    )
    INSERT INTO public."WorkstationMaintenanceStateV2" ("key", "value", "updatedAt")
    SELECT 'realtime-hours-v2-maintenance:last:nonces-sql',
      jsonb_build_object('status', 'complete', 'at', CURRENT_TIMESTAMP, 'expiredNonces', COUNT(*),
        'batchSize', 5000, 'safetyMarginMinutes', 10, 'scheduler', 'pg_cron'),
      CURRENT_TIMESTAMP
    FROM deleted
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = CURRENT_TIMESTAMP;
    -- Retain only this job's execution history for seven days.
    DELETE FROM cron.job_run_details
    WHERE runid IN (
      SELECT details.runid FROM cron.job_run_details details
      JOIN cron.job job ON job.jobid = details.jobid
      WHERE job.jobname = 'realtime-hours-v2-nonce-cleanup'
        AND details.end_time < CURRENT_TIMESTAMP - INTERVAL '7 days'
      ORDER BY details.end_time LIMIT 1000
    );
  $job$
);
