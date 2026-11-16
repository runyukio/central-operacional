import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { formatLatencyDisplay, latencyDisplayValue } from "./latency-display";
import { getPerformanceProductionDashboard } from "./performance-service";
import { prisma } from "./prisma";
import { mockPrismaDelegate } from "./prisma-test-delegate";

test("Performance queue latency uses only submits with a valid latency measurement", async (t) => {
  const database = await PGlite.create();
  t.after(() => database.close());
  await database.exec(`
    CREATE TABLE "ProductionRecord" (
      "bzDay" timestamp, "bzTime" timestamp, "queueId" text,
      "employeeId" text, "wbLogin" text, "submitNum" integer,
      "moderationSeconds" double precision, "latencyMinutesSum" double precision
    );
    CREATE TABLE "PerformanceQueueVolumeRecord" (
      "bzDay" timestamp, "bzTime" timestamp, "queueId" text, "inputCount" integer
    );
    INSERT INTO "ProductionRecord" VALUES
      ('2026-11-09', '2026-11-09 08:00', '9596', 'a', 'wb_a', 4, 60, 480),
      ('2026-11-09', '2026-11-09 08:00', '9596', 'b', 'wb_b', 0, 0, 4000),
      ('2026-11-09', '2026-11-09 08:00', '9596', 'c', 'wb_c', 16, 50, NULL),
      ('2026-11-09', '2026-11-09 08:00', '9596', 'd', 'wb_d', 5, 10, -60),
      ('2026-11-09', '2026-11-09 08:00', '9693', 'a', 'wb_a', 2, 30, 0),
      ('2026-11-11', '2026-11-11 08:00', '9596', 'a', 'wb_a', 10, 150, 600);
    INSERT INTO "PerformanceQueueVolumeRecord" VALUES
      ('2026-11-09', '2026-11-09 08:00', '9596', 20),
      ('2026-11-10', '2026-11-10 08:00', '4119', 1601);
  `);

  const dateRange = {
    _min: { bzDay: new Date("2026-11-09T00:00:00Z") },
    _max: { bzDay: new Date("2026-11-11T00:00:00Z"), bzTime: new Date("2026-11-11T08:00:00Z") },
    _count: { _all: 0 },
    _sum: {}
  };
  mockPrismaDelegate(t, "user", { findUnique: async () => ({
    id: "admin", email: "admin@example.test", role: { name: "ADMIN" }, status: "ACTIVE", deletedAt: null
  }) });
  for (const model of ["productionRecord", "performanceQueueVolumeRecord"]) {
    mockPrismaDelegate(t, model, { aggregate: async () => dateRange, groupBy: async () => [] });
  }
  mockPrismaDelegate(t, "performanceImportBatch", { findFirst: async () => null });
  t.mock.method(prisma, "$queryRaw", async (query: { text: string; values: unknown[] }) => {
    const values = query.values.map((value) => value instanceof Date ? value.toISOString() : value);
    return (await database.query(query.text, values)).rows;
  });

  const result = await getPerformanceProductionDashboard(
    { role: "ADMIN", name: "Admin", email: "admin@example.test" },
    { lob: "ADS", granularity: "daily", startDate: "2026-11-09", endDate: "2026-11-11" }
  );

  assert.equal(result.summary.input, 1621);
  assert.equal(result.summary.submit, 37);
  assert.equal(result.summary.latencyMinutes, 67.5);
  assert.equal(result.summary.comparison?.latencyMinutesDelta, null);
  assert.deepEqual(result.trend.map((row) => row.latencyMinutes), [80, null, 60]);
  assert.deepEqual(result.queues.map((row) => [row.queueId, row.submit, row.latencyMinutes]), [
    ["9596", 35, 77.14], ["9693", 2, 0], ["4119", 0, null]
  ]);
  assert.equal(formatLatencyDisplay(result.queues[1].latencyMinutes, "ADS"), "0 h");
  assert.equal(formatLatencyDisplay(result.queues[2].latencyMinutes, "ADS"), "Sem dados");
  assert.equal(latencyDisplayValue(result.queues[2].latencyMinutes, "ADS"), null);
});
