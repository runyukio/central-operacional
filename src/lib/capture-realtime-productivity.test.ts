import assert from "node:assert/strict";
import test from "node:test";
import { calculateCaptureProductivity, captureProductivityWindow, type CaptureProductivityReading } from "./capture-realtime-productivity";
import { readCaptureRealtimeProductivity } from "./capture-realtime-productivity-service";
import { prisma } from "./prisma";

const slot = { id: "div-night", wbLogin: " WB_Agent ", date: "2026-10-31", startsAt: "23:00", endsAt: "00:30" };
const reading = (cycleDownload: string, submit: number | null, moderationMs: number | null = (submit ?? 0) * 60_000): CaptureProductivityReading =>
  ({ cycleDownload, wbLoginNormalized: "wb_agent", submit, moderationMs });

test("usa a janela histórica e atribui a madrugada ao Shift Date inicial", () => {
  const points = [reading("2026-10-31 22:30", 50), reading("2026-10-31 23:00", 100), reading("2026-10-31 23:30", 110),
    reading("2026-11-01 00:00", 125), reading("2026-11-01 00:30", 130), reading("2026-11-01 01:00", 300)];
  assert.deepEqual(calculateCaptureProductivity(slot, points), { status: "complete", submit: 30, moderationMs: 1_800_000 });
  assert.deepEqual(calculateCaptureProductivity({ ...slot, date: "2026-11-01" }, points), { status: "unavailable", submit: null, moderationMs: null });
});

test("soma os trechos antes e depois de reinícios independentes dos contadores", () => {
  const result = calculateCaptureProductivity(slot, [reading("2026-10-31 23:00", 100, 1000), reading("2026-10-31 23:30", 110, 1500),
    reading("2026-11-01 00:00", 5, 2000), reading("2026-11-01 00:30", 9, 200)]);
  assert.deepEqual(result, { status: "complete", submit: 19, moderationMs: 1200 });
});

test("zero observado é diferente de WB ausente, e não preenche leituras ausentes com zero", () => {
  const points = [reading("2026-10-31 23:00", 0), reading("2026-10-31 23:30", 0), reading("2026-11-01 00:00", 0), reading("2026-11-01 00:30", 0)];
  assert.deepEqual(calculateCaptureProductivity(slot, points), { status: "complete", submit: 0, moderationMs: 0 });
  assert.equal(calculateCaptureProductivity({ ...slot, wbLogin: "other" }, points).status, "unavailable");
  points[2] = { ...points[2], wbLoginNormalized: "other" };
  assert.deepEqual(calculateCaptureProductivity(slot, points), { status: "partial", submit: 0, moderationMs: 0 });
});

test("lacunas, falta de pontas e métricas inválidas sinalizam parciais sem somar trechos desconhecidos", () => {
  const points = [reading("2026-10-31 23:00", 100), reading("2026-10-31 23:30", 110), reading("2026-11-01 00:30", 200)];
  assert.deepEqual(calculateCaptureProductivity(slot, points), { status: "partial", submit: 10, moderationMs: 600_000 });
  assert.equal(calculateCaptureProductivity(slot, points.slice(0, 2)).status, "partial");
  assert.equal(calculateCaptureProductivity(slot, [points[0], reading("2026-10-31 23:30", null)]).status, "unavailable");
  assert.equal(calculateCaptureProductivity(slot, [points[0], reading("2026-10-31 23:30", 110, NaN)]).status, "unavailable");
});

test("não inventa horários nem rateia produtividade em limites sem leitura exata", () => {
  assert.equal(captureProductivityWindow({ ...slot, startsAt: null }), null);
  assert.equal(captureProductivityWindow({ ...slot, endsAt: "25:00" }), null);
  const points = [reading("2026-10-31 23:00", 100), reading("2026-10-31 23:30", 110), reading("2026-11-01 00:00", 120), reading("2026-11-01 00:30", 130)];
  assert.deepEqual(calculateCaptureProductivity({ ...slot, startsAt: "23:15", endsAt: "00:15" }, points), { status: "partial", submit: 10, moderationMs: 600_000 });
});

test("leitura em lote escolhe o último SUCCESS por ciclo antes de filtrar WBs e mantém ciclos sem o agente", async (t) => {
  const query = t.mock.method(prisma, "$queryRaw", async (sql: any) => {
    assert.match(sql.sql, /DISTINCT ON \("cycleDownload"\)/);
    assert.match(sql.sql, /"importedAt" DESC, id DESC/);
    assert.match(sql.sql, /b.status = 'SUCCESS'/);
    assert.match(sql.sql, /LEFT JOIN "RealTimeAgentCycleSummary"/);
    assert.ok(sql.sql.indexOf('WITH candidates') < sql.sql.indexOf('"wbLoginNormalized" IN'));
    assert.ok(sql.values.includes("2026-11-01 00:30"));
    assert.ok(sql.values.includes("wb_agent"));
    return [reading("2026-10-31 23:00", 100), reading("2026-10-31 23:30", 110),
      { cycleDownload: "2026-11-01 00:00", wbLoginNormalized: null, submit: null, moderationMs: null }, reading("2026-11-01 00:30", 130)];
  });
  const result = await readCaptureRealtimeProductivity([slot, { ...slot, id: "other", wbLogin: "other" }]);
  assert.deepEqual(result.get(slot.id), { status: "partial", submit: 10, moderationMs: 600_000 });
  assert.equal(result.get("other")?.status, "unavailable");
  assert.equal(query.mock.callCount(), 1);
  assert.equal((await readCaptureRealtimeProductivity([])).size, 0);
  assert.equal(query.mock.callCount(), 1);
});
