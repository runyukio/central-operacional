-- Create a configurable skill catalog and allow more than one skill per employee.
CREATE TABLE "OperationalSkill" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#2563EB',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalSkill_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmployeeSkillAssignment" (
    "employeeId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeSkillAssignment_pkey" PRIMARY KEY ("employeeId", "skillId")
);

CREATE UNIQUE INDEX "OperationalSkill_normalizedName_key" ON "OperationalSkill"("normalizedName");
CREATE INDEX "OperationalSkill_status_idx" ON "OperationalSkill"("status");
CREATE INDEX "OperationalSkill_name_idx" ON "OperationalSkill"("name");
CREATE INDEX "EmployeeSkillAssignment_skillId_idx" ON "EmployeeSkillAssignment"("skillId");
CREATE INDEX "EmployeeSkillAssignment_employeeId_isPrimary_idx" ON "EmployeeSkillAssignment"("employeeId", "isPrimary");
CREATE UNIQUE INDEX "EmployeeSkillAssignment_one_primary_per_employee" ON "EmployeeSkillAssignment"("employeeId") WHERE "isPrimary" = true;

ALTER TABLE "EmployeeSkillAssignment"
ADD CONSTRAINT "EmployeeSkillAssignment_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmployeeSkillAssignment"
ADD CONSTRAINT "EmployeeSkillAssignment_skillId_fkey"
FOREIGN KEY ("skillId") REFERENCES "OperationalSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve every current text skill as the employee's primary skill.
INSERT INTO "OperationalSkill" ("id", "name", "normalizedName", "description", "color", "status", "createdAt", "updatedAt")
SELECT
    'legacy_' || md5(lower(regexp_replace(translate(trim("skill"), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ', 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn'), '\s+', ' ', 'g'))),
    min(trim("skill")),
    lower(regexp_replace(translate(trim("skill"), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ', 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn'), '\s+', ' ', 'g')),
    'Migrada da skill principal existente',
    '#2563EB',
    'ACTIVE',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "EmployeeProfile"
WHERE "skill" IS NOT NULL AND trim("skill") <> ''
GROUP BY lower(regexp_replace(translate(trim("skill"), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ', 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn'), '\s+', ' ', 'g'))
ON CONFLICT ("normalizedName") DO NOTHING;

INSERT INTO "EmployeeSkillAssignment" ("employeeId", "skillId", "isPrimary", "createdAt", "updatedAt")
SELECT
    employee."id",
    skill."id",
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "EmployeeProfile" employee
JOIN "OperationalSkill" skill ON skill."normalizedName" = lower(regexp_replace(translate(trim(employee."skill"), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ', 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn'), '\s+', ' ', 'g'))
WHERE employee."skill" IS NOT NULL AND trim(employee."skill") <> ''
ON CONFLICT ("employeeId", "skillId") DO UPDATE SET "isPrimary" = true, "updatedAt" = CURRENT_TIMESTAMP;
