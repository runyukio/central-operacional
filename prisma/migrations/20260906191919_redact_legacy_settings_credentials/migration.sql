-- Preserve each historical audit event, actor, timestamp and all non-secret
-- details. Only legacy credential fields from Settings are redacted in place.
UPDATE public."AuditLog"
SET "newValue" = CASE WHEN "newValue" ? 'password'
      THEN jsonb_set("newValue", '{password}', '"[REDACTED]"'::jsonb) ELSE "newValue" END,
    "previousValue" = CASE WHEN "previousValue" ? 'securityAnswerHash'
      THEN jsonb_set(
        CASE WHEN "previousValue" ? 'passwordHash'
          THEN jsonb_set("previousValue", '{passwordHash}', '"[REDACTED]"'::jsonb) ELSE "previousValue" END,
        '{securityAnswerHash}', '"[REDACTED]"'::jsonb)
      WHEN "previousValue" ? 'passwordHash'
      THEN jsonb_set("previousValue", '{passwordHash}', '"[REDACTED]"'::jsonb)
      ELSE "previousValue" END
WHERE reason = 'Alteração em Configurações'
  AND ("newValue" ? 'password' OR "previousValue" ? 'passwordHash' OR "previousValue" ? 'securityAnswerHash');
