-- Indexes added from Supabase Query Performance findings.
-- They match high-volume date/deletedAt/status and employee/date access paths.
CREATE INDEX IF NOT EXISTS "Schedule_date_deletedAt_idx" ON "Schedule"("date", "deletedAt");
CREATE INDEX IF NOT EXISTS "Schedule_deletedAt_idx" ON "Schedule"("deletedAt");

CREATE INDEX IF NOT EXISTS "AttendanceRecord_employeeId_date_idx" ON "AttendanceRecord"("employeeId", "date");
CREATE INDEX IF NOT EXISTS "AttendanceRecord_scheduleId_isJustified_idx" ON "AttendanceRecord"("scheduleId", "isJustified");

CREATE INDEX IF NOT EXISTS "WorkHourRecord_date_employeeId_idx" ON "WorkHourRecord"("date", "employeeId");
