# Codex Cloud Handoff

Use this guide to open and maintain this project in Codex Cloud.

## What This Project Needs

- Node.js with npm.
- PostgreSQL connection through `DATABASE_URL`.
- Direct migration connection through `DIRECT_URL`.
- Vercel/Supabase secrets supplied outside the repository.

## First Run In Codex Cloud

```bash
npm ci
npm run db:generate
npm run typecheck
npm run build
```

If database secrets are not available, `npm run db:generate` still works, but
database checks, migrations, and runtime paths that query Postgres should be
skipped.

## Environment Variables

Use `.env.example` as the checklist. Important groups:

- App/auth: `APP_ENV`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`.
- Database: `DATABASE_URL`, `DIRECT_URL`.
- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`.
- Real Time uploads: `REALTIME_IMPORT_TOKEN`, `REALTIME_RETENTION_DAYS`.
- Work-hour capture: `REALTIME_HOURS_AGENT_TOKEN`,
  `REALTIME_HOURS_IMPORT_TOKEN`.
- Freshdesk integrations: `CEC_FRESHDESK_API_KEY`,
  `CEC_FRESHDESK_REPORT_URL`.
- Cron/webhook protection: `CRON_SECRET`.

Do not paste actual tokens into this file or any committed source file.

## What To Avoid In Cloud

These commands are intended for local machines, not Codex Cloud:

```bash
./scripts/download-kap.sh
./scripts/download-cec-freshdesk.sh
scripts/download-kap.ps1
scripts/install-kap-task.ps1
scripts/install-cec-scheduled-report-task.ps1
agent/realtime-hours-capture/**/*
agent/work-session-agent/**/*
```

Run them only when the task is specifically about automation assets.

## Normal Validation

For code-only changes:

```bash
npm run typecheck
npm run build
```

For Prisma changes:

```bash
npm run db:generate
npm run typecheck
npm run build
```

After a migration is committed and the user asks to apply it:

```bash
npm run db:deploy
```

## Operational Notes

- Real Time data retention has a minimum window of 7 days. The
  `REALTIME_RETENTION_DAYS` variable can extend this window, but values below
  7 are clamped to 7 days.
- Performance has had parallel work from more than one Codex session. Always
  inspect current files before changing anything under Performance routes,
  services, or APIs.
- Local capture agents and scheduled downloads are deployed to separate
  Windows/Mac machines; Codex Cloud should maintain their source files only.
