CREATE INDEX IF NOT EXISTS "EmployeeProfile_lobId_idx" ON "EmployeeProfile"("lobId");
CREATE INDEX IF NOT EXISTS "EmployeeProfile_teamId_idx" ON "EmployeeProfile"("teamId");
CREATE INDEX IF NOT EXISTS "EmployeeProfile_supervisorId_idx" ON "EmployeeProfile"("supervisorId");
CREATE INDEX IF NOT EXISTS "EmployeeProfile_shiftId_idx" ON "EmployeeProfile"("shiftId");
CREATE INDEX IF NOT EXISTS "EmployeeProfile_operationalStatus_idx" ON "EmployeeProfile"("operationalStatus");
CREATE INDEX IF NOT EXISTS "EmployeeProfile_deletedAt_idx" ON "EmployeeProfile"("deletedAt");

CREATE INDEX IF NOT EXISTS "Schedule_employeeId_idx" ON "Schedule"("employeeId");
CREATE INDEX IF NOT EXISTS "Schedule_lobId_idx" ON "Schedule"("lobId");
CREATE INDEX IF NOT EXISTS "Schedule_supervisorId_idx" ON "Schedule"("supervisorId");
CREATE INDEX IF NOT EXISTS "Schedule_shiftId_idx" ON "Schedule"("shiftId");
CREATE INDEX IF NOT EXISTS "Schedule_status_idx" ON "Schedule"("status");

CREATE INDEX IF NOT EXISTS "Request_requesterId_idx" ON "Request"("requesterId");
CREATE INDEX IF NOT EXISTS "Request_employeeId_idx" ON "Request"("employeeId");
CREATE INDEX IF NOT EXISTS "Request_typeId_idx" ON "Request"("typeId");
CREATE INDEX IF NOT EXISTS "Request_assigneeId_idx" ON "Request"("assigneeId");
CREATE INDEX IF NOT EXISTS "Request_status_createdAt_idx" ON "Request"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Request_priority_idx" ON "Request"("priority");
CREATE INDEX IF NOT EXISTS "Request_assignedArea_idx" ON "Request"("assignedArea");

CREATE INDEX IF NOT EXISTS "Notification_userId_isRead_createdAt_idx" ON "Notification"("userId", "isRead", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_entity_entityId_idx" ON "Notification"("entity", "entityId");

CREATE INDEX IF NOT EXISTS "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_entity_entityId_createdAt_idx" ON "AuditLog"("entity", "entityId", "createdAt");

CREATE INDEX IF NOT EXISTS "AttendanceRecord_employeeId_idx" ON "AttendanceRecord"("employeeId");
CREATE INDEX IF NOT EXISTS "AttendanceRecord_scheduleId_idx" ON "AttendanceRecord"("scheduleId");
CREATE INDEX IF NOT EXISTS "AttendanceRecord_isJustified_idx" ON "AttendanceRecord"("isJustified");
CREATE INDEX IF NOT EXISTS "AttendanceRecord_registeredById_idx" ON "AttendanceRecord"("registeredById");
CREATE INDEX IF NOT EXISTS "AttendanceRecord_justifiedById_idx" ON "AttendanceRecord"("justifiedById");
