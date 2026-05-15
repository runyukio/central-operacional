# Deploy

## Local

```bash
npm install
cp .env.example .env
npm run db:up
npm run db:generate
npm run db:check
npm run db:migrate
npm run db:seed
npm run dev
```

O modo local usa Postgres via Docker, NextAuth com usuários do banco local e uploads em `storage/local`.

## Preview

Abra um Pull Request ou push em branch que não seja `main`. A Vercel cria um preview automático.

## Production

```bash
npm run db:check
npm run db:deploy
npm run build
```

Na Vercel, o build command já executa `prisma generate && next build`.

## Pós-Deploy

Verifique login, RBAC, cadastros, upload Excel, escala, ausência, solicitações, report de turno, notificações, audit logs, storage privado e link final.
