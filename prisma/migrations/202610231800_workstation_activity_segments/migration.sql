CREATE SCHEMA IF NOT EXISTS "agent_activity";
REVOKE ALL ON SCHEMA "agent_activity" FROM PUBLIC;

CREATE TABLE IF NOT EXISTS "agent_activity"."WorkstationActivitySegment" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'direct-windows-agent',
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "hostname" TEXT NOT NULL,
  "windowsUser" TEXT,
  "wbLogin" TEXT,
  "employeeId" TEXT,
  "sourceType" TEXT NOT NULL,
  "applicationName" TEXT,
  "domain" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3) NOT NULL,
  "durationSeconds" INTEGER NOT NULL,
  "agentVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WorkstationActivitySegment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkstationActivitySegment_eventId_key" UNIQUE ("eventId"),
  CONSTRAINT "WorkstationActivitySegment_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES public."EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "WorkstationActivitySegment_sourceType_check"
    CHECK ("sourceType" IN ('WEB', 'APP', 'IDLE', 'LOCKED', 'PRIVATE', 'UNKNOWN')),
  CONSTRAINT "WorkstationActivitySegment_duration_check"
    CHECK ("durationSeconds" BETWEEN 1 AND 86400),
  CONSTRAINT "WorkstationActivitySegment_interval_check"
    CHECK ("endedAt" > "startedAt")
);

CREATE INDEX IF NOT EXISTS "WorkstationActivitySegment_employeeId_startedAt_idx"
  ON "agent_activity"."WorkstationActivitySegment"("employeeId", "startedAt");
CREATE INDEX IF NOT EXISTS "WorkstationActivitySegment_wbLogin_startedAt_idx"
  ON "agent_activity"."WorkstationActivitySegment"("wbLogin", "startedAt");
CREATE INDEX IF NOT EXISTS "WorkstationActivitySegment_hostname_startedAt_idx"
  ON "agent_activity"."WorkstationActivitySegment"("hostname", "startedAt");
CREATE INDEX IF NOT EXISTS "WorkstationActivitySegment_domain_startedAt_idx"
  ON "agent_activity"."WorkstationActivitySegment"("domain", "startedAt");
CREATE INDEX IF NOT EXISTS "WorkstationActivitySegment_sourceType_startedAt_idx"
  ON "agent_activity"."WorkstationActivitySegment"("sourceType", "startedAt");
CREATE INDEX IF NOT EXISTS "WorkstationActivitySegment_startedAt_endedAt_idx"
  ON "agent_activity"."WorkstationActivitySegment"("startedAt", "endedAt");
CREATE INDEX IF NOT EXISTS "WorkstationActivitySegment_endedAt_idx"
  ON "agent_activity"."WorkstationActivitySegment"("endedAt");

ALTER TABLE "agent_activity"."WorkstationActivitySegment" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "agent_activity"."WorkstationActivitySegment" FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA "agent_activity" FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE "agent_activity"."WorkstationActivitySegment" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA "agent_activity" FROM authenticated';
    EXECUTE 'REVOKE ALL ON TABLE "agent_activity"."WorkstationActivitySegment" FROM authenticated';
  END IF;
END $$;
