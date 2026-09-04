ALTER TABLE "User"
ADD COLUMN "securityQuestion" TEXT,
ADD COLUMN "securityAnswerHash" TEXT,
ADD COLUMN "securityQuestionUpdatedAt" TIMESTAMP(3);

CREATE TABLE "PasswordRecoveryRateLimit" (
  "keyHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "windowStartedAt" TIMESTAMP(3) NOT NULL,
  "blockedUntil" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PasswordRecoveryRateLimit_pkey" PRIMARY KEY ("keyHash")
);

CREATE INDEX "PasswordRecoveryRateLimit_expiresAt_idx" ON "PasswordRecoveryRateLimit"("expiresAt");

-- These credentials are internal-only and must never be exposed through PostgREST.
ALTER TABLE "PasswordRecoveryRateLimit" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "PasswordRecoveryRateLimit" FROM anon, authenticated;
