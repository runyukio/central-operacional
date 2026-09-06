import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "./prisma";
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
