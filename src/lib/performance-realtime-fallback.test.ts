import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "./prisma";
import { getPerformanceProductionDashboard, realtimeAdsHourlyInput } from "./performance-service";
import { mockPrismaDelegate } from "./prisma-test-delegate";

test("ADS fallback obtains parent and summary data in one joined/aggregated SQL snapshot", async (t) => {
  const query = t.mock.method(prisma, "$queryRaw", async (sql: any) => {
    assert.match(sql.sql, /INNER JOIN "RealTimeImportBatch"/);
    assert.match(sql.sql, /DISTINCT ON/);
    assert.match(sql.sql, /SUM\(summary\."input"\)/);
    return [
      { cycleDownload: "2026-08-26 10:58", cumulative: 100 },
      { cycleDownload: "2026-08-26 11:58", cumulative: 160 },
      { cycleDownload: "2026-08-26 12:58", cumulative: 30 }
    ];
  });
  const oldQuery = mockPrismaDelegate(t, "realTimeQueueCycleSummary", { findMany: async () => { throw new Error("unsafe relation query"); } }).findMany;
  const day = new Date("2026-08-26T00:00:00Z");
  assert.deepEqual(await realtimeAdsHourlyInput({ start: day, end: day }), [
    { key: "2026-08-26 11:00", input: 60 }, { key: "2026-08-26 12:00", input: 30 }
  ]);
  assert.equal(query.mock.callCount(), 1);
  assert.equal(oldQuery.mock.callCount(), 0);
});

test("temporary fallback failure preserves imported metrics and explicitly marks incomplete hours", async (t) => {
  const day = new Date("2026-08-26T00:00:00Z");
  mockPrismaDelegate(t, "user", { findUnique: async () => ({ id: "admin", email: "admin@example.test", role: { name: "ADMIN" }, status: "ACTIVE", deletedAt: null }) });
  for (const model of ["productionRecord", "performanceQueueVolumeRecord"]) {
    mockPrismaDelegate(t, model, { aggregate: async () => ({ _min: { bzDay: day }, _max: { bzDay: day } }) });
  }
  t.mock.method(prisma, "$queryRaw", async (sql: any) => {
    if (sql.sql.includes("RealTimeQueueCycleSummary")) throw new Error("Database temporarily unavailable");
    assert.match(sql.sql, /PerformanceQueueVolumeRecord/);
    return [{ bucket: new Date("2026-08-26T10:00:00Z"), input: 45, records: 1 }];
  });
  t.mock.method(console, "warn", () => undefined);
  const result = await getPerformanceProductionDashboard({ role: "ADMIN", name: "Test admin", email: "admin@example.test" }, {
    lob: "ADS", granularity: "hourly", startDate: "2026-08-26", endDate: "2026-08-26", trendOnly: true
  });
  assert.equal(result.summary.input, 45);
  assert.equal(result.trend[0].input, 45);
  assert.ok("realtimeFallbackWarning" in result);
  assert.match(result.realtimeFallbackWarning, /importados foram preservados/);
});
