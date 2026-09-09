-- Additive history. No operational schedules or justifications are changed.
CREATE TABLE "SpaceCoverageNote" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "requirementId" TEXT NOT NULL,
  "supervisorId" TEXT NOT NULL,
  "supervisorName" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "lobId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "required" INTEGER NOT NULL,
  "available" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpaceCoverageNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpaceCoverageNote_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "EmployeeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SpaceCoverageNote_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SpaceCoverageNote_text_check" CHECK (length(trim("text")) BETWEEN 5 AND 10000)
);
CREATE UNIQUE INDEX "SpaceCoverageNote_requestId_key" ON "SpaceCoverageNote"("requestId");
CREATE INDEX "SpaceCoverageNote_requirementId_supervisorId_createdAt_idx" ON "SpaceCoverageNote"("requirementId", "supervisorId", "createdAt");
CREATE INDEX "SpaceCoverageNote_supervisorId_date_idx" ON "SpaceCoverageNote"("supervisorId", "date");
CREATE INDEX "SpaceCoverageNote_actorId_idx" ON "SpaceCoverageNote"("actorId");
ALTER TABLE "SpaceCoverageNote" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "SpaceCoverageNote" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE "SpaceCoverageNote" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE "SpaceCoverageNote" FROM authenticated; END IF;
END $$;
