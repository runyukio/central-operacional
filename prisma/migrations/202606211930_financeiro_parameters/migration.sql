CREATE TABLE "FinanceCycleParameter" (
    "id" TEXT NOT NULL,
    "invoiceCycleMonth" TEXT NOT NULL,
    "costCenter" TEXT NOT NULL,
    "kwaiHourlyUsd" DECIMAL(12,4) NOT NULL DEFAULT 9.39,
    "globalHourlyUsd" DECIMAL(12,4) NOT NULL DEFAULT 5.965,
    "trainingHourlyUsd" DECIMAL(12,4) NOT NULL DEFAULT 1.45,
    "exchangeRateUsdBrl" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceCycleParameter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FinanceCycleParameter_invoiceCycleMonth_costCenter_key" ON "FinanceCycleParameter"("invoiceCycleMonth", "costCenter");
CREATE INDEX "FinanceCycleParameter_invoiceCycleMonth_idx" ON "FinanceCycleParameter"("invoiceCycleMonth");
CREATE INDEX "FinanceCycleParameter_costCenter_idx" ON "FinanceCycleParameter"("costCenter");
CREATE INDEX "FinanceCycleParameter_createdById_idx" ON "FinanceCycleParameter"("createdById");
CREATE INDEX "FinanceCycleParameter_updatedById_idx" ON "FinanceCycleParameter"("updatedById");

ALTER TABLE "FinanceCycleParameter" ADD CONSTRAINT "FinanceCycleParameter_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinanceCycleParameter" ADD CONSTRAINT "FinanceCycleParameter_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
