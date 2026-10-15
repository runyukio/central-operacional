# Real Time cycle monitor

Production cron checks queues and agents independently every minute. An alert
fires only when the last successful import for that feed is more than 20 minutes
old (exactly 20 minutes is still healthy). Freshness uses the batch importedAt
timestamp, ordered by latest successful import, rather than the :00/:30 cycle
label. Reimporting an older cycle refreshes this import watchdog. Cycle labels
ahead of the clock do not cause an alert when the import is recent. Missing or
invalid import timestamps are reported separately. Messages show the last import
time in America/Sao_Paulo and the received cycle for reference.

Server configuration: `REALTIME_CYCLE_MONITOR_ENABLED=true`, secret
`REALTIME_CYCLE_MONITOR_KIM_URL`, existing `CRON_SECRET`. KIM only, mentioning
`wb_lucasy`. Native Buzz is not implemented. No email is sent.

GET `/api/cron/realtime-cycle-monitor` requires Bearer CRON_SECRET. Add
`?dryRun=true` for a read-only check. POST to the same route sends a clearly
labelled test and requires an `Idempotency-Key` (8–80 alphanumeric/_/- characters).
Reusing the same key never resends the test. Test sends do not change incidents.
When `REALTIME_CYCLE_MONITOR_TEST_SECRET` is set, tests and dry runs require that
separate Bearer secret instead. It cannot authorize live scheduled checks.

Private SystemConfig entries under `realtime-cycle-monitor:v1:` hold incident
state and delivery receipts. A database transaction/advisory lock claims each
event before sending. Continuous failure creates only one alert per feed;
normalization creates a recovery notification. Uncertain/claimed deliveries
are not automatically retried: inspect KIM and private receipts before any
manual resend. This favors avoiding duplicate notifications over guaranteed
delivery during provider or runtime failures.

No operational records or schema changes. This is an import freshness monitor,
not external uptime monitoring: database, Vercel or KIM outages may prevent it
from sending. It cannot detect partial imports that still report SUCCESS.

Verification: core and service tests, typecheck, production build, unauthorized
request rejection, protected dry run and one authorized server test. Never log
the webhook or CRON_SECRET.
