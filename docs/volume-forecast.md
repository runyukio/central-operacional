# Canonical volume forecast

One read-only source, `volume-forecast-service.ts`, supplies Performance, Real Time Executive (including browser PNG), executive XLSX/PNG/Kim deliveries, the finite ADS backlog plan, ADS requirement calculation and ADS capacity planning. The executive service is a compatibility adapter, not another model. Version `volume-v5-ads-robust-prior-online` adds a current-day ADS revision after the historical cache. This change introduces no schema, operational import, schedule write, requirement refresh or delivery automation.

## Contract

- One historical prior per LOB/date/hour/source snapshot/model version. The ADS current-day estimate also depends on its eligible Real Time cycle and method version. With the same source/cycle/cut, changing the requested range, view or consumer cannot change that hour. Daily and weekly values sum hourly points; ALL sums LOB points. Prior hours are integers; revised remaining amounts can be fractional and are not rounded before integration.
- Queue ownership follows the existing Performance mapping, including ADS overrides. Aggregate incoming volume by queue/hour before downstream allocation. Only successful imports or legacy rows without a batch, with nonnegative values, enter training. No agent join multiplies input.
- Performance stores operational São Paulo wall-clock values in UTC fields. Do not apply the UTC offset again. The execution date is calculated in America/Sao_Paulo.
- Historical targets use the start of their own date as cutoff. Today and future targets use today's midnight. Only complete observed 24-hour days strictly before the cutoff enter fitting. Training windows are anchored to the most recent complete observed day before that cutoff, including when imports are stale; the warning remains visible. Explicit zeros count; absent hours are not zeros. Forecasts never become training observations.
- Policies are fixed per LOB in `volume-forecast-policies.ts`, version `volume-v5-ads-robust-prior-online`. All consumers use them. There is no client-selected model or expensive runtime model tournament. The ADS historical prior is calculated from complete history, then a separate deterministic revision uses eligible current-day arrivals.
- ADS uses the robust weekday prior on every weekday, including Saturday and Sunday, followed by the current-day revision described below. VIDEO uses the last three calendar days' daily volume (at least two complete days) and a volume-weighted hourly profile over up to 120 days. COMMENTS uses matching weekdays/hours from the last 28 days, exponentially weighted with seven-day half-life (at least two matching complete days).
- With inadequate history, forecast is unavailable; no undocumented model fallback or invented observations.
- The source coverage budget is 142 calendar days before each allowed cutoff, including training/evaluation buffer. The same bound is enforced inside the engine, so fetching a wider date range cannot introduce older training data and change a stale forecast.
- CEC CPD/FRT is not incoming volume. The API reports that limitation rather than manufacturing a forecast. ADS schedules, productivity and observed ABS remain separate capacity inputs; this forecast revision does not change those rules.
- `/api/performance/forecast` validates the current database user using existing Performance authorization, rejects agent-only access, caps dates at 40, and accepts no client model/cutoff override. Responses are private/no-store. Internal historical cache keys include source fingerprint, mapping, model version, execution day and requested dates. The online reader is internal and aggregate-only, with no new public route or access to raw queue/person details.
- Performance cancels old requests, labels incomplete actual days, suppresses full-day comparisons against partial actuals, and warns about stale bases. Its visible Forecast tab refreshes hourly and when visibility returns. The ADS glide path also refreshes hourly while visible. This is browser refresh, not a background import or delivery job. No browser fallback fits a separate model.
- Finite backlog target dates are unchanged. Historical workbook forecasts are removed. Missing canonical forecasts cannot reactivate expired deliveries or fall back to workbook values.

## ADS v5: historical prior and current-day revision, 16 October 2026

### Historical prior

The production ADS candidate is `ads-robust-prior`. It applies the same robust weekday method to all seven weekdays. Over 56 calendar days, it calculates median daily totals separately for each weekday. At least two complete observations of every weekday are required. The latest seven calendar days relative to the last complete-day anchor must all be available. Their totals are divided by their own weekday medians; the median of those seven ratios adjusts the target weekday's typical total. The target weekday's hourly shape is the normalized median of observed hourly shares for that weekday. Hourly prior values are rounded only after allocating that total.

