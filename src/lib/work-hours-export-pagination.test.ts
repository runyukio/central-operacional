import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "./prisma";
import { exportOperationalWorkHoursXlsxData, summarizeWorkHourGroups, workHourReadData } from "./work-hours-service";
import { mockPrismaDelegate } from "./prisma-test-delegate";

const actor = { role: "ADMIN" as const, name: "Audit admin", email: "audit@example.test" };

test("export mantém realizado separado do excedente pendente, aprovado e recusado", async (t) => {
  mockPrismaDelegate(t, "user", { findUnique: async () => ({ id: "admin", name: actor.name, role: { name: "ADMIN" }, status: "ACTIVE" }) });
  const records = ["PENDING", "APPROVED", "REJECTED"].map((status, index) => ({
    id: String(index), employeeId: "agent", wbLogin: "wb", date: new Date("2026-10-01"), status: "OK",
    actualHours: 9, effectiveHours: status === "APPROVED" ? 9 : 8, differenceMinutes: status === "APPROVED" ? 60 : 0,
    employee: { fullName: status, operationalStatus: "Ativo", lob: { name: "ADS" }, shift: { name: "Manhã" } }, adjustments: [],
    overtimeReview: { status, excessHours: 1, rejectionReason: status === "REJECTED" ? "Sessão indevida" : null }
  }));
  mockPrismaDelegate(t, "workHourRecord", { count: async () => records.length, findMany: async () => records });
  mockPrismaDelegate(t, "auditLog", { create: async () => ({}) });
  t.mock.method(workHourReadData, "capturedHours", async () => new Map());
  const result = await exportOperationalWorkHoursXlsxData(actor, { startDate: "2026-10-01", endDate: "2026-10-01" });
  assert.ok("rows" in result && result.rows);
  const realizedIndex = result.headers.indexOf("horas_realizadas"), pendingIndex = result.headers.indexOf("horas_em_validacao");
  const stateIndex = result.headers.indexOf("situacao_excedente"), reasonIndex = result.headers.indexOf("motivo_recusa_excedente");
  const byEmployee = new Map(result.rows.map((row) => [row[1], row]));
  assert.equal(byEmployee.get("PENDING")![realizedIndex], "8:00"); assert.equal(byEmployee.get("PENDING")![pendingIndex], "1:00");
  assert.equal(byEmployee.get("APPROVED")![realizedIndex], "9:00"); assert.equal(byEmployee.get("APPROVED")![pendingIndex], "0:00");
  assert.equal(byEmployee.get("REJECTED")![realizedIndex], "8:00"); assert.equal(byEmployee.get("REJECTED")![pendingIndex], "0:00");
  assert.equal(byEmployee.get("REJECTED")![stateIndex], "Excedente recusado"); assert.equal(byEmployee.get("REJECTED")![reasonIndex], "Sessão indevida");
});

test("hours export includes all 10001 rows in bounded pages and never computes dashboard summaries", async (t) => {
  mockPrismaDelegate(t, "user", { findUnique: async () => ({ id: "admin", name: actor.name, role: { name: "ADMIN" }, status: "ACTIVE", employeeProfile: null }) });
  const date = new Date("2026-07-15T00:00:00Z");
  const records = Array.from({ length: 10_001 }, (_, index) => ({
    id: String(index).padStart(6, "0"), employeeId: "agent", wbLogin: "wb", date,
    status: "OK", actualHours: 8, effectiveHours: 8, differenceMinutes: 0,
    createdAt: date, updatedAt: date, employee: { fullName: "Agent", operationalStatus: "Ativo", lob: { name: "ADS" }, shift: { name: "Manhã" } }, adjustments: []
  }));
  const hours = mockPrismaDelegate(t, "workHourRecord", {
    count: async () => records.length,
    findMany: async (args: any) => {
    assert.equal(args.take, 500);
    assert.deepEqual(args.orderBy, { id: "asc" });
    const afterId = args.where.AND.find((where: any) => where.id)?.id.gt;
    return records.filter((record) => !afterId || record.id > afterId).slice(0, args.take);
    },
    groupBy: async () => { throw new Error("export must not compute summaries"); }
  });
  const batches = hours.findMany;
  const summaries = hours.groupBy;
  const capture = t.mock.method(workHourReadData, "capturedHours", async (requests: Parameters<typeof workHourReadData.capturedHours>[0]) => {
    assert.ok(requests.length <= 20);
    assert.equal(new Set(requests.map((request) => request.shiftDate.toISOString())).size, 1);
    return new Map(requests.map((request) => [request.key, 7.75]));
  });
  mockPrismaDelegate(t, "auditLog", { create: async () => ({}) });
  const result = await exportOperationalWorkHoursXlsxData(actor, { startDate: "2026-07-15", endDate: "2026-07-15", lob: "ADS" });
  assert.ok("rows" in result && result.rows);
  assert.equal(result.rows.length, 10_001);
  assert.equal(batches.mock.callCount(), 21);
  assert.equal(summaries.mock.callCount(), 0);
  assert.equal(capture.mock.callCount(), 501);
  assert.ok(result.rows.every((row) => row[9] === "7:45"));
  assert.equal(batches.mock.calls[0].arguments[0].where.AND[0].employee.lob.name, "ADS");
});

test("oversize XLSX request is refused explicitly instead of returning a partial file", async (t) => {
  mockPrismaDelegate(t, "user", { findUnique: async () => ({ id: "admin", role: { name: "ADMIN" }, status: "ACTIVE" }) });
  const fetch = mockPrismaDelegate(t, "workHourRecord", {
    count: async () => 100_001,
    findMany: async () => { throw new Error("should not load records"); }
  }).findMany;
  const result = await exportOperationalWorkHoursXlsxData(actor);
  assert.equal("status" in result && result.status, 413);
  assert.equal(fetch.mock.callCount(), 0);
});

test("grouped hours totals preserve tolerance, null differences, no-schedule and adjustment rules", () => {
  const group = (status: string, differenceMinutes: number | null, count: number, effectiveHours: number) => ({
    status, differenceMinutes, _count: { _all: count }, _sum: { effectiveHours, adjustedHours: null }
  });
  const result = summarizeWorkHourGroups([
    group("OK", 0, 2, 16), group("DIVERGENT", 60, 1, 9),
    group("DIVERGENT", -30, 2, 15), group("IMPORTED", null, 1, 8), group("NO_SCHEDULE", 120, 4, 40)
  ], [{ status: "ABERTO", _count: { _all: 2 } }, { status: "EM_ANALISE", _count: { _all: 1 } }]);
  assert.equal(result.actualHours, 48);
  assert.equal(result.okRecords, 2);
  assert.equal(result.divergentRecords, 3);
  assert.equal(result.noScheduleRecords, 4);
  assert.equal(result.overtimeHours, 1);
  assert.equal(result.pendingHours, 1);
  assert.equal(result.pendingAdjustments, 3);
});
