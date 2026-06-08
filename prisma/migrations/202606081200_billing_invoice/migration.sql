-- Billing/Invoice module starts at June/2026. The migration only creates
-- isolated billing structures and does not alter operational hours records.

CREATE TABLE "BillingCycle" (
    "id" TEXT NOT NULL,
    "referenceMonth" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ABERTO',
    "grossAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "adjustmentsAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "finalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalApprovedMinutes" INTEGER NOT NULL DEFAULT 0,
    "finalizedAt" TIMESTAMP(3),
    "finalizedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "sentAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingCycle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingEmployeeInvoice" (
    "id" TEXT NOT NULL,
    "billingCycleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "referenceMonth" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EM_PREVISAO',
    "approvedMinutes" INTEGER NOT NULL DEFAULT 0,
    "projectedMinutes" INTEGER NOT NULL DEFAULT 0,
    "totalConsideredMinutes" INTEGER NOT NULL DEFAULT 0,
    "hourlyRate" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "billingRule" TEXT NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "advanceAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "campaignAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "adjustmentAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "finalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "approvedByEmployeeAt" TIMESTAMP(3),
    "approvedByEmployeeUserId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingEmployeeInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingAdjustment" (
    "id" TEXT NOT NULL,
    "billingCycleId" TEXT NOT NULL,
    "employeeInvoiceId" TEXT,
    "referenceMonth" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "employeeId" TEXT,
    "lobId" TEXT,
    "observation" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BillingAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvoiceAdjustmentRequest" (
    "id" TEXT NOT NULL,
    "billingCycleId" TEXT NOT NULL,
    "employeeInvoiceId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "requestId" TEXT,
    "type" TEXT NOT NULL,
    "questionedItem" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "supervisorChecked" BOOLEAN NOT NULL DEFAULT false,
    "supervisorObservation" TEXT,
    "supervisorCheckedById" TEXT,
    "supervisorCheckedAt" TIMESTAMP(3),
    "adminDecision" TEXT,
    "adminFinalResponse" TEXT,
    "adminAdjustmentAmount" DECIMAL(12,2),
    "adminFinalMinutes" INTEGER,
    "adminDecidedById" TEXT,
    "adminDecidedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'AGUARDANDO_SUPERVISOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "InvoiceAdjustmentRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingRateConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingRateConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingCycle_referenceMonth_key" ON "BillingCycle"("referenceMonth");
CREATE INDEX "BillingCycle_referenceMonth_idx" ON "BillingCycle"("referenceMonth");
CREATE INDEX "BillingCycle_status_idx" ON "BillingCycle"("status");

CREATE UNIQUE INDEX "BillingEmployeeInvoice_billingCycleId_employeeId_key" ON "BillingEmployeeInvoice"("billingCycleId", "employeeId");
CREATE INDEX "BillingEmployeeInvoice_employeeId_referenceMonth_idx" ON "BillingEmployeeInvoice"("employeeId", "referenceMonth");
CREATE INDEX "BillingEmployeeInvoice_referenceMonth_idx" ON "BillingEmployeeInvoice"("referenceMonth");
CREATE INDEX "BillingEmployeeInvoice_status_idx" ON "BillingEmployeeInvoice"("status");
CREATE INDEX "BillingEmployeeInvoice_billingRule_idx" ON "BillingEmployeeInvoice"("billingRule");

CREATE INDEX "BillingAdjustment_billingCycleId_idx" ON "BillingAdjustment"("billingCycleId");
CREATE INDEX "BillingAdjustment_employeeInvoiceId_idx" ON "BillingAdjustment"("employeeInvoiceId");
CREATE INDEX "BillingAdjustment_employeeId_idx" ON "BillingAdjustment"("employeeId");
CREATE INDEX "BillingAdjustment_lobId_idx" ON "BillingAdjustment"("lobId");
CREATE INDEX "BillingAdjustment_referenceMonth_idx" ON "BillingAdjustment"("referenceMonth");
CREATE INDEX "BillingAdjustment_type_idx" ON "BillingAdjustment"("type");
CREATE INDEX "BillingAdjustment_deletedAt_idx" ON "BillingAdjustment"("deletedAt");

CREATE UNIQUE INDEX "InvoiceAdjustmentRequest_requestId_key" ON "InvoiceAdjustmentRequest"("requestId");
CREATE INDEX "InvoiceAdjustmentRequest_billingCycleId_idx" ON "InvoiceAdjustmentRequest"("billingCycleId");
CREATE INDEX "InvoiceAdjustmentRequest_employeeInvoiceId_idx" ON "InvoiceAdjustmentRequest"("employeeInvoiceId");
CREATE INDEX "InvoiceAdjustmentRequest_employeeId_idx" ON "InvoiceAdjustmentRequest"("employeeId");
CREATE INDEX "InvoiceAdjustmentRequest_status_idx" ON "InvoiceAdjustmentRequest"("status");
CREATE INDEX "InvoiceAdjustmentRequest_createdAt_idx" ON "InvoiceAdjustmentRequest"("createdAt");

CREATE UNIQUE INDEX "BillingRateConfig_key_key" ON "BillingRateConfig"("key");
CREATE INDEX "BillingRateConfig_active_idx" ON "BillingRateConfig"("active");
CREATE INDEX "BillingRateConfig_effectiveFrom_idx" ON "BillingRateConfig"("effectiveFrom");
CREATE INDEX "BillingRateConfig_updatedById_idx" ON "BillingRateConfig"("updatedById");

ALTER TABLE "BillingCycle" ADD CONSTRAINT "BillingCycle_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BillingCycle" ADD CONSTRAINT "BillingCycle_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BillingEmployeeInvoice" ADD CONSTRAINT "BillingEmployeeInvoice_billingCycleId_fkey" FOREIGN KEY ("billingCycleId") REFERENCES "BillingCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingEmployeeInvoice" ADD CONSTRAINT "BillingEmployeeInvoice_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingEmployeeInvoice" ADD CONSTRAINT "BillingEmployeeInvoice_approvedByEmployeeUserId_fkey" FOREIGN KEY ("approvedByEmployeeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BillingEmployeeInvoice" ADD CONSTRAINT "BillingEmployeeInvoice_reopenedById_fkey" FOREIGN KEY ("reopenedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BillingAdjustment" ADD CONSTRAINT "BillingAdjustment_billingCycleId_fkey" FOREIGN KEY ("billingCycleId") REFERENCES "BillingCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingAdjustment" ADD CONSTRAINT "BillingAdjustment_employeeInvoiceId_fkey" FOREIGN KEY ("employeeInvoiceId") REFERENCES "BillingEmployeeInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BillingAdjustment" ADD CONSTRAINT "BillingAdjustment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BillingAdjustment" ADD CONSTRAINT "BillingAdjustment_lobId_fkey" FOREIGN KEY ("lobId") REFERENCES "Lob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BillingAdjustment" ADD CONSTRAINT "BillingAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvoiceAdjustmentRequest" ADD CONSTRAINT "InvoiceAdjustmentRequest_billingCycleId_fkey" FOREIGN KEY ("billingCycleId") REFERENCES "BillingCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceAdjustmentRequest" ADD CONSTRAINT "InvoiceAdjustmentRequest_employeeInvoiceId_fkey" FOREIGN KEY ("employeeInvoiceId") REFERENCES "BillingEmployeeInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceAdjustmentRequest" ADD CONSTRAINT "InvoiceAdjustmentRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceAdjustmentRequest" ADD CONSTRAINT "InvoiceAdjustmentRequest_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvoiceAdjustmentRequest" ADD CONSTRAINT "InvoiceAdjustmentRequest_supervisorCheckedById_fkey" FOREIGN KEY ("supervisorCheckedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvoiceAdjustmentRequest" ADD CONSTRAINT "InvoiceAdjustmentRequest_adminDecidedById_fkey" FOREIGN KEY ("adminDecidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BillingRateConfig" ADD CONSTRAINT "BillingRateConfig_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