This retains the weekday pattern while reducing the influence of an isolated spike. Sustained changes can move the seven-day median. There is no fixed 11,000/day value, historical-maximum ceiling or manual reduction factor. Missing history, unusable profiles and a zero baseline followed by positive demand are unavailable; an explicitly observed all-zero history can produce zero. The 142-day cutoff budget and last-complete-day anchor still apply. Partial days and Real Time counters do not enter historical fitting.

### Eligible Real Time observations

`ads-forecast-realtime-source.ts` reads `RealTimeQueueCycleSummary` and `RealTimeImportBatch` in one statement. The canonical service passes its authoritative ADS queue IDs, so the reader does not import Performance services, promote a user actor or call `getRealtimeSnapshot`. The public consumers keep their existing authorization. Only ADS interval totals, cycle/import metadata, fingerprint and availability warnings leave the reader; queue identifiers, raw cumulative counters, backlog and people are not returned.

For each operational cycle, the reader selects the latest successful **global queue batch** by import time and batch ID before filtering ADS. A LEFT JOIN preserves an invalid sentinel if that newer batch contains no ADS rows. It must not resurrect ADS from an older batch of the same cycle. Imports are bounded by the actual `now`, and cycle selection is bounded by the Brazil clock and optional internal `asOfCycle`. Reports and glide paths can therefore pin the revision to their selected backlog/report cycle; public callers cannot select an arbitrary cutoff.

The source requires a 00:00 baseline, an ending cycle and continuous per-queue observations with gaps no larger than 30 minutes. The union of queue keys across the selected frames must be represented in every frame; a missing queue or duplicate key is unavailable, not zero. Arrivals are calculated from each queue's counters before summing, so an increase in one queue cannot conceal an inconsistent decrease in another. KAP resets at 13:00 São Paulo, midnight in China: at that checkpoint the new counter is counted even if it rose from 1 to 2. Any other decrease, or a window crossing the reset without its checkpoint, is unavailable. Civil midnight is the reporting baseline, not a second reset.

A cycle or latest import older than 90 minutes cannot drive the online revision. Future source times beyond five minutes are also rejected as stale; the normal query excludes future cycles/imports before summarization. Unavailable/stale sources return no applicable intervals and preserve the historical reference with a warning. Missing observations never become a volume of zero.

### Current-day arithmetic and downstream use

`ads-volume-nowcast-core.ts` revises only today's 24 points. Historical targets and every future calendar day keep the historical prior. Let `R` be today's prior total, `O` observed arrivals since midnight and `E` the prior expected over the same elapsed interval. The cumulative ratio is `(O + R * 3 / 24) / (E + R * 3 / 24)`. Exact recent one-hour and three-hour comparisons use support equal to half the prior daily average over their available window. The nearby ratio combines 50% cumulative, 25% recent one-hour and 25% recent three-hour ratios. Its extra effect fades linearly over six future hours toward the cumulative ratio. These are explicit method parameters, not claimed independently optimized weights.

Only unelapsed portions of today's prior are multiplied. The updated day estimate is `observed arrivals + revised remaining arrivals`. Completed hourly points contain observed arrivals; a partial current-hour point contains observed arrivals plus its revised remainder and exposes `remainingInput` with `observedUntil`. `forecastRemainingInInterval` integrates only that remainder when projecting from live backlog, because elapsed arrivals are already represented in the backlog. It never prorates an observed-plus-future hourly total as if every case were still to arrive. Actual interval counts are not interpolated across unknown boundaries, and an already-revised array cannot be revised again.

`volume-forecast-overlay.ts` preserves `baselinePoints` and exposes revised `points` plus `adaptive` metadata. Real Time observed hourly amounts supplement missing current-day `actuals`; imported Performance actuals retain precedence and partial Real Time hours carry `complete:false`. The online metadata identifies the comparison with RT explicitly. Historical source timestamps remain separate from the current RT import/cycle.

There is a deliberate availability exception: positive observed arrivals against an all-zero prior are an unsupported restart, not evidence for a zero-demand future. The historical base stays visible, but operational points for today and later dates are withheld until a usable reference exists. This prevents a false zero-demand capacity or backlog-clearance scenario. It is a quality guard, not extrapolation of today's partial rate to future days.

