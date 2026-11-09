import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { getRealtimeHoursTimeline, getRealtimeHoursTimelineRange } from "./realtime-hours-service";
import { filterRealtimeHoursTimelineRows } from "./realtime-hours-timeline";
import { mockPrismaDelegate } from "./prisma-test-delegate";
import { prisma } from "./prisma";

function fixture(t: TestContext, date: string) {
  const profiles = [
    { id: "ads", wbLogin: "wb_ads", fullName: "ADS agent", roleTitle: "Agente", skill: "ADS", operationalStatus: "ACTIVE", lob: { name: "ADS" }, supervisor: { fullName: "Líder" }, shift: { name: "Noite", startsAt: "23:00", endsAt: "08:00" } },
    { id: "cec", wbLogin: "wb_cec", fullName: "CEC agent", roleTitle: "Agente", skill: "CEC", operationalStatus: "ACTIVE", lob: { name: "CEC" }, supervisor: { fullName: "Outro" }, shift: { name: "Noite", startsAt: "23:00", endsAt: "08:00" } }
  ];
  const day = new Date(`${date}T00:00:00Z`);
  const next = new Date(day); next.setUTCDate(day.getUTCDate() + 1);
  const nextKey = next.toISOString().slice(0, 10);
  const captures = [
    { hostname: "MAPPED", windowsUser: "old-user", wbLogin: "old-login", employeeId: null },
    { hostname: "CEC", windowsUser: "cec", wbLogin: "wb_cec", employeeId: "cec" },
    { hostname: "UNKNOWN", windowsUser: "unknown", wbLogin: "unknown", employeeId: null }
  ].flatMap((identity) => [0, 1, 2].map((minute) => ({
    ...identity, capturedAt: new Date(`${nextKey}T02:0${minute}:00Z`), eventType: "HEARTBEAT", sessionState: "ACTIVE",
    isSessionActive: true, activeProcessName: "chrome", idleSeconds: 0, lastActivityAt: null, ipAddress: null
  })));
  const mapping = { hostname: "MAPPED", windowsUser: "old-user", wbLogin: "wb_ads", employeeId: "ads" };
  const rawReads: any[] = [];
  mockPrismaDelegate(t, "realTimeHoursArchiveDay", { findUnique: async () => null, findMany: async () => [] });
  mockPrismaDelegate(t, "auditLog", { findMany: async () => [{ newValue: { date, employeeId: "ads", entryAt: `${nextKey}T02:01:00.000Z` } }] });
  mockPrismaDelegate(t, "realTimeHoursIdentityMapping", { findMany: async () => [mapping] });
  mockPrismaDelegate(t, "employeeProfile", { findMany: async (args: any) => !args.where ? profiles : profiles.filter((profile) => args.where.OR.some((part: any) =>
    part.id?.in?.includes(profile.id) || part.wbLogin?.equals?.toLowerCase() === profile.wbLogin)) });
  mockPrismaDelegate(t, "schedule", { findMany: async (args: any) => profiles.filter((profile) => args.where.employeeId.in.includes(profile.id)).map((profile) => ({
    id: `slot-${profile.id}`, employeeId: profile.id, date: day, startsAt: "23:00", endsAt: "08:00", status: "ESCALADO", shift: profile.shift
  })) });
  mockPrismaDelegate(t, "realTimeHoursRecord", { findMany: async (args: any) => {
    rawReads.push(args);
    return captures.filter((capture) => !args.where.OR || args.where.OR.some((part: any) =>
      part.employeeId?.in?.includes(capture.employeeId)
      || part.wbLogin?.in?.includes(capture.wbLogin)
      || (part.hostname === capture.hostname && part.windowsUser === capture.windowsUser)));
  } });
  return { rawReads, captures };
}

