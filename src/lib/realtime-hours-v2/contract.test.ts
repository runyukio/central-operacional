import assert from "node:assert/strict";
import test from "node:test";

import { activityPayloadSchema, heartbeatPayloadSchema, normalizeDomain } from "./contract";

test("normalizes only the hostname", () => {
  assert.equal(normalizeDomain("https://www.youtube.com/watch?v=secret"), "youtube.com");
  assert.equal(normalizeDomain("chrome://settings"), "");
});

test("accepts a valid WEB activity payload", () => {
  const result = activityPayloadSchema.safeParse({
    schemaVersion: 2,
    agentVersion: "1.0.0",
    capturedAt: "2026-10-28T12:10:00Z",
    hostname: "PC-001",
    windowsUser: "wb_test",
    records: [{
      eventId: "00112233445566778899aabbccddeeff",
      sourceType: "WEB",
      applicationName: "chrome",
      domain: "youtube.com",
      detectionMethod: "browser-extension",
      startedAt: "2026-10-28T12:00:00Z",
      endedAt: "2026-10-28T12:10:00Z",
      durationSeconds: 600
    }]
  });
  assert.equal(result.success, true);
});

test("rejects WEB heartbeat without domain", () => {
  const result = heartbeatPayloadSchema.safeParse({
    schemaVersion: 2,
    agentVersion: "1.0.0",
    capturedAt: "2026-10-28T12:10:00Z",
    hostname: "PC-001",
    windowsUser: "wb_test",
    sessionState: "ACTIVE",
    idleSeconds: 0,
    currentType: "WEB"
  });
  assert.equal(result.success, false);
});


test("rejects a domain on non-WEB heartbeat", () => {
  const result = heartbeatPayloadSchema.safeParse({
    schemaVersion: 2,
    agentVersion: "1.0.0",
    capturedAt: "2026-10-28T12:10:00Z",
    hostname: "PC-001",
    windowsUser: "wb_test",
    sessionState: "ACTIVE",
    idleSeconds: 0,
    currentType: "APP",
    currentDomain: "youtube.com"
  });
  assert.equal(result.success, false);
});

test("rejects invalid DNS label boundaries", () => {
  assert.equal(normalizeDomain("https://-bad.example.com"), "");
  assert.equal(normalizeDomain("https://bad-.example.com"), "");
});
