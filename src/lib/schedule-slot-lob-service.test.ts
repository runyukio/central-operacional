import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prisma } from "./prisma";
import { editOperationalSchedule, getOperationalSchedules } from "./schedule-service";
import { mockPrismaDelegate } from "./prisma-test-delegate";

const actor = { email: "wfm@example.test", name: "WFM Test", role: "WFM" as const };
const date = new Date("2026-09-23T00:00:00Z");
const shift = { id: "morning", name: "Manhã", startsAt: "08:00", endsAt: "17:00" };
const employee = { id: "agent", wbLogin: "wb_agent", fullName: "Test Agent", lobId: "cec", lob: { id: "cec", name: "CEC" }, shift, shiftId: shift.id, supervisorId: null, supervisor: null, roleTitle: "Agente", skill: "L2", operationalStatus: "Ativo", admissionDate: new Date("2026-01-01"), scheduleType: "5x2", user: null };
const original = { id: "slot", employeeId: employee.id, date, lobId: "ads", shiftId: shift.id, shift, startsAt: "08:00", endsAt: "17:00", status: "ESCALADO", observation: null, employee, attendanceRecords: [] };
const edit = { employeeId: employee.id, date: "2026-09-23", shift: "Manhã", startsAt: "08:00", endsAt: "17:00", status: "Escalado" };

function fixture(t: TestContext, grid = false) {
  mockPrismaDelegate(t, "user", { findUnique: async () => ({ id: "wfm", status: "ACTIVE", role: { name: "WFM" }, employeeProfile: null }) });
  const people = mockPrismaDelegate(t, "employeeProfile", { findUnique: async () => employee, count: async () => grid ? 1 : 0, findMany: async () => grid ? [{ id: employee.id }] : [] });
  mockPrismaDelegate(t, "schedule", { findUnique: async () => structuredClone(original), count: async () => grid ? 1 : 0, findMany: async () => grid ? [structuredClone(original)] : [] });
  const lob = mockPrismaDelegate(t, "lob", { findMany: async (args) => {
    const all = [{ id: "ads", name: "ADS" }, { id: "cec", name: "CEC" }];
    return args.where?.name ? all.filter((lob) => lob.name.toLowerCase() === args.where.name.equals.toLowerCase()) : all;
  } });
  mockPrismaDelegate(t, "shift", { findFirst: async () => shift });
  mockPrismaDelegate(t, "workHourRecord", { findMany: async () => [] });
  mockPrismaDelegate(t, "employeeMoodRecord", { findMany: async () => [] });
  mockPrismaDelegate(t, "scheduleImport", { findMany: async () => [] });
  const writes: Record<string, any>[] = [];
  const tx = {
    schedule: { upsert: async (args: any) => { writes.push(args); return { ...original, ...args.update }; } },
    scheduleChangeHistory: { create: t.mock.fn(async (args: any) => args.data) },
    auditLog: { create: t.mock.fn(async (args: any) => args.data) },
    attendanceRecord: { findMany: async () => [] },
    workHourRecord: { findFirst: async () => null }
  };
  const client = prisma as any;
  const transaction = client.$transaction;
  client.$transaction = t.mock.fn(async (fn: any) => fn(tx));
  t.after(() => { client.$transaction = transaction; });
  return { people, lob, writes, tx };
}

test("grid API sends the saved slot LOB separately from the current employee LOB", async (t) => {
  const f = fixture(t, true);
  const result = await getOperationalSchedules(actor, { startDate: "2026-09-23", endDate: "2026-09-23", skipSummary: true });
  const row = result.scheduleGridRows[0] as any;
  assert.equal(row.employee.lob, "CEC");
  assert.equal(row.plannedTimes[0].lob, "ADS");
  assert.equal(row.plannedTimes[0].lobId, "ads");
  assert.equal(row.plannedTimes[0].lobSource, "slot");
  assert.equal(f.lob.findMany.mock.callCount(), 1);
  assert.equal(f.writes.length, 0);
});

for (const [label, lob, expected] of [["explicit CEC", "CEC", "cec"], ["explicit ADS after a transfer", "ADS", "ads"], ["omitted LOB", undefined, "ads"]] as const) {
  test(`slot edit respects ${label} and audits the specific slot only`, async (t) => {
    const f = fixture(t);
    const result = await editOperationalSchedule(actor, { ...edit, lob });
    assert.ok("data" in result, JSON.stringify(result));
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].update.lobId, expected);
    assert.equal(f.writes[0].create.lobId, expected);
    assert.deepEqual(f.writes[0].where, { employeeId_date: { employeeId: employee.id, date } });
    assert.equal(f.tx.scheduleChangeHistory.create.mock.callCount(), 1);
    assert.equal(f.tx.scheduleChangeHistory.create.mock.calls[0].arguments[0].data.before.lobId, "ads");
    assert.equal(f.tx.scheduleChangeHistory.create.mock.calls[0].arguments[0].data.after.lobId, expected);
    assert.equal(employee.lobId, "cec", "registry is never changed");
  });
}

test("invalid LOB is rejected before any schedule or audit write", async (t) => {
  const f = fixture(t);
  const result = await editOperationalSchedule(actor, { ...edit, lob: "not-registered" });
  assert.ok("error" in result && /LOB cadastrada/.test(result.error ?? ""));
  assert.equal(f.writes.length, 0);
  assert.equal(f.tx.auditLog.create.mock.callCount(), 0);
});

test("supervisor cannot change a slot LOB through the service", async (t) => {
  const f = fixture(t);
  mockPrismaDelegate(t, "auditLog", { create: async () => ({}) });
  const result = await editOperationalSchedule({ ...actor, role: "SUPERVISOR" }, { ...edit, lob: "CEC" });
  assert.ok("error" in result && /Supervisor/.test(result.error ?? ""));
  assert.equal(f.writes.length, 0);
  assert.equal(f.lob.findMany.mock.callCount(), 0);
});
