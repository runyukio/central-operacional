ALTER TABLE "BillingFiscalInvoice"
  ADD COLUMN "omieStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "omieIntegrationCode" TEXT,
  ADD COLUMN "omieLaunchCode" TEXT,
  ADD COLUMN "omieSupplierCode" TEXT,
  ADD COLUMN "omieSyncedAt" TIMESTAMP(3),
  ADD COLUMN "omieLastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "omieLastError" TEXT,
  ADD COLUMN "omieAttempts" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "BillingFiscalInvoice_omieIntegrationCode_key"
  ON "BillingFiscalInvoice"("omieIntegrationCode");

CREATE INDEX "BillingFiscalInvoice_omieStatus_idx"
  ON "BillingFiscalInvoice"("omieStatus");

CREATE INDEX "BillingFiscalInvoice_omieSyncedAt_idx"
  ON "BillingFiscalInvoice"("omieSyncedAt");
