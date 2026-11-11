import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { getMyRealtime, myRealtimeData } from "./my-realtime-service";
import { mockPrismaDelegate } from "./prisma-test-delegate";
import { prisma } from "./prisma";
import { canAccessPathForRole, getNavSections } from "./navigation";

const now = new Date("2026-11-05T12:00:00Z");
const actor = { email: "own@example.test", name: "Ana Silva", role: "COLABORADOR" as const };
const profile = { id: "own-id", wbLogin: "own", fullName: "Ana Silva", lob: { name: "ADS" }, user: { email: actor.email } };
const schedule = { id: "slot", employeeId: profile.id, date: new Date("2026-11-05T00:00:00Z"), startsAt: "08:00", endsAt: "17:00", status: "ESCALADO", shift: null };

function fixture(t: TestContext, lob = "ADS") {
  const profiles = mockPrismaDelegate(t, "employeeProfile", { findMany: async () => [{ ...profile, lob: { name: lob } }] });
  const schedules = mockPrismaDelegate(t, "schedule", { findMany: async () => [schedule] });
  const raw = t.mock.method(prisma, "$queryRaw", async () => ["08:00", "08:30", "09:00"].map((time, index) => ({
    cycleDownload: `2026-11-05 ${time}`, importedAt: now, submit: index * 10, moderationMs: index * 1000, refresh: index, timeout: index
  })) as any);
  const timeline = t.mock.method(myRealtimeData, "timeline", async () => ({ success: true, rows: [
    { data: "2026-11-05", activeMs: 7_200_000, employeeId: profile.id, wbLogin: profile.wbLogin, lastSeenAt: now.toISOString(), segments: [{ type: "ACTIVE", start: "2026-11-05T10:00:00Z", end: now.toISOString() }] },
    { data: "2026-11-05", activeMs: 0, employeeId: "someone-else", wbLogin: "other", lastSeenAt: now.toISOString(), segments: [] }
  ] }) as any);
  return { profiles, schedules, raw, timeline };
}

test("consulta pessoal restringe cadastro, escala, SQL e captura ao usuário autenticado", async (t) => {
  const { profiles, schedules, raw, timeline } = fixture(t);
  const result = await getMyRealtime(actor, now);
  assert.ok("success" in result);
  assert.equal(result.employee.wbLogin, "own");
  assert.equal(result.productivity.metrics?.submit, 20);
  assert.equal(result.productivity.metrics?.ahtMs, 100);
  assert.equal(result.intervals.find((row) => row.hour === "2026-11-05T11:00:00.000Z")?.metrics?.submit, 20);
  assert.equal(result.capture.capturedMs, 7_200_000);
  assert.equal(result.intervals[0].captureOnly, true);
  assert.equal(result.intervals.reduce((sum, row) => sum + (row.capturedMs ?? 0), 0), result.capture.capturedMs);
  const lookup = profiles.findMany.mock.calls[0].arguments[0].where.OR;
  assert.equal(lookup[0].user.email.equals, actor.email);
  assert.equal(lookup[1].userId, null);
  assert.equal(lookup[1].wbLogin.equals, "own");
  assert.equal(schedules.findMany.mock.calls[0].arguments[0].where.employeeId, profile.id);
  assert.deepEqual(timeline.mock.calls[0].arguments[0], { date: "2026-11-05", employeeId: profile.id, wbLogin: "own" });
  const sql = raw.mock.calls[0].arguments[0] as unknown as { values: unknown[]; text: string };
  assert.ok(sql.values.includes(profile.id));
  assert.ok(sql.values.includes(profile.wbLogin));
  assert.match(sql.text, /LEFT JOIN/);
  assert.match(sql.text, /COUNT\(a.id\) = 1/);
  assert.ok(!JSON.stringify(result).includes("someone-else"));
});

test("COMMENTS consulta produção e captura do próprio turno", async (t) => {
  const { timeline } = fixture(t, "COMMENTS");
  const result = await getMyRealtime(actor, now);
  assert.ok("success" in result);
  assert.equal(result.employee.lob, "COMMENTS");
  assert.equal(result.kind, "moderation");
  assert.equal(result.shift?.date, "2026-11-05");
  assert.equal(result.productivity.metrics?.submit, 20);
  assert.equal(result.intervals.find((row) => row.hour === "2026-11-05T11:00:00.000Z")?.metrics?.submit, 20);
  assert.equal(result.capture.capturedMs, 7_200_000);
  assert.deepEqual(timeline.mock.calls[0].arguments[0], { date: "2026-11-05", employeeId: profile.id, wbLogin: profile.wbLogin });
});

