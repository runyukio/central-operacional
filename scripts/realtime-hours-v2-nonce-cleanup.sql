-- One bounded cleanup pass, after read-only EXPLAIN approval on the V2 database.
-- Identical expiry condition/order/limit as the scheduled Prisma migration.
-- No historical activity, device registrations or current states are touched.
SET statement_timeout = '5s';
SET lock_timeout = '500ms';
WITH candidates AS (
  SELECT ctid FROM public."WorkstationRequestNonceV2"
  WHERE "expiresAt" < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '10 minutes'
  ORDER BY "expiresAt" LIMIT 5000 FOR UPDATE SKIP LOCKED
), deleted AS (
  DELETE FROM public."WorkstationRequestNonceV2" nonce
  USING candidates WHERE nonce.ctid = candidates.ctid RETURNING 1
)
INSERT INTO public."WorkstationMaintenanceStateV2" ("key", "value", "updatedAt")
SELECT 'realtime-hours-v2-maintenance:last:nonces-sql',
  jsonb_build_object('status', 'complete', 'at', CURRENT_TIMESTAMP, 'expiredNonces', COUNT(*),
    'batchSize', 5000, 'safetyMarginMinutes', 10, 'scheduler', 'manual-reviewed-pass'),
  CURRENT_TIMESTAMP
FROM deleted
ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = CURRENT_TIMESTAMP
RETURNING "value";
