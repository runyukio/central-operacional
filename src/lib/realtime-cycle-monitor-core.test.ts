import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCycle, transitionCycles, monitorMessage } from "./realtime-cycle-monitor-core";
const check = (importedAt: string | null, time: string, cycle = "2026-10-15 18:00") => evaluateCycle({ feed: "queues", cycle, importedAt }, new Date(time));

test("alerts only after strictly more than 20 minutes since the successful import", () => {
  const importedAt = "2026-10-15T20:40:00Z";
  assert.equal(check(importedAt, "2026-10-15T20:59:59Z").status, "ok");
  assert.equal(check(importedAt, "2026-10-15T21:00:00Z").status, "ok");
  const late = check(importedAt, "2026-10-15T21:00:00.001Z");
  assert.equal(late.status, "late");
  assert.equal(late.delayMinutes, 20);
  assert.equal(late.expected, "2026-10-15 17:40");
});
test("fresh import with the screenshot's future cycle label remains healthy", () => {
  assert.equal(check("2026-10-15T20:58:00Z", "2026-10-15T20:59:00Z", "2026-10-15 18:00").status, "ok");
});
test("import time controls freshness regardless of old, future or missing cycle labels", () => {
  for (const cycle of ["2026-10-01 12:00", "2026-10-16 18:00", "bad-label"]) {
    assert.equal(check("2026-10-15T20:59:00Z", "2026-10-15T21:00:00Z", cycle).status, "ok");
    assert.equal(check("2026-10-15T20:00:00Z", "2026-10-15T21:00:00Z", cycle).status, "late");
  }
  assert.equal(evaluateCycle({ feed: "agents", cycle: null, importedAt: "2026-10-15T20:59:00Z" }, new Date("2026-10-15T21:00:00Z")).status, "ok");
});
test("elapsed time works across midnight, month and offset boundaries", () => {
  assert.equal(check("2026-09-01T02:50:00Z", "2026-09-01T03:10:00Z").status, "ok");
  assert.equal(check("2026-09-01T02:50:00Z", "2026-09-01T03:10:01Z").status, "late");
  assert.equal(check("2026-08-31T23:50:00-03:00", "2026-09-01T03:10:00Z").status, "ok");
});
test("missing, malformed and future import timestamps cannot count as healthy", () => {
  assert.equal(check(null, "2026-10-15T21:00:00Z").status, "missing");
  assert.equal(check("bad-time", "2026-10-15T21:00:00Z").status, "invalid");
  assert.equal(check("2026-10-15T21:01:00Z", "2026-10-15T21:00:00Z").status, "invalid");
});
test("one alert throughout an incident, independent feeds and one recovery", () => {
  const now = new Date("2026-10-15T21:00:00Z");
  const bad = check("2026-10-15T20:39:00Z", now.toISOString());
  const good = check("2026-10-15T20:59:00Z", now.toISOString());
  const first = transitionCycles({}, [bad, { ...good, feed: "agents" }], now);
  assert.equal(first.events.length, 1);
  const repeat = transitionCycles(first.state, [bad], new Date(now.getTime() + 3600000));
  assert.equal(repeat.events.length, 0);
  const recovery = transitionCycles(repeat.state, [good], now);
  assert.equal(recovery.events[0].kind, "recovered");
  assert.equal(transitionCycles(recovery.state, [good], now).events.length, 0);
  assert.equal(transitionCycles(recovery.state, [bad], new Date(now.getTime() + 7200000)).events.length, 1);
});
test("messages explain the freshness threshold and show the actual import time in Brasilia", () => {
  const now = new Date("2026-10-15T21:00:00Z");
  const health = check("2026-10-15T20:39:00Z", now.toISOString());
  const message = monitorMessage({ id: "test", kind: "late", health }, now);
  assert.match(message, /Última atualização: 2026-10-15 17:39/);
  assert.match(message, /mais de 20 minutos \(21 min/);
  assert.doesNotMatch(message, /Ciclo inválido|Ciclo esperado/);
  const preview = monitorMessage(null, now);
  assert.match(preview, /TESTE/);
  assert.match(preview, /Não indica uma falha real/);
  assert.match(preview, /mais de 20 minutos/);
  assert.match(preview, /<@=username\(wb_lucasy\)=>/);
});
