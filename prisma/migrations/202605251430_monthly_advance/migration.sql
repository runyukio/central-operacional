CREATE TABLE "MonthlyAdvanceRecord" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "referenceMonth" TEXT NOT NULL,
  "optIn" BOOLEAN NOT NULL,
  "amount" DECIMAL(10, 2) NOT NULL,
  "hasDiscount" BOOLEAN NOT NULL DEFAULT false,
  "discountAmount" DECIMAL(10, 2),
  "discountReason" TEXT,
  "finalAmount" DECIMAL(10, 2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "observation" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MonthlyAdvanceRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MonthlyAdvanceRecord_employeeId_referenceMonth_key" ON "MonthlyAdvanceRecord"("employeeId", "referenceMonth");
CREATE INDEX "MonthlyAdvanceRecord_referenceMonth_idx" ON "MonthlyAdvanceRecord"("referenceMonth");
CREATE INDEX "MonthlyAdvanceRecord_employeeId_idx" ON "MonthlyAdvanceRecord"("employeeId");
CREATE INDEX "MonthlyAdvanceRecord_optIn_idx" ON "MonthlyAdvanceRecord"("optIn");
CREATE INDEX "MonthlyAdvanceRecord_updatedById_idx" ON "MonthlyAdvanceRecord"("updatedById");

ALTER TABLE "MonthlyAdvanceRecord"
  ADD CONSTRAINT "MonthlyAdvanceRecord_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MonthlyAdvanceRecord"
  ADD CONSTRAINT "MonthlyAdvanceRecord_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
