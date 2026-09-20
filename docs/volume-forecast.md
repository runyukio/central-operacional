# Canonical volume forecast

One read-only source, `volume-forecast-service.ts`, supplies Performance, Real Time Executive (including browser PNG), executive XLSX/PNG/Kim deliveries, the finite ADS backlog plan, ADS requirement calculation and ADS capacity planning. The executive service is a compatibility adapter, not another model. Deployment introduces no schema, operational import, schedule, requirement refresh or automation.

## Contract

- One integer forecast per LOB/date/hour/source snapshot/model version. Changing the requested range, view or consumer cannot change that hour. Daily and weekly values sum hourly predictions; ALL sums LOB predictions.
- Queue ownership follows the existing Performance mapping, including ADS overrides. Aggregate incoming volume by queue/hour before downstream allocation. Only successful imports or legacy rows without a batch, with nonnegative values, enter training. No agent join multiplies input.
- Performance stores operational São Paulo wall-clock values in UTC fields. Do not apply the UTC offset again. The execution date is calculated in America/Sao_Paulo.
- Historical targets use the start of their own date as cutoff. Today and future targets use today's midnight. Only complete observed 24-hour days strictly before the cutoff enter fitting. Training windows are anchored to the most recent complete observed day before that cutoff, including when imports are stale; the warning remains visible. Explicit zeros count; absent hours are not zeros. Forecasts never become training observations.
- Policies are fixed per LOB in `volume-forecast-policies.ts`, version `volume-v3-lob-hourly-167-complete-cutoff`. All consumers use them. There is no client-selected model, in-day recalibration or expensive runtime model tournament. Parameters fit the latest available historical data on each source revision.
- ADS retains the recency-adjusted ensemble. VIDEO uses the last three calendar days' daily volume (at least two complete days) and a volume-weighted hourly profile over up to 120 days. COMMENTS uses matching weekdays/hours from the last 28 days, exponentially weighted with seven-day half-life (at least two matching complete days).
- With inadequate history, forecast is unavailable; no undocumented model fallback or invented observations.
- The source coverage budget is 142 calendar days before each allowed cutoff, including training/evaluation buffer. The same bound is enforced inside the engine, so fetching a wider date range cannot introduce older training data and change a stale forecast.
- CEC CPD/FRT is not incoming volume. The API reports that limitation rather than manufacturing a forecast. HC/Glide path performance scenarios and Omie payment dates are not incoming-volume forecasts and remain unchanged.
- `/api/performance/forecast` validates the current database user using existing Performance authorization, rejects agent-only access, caps dates at 40, and accepts no client model/cutoff override. Responses are private/no-store. Internal cache keys include source fingerprint, mapping, model version, execution day and requested dates.
- Performance cancels old requests, labels incomplete actual days, suppresses full-day comparisons against partial actuals, and warns about stale bases. No client fallback fits Real Time actuals.
- Finite backlog target dates are unchanged. Historical workbook forecasts are removed. Missing canonical forecasts cannot reactivate expired deliveries or fall back to workbook values.

## Model comparison, 20 September 2026

167 configurations were compared for each LOB: seasonal naive (1/7/14 days), hourly moving averages, exponential averages, weekday/hour seasonality, short/long blends, recent/seasonal blends, daily total × hourly profile, damped Holt trend × profile, and both previous ensemble/recent implementations. Windows range from 1 to 120 days.

All candidates use identical complete evaluation days. Ranking uses **70% hourly WAPE + 30% daily WAPE**, explicitly prioritizing when volume arrives. August 3–30 ranks challengers (28 days); August 31–September 16 checks them separately (17 days). A challenger that regresses may be rejected in favor of the incumbent. This is retrospective model development, not a pristine untouched holdout. The former version had also been diagnosed against September data. No claim is made that these are all possible forecasting models or that performance is guaranteed.

Read-only source: `PerformanceQueueVolumeRecord`, joined only to `PerformanceImportBatch` for successful-load validation. Available volume starts June 1 and ends September 17 at 12:00; September 16 is the last complete day. The source was imported September 18. These are reconstructions from the current export, not an archive of forecasts available/issued on those dates. Original availability and past mapping revisions cannot be reconstructed. The maximum complete observed history is 108 days: 120-day candidates use the available portion, not fabricated history; annual seasonality is not tested.

