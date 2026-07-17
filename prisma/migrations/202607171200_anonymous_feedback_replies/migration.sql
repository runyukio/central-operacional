ALTER TABLE "AnonymousFeedback"
ADD COLUMN IF NOT EXISTS "submitterUserId" TEXT,
ADD COLUMN IF NOT EXISTS "adminResponse" TEXT,
ADD COLUMN IF NOT EXISTS "respondedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "respondedById" TEXT;

-- Identified historical feedbacks can be safely linked to their original sender.
-- Older anonymous feedbacks remain unlinked because their identity was never stored.
UPDATE "AnonymousFeedback"
SET "submitterUserId" = "contactUserId"
WHERE "submitterUserId" IS NULL
  AND "allowContact" = TRUE
  AND "contactUserId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "AnonymousFeedback_submitterUserId_createdAt_idx"
ON "AnonymousFeedback"("submitterUserId", "createdAt");
