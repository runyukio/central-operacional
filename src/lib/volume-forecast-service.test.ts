import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { forecastComparisonPoints } from "./volume-forecast-comparison";

test("ADS comparison stays fixed across imports/ranges and refreshes at Brazil midnight while actuals remain live", async (t) => {
  // Next initializes this server global before loading its cache module.
  const runtime = globalThis as unknown as { AsyncLocalStorage?: typeof AsyncLocalStorage };
  runtime.AsyncLocalStorage ??= AsyncLocalStorage;
  const { loadVolumeForecastRange } = await import("./volume-forecast-service");
  const day = "2026-10-19", start = Date.parse(day), H = 3_600_000;
  let multiplier = 1, dailyReads = 0;
  const history = Array.from({ length: 90 * 24 + 10 }, (_, hour) => ({
    at: new Date(start - 90 * 24 * H + hour * H), input: 100 + hour % 24,
  }));
  const cache = new Map<string, unknown>();
  const host = globalThis as unknown as { __incrementalCache?: unknown };
  const previous = host.__incrementalCache;
  host.__incrementalCache = {
    generateSimpleCacheKey: async (key: string) => createHash("sha256").update(key).digest("hex"),
    get: async (key: string) => cache.has(key) ? { value: cache.get(key), isStale: false } : null,
    set: async (key: string, value: unknown) => { cache.set(key, value); },
  };
  t.after(() => { host.__incrementalCache = previous; });
  const query = async (sql: Prisma.Sql) => {
    assert.ok(sql.sql.includes('"PerformanceQueueVolumeRecord"') || sql.sql.includes('"RealTimeQueueCycleSummary"'));
    if (sql.sql.includes('"RealTimeQueueCycleSummary"')) return [];
    const bounds = sql.values.filter((value): value is Date => value instanceof Date);
    const rows = history.filter(row => row.at >= bounds[0] && row.at < bounds[1])
      .map(row => ({ ...row, input: row.input * multiplier }));
    if (sql.sql.includes("COUNT(*)")) return [{ rows: String(rows.length), updated: `2026-10-19T${multiplier === 1 ? "09" : "15"}:00:00Z`, input: String(rows.reduce((sum, row) => sum + row.input, 0)) }];
    if (bounds[1].getTime() <= start && bounds[0].getTime() === start - 142 * 24 * H) dailyReads++;
    return rows;
  };
  t.mock.method(prisma, "$queryRaw", query as typeof prisma.$queryRaw);

  const first = await loadVolumeForecastRange("ADS", [day], new Date("2026-10-19T12:00:00Z"));
  assert.equal(first.baselinePoints.length, 24);
  multiplier = 2; // A later Performance import also corrects earlier training days.
  const later = await loadVolumeForecastRange("ADS", [day, "2026-10-20"], new Date("2026-10-20T02:59:59Z"), true);
  assert.deepEqual(forecastComparisonPoints(later).filter(point => point.dateKey === day), forecastComparisonPoints(first));
  assert.equal(later.actuals[0].input, first.actuals[0].input * 2);
  assert.notEqual(later.version, first.version);
  assert.equal(dailyReads, 1, "range, evaluation and source changes must reuse the same daily training snapshot");
  const tomorrowOnly = await loadVolumeForecastRange("ADS", ["2026-10-20"], new Date("2026-10-20T02:59:59Z"));
  assert.deepEqual(tomorrowOnly.baselinePoints, later.baselinePoints.filter(point => point.dateKey === "2026-10-20"));
  const nextDay = await loadVolumeForecastRange("ADS", ["2026-10-20"], new Date("2026-10-20T03:00:00Z"));
  assert.equal(nextDay.baselinePoints.length, 24);
  assert.notDeepEqual(nextDay.baselinePoints.map(point => point.input), tomorrowOnly.baselinePoints.map(point => point.input));
});
