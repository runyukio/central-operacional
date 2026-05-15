# Migrations

Este diretório contém uma baseline completa para banco novo:

```text
202605140000_init/migration.sql
```

Para ambiente local:

```bash
npm run db:up
npm run db:migrate
npm run db:seed
```

Para Supabase/Vercel production:

```bash
npm run db:deploy
```

A migration `202605140001_add_people_reports_attendance` foi mantida como no-op para preservar o histórico criado durante a evolução da demo; todos os modelos atuais já estão na baseline.
