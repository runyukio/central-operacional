-- Isolated weekly quality workspace. No operational data is updated or copied.
CREATE TABLE "QualityWeeklyAsset" (
  "id" TEXT NOT NULL, "filename" TEXT NOT NULL, "objectPath" TEXT NOT NULL,
  "declaredSize" INTEGER NOT NULL, "kind" TEXT NOT NULL, "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QualityWeeklyAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QualityWeeklyAsset_size_check" CHECK ("declaredSize" > 0 AND "declaredSize" <= 10485760),
  CONSTRAINT "QualityWeeklyAsset_kind_check" CHECK ("kind" IN ('source', 'mapping'))
);
CREATE TABLE "QualityWeeklyMapping" (
  "id" TEXT NOT NULL, "assetId" TEXT NOT NULL, "digest" TEXT NOT NULL, "entries" JSONB NOT NULL,
  "createdById" TEXT NOT NULL, "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QualityWeeklyMapping_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "QualityWeeklyImport" (
  "id" TEXT NOT NULL, "assetId" TEXT NOT NULL, "mappingId" TEXT, "digest" TEXT NOT NULL,
  "sheet" TEXT NOT NULL, "dateColumn" TEXT, "validation" JSONB NOT NULL,
  "createdById" TEXT NOT NULL, "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QualityWeeklyImport_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "QualityWeeklyDraft" (
  "id" TEXT NOT NULL, "importId" TEXT NOT NULL, "snapshot" TEXT NOT NULL,
  "expectations" JSONB NOT NULL, "contentHash" TEXT NOT NULL, "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QualityWeeklyDraft_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "QualityWeeklyReport" (
  "id" TEXT NOT NULL, "weekStart" TEXT NOT NULL, "weekNumber" INTEGER NOT NULL,
  "version" INTEGER NOT NULL, "importId" TEXT NOT NULL, "snapshot" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL, "createdById" TEXT NOT NULL, "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QualityWeeklyReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QualityWeeklyReport_week_check" CHECK ("weekNumber" BETWEEN 1 AND 53 AND "version" > 0)
);
CREATE TABLE "QualityWeeklyHead" (
  "weekStart" TEXT NOT NULL, "reportId" TEXT NOT NULL,
  CONSTRAINT "QualityWeeklyHead_pkey" PRIMARY KEY ("weekStart")
);
CREATE UNIQUE INDEX "QualityWeeklyAsset_objectPath_key" ON "QualityWeeklyAsset"("objectPath");
CREATE INDEX "QualityWeeklyMapping_createdAt_id_idx" ON "QualityWeeklyMapping"("createdAt", "id");
CREATE INDEX "QualityWeeklyImport_createdAt_id_idx" ON "QualityWeeklyImport"("createdAt", "id");
CREATE UNIQUE INDEX "QualityWeeklyReport_weekStart_version_key" ON "QualityWeeklyReport"("weekStart", "version");
CREATE INDEX "QualityWeeklyReport_weekStart_createdAt_idx" ON "QualityWeeklyReport"("weekStart", "createdAt");
CREATE INDEX "QualityWeeklyReport_createdAt_id_idx" ON "QualityWeeklyReport"("createdAt", "id");
CREATE UNIQUE INDEX "QualityWeeklyHead_reportId_key" ON "QualityWeeklyHead"("reportId");
ALTER TABLE "QualityWeeklyMapping" ADD CONSTRAINT "QualityWeeklyMapping_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "QualityWeeklyAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualityWeeklyImport" ADD CONSTRAINT "QualityWeeklyImport_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "QualityWeeklyAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualityWeeklyImport" ADD CONSTRAINT "QualityWeeklyImport_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "QualityWeeklyMapping"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualityWeeklyDraft" ADD CONSTRAINT "QualityWeeklyDraft_importId_fkey" FOREIGN KEY ("importId") REFERENCES "QualityWeeklyImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualityWeeklyReport" ADD CONSTRAINT "QualityWeeklyReport_importId_fkey" FOREIGN KEY ("importId") REFERENCES "QualityWeeklyImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualityWeeklyHead" ADD CONSTRAINT "QualityWeeklyHead_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "QualityWeeklyReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only the authenticated application server accesses these tables; no browser Data API grants.
ALTER TABLE "QualityWeeklyAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "QualityWeeklyMapping" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "QualityWeeklyImport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "QualityWeeklyDraft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "QualityWeeklyReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "QualityWeeklyHead" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE "QualityWeeklyAsset", "QualityWeeklyMapping", "QualityWeeklyImport", "QualityWeeklyDraft", "QualityWeeklyReport", "QualityWeeklyHead" FROM %I', role_name);
    END IF;
  END LOOP;
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
      VALUES ('quality-weekly-reports', 'quality-weekly-reports', false, 10485760)
      ON CONFLICT (id) DO NOTHING;
    IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'quality-weekly-reports' AND public) THEN
      RAISE EXCEPTION 'Weekly Quality requires a private bucket';
    END IF;
  END IF;
END $$;
