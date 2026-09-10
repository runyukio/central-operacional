# Quality Report — ER BPO

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

### Single agent breakdown — rule v8 (2026-09-09)

The Word contains exactly one **Breakdown by Agent**, at the end of the report. It consolidates each agent identity across all original report sections, including Accounts and unclassified queues; the section/fila summaries and weekly charts remain unchanged. Valid IDs stay distinct even when names match; records without an ID retain the existing exact-name identity.

Agent counts are summed across the disjoint source sections and rates are recalculated from their combined numerators and denominators. The overlapping CD Sampling rollup is never added again. This replaces the repeated per-section agent tables introduced in v6. Existing saved Word versions remain immutable; create a new preview and report version for the corrected layout. No database migration or historical-data change is required.

Verification: 59 focused tests passed (three optional real-source/isolated-database checks skipped), including one-table-only, cross-section weighting and agent identity cases. Typecheck, lint and production build passed. All eight pages of the synthetic Word were visually inspected; the CD detail link stays in its section instead of producing a link-only page. No synthetic reports were inserted into production.

### CD week-over-week chart — rule v7 (2026-09-09)

Chart contract: the first chart compares the selected Monday–Friday week with the three immediately preceding weeks, as requested in the reference. Use the existing line-chart renderers in the site and Word; one point is the weighted CD rollup for the entire week, never an agent or a day. Blue/orange series show the two accuracy definitions with point labels, and a red 95% benchmark follows the supplied reference. Missing weeks remain gaps. Four points are intentional for this comparison; the full seven-period history and tables remain available and unchanged.

Week labels count back from the manually entered operation week number, honoring an explicitly stored historical number when present. If that would require zero/negative week numbers (unknown operation-calendar rollover), show the week start date instead of inventing a previous-year number. Hover details preserve exact period dates. Verify the actual preview in both themes and on mobile, and render the Word with four populated weeks to check labels and pagination. Older saved Word files remain immutable; generate a new report version for this chart.

Validation: 57 tests passed, none failed, and three optional fixture/database tests were skipped. Typecheck, lint and build passed. All eight synthetic Word pages were inspected; the first chart and legend controls were checked in the actual preview component, in light/dark themes and a 390px viewport. Metrics, source files and stored report versions were not changed for this presentation adjustment.

### CD rollup and embedded agent detail — rule v6 (2026-09-09)

The owner confirmed that CD Sampling combines exactly the explicit Recall, Material, Quick and Inspection sections. Effect, Unit, Talent, Picture, Accounts and unclassified sections are excluded from this block. A separate `cdSampling` object preserves its four section rows, weighted totals, queue detail and agent totals in the same server-calculated snapshot. Source classifications remain unchanged, and the rollup is never added to the overall Sampling Amount. Every historical CD point uses the same four-section rule.

The preview defaults to the CD section summary, with queue and consolidated-agent detail available separately. Word includes section/queue summary tables and complete agent tables for CD and every populated report section; authenticated links remain supplemental. Agents spanning several queues appear once within their section or CD rollup, with totals recalculated from their cases. Earlier saved reports and their cached Word files remain unchanged; the preview warns that a new version is needed for the corrected layout. No schema migration or production data update is required.

Validation: the focused suite passed 54 tests with no failures; two optional local workbook fixtures and the isolated PostgreSQL integration test were skipped. Typecheck, targeted lint and the production build passed. A synthetic report was rendered and all eight Word pages were visually checked, including the four CD rows, agent tables and weekly comparisons. The actual preview component was checked with synthetic data in light/dark themes and a narrow viewport; no production report was created or changed for testing.

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
