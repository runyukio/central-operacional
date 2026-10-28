import assert from "node:assert/strict";
import test from "node:test";
import { createHash, createHmac } from "crypto";

import { deriveDeviceSecret, verifySignedRequest } from "./auth";

test("verifies a valid signed request", () => {
  const master = "0123456789012345678901234567890123456789";
  const secret = deriveDeviceSecret(master, "device-1", 1);
  const body = JSON.stringify({ ok: true });
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const timestamp = "1793217600";
  const nonce = "00112233445566778899aabbccddeeff";
  const canonical = ["POST", "/api/realtime-hours/v2/heartbeat", timestamp, nonce, bodyHash].join("\n");
  const signature = createHmac("sha256", secret).update(canonical).digest("base64url");
  const result = verifySignedRequest({
    method: "POST",
    pathname: "/api/realtime-hours/v2/heartbeat",
    body,
    timestamp,
    nonce,
    bodyHash,
    signature
  }, secret, new Date(Number(timestamp) * 1_000));
  assert.equal(result.ok, true);
});

test("rejects a modified body", () => {
  const secret = Buffer.alloc(32, 1);
  const result = verifySignedRequest({
    method: "POST",
    pathname: "/api/test",
    body: "changed",
    timestamp: "1793217600",
    nonce: "00112233445566778899aabbccddeeff",
    bodyHash: createHash("sha256").update("original").digest("hex"),
    signature: "a".repeat(43)
  }, secret, new Date(1793217600 * 1_000));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "body_hash_mismatch");
});