test("LOB/supervisor pre-read scope preserves mapped identities, overnight slots and confirmed entries", async (t) => {
  const date = "2026-09-10";
  const data = fixture(t, date);
  const complete = await getRealtimeHoursTimeline({ date });
  const expected = filterRealtimeHoursTimelineRows(complete.rows, { date, lob: "ADS", supervisor: "lider" });
  const scoped = await getRealtimeHoursTimeline({ date, lob: "ADS", supervisor: "lider" });
  assert.equal(expected.length, 1);
  assert.deepEqual(scoped.rows, expected);
  assert.equal(scoped.rows[0].data, date, "after-midnight captures retain the originating shift date");
  assert.equal(scoped.rows[0].entryAt, "2026-09-11T02:01:00.000Z");
  assert.ok(data.rawReads[1].where.OR.some((part: any) => part.employeeId?.in?.includes("ads")));
  assert.ok(data.rawReads[1].where.OR.some((part: any) => part.hostname === "MAPPED"), "a mapped historical login must not disappear");
  assert.equal(scoped.sourceRecords, 3);
  assert.equal(complete.sourceRecords, 9);
  assert.equal(scoped.summary.activeMs, expected.reduce((sum, row) => sum + row.activeMs, 0));
});

test("fresh archives retain their captured roster and share only concurrent validation", async (t) => {
  const date = "2026-08-04";
  fixture(t, date);
  const complete = await getRealtimeHoursTimeline({ date });
  const archive = { dateKey: date, sourceFingerprint: "fresh", sourceRecords: 9,
    windowStart: new Date(complete.window.start), windowEnd: new Date(complete.window.end), calculationEnd: new Date(complete.window.calculationEnd),
    rows: complete.rows.map((payload) => ({ payload })) };
  mockPrismaDelegate(t, "realTimeHoursArchiveDay", { findUnique: async () => archive });
  mockPrismaDelegate(t, "employeeProfile", { findMany: async () => { throw new Error("a current roster must not remove a matching historical row"); } });
  let validations = 0;
  t.mock.method(prisma, "$queryRaw", async () => {
    validations++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return [{ dateKey: date, fingerprint: "fresh", sourceRecords: 9, preservedSourceRecords: 9 }];
  });
  const [ads, cec] = await Promise.all([
    getRealtimeHoursTimeline({ date, lob: "ADS" }), getRealtimeHoursTimeline({ date, lob: "CEC" })
  ]);
  assert.equal(validations, 1, "simultaneous filters validate the same archive once");
  assert.deepEqual(ads.rows, filterRealtimeHoursTimelineRows(complete.rows, { date, lob: "ADS" }));
  assert.deepEqual(cec.rows, filterRealtimeHoursTimelineRows(complete.rows, { date, lob: "CEC" }));
  await getRealtimeHoursTimeline({ date, lob: "ADS", supervisor: "lider" });
  assert.equal(validations, 2, "a later validation must not reuse a completed fingerprint query");
});

test("a period loads confirmed entries once, preserving each shift date", async (t) => {
  const date = "2026-08-08";
  fixture(t, date);
  const corrections = mockPrismaDelegate(t, "auditLog", { findMany: async () => [{ newValue: { date, employeeId: "ads", entryAt: "2026-08-09T02:01:00.000Z" } }] }).findMany;
  const days = await getRealtimeHoursTimelineRange({ dates: ["2026-08-07", date], employeeId: "ads", wbLogin: "wb_ads" });
  assert.equal(corrections.mock.callCount(), 1);
  assert.equal(days.find((day) => day.date === date)?.rows[0].entryAt, "2026-08-09T02:01:00.000Z");
});

test("Sem LOB keeps unlinked stations rather than narrowing to known employee profiles", async (t) => {
  const date = "2026-09-12";
  const data = fixture(t, date);
  const complete = await getRealtimeHoursTimeline({ date });
  const scoped = await getRealtimeHoursTimeline({ date, lob: "SEM_LOB", supervisor: "Sem supervisor" });
  assert.deepEqual(scoped.rows, filterRealtimeHoursTimelineRows(complete.rows, { date, lob: "SEM_LOB", supervisor: "Sem supervisor" }));
  assert.ok(scoped.rows.some((row) => row.hostname === "UNKNOWN"));
  assert.equal(data.rawReads[1].where.OR, undefined);
});
