import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "./prisma";
import { mockPrismaDelegate } from "./prisma-test-delegate";
import { getRealtimeCecReport } from "./realtime-cec-service";

test("CEC read fetches tickets only for selected/previous cycles and keeps historic CPD", async () => {
  const rawQuery = prisma.$queryRaw;
  const findMany = prisma.realTimeCecSnapshot.findMany;
  const stamp = new Date("2026-09-06T12:00:00Z");
  const summaries = [
    { id: "current", cycleDownload: "2026-09-06 09:00", importedAt: stamp, totalBacklog: 5, rawData: { agents: [{ agentName: "A", cpd: 3 }, { agentName: "B", cpd: 2 }] } },
    { id: "previous", cycleDownload: "2026-09-06 08:00", importedAt: stamp, totalBacklog: 2, rawData: { agents: [{ agentName: "A", cpd: 2 }] } },
    { id: "legacy", cycleDownload: "2026-09-06 07:00", importedAt: stamp, totalBacklog: 1, rawData: { tickets: [{ ticket: "t1", agentName: "A" }, { ticket: "t1", agentName: "A" }] } }
  ];
  try {
    prisma.$queryRaw = (async () => summaries) as typeof prisma.$queryRaw;
    prisma.realTimeCecSnapshot.findMany = (async (args: unknown) => {
      assert.deepEqual(args, { where: { id: { in: ["current", "previous"] } } });
      return summaries.slice(0, 2).map((row) => ({ ...row, fileName: "sample.csv", source: "freshdesk-cec-cpd-hourly", generatedDate: null,
        rawData: { tickets: [{ ticket: "t1", agentName: "A" }] } }));
    }) as unknown as typeof findMany;
    const result = await getRealtimeCecReport({ email: "admin@example.invalid", name: "Admin", role: "ADMIN" });
    assert.ok("data" in result && result.data);
    assert.equal(result.data.hasData, true);
    assert.equal(result.data.refreshWarning, "");
    assert.deepEqual(result.data.history.map((row) => [row.totalCpd, row.activeAgents, row.averageCpd]), [[1, 1, 1], [2, 1, 2], [5, 2, 2.5]]);
    assert.equal(result.data.cycles[0].rows, 2);
  } finally {
    prisma.$queryRaw = rawQuery;
    prisma.realTimeCecSnapshot.findMany = findMany;
  }
});

test("hourly CEC reads keep the last snapshot per hour and compare distinct hours", async (t) => {
  const summaries = ["2026-10-21 10:00", "2026-10-21 09:30", "2026-10-21 09:00", "2026-10-20 23:30"].map((cycleDownload, index) => ({
    id: `snapshot-${index}`, cycleDownload, importedAt: new Date(`${cycleDownload.replace(" ", "T")}:00-03:00`),
    fileName: "sample.csv", source: "freshdesk-cec-cpd-hourly", generatedDate: null, totalBacklog: 10 - index,
    rawData: { agents: [{ agentName: "A", cpd: 10 - index }], tickets: [{ ticket: "t1", agentName: "A" }] }
  }));
  t.mock.method(prisma, "$queryRaw", async () => summaries);
  mockPrismaDelegate(t, "realTimeCecSnapshot", { findMany: async (args: any) => {
    assert.deepEqual(args.where.id.in, ["snapshot-1", "snapshot-3"]);
    return summaries.filter((snapshot) => args.where.id.in.includes(snapshot.id));
  } });
  const result = await getRealtimeCecReport({ email: "admin@example.invalid", name: "Admin", role: "ADMIN" }, {
    cycleGrouping: "hour", cycleDownload: "2026-10-21 09:00"
  });
  assert.ok("data" in result && result.data);
  assert.equal(result.data.selectedCycle, "2026-10-21 09:30");
  assert.equal(result.data.previousCycle, "2026-10-20 23:30");
  assert.deepEqual(result.data.cycles.map((cycle) => cycle.value), ["2026-10-21 10:00", "2026-10-21 09:30", "2026-10-20 23:30"]);
  assert.deepEqual(result.data.history.map((row) => row.totalCpd), [7, 9, 10]);
});
