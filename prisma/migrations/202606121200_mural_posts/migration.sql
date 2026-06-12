ALTER TYPE "AnnouncementStatus" ADD VALUE IF NOT EXISTS 'INATIVO';

ALTER TABLE "Announcement"
  ADD COLUMN IF NOT EXISTS "contentType" TEXT NOT NULL DEFAULT 'Texto simples',
  ADD COLUMN IF NOT EXISTS "imageUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "mediaUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "externalUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "attachmentUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "targetRoles" JSONB,
  ADD COLUMN IF NOT EXISTS "targetLobIds" JSONB,
  ADD COLUMN IF NOT EXISTS "authorRole" TEXT,
  ADD COLUMN IF NOT EXISTS "priority" "Priority" NOT NULL DEFAULT 'MEDIA',
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Announcement_status_publishAt_idx" ON "Announcement"("status", "publishAt");
CREATE INDEX IF NOT EXISTS "Announcement_isPinned_priority_publishAt_idx" ON "Announcement"("isPinned", "priority", "publishAt");
CREATE INDEX IF NOT EXISTS "Announcement_expiresAt_idx" ON "Announcement"("expiresAt");