test("conta vinculada prevalece sobre fallback de WB, sem ampliar a identidade", async (t) => {
  const { profiles } = fixture(t);
  profiles.findMany.mock.mockImplementation(async () => [profile, { ...profile, id: "legacy-id", user: null }]);
  const result = await getMyRealtime(actor, now);
  assert.ok("success" in result);
  assert.equal(result.employee.fullName, profile.fullName);
});

test("ausência ou ambiguidade de vínculo não consulta métricas", async (t) => {
  const { profiles, raw, timeline } = fixture(t);
  profiles.findMany.mock.mockImplementation(async () => []);
  assert.equal((await getMyRealtime(actor, now) as { status: number }).status, 404);
  profiles.findMany.mock.mockImplementation(async () => [{ ...profile, user: null }, { ...profile, id: "other", user: null }]);
  assert.equal((await getMyRealtime(actor, now) as { status: number }).status, 404);
  assert.equal(raw.mock.callCount(), 0);
  assert.equal(timeline.mock.callCount(), 0);
});

test("sem sessão ou perfil autorizado não consulta cadastro nem dados", async (t) => {
  const { profiles } = fixture(t);
  assert.equal((await getMyRealtime({ ...actor, email: "" }, now) as { status: number }).status, 401);
  assert.equal((await getMyRealtime({ ...actor, role: "CLIENT" }, now) as { status: number }).status, 403);
  assert.equal(profiles.findMany.mock.callCount(), 0);
});

test("sem escala ou fora da janela da jornada não consulta fontes", async (t) => {
  const { schedules, raw, timeline } = fixture(t);
  schedules.findMany.mock.mockImplementation(async () => []);
  const missing = await getMyRealtime(actor, now);
  assert.ok("success" in missing);
  assert.equal(missing.shiftState, "no_schedule");
  schedules.findMany.mock.mockImplementation(async () => [schedule]);
  const outside = await getMyRealtime(actor, new Date("2026-11-06T05:00:00Z"));
  assert.ok("success" in outside);
  assert.equal(outside.shiftState, "outside_shift");
  assert.equal(raw.mock.callCount(), 0);
  assert.equal(timeline.mock.callCount(), 0);
});

