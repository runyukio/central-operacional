CREATE TABLE "ShiftReportTimeBlock" (
  "id" TEXT NOT NULL,
  "shiftReportId" TEXT NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT,
  "durationMinutes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ShiftReportTimeBlock_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShiftReportTimeBlock_shiftReportId_idx" ON "ShiftReportTimeBlock"("shiftReportId");
CREATE INDEX "ShiftReportTimeBlock_category_idx" ON "ShiftReportTimeBlock"("category");

ALTER TABLE "ShiftReportTimeBlock"
  ADD CONSTRAINT "ShiftReportTimeBlock_shiftReportId_fkey"
  FOREIGN KEY ("shiftReportId") REFERENCES "ShiftReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
