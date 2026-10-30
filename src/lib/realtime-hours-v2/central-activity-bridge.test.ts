import assert from "node:assert/strict";
import test from "node:test";
import { centralActivityBridgeEnabled, publishActivityToCentral } from "./central-activity-bridge";

const input = {
  device: { id: "device-pilot", hostname: "PILOT-PC", windowsUser: "pilot", wbLogin: null },
  capturedAt: "2026-10-29T19:00:00Z", agentVersion: "1.0.0-alpha.1",
  records: [{ eventId: "event-example-123456", sourceType: "WEB" as const, applicationName: "chrome", domain: "https://www.example.com/private?query=discarded", startedAt: "2026-10-29T18:59:00Z", endedAt: "2026-10-29T19:00:00Z", durationSeconds: 60 }]
};
const enabled = { REALTIME_HOURS_V2_CENTRAL_BRIDGE_ENABLED: "true", REALTIME_HOURS_V2_CENTRAL_BRIDGE_DEVICE_IDS: "device-pilot", REALTIME_HOURS_AGENT_TOKEN: "test-server-only-credential" };

test("trusted deployment permission authorizes new devices while the global switch remains required", () => {
  assert.equal(centralActivityBridgeEnabled("new-fleet-device", enabled, true), true);
  assert.equal(centralActivityBridgeEnabled("new-fleet-device", enabled, false), false);
  assert.equal(centralActivityBridgeEnabled("new-fleet-device", {}, true), false);
});

test("central delivery is disabled unless explicitly enabled for this device", async () => {
  const fetcher = (async () => { throw new Error("must not send"); }) as typeof fetch;
  assert.deepEqual(await publishActivityToCentral(input, { env: {}, fetcher }), { forwarded: false, records: 0 });
  assert.deepEqual(await publishActivityToCentral(input, { env: { ...enabled, REALTIME_HOURS_V2_CENTRAL_BRIDGE_DEVICE_IDS: "other-device" }, fetcher }), { forwarded: false, records: 0 });
});

test("publishes only normalized domains and uses stable device-specific event IDs", async () => {
  const fetcher = (async (url, options) => {
    assert.equal(url, "https://eastriverbrasil.com/api/realtime-hours/agent-activity");
    assert.equal(options?.redirect, "error");
    const payload = JSON.parse(String(options?.body));
    assert.equal(payload.records[0].domain, "example.com");
    assert.equal(payload.records[0].hostname, "PILOT-PC");
    assert.equal(payload.records[0].eventId, "v2:device-pilot:event-example-123456");
    assert.equal(JSON.stringify(payload).includes("test-server-only-credential"), false);
    assert.equal("employeeId" in payload.records[0], false);
    return Response.json({ success: true, rowsProcessed: 1, rowsValid: 1, rowsError: 0 });
  }) as typeof fetch;
  assert.deepEqual(await publishActivityToCentral(input, { env: enabled, fetcher }), { forwarded: true, records: 1 });
});

test("delivery fails when Central refuses or only partially acknowledges the records", async () => {
  for (const response of [new Response("offline", { status: 503 }), Response.json({ success: true, rowsProcessed: 1, rowsValid: 0, rowsError: 1 }), Response.json({ success: true, accepted: false })]) {
    await assert.rejects(publishActivityToCentral(input, { env: enabled, fetcher: (async () => response) as typeof fetch }));
  }
});
