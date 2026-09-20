# ADS capacity planning

Read-only tab in Necessidade. Requires both existing `STAFF_COVERAGE_ADS` and `PERFORMANCE` capabilities. Both GET endpoints validate the current database user before reading any planning data. No table, migration, operational update, or background job is added.

## Definitions

- Reference: last two complete Monday–Sunday weeks in America/Sao_Paulo. Default horizon: today plus 13 days; inclusive maximum 31 days.
- Individual rate: total ADS hourly submits / total scheduled hours in valid completed shifts. At least three valid shifts are required. A weighted principal-skill donor pool (only partners meeting that minimum) is the fallback.
- To avoid treating missing data as zero, a historical shift needs explicit valid hourly coverage throughout its scheduled interval, plus registered presence or production. Full absences are excluded. A partial-hour boundary cannot safely partition an hourly submit bucket, so that historical shift is excluded and reported. Future partial-hour schedules are supported.
- Null productivity and explicit observed zero are distinct. No extra break, ABS, backlog, or legacy requirement adjustment is applied.
- Scheduled coverage reuses Necessidade's status, agent, PROJECT and nesting eligibility, excludes leave, honors effective schedule times, and assigns overlapping minutes to only one schedule per partner. Night shifts remain on their start date.
- Historical LOB ownership belongs to the saved schedule slot (`Schedule.lobId`), not the current employee registry. The slot editor and planning use the same resolver. Only legacy slots with no LOB use the registry fallback; a dangling LOB identifier is shown as unavailable rather than reassigned silently.
- Future ADS capacity requires both a current ADS employee registry and an ADS schedule slot. People transferred to CEC or another LOB no longer enter future ADS capacity, even if an old imported future slot still says ADS. Conversely, current ADS partners explicitly scheduled in another LOB do not enter either. Their historical ADS work remains available for the reference calculation; no schedules or profiles are rewritten. This additional roster restriction applies only to the ADS planning read, not the existing AGENTS/STAFF views.
- The slot editor shows the saved LOB and identifies a different current registry LOB. Explicit edits resolve a registered LOB and persist its ID with the existing slot audit; omitted LOB fields preserve the saved allocation. Deployment does not rewrite past or future schedules or employee profiles.
- Imports encode local Brasiltime as UTC wall-clock fields. Never subtract the timezone offset a second time.

## Forecast and allocation

`volume-forecast-service.ts` is the single volume forecast source for Performance, Real Time, executive reports/exports/webhooks, ADS requirements and capacity planning. `executive-forecast-service.ts` is only a compatibility adapter. It uses the Performance queue mapping, up to 120 days of complete observations and one versioned policy per LOB. ADS retains the recency-adjusted ensemble, with at least two complete days. Explicit zeros remain observations. Historical days use their own midnight cutoff; today and future dates use today's operational midnight. Forecasts never become training observations. See `docs/volume-forecast.md` for the 167-configuration comparison and hourly/daily validation contract.

Allocate each forecast interval by scheduled person-hours across the entire operation, before filtering shifts. Attribute shares to each shift's start date. Read adjacent schedules to account for overlapping boundary cohorts. Demand without scheduled people remains in explicit "Sem cobertura" rows.

`reconciliation.sourceForecast = sum(all operational rows' forecast) + reconciliation.outsideForecast`; the outside share belongs to adjacent start-date cohorts and is not silently lost. The operational window covers the canonical shift windows and any wider actual scheduled windows. Missing forecast hours invalidate forecast-based comparisons rather than becoming zero.

Calculated need = ceil(assigned forecast / average capacity per scheduled unique person). Without people or complete productivity references, need is unavailable. Registered requirement is independent and distinguishes no row from a registered zero.

## Delivery contract

- `/api/staff-coverage/ads/planning`: aggregate cards, chart, day/shift rows, source dates, coverage warnings and a content version; no partner details.
- `/api/staff-coverage/ads/planning/details`: same authorization and filters; checks content version and selected row, then returns partner details. Changed snapshots return 409.
- Requests are no-store, loaded on tab activation/apply, and cancelled on filter/navigation changes. No polling.

## Regression tests

Run `npx tsx --test src/lib/ads-capacity-*.test.ts src/lib/executive-forecast-core.test.ts src/lib/ads-executive-webhook-service.test.ts src/lib/coverage-lob-rules.test.ts`, then `npm run typecheck` and `npm run build`.
