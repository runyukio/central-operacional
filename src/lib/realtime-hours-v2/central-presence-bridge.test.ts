import assert from "node:assert/strict";
import test from "node:test";
import { heartbeatPayloadSchema } from "./contract";
import { centralPresenceRecord, publishPresenceToCentral } from "./central-presence-bridge";

const device = { id: "pilot-device", hostname: "PILOT-PC", windowsUser: "pilot", wbLogin: null };
const snapshot = heartbeatPayloadSchema.parse({ schemaVersion: 2, agentVersion: "1.0.0-alpha.1", capturedAt: "2026-10-29T19:00:00.000Z", hostname: "UNTRUSTED-PC", windowsUser: "other", wbLogin: "other-person", sessionState: "ACTIVE", idleSeconds: 45, activeProcessName: "chrome", currentType: "WEB", currentDomain: "example.com" });
const enabled = { REALTIME_HOURS_V2_CENTRAL_BRIDGE_ENABLED: "true", REALTIME_HOURS_V2_CENTRAL_BRIDGE_DEVICE_IDS: device.id, REALTIME_HOURS_V2_PRESENCE_BRIDGE_ENABLED: "true", REALTIME_HOURS_AGENT_TOKEN: "test-server-credential" };

test("presence uses enrolled identity and does not assign an unverified employee", () => {
  const row = centralPresenceRecord(device, snapshot);
  assert.equal(row.hostname, "PILOT-PC"); assert.equal(row.windowsUser, "pilot"); assert.equal(row.wbLogin, "pilot");
  assert.equal(row.identityConfidence, "UNKNOWN"); assert.equal("employeeId" in row, false);
  assert.equal("activeWindowTitle" in row, false); assert.equal("domain" in row, false);
  assert.equal(row.lastActivityAt, "2026-10-29T18:59:15.000Z");
  assert.ok(row.eventId.length <= 80);
  assert.equal(row.eventId, centralPresenceRecord(device, snapshot).eventId);
  assert.notEqual(row.eventId, centralPresenceRecord({ ...device, id: "another-device" }, snapshot).eventId);
});

test("active, idle, locked and offline preserve the old snapshot semantics", () => {
  for (const state of ["ACTIVE", "IDLE", "LOCKED", "OFFLINE"] as const) {
    const row = centralPresenceRecord(device, { ...snapshot, sessionState: state });
    assert.equal(row.isSessionActive, state === "ACTIVE");
    assert.equal(row.isInputActive, state === "ACTIVE");
    assert.equal(row.sessionState, state);
  }
});

test("disabled presence or an unrelated device never sends to production", async () => {
  const fetcher = (async () => { throw new Error("must not send"); }) as typeof fetch;
  assert.equal((await publishPresenceToCentral({ device, snapshot }, { env: {}, fetcher })).forwarded, false);
  assert.equal((await publishPresenceToCentral({ device: { ...device, id: "other" }, snapshot }, { env: enabled, fetcher })).forwarded, false);
});

test("existing snapshot importer can acknowledge new or duplicate presence safely", async () => {
  for (const ack of [{ success: true, rowsProcessed: 1, rowsValid: 1, rowsDuplicate: 0, rowsError: 0 }, { success: true, rowsProcessed: 1, rowsValid: 1, rowsDuplicate: 0, rowsError: 3 }, { success: true, status: "DUPLICATE", rowsProcessed: 1, rowsValid: 0, rowsDuplicate: 1, rowsError: 0 }]) {
    const fetcher = (async (url, options) => {
      assert.equal(url, "https://eastriverbrasil.com/api/realtime-hours/agent-snapshot");
      assert.equal(options?.redirect, "error");
      assert.equal(String(options?.body).includes("test-server-credential"), false);
      return Response.json(ack);
    }) as typeof fetch;
    assert.equal((await publishPresenceToCentral({ device, snapshot }, { env: enabled, fetcher })).forwarded, true);
  }
});

test("discarded snapshots, temporary failures and incomplete acknowledgements fail delivery", async () => {
  for (const response of [new Response("offline", { status: 503 }), Response.json({ success: true, discarded: true, accepted: false }), Response.json({ success: true, rowsProcessed: 1, rowsValid: 0, rowsError: 0 })]) {
    await assert.rejects(publishPresenceToCentral({ device, snapshot }, { env: enabled, fetcher: (async () => response) as typeof fetch }));
  }
});
