INSERT INTO "Role" ("id", "name", "label", "description", "createdAt", "updatedAt")
VALUES
  (
    'role_financeiro',
    'FINANCEIRO',
    'Financeiro',
    'Acesso operacional amplo com Billing e Financeiro somente para visualização',
    NOW(),
    NOW()
  ),
  (
    'role_rta',
    'RTA',
    'Real Time Analyst',
    'Acesso ao Real Time, Captura de Horas e Necessidade',
    NOW(),
    NOW()
  ),
  (
    'role_poc',
    'POC',
    'Point of Contact',
    'Acesso ao Real Time, Captura de Horas e Necessidade',
    NOW(),
    NOW()
  )
ON CONFLICT ("name") DO UPDATE
SET
  "label" = EXCLUDED."label",
  "description" = EXCLUDED."description",
  "updatedAt" = NOW();
