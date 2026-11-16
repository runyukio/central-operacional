import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildExecutiveIntervals, executiveReadingWindows, pickExecutiveReadings, readExecutiveIntervals } from "./realtime-executive-hours";
import { prisma } from "./prisma";

test("Executive accumulates 09H from its opening, closes at 10:00, and keeps the same history after rollover", async (t) => {
  const db = await PGlite.create();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE "RealTimeImportBatch" (id text, status text, "queueRows" int, "cycleDownload" text, "importedAt" timestamp);
    CREATE TABLE "RealTimeQueueCycleSummary" (
      "batchId" text, "cycleDownload" text, lob text, input int, output int,
      "ahtMs" float8, backlog int, "slaTargetMinutes" int, "maxLatencyMs" float8
    );
    CREATE TABLE "RealTimeAgentCycleSummary" (
      "batchId" text, "cycleDownload" text, lob text, "personType" text, "crossingStatus" text,
      "wbLoginNormalized" text, "displayName" text, "wbLogin" text, "rawWbLogin" text,
      "employeeStatus" text, submit int, "moderationMs" float8
    );
  `);
  t.mock.method(prisma, "$queryRaw", async (query: TemplateStringsArray | { text: string; values: unknown[] }, ...values: unknown[]) => {
    const sql = "text" in query ? query.text : query.map((part, index) => index ? "$" + index + part : part).join("");
    const parameters = ("values" in query && "text" in query ? query.values : values)
      .map((value) => value instanceof Date ? value.toISOString() : value);
    return (await db.query(sql, parameters)).rows;
  });
  async function add(id: string, cycle: string, importedAt: string, input: number, output: number, backlog: number, submit: number) {
    await db.query('INSERT INTO "RealTimeImportBatch" VALUES ($1, \'SUCCESS\', 1, $2, $3)', [id, cycle, importedAt]);
    await db.query('INSERT INTO "RealTimeQueueCycleSummary" VALUES ($1,$2,\'ADS\',$3,$4,60000,$5,120,3600000)',
      [id, cycle, input, output, backlog]);
    await db.query('INSERT INTO "RealTimeAgentCycleSummary" VALUES ($1,$2,\'ADS\',\'Agente\',\'Encontrado\',\'wb_a\',\'A\',\'wb_a\',\'wb_a\',\'Ativo\',$3,$4)',
      [id, cycle, submit, submit * 60_000]);
  }
  await add("open", "2026-11-16 09:00", "2026-11-16 11:59:26", 5280, 5453, 11012, 20);
  await add("early", "2026-11-16 09:00", "2026-11-16 12:24:27", 5578, 5558, 11201, 30);
  await add("now", "2026-11-16 09:30", "2026-11-16 12:39:27", 5624, 5632, 11173, 36);
  const partial = await readExecutiveIntervals({ lob: "ADS", latest: true, selectedCycle: "2026-11-16 09:30" });
  assert.deepEqual(partial.hours.map(({ hour, partial, input, output, backlog }) => [hour, partial, input, output, backlog]),
    [[9, true, 344, 179, 11173]]);
  assert.equal(partial.topAgents[0]?.submit, 16);

  await add("closed", "2026-11-16 10:00", "2026-11-16 12:59:27", 5719, 5710, 11190, 42);
  await add("next", "2026-11-16 10:00", "2026-11-16 13:04:27", 5742, 5724, 11200, 43);
  const live = await readExecutiveIntervals({ lob: "ADS", latest: true, selectedCycle: "2026-11-16 10:00" });
  const historical = await readExecutiveIntervals({ lob: "ADS", latest: false, selectedCycle: "2026-11-16 09:00" });
  assert.deepEqual(live.hours.map(({ hour, partial, input, output, ahtMs, backlog }) => [hour, partial, input, output, ahtMs, backlog]),
    [[9, false, 439, 257, 60000, 11190], [10, true, 23, 14, 60000, 11200]]);
  assert.deepEqual(historical.hours, [live.hours[0]]);
  assert.equal(historical.topAgents[0]?.submit, 22);
});

test("the midnight boundary closes the previous day and an earlier missing opening cannot extend a later hour", () => {
  const point = (id: string, cycleDownload: string, localTime: string) => {
    const localAt = Date.parse(localTime + "Z");
    return { id, cycleDownload, localAt, importedAt: localAt + 3 * 3_600_000 };
  };
  const readings = pickExecutiveReadings([
    point("open", "2026-11-15 23:00", "2026-11-15T22:59:27"),
    point("close", "2026-11-16 00:00", "2026-11-15T23:59:27"),
    point("partial", "2026-11-16 00:00", "2026-11-16T00:04:27"),
    point("late", "2026-11-15 23:00", "2026-11-16T00:09:27"),
    point("gap", "2026-11-16 02:00", "2026-11-16T02:04:27")
  ]);
  assert.equal(readings.size, 4);
  const midnight = Date.parse("2026-11-16T00:00:00Z");
  const windows = executiveReadingWindows(readings, midnight, midnight + 5 * 60_000);
  const summary = buildExecutiveIntervals("2026-11-16 00:00", "ADS", windows, [], []);
  assert.equal(summary.previousDayHour?.hour, 23);
  assert.equal(summary.previousDayHour?.cycleDownload, "2026-11-16 00:00");
  assert.deepEqual(summary.hours.map((reading) => [reading.hour, reading.partial]), [[0, true]]);
  assert.deepEqual(executiveReadingWindows(readings, midnight).map((window) => window.map((reading) => reading.id)),
    [["open", "close"]]);
});
