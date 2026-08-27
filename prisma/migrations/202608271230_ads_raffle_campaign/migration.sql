CREATE TABLE "RaffleCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minNumber" INTEGER NOT NULL DEFAULT 1,
    "maxNumber" INTEGER NOT NULL DEFAULT 10000,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RaffleCampaign_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RaffleCampaign_number_range_check" CHECK ("minNumber" >= 1 AND "maxNumber" <= 10000 AND "maxNumber" >= "minNumber"),
    CONSTRAINT "RaffleCampaign_status_check" CHECK ("status" IN ('ACTIVE', 'CLOSED'))
);

CREATE TABLE "RaffleDistribution" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "ticketsPerEmployee" INTEGER NOT NULL,
    "employeeCount" INTEGER NOT NULL,
    "totalTickets" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaffleDistribution_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RaffleDistribution_quantity_check" CHECK ("ticketsPerEmployee" > 0 AND "employeeCount" > 0 AND "totalTickets" = "ticketsPerEmployee" * "employeeCount")
);

CREATE TABLE "RaffleTicketAssignment" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "distributionId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaffleTicketAssignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RaffleTicketAssignment_number_check" CHECK ("number" BETWEEN 1 AND 10000)
);

CREATE INDEX "RaffleCampaign_status_createdAt_idx" ON "RaffleCampaign"("status", "createdAt");
CREATE INDEX "RaffleCampaign_createdById_idx" ON "RaffleCampaign"("createdById");
CREATE UNIQUE INDEX "RaffleDistribution_idempotencyKey_key" ON "RaffleDistribution"("idempotencyKey");
CREATE INDEX "RaffleDistribution_campaignId_createdAt_idx" ON "RaffleDistribution"("campaignId", "createdAt");
CREATE INDEX "RaffleDistribution_assignedById_idx" ON "RaffleDistribution"("assignedById");
CREATE UNIQUE INDEX "RaffleTicketAssignment_campaignId_number_key" ON "RaffleTicketAssignment"("campaignId", "number");
CREATE INDEX "RaffleTicketAssignment_employeeId_campaignId_idx" ON "RaffleTicketAssignment"("employeeId", "campaignId");
CREATE INDEX "RaffleTicketAssignment_distributionId_idx" ON "RaffleTicketAssignment"("distributionId");
CREATE INDEX "RaffleTicketAssignment_assignedById_idx" ON "RaffleTicketAssignment"("assignedById");

ALTER TABLE "RaffleCampaign" ADD CONSTRAINT "RaffleCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RaffleDistribution" ADD CONSTRAINT "RaffleDistribution_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "RaffleCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RaffleDistribution" ADD CONSTRAINT "RaffleDistribution_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RaffleTicketAssignment" ADD CONSTRAINT "RaffleTicketAssignment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "RaffleCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RaffleTicketAssignment" ADD CONSTRAINT "RaffleTicketAssignment_distributionId_fkey" FOREIGN KEY ("distributionId") REFERENCES "RaffleDistribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RaffleTicketAssignment" ADD CONSTRAINT "RaffleTicketAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RaffleTicketAssignment" ADD CONSTRAINT "RaffleTicketAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RaffleCampaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RaffleDistribution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RaffleTicketAssignment" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE "RaffleCampaign", "RaffleDistribution", "RaffleTicketAssignment" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE "RaffleCampaign", "RaffleDistribution", "RaffleTicketAssignment" FROM authenticated';
  END IF;
END
$$;
