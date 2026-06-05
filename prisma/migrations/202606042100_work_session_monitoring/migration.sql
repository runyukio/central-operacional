CREATE TABLE "WorkSessionDevice" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "wbLogin" TEXT NOT NULL,
  "hostname" TEXT,
  "deviceFingerprint" TEXT,
  "deviceTokenHash" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "lastSeenAt" TIMESTAMP(3),
  "agentVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "WorkSessionDevice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkSessionEvent" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "eventTimestamp" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "timezone" TEXT,
  "source" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkSessionEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkSessionDailySummary" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "activeMinutes" INTEGER NOT NULL DEFAULT 0,
  "inactiveMinutes" INTEGER NOT NULL DEFAULT 0,
  "firstLoginAt" TIMESTAMP(3),
  "lastLogoutAt" TIMESTAMP(3),
  "lastEventAt" TIMESTAMP(3),
  "currentStatus" TEXT NOT NULL DEFAULT 'Desconhecido',
  "exportedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkSessionDailySummary_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkSessionDevice_employeeId_idx" ON "WorkSessionDevice"("employeeId");
CREATE INDEX "WorkSessionDevice_wbLogin_idx" ON "WorkSessionDevice"("wbLogin");
CREATE INDEX "WorkSessionDevice_status_idx" ON "WorkSessionDevice"("status");
CREATE INDEX "WorkSessionDevice_lastSeenAt_idx" ON "WorkSessionDevice"("lastSeenAt");
CREATE INDEX "WorkSessionDevice_revokedAt_idx" ON "WorkSessionDevice"("revokedAt");

CREATE INDEX "WorkSessionEvent_employeeId_eventTimestamp_idx" ON "WorkSessionEvent"("employeeId", "eventTimestamp");
CREATE INDEX "WorkSessionEvent_deviceId_eventTimestamp_idx" ON "WorkSessionEvent"("deviceId", "eventTimestamp");
CREATE INDEX "WorkSessionEvent_eventType_idx" ON "WorkSessionEvent"("eventType");
CREATE INDEX "WorkSessionEvent_eventTimestamp_idx" ON "WorkSessionEvent"("eventTimestamp");

CREATE UNIQUE INDEX "WorkSessionDailySummary_employeeId_date_key" ON "WorkSessionDailySummary"("employeeId", "date");
CREATE INDEX "WorkSessionDailySummary_employeeId_date_idx" ON "WorkSessionDailySummary"("employeeId", "date");
CREATE INDEX "WorkSessionDailySummary_date_idx" ON "WorkSessionDailySummary"("date");
CREATE INDEX "WorkSessionDailySummary_currentStatus_idx" ON "WorkSessionDailySummary"("currentStatus");
CREATE INDEX "WorkSessionDailySummary_lastEventAt_idx" ON "WorkSessionDailySummary"("lastEventAt");

ALTER TABLE "WorkSessionDevice"
  ADD CONSTRAINT "WorkSessionDevice_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkSessionEvent"
  ADD CONSTRAINT "WorkSessionEvent_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkSessionEvent"
  ADD CONSTRAINT "WorkSessionEvent_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "WorkSessionDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkSessionDailySummary"
  ADD CONSTRAINT "WorkSessionDailySummary_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkSessionDailySummary"
  ADD CONSTRAINT "WorkSessionDailySummary_exportedById_fkey"
  FOREIGN KEY ("exportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
