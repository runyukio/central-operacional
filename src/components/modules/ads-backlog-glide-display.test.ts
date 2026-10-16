import assert from "node:assert/strict";
import test from "node:test";
import { glideClearanceLabel, glideClock, glideIsStale, glideTimestamp } from "./ads-backlog-glide-display";

const fresh = { state: "projected" as const, sources: { snapshotAgeMinutes: 15, cycleAgeMinutes: 22 }, clearanceAt: Date.parse("2026-10-17T03:00:00Z") };

test("operational timestamps preserve Brasil wall-clock without a second offset", () => {
  assert.equal(glideClock(Date.parse("2026-10-16T11:00:00Z")), "16/10 · 11:00");
  assert.equal(glideClock("2026-10-17T00:00:00.000Z", false), "00:00");
  assert.equal(glideClock(null), "Sem dados");
  assert.equal(glideClock("invalid"), "Sem dados");
  const timezone = process.env.TZ;
  try {
    process.env.TZ = "America/Sao_Paulo";
    assert.equal(glideClock("2026-10-16 11:00"), "16/10 · 11:00");
    assert.equal(glideTimestamp("2026-10-16 11:00"), Date.parse("2026-10-16T11:00:00Z"));
    assert.equal(glideClock("2026-10-16_11-30"), "16/10 · 11:30");
  } finally {
    if (timezone === undefined) delete process.env.TZ;
    else process.env.TZ = timezone;
  }
  assert.equal(glideTimestamp("2026-02-31 11:00"), null);
});

test("ETA disappears when either source ages past 90 minutes on the client", () => {
  assert.equal(glideClearanceLabel(fresh), "17/10 · 03:00");
  assert.equal(glideIsStale(fresh, 68 * 60000), false);
  assert.equal(glideIsStale(fresh, 69 * 60000), true);
  assert.equal(glideClearanceLabel(fresh, 69 * 60000), "Aguardando dados atuais");
  assert.equal(glideIsStale({ ...fresh, sources: { snapshotAgeMinutes: 91, cycleAgeMinutes: 5 } }), true);
});

test("missing capacity, stale snapshots and failed refreshes never expose an ETA", () => {
  assert.equal(glideClearanceLabel({ ...fresh, state: "incomplete" }), "Sem projeção completa");
  assert.equal(glideClearanceLabel({ ...fresh, state: "stale" }), "Aguardando dados atuais");
  assert.equal(glideClearanceLabel(fresh, 0, true), "Atualização pendente");
  assert.equal(glideClearanceLabel({ ...fresh, state: "no-clearance", clearanceAt: null }), "Não limpa no horizonte");
  assert.equal(glideClearanceLabel({ ...fresh, clearanceAt: null }), "Não limpa no horizonte");
});
