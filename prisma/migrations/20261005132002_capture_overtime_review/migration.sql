BEGIN;

-- CreateEnum
CREATE TYPE "WorkHourOvertimeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "WorkHourOvertimeReview" (
    "id" TEXT NOT NULL,
    "workHourRecordId" TEXT,
    "employeeId" TEXT NOT NULL,
    "supervisorId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceFingerprint" TEXT NOT NULL,
    "sourceSnapshot" JSONB NOT NULL,
    "sourceDurationMs" INTEGER NOT NULL,
    "calculatedHours" DOUBLE PRECISION NOT NULL,
    "excessHours" DOUBLE PRECISION NOT NULL,
    "ruleLabel" TEXT NOT NULL,
    "status" "WorkHourOvertimeStatus" NOT NULL DEFAULT 'PENDING',
    "answeredById" TEXT,
    "answeredAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkHourOvertimeReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkHourOvertimeReview_workHourRecordId_key" ON "WorkHourOvertimeReview"("workHourRecordId");

-- CreateIndex
CREATE INDEX "WorkHourOvertimeReview_supervisorId_status_date_idx" ON "WorkHourOvertimeReview"("supervisorId", "status", "date");

-- CreateIndex
CREATE INDEX "WorkHourOvertimeReview_employeeId_date_idx" ON "WorkHourOvertimeReview"("employeeId", "date");

-- CreateIndex
CREATE INDEX "WorkHourOvertimeReview_status_date_idx" ON "WorkHourOvertimeReview"("status", "date");

-- AddForeignKey
ALTER TABLE "WorkHourOvertimeReview" ADD CONSTRAINT "WorkHourOvertimeReview_workHourRecordId_fkey" FOREIGN KEY ("workHourRecordId") REFERENCES "WorkHourRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkHourOvertimeReview" ADD CONSTRAINT "WorkHourOvertimeReview_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkHourOvertimeReview" ADD CONSTRAINT "WorkHourOvertimeReview_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkHourOvertimeReview" ADD CONSTRAINT "WorkHourOvertimeReview_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkHourOvertimeReview" ADD CONSTRAINT "WorkHourOvertimeReview_values_check"
CHECK ("version" > 0 AND "sourceDurationMs" >= 0 AND "calculatedHours" >= 0 AND "excessHours" >= 0);
ALTER TABLE "WorkHourOvertimeReview" ADD CONSTRAINT "WorkHourOvertimeReview_rejection_check"
CHECK ("status" <> 'REJECTED' OR length(btrim(COALESCE("rejectionReason", ''))) > 0);

-- This table is internal to the server's Prisma connection. No Data API policies
-- are granted; NextAuth and the server enforce the supervisor/management scope.
ALTER TABLE "WorkHourOvertimeReview" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "WorkHourOvertimeReview" FROM PUBLIC;

COMMIT;
