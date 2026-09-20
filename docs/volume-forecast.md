# Canonical volume forecast

One read-only source, `volume-forecast-service.ts`, supplies Performance, Real Time Executive (including browser PNG), executive XLSX/PNG/Kim deliveries, the finite ADS backlog plan, ADS requirement calculation and ADS capacity planning. The executive service is a compatibility adapter, not another model. No schema, operational import, schedule, requirement refresh or new automation is introduced by deployment.

## Contract

- One integer forecast per LOB/date/hour/source snapshot/model version. Changing the requested range, view or consumer cannot change that hour. Daily and weekly values sum hourly predictions; ALL sums LOB predictions instead of fitting a separate model.
- Authoritative queue ownership is the existing Performance mapping, including ADS overrides. Aggregate incoming volume by queue/hour before any downstream allocation. Only successful imports or legacy rows without a batch, with nonnegative values, enter training. No agent join can multiply input.
- Performance stores operational São Paulo wall-clock values in UTC fields. Do not apply the UTC offset again. The execution date is calculated in America/Sao_Paulo.
- Historical targets use the start of their own date as cutoff. Today and all future targets use today's midnight. Up to 120 days of actual observations strictly before the cutoff are eligible. At least 48 observed hours are required. Explicit zeros count; absent hours do not become zeros. Forecasts are never recursively inserted into training.
- One central engine selects between the existing recency-adjusted ensemble and a 60% recent-seven-day / 35% recent-three-day / 5% older-weekday candidate. A weekly-seasonality candidate (last four matching weekdays, half-life seven days) is eligible only when its absolute hourly error is more than 15% below the best recency candidate. Calibration uses the previous 14 days, requiring at least seven complete days; each calibration day itself is forecast only from earlier data. With insufficient calibration, use the ensemble.
- The 15% seasonal gate prevents a small calibration advantage from causing a switch to a substantially different hourly profile. This is a modeling safeguard, not a statistical confidence interval or a guarantee of future improvement.
- There is no valid incoming-volume forecast for CEC from CPD or FRT. The API reports that limitation, rather than manufacturing input. HC/Glide path performance scenarios and Omie payment dates are not incoming-volume forecasts and remain unchanged.
- `/api/performance/forecast` validates the current database user through the existing Performance authorization, rejects agent-only access, caps the period at 40 days, and does not accept client model/cutoff overrides. Responses are private/no-store. The internal calculation cache is keyed by source fingerprint, mapping, model version, execution day and requested dates; imports/updates invalidate the fingerprint.
- Performance cancels old requests, labels incomplete actual days, hides comparisons against a full-day forecast when actuals are partial, and reports stale data. No client-side fallback derives forecast from Real Time actuals.
- The old finite backlog target dates remain unchanged. Its historical workbook input forecasts are removed. Missing canonical forecasts do not fall back to workbook values or reactivate expired deliveries.

## Evaluation, 20 September 2026

Read-only source: `PerformanceQueueVolumeRecord`, joined only to `PerformanceImportBatch` for successful-load validation. Available queue volume starts 1 June and ends 17 September at 12:00; the last complete operational day is 16 September. The imported source was loaded on 18 September. This is **retrospective reconstruction of the current historical export**, not proof of what forecast was issued or available on those past dates. Mapping revisions and changes in original source availability cannot be reconstructed from this export.

The design was examined on 10 August–6 September and iterated after diagnostic testing on 7–16 September. Therefore the final table is a **retrospective validation**, not an untouched holdout or an unbiased guarantee of future performance. We do not claim every new model beats every previous consumer at every horizon.

Final one-day-ahead evaluation, 7–16 September inclusive: 10 complete days / 240 hours **per LOB**. All comparisons use the same authoritative mapping and observed hours.

| LOB | Actual input | Forecast | Absolute hourly error | Hourly assertiveness | Daily-total assertiveness | Bias | Previous report hourly | Previous Real Time hourly |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ADS | 100,592 | 101,705 | 26,113 | 74.04% | 87.89% | +1.11% | 74.04% | 72.64% |
| VIDEO | 98,719 | 95,844 | 23,981 | 75.71% | 96.44% | -2.91% | 75.58% | 77.28% |
| COMMENTS | 94,397 | 96,937 | 29,132 | 69.14% | 91.85% | +2.69% | 42.90% | 25.03% |

VIDEO improves slightly against the server report baseline but remains below the former browser-only recent model on this interval. COMMENTS improves substantially against both. ADS keeps the stronger server ensemble instead of adopting the weaker browser-only formula. Consolidation removes contradictory site numbers; it does not imply perfect prediction.

| LOB | 7-day-lead hourly assertiveness | 14-day-lead hourly assertiveness |
|---|---:|---:|
| ADS | 74.00% | 70.40% |
| VIDEO | 75.06% | 75.93% |
| COMMENTS | 69.14% | 68.23% |

Hourly WAPE = sum(abs(actual hour − forecast hour)) / sum(actual hour). Displayed assertiveness = max(0, 1 − WAPE). Daily assertiveness first aggregates each day, then takes absolute daily errors; it is **not hourly accuracy**. Bias = (sum(forecast) − sum(actual)) / sum(actual). Zero denominator is unavailable, not 100%. The UI uses the last seven complete available days and can therefore show a different score from this fixed ten-day audit.

## Reproduction and checks

Run `scripts/backtest-volume-forecast.ts` with the existing private database environment and inclusive dates. It prints only aggregated statistics, keeps full precision, fits each historical cutoff independently and runs SELECTs only. Parameters default to 7–16 September; horizons are 1, 7 and 14 days.

Core SQL (queue IDs are resolved by `volumeForecastQueueIds(lob)`):

```sql
SELECT date_trunc('hour',p."bzTime") AS at,
       SUM(p."inputCount")::double precision AS input
FROM "PerformanceQueueVolumeRecord" p
LEFT JOIN "PerformanceImportBatch" b ON b.id=p."importBatchId"
WHERE p."queueId" IN (<authoritative Performance queue IDs>)
  AND p."bzTime">=<training start> AND p."bzTime"< <end exclusive>
  AND p."inputCount">=0
  AND (p."importBatchId" IS NULL OR b.status='SUCCESS')
GROUP BY 1 ORDER BY 1;
```

Regression coverage includes future-data isolation, zero/missing observations, incomplete days, São Paulo midnight, canonical report/display equality, ALL aggregation, incomplete horizons, recency/seasonality selection, network cancellation, permissions, backlog and overnight capacity reconciliation. Do not call delivery or requirement-refresh endpoints merely to test the forecast: those actions send messages or write operational requirements.
