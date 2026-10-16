import assert from "node:assert/strict";
import test from "node:test";
import { buildAdsBacklogGlide, glideForecastDates, resolveGlideAttendance, type AdsGlideAgent } from "./ads-backlog-glide-core";

const at = (clock: string) => Date.parse(`2026-10-16T${clock}:00Z`);
const agent = (overrides: Partial<AdsGlideAgent> = {}): AdsGlideAgent => ({ id: "shift", employeeId: "agent", date: "2026-10-16", wbLogin: "a", name: "A", skill: "Material Queues", shift: "Manhã", status: "ESCALADO", statusLabel: "Escalado", start: at("08:00"), end: at("12:00"), rate: 20, ...overrides });
const forecast = (hours: number[], input = 10) => hours.map((hour) => ({ dateKey: "2026-10-16", hour, input }));

test("burns live backlog against every forecast hour and applies expected ABS only to uncertain attendance", () => {
  const input = { snapshotTimestamp: at("08:00"), endTimestamp: at("12:00"), currentBacklog: 30, agents: [agent()], forecast: forecast([8, 9, 10, 11]) };
  const uncertain = buildAdsBacklogGlide(input);
  assert.deepEqual(uncertain.points.map((row) => row.backlog), [21.5, 13, 4.5, 0]);
  assert.equal(uncertain.clearanceAt, at("12:00"));
  const present = buildAdsBacklogGlide({ ...input, confirmedPresent: new Set(["shift"]) });
  assert.deepEqual(present.points.map((row) => row.capacity), [20, 20, 20, 20]);
  assert.equal(present.clearanceAt, at("11:00"));
});

test("starts at the actual snapshot, prorates the partial hour and crosses midnight without shifting São Paulo twice", () => {
  const start = at("23:30"), end = Date.parse("2026-10-17T02:00:00Z");
  const result = buildAdsBacklogGlide({ snapshotTimestamp: start, endTimestamp: end, currentBacklog: 100,
    agents: [agent({ start: at("23:45"), end: Date.parse("2026-10-17T00:30:00Z"), rate: 100, status: "PRESENTE" })],
    forecast: [{ dateKey: "2026-10-16", hour: 23, input: 10 }, { dateKey: "2026-10-17", hour: 0, input: 10 }, { dateKey: "2026-10-17", hour: 1, input: 10 }],
    // Confirmation cannot predate the shift start, so this future partial shift still has ABS.
    absRate: 0 });
  assert.deepEqual(result.points.map((row) => row.effectiveAgentHours), [0.25, 0.5, 0]);
  assert.deepEqual(result.points.map((row) => row.backlog), [80, 40, 50]);
  assert.equal(result.points[0].intervalStart, start);
  assert.equal(result.points[0].timestamp, Date.parse("2026-10-17T00:00:00Z"));
  assert.deepEqual(glideForecastDates(start, end), ["2026-10-16", "2026-10-17"]);
});

test("overlapping shifts of the same person cannot manufacture capacity", () => {
  const result = buildAdsBacklogGlide({ snapshotTimestamp: at("08:00"), endTimestamp: at("11:00"), currentBacklog: 300, absRate: 0,
    agents: [agent({ end: at("10:00"), rate: 100 }), agent({ id: "overlap", start: at("09:00"), end: at("11:00"), rate: 100 })], forecast: forecast([8, 9, 10], 0) });
  assert.deepEqual(result.points.map((row) => row.capacity), [100, 100, 100]);
  assert.deepEqual(result.points.map((row) => row.scheduledAgents), [1, 1, 1]);
  assert.equal(result.clearanceAt, at("11:00"));
});

test("confirmed absence removes the shift, and presence does not carry into another shift of that person", () => {
  const result = buildAdsBacklogGlide({ snapshotTimestamp: at("08:00"), endTimestamp: at("11:00"), currentBacklog: 1000,
    agents: [agent({ end: at("09:00"), rate: 100 }), agent({ id: "tomorrow", start: at("09:00"), end: at("10:00"), rate: 100 }), agent({ id: "absent", employeeId: "b", rate: 100 })],
    confirmedPresent: new Set(["shift", "tomorrow"]), unavailable: new Set(["absent"]), forecast: forecast([8, 9, 10], 0) });
  assert.deepEqual(result.points.map((row) => row.capacity), [100, 92.5, 0]);
  assert.deepEqual(result.points.map((row) => row.scheduledAgents), [1, 1, 0]);
});

