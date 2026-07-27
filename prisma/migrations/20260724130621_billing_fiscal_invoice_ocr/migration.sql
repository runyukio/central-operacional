ALTER TABLE "BillingFiscalInvoice"
ADD COLUMN "accessKey" TEXT,
ADD COLUMN "documentHash" TEXT,
ADD COLUMN "extractionMethod" TEXT,
ADD COLUMN "extractedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "BillingFiscalInvoice_accessKey_key"
ON "BillingFiscalInvoice"("accessKey");

CREATE UNIQUE INDEX "BillingFiscalInvoice_documentHash_key"
ON "BillingFiscalInvoice"("documentHash");
