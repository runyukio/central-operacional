DO $$
BEGIN
  IF to_regclass('"RealTimeFreshChatSnapshot"') IS NOT NULL THEN
    EXECUTE 'CREATE TABLE IF NOT EXISTS "RealTimeFreshChatSnapshotArchive" (LIKE "RealTimeFreshChatSnapshot" INCLUDING ALL)';
    EXECUTE 'INSERT INTO "RealTimeFreshChatSnapshotArchive" SELECT * FROM "RealTimeFreshChatSnapshot" ON CONFLICT DO NOTHING';
  END IF;
END $$;

ALTER TABLE IF EXISTS "RealTimeFreshChatSnapshotArchive" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "RealTimeFreshChatSnapshotArchive" FROM anon, authenticated;
