DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FormalFeedbackType') THEN
    CREATE TYPE "FormalFeedbackType" AS ENUM ('POSITIVO', 'CORRETIVO');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FormalFeedbackStatus') THEN
    CREATE TYPE "FormalFeedbackStatus" AS ENUM ('PENDENTE_CIENCIA', 'VISUALIZADO', 'CIENTE', 'ARQUIVADO');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "FormalFeedback" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "authorRole" TEXT NOT NULL,
  "type" "FormalFeedbackType" NOT NULL,
  "category" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" "FormalFeedbackStatus" NOT NULL DEFAULT 'PENDENTE_CIENCIA',
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "viewedAt" TIMESTAMP(3),
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedById" TEXT,
  "employeeResponse" TEXT,
  "updatedById" TEXT,
  "archivedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FormalFeedback_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FormalFeedback_employeeId_fkey'
  ) THEN
    ALTER TABLE "FormalFeedback"
      ADD CONSTRAINT "FormalFeedback_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FormalFeedback_authorId_fkey'
  ) THEN
    ALTER TABLE "FormalFeedback"
      ADD CONSTRAINT "FormalFeedback_authorId_fkey"
      FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FormalFeedback_acknowledgedById_fkey'
  ) THEN
    ALTER TABLE "FormalFeedback"
      ADD CONSTRAINT "FormalFeedback_acknowledgedById_fkey"
      FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FormalFeedback_updatedById_fkey'
  ) THEN
    ALTER TABLE "FormalFeedback"
      ADD CONSTRAINT "FormalFeedback_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "FormalFeedback_employeeId_idx" ON "FormalFeedback"("employeeId");
CREATE INDEX IF NOT EXISTS "FormalFeedback_authorId_idx" ON "FormalFeedback"("authorId");
CREATE INDEX IF NOT EXISTS "FormalFeedback_status_idx" ON "FormalFeedback"("status");
CREATE INDEX IF NOT EXISTS "FormalFeedback_type_idx" ON "FormalFeedback"("type");
CREATE INDEX IF NOT EXISTS "FormalFeedback_category_idx" ON "FormalFeedback"("category");
CREATE INDEX IF NOT EXISTS "FormalFeedback_createdAt_idx" ON "FormalFeedback"("createdAt");
CREATE INDEX IF NOT EXISTS "FormalFeedback_employeeId_createdAt_idx" ON "FormalFeedback"("employeeId", "createdAt");
CREATE INDEX IF NOT EXISTS "FormalFeedback_status_createdAt_idx" ON "FormalFeedback"("status", "createdAt");
