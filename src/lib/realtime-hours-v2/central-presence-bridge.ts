import { createHash } from "node:crypto";
import type { HeartbeatPayloadV2 } from "@/lib/realtime-hours-v2/contract";
import { centralActivityBridgeEnabled } from "@/lib/realtime-hours-v2/central-activity-bridge";

type Environment = Record<string, string | undefined>;
type Device = { id: string; hostname: string; windowsUser: string; wbLogin: string | null; centralDeliveryAllowed?: boolean };

export function centralPresenceBridgeEnabled(deviceId: string, env: Environment = process.env, centralDeliveryAllowed = false) {
  return env.REALTIME_HOURS_V2_PRESENCE_BRIDGE_ENABLED === "true" && centralActivityBridgeEnabled(deviceId, env, centralDeliveryAllowed);
}

export function centralPresenceRecord(device: Device, snapshot: HeartbeatPayloadV2) {
  const capturedAt = new Date(snapshot.capturedAt).toISOString();
  const active = snapshot.sessionState === "ACTIVE";
  return {
    eventId: `v2-presence:${createHash("sha256").update(`${device.id}\n${capturedAt}`).digest("hex")}`,
    eventType: "HEARTBEAT",
    sessionState: snapshot.sessionState,
    hostname: device.hostname,
    windowsUser: device.windowsUser,
    wbLogin: device.wbLogin || device.windowsUser,
    isSessionActive: active,
    isInputActive: active,
    idleSeconds: snapshot.idleSeconds,
    lastActivityAt: new Date(new Date(capturedAt).getTime() - snapshot.idleSeconds * 1000).toISOString(),
    activeProcessName: snapshot.activeProcessName || undefined,
    agentVersion: snapshot.agentVersion,
    identitySource: "windows_agent_v2",
    identityConfidence: "UNKNOWN",
    originDeviceId: device.id
  };
}

export async function publishPresenceToCentral(input: { device: Device; snapshot: HeartbeatPayloadV2 }, options: { env?: Environment; fetcher?: typeof fetch } = {}) {
  const env = options.env ?? process.env;
  if (!centralPresenceBridgeEnabled(input.device.id, env, input.device.centralDeliveryAllowed)) return { forwarded: false, records: 0 };
  const token = env.REALTIME_HOURS_AGENT_TOKEN?.trim();
  if (!token) throw new Error("Central presence delivery is not configured.");
  const response = await (options.fetcher ?? fetch)("https://eastriverbrasil.com/api/realtime-hours/agent-snapshot", {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ capturedAt: input.snapshot.capturedAt, records: [centralPresenceRecord(input.device, input.snapshot)] })
  });
  if (!response.ok) throw new Error(`Central presence delivery failed (${response.status}).`);
  const result = await response.json() as { success?: boolean; accepted?: boolean; discarded?: boolean; rowsProcessed?: number; rowsValid?: number; rowsDuplicate?: number; rowsError?: number };
  // rowsError on this legacy endpoint can be cumulative for the shared batch.
  // Acknowledgement is based on this request's inserted + duplicate row count.
  if (!result.success || result.accepted === false || result.discarded || result.rowsProcessed !== 1 || (result.rowsValid ?? 0) + (result.rowsDuplicate ?? 0) !== 1) {
    throw new Error("Central did not acknowledge the presence record.");
  }
  return { forwarded: true, records: 1 };
}
