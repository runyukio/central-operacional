import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "./prisma";
import { exportOperationalWorkHoursXlsxData, summarizeWorkHourGroups, workHourReadData } from "./work-hours-service";
import { mockPrismaDelegate } from "./prisma-test-delegate";

const actor = { role: "ADMIN" as const, name: "Audit admin", email: "audit@example.test" };

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
  t.mock.method(workHourReadData, "capturedHours", async () => new Map());
  mockPrismaDelegate(t, "auditLog", { create: async () => ({}) });
  const result = await exportOperationalWorkHoursXlsxData(actor, { startDate: "2026-07-15", endDate: "2026-07-15", lob: "ADS" });
  assert.ok("rows" in result && result.rows);
  assert.equal(result.rows.length, 10_001);
  assert.equal(batches.mock.callCount(), 21);
  assert.equal(summaries.mock.callCount(), 0);
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
