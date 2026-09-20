import assert from "node:assert/strict";
import test from "node:test";
import {
  completeForecastDays,
  VOLUME_CANDIDATES,
  predictCandidate,
  evaluateCandidate,
} from "./volume-forecast-models";
import {
  createVolumeForecastEngine,
  forecastDates,
} from "./volume-forecast-core";
const H = 3600000;
const observations = Array.from({ length: 24 * 90 }, (_, h) => ({
  at: new Date(Date.UTC(2026, 5, 1, h)),
  input: h % 24 === 14 ? 1000 : 100,
}));
const days = completeForecastDays(observations);
test("167 distinct short, medium, long, seasonal, trend, blend and incumbent candidates", () => {
  assert.equal(VOLUME_CANDIDATES.length, 167);
  assert.equal(new Set(VOLUME_CANDIDATES.map((c) => c.id)).size, 167);
  assert.ok(VOLUME_CANDIDATES.some((c) => c.window === 1));
  assert.ok(VOLUME_CANDIDATES.some((c) => c.window === 120));
});
test("all candidate families exclude future observations and reconcile 24 nonnegative integer hours", () => {
  const cutoff = "2026-08-15",
    modified = completeForecastDays(
      observations.map((r) =>
        r.at.getTime() >= Date.parse(cutoff) ? { ...r, input: 999999 } : r,
      ),
    );
  for (const candidate of VOLUME_CANDIDATES) {
    const p = predictCandidate(days, cutoff, cutoff, candidate);
    assert.equal(p?.length, 24, candidate.id);
    assert.ok(
      p!.every((v) => v >= 0 && Number.isInteger(v)),
      candidate.id,
    );
    assert.deepEqual(
      predictCandidate(modified, cutoff, cutoff, candidate),
      p,
      candidate.id,
    );
  }
});
test("day totals alone cannot reward a prediction with the peak at the wrong hour", () => {
  const candidate = VOLUME_CANDIDATES.find((c) => c.id === "naive-1d")!;
  const shifted = observations.map((r) =>
    r.at.toISOString().startsWith("2026-08-15")
      ? { ...r, input: r.at.getUTCHours() === 3 ? 1000 : 100 }
      : r,
  );
  const score = evaluateCandidate(
    completeForecastDays(shifted),
    ["2026-08-15"],
    candidate,
  );
  assert.equal(score.dailyWape, 0);
  assert.ok(score.hourlyWape! > 0);
  assert.equal(score.peakHours, 11);
  assert.ok(score.shapeWape! > 0);
});
test("explicit zero days stay zero, incomplete days are excluded and dates are never filled", () => {
  const zeros = observations.map((r) => ({ ...r, input: 0 }));
  const complete = completeForecastDays(zeros);
  assert.equal(complete.length, 90);
  const partial = completeForecastDays(zeros.slice(1));
  assert.equal(partial.length, 89);
  for (const lob of ["ADS", "VIDEO", "COMMENTS"] as const) {
    const p = createVolumeForecastEngine(zeros, lob).predictDay(
      "2026-08-15",
      "2026-08-15",
    );
    assert.equal(p.length, 24);
    assert.ok(p.every((r) => r.input === 0));
  }
});
test("each LOB is deterministic across ranges and long horizons do not fabricate training observations", () => {
  for (const lob of ["ADS", "VIDEO", "COMMENTS"] as const) {
    const e = createVolumeForecastEngine(observations, lob),
      before = e.actuals.length,
      p = e.predictDay("2026-09-15", "2026-08-30");
    for (const date of forecastDates("2026-09-01", "2026-09-20"))
      e.predictDay(date, "2026-08-30");
    assert.deepEqual(e.predictDay("2026-09-15", "2026-08-30"), p);
    assert.equal(e.actuals.length, before);
    assert.equal(p.length, 24);
  }
  const naive = VOLUME_CANDIDATES.find((c) => c.id === "naive-1d")!;
  assert.equal(
    predictCandidate(days, "2026-09-15", "2026-08-30", naive)?.length,
    24,
  );
});
test("stale short-window forecasts use the last complete observations without filling absent dates", () => {
  const engine = createVolumeForecastEngine(observations, "VIDEO");
  const before = engine.actuals.length;
  const stale = engine.predictDay("2026-09-03", "2026-09-03");
  const lastAvailableCut = engine.predictDay("2026-09-03", "2026-08-30");
  assert.equal(stale.length, 24);
  assert.deepEqual(stale.map(p => p.input), lastAvailableCut.map(p => p.input));
  assert.equal(engine.actuals.length, before);
  assert.equal(stale.reduce((s,p) => s+p.input,0),3300);
});
test("a wider fetch cannot change stale forecasts by introducing older training observations", () => {
  const rows = Array.from({length:198*24}, (_,h)=>({at:new Date(Date.UTC(2026,0,1,h)),input:100+(h%71)}));
  const cut = Date.parse("2026-09-01");
  const narrow = rows.filter(r=>r.at.getTime() >= cut-142*24*H);
  for (const lob of ["ADS","VIDEO","COMMENTS"] as const) {
    assert.deepEqual(createVolumeForecastEngine(rows,lob).predictDay("2026-09-02","2026-09-01"),createVolumeForecastEngine(narrow,lob).predictDay("2026-09-02","2026-09-01"));
  }
});
