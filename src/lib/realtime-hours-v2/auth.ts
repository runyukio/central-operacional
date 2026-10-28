import { createHash, createHmac, timingSafeEqual } from "crypto";

export type SignedRequestInput = {
  method: string;
  pathname: string;
  body: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
  signature: string;
};

export function deriveDeviceSecret(masterKey: string, deviceId: string, secretVersion: number) {
  if (Buffer.byteLength(masterKey, "utf8") < 32) {
    throw new Error("REALTIME_HOURS_V2_MASTER_KEY must contain at least 32 bytes.");
  }
  return createHmac("sha256", masterKey)
    .update(`realtime-hours-v2\ndevice:${deviceId}\nversion:${secretVersion}`, "utf8")
    .digest();
}

export function verifySignedRequest(input: SignedRequestInput, secret: Buffer, now = new Date()) {
  if (!/^\d{10}$/.test(input.timestamp)) return { ok: false as const, reason: "invalid_timestamp" };
  if (!/^[a-f0-9]{32}$/i.test(input.nonce)) return { ok: false as const, reason: "invalid_nonce" };
  if (!/^[a-f0-9]{64}$/i.test(input.bodyHash)) return { ok: false as const, reason: "invalid_body_hash" };
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.signature)) return { ok: false as const, reason: "invalid_signature_format" };

  const timestampMs = Number(input.timestamp) * 1_000;
  if (!Number.isFinite(timestampMs) || Math.abs(now.getTime() - timestampMs) > 5 * 60_000) {
    return { ok: false as const, reason: "expired_timestamp" };
  }

  const actualBodyHash = createHash("sha256").update(input.body, "utf8").digest("hex");
  if (!safeEqual(actualBodyHash, input.bodyHash.toLowerCase())) {
    return { ok: false as const, reason: "body_hash_mismatch" };
  }

  const canonical = [
    input.method.toUpperCase(),
    input.pathname,
    input.timestamp,
    input.nonce.toLowerCase(),
    input.bodyHash.toLowerCase()
  ].join("\n");
  const expected = createHmac("sha256", secret).update(canonical, "utf8").digest("base64url");
  if (!safeEqual(expected, input.signature)) {
    return { ok: false as const, reason: "signature_mismatch" };
  }

  return { ok: true as const };
}

export function safeEqual(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
