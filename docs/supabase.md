# Supabase

Supabase será usado para PostgreSQL, Auth, Storage privado, backups e logs básicos.

## Banco

1. Crie o projeto Supabase.
2. Em `Project Settings > Database > Connection string`, copie a URL do Transaction Pooler para `DATABASE_URL`.
3. Em `Project Settings > Database > Connection string`, copie a URL Direct connection para `DIRECT_URL`.
4. Aplique URL encoding na senha se ela tiver caracteres especiais como `@`, `#`, `%`, `/`, `?`, `&` ou `+`.
5. Rode `npm run db:check`.
6. Rode `npm run db:deploy`.

Formato recomendado:

```bash
DATABASE_URL="postgresql://postgres.PROJECT_REF:URL_ENCODED_PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&sslmode=require"
DIRECT_URL="postgresql://postgres:URL_ENCODED_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require"
```

Se a conexão direta falhar por IPv6 no ambiente local, use a string de Session Pooler no `DIRECT_URL` durante migrations.

## Auth

Crie usuários no Supabase Auth com e-mail/senha. Para liberar acesso, o usuário também precisa existir ativo na tabela `User` da Central com `Role` adequado.

## Storage

Crie os buckets privados:

- `schedule-imports`
- `request-attachments`
- `quality-materials`
- `equipment-evidence`
- `employee-documents`
- `absence-evidence`
- `shift-report-attachments`

O endpoint `/api/files/upload` valida perfil, extensão, tamanho, entidade vinculada e registra `AuditLog`.

## Backups E Logs

Supabase Pro oferece backup diário e retenção básica de logs. A aplicação também registra `AuditLog` e `ErrorLog` para leitura operacional.
