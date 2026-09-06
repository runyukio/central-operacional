-- Application tables are server-only (Prisma + NextAuth), not client Data API.
-- Keep postgres/table owners and service_role access; do not touch auth/storage.
-- Local Postgres installations do not necessarily have Supabase API roles.
DO $migration$
DECLARE
  item record;
  api_role text;
BEGIN
  -- No public-schema API is used by this application. This also protects new
  -- tables created by other owners whose default table grants remain broad.
  REVOKE ALL ON SCHEMA public FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA public TO service_role;
  END IF;
  FOR item IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', item.relname);
  END LOOP;

  REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;
  REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
  REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %I', api_role);
    END IF;
  END LOOP;
END
$migration$;
