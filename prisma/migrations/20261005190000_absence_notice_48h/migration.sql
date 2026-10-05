-- Preserve historical records without inferring the supervisor's assessment.
ALTER TABLE "AttendanceRecord" ADD COLUMN "notifiedWithin48h" BOOLEAN;
