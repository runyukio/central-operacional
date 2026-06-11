INSERT INTO "Role" ("id", "name", "label", "description", "createdAt", "updatedAt")
VALUES (
  'role_client',
  'CLIENT',
  'Cliente',
  'Visualização externa e somente leitura da aba Performance',
  NOW(),
  NOW()
)
ON CONFLICT ("name") DO UPDATE
SET
  "label" = EXCLUDED."label",
  "description" = EXCLUDED."description",
  "updatedAt" = NOW();
