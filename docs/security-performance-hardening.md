# Security and performance hardening — September 2026

## Explicitly preserved behavior

- **Capture history is retained indefinitely.** The former retention task now only builds/verifies derived daily archives. It never deletes raw captures or import batches. Official hours, justifications, Billing, and Performance history are unchanged.
- Manual Performance imports continue to replace their previous dataset intentionally. No import semantics were changed.
- Existing roles retain their business permissions. Assigning/removing a Financeiro title (which carries payment privileges) is now administrator-only.
- Existing inactive route aliases remain usable. Removed UI code was unreferenced; it remains recoverable through Git.

## Changes by audit finding

| Findings | Implementation |
| --- | --- |
| S1 | Server-only public tables have RLS enabled; public/anonymous/authenticated Data API grants and schema access revoked. Server/owner and Storage/Auth access preserved. Default application-owner grants hardened. |
| S2–S3 | Signed session versions validated against current accounts. Revoked/blocked accounts fail closed. Password resets/changes use one local authority and external synchronization; concurrent legacy migration cannot overwrite a reset. |
| S4–S6 | Protected security-bearing titles; atomic account/IP limits for login, recovery and password changes. Short recovery answers remain supported. |
| S7 | Patched Next 15 branch and compatible dependency updates; no forced major framework upgrade. |
| S8 | Shared application guard and database trigger protect the last active administrator, including import paths. |
| S9 | Generic uploads derive ownership from the authenticated user, reject arbitrary entity links, persist private metadata and a success audit event atomically, and compensate storage on persistence failure. Feature-specific Billing/Mural uploads remain unchanged. |
| B1–B2 / C1 | Archive-only scheduled endpoint; source fingerprints account for late records and relevant reference changes. Incomplete legacy raw sources retain their existing archive with a visible warning. Identity corrections are resolved on read rather than rewriting raw history. |
| B3 | Both request writers share a transaction-locked numeric allocator; no count+1 or truncated lexicographic maximum. |
| B4–B5 / B8–B9 | Latest-request guards, correct clear-filter parameters, network-error recovery, and unavailable states instead of misleading zero totals. |
| B6–B7 / C5 | Complete bounded export paging. Hours export has an explicit 100,000-row safety limit and refuses partial/moving results; daily summaries avoid unnecessary queries. Anonymous feedback export does not expose private author identifiers. |
| B10 | ADS Real Time fallback uses one joined aggregate statement, skips covered intervals, and exposes an incomplete-source warning while preserving imported data on failure. |
| B11 | CEC missing-source cycles skip report delivery with a warning instead of generating an empty report. Transient provider/database outages are not treated as genuine zero productivity; no automatic retry of financial writes was added. |
| C2–C4 | Hidden Central polling paused; concurrent work deduplicated; capture snapshots bounded to four 15-second cache entries. CEC historical reads project compact summaries; external refresh is explicit/scheduled. Executive forecast caches key on date, LOB, source version and model version. |
| C6 / D1–D4 | Shared page monolith split into direct feature modules. Removed unreachable legacy UI and inert help control; APIs and route aliases retained. |
| C7 | Productivity images use numbered bounded pages, keeping every partner, skill, global KPI, ranking and scale. Sequential delivery bounds image memory; partial failures identify progress. |
| C8 | No indiscriminate index creation/deletion or compute downgrade. Additional indexes/resource changes require measured query-plan and load evidence. |
| D5 | Preserved intentionally, per explicit instruction. |

## Additional credential protection

New Settings audits redact credential fields recursively and user-save responses exclude hashes. A targeted migration redacts legacy Settings credential fields without deleting audit events, actors, timestamps, or unrelated details. Redaction cannot establish whether an earlier credential was accessed; affected credentials should be rotated as a precaution.

## Rollout and validation

- Four backwards-compatible Prisma migrations applied and verified: public API isolation, archive fingerprint, last-admin invariant, legacy credential redaction.
- 107 public tables verified with RLS enabled; zero anonymous/authenticated table grants and no anonymous public-schema access. The application's PostgreSQL connection remains readable.
- Complete automated suite: 397 passing tests; production build and TypeScript checks passed. Tests include fiscal/Omie exceptions, permissions, capture integration, exports, pagination and request lifecycle regressions.
- Local browser: login and public registration loaded without reported console errors. Protected Billing/Hours endpoints return 401 without a session. Authenticated workflows were covered by automated tests, not by impersonating a production partner.
- Eight machine-endpoint smoke checks and cron authentication review preserve token-based automation access. No reports were manually sent as part of verification.

Existing sessions require a fresh login after rollout; account security edits also revoke sessions. The Node middleware performs current-account checks rather than retaining stale cross-request permission caches.

Image/report links remain immutable public random URLs for Kim compatibility. No new public financial-document access or link-expiration policy was introduced. Delivery keys assist retries but do not guarantee exactly-once behavior at an external receiver.

Cost reduction must be measured after real traffic. Historical storage is deliberately retained; savings are expected mainly from fewer repeated calculations and reduced data transfer, not from deleting audit history or downsizing the database prematurely.