Only the historical prior is inside the 24-hour `unstable_cache`. The RT read and current-day revision run **after** it on each canonical request. Returned `version` combines the historical fingerprint with the RT fingerprint, which includes source method version, selected batches/values, queue mapping and availability state. A new eligible import therefore changes the result without waiting for another Performance import or a 24-hour cache expiry. Method changes require version review. No revised point, synthetic future observation or partial RT day is written into training.

### Evaluation and limits

The evaluation returned by the service measures the historical prior over complete historical target days, with each target's own cutoff. It does not score today's hybrid observed-plus-forecast curve as an out-of-sample prediction. UI hourly/daily WAPE and bias must be read as **base-model evaluation**, not validated accuracy of the online adjustment. The historical v4 results below describe that earlier method and cannot be attributed to v5.

RT summaries have a minimum configured retention of seven days and gaps can exist. The read-only inventory on 16 October found cycles on 9–11 and 14–16 October, including complete days 10 and 15, but no retained cycles for 12–13 October. It cannot support a July–October intraday replay or reconstruct an untouched archive of source vintages. Current tests establish arithmetic, boundary handling, source validation and isolation; they do not establish guaranteed predictive accuracy or an independent online holdout result. Observed ADS ABS, schedules and productivity are preserved as separate inputs to capacity/clearance scenarios.

## Historical ADS v4 correction, 16 October 2026 (superseded by v5)

This section records the earlier `volume-v4-ads-seasonal-damped` review. Its model and numerical outputs are historical context, not the current production ADS policy or v5 validation.

The former ADS ensemble projected 22,462 arrivals for Saturday 17 October with cutoff 16 October. The current imported source has 15 complete Saturdays from July onwards; their maximum is 15,237 and the latest four average 10,584.25. This history is context, not a hard cap. October 15 is partial, so October 14 (27,595 arrivals) is the latest complete training day. The ensemble's unadjusted Saturday blend totals 13,003.59; its extra recent multipliers of 1.59–1.85 raise the rounded total to 22,462. Recent inputs were affecting the components, learned weights and an additional multiplier simultaneously, while only about 26% of effective component weight distinguished the weekday.

The `ads-seasonal-damped` candidate retains the learned ensemble components and halves only the deviation of its extra multiplier from one: `A -> 1 + 0.5 * (A - 1)`. On Saturdays and Sundays it averages that damped hourly forecast equally with a robust weekday forecast. The latter uses median daily totals for each weekday over 56 calendar days, a median seven-complete-day level after dividing each day by its weekday baseline, and a normalized median hourly profile for the target weekday. Each weekday needs two reference days; the recent seven days must be present. Missing history or a zero baseline with positive observed demand is unavailable, with no undocumented fallback. An all-zero observed reference remains zero. Component and final-hour integer rounding deliberately match the evaluated prototype.

The original ensemble and v4 candidate remain in the candidate library for comparison. The v4 change affected only ADS. Full source observations, including October 14, remained intact. No historical maximum was used as a ceiling, no incomplete day or Real Time reconciliation was substituted into fitting, and predictions were not fed back as observations. The shared 142-day snapshot budget, latest-complete anchor and 120-day ensemble history applied. The model version invalidated old forecast cache keys across consumers.

The review reconstructed 106 complete days (July 1–October 14) from the current successful-import source and compared the original, damped and seasonal alternatives. Development was iterative after the anomaly was identified. The adopted combination was fifth in the August diagnostic ranking and was chosen for its mechanism and balance across subsequent checks; it was **not** a blind selection winner. These are retrospective temporal comparisons, not a pristine untouched holdout or archived issued forecasts. Partitions use identical complete days for every candidate.

Combined error below is `0.7 * hourly WAPE + 0.3 * daily WAPE`, averaged equally across leads 1, 7 and 14:

| Period | Days | Former ADS | Revised ADS |
|---|---:|---:|---:|
| August 3–30 | 28 | 22.73% | 22.00% |
| August 31–September 27 | 28 | 26.47% | 25.27% |
| September 28–October 14 | 17 | 47.85% | 46.04% |

The August 31–September 27 comparison improves at every separately checked lead (1, 2, 7 and 14 days). With a missing latest training day, the lead-2 combined error improves from 27.37% to 24.75% over that period and 43.68% to 42.57% in the recent period. This does not establish superiority on every cut: ordinary lead-2 recent error worsens from 39.11% to 39.56%, and daily Saturday error in that recent cut worsens from 25.68% to 39.84%. There are only four Saturdays in each earlier partition and two in the recent partition; renewed spikes can still be underestimated. No probability or precision guarantee follows from these tests.

