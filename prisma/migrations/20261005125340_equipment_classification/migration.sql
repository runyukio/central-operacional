-- CreateEnum
CREATE TYPE "EquipmentUsage" AS ENUM ('AGENTE', 'STAFF', 'TREINAMENTO');

-- AlterTable
ALTER TABLE "Equipment" ADD COLUMN     "lobId" TEXT,
ADD COLUMN     "usage" "EquipmentUsage";

-- CreateIndex
CREATE INDEX "Equipment_lobId_idx" ON "Equipment"("lobId");

-- CreateIndex
CREATE INDEX "Equipment_usage_idx" ON "Equipment"("usage");

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_lobId_fkey" FOREIGN KEY ("lobId") REFERENCES "Lob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
