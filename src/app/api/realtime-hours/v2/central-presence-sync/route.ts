import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { heartbeatPayloadSchema } from "@/lib/realtime-hours-v2/contract";
import { centralPresenceBridgeEnabled, publishPresenceToCentral } from "@/lib/realtime-hours-v2/central-presence-bridge";
import { authenticateDeviceRequest } from "@/lib/realtime-hours-v2/device-auth";
import { parseJsonText, readRequestTextWithLimit } from "@/lib/realtime-hours-v2/request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readRequestTextWithLimit(request, 512);
  if (!body.ok) return NextResponse.json({ success: false }, { status: body.status });
  const auth = await authenticateDeviceRequest(request, body.text);
  if (!auth.ok) return NextResponse.json({ success: false }, { status: auth.status });
  const json = parseJsonText(body.text);
  if (!json.ok || !z.object({}).strict().safeParse(json.value).success) return NextResponse.json({ success: false }, { status: 400 });
  if (!centralPresenceBridgeEnabled(auth.device.id)) return NextResponse.json({ success: false }, { status: 409 });
  const [state] = await prisma.$queryRaw<Array<{ capturedAt: Date; sessionState: string; idleSeconds: number; activeProcessName: string | null; agentVersion: string }>>(Prisma.sql`
    SELECT "capturedAt","sessionState","idleSeconds","activeProcessName","agentVersion"
    FROM "WorkstationCurrentStateV2" WHERE "deviceId"=${auth.device.id}
  `);
  if (!state) return NextResponse.json({ success: false }, { status: 404 });
  const snapshot = heartbeatPayloadSchema.safeParse({ schemaVersion: 2, hostname: auth.device.hostname, windowsUser: auth.device.windowsUser, agentVersion: state.agentVersion, capturedAt: state.capturedAt.toISOString(), sessionState: state.sessionState, idleSeconds: state.idleSeconds, activeProcessName: state.activeProcessName || "" });
  if (!snapshot.success) return NextResponse.json({ success: false }, { status: 409 });
  try {
    const result = await publishPresenceToCentral({ device: auth.device, snapshot: snapshot.data });
    return NextResponse.json({ success: true, records: result.records, capturedAt: snapshot.data.capturedAt });
  } catch {
    return NextResponse.json({ success: false, error: "Central presence delivery is temporarily unavailable." }, { status: 503 });
  }
}
