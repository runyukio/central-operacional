ALTER TABLE "FinanceInvoiceCycleRecord"
  ADD COLUMN "trainingHoursMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PROJECAO';

CREATE INDEX "FinanceInvoiceCycleRecord_status_idx" ON "FinanceInvoiceCycleRecord"("status");
