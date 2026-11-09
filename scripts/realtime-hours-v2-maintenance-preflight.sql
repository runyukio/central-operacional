-- Read-only inventory: run before applying the single reviewed migration to V2.
SELECT current_database(), current_user,
  current_setting('shared_preload_libraries') AS preloaded;
SELECT name, default_version, installed_version
FROM pg_available_extensions WHERE name = 'pg_cron';
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'WorkstationRequestNonceV2';
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'realtime_hours_v2_hml';
SELECT to_regclass('public."_prisma_migrations"') AS prisma_history,
  to_regclass('supabase_migrations.schema_migrations') AS supabase_history;

-- Planning only: no ANALYZE, therefore no rows are deleted.
EXPLAIN (FORMAT JSON, COSTS TRUE)
WITH candidates AS (
  SELECT ctid FROM public."WorkstationRequestNonceV2"
  WHERE "expiresAt" < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '10 minutes'
  ORDER BY "expiresAt" LIMIT 5000 FOR UPDATE SKIP LOCKED
)
DELETE FROM public."WorkstationRequestNonceV2" nonce
USING candidates WHERE nonce.ctid = candidates.ctid;
