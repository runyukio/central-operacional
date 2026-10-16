import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  adsForecastRealtimeQuery, readAdsForecastRealtime, summarizeAdsForecastRealtime,
  type AdsForecastRealtimeRequest, type AdsForecastRealtimeRow
} from "./ads-forecast-realtime-source";

const DAY = Date.parse("2026-10-16T00:00:00Z");
const MINUTE = 60_000;
const request = (overrides: Partial<AdsForecastRealtimeRequest> = {}): AdsForecastRealtimeRequest => ({
  dateKey: "2026-10-16", now: new Date("2026-10-16T16:30:00Z"), queueIds: ["ads-1", "ads-2"], ...overrides
});
const cycle = (minute: number) => {
  const date = new Date(DAY + minute * MINUTE);
  return `${date.toISOString().slice(0, 10)} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
};
const rows = (lastMinute = 810): AdsForecastRealtimeRow[] => {
  const result: AdsForecastRealtimeRow[] = [];
  for (let minute = 0; minute <= lastMinute; minute += 30) {
    for (const [index, key] of ["queue-a", "queue-b"].entries()) {
      result.push({ cycleDownload: cycle(minute), queueKey: key,
        input: (minute < 780 ? 1000 + minute / 3 : 5 + (minute - 780) / 3) * (index + 1),
        batchId: `batch-${String(minute).padStart(4, "0")}`,
        importedAt: new Date(DAY + minute * MINUTE + 3 * 3_600_000 - MINUTE)
      });
    }
  }
  return result;
};

test("returns only aggregate arrivals, not cumulative counters or queue/batch details", () => {
  const result = summarizeAdsForecastRealtime(request(), rows());
  assert.equal(result.status, "active");
  assert.equal(result.snapshotIntegrity, "verified");
  assert.deepEqual(result.snapshotWarnings, []);
  assert.equal(result.snapshotTimestamp, DAY + 810 * MINUTE);
  assert.equal(result.cycle, "2026-10-16 13:30");
  assert.equal(result.importedAt, "2026-10-16T16:29:00.000Z");
  assert.equal(result.intervals.length, 27);
  assert.deepEqual(result.intervals[0], { start: DAY, end: DAY + 30 * MINUTE, input: 30 });
  assert.equal(result.intervals.reduce((sum, point) => sum + point.input, 0), 795);
  assert.deepEqual(Object.keys(result).sort(), ["cycle", "fingerprint", "importedAt", "intervals", "snapshotIntegrity", "snapshotTimestamp", "snapshotWarnings", "status", "warnings"]);
  assert.doesNotMatch(JSON.stringify(result), /queue-a|queue-b|batch-|queueKey|queueId|backlog|cumulative|wbLogin|employee/);
  assert.deepEqual(result.warnings, []);
});

test("uses the explicit 13:00 reset even when a small counter rises from 1 to 2", () => {
  const input = rows().map((row) => ({ ...row, input: row.queueKey === "queue-b" ? 0 : row.cycleDownload < cycle(780) ? 1 : row.cycleDownload === cycle(780) ? 2 : 3 }));
  const result = summarizeAdsForecastRealtime(request(), input);
  assert.equal(result.status, "active");
  assert.deepEqual(result.intervals.find((point) => point.end === DAY + 780 * MINUTE), { start: DAY + 750 * MINUTE, end: DAY + 780 * MINUTE, input: 2 });
  assert.equal(result.intervals.reduce((sum, point) => sum + point.input, 0), 3);
});

test("a decrease in one queue outside 13:00 is unavailable even when aggregate counters rise", () => {
  const input = rows(30);
  input.find((row) => row.cycleDownload === cycle(30) && row.queueKey === "queue-a")!.input = 999;
  input.find((row) => row.cycleDownload === cycle(30) && row.queueKey === "queue-b")!.input = 2200;
  const result = summarizeAdsForecastRealtime(request({ now: new Date("2026-10-16T03:30:00Z") }), input);
  assert.equal(result.status, "unavailable");
  assert.equal(result.snapshotIntegrity, "incomplete");
  assert.deepEqual(result.intervals, []);
  assert.match(result.warnings.join(" "), /diminuiu fora do reset/);
});

test("midnight is a baseline, not an additional reset or an arrival amount", () => {
  const input = rows(30).map((row) => ({ ...row, input: row.cycleDownload === cycle(0) ? 20_000 : 20_007 }));
  input.push({ ...input[0], cycleDownload: "2026-10-15 23:30", input: 19_900 });
  const result = summarizeAdsForecastRealtime(request({ now: new Date("2026-10-16T03:30:00Z") }), input);
  assert.equal(result.status, "active");
  assert.equal(result.intervals.length, 1);
  assert.equal(result.intervals[0].input, 14);
});

test("the union of queue inventories prevents missing baseline, final and intermediate queues becoming zero", () => {
  for (const missingCycle of [cycle(0), cycle(30), cycle(810)]) {
    const incomplete = rows().filter((row) => !(row.cycleDownload === missingCycle && row.queueKey === "queue-b"));
    const result = summarizeAdsForecastRealtime(request(), incomplete);
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.intervals, []);
    assert.match(result.warnings.join(" "), /cobertura de filas mudou/);
  }
  const extraMiddle = rows();
  extraMiddle.push({ ...extraMiddle[2], queueKey: "only-in-middle" });
  assert.equal(summarizeAdsForecastRealtime(request(), extraMiddle).status, "unavailable");
});

test("requires the 00:00 baseline, continuous collections, and the requested final cycle", () => {
  const noBaseline = summarizeAdsForecastRealtime(request(), rows().filter((row) => row.cycleDownload !== cycle(0)));
  assert.equal(noBaseline.status, "unavailable");
  assert.match(noBaseline.warnings.join(" "), /00:00/);
  const gap = summarizeAdsForecastRealtime(request(), rows().filter((row) => row.cycleDownload !== cycle(60)));
  assert.equal(gap.status, "unavailable");
  assert.deepEqual(gap.intervals, []);
  const missingFinal = summarizeAdsForecastRealtime(request({ asOfCycle: cycle(810) }), rows(780));
  assert.equal(missingFinal.status, "unavailable");
  assert.match(missingFinal.warnings.join(" "), /ciclo final solicitado/);
  const noResetCheckpoint = rows().filter((row) => row.cycleDownload !== cycle(780));
  assert.equal(summarizeAdsForecastRealtime(request(), noResetCheckpoint).status, "unavailable");
});

test("selects the latest whole batch per cycle without filling a partial reimport from the older batch", () => {
  const input = rows();
  const old = input.filter((row) => row.cycleDownload === cycle(810));
  const reimport = old.map((row) => ({ ...row, batchId: "reimport", importedAt: new Date("2026-10-16T16:30:00Z"), input: row.input + 3 }));
  const complete = summarizeAdsForecastRealtime(request(), [...input, ...reimport]);
  assert.equal(complete.status, "active");
  assert.equal(complete.intervals.at(-1)!.input, 36);
  const partial = summarizeAdsForecastRealtime(request(), [...input, reimport[0]]);
  assert.equal(partial.status, "unavailable");
  assert.match(partial.warnings.join(" "), /cobertura de filas mudou/);
  assert.notEqual(complete.fingerprint, summarizeAdsForecastRealtime(request(), input).fingerprint);
});

test("a latest global batch with no ADS is unavailable instead of resurrecting the older ADS frame", () => {
  const input = rows();
  const sentinel = { ...input.at(-1)!, queueKey: "", input: -1, batchId: "new-global-batch-without-ads", importedAt: new Date("2026-10-16T16:30:00Z") };
  const result = summarizeAdsForecastRealtime(request(), [...input, sentinel]);
  assert.equal(result.status, "unavailable");
  assert.equal(result.cycle, cycle(810));
  assert.equal(result.importedAt, "2026-10-16T16:30:00.000Z");
  assert.deepEqual(result.intervals, []);
  assert.notEqual(result.fingerprint, summarizeAdsForecastRealtime(request(), input).fingerprint);
  const blankBaseline = [...input.filter((row) => row.cycleDownload !== cycle(0)), { ...sentinel, cycleDownload: cycle(0) }];
  assert.equal(summarizeAdsForecastRealtime(request(), blankBaseline).status, "unavailable");
  const nullKey = { ...sentinel, queueKey: null } as unknown as AdsForecastRealtimeRow;
  const nullFrame = summarizeAdsForecastRealtime(request(), [...input, nullKey]);
  assert.equal(nullFrame.status, "unavailable");
  assert.equal(nullFrame.snapshotIntegrity, "incomplete");
});

test("current-frame integrity distinguishes lost queues, final-only additions and recovered historical coverage", () => {
  const lostFinal = rows().filter((row) => !(row.cycleDownload === cycle(810) && row.queueKey === "queue-b"));
  const lost = summarizeAdsForecastRealtime(request(), lostFinal);
  assert.equal(lost.status, "unavailable");
  assert.equal(lost.snapshotIntegrity, "incomplete");
  assert.match(lost.snapshotWarnings.join(" "), /perdeu filas/);

  const addedOnlyAtEnd = rows().filter((row) => row.queueKey !== "queue-b" || row.cycleDownload === cycle(810));
  const added = summarizeAdsForecastRealtime(request(), addedOnlyAtEnd);
  assert.equal(added.status, "unavailable");
  assert.equal(added.snapshotIntegrity, "unknown");

  const recovered = rows().filter((row) => !(row.cycleDownload === cycle(30) && row.queueKey === "queue-b"));
  const restored = summarizeAdsForecastRealtime(request(), recovered);
  assert.equal(restored.status, "unavailable", "a historical coverage gap still prevents intraday revision");
  assert.equal(restored.snapshotIntegrity, "verified", "the final inventory is complete against the valid midnight baseline");
  assert.deepEqual(restored.snapshotWarnings, []);

  const noMidnight = summarizeAdsForecastRealtime(request(), rows().filter((row) => row.cycleDownload !== cycle(0)));
  assert.equal(noMidnight.snapshotIntegrity, "unknown");
  assert.equal(summarizeAdsForecastRealtime(request(), []).snapshotIntegrity, "unknown");
});

test("invalid/duplicate current frames are incomplete but a recovered historical invalid counter does not invalidate the final frame", () => {
  for (const input of [
    [...rows(), rows().at(-1)!],
    rows().map((row) => row.cycleDownload === cycle(810) && row.queueKey === "queue-b" ? { ...row, input: -1 } : row),
    rows().map((row) => row.cycleDownload === cycle(810) && row.queueKey === "queue-b" ? { ...row, input: NaN } : row),
  ]) {
    const result = summarizeAdsForecastRealtime(request(), input);
    assert.equal(result.status, "unavailable");
    assert.equal(result.snapshotIntegrity, "incomplete");
    assert.ok(result.snapshotWarnings.length > 0);
  }
  const oldInvalid = rows().map((row) => row.cycleDownload === cycle(30) && row.queueKey === "queue-b" ? { ...row, input: -1 } : row);
  const recovered = summarizeAdsForecastRealtime(request(), oldInvalid);
  assert.equal(recovered.status, "unavailable");
  assert.equal(recovered.snapshotIntegrity, "verified");
});

test("fingerprint is deterministic and changes on reimports, source corrections and freshness state", () => {
  const input = rows();
  const first = summarizeAdsForecastRealtime(request(), input);
  assert.equal(first.fingerprint, summarizeAdsForecastRealtime(request({ queueIds: ["ads-2", "ads-1", "ads-1"] }), [...input].reverse()).fingerprint);
  const corrected = input.map((row) => row.cycleDownload === cycle(810) ? { ...row, input: row.input + 1 } : row);
  assert.notEqual(first.fingerprint, summarizeAdsForecastRealtime(request(), corrected).fingerprint);
  const reimported = input.map((row) => row.cycleDownload === cycle(810) ? { ...row, batchId: "same-values-new-import" } : row);
  assert.notEqual(first.fingerprint, summarizeAdsForecastRealtime(request(), reimported).fingerprint);
  const stale = summarizeAdsForecastRealtime(request({ now: new Date("2026-10-16T18:01:00Z") }), input);
  assert.equal(stale.status, "stale");
  assert.notEqual(first.fingerprint, stale.fingerprint);
  assert.deepEqual(stale.intervals, []);
});

test("stale or future source times never produce applicable online intervals", () => {
  const exact = rows().map((row) => ({ ...row, importedAt: new Date("2026-10-16T16:30:00Z") }));
  assert.equal(summarizeAdsForecastRealtime(request({ now: new Date("2026-10-16T18:00:00Z") }), exact).status, "active");
  assert.equal(summarizeAdsForecastRealtime(request({ now: new Date("2026-10-16T18:00:01Z") }), exact).status, "stale");
  const importedInFuture = rows().map((row) => ({ ...row, importedAt: new Date("2026-10-16T16:36:00Z") }));
  assert.equal(summarizeAdsForecastRealtime(request(), importedInFuture).status, "stale");
  const futureCycle = rows();
  futureCycle.push({ ...futureCycle.at(-1)!, cycleDownload: cycle(840) });
  const future = summarizeAdsForecastRealtime(request(), futureCycle);
  assert.equal(future.status, "stale");
  assert.deepEqual(future.intervals, []);
});

test("as-of cuts ignore later observations and use Brazil wall time separately from real UTC imports", () => {
  const args = request({ asOfCycle: cycle(780) });
  const cut = summarizeAdsForecastRealtime(args, rows());
  assert.equal(cut.status, "active");
  assert.equal(cut.snapshotTimestamp, DAY + 780 * MINUTE);
  assert.equal(cut.importedAt, "2026-10-16T15:59:00.000Z");
  assert.equal(cut.fingerprint, summarizeAdsForecastRealtime(args, rows(780)).fingerprint);
  const sql = adsForecastRealtimeQuery(request({ now: new Date("2026-10-16T03:20:00Z") }));
  assert.ok(sql.values.includes("2026-10-16 00:20"));
  assert.ok(sql.values.includes("2026-10-16 00:00"));
  assert.equal((sql.values[0] as Date).toISOString(), "2026-10-16T03:20:00.000Z");
});

test("zero observed arrivals remains valid while empty, duplicate or malformed data is unavailable", () => {
  const zero = summarizeAdsForecastRealtime(request(), rows().map((row) => ({ ...row, input: 0 })));
  assert.equal(zero.status, "active");
  assert.equal(zero.intervals.reduce((sum, point) => sum + point.input, 0), 0);
  assert.equal(summarizeAdsForecastRealtime(request(), []).status, "unavailable");
  assert.equal(summarizeAdsForecastRealtime(request(), [...rows(), rows()[0]]).status, "unavailable");
  for (const invalid of [-1, 1.5, NaN]) {
    const input = rows(); input[0].input = invalid;
    assert.equal(summarizeAdsForecastRealtime(request(), input).status, "unavailable");
  }
  const invalidCycle = rows(); invalidCycle[0].cycleDownload = "2026-10-16 24:00";
  assert.equal(summarizeAdsForecastRealtime(request(), invalidCycle).status, "unavailable");
  assert.throws(() => adsForecastRealtimeQuery(request({ dateKey: "2026-02-30" })), /Data operacional inválida/);
  assert.throws(() => adsForecastRealtimeQuery(request({ asOfCycle: "2026-10-16 13:99" })), /Ciclo inválido/);
});

test("actual reader uses only successful batches, authoritative ADS IDs and bounded cycles in one read", async (t) => {
  const query = t.mock.method(prisma, "$queryRaw", async (sql: Prisma.Sql) => {
    assert.match(sql.text, /b\.status='SUCCESS'/);
    assert.match(sql.text, /b\."queueRows">0/);
    assert.match(sql.text, /b\."importedAt"<=\$1/);
    assert.match(sql.text, /DISTINCT ON \(q\."cycleDownload"\)/);
    assert.match(sql.text, /ORDER BY q\."cycleDownload", b\."importedAt" DESC, b\.id DESC/);
    // Select the latest GLOBAL queue batch first. Filtering ADS here would
    // hide a newer batch that lost all ADS rows and reuse an older ADS frame.
    const latestBatchSelection = sql.text.slice(0, sql.text.indexOf('SELECT latest."cycleDownload"'));
    assert.doesNotMatch(latestBatchSelection, /queueId|\blob\b/);
    assert.match(sql.text, /LEFT JOIN "RealTimeQueueCycleSummary" q/);
    assert.match(sql.text, /COALESCE\(q\."queueKey",''\)/);
    assert.match(sql.text, /COALESCE\(q\.input,-1\)/);
    assert.equal((sql.text.match(/q\."queueId" IN/g) ?? []).length, 1);
    assert.ok(sql.values.includes("2026-10-16 13:00"));
    assert.doesNotMatch(sql.text, /RealTimeRecord|RealTimeAgent|queueName|rawData|backlog|wbLogin|employee|output|fileName|user|actor/);
    return rows(780);
  });
  const result = await readAdsForecastRealtime(request({ asOfCycle: cycle(780) }));
  assert.equal(query.mock.callCount(), 1);
  assert.equal(result.status, "active");
  assert.equal(result.cycle, cycle(780));
});

test("missing mapping, future operational day and database failures preserve an unavailable source", async (t) => {
  const query = t.mock.method(prisma, "$queryRaw", async () => { throw new Error("private connection detail"); });
  assert.equal((await readAdsForecastRealtime(request({ queueIds: [] }))).status, "unavailable");
  assert.equal((await readAdsForecastRealtime(request({ dateKey: "2026-10-17" }))).status, "unavailable");
  assert.equal(query.mock.callCount(), 0);
  const result = await readAdsForecastRealtime(request());
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.intervals, []);
  assert.match(result.warnings.join(" "), /histórico permanece/);
  assert.doesNotMatch(JSON.stringify(result), /private connection detail/);
  assert.equal(query.mock.callCount(), 1);
});