At the reviewed source snapshot/cutoff, the **v4** shared forecast totaled 13,920 on October 17, 13,050 on October 18 and 235,662 over October 16–29, versus 318,112 previously. These were conditional outputs of that earlier model, not received volume or permanent manual values. They must not be presented as v5 outputs or current forecasts.

## Original model comparison, 20 September 2026

This section records the September policies and retrospective audit. Its ADS policy and scores precede both v4 and v5; VIDEO/COMMENTS retain their described production policies. These historical metrics are not a new v5 accuracy claim.

167 configurations were compared for each LOB: seasonal naive (1/7/14 days), hourly moving averages, exponential averages, weekday/hour seasonality, short/long blends, recent/seasonal blends, daily total × hourly profile, damped Holt trend × profile, and both previous ensemble/recent implementations. Windows range from 1 to 120 days.

All candidates use identical complete evaluation days. Ranking uses **70% hourly WAPE + 30% daily WAPE**, explicitly prioritizing when volume arrives. August 3–30 ranks challengers (28 days); August 31–September 16 checks them separately (17 days). A challenger that regresses may be rejected in favor of the incumbent. This is retrospective model development, not a pristine untouched holdout. The former version had also been diagnosed against September data. No claim is made that these are all possible forecasting models or that performance is guaranteed.

Read-only source: `PerformanceQueueVolumeRecord`, joined only to `PerformanceImportBatch` for successful-load validation. Available volume starts June 1 and ends September 17 at 12:00; September 16 is the last complete day. The source was imported September 18. These are reconstructions from the current export, not an archive of forecasts available/issued on those dates. Original availability and past mapping revisions cannot be reconstructed. The maximum complete observed history is 108 days: 120-day candidates use the available portion, not fabricated history; annual seasonality is not tested.

Rolling-origin evaluation uses only earlier observations for each target, consistent with [time-series cross-validation](https://otexts.com/fpp3/tscv.html).

### September adopted policies: one-day-ahead retrospective validation

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

Hourly WAPE = Σ|actual hour − forecast hour| / Σactual hour. Assertiveness = max(0, 1 − WAPE), **not the percentage of hours predicted exactly**. Daily WAPE first sums each day, then sums absolute daily errors. Bias = (Σforecast − Σactual)/Σactual. Zero denominator is unavailable, not 100%. The live UI evaluates the current historical base over the latest complete historical targets and can differ from this fixed audit. It does not evaluate the online revision using already observed current-day hours.

## Reproduction and safety checks

- `scripts/compare-volume-forecast-models.ts`: read-only tournament, per-family winners, separate-period challenger/adopted-policy metrics, 7/14-day leads and frozen v2 baseline.
- `scripts/backtest-volume-forecast.ts 2026-08-31 2026-09-16`: canonical production-engine evaluation and legacy report/browser comparators. `--source-only` prints compiled SQL and non-secret bindings without querying.
- `scripts/lib/volume-forecast-v2-baseline.ts`: frozen offline comparison only, never imported by production consumers.
- `src/lib/ads-forecast-realtime-source.test.ts`: successful/global batch selection, missing ADS frames, inventory/gap validation, midnight/13:00 boundaries, source age, as-of isolation and fingerprint changes.
- `src/lib/ads-volume-nowcast-core.test.ts`: current-day revision, observed/remaining arithmetic, fractional hours, no duplicate adjustment, unavailable observations and future-day isolation.
- `src/lib/volume-forecast-overlay.test.ts`: base/actual precedence, source availability and suspension of operational forecasts after an unsupported positive restart.

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

The original tournament covered 167 configurations. The regression suite also covers the later ADS candidates' future-data isolation, complete/zero/missing observations, São Paulo cutoffs, wrong-hour peaks despite correct daily totals, canonical report/display equality, ALL aggregation, incomplete horizons, permissions and overnight capacity reconciliation. Source and nowcast tests add current-day boundaries and prevent counting observed arrivals twice. These checks are correctness evidence, not a predictive-accuracy guarantee. Do not call delivery or requirement-refresh endpoints just to test: they send messages or write operational requirements.
