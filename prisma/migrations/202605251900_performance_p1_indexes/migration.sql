CREATE INDEX IF NOT EXISTS "EmployeeProfile_roleTitle_idx" ON "EmployeeProfile"("roleTitle");

CREATE INDEX IF NOT EXISTS "Schedule_date_lobId_idx" ON "Schedule"("date", "lobId");
CREATE INDEX IF NOT EXISTS "Schedule_date_supervisorId_idx" ON "Schedule"("date", "supervisorId");
CREATE INDEX IF NOT EXISTS "Schedule_date_shiftId_idx" ON "Schedule"("date", "shiftId");

CREATE INDEX IF NOT EXISTS "Request_status_updatedAt_idx" ON "Request"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "Request_employeeId_status_createdAt_idx" ON "Request"("employeeId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "Request_typeId_status_createdAt_idx" ON "Request"("typeId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "Request_assignedArea_status_createdAt_idx" ON "Request"("assignedArea", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "MonthlyAdvanceRecord_referenceMonth_optIn_idx" ON "MonthlyAdvanceRecord"("referenceMonth", "optIn");
CREATE INDEX IF NOT EXISTS "MonthlyAdvanceRecord_referenceMonth_status_idx" ON "MonthlyAdvanceRecord"("referenceMonth", "status");

CREATE INDEX IF NOT EXISTS "Equipment_employeeId_idx" ON "Equipment"("employeeId");
CREATE INDEX IF NOT EXISTS "Equipment_status_idx" ON "Equipment"("status");
CREATE INDEX IF NOT EXISTS "Equipment_deletedAt_idx" ON "Equipment"("deletedAt");
CREATE INDEX IF NOT EXISTS "Equipment_status_updatedAt_idx" ON "Equipment"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "Equipment_deliveredAt_idx" ON "Equipment"("deliveredAt");

CREATE INDEX IF NOT EXISTS "AttendanceRecord_date_isJustified_idx" ON "AttendanceRecord"("date", "isJustified");
CREATE INDEX IF NOT EXISTS "AttendanceRecord_scheduleId_updatedAt_idx" ON "AttendanceRecord"("scheduleId", "updatedAt");

CREATE INDEX IF NOT EXISTS "WorkHourRecord_scheduleId_idx" ON "WorkHourRecord"("scheduleId");
CREATE INDEX IF NOT EXISTS "WorkHourRecord_date_status_idx" ON "WorkHourRecord"("date", "status");
