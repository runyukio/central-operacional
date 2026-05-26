-- Add a separate organizational hierarchy link without changing operational supervisor rules.
ALTER TABLE "EmployeeProfile" ADD COLUMN "managerId" TEXT;

ALTER TABLE "EmployeeProfile"
  ADD CONSTRAINT "EmployeeProfile_managerId_fkey"
  FOREIGN KEY ("managerId")
  REFERENCES "EmployeeProfile"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "EmployeeProfile_managerId_idx" ON "EmployeeProfile"("managerId");
