-- Nullable fields preserve legacy quality snapshots without inventing denominators.
ALTER TABLE "QualityRecord"
  ADD COLUMN "negativeSign" TEXT,
  ADD COLUMN "allowAmount" DOUBLE PRECISION,
  ADD COLUMN "labeledAmount" DOUBLE PRECISION;
