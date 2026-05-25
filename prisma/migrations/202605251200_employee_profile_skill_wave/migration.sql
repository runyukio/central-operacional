ALTER TABLE "EmployeeProfile"
ADD COLUMN "skill" TEXT,
ADD COLUMN "wave" TEXT;

CREATE INDEX "EmployeeProfile_skill_idx" ON "EmployeeProfile"("skill");
CREATE INDEX "EmployeeProfile_wave_idx" ON "EmployeeProfile"("wave");
