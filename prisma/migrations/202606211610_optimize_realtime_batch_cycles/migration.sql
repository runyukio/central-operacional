ALTER TABLE "RealTimeImportBatch"
  ADD COLUMN IF NOT EXISTS "cycleDownload" TEXT,
  ADD COLUMN IF NOT EXISTS "cycleDownloads" JSONB;

WITH summary_cycles AS (
  SELECT
    "batchId",
    array_agg(DISTINCT "cycleDownload" ORDER BY "cycleDownload" DESC) AS cycle_downloads
  FROM (
    SELECT "batchId", "cycleDownload"
    FROM "RealTimeAgentCycleSummary"
    WHERE "cycleDownload" IS NOT NULL AND "cycleDownload" <> ''
    UNION
    SELECT "batchId", "cycleDownload"
    FROM "RealTimeQueueCycleSummary"
    WHERE "cycleDownload" IS NOT NULL AND "cycleDownload" <> ''
  ) cycles
  GROUP BY "batchId"
)
UPDATE "RealTimeImportBatch" batch
SET
  "cycleDownload" = COALESCE(batch."cycleDownload", summary_cycles.cycle_downloads[1]),
  "cycleDownloads" = COALESCE(batch."cycleDownloads", to_jsonb(summary_cycles.cycle_downloads))
FROM summary_cycles
WHERE batch."id" = summary_cycles."batchId";

CREATE INDEX IF NOT EXISTS "RealTimeImportBatch_cycleDownload_idx"
  ON "RealTimeImportBatch"("cycleDownload");

CREATE INDEX IF NOT EXISTS "RealTimeImportBatch_status_importedAt_idx"
  ON "RealTimeImportBatch"("status", "importedAt");

CREATE INDEX IF NOT EXISTS "RealTimeImportBatch_status_cycleDownload_idx"
  ON "RealTimeImportBatch"("status", "cycleDownload");
