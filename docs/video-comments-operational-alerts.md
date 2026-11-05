# VIDEO and COMMENTS operational alerts

Six reports per LOB, using the ADS dispatch calendar and calculation rules, delivered to the separate VIDEO/COMMENTS KIM robot. The user authorized recurring operation after approving the real-data tests on 2026-11-05. Existing ADS and Executive deliveries keep their current configuration.

| Reports | Brasília dispatch | Reference |
| --- | --- | --- |
| Volume, productivity, AHT | Hourly at :03 | Previous closed civil hour |
| Start of journey | 09:00, 15:00, 00:00 | Morning, afternoon, night |
| Completed hours | 09:00, 18:00, 00:00 | Last completed night, morning, afternoon |
| Required versus scheduled | 09:00, 15:00, 00:00 | Reference date through Sunday |

Midnight still references the prior operational date. Monday 00:00 shows the previous Sunday; the new week starts Monday 09:00. Actual individual VIDEO starts at 07:00/13:00/22:00 are compared with their own schedules in the corresponding 09:00/15:00/00:00 cut; agents starting after that shift's evaluation range are excluded. Hours only cover completed individual journeys in the corresponding shift.

## Sources and safeguards

- The shared ADS counter reader accepts an explicit, fixed server-side LOB. Its existing ADS callers retain the default ADS behavior. Each LOB uses thirteen five-minute checkpoints, validates raw agent counters, and requires active/matched agents and a daily/profile schedule covering the full hour. No bottom ranking.
- Productivity uses the authorized ADS rules: positive submits below 35 AND moderation below 45 minutes. Zero submits are excluded. A normal result is still delivered; no fictional cases are inserted.
- AHT compares each agent's weighted moderation/submits with the preceding fourteen days, excluding the current date. Both directions beyond 20%, minimum ten current submits, three historical days and one hundred historical submits.
- Volume uses all queues received consistently in thirteen checkpoints, known daily reset boundaries at 13:00/13:05, final backlog stock, and the canonical `loadVolumeForecastRange` source for the same LOB and hour. Missing/duplicate queues, unexpected drops and unavailable forecasts remain pending, not zero.
- Start of journey uses the first active periodic capture, including legacy heartbeats. WB must map uniquely to the employee and any explicit capture employee ID must match. It is a triage signal, never proof of arrival or absence. No capture and conflicting registration remain separate.
- Completed hours reuse effective `WorkHourRecord` values, with post-end consolidation, five-minute tolerance, adjustment and answered-justification exclusions. Individual profile/schedule conflicts remain pending.
- Weekly required compares `StaffCoverage.requiredStaff` with distinct active scheduled agents for each day and shift, retaining attendance outcomes and approved swaps/day-off sales. Missing required remains pending. No surplus offsets another shift's deficit.

## Release and delivery

Production-only server variables: `VIDEO_COMMENTS_OPERATIONAL_ALERTS_ENABLED=true`, `VIDEO_COMMENTS_OPERATIONAL_ALERTS_WEBHOOK_URL` as a Secret, and the existing `CRON_SECRET`. Preview environments cannot deliver.

Authenticated routes: `/api/cron/video-comments-operational-alerts` and `/api/cron/video-comments-shift-alerts`. Both support protected `?dryRun=true`, without uploads, receipts or messages. They expose no arbitrary dates or destination override.

Optional `VIDEO_COMMENTS_OPERATIONAL_ALERTS_VERIFY_SECRET` is a separate Production Secret for release verification. It authorizes only the latest `dryRun=true` preview. It cannot authorize real delivery; sending always requires `CRON_SECRET`.

Delivery reuses the existing direct KIM image upload and private SystemConfig receipts. Receipt namespaces are separate for ADS, VIDEO and COMMENTS; all pages of one report are uploaded before its first message. Confirmed message keys are persisted; partial or uncertain sends cannot be repeated automatically. Operational tables remain read-only; no migrations or public storage are introduced. Runtime logs contain only report kinds, periods, statuses and counts.
