CREATE TABLE "RealTimeFreshChatSnapshot" (
    "id" TEXT NOT NULL,
    "cycleDownload" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'fresh-chat',
    "fileName" TEXT NOT NULL,
    "generatedDate" TEXT,
    "assignedCount" INTEGER NOT NULL DEFAULT 0,
    "newCount" INTEGER NOT NULL DEFAULT 0,
    "totalBacklog" INTEGER NOT NULL DEFAULT 0,
    "rowsTotal" INTEGER NOT NULL DEFAULT 0,
    "rawData" JSONB NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RealTimeFreshChatSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RealTimeFreshChatSnapshot_cycleDownload_key" ON "RealTimeFreshChatSnapshot"("cycleDownload");
CREATE INDEX "RealTimeFreshChatSnapshot_importedAt_idx" ON "RealTimeFreshChatSnapshot"("importedAt");
CREATE INDEX "RealTimeFreshChatSnapshot_source_idx" ON "RealTimeFreshChatSnapshot"("source");
CREATE INDEX "RealTimeFreshChatSnapshot_cycleDownload_idx" ON "RealTimeFreshChatSnapshot"("cycleDownload");
