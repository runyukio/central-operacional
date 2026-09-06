-- Archives accelerate audit queries; raw capture records are never deleted.
-- NULL marks legacy archives whose source freshness has not yet been verified.
ALTER TABLE "RealTimeHoursArchiveDay" ADD COLUMN "sourceFingerprint" TEXT;
