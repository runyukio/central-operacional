ALTER TYPE "ClimateQuestionType" ADD VALUE IF NOT EXISTS 'NPS_0_10';
ALTER TYPE "AnonymousFeedbackStatus" ADD VALUE IF NOT EXISTS 'ARQUIVADO';

ALTER TABLE "ClimateSurvey"
  ADD COLUMN IF NOT EXISTS "anonymous" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "targetType" TEXT NOT NULL DEFAULT 'TODOS',
  ADD COLUMN IF NOT EXISTS "targetValue" TEXT,
  ADD COLUMN IF NOT EXISTS "createdById" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "ClimateSurvey_status_startsAt_endsAt_idx" ON "ClimateSurvey"("status", "startsAt", "endsAt");
CREATE INDEX IF NOT EXISTS "ClimateSurvey_targetType_targetValue_idx" ON "ClimateSurvey"("targetType", "targetValue");

CREATE TABLE IF NOT EXISTS "ClimateSurveyResponse" (
  "id" TEXT NOT NULL,
  "surveyId" TEXT NOT NULL,
  "respondentUserId" TEXT,
  "employeeId" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "ClimateSurveyResponse_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ClimateSurveyResponse_surveyId_fkey'
  ) THEN
    ALTER TABLE "ClimateSurveyResponse"
      ADD CONSTRAINT "ClimateSurveyResponse_surveyId_fkey"
      FOREIGN KEY ("surveyId") REFERENCES "ClimateSurvey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ClimateSurveyResponse_surveyId_respondentUserId_key" ON "ClimateSurveyResponse"("surveyId", "respondentUserId");
CREATE INDEX IF NOT EXISTS "ClimateSurveyResponse_surveyId_idx" ON "ClimateSurveyResponse"("surveyId");
CREATE INDEX IF NOT EXISTS "ClimateSurveyResponse_respondentUserId_idx" ON "ClimateSurveyResponse"("respondentUserId");
CREATE INDEX IF NOT EXISTS "ClimateSurveyResponse_employeeId_idx" ON "ClimateSurveyResponse"("employeeId");

ALTER TABLE "ClimateAnswer"
  ADD COLUMN IF NOT EXISTS "responseId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ClimateAnswer_responseId_fkey'
  ) THEN
    ALTER TABLE "ClimateAnswer"
      ADD CONSTRAINT "ClimateAnswer_responseId_fkey"
      FOREIGN KEY ("responseId") REFERENCES "ClimateSurveyResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ClimateAnswer_surveyId_respondentId_idx" ON "ClimateAnswer"("surveyId", "respondentId");
CREATE INDEX IF NOT EXISTS "ClimateAnswer_responseId_idx" ON "ClimateAnswer"("responseId");

ALTER TABLE "AnonymousFeedback"
  ADD COLUMN IF NOT EXISTS "urgency" TEXT NOT NULL DEFAULT 'MEDIA',
  ADD COLUMN IF NOT EXISTS "allowContact" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "contactUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "lobId" TEXT,
  ADD COLUMN IF NOT EXISTS "jobTitle" TEXT,
  ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resolvedById" TEXT;

CREATE INDEX IF NOT EXISTS "AnonymousFeedback_status_createdAt_idx" ON "AnonymousFeedback"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "AnonymousFeedback_category_idx" ON "AnonymousFeedback"("category");
CREATE INDEX IF NOT EXISTS "AnonymousFeedback_urgency_idx" ON "AnonymousFeedback"("urgency");
CREATE INDEX IF NOT EXISTS "AnonymousFeedback_lobId_idx" ON "AnonymousFeedback"("lobId");
