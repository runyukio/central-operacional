CREATE TABLE "RealTimeHoursIdentityMapping" (
  "id" TEXT NOT NULL,
  "hostname" TEXT NOT NULL,
  "windowsUser" TEXT NOT NULL,
  "wbLogin" TEXT NOT NULL,
  "employeeId" TEXT,
  "createdByEmail" TEXT,
  "updatedByEmail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RealTimeHoursIdentityMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RealTimeHoursIdentityMapping_hostname_windowsUser_key" ON "RealTimeHoursIdentityMapping"("hostname", "windowsUser");
CREATE INDEX "RealTimeHoursIdentityMapping_hostname_idx" ON "RealTimeHoursIdentityMapping"("hostname");
CREATE INDEX "RealTimeHoursIdentityMapping_windowsUser_idx" ON "RealTimeHoursIdentityMapping"("windowsUser");
CREATE INDEX "RealTimeHoursIdentityMapping_wbLogin_idx" ON "RealTimeHoursIdentityMapping"("wbLogin");
CREATE INDEX "RealTimeHoursIdentityMapping_employeeId_idx" ON "RealTimeHoursIdentityMapping"("employeeId");

ALTER TABLE "RealTimeHoursIdentityMapping"
  ADD CONSTRAINT "RealTimeHoursIdentityMapping_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
