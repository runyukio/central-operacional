ALTER TABLE "RealTimeHoursRecord"
  ADD COLUMN "eventId" TEXT,
  ADD COLUMN "eventType" TEXT,
  ADD COLUMN "sessionId" INTEGER,
  ADD COLUMN "sessionState" TEXT,
  ADD COLUMN "isInputActive" BOOLEAN,
  ADD COLUMN "agentVersion" TEXT;

CREATE UNIQUE INDEX "RealTimeHoursRecord_eventId_key" ON "RealTimeHoursRecord"("eventId");
CREATE INDEX "RealTimeHoursRecord_eventType_idx" ON "RealTimeHoursRecord"("eventType");
