import assert from "node:assert/strict";
import test from "node:test";
import { mockPrismaDelegate } from "./prisma-test-delegate";
import { loadTeamWorkMetrics, teamWorkData } from "./team-work-metrics-service";

test("work metrics queries and capture receive the authorized IDs and preserve official hours when capture fails", async (t) => {
  const day = new Date("2026-10-26"), now = new Date("2026-10-28T18:00:00Z");
  mockPrismaDelegate(t, "schedule", { findMany: async (args: any) => {
    assert.deepEqual(args.where.employeeId.in, ["agent"]); assert.equal(args.where.deletedAt, null);
    return [{ id: "s", employeeId: "agent", date: day, status: "PRESENTE", startsAt: "08:00", endsAt: "17:00", shift: null }];
  } });
  mockPrismaDelegate(t, "workHourRecord", { findMany: async (args: any) => {
    assert.deepEqual(args.where.employeeId.in, ["agent"]);
    return [{ employeeId: "agent", scheduleId: "s", date: day, effectiveHours: 9, plannedHours: 8 }];
  } });
  t.mock.method(teamWorkData, "punctualityRange", async (args: any) => {
    assert.deepEqual(args.dates, ["2026-10-26"]); assert.deepEqual(args.eligibleEmployeeIds, ["agent"]);
    assert.deepEqual(args.eligibleWbLogins, ["wb_agent"]); throw new Error("Capture unavailable");
  });
  const result = await loadTeamWorkMetrics([{ id: "agent", wbLogin: "wb_agent" }], day, new Date("2026-10-31"), now);
  assert.equal(result.byEmployee.get("agent")!.adherenceRate, 100);
  assert.equal(result.byEmployee.get("agent")!.officialOvertimeHours, 1);
  assert.equal(result.byEmployee.get("agent")!.lateRate, null);
  assert.match(result.warnings[0], /captura está indisponível/);
});

test("empty employee scope performs no capture or database reads", async (t) => {
  const capture = t.mock.method(teamWorkData, "punctualityRange", async () => { throw new Error("Must not read all captures"); });
  const result = await loadTeamWorkMetrics([], new Date("2026-10-01"), new Date("2026-10-28"));
  assert.equal(result.byEmployee.size, 0); assert.equal(capture.mock.callCount(), 0);
});
