import { normalizeDomain, type ActivitySourceTypeV2 } from "@/lib/realtime-hours-v2/contract";

const centralEndpoint = "https://eastriverbrasil.com/api/realtime-hours/agent-activity";
type BridgeEnvironment = Record<string, string | undefined>;
type BridgeDevice = { id: string; hostname: string; windowsUser: string; wbLogin: string | null };
export type BridgeActivityRecord = {
  eventId: string;
  sourceType: ActivitySourceTypeV2;
  applicationName?: string | null;
  domain?: string | null;
  startedAt: Date | string;
  endedAt: Date | string;
  durationSeconds: number;
};

export function centralActivityBridgeEnabled(deviceId: string, env: BridgeEnvironment = process.env) {
  return env.REALTIME_HOURS_V2_CENTRAL_BRIDGE_ENABLED === "true"
    && (env.REALTIME_HOURS_V2_CENTRAL_BRIDGE_DEVICE_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean).includes(deviceId);
}

export async function publishActivityToCentral(input: {
  device: BridgeDevice;
  capturedAt: string;
  agentVersion: string;
  records: BridgeActivityRecord[];
}, options: { env?: BridgeEnvironment; fetcher?: typeof fetch } = {}) {
  const env = options.env ?? process.env;
  if (!centralActivityBridgeEnabled(input.device.id, env)) return { forwarded: false, records: 0 };
  const token = env.REALTIME_HOURS_AGENT_TOKEN?.trim();
  if (!token) throw new Error("Central activity delivery is not configured.");
  if (!input.records.length) return { forwarded: true, records: 0 };
  const payload = {
    source: "realtime-hours-v2",
    capturedAt: input.capturedAt,
    records: input.records.map((record) => ({
      eventId: `v2:${input.device.id}:${record.eventId}`,
      hostname: input.device.hostname,
      windowsUser: input.device.windowsUser,
      wbLogin: input.device.wbLogin || input.device.windowsUser,
      sourceType: record.sourceType,
      applicationName: record.applicationName || undefined,
      domain: record.sourceType === "WEB" ? normalizeDomain(record.domain) : undefined,
      startedAt: new Date(record.startedAt).toISOString(),
      endedAt: new Date(record.endedAt).toISOString(),
      durationSeconds: record.durationSeconds,
      agentVersion: input.agentVersion
    }))
  };
  const response = await (options.fetcher ?? fetch)(centralEndpoint, {
    method: "POST", redirect: "error", cache: "no-store",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error(`Central activity delivery failed (${response.status}).`);
  const result = await response.json() as { success?: boolean; rowsProcessed?: number; rowsValid?: number; rowsError?: number };
  if (!result.success || result.rowsProcessed !== payload.records.length || result.rowsValid !== payload.records.length || result.rowsError !== 0) {
    throw new Error("Central did not acknowledge every activity record.");
  }
  return { forwarded: true, records: payload.records.length };
}
