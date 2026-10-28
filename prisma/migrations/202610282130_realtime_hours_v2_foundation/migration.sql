CREATE TABLE IF NOT EXISTS "WorkstationEnrollmentCodeV2" (
  "id" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "maxUses" INTEGER NOT NULL DEFAULT 1,
  "usedCount" INTEGER NOT NULL DEFAULT 0,
  "createdByEmail" TEXT,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkstationEnrollmentCodeV2_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkstationEnrollmentCodeV2_codeHash_key" UNIQUE ("codeHash"),
  CONSTRAINT "WorkstationEnrollmentCodeV2_usage_check" CHECK ("maxUses" > 0 AND "usedCount" >= 0 AND "usedCount" <= "maxUses")
);

CREATE TABLE IF NOT EXISTS "WorkstationDeviceV2" (
  "id" TEXT NOT NULL,
  "hostname" TEXT NOT NULL,
  "windowsUser" TEXT NOT NULL,
  "wbLogin" TEXT,
  "employeeId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "secretVersion" INTEGER NOT NULL DEFAULT 1,
  "agentVersion" TEXT,
  "extensionVersion" TEXT,
  "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkstationDeviceV2_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkstationDeviceV2_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "WorkstationDeviceV2_status_check" CHECK ("status" IN ('PENDING', 'ACTIVE', 'REVOKED', 'DISABLED')),
  CONSTRAINT "WorkstationDeviceV2_secret_version_check" CHECK ("secretVersion" > 0)
);


CREATE TABLE IF NOT EXISTS "WorkstationRequestNonceV2" (
  "deviceId" TEXT NOT NULL,
  "nonceHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkstationRequestNonceV2_pkey" PRIMARY KEY ("deviceId", "nonceHash"),
  CONSTRAINT "WorkstationRequestNonceV2_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "WorkstationDeviceV2"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "WorkstationCurrentStateV2" (
  "deviceId" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "sessionState" TEXT NOT NULL,
  "idleSeconds" INTEGER NOT NULL DEFAULT 0,
  "activeProcessName" TEXT,
  "sourceType" TEXT,
  "domain" TEXT,
  "detectionMethod" TEXT,
  "agentVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkstationCurrentStateV2_pkey" PRIMARY KEY ("deviceId"),
  CONSTRAINT "WorkstationCurrentStateV2_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "WorkstationDeviceV2"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkstationCurrentStateV2_session_check" CHECK ("sessionState" IN ('ACTIVE', 'IDLE', 'LOCKED', 'OFFLINE')),
  CONSTRAINT "WorkstationCurrentStateV2_source_check" CHECK ("sourceType" IS NULL OR "sourceType" IN ('WEB', 'APP', 'IDLE', 'LOCKED', 'PRIVATE', 'UNKNOWN')),
  CONSTRAINT "WorkstationCurrentStateV2_idle_check" CHECK ("idleSeconds" BETWEEN 0 AND 86400)
);

CREATE TABLE IF NOT EXISTS "WorkstationActivitySegmentV2" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "employeeId" TEXT,
  "wbLogin" TEXT,
  "sourceType" TEXT NOT NULL,
  "applicationName" TEXT,
  "domain" TEXT,
  "detectionMethod" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3) NOT NULL,
  "durationSeconds" INTEGER NOT NULL,
  "agentVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkstationActivitySegmentV2_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkstationActivitySegmentV2_device_event_key" UNIQUE ("deviceId", "eventId"),
  CONSTRAINT "WorkstationActivitySegmentV2_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "WorkstationDeviceV2"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkstationActivitySegmentV2_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "WorkstationActivitySegmentV2_source_check" CHECK ("sourceType" IN ('WEB', 'APP', 'IDLE', 'LOCKED', 'PRIVATE', 'UNKNOWN')),
  CONSTRAINT "WorkstationActivitySegmentV2_duration_check" CHECK ("durationSeconds" BETWEEN 1 AND 86400),
  CONSTRAINT "WorkstationActivitySegmentV2_interval_check" CHECK ("endedAt" > "startedAt"),
  CONSTRAINT "WorkstationActivitySegmentV2_domain_check" CHECK (("sourceType" = 'WEB' AND "domain" IS NOT NULL) OR ("sourceType" <> 'WEB' AND "domain" IS NULL))
);

