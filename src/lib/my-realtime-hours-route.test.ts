import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { capturedHoursTotal, selectOwnCaptureRows } from "./personal-capture-hours";

const localRequire = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/api/realtime-hours/me/timeline/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function harness() {
  const own = { id: "own", wbLogin: "wb_agent", fullName: "Agente", roleTitle: "Agente", lob: { name: "CEC" }, shift: { name: "Noite" } };
  const row = { data: "2026-11-05", key: "own-row", employeeId: own.id, wbLogin: own.wbLogin, activeMs: 27_300_000, noActivityMs: 5_100_000, sessionCount: 1, segments: [] };
  const timeline = { date: row.data, window: {}, rows: [row, { ...row, data: "2026-11-06", activeMs: 99_000_000 }, { ...row, employeeId: "other", activeMs: 99_000_000 }] };
  const adjust = (rows: typeof row[]) => rows.map((r) => ({ ...r, capturedActiveMs: r.activeMs, consideredActiveMs: r.activeMs + 600_000, consideredNoActivityMs: r.noActivityMs, approvedAdjustment: { requestedActiveHours: "7:45" } }));
  const calls: unknown[] = [];
  const imports: Record<string, unknown> = {
    "@/lib/api-actor": { getApiActor: async () => ({ email: "wb_agent@example.test", role: "COLABORADOR" }) },
    "@/lib/prisma": { prisma: { employeeProfile: { findFirst: async () => own } } },
    "@/lib/realtime-hours-permissions": { canAccessOwnRealtimeHours: () => true },
    "@/lib/personal-capture-hours": { capturedHoursTotal, selectOwnCaptureRows },
    "@/lib/realtime-hours-service": {
      getRealtimeHoursTimeline: async (args: unknown) => { calls.push(args); return timeline; },
      getRealtimeHoursTimelineRange: async (args: unknown) => { calls.push(args); return [timeline]; }
    },
    "@/lib/realtime-hours-adjustments-service": {
      applyApprovedRealtimeHoursAdjustments: async (_date: string, rows: typeof row[]) => adjust(rows),
      applyApprovedRealtimeHoursAdjustmentsForRange: async (days: Array<{ rows: typeof row[] }>) => days.map((day) => ({ ...day, rows: adjust(day.rows) }))
    }
  };
  const compiledModule = { exports: {} as { GET: (request: Request) => Promise<Response> } };
  new Function("require", "exports", "module", compiled)((name: string) => imports[name] ?? localRequire(name), compiledModule.exports, compiledModule);
  return { ...compiledModule.exports, calls };
}
test("Minhas Horas diário mantém a captura canônica separada do ajuste e exclui outro turno/pessoa", async () => {
  const route = harness();
  const response = await route.GET(new Request("https://example.test/api/realtime-hours/me/timeline?date=2026-11-05&employeeId=other"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.rows.length, 1);
  assert.equal(payload.summary.capturedActiveMs, 27_300_000);
  assert.equal(payload.summary.activeMs, 27_900_000);
  assert.ok(payload.queriedAt);
  assert.equal((route.calls[0] as { employeeId: string }).employeeId, "own");
});
test("Minhas Horas por período usa os mesmos valores capturados do extrato diário", async () => {
  const route = harness();
  const response = await route.GET(new Request("https://example.test/api/realtime-hours/me/timeline?startDate=2026-11-05&endDate=2026-11-05"));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.days[0].rows.length, 1);
  assert.equal(payload.summary.capturedActiveMs, 27_300_000);
  assert.equal(payload.days[0].summary.capturedActiveMs, payload.summary.capturedActiveMs);
  assert.equal(payload.summary.activeMs, 27_900_000);
  assert.equal(payload.summary.approvedAdjustments, 1);
});
