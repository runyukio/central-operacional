import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { hasOwnTeamAbsenceDelegation } from "./attendance-delegation";
import { updateOperationalAttendance, editOperationalSchedule } from "./schedule-service";
import { canEditSchedule, canJustifyAbsence } from "./permissions";
import { prisma } from "./prisma";
import { mockPrismaDelegate } from "./prisma-test-delegate";

const delegatedId = "cmpbf948w000n39oj3c3p6m0o";
const actor = { email: "manager@example.test", name: "Authorized manager", role: "GESTOR" as const };
const date = new Date("2026-09-08T00:00:00Z");
type Row = Record<string, any>;
const input = { attendanceRecordId: "absence", scheduleId: "slot", employeeId: "partner", date: "2026-09-08", shift: "Tarde", status: "Falta",
  absenceReason: "Problema de saúde", supervisorJustification: "Descrição de teste", reasonCategory: "Cronograma" };

function fixture(t: TestContext) {
  const user: Row = { id: "manager-user", email: actor.email, name: actor.name, role: { name: "GESTOR" }, status: "ACTIVE", deletedAt: null,
    employeeProfile: { id: delegatedId, wbLogin: "wb_manager_test", deletedAt: null } };
  const shift = { id: "afternoon", name: "Tarde", startsAt: "08:00", endsAt: "17:00" };
  const employee: Row = { id: "partner", fullName: "Test partner", wbLogin: "wb_partner", supervisorId: delegatedId,
    supervisor: { fullName: actor.name }, shift, lob: { name: "VIDEO" }, deletedAt: null };
  const schedule: Row = { id: "slot", employeeId: employee.id, date, status: "FALTA", shift, startsAt: "08:00", endsAt: "17:00", deletedAt: null };
  const record: Row = { id: "absence", employeeId: employee.id, scheduleId: schedule.id, shiftId: shift.id, date, status: "FALTA",
    isJustified: false, registeredAt: date, createdAt: date, updatedAt: date, hasEvidence: false };
  const writes: Array<{ model: string; data: Row }> = [];
  const current = { authorized: true, sameTeam: true, sameSchedule: true };
  mockPrismaDelegate(t, "user", { findUnique: async () => user, findMany: async () => [] });
  mockPrismaDelegate(t, "employeeProfile", { findFirst: async () => employee });
  mockPrismaDelegate(t, "schedule", { findFirst: async () => schedule, findUnique: async () => schedule });
  mockPrismaDelegate(t, "attendanceRecord", { findUnique: async () => record, findFirst: async () => record });
  mockPrismaDelegate(t, "auditLog", { create: async () => ({}) });
  const write = (model: string, original: Row = {}) => async ({ data }: { data: Row }) => {
    writes.push({ model, data });
    return { ...original, ...data, updatedAt: date };
  };
  const tx = {
    user: { findUnique: async () => current.authorized ? user : { ...user, status: "INACTIVE" } },
    employeeProfile: { findFirst: async () => current.sameTeam ? employee : null },
    schedule: { findFirst: async () => current.sameSchedule ? schedule : null, update: write("schedule", schedule) },
    attendanceRecord: { update: write("attendanceRecord", record), create: write("attendanceRecord", record) },
    attendanceHistory: { create: write("attendanceHistory") }, scheduleChangeHistory: { create: write("scheduleChangeHistory") },
    auditLog: { create: write("auditLog") }
  };
  const original = prisma.$transaction;
  prisma.$transaction = (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as unknown as typeof original;
  t.after(() => { prisma.$transaction = original; });
  return { user, employee, schedule, record, writes, current };
}

test("only the explicitly authorized active manager profile receives the delegation", () => {
  const user = { role: { name: "GESTOR" }, status: "ACTIVE", employeeProfile: { id: delegatedId, deletedAt: null } };
  assert.equal(hasOwnTeamAbsenceDelegation(user), true);
  assert.equal(hasOwnTeamAbsenceDelegation({ ...user, employeeProfile: { id: "other-id", deletedAt: null } }), false);
  assert.equal(hasOwnTeamAbsenceDelegation({ ...user, status: "INACTIVE" }), false);
  assert.equal(hasOwnTeamAbsenceDelegation({ ...user, deletedAt: date }), false);
  assert.equal(hasOwnTeamAbsenceDelegation({ ...user, employeeProfile: { id: delegatedId, deletedAt: date } }), false);
  assert.equal(hasOwnTeamAbsenceDelegation({ ...user, role: { name: "COLABORADOR" } }), false);
  assert.equal(hasOwnTeamAbsenceDelegation(null), false);
  assert.equal(canEditSchedule(actor), false, "no general schedule editing grant");
  assert.equal(canJustifyAbsence(actor), false, "no broad attendance/hours justification grant");
});

test("delegated manager justifies a direct-team absence with history and no time changes", async (t) => {
  const f = fixture(t);
  const result = await updateOperationalAttendance(actor, { ...input, impactsAbs: false, impactsCoverage: false, shift: "Manhã" });
  assert.ok("data" in result, JSON.stringify(result));
  const attendance = f.writes.find(w => w.model === "attendanceRecord")!;
  assert.equal(attendance.data.isJustified, true);
  assert.equal(attendance.data.justifiedById, f.user.id);
  assert.equal(attendance.data.shiftId, f.schedule.shift.id, "request cannot change the shift");
  assert.equal(attendance.data.impactsAbs, true, "request cannot override ABS rules");
  assert.equal(attendance.data.impactsCoverage, true);
  assert.equal(f.writes.filter(w => w.model === "attendanceHistory").length, 1);
  assert.equal(f.writes.filter(w => w.model === "auditLog").length, 1);
  const scheduleWrite = f.writes.find(w => w.model === "schedule")!;
  assert.deepEqual(Object.keys(scheduleWrite.data).sort(), ["observation", "status"]);
  assert.equal(scheduleWrite.data.status, "FALTA_JUSTIFICADA");
});

for (const [name, change] of [
  ["another manager", (f) => { f.user.employeeProfile.id = "other-manager"; }],
  ["a different team", (f) => { f.employee.supervisorId = "other-manager"; }],
  ["missing supervisor", (f) => { f.employee.supervisorId = null; }],
  ["inactive actor", (f) => { f.user.status = "INACTIVE"; }],
  ["deleted actor", (f) => { f.user.deletedAt = date; }],
  ["revoked role despite old session", (f) => { f.user.role.name = "COLABORADOR"; }],
  ["deleted schedule", (f) => { f.schedule.deletedAt = date; }],
  ["schedule from another date", (f) => { f.schedule.date = new Date("2026-09-07T00:00:00Z"); }],
  ["schedule from another partner", (f) => { f.schedule.employeeId = "another-partner"; }],
  ["attendance from another date", (f) => { f.record.date = new Date("2026-09-07T00:00:00Z"); }],
  ["attendance from another partner", (f) => { f.record.employeeId = "another-partner"; }],
  ["attendance from another schedule", (f) => { f.record.scheduleId = "another-slot"; }],
  ["a non-absence schedule", (f) => { f.schedule.status = "PRESENTE"; }],
  ["a non-absence attendance", (f) => { f.record.status = "ERRO_ESCALA"; }],
  ["team changed before saving", (f) => { f.current.sameTeam = false; }],
  ["grant revoked before saving", (f) => { f.current.authorized = false; }],
  ["schedule changed before saving", (f) => { f.current.sameSchedule = false; }],
] as Array<[string, (f: ReturnType<typeof fixture>) => void]>) {
  test(`delegation blocks ${name} without writes`, async (t) => {
    const f = fixture(t); change(f);
    const result = await updateOperationalAttendance(actor, input);
    assert.ok("error" in result, JSON.stringify(result));
    assert.deepEqual(f.writes, []);
  });
}

for (const status of ["Presente", "Erro de cronograma", "Treinamento", "Folga"]) {
  test(`delegation cannot submit ${status}`, async (t) => {
    const f = fixture(t);
    assert.ok("error" in await updateOperationalAttendance(actor, { ...input, status }));
    assert.deepEqual(f.writes, []);
  });
}

test("delegation does not allow the schedule editing endpoint", async (t) => {
  const f = fixture(t);
  const result = await editOperationalSchedule(actor, { ...input, status: "Presente", startsAt: "09:00", endsAt: "18:00" });
  assert.ok("error" in result);
  assert.deepEqual(f.writes, []);
});

test("existing supervisor justification still succeeds", async (t) => {
  const f = fixture(t); f.user.role.name = "SUPERVISOR"; f.user.employeeProfile.id = "existing-supervisor";
  const result = await updateOperationalAttendance({ ...actor, role: "SUPERVISOR" }, input);
  assert.ok("data" in result, JSON.stringify(result));
  assert.equal(f.writes.filter(w => w.model === "attendanceHistory").length, 1);
});

test("resubmitting the same delegated justification does not duplicate its history", async (t) => {
  const f = fixture(t);
  assert.ok("data" in await updateOperationalAttendance(actor, input));
  Object.assign(f.record, f.writes.find(w => w.model === "attendanceRecord")!.data);
  Object.assign(f.schedule, f.writes.find(w => w.model === "schedule")!.data);
  const count = f.writes.length;
  const result = await updateOperationalAttendance(actor, { ...input, status: "Falta Justificada" });
  assert.ok("data" in result);
  assert.equal(f.writes.length, count);
});