Rolling-origin evaluation uses only earlier observations for each target, consistent with [time-series cross-validation](https://otexts.com/fpp3/tscv.html).

### Adopted policies: one-day-ahead retrospective validation

August 31–September 16, **408 hours / 17 days per LOB**:

| LOB | Actual | Forecast | Hourly absolute error | Daily absolute error | Hourly assertiveness | Daily assertiveness |
|---|---:|---:|---:|---:|---:|---:|
| ADS | 172,392 | 176,001 | 42,211 | 16,979 | 75.51% | 90.15% |
| VIDEO | 167,372 | 166,341 | 36,963 | 7,705 | 77.92% | 95.40% |
| COMMENTS | 153,273 | 158,256 | 49,217 | 10,141 | 67.89% | 93.38% |

Compared with the immediately preceding unified v2 deployment on the same interval:
- ADS is unchanged: the existing ensemble ranked first and remains stronger than the former browser-only recent formula.
- VIDEO hourly assertiveness improves from 76.39% to 77.92% (+1.53 percentage points), while daily assertiveness changes from 96.05% to 95.40% (−0.65 points). The combined objective improves; this is a deliberate hourly/daily tradeoff, not improvement on every metric.
- COMMENTS stays at 67.89% hourly / 93.38% daily. The 120-day weekday challenger won the August ranking but fell to 61.39% / 89.49% in the separate period, so it was rejected.

The larger legacy-report improvement for COMMENTS belongs to the earlier unification; it must not be attributed again to this policy revision.

| LOB | 7-day-lead hourly | 14-day-lead hourly | Mean absolute peak-hour error, 1-day lead |
|---|---:|---:|---:|
| ADS | 74.30% | 66.36% | 1.94h |
| VIDEO | 77.30% | 76.78% | 0.35h |
| COMMENTS | 67.89% | 64.93% | 0.12h |

Forecast quality deteriorates at longer horizons, particularly ADS. Peak-hour error is the absolute difference between the first maximum hour of each daily series, not circular distance or a guarantee of peak timing. Shape error also compares profiles normalized to the actual daily total; it is diagnostic, not the displayed accuracy.

Hourly WAPE = Σ|actual hour − forecast hour| / Σactual hour. Assertiveness = max(0, 1 − WAPE), **not the percentage of hours predicted exactly**. Daily WAPE first sums each day, then sums absolute daily errors. Bias = (Σforecast − Σactual)/Σactual. Zero denominator is unavailable, not 100%. The live UI uses the last seven complete available days and can differ from this fixed audit.

## Reproduction and safety checks

- `scripts/compare-volume-forecast-models.ts`: read-only tournament, per-family winners, separate-period challenger/adopted-policy metrics, 7/14-day leads and frozen v2 baseline.
- `scripts/backtest-volume-forecast.ts 2026-08-31 2026-09-16`: canonical production-engine evaluation and legacy report/browser comparators. `--source-only` prints compiled SQL and non-secret bindings without querying.
- `scripts/lib/volume-forecast-v2-baseline.ts`: frozen offline comparison only, never imported by production consumers.

Core SQL, using authoritative queue IDs and bound dates:

```sql
SELECT date_trunc('hour',p."bzTime") AS at,
       SUM(p."inputCount")::double precision AS input
FROM "PerformanceQueueVolumeRecord" p
LEFT JOIN "PerformanceImportBatch" b ON b.id=p."importBatchId"
WHERE p."queueId" IN (<Performance queue IDs>)
  AND p."bzTime">=<training start> AND p."bzTime"< <end exclusive>
  AND p."inputCount">=0
  AND (p."importBatchId" IS NULL OR b.status='SUCCESS')
GROUP BY 1 ORDER BY 1;
```

Regression checks cover all 167 candidates' future-data isolation, complete/zero/missing observations, São Paulo cutoffs, wrong-hour peaks despite correct daily totals, canonical report/display equality, ALL aggregation, incomplete horizons, permissions and overnight capacity reconciliation. Do not call delivery or requirement-refresh endpoints just to test: they send messages or write operational requirements.
