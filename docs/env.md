# Variáveis De Ambiente

Use `.env.example` como base e nunca commite secrets reais.

## Local

```bash
APP_ENV="local"
USE_LOCAL_DB="true"
ALLOW_DEMO_LOGIN="false"
ALLOW_DEMO_DATA="false"
ALLOW_DEMO_SEED="false"
DATABASE_URL="postgresql://central:central123@localhost:5432/central_operacional?schema=public"
DIRECT_URL="postgresql://central:central123@localhost:5432/central_operacional?schema=public"
NEXT_PUBLIC_SUPABASE_URL=""
NEXT_PUBLIC_SUPABASE_ANON_KEY=""
SUPABASE_SERVICE_ROLE_KEY=""
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="central-local-secret-change-later"
```

## Preview / Staging

Use variáveis próprias no painel da Vercel em `Preview`. No MVP pode usar o mesmo Supabase, mas o recomendado futuro é ter um Supabase separado para staging.

## Production

```bash
APP_ENV="production"
ALLOW_DEMO_LOGIN="false"
ALLOW_DEMO_SEED="false"
NEXTAUTH_URL="https://central-operacional.vercel.app"
```

Configure `DATABASE_URL` com o pooler Supabase e `DIRECT_URL` com conexão direta para migrations.

## Supabase PostgreSQL

Supabase é opcional e deve ser configurado apenas quando sair do modo local.

- `DATABASE_URL`: use a connection string do Transaction Pooler para runtime/Vercel.
- `DIRECT_URL`: use a Direct connection para migrations. Se sua rede não suportar IPv6, use Session Pooler.
- Senhas com caracteres especiais precisam de URL encoding.
- Teste com `npm run db:check`, `npx prisma generate` e `npx prisma db pull`.
