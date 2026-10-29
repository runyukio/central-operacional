CREATE TABLE "WavePlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lobId" TEXT NOT NULL,
    "headcount" INTEGER NOT NULL,
    "trainingStartDate" DATE NOT NULL,
    "nestingStartDate" DATE NOT NULL,
    "goLiveDate" DATE NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WavePlan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WavePlan_headcount_check" CHECK ("headcount" > 0),
    CONSTRAINT "WavePlan_dates_check" CHECK ("trainingStartDate" < "nestingStartDate" AND "nestingStartDate" < "goLiveDate")
);
CREATE INDEX "WavePlan_lobId_trainingStartDate_idx" ON "WavePlan"("lobId", "trainingStartDate");
CREATE INDEX "WavePlan_goLiveDate_idx" ON "WavePlan"("goLiveDate");
ALTER TABLE "WavePlan" ADD CONSTRAINT "WavePlan_lobId_fkey" FOREIGN KEY ("lobId") REFERENCES "Lob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Waves are accessed through authenticated application routes, never the public Data API.
ALTER TABLE "WavePlan" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "WavePlan" FROM PUBLIC, anon, authenticated;
