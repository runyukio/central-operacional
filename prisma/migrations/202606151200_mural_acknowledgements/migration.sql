ALTER TABLE "Announcement"
  ADD COLUMN IF NOT EXISTS "requiresAcknowledgement" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "MuralPostAcknowledgement" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "employeeId" TEXT,
  "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "roleAtAcknowledgement" TEXT NOT NULL,
  "lobIdAtAcknowledgement" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MuralPostAcknowledgement_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MuralPostAcknowledgement_postId_fkey'
  ) THEN
    ALTER TABLE "MuralPostAcknowledgement"
      ADD CONSTRAINT "MuralPostAcknowledgement_postId_fkey"
      FOREIGN KEY ("postId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MuralPostAcknowledgement_userId_fkey'
  ) THEN
    ALTER TABLE "MuralPostAcknowledgement"
      ADD CONSTRAINT "MuralPostAcknowledgement_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MuralPostAcknowledgement_employeeId_fkey'
  ) THEN
    ALTER TABLE "MuralPostAcknowledgement"
      ADD CONSTRAINT "MuralPostAcknowledgement_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "MuralPostAcknowledgement_postId_userId_key" ON "MuralPostAcknowledgement"("postId", "userId");
CREATE INDEX IF NOT EXISTS "MuralPostAcknowledgement_postId_idx" ON "MuralPostAcknowledgement"("postId");
CREATE INDEX IF NOT EXISTS "MuralPostAcknowledgement_userId_idx" ON "MuralPostAcknowledgement"("userId");
CREATE INDEX IF NOT EXISTS "MuralPostAcknowledgement_employeeId_idx" ON "MuralPostAcknowledgement"("employeeId");
CREATE INDEX IF NOT EXISTS "MuralPostAcknowledgement_acknowledgedAt_idx" ON "MuralPostAcknowledgement"("acknowledgedAt");
CREATE INDEX IF NOT EXISTS "MuralPostAcknowledgement_postId_acknowledgedAt_idx" ON "MuralPostAcknowledgement"("postId", "acknowledgedAt");
