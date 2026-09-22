import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { mockPrismaDelegate } from "./prisma-test-delegate";
import { runCycleMonitor } from "./realtime-cycle-monitor-service";
import { GET, POST } from "../app/api/cron/realtime-cycle-monitor/route";

test("route rejects unauthenticated calls and tests without an idempotency key", async () => {
  const old = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "unit-test-secret";
  try {
    assert.equal((await GET(new Request("https://example.com/api/cron/realtime-cycle-monitor"))).status, 401);
    assert.equal((await POST(new Request("https://example.com", { headers: { authorization: "Bearer unit-test-secret" } }))).status, 400);
    delete process.env.CRON_SECRET;
    assert.equal((await GET(new Request("https://example.com"))).status, 503);
  } finally { if (old === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = old; }
});
test("test sends once, persists provider receipt, suppresses duplicate and uncertain retries", async t => {
  const old = process.env.REALTIME_CYCLE_MONITOR_KIM_URL;
  process.env.REALTIME_CYCLE_MONITOR_KIM_URL = "https://kim-robot.kwaitalk.com/api/robot/send?key=test-only";
  const claimed = new Set<string>(); const statuses: string[] = [];
  mockPrismaDelegate(t, "systemConfig", { create: async ({ data }: { data: { key: string } }) => {
    if (claimed.has(data.key)) throw new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" });
    claimed.add(data.key); return {};
  }, update: async ({ data }: { data: { value: { status: string } } }) => { statuses.push(data.value.status); return {}; } });
  let sends = 0;
  const fetcher = (async () => { sends++; return Response.json({ data: { messageKey: ["test-message"] } }); }) as typeof fetch;
  try {
    assert.equal((await runCycleMonitor({ testId: "unit-test-123", fetcher })).status, "sent");
    assert.equal((await runCycleMonitor({ testId: "unit-test-123", fetcher })).status, "already_claimed");
    assert.equal(sends, 1);
    const failing = (async () => { sends++; throw new Error("timeout"); }) as typeof fetch;
    assert.equal((await runCycleMonitor({ testId: "unit-test-456", fetcher: failing })).status, "uncertain");
    assert.equal((await runCycleMonitor({ testId: "unit-test-456", fetcher: failing })).status, "already_claimed");
    assert.equal(sends, 2);
    assert.deepEqual(statuses, ["sent", "uncertain"]);
  } finally { if (old === undefined) delete process.env.REALTIME_CYCLE_MONITOR_KIM_URL; else process.env.REALTIME_CYCLE_MONITOR_KIM_URL = old; }
});
