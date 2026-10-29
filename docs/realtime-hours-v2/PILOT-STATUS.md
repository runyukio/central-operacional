# One-click pilot — 29 October 2026

The pilot targets `https://realtime-hours-v2-homologacao.vercel.app`, backed only by Supabase branch `bynijphqqugfedfcvczd`. Production database `qatmubxinqfctavfqgya` was not migrated. No production data was copied.

The temporary branch initially failed to replay the Supabase migration history because `PerformanceQueueRecord` was missing. An empty baseline was generated from the pinned Prisma schema, with RLS and public API privileges revoked. The six V2 tables and the install rollback migration were then applied only to this branch. A dedicated backend database role has access only to those six tables; its password remains in the branch Vault and Vercel environment variables.

The Vercel preview uses branch-specific environment variables. The public homologation alias has an alias-specific protection override so Windows agents do not need a Vercel login or a bypass credential. Production domains and project-wide protection were not changed.

The extension is CRX3 signed with a persistent ECDSA P-256 key stored outside the repository and installer. ID: `iipkmkiohkpaofneobolaacfjplgcnhm`. The public update endpoint and CRX were verified over HTTPS. The package includes one main BAT, a Windows amd64 agent, installer scripts, the signed extension, hashes and a single-use enrollment expiring in seven days. Enrollment is deleted from the extracted package after the server issues the device credential; a retained ZIP cannot reuse a consumed code.

## Verification completed

- Go unit tests with race detection, including offline queue recovery and permanent HTTP rejection.
- Go vet and Windows amd64 cross-build.
- Eleven TypeScript authentication, contract and request tests.
- TypeScript validation, ESLint, Next.js production build.
- PowerShell syntax validation on macOS (this is not an installation test).
- Live homologation enrollment, single-use rejection, signed heartbeat, signed activity, unsigned request rejection and idempotent retry. The normalized test domain was stored as exactly one `example.com` record.
- Live upgrade credential replacement and signed server rollback restoring the prior credential; disposable test credentials were revoked.
- CRX3 signature verification during packaging and published artifact hash comparison.

## Windows acceptance still pending

The user will run the pilot on a managed Windows machine and return `RealtimeHoursV2-Diagnostico.json`. Clean installation, legacy upgrade, reboot, Chrome, Edge, offline recovery, uninstall and failure injection have **not** been executed on a real Windows target. Do not label this pilot as a completed or fleet-ready release.

The installer checks for exactly one scheduled task and one persistent daemon. Native Messaging host processes are transient browser children, not extra daemons. Legacy Run/Startup entries are removed with backups. Local tasks, installation files and matching browser registry values are restored on installation failure. The signed rollback endpoint revokes a newly enrolled device and reactivates its recorded predecessor within the one-hour installation window. Remote rollback still requires connectivity; if unavailable, the warning must be reviewed before retrying. Backups remain for inspection during the pilot.

The pilot contains no global token, service-role key, database password, server master key or extension private key. A new package is required for another machine or after enrollment was consumed by an unsuccessful attempt. The original Python reference reads browser history and sends to Google Apps Script; it is not included or executed by this installer.
