import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCycle, transitionCycles, cycleMillis, monitorMessage } from "./realtime-cycle-monitor-core";
const check = (cycle: string | null, time: string) => evaluateCycle({ feed: "queues", cycle, importedAt: "2026-09-22T16:04:00Z" }, new Date(time));

test("five-minute grace and exact boundary in Sao Paulo", () => {
  assert.equal(check("2026-09-22 12:30", "2026-09-22T16:04:59Z").status, "ok");
  const late = check("2026-09-22 12:30", "2026-09-22T16:05:00Z");
  assert.equal(late.status, "late");
  assert.equal(late.expected, "2026-09-22 13:00");
  assert.equal(late.delayMinutes, 5);
  assert.equal(check("2026-09-22 13:00", "2026-09-22T16:05:00Z").status, "ok");
});
test("midnight grace includes the previous day and month", () => {
  assert.equal(check("2026-08-31 23:30", "2026-09-01T03:04:00Z").status, "ok");
  assert.equal(check("2026-08-31 23:30", "2026-09-01T03:05:00Z").expected, "2026-09-01 00:00");
  assert.equal(check("2026-08-31 23:30", "2026-09-01T03:05:00Z").status, "late");
});
test("missing, malformed and future cycles never count as healthy", () => {
  for (const value of ["2026-02-30 12:00", "2026-09-22 25:00", "2026-09-22 12:15"]) assert.equal(cycleMillis(value), null);
  assert.equal(check(null, "2026-09-22T16:05:00Z").status, "missing");
  assert.equal(check("2026-09-22 13:30", "2026-09-22T16:05:00Z").status, "invalid");
});
test("one alert throughout an incident, independent feeds and one recovery", () => {
  const now = new Date("2026-09-22T16:05:00Z");
  const bad = check("2026-09-22 12:30", now.toISOString());
  const good = check("2026-09-22 13:00", now.toISOString());
  const first = transitionCycles({}, [bad, { ...good, feed: "agents" }], now);
  assert.equal(first.events.length, 1);
  const repeat = transitionCycles(first.state, [bad], new Date(now.getTime() + 3600000));
  assert.equal(repeat.events.length, 0);
  const recovery = transitionCycles(repeat.state, [good], now);
  assert.equal(recovery.events[0].kind, "recovered");
  assert.equal(transitionCycles(recovery.state, [good], now).events.length, 0);
  assert.equal(transitionCycles(recovery.state, [bad], new Date(now.getTime() + 7200000)).events.length, 1);
});
test("test is explicitly labelled and mentions the configured recipient", () => {
  const message = monitorMessage(null, new Date("2026-09-22T16:05:00Z"));
  assert.match(message, /TESTE/);
  assert.match(message, /Não indica uma falha real/);
  assert.match(message, /<@=username\(wb_lucasy\)=>/);
});
