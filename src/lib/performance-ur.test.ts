import assert from "node:assert/strict";
import test, { beforeEach, type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { parseUrRows, sumUr, urPercent } from "./performance-ur";
import { readUrWorkbook } from "./performance-ur-workbook";
import { emptySpaceMetric, finishSpaceMetric } from "./meu-espaco-metrics";
import { loadUrDays } from "./performance-ur-service";
import { prisma } from "./prisma";
import { getOwnPerformanceDashboard, getPerformanceAgentsDashboard } from "./performance-service";
// Prisma delegates are proxies: explicit in-memory delegates prevent accidental database IO.
beforeEach((t) => {
  for (const model of ["user", "employeeProfile", "qualityRecord", "tnsQualityRecord", "cecQualityRecord", "productionRecord", "performanceCecCpdRecord", "schedule", "attendanceRecord", "performanceUrRecord"] as const) {
    const original = prisma[model];
    (prisma as any)[model] = Object.fromEntries(["findUnique", "findMany", "aggregate"].map(method => [method, async () => { throw new Error(`Unmocked ${model}.${method}`); }]));
    (t as TestContext).after(() => { (prisma as any)[model] = original; });
  }
});
const row = (extra: Record<string, unknown> = {}) => ({ "Brazil Shift Date": "2026-09-09 00:00:00", employee: "wb_test@kuaishou.com", shifts: "ER23000800",
  "排班时长_shift_hours(求和)": 72, "实际审核时长线上线下_Actual_moderate_hours": 5.66, ...extra });

test("UR uses eight hours per agent-day, ignores exported shift hours and ready-made percentage", () => {
  const result = parseUrRows([row({ "实际审核工时利用率_Actual_Moderate_Utilization(%)": 0.0001 })]);
  assert.equal(result.rows[0].wbLogin, "wb_test"); assert.equal(result.rows[0].day, "2026-09-09");
  assert.equal(result.rows[0].shiftHours, 8); assert.equal(urPercent(result.rows[0]), 70.75);
});
test("identical rows count once, distinct shifts sum moderation but not another eight hours", () => {
  const result = parseUrRows([row(), row(), row({ shifts: "ER08001700", "实际审核时长线上线下_Actual_moderate_hours": 1 })]);
  assert.equal(result.duplicates, 1); assert.equal(result.rows.length, 1); assert.equal(result.rows[0].shiftHours, 8);
  assert.equal(result.rows[0].actualModerateHours, 6.66);
  assert.throws(() => parseUrRows([row(), row({ "实际审核时长线上线下_Actual_moderate_hours": 1 })]), /conflitantes/);
});
test("summary excluded, zero distinct from missing, actual duration alias supported, invalid dates and values block", () => {
  const result = parseUrRows([row({ "Brazil Shift Date": "汇总" }), row({ "实际审核时长线上线下_Actual_moderate_hours": 0 })]);
  assert.equal(result.ignored, 1); assert.equal(urPercent(result.rows[0]), 0); assert.equal(urPercent(sumUr([])), null);
  const alias = { "Brazil Shift Date": "2026-09-09", employee: "wb_test", "实际审核时长线上/线下_actual_moderate_duration": 4.8 };
  assert.equal(urPercent(parseUrRows([alias]).rows[0]), 60);
  for (const patch of [{ "Brazil Shift Date": "2026-02-30" }, { "实际审核时长线上线下_Actual_moderate_hours": "" }, { "实际审核时长线上线下_Actual_moderate_hours": -1 }, { employee: "null" }]) {
    assert.throws(() => parseUrRows([row(patch)]));
  }
});
test("aggregate UR sums weights and targets compare before rounding", () => {
  assert.equal(urPercent(sumUr([{ actualModerateHours: 8, shiftHours: 8 }, { actualModerateHours: 0, shiftHours: 24 }])), 25);
  const metric = emptySpaceMetric(); metric.urActualHours = 4.79999; metric.urShiftHours = 8;
  assert.equal(finishSpaceMetric(metric, "TNS").targets?.find((t) => t.id === "ur")?.met, false);
  metric.urActualHours = 4.8;
  assert.equal(finishSpaceMetric(metric, "ADS").targets?.find((t) => t.id === "ur")?.met, true);
  assert.equal(urPercent({ actualModerateHours: 12, shiftHours: 8 }), 150);
});
test("UR read requires explicit allowed IDs and restricts inclusive dates and published batch", async (t) => {
  const mock = t.mock.method(prisma, "$queryRaw", async (sql: any) => {
    assert.match(sql.text, /b.status='SUCCESS'/); assert.match(sql.text, /u\."employeeId" IN/);
    assert.ok(sql.values.includes("allowed-only")); assert.ok(!sql.values.includes("other"));
    assert.match(sql.text, />=/); assert.match(sql.text, /<=/); return [];
  });
  await loadUrDays(new Date("2026-09-01"), new Date("2026-09-09"), []);
  assert.equal(mock.mock.callCount(), 0);
  await loadUrDays(new Date("2026-09-01"), new Date("2026-09-09"), ["allowed-only"]);
  assert.equal(mock.mock.callCount(), 1);
});
test("real source: all worksheet rows are read despite A1 dimension", { skip: !process.env.UR_SOURCE }, () => {
  const result = readUrWorkbook(readFileSync(process.env.UR_SOURCE!));
  assert.equal(result.rows.length, 3014); assert.equal(result.ignored, 1);
  assert.ok(Math.abs(sumUr(result.rows).actualModerateHours - 66944.78) < 0.00001);
  assert.equal(sumUr(result.rows).shiftHours, 3014 * 8);
});

test("agent own endpoint binds UR to the authenticated profile and computes the selected weeks", async (t) => {
  t.mock.method(prisma.user, "findUnique", async () => ({ id: "user", email: "agent@example.test", name: "Agent", status: "ACTIVE", role: { name: "COLABORADOR" }, employeeProfile: { id: "own", fullName: "Agent", wbLogin: "wb_own", roleTitle: "Agente", lob: { name: "ADS" }, supervisor: null } }));
  for (const table of [prisma.qualityRecord, prisma.tnsQualityRecord, prisma.cecQualityRecord, prisma.productionRecord, prisma.performanceCecCpdRecord, prisma.schedule, prisma.attendanceRecord]) {
    t.mock.method(table, "findMany", async () => []);
  }
  t.mock.method(prisma, "$queryRaw", async (sql: any) => {
    assert.match(sql.text, /FROM "PerformanceUrRecord"/);
    assert.ok(sql.values.includes("own")); assert.ok(!sql.values.includes("other"));
    return [{ employeeId: "own", day: new Date("2026-09-09"), actualModerateHours: 5.66, shiftHours: 8 }];
  });
  const result = await getOwnPerformanceDashboard({ email: "agent@example.test", name: "Agent", role: "ADMIN" }, { startDate: "2026-09-07", endDate: "2026-09-13" });
  assert.equal(result.summary.mine.ur, 70.75); assert.equal(result.weekly[0].ur, 70.75);
});

test("UR-only partners appear in Performance and sorting happens before pagination", async (t) => {
  t.mock.method(prisma.user, "findUnique", async () => ({ id: "admin", email: "admin@example.test", status: "ACTIVE", role: { name: "ADMIN" } }));
  t.mock.method(prisma.productionRecord, "aggregate", async () => ({ _min: { bzDay: null }, _max: { bzDay: null } }));
  t.mock.method(prisma.performanceCecCpdRecord, "aggregate", async () => ({ _min: { performanceDay: null }, _max: { performanceDay: null } }));
  t.mock.method(prisma.performanceUrRecord, "aggregate", async () => ({ _min: { shiftDate: new Date("2026-09-09") }, _max: { shiftDate: new Date("2026-09-09") } }));
  const ids = Array.from({ length: 12 }, (_, i) => `agent-${i}`);
  t.mock.method(prisma.employeeProfile, "findMany", async () => ids.map(id => ({ id, shift: { id: "shift", name: "Manhã" }, supervisor: null })));
  t.mock.method(prisma, "$queryRaw", async (sql: any) => sql.text.includes('FROM "PerformanceUrRecord"') ? ids.map((id, i) => ({ employeeId: id, wbLogin: `wb_${id}`, employeeName: id, lob: "ADS", supervisorId: null, supervisor: "Sem supervisor", shiftId: "shift", shift: "Manhã", day: new Date("2026-09-09"), actualModerateHours: i, shiftHours: 8 })) : []);
  const actor = { email: "admin@example.test", name: "Admin", role: "ADMIN" as const };
  const result = await getPerformanceAgentsDashboard(actor, { lob: "ADS", startDate: "2026-09-09", endDate: "2026-09-09", sortBy: "ur", sortDirection: "desc", page: 2, pageSize: 10 });
  assert.equal(result.agents.length, 2);
  assert.deepEqual(result.agents.map(row => row.ur), [12.5, 0]);
  assert.equal(result.summary.ur, 66 / 96 * 100);
  assert.equal(result.summary.submit, 0);
});
