# Weekly Quality Report — ER BPO

## Scope and access

The operational site exposes `/weekly-quality-report` in Operação. The area is in English and uses the existing light/dark theme, navigation and components. All active ADMIN and WFM users are authorized, as explicitly requested. Other roles, anonymous users, deleted accounts and temporary-password sessions cannot access report APIs or downloads. Fresh database roles are checked on every request; client filters do not grant access.

This is an isolated reporting workspace. It does not replace Performance imports, queue mappings, hours, billing or operational history. RCA is excluded. The previous standalone Sites login-registration failure is not part of this deployment: existing NextAuth, Prisma, Supabase private Storage and Vercel are reused.

## Required inputs

- Expanded KwaiBI detail export, with moderation date, `质检case_order_id` and `audit_case_order_id` (IDs preserved as text).
- Approved unique mapping: `queue_id`, `queue_name`, `section` (`CD`, `ACCOUNTS`, `MATERIAL`), `industry` (`A` / `B` for Accounts; blank otherwise). A header-only CSV template is downloadable.
- Monday–Friday periods automatically detected from moderation dates, with a manual operational week number and explicit full-load confirmation for the selected and historical periods supplied.

The supplied September 8 legacy export reconciles **9,291 cases; 8,781 Correct; 182 Leakage; 44 False Positive; 284 Mislabeled; 94.51% accuracy including and 97.57% not including mislabeled cases**. It lacks the two expanded fields above and the approved mapping. Its totals are shown only as source reconciliation; no moderation dates or queue classifications are inferred. Official weekly generation remains blocked until valid inputs are supplied.

## Reused calculation and document engine

`src/lib/quality-weekly/{domain,workbook,word,charts}.ts` adapts the completed standalone implementation from `Documents/New project` without changing the requested formulas. Server validation deduplicates identical text ID pairs, detects concatenation collisions and non-result conflicts, retains summary-row control totals, reads actual Excel cells despite a bad declared dimension, validates indicators against `final_result`, and groups agents by valid ID or fallback name. Issues retain Excel row references (first 200 displayed). Missing weeks and zero denominators yield N/A, never invented zero performance. Weekly changes are percentage points.

### Result counting — rule v4 (2026-09-09)

As confirmed by the owner, accuracy follows `COUNT(DISTINCT IF(final_result = 'Correct', CONCAT(qaId, auditId), NULL)) / COUNT(DISTINCT CONCAT(qaId, auditId))`. One valid case counts once in Sampling, Allow and Labeled, and once in each outcome present for that key. A Correct occurrence counts even if another row has an error; Excel row order never selects a winning result. Result-only differences produce a warning, while different dates, agents, queues, Allow/Labeled values, malformed fields, or concatenation collisions still block generation.

Outcome categories can overlap. Error counters remain independent distinct-key counts; the existing adjusted formula `(Correct + Mislabeled) / N` is preserved, not silently replaced by a union or clamped. Source-row totals remain available for audit. Validation cards and control-total reconciliation use distinct counts when case validation succeeds. Previews and Word consume the same snapshot. Outcome sets are canonicalized so row reordering does not create a new content version. Saved reports are never recalculated; unpublished previews from earlier rule versions require a new preview before confirmation. No database migration is needed.

The same immutable calculated snapshot feeds the preview and Word. Counts are aggregated before dividing; CD and Accounts charts include a 95% target. Accounts agent detail stays inside Word; CD and Material/Unit links open the exact authenticated report version. Sources, mapping, period, rule definitions and author are preserved with each version. The reference Word supplies section order and nomenclature; landscape tables, repeated headers and native blue styling keep full detail readable. RCA and the reference document's spreadsheet error cells are deliberately omitted.

## Persistence and concurrency

### Business-week periods — rule v5 (2026-09-09)

The owner confirmed Monday–Friday for all sections. The mapping's explicit `section` defines each block and takes precedence over `category`; classification is never inferred from an operational department. Weekend rows remain in the preserved workbook and whole-source control totals, but are excluded from weekly selection and calculations. The selector shows observed business-week ranges (latest first), Friday end dates, distinct case counts, and days with cases. Sparse days do not prove an incomplete export, so full-load confirmation remains required.