test("attendance overrides a still-scheduled absence, keeps presence shift-specific and removes an early departure", () => {
  const agents = [agent(), agent({ id: "next", date: "2026-10-17", start: Date.parse("2026-10-17T08:00:00Z"), end: Date.parse("2026-10-17T12:00:00Z") }), agent({ id: "early", employeeId: "b", status: "SAIDA_ANTECIPADA" }), agent({ id: "late", employeeId: "c" })];
  const resolved = resolveGlideAttendance(agents, at("09:00"), [
    { scheduleId: "shift", employeeId: "agent", date: "2026-10-16", status: "FALTA" },
    { scheduleId: null, employeeId: "c", date: "2026-10-16", status: "ATRASO" },
    { scheduleId: "next", employeeId: "agent", date: "2026-10-17", status: "PRESENTE" }
  ]);
  assert.deepEqual([...resolved.unavailable].sort(), ["early", "shift"]);
  assert.deepEqual([...resolved.confirmedPresent], ["late"]);
  const result = buildAdsBacklogGlide({ snapshotTimestamp: at("09:00"), endTimestamp: at("10:00"), currentBacklog: 100, agents, forecast: forecast([9], 0), ...resolved });
  assert.equal(result.points[0].capacity, 20, "only confirmed late arrival remains, without an additional ABS deduction");
  assert.equal(result.points[0].scheduledAgents, 1);
});

test("explicit zero productivity is observed capacity zero; missing productivity is unavailable", () => {
  const input = { snapshotTimestamp: at("08:00"), endTimestamp: at("09:00"), currentBacklog: 10, forecast: forecast([8], 0) };
  const zero = buildAdsBacklogGlide({ ...input, agents: [agent({ rate: 0 })] });
  assert.equal(zero.points[0].capacity, 0);
  assert.equal(zero.state, "no-clearance");
  const missing = buildAdsBacklogGlide({ ...input, agents: [agent({ rate: null })] });
  assert.equal(missing.points[0].capacity, null);
  assert.equal(missing.points[0].backlog, null);
  assert.equal(missing.points[0].missingAgents, 1);
  assert.equal(missing.state, "incomplete");
});

test("a missing forecast hour never becomes zero and suppresses an otherwise early ETA", () => {
  const result = buildAdsBacklogGlide({ snapshotTimestamp: at("08:00"), endTimestamp: at("10:00"), currentBacklog: 10, agents: [agent({ rate: 100 })], forecast: forecast([8], 0) });
  assert.equal(result.points[0].backlog, 0);
  assert.equal(result.points[1].forecast, null);
  assert.equal(result.points[1].backlog, null);
  assert.equal(result.clearanceAt, null);
  assert.equal(result.state, "incomplete");
});

test("reports first zero separately from sustained clearance and never extrapolates beyond the horizon", () => {
  const input = { snapshotTimestamp: at("08:00"), endTimestamp: at("10:00"), currentBacklog: 10, agents: [agent({ end: at("09:00"), rate: 100 })], forecast: forecast([8, 9], 20) };
  const result = buildAdsBacklogGlide(input);
  assert.equal(result.clearanceAt, at("09:00"));
  assert.equal(result.reaccumulates, true);
  assert.equal(result.points[1].backlog, 20);
  const noClearance = buildAdsBacklogGlide({ ...input, currentBacklog: 1000 });
  assert.equal(noClearance.clearanceAt, null);
  assert.equal(noClearance.state, "no-clearance");
});

test("stale data retains its own timestamp and curve but cannot publish an ETA", () => {
  const result = buildAdsBacklogGlide({ snapshotTimestamp: at("08:30"), endTimestamp: at("10:00"), currentBacklog: 1, agents: [agent({ rate: 100 })], forecast: forecast([8, 9], 0), stale: true });
  assert.equal(result.points[0].intervalStart, at("08:30"));
  assert.equal(result.points[0].backlog, 0);
  assert.equal(result.clearanceAt, null);
  assert.equal(result.state, "stale");
});

test("unavailable backlog, invalid schedules and duplicate forecast keys cannot produce a misleading clearance", () => {
  const input = { snapshotTimestamp: at("08:00"), endTimestamp: at("09:00"), currentBacklog: 10, agents: [agent()], forecast: forecast([8], 0) };
  for (const override of [{ currentBacklog: null }, { agents: [agent({ start: null })] }, { forecast: forecast([8, 8], 0) }]) {
    const result = buildAdsBacklogGlide({ ...input, ...override });
    assert.equal(result.state, "incomplete");
    assert.equal(result.clearanceAt, null);
  }
});
