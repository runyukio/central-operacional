# ADS hourly productivity alerts

Independent of the existing image reports. Runs at minute 10 of every hour in production (`/api/cron/ads-productivity-alerts`). The endpoint requires `CRON_SECRET` and returns no cached response.

## Confirmed rule

- Only matched, active/nesting ADS agents.
- **1–34 submits AND moderation duration <45 minutes in the same completed hour**. Zero-submit agents never appear, even if capture/presence is available.
- Positive interval submits prove activity; no schedule eligibility or pause/partial-shift adjustment. Capture is not used as moderation duration.
- Previous full civil hour, `America/Sao_Paulo`: at 14:10 evaluate 13:00–14:00, at 00:10 evaluate 23:00–00:00 across the date boundary.
- Read successful Real Time collections at 13 five-minute checkpoints (opening through closing). Pick the collection nearest each checkpoint, globally, within 90 seconds, before associating agents by employee ID. The half-hour cycle label is NOT the observation time: repeated imports inside that cycle have changing counters. Choosing its latest version can compare only 45 minutes. Validate each selected summary against its raw observations so missing fields cannot become zero.
- Sum the five-minute counter deltas. Preserve the established 13:00 upstream reset, including its first collection at 13:05; any other counter decrease excludes the agent as inconsistent. Midnight is not a reset. Collection clock/upload precision is approximately ±90 seconds, never interpolation or missing-to-zero.
- Missing checkpoints, unmapped identities and invalid readings do not generate a performance accusation. No backfill to stale hours, no message when nobody meets both conditions.

## KIM

The user confirmed that supervisor WB equals the KIM username and that the dedicated robot belongs to only the intended group. Supervisor association uses `EmployeeProfile.supervisorId`; the message tags that supervisor's WB using the official text syntax `<@=username(WB)=>`. No broadcast `@all`, visibility restrictions, or fallback guesses. Missing supervisor/WB is labeled explicitly.

[Official KIM documentation](https://docs.qingque.cn/d/home/eZQAp6nZHEKJ5Es5_avis9bYK?identityId=1oEGOilHO1k), sections 1.1, 2.1 and 3.3: text supports mentions; a nonempty `messageKey` confirms delivery; request body limit is 8,000 characters. Messages are grouped by supervisor and split conservatively below the limit.

Server-only Production variables:

- `ADS_PRODUCTIVITY_ALERT_ENABLED=true`
- `ADS_PRODUCTIVITY_ALERT_WEBHOOK_URL`: sensitive, dedicated KIM robot URL; never commit or log it.

## Delivery safety and verification

Existing private `SystemConfig` stores additive receipts under `ads-productivity-alert:v1:<end cycle>`. The unique key claims the entire hour before any external send, preventing concurrent invocations and corrected imports from creating duplicate alerts. Receipts contain hashes, status and provider message keys, not the webhook or individual productivity details. No schema migration or operational changes.

On timeout, rejection, unknown provider result, or partial multipage delivery the claim remains `uncertain` (or `claimed` if the process stopped). Do not automatically delete/retry it: first reconcile in KIM to avoid duplicates. A prior claim does not mean delivery succeeded. Existing image reports remain unchanged.

`GET ...?dryRun=true`, with the same cron authorization, reads and formats a preview without sending or creating receipts. It can be used even when delivery is disabled. Unauthenticated requests return 401, or 503 if the server has no cron secret. No date or destination override is exposed publicly.

Validation: `npx tsx --test src/lib/ads-productivity-alert.test.ts`, existing ADS/TNS productivity report regressions, `npm run typecheck`, `npm run build`. Live data can be checked with the protected dry-run; do not invoke the sending endpoint as a health check.
