DROP INDEX IF EXISTS "QualityRecord_concatKey_key";

CREATE INDEX IF NOT EXISTS "QualityRecord_concatKey_idx" ON "QualityRecord"("concatKey");
