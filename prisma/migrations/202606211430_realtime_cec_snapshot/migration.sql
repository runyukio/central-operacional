-- CreateTable
CREATE TABLE "RealTimeCecSnapshot" (
    "id" TEXT NOT NULL,
    "cycleDownload" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'freshdesk-pdf',
    "fileName" TEXT NOT NULL,
    "generatedDate" TEXT,
    "totalBacklog" INTEGER NOT NULL DEFAULT 0,
    "normalBacklog" INTEGER NOT NULL DEFAULT 0,
    "p0Backlog" INTEGER NOT NULL DEFAULT 0,
    "p0L2Backlog" INTEGER NOT NULL DEFAULT 0,
    "onHoldCount" INTEGER NOT NULL DEFAULT 0,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "newCount" INTEGER NOT NULL DEFAULT 0,
    "rawData" JSONB NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RealTimeCecSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RealTimeCecSnapshot_cycleDownload_key" ON "RealTimeCecSnapshot"("cycleDownload");

-- CreateIndex
CREATE INDEX "RealTimeCecSnapshot_importedAt_idx" ON "RealTimeCecSnapshot"("importedAt");

-- CreateIndex
CREATE INDEX "RealTimeCecSnapshot_source_idx" ON "RealTimeCecSnapshot"("source");

-- CreateIndex
CREATE INDEX "RealTimeCecSnapshot_cycleDownload_idx" ON "RealTimeCecSnapshot"("cycleDownload");
