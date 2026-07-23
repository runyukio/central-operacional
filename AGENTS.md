# Codex Cloud Instructions

This repository is a Next.js operational platform backed by Prisma/PostgreSQL.
Use these instructions whenever working in Codex Cloud or any remote agent
environment.

## Setup

- Install dependencies with `npm ci`.
- Generate Prisma Client before type or build checks when needed:
  `npm run db:generate`.
- Use `npm run typecheck` for TypeScript validation.
- Use `npm run build` for production build validation.

## Environment

- Copy `.env.example` only for local development. Do not commit `.env`,
  `.env.local`, Vercel env exports, cookies, tokens, API keys, HAR files, or
  downloaded operational bases.
- Required database variables are `DATABASE_URL` and `DIRECT_URL`.
- In Codex Cloud, assume secrets are provided by the platform/environment. If
  they are missing, run non-database checks only and report what was skipped.

## Database And Prisma

- Schema lives in `prisma/schema.prisma`.
- Runtime database changes must use Prisma migrations.
- Use `npm run db:deploy` only when the user explicitly asks to deploy
  migrations to the configured database.
- Do not run destructive commands such as `prisma migrate reset`,
  `db:reset-local`, `clear:demo`, or seed scripts against production unless the
  user explicitly asks for that exact operation.

## Local Automations

This repo contains operational automations for KAP, Freshdesk/Freshchat,
Performance uploads, and Windows work-hour capture. These are not part of the
Codex Cloud runtime.

- Do not run `scripts/download-kap.*`, Freshdesk/CEC download scripts, Windows
  scheduled task installers, or workstation agents from Codex Cloud unless the
  task explicitly asks for automation work.
- Treat files under `agent/` and `scripts/*task*.ps1` as deployment assets for
  local Windows/Mac machines.
- Keep automation secrets in local machine environment variables or Vercel
  environment variables, never in source code.

## Scope And Safety

- Preserve current production behavior unless the user asks for a change.
- The user often has another Codex session working on Performance. Before
  editing Performance files, inspect the current git state and avoid
  overwriting unrelated local changes.
- Prefer small, focused commits with clear messages.
- Run `npm run typecheck` and `npm run build` before committing when the change
  touches app code.

## Deployment Targets

- GitHub `main` is the source of production deploys.
- Vercel handles Next.js builds with the package `build` script
  (`prisma generate && next build`).
- Supabase is the production PostgreSQL/Storage target when configured.

