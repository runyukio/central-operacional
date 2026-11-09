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

## Existing production activity page

The user requested that the installed workstation's real activity appear at `https://eastriverbrasil.com/captura-horas/atividade`, using the structure already present there. The V2 activity receiver can now deliver a compatibility projection through the existing production `agent-activity` importer, preserving its identity resolution, authorization and retention behavior. No production schema migration, duplicate page or workstation reinstall is required.

Delivery is disabled by default and enabled only for an explicit device allowlist; synthetic test devices are excluded. Server authentication uses the existing server-side importer environment variable, never a workstation package or browser response. The destination is fixed to the existing Central endpoint and redirects are rejected. Only normalized domains, applications and intervals are sent. Event IDs include the V2 device ID, so retries and historical replay update the same rows. A successful V2 response requires Central to acknowledge every forwarded record; temporary failures keep the workstation queue available for retry.

The device-authenticated `central-sync` endpoint replays only that device's stored last-seven-day records, in bounded batches. It is used to recover the activity collected before delivery was enabled. Production data is read back through the existing table to verify domain, interval and idempotency. The pilot's device remains enrolled in homologation; only its explicitly authorized activity is delivered to the existing production page.

## Existing Captura de Horas presence integration

V2 heartbeats can now reach the established production `agent-snapshot` importer through an independently switchable, device-allowlisted server bridge. It uses the original presence/history tables, manual hostname/user-to-WB mapping and existing hour calculations. The workstation credential, task, executable and installation remain unchanged.

ACTIVE maps to active/input-active; IDLE, LOCKED and OFFLINE remain inactive with their actual state and measured idle seconds. The last input timestamp is derived from the actual capture timestamp and measured idle seconds. No domain, page title or client-supplied employee identity is added to presence records. The existing production mapping resolves WB/employee identity; the pilot has no manual WB mapping and therefore retains `eastriver`, as in its legacy records.

A stable event ID is derived from device ID and canonical capture timestamp. Inserted and duplicate acknowledgements are both accepted. The legacy importer's row-error count may be cumulative for its shared batch; delivery is checked against this request's inserted/duplicate counts, while discarded or incomplete acknowledgements fail. A temporary failure returns 503 so the existing agent queue retries. Rollback is scoped to disabling the presence bridge for this pilot; activity delivery and other stations are independent.

The device-authenticated `central-presence-sync` endpoint forwards only the most recent state actually stored for that device. Earlier heartbeats were not retained by the V2 current-state store, so missing historical presence is not synthesized from browser activity. Five-minute cadence and the original timeline gap/extrapolation rules are unchanged. Tests cover the mapping, deterministic identity, duplicate response, discard handling and the existing presence/hour calculation regression suite.
