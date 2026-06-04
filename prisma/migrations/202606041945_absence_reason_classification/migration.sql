ALTER TYPE "ScheduleStatus" ADD VALUE IF NOT EXISTS 'FALTA_JUSTIFICADA';
ALTER TYPE "ScheduleStatus" ADD VALUE IF NOT EXISTS 'FALTA_INJUSTIFICADA';

ALTER TABLE "AttendanceRecord"
ADD COLUMN IF NOT EXISTS "reasonClassification" TEXT;

CREATE INDEX IF NOT EXISTS "AttendanceRecord_reasonClassification_idx"
ON "AttendanceRecord"("reasonClassification");
