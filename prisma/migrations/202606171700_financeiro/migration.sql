CREATE TABLE "FinanceUploadBatch" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowsTotal" INTEGER NOT NULL DEFAULT 0,
    "rowsValid" INTEGER NOT NULL DEFAULT 0,
    "rowsError" INTEGER NOT NULL DEFAULT 0,
    "rowsInserted" INTEGER NOT NULL DEFAULT 0,
    "rowsUpdated" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "errorSummary" JSONB,

    CONSTRAINT "FinanceUploadBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinanceInvoiceCycleRecord" (
    "id" TEXT NOT NULL,
    "invoiceCycleMonth" TEXT NOT NULL,
    "costCenter" TEXT NOT NULL,
    "maxHoursCapacityMinutes" INTEGER NOT NULL DEFAULT 0,
    "billableHoursTargetMinutes" INTEGER NOT NULL DEFAULT 0,
    "billableHoursActualMinutes" INTEGER NOT NULL DEFAULT 0,
    "adherencePercent" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "differenceMinutes" INTEGER NOT NULL DEFAULT 0,
    "penaltyPercent" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "source" TEXT,
    "uploadBatchId" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceInvoiceCycleRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinanceAdjustment" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "adjustmentType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FinanceInvoiceCycleRecord_invoiceCycleMonth_costCenter_key" ON "FinanceInvoiceCycleRecord"("invoiceCycleMonth", "costCenter");
CREATE INDEX "FinanceUploadBatch_uploadedAt_idx" ON "FinanceUploadBatch"("uploadedAt");
CREATE INDEX "FinanceUploadBatch_uploadedById_idx" ON "FinanceUploadBatch"("uploadedById");
CREATE INDEX "FinanceUploadBatch_status_idx" ON "FinanceUploadBatch"("status");
CREATE INDEX "FinanceInvoiceCycleRecord_invoiceCycleMonth_idx" ON "FinanceInvoiceCycleRecord"("invoiceCycleMonth");
CREATE INDEX "FinanceInvoiceCycleRecord_costCenter_idx" ON "FinanceInvoiceCycleRecord"("costCenter");
CREATE INDEX "FinanceInvoiceCycleRecord_uploadBatchId_idx" ON "FinanceInvoiceCycleRecord"("uploadBatchId");
CREATE INDEX "FinanceInvoiceCycleRecord_createdById_idx" ON "FinanceInvoiceCycleRecord"("createdById");
CREATE INDEX "FinanceInvoiceCycleRecord_updatedById_idx" ON "FinanceInvoiceCycleRecord"("updatedById");
CREATE INDEX "FinanceAdjustment_recordId_idx" ON "FinanceAdjustment"("recordId");
CREATE INDEX "FinanceAdjustment_createdById_idx" ON "FinanceAdjustment"("createdById");
CREATE INDEX "FinanceAdjustment_fieldName_idx" ON "FinanceAdjustment"("fieldName");
CREATE INDEX "FinanceAdjustment_createdAt_idx" ON "FinanceAdjustment"("createdAt");

ALTER TABLE "FinanceUploadBatch" ADD CONSTRAINT "FinanceUploadBatch_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinanceInvoiceCycleRecord" ADD CONSTRAINT "FinanceInvoiceCycleRecord_uploadBatchId_fkey" FOREIGN KEY ("uploadBatchId") REFERENCES "FinanceUploadBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinanceInvoiceCycleRecord" ADD CONSTRAINT "FinanceInvoiceCycleRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinanceInvoiceCycleRecord" ADD CONSTRAINT "FinanceInvoiceCycleRecord_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinanceAdjustment" ADD CONSTRAINT "FinanceAdjustment_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "FinanceInvoiceCycleRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinanceAdjustment" ADD CONSTRAINT "FinanceAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
