# ADS operational reports

Six native KIM image reports for the dedicated **Alertas ADS** group. The user approved the six real-data pilot images and requested recurring operation. Existing ADS, VIDEO, TNS and CEC deliveries are preserved.

## Dispatch (America/Sao_Paulo)

| Report | Time | Reference |
| --- | --- | --- |
| Volume, productivity, AHT | Every hour at :03 | Previous completed civil hour |
| Lateness | 09:00, 15:00, 00:00 | 08:00 morning, 14:00 afternoon, previous-day 23:00 night |
| Completed hours | 09:00, 18:00, 00:00 | Night ended 08:00, morning ended 17:00, previous-day afternoon ended 23:00 |
| Weekly staffing | 09:00, 15:00, 00:00 | Reference date through its Sunday |

Midnight weekly staffing still references the previous date and previous week. Monday 00:00 contains only the previous Sunday. The new Monday–Sunday horizon starts at Monday 09:00. Midnight hours reference the preceding afternoon; night hours retain the shift's start date across midnight.

Two authenticated GET endpoints: `/api/cron/ads-operational-alerts` (hourly) and `/api/cron/ads-shift-alerts` (shift times). Vercel cron uses UTC, so the latter is `0 3,12,18,21 * * *`. Late invocations have a bounded dispatch window. Both require the existing `CRON_SECRET`; interactive-session middleware excludes only these cron paths.

## Data and safeguards

- Productivity reuses the existing 13-checkpoint, raw-source-validated calculation. Evaluate only active ADS agents whose daily schedule and profile cover the entire hour. Positive submits below 35 **and** moderation below 45 minutes; zero submits excluded. No bottom ranking.
- AHT is total moderation / total submits, both for the current hour and the preceding 14 days, excluding the cut's date. Alert on either direction beyond 20%; at least 10 current submits, 3 historical days and 100 historical submits. No requirement for two consecutive deviations. These are the pilot parameters shown to the user.
- Known unresolved schedule conflicts are excluded through the private comma-separated server setting `ADS_OPERATIONAL_ALERT_EXCLUDED_WBS`. The setting must be explicitly supplied (it may be empty after all conflicts have been resolved). Individual WBs are never stored in this public source. No schedule or profile is modified.
- Lateness uses first valid Windows session evidence from one hour before shift start until the cut, with a five-minute pilot tolerance. It is a triage signal, never proof of arrival, absence or platform login. No capture is shown separately; divergent registration stays pending.
- Hours use the site's effective `WorkHourRecord`, the completed operational shift, existing five-minute tolerance, and existing adjustments. A record last updated before the shift ended is pending. Divergent profiles, pending adjustments and answered justifications do not become noncompliance allegations. No health/justification text is read.
- Staffing counts distinct active ADS agents in planned work slots, including approved swaps and day-off sales with valid hours. Attendance outcomes (present, late, absent) retain the original planned person; they are not a presence filter. Day-offs stay out. It does not use online presence or `StaffCoverage.plannedStaff`. Compare the same date and shift's `requiredStaff`; never offset one shift's deficit with another's surplus. Missing planning stays missing.
- Volume uses the same Executive snapshot/forecast service and the previous closed hour's bucket, with a closing collection check. Backlog is end stock, never summed. Never mix forecast/input/backlog from different hours. Volume variance is informational.
- All due reports are delivered, including a normal/no-deviation result or an explicit data-pending card. No invented cases. Images paginate without dropping agents or days.

## Delivery and production activation

Server-only **Production** environment variables:

- `ADS_OPERATIONAL_ALERTS_ENABLED=true`
- `ADS_OPERATIONAL_ALERTS_WEBHOOK_URL`: dedicated KIM robot webhook (Secret; never commit/log).
- `ADS_OPERATIONAL_ALERT_EXCLUDED_WBS`: validated private exclusion list (explicitly supplied, even if empty).
- Existing `CRON_SECRET`, database configuration and font dependencies.

The sender also requires `VERCEL_ENV=production`, so a preview cannot send. Use a Production-target build to activate, not a preview build with preview credentials. No database migration is needed. Operational source tables are read only; existing private `SystemConfig` stores delivery metadata under `ads-operational-alert:v1:<kind>:<period>`.

Claim the entire report before rendering/uploading. Upload images directly to KIM; no public image buckets or external public employee-image URLs. Complete all page uploads before the first group message. Preserve every confirmed `messageKey`. On partial/unknown delivery, retain the claim and require reconciliation in KIM; no automatic resend. Different weekly cuts (09h,15h,00h) have distinct receipts.

`?dryRun=true` with the same cron authorization reads and formats previews without creating receipts, uploading or sending. Hourly previews use the latest completed hour; shift previews use the latest scheduled shift dispatch. No arbitrary date, destination or authorization override is exposed. Production logs contain report types, period keys, statuses and counts; never names, metrics, webhook or raw provider responses.

Validate focused scheduling, eligibility, AHT, pagination, disabled preview behavior, cron authorization, concurrent/duplicate claims and partial-delivery handling. Run `npm run typecheck` and `npm run build` before release. After deployment verify auth rejection, a protected dry-run and a scheduled delivery receipt; do not trigger the sender as a health probe.
