CREATE TABLE "PerformanceManualUploadChunk" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "uploadedByEmail" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "totalChunks" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceManualUploadChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PerformanceManualUploadChunk_uploadId_fileType_chunkIndex_key"
ON "PerformanceManualUploadChunk"("uploadId", "fileType", "chunkIndex");

CREATE INDEX "PerformanceManualUploadChunk_uploadId_uploadedByEmail_idx"
ON "PerformanceManualUploadChunk"("uploadId", "uploadedByEmail");

CREATE INDEX "PerformanceManualUploadChunk_createdAt_idx"
ON "PerformanceManualUploadChunk"("createdAt");

ALTER TABLE "PerformanceManualUploadChunk" ENABLE ROW LEVEL SECURITY;
