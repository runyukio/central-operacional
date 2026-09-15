import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { exportOperationalSchedulesXlsxData, getOperationalAttendance, getOperationalSchedules } from "./schedule-service";
import { mockPrismaDelegate } from "./prisma-test-delegate";

const actor = { email: "wfm@example.test", name: "Test WFM", role: "WFM" as const };
const statuses = { in: ["FALTA", "FALTA_INJUSTIFICADA"] };
const query = { startDate: "2026-09-01", endDate: "2026-09-30", status: "Falta,Falta Injustificada", lob: "ADS", shift: "Tarde" };

function mockReads(t: TestContext, total = 0) {
  mockPrismaDelegate(t, "user", { findUnique: async () => ({ id: "wfm", status: "ACTIVE", role: { name: "WFM" }, employeeProfile: null }) });
  const employees = mockPrismaDelegate(t, "employeeProfile", { count: async () => total, findMany: async (args) => args.select?.id ? [{ id: "page-two-partner" }] : [] });
  const schedules = mockPrismaDelegate(t, "schedule", { count: async () => total * 2, findMany: async () => [] });
  mockPrismaDelegate(t, "workHourRecord", { findMany: async () => [] });
  mockPrismaDelegate(t, "employeeMoodRecord", { findMany: async () => [] });
  const audit = mockPrismaDelegate(t, "auditLog", { create: async () => ({}) });
  return { employees, schedules, audit };
}

test("grid, employee pagination and total slots filter all selected statuses in the database", async (t) => {
  const { employees, schedules } = mockReads(t, 80);
  const result = await getOperationalSchedules(actor, { ...query, page: 2, limit: 25, skipSummary: true });
  assert.ok("pagination" in result && "scheduleMetrics" in result, "Expected database-backed grid metadata");
  assert.equal(result.pagination.page, 2);
  assert.equal(result.pagination.total, 80);
  assert.equal(result.scheduleMetrics.quantity, 160);
  const count = employees.count.mock.calls[0].arguments[0];
  assert.deepEqual(count.where.schedules.some.status, statuses);
  assert.deepEqual(count.where.AND, [{ lob: { name: "ADS" } }]);
  assert.equal(count.where.schedules.some.deletedAt, null);
  assert.deepEqual(count.where.schedules.some.date, { gte: new Date("2026-09-01T00:00:00Z"), lte: new Date("2026-09-30T23:59:59.999Z") });
  assert.ok(count.where.schedules.some.AND.length, "The shift filter remains combined with status");
  const page = employees.findMany.mock.calls[0].arguments[0];
  assert.equal(page.skip, 25);
  assert.equal(page.take, 25);
  assert.deepEqual(page.where.schedules.some.status, statuses);
  assert.deepEqual(schedules.count.mock.calls[0].arguments[0].where.status, statuses);
  const rows = schedules.findMany.mock.calls[0].arguments[0];
  assert.deepEqual(rows.where.status, statuses);
  assert.deepEqual(rows.where.employeeId, { in: ["page-two-partner"] });
});

test("consolidated download uses the same multiple statuses without page limits", async (t) => {
  const { schedules } = mockReads(t);
  const result = await exportOperationalSchedulesXlsxData(actor, query);
  assert.ok("headers" in result, JSON.stringify(result));
  const { where, take, skip } = schedules.findMany.mock.calls[0].arguments[0];
  assert.deepEqual(where.status, statuses);
  assert.equal(where.deletedAt, null);
  assert.equal(take, undefined);
  assert.equal(skip, undefined);
  assert.deepEqual(where.employee.AND, [{ lob: { name: "ADS" } }]);
});

test("attendance summaries and recurring absence queries receive the selected slot types", async (t) => {
  const { schedules } = mockReads(t);
  const result = await getOperationalAttendance(actor, { ...query, summaryOnly: true });
  assert.ok("summary" in result);
  assert.equal(schedules.findMany.mock.callCount(), 2);
  for (const call of schedules.findMany.mock.calls) assert.deepEqual(call.arguments[0].where.status, statuses);
});

test("mixed Sem cronograma keeps the grid filter but excludes it from quantity", async (t) => {
  const { employees, schedules } = mockReads(t, 2);
  await getOperationalSchedules(actor, { ...query, status: "Sem cronograma,Falta", skipSummary: true });
  assert.deepEqual(employees.count.mock.calls[0].arguments[0].where.schedules.some.status, { in: ["SEM_ESCALA", "FALTA"] });
  assert.deepEqual(schedules.count.mock.calls[0].arguments[0].where.status, { in: ["FALTA"] });
});

test("single status and Todos continue working with existing URLs", async (t) => {
  const { employees } = mockReads(t);
  await getOperationalSchedules(actor, { ...query, status: "Falta", skipSummary: true });
  await getOperationalSchedules(actor, { ...query, status: "Todos", skipSummary: true });
  assert.equal(employees.count.mock.calls[0].arguments[0].where.schedules.some.status, "FALTA");
  assert.equal(employees.count.mock.calls[1].arguments[0].where.schedules.some.status, undefined);
});