CREATE TABLE IF NOT EXISTS "WorkstationDailySummaryV2" (
  "id" TEXT NOT NULL,
  "dateKey" DATE NOT NULL,
  "deviceId" TEXT NOT NULL,
  "employeeId" TEXT,
  "wbLogin" TEXT,
  "sourceType" TEXT NOT NULL,
  "applicationName" TEXT,
  "domain" TEXT,
  "durationSeconds" INTEGER NOT NULL DEFAULT 0,
  "segmentCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkstationDailySummaryV2_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkstationDailySummaryV2_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "WorkstationDeviceV2"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkstationDailySummaryV2_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "WorkstationDailySummaryV2_duration_check" CHECK ("durationSeconds" >= 0 AND "segmentCount" >= 0)
);

CREATE INDEX IF NOT EXISTS "WorkstationEnrollmentCodeV2_expiresAt_idx" ON "WorkstationEnrollmentCodeV2"("expiresAt");
CREATE INDEX IF NOT EXISTS "WorkstationDeviceV2_lastSeenAt_idx" ON "WorkstationDeviceV2"("lastSeenAt");
CREATE INDEX IF NOT EXISTS "WorkstationDeviceV2_wbLogin_idx" ON "WorkstationDeviceV2"("wbLogin");
CREATE UNIQUE INDEX IF NOT EXISTS "WorkstationDeviceV2_active_identity_key"
  ON "WorkstationDeviceV2"(LOWER("hostname"), LOWER("windowsUser")) WHERE "status" = 'ACTIVE';
CREATE INDEX IF NOT EXISTS "WorkstationRequestNonceV2_expiresAt_idx" ON "WorkstationRequestNonceV2"("expiresAt");
CREATE INDEX IF NOT EXISTS "WorkstationActivitySegmentV2_device_started_idx" ON "WorkstationActivitySegmentV2"("deviceId", "startedAt");
CREATE INDEX IF NOT EXISTS "WorkstationActivitySegmentV2_employee_started_idx" ON "WorkstationActivitySegmentV2"("employeeId", "startedAt");
CREATE INDEX IF NOT EXISTS "WorkstationActivitySegmentV2_domain_started_idx" ON "WorkstationActivitySegmentV2"("domain", "startedAt");
CREATE INDEX IF NOT EXISTS "WorkstationActivitySegmentV2_endedAt_idx" ON "WorkstationActivitySegmentV2"("endedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "WorkstationDailySummaryV2_bucket_key" ON "WorkstationDailySummaryV2"(
  "dateKey", "deviceId", COALESCE("employeeId", ''), COALESCE("wbLogin", ''),
  "sourceType", COALESCE("applicationName", ''), COALESCE("domain", '')
);
CREATE INDEX IF NOT EXISTS "WorkstationDailySummaryV2_date_employee_idx" ON "WorkstationDailySummaryV2"("dateKey", "employeeId");

ALTER TABLE "WorkstationEnrollmentCodeV2" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkstationDeviceV2" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkstationRequestNonceV2" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkstationCurrentStateV2" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkstationActivitySegmentV2" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkstationDailySummaryV2" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "WorkstationEnrollmentCodeV2" FROM PUBLIC;
REVOKE ALL ON TABLE "WorkstationDeviceV2" FROM PUBLIC;
REVOKE ALL ON TABLE "WorkstationRequestNonceV2" FROM PUBLIC;
REVOKE ALL ON TABLE "WorkstationCurrentStateV2" FROM PUBLIC;
REVOKE ALL ON TABLE "WorkstationActivitySegmentV2" FROM PUBLIC;
REVOKE ALL ON TABLE "WorkstationDailySummaryV2" FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE "WorkstationEnrollmentCodeV2", "WorkstationDeviceV2", "WorkstationRequestNonceV2", "WorkstationCurrentStateV2", "WorkstationActivitySegmentV2", "WorkstationDailySummaryV2" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE "WorkstationEnrollmentCodeV2", "WorkstationDeviceV2", "WorkstationRequestNonceV2", "WorkstationCurrentStateV2", "WorkstationActivitySegmentV2", "WorkstationDailySummaryV2" FROM authenticated';
  END IF;
END $$;