test("antes das 14h mostra produção e captura antecipadas, incluindo o reset das 13h", async (t) => {
  const { schedules, raw, timeline } = fixture(t, "VIDEO");
  schedules.findMany.mock.mockImplementation(async () => [{ ...schedule, startsAt: "14:00", endsAt: "23:00" }]);
  raw.mock.mockImplementation(async () => [
    ["12:00", 100, 10_000], ["12:30", 120, 12_000], ["13:00", 0, 0], ["13:30", 41, 4_100]
  ].map(([time, submit, moderationMs]) => ({ cycleDownload: `2026-11-05 ${time}`, importedAt: now,
    submit, moderationMs, refresh: 0, timeout: 0 })));
  timeline.mock.mockImplementation(async () => ({ rows: [{ data: "2026-11-05", employeeId: profile.id, wbLogin: profile.wbLogin,
    activeMs: 5_400_000, lastSeenAt: "2026-11-05T16:30:00Z", segments: [{ type: "ACTIVE", start: "2026-11-05T15:00:00Z", end: "2026-11-05T16:30:00Z" }] }] }));
  const result = await getMyRealtime(actor, new Date("2026-11-05T16:30:00Z"));
  assert.ok("success" in result);
  assert.equal(result.shiftState, "before_shift");
  assert.equal(result.shift?.startsAt, "14:00");
  assert.equal(result.productivity.metrics?.submit, 61);
  assert.equal(result.capture.capturedMs, 5_400_000);
  assert.equal(result.intervals.find((row) => row.hour === "2026-11-05T16:00:00.000Z")?.metrics?.submit, 41);
  assert.ok(result.intervals.filter((row) => row.metrics).every((row) => !row.captureOnly));
  assert.equal(result.intervals.reduce((sum, row) => sum + (row.capturedMs ?? 0), 0), result.capture.capturedMs);
  const dates = schedules.findMany.mock.calls[0].arguments[0].where.date.in.map((date: Date) => date.toISOString().slice(0, 10));
  assert.deepEqual(dates, ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
  assert.ok((raw.mock.calls[0].arguments[0] as unknown as { values: unknown[] }).values.includes("2026-11-05 06:00"));
});

test("extensão após as 23h mantém a produção da madrugada no Shift Date de origem", async (t) => {
  const { schedules, raw, timeline } = fixture(t, "VIDEO");
  schedules.findMany.mock.mockImplementation(async () => [
    { ...schedule, startsAt: "14:00", endsAt: "23:00" },
    { ...schedule, id: "next", date: new Date("2026-11-06T00:00:00Z"), startsAt: "08:00", endsAt: "17:00" }
  ]);
  raw.mock.mockImplementation(async () => [
    ["2026-11-05 22:30", 100], ["2026-11-05 23:00", 110], ["2026-11-05 23:30", 130],
    ["2026-11-06 00:00", 160], ["2026-11-06 00:30", 200], ["2026-11-06 01:00", 250]
  ].map(([cycleDownload, submit]) => ({ cycleDownload, importedAt: now, submit, moderationMs: Number(submit) * 1_000, refresh: 0, timeout: 0 })));
  timeline.mock.mockImplementation(async () => ({ rows: [{ data: "2026-11-05", employeeId: profile.id, wbLogin: profile.wbLogin,
    activeMs: 9_000_000, lastSeenAt: "2026-11-06T04:00:00Z", segments: [{ type: "ACTIVE", start: "2026-11-06T01:30:00Z", end: "2026-11-06T04:00:00Z" }] }] }));
  const result = await getMyRealtime(actor, new Date("2026-11-06T04:00:00Z"));
  assert.ok("success" in result);
  assert.equal(result.shiftState, "after_shift");
  assert.equal(result.shift?.date, "2026-11-05");
  assert.equal(result.productivity.metrics?.submit, 150);
  assert.equal(result.capture.capturedMs, 9_000_000);
  assert.equal(result.intervals.find((row) => row.hour === "2026-11-06T03:00:00.000Z")?.metrics?.submit, 90);
  assert.deepEqual(result.productivity.resetCycles, []);
  assert.equal(timeline.mock.calls[0].arguments[0]?.date, "2026-11-05");
});

test("CEC antecipado mantém o último CPD como snapshot, sem somar os ciclos", async (t) => {
  const { schedules, raw } = fixture(t, "CEC");
  schedules.findMany.mock.mockImplementation(async () => [{ ...schedule, startsAt: "14:00", endsAt: "23:00" }]);
  raw.mock.mockImplementation(async () => ["12:30", "13:00", "13:30"].map((time, index) => ({
    cycleDownload: `2026-11-05 ${time}`, importedAt: now, rawData: { agents: [{ agentName: profile.fullName, cpd: index + 1 }] }
  })));
  const result = await getMyRealtime(actor, new Date("2026-11-05T16:30:00Z"));
  assert.ok("success" in result);
  assert.equal(result.shiftState, "before_shift");
  assert.equal(result.productivity.cpd, 3);
  assert.equal(result.intervals.find((row) => row.hour === "2026-11-05T16:00:00.000Z")?.cpd, 3);
});

test("falha de produtividade preserva captura e falha de captura preserva produtividade", async (t) => {
  const { raw, timeline } = fixture(t);
  t.mock.method(console, "error", () => {});
  raw.mock.mockImplementation(async () => { throw new Error("source offline"); });
  const result = await getMyRealtime(actor, now);
  assert.ok("success" in result);
  assert.equal(result.capture.capturedMs, 7_200_000);
  assert.equal(result.productivity.metrics, null);
  assert.ok(result.productivity.message);
  raw.mock.mockImplementation(async () => ["08:00", "08:30"].map((time, index) => ({ cycleDownload: `2026-11-05 ${time}`, importedAt: now,
    submit: index * 10, moderationMs: index, refresh: index, timeout: index })));
  timeline.mock.mockImplementation(async () => { throw new Error("capture offline"); });
  const second = await getMyRealtime(actor, now);
  assert.ok("success" in second);
  assert.equal(second.productivity.metrics?.submit, 10);
  assert.equal(second.capture.capturedMs, null);
  assert.ok(second.capture.message);
});

test("CEC mantém apenas o CPD do último ciclo sem somar snapshots nem expor outros nomes", async (t) => {
  const { raw } = fixture(t, "CEC");
  raw.mock.mockImplementation(async () => ["08:00", "09:00"].map((time, index) => ({ cycleDownload: `2026-11-05 ${time}`, importedAt: now,
    rawData: { agents: [{ agentName: "Ana Silva", cpd: index ? 3 : 7 }, { agentName: "Outro Nome", cpd: 100 }] } })));
  const result = await getMyRealtime(actor, now);
  assert.ok("success" in result);
  assert.equal(result.kind, "cec");
  assert.equal(result.productivity.cpd, 3);
  assert.deepEqual(result.intervals.filter((interval) => interval.cpd !== null).map((interval) => interval.cpd), [7, 3]);
  assert.ok(!JSON.stringify(result).includes("Outro Nome"));
});

test("nomes homônimos no CEC ficam indisponíveis, sem atribuir números", async (t) => {
  const { raw, profiles } = fixture(t, "CEC");
  profiles.findMany.mock.mockImplementation(async (args: any) => args.where ? [{ ...profile, lob: { name: "CEC" } }] : [{ fullName: "Ana Silva" }, { fullName: " Ana Silva " }]);
  raw.mock.mockImplementation(async () => [{ cycleDownload: "2026-11-05 09:00", importedAt: now, rawData: { agents: [{ agentName: "Ana Silva", cpd: 10 }] } }]);
  const result = await getMyRealtime(actor, now);
  assert.ok("success" in result);
  assert.equal(result.productivity.cpd, null);
  assert.ok(result.productivity.message);
});

test("serviço mantém a produção antes das 13h no mesmo Shift Date e entrega uma linha por hora", async (t) => {
  const { raw } = fixture(t);
  raw.mock.mockImplementation(async () => [
    ["12:00", 100, 10_000], ["12:30", 150, 11_000], ["13:00", 0, 0], ["13:30", 10, 1_000], ["14:00", 40, 4_000]
  ].map(([time, submit, moderationMs]) => ({ cycleDownload: `2026-11-05 ${time}`, importedAt: now, submit, moderationMs, refresh: 0, timeout: 0 })));
  const result = await getMyRealtime(actor, new Date("2026-11-05T17:00:00Z"));
  assert.ok("success" in result);
  assert.equal(result.shift?.date, "2026-11-05");
  assert.equal(result.productivity.metrics?.submit, 90);
  assert.equal(result.productivity.metrics?.ahtMs, 5_000 / 90);
  assert.equal(result.intervals.find((row) => row.hour === "2026-11-05T16:00:00.000Z")?.metrics?.submit, 40);
  assert.deepEqual(result.productivity.resetCycles, ["2026-11-05 13:00"]);
});

test("serviço noturno consulta a escala de origem e entrega 22h, 23h, 00h, 01h e 02h na ordem real", async (t) => {
  const { raw, schedules, timeline } = fixture(t);
  schedules.findMany.mock.mockImplementation(async () => [{ ...schedule, date: new Date("2026-11-04T00:00:00Z"), startsAt: "22:00", endsAt: "06:00" }]);
  const cycles = ["2026-11-04 22:00", "2026-11-04 22:30", "2026-11-04 23:00", "2026-11-04 23:30", "2026-11-05 00:00", "2026-11-05 00:30", "2026-11-05 01:00", "2026-11-05 01:30", "2026-11-05 02:00"];
  raw.mock.mockImplementation(async () => cycles.map((cycleDownload, index) => ({ cycleDownload, importedAt: now,
    submit: 1000 + index * 100, moderationMs: 10_000_000 + index * 900_000, refresh: index, timeout: index })));
  const result = await getMyRealtime(actor, new Date("2026-11-05T05:00:00Z"));
  assert.ok("success" in result);
  assert.equal(result.shift?.date, "2026-11-04");
  assert.equal(result.productivity.metrics?.submit, 800);
  assert.equal(result.productivity.metrics?.ahtMs, 9_000);
  assert.deepEqual(result.productivity.resetCycles, []);
  assert.deepEqual(result.intervals.map((row) => new Date(Date.parse(row.hour!) - 3 * 3_600_000).getUTCHours()), [22, 23, 0, 1, 2]);
  assert.equal(timeline.mock.calls[0].arguments[0]?.date, "2026-11-04");
});

test("menu Rotina e API pessoal permitem colaborador e bloqueiam cliente/inativo", () => {
  const own = { ...actor, status: "ACTIVE" };
  assert.ok(getNavSections(own).find((section) => section.label === "Rotina")?.items.some((item) => item.href === "/meu-real-time"));
  for (const path of ["/meu-real-time", "/api/realtime/me", "/api/realtime/me/anything"]) {
    assert.equal(canAccessPathForRole(path, own), true);
    assert.equal(canAccessPathForRole(path, { role: "CLIENT", status: "ACTIVE" }), false);
    assert.equal(canAccessPathForRole(path, { ...own, status: "INACTIVE" }), false);
  }
  assert.equal(canAccessPathForRole("/api/realtime", own), false);
});