The selected week and six previous calendar weeks are calculated directly from the same validated upload, using the same frozen mapping and unchanged distinct-outcome formulas. A broader upload fills history without creating six separate saved reports. Missing weeks remain N/A; weeks are not compressed around gaps. Prior manual week numbers are not guessed; previous periods are identified by dates. Historical-only changes participate in content hashing. Earlier saved snapshots and their original Sunday end dates are never modified, and older unsaved drafts require a fresh preview.

Migration `20260908183000_quality_weekly_report` adds only six QualityWeekly tables and the private `quality-weekly-reports` bucket. RLS is enabled and browser Data API grants are revoked. Files never use public URLs. Production requires the existing `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; it fails closed rather than storing reports on ephemeral local disk.

Uploads are signed server-side and sent directly to private Storage (10 MB limit), avoiding the Vercel request-body limit. Tokens cannot overwrite an existing object. Final calculation and Word chart rendering happen only on the server. Downloads recheck access and source integrity; Word is generated by POST, cached immutably, then downloaded by authenticated GET. Errors do not log workbook content or credentials.

Publishing uses a short PostgreSQL advisory-lock transaction. A draft records the active version of the selected week. Concurrent changes to that week require a refreshed preview. Historical context is frozen from the upload, so another saved week cannot change it. Repeated identical content reuses the active version; retries never reactivate an old revision. Version snapshots are canonical JSON text to preserve exact numeric values through PostgreSQL/Prisma serialization. History uses a 50-item cursor; detail sections load on demand with no polling. Rule v5 requires no database migration.

## Verification

Domain tests cover the real supplied export, duplicate and conflicting keys, precision, summary totals, denominator rules, missing fields, unmapped queues, date boundaries and Excel date systems. `service.test.ts` additionally checks a genuinely malformed XLSX dimension and access/navigation rules.

The integration test runs only when `QUALITY_QA_DATABASE_URL` targets the explicitly isolated localhost `quality_qa` database. It clears only the six report test tables in that database; **never point it at production**. It covers shared history, ownership, canonical snapshot equality, duplicate mappings/reports, concurrent publishing, independence from separately saved previous weeks, frozen mappings, cursor pagination and full Word Accounts detail. `QA_SOURCE` optionally points to the supplied export; `QUALITY_QA_OUTPUT` controls synthetic QA artifacts outside the repository.

Release checks include actual NextAuth login for ADMIN/WFM, supervisor and anonymous denial, cross-site write rejection, upload-to-Word flow in the native UI, light/dark/mobile inspection, all rendered Word pages, typecheck, lint and production build. Synthetic fixtures are never loaded into production.

### Business-week verification — 2026-09-09

The focused suite passed 52 tests with no failures; two optional real-source fixtures and the isolated PostgreSQL integration test were skipped in this run. New period tests exercise the real XLSX reader and preview service against a database stub: Monday/Friday boundaries, weekend exclusion with unchanged source reconciliation, leap days and year changes, absent historical periods, section precedence, historical-only revisions and row-order idempotency. The actual server Word renderer was tested with seven-period and legacy four-period snapshots. All three generated synthetic Word pages were visually inspected; compact chart dates prevent seven-period label overlap. The actual preview component was reviewed locally with synthetic data. Typecheck, targeted lint and production build passed. No production report or source was modified by these checks.

### Initial release — 2026-09-08

The full suite passed 621 tests, with two optional source/database tests skipped by the general invocation and then executed successfully in their dedicated runs. The 24 domain tests include the supplied real export; all three integration/access/workbook tests passed with isolated PostgreSQL. The nine-page synthetic Word and native desktop/mobile previews were inspected.

Production credentials are sensitive Vercel variables and cannot be exported by the CLI. With explicit owner authorization, the exact Prisma SQL migration was applied through Supabase's migration interface in one transaction, together with its SHA-256 entry in `_prisma_migrations`. This preserves Prisma migration tracking without exposing or changing credentials. No operational rows or real quality reports were inserted by the release.
