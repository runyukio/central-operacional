import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centralActivityBridgeEnabled, publishActivityToCentral, type BridgeActivityRecord } from "@/lib/realtime-hours-v2/central-activity-bridge";
import { authenticateDeviceRequest } from "@/lib/realtime-hours-v2/device-auth";
import { parseJsonText, readRequestTextWithLimit } from "@/lib/realtime-hours-v2/request";

export const dynamic = "force-dynamic";
const schema = z.object({ after: z.string().uuid().optional() }).strict();

export async function POST(request: Request) {
  const body = await readRequestTextWithLimit(request, 1024);
  if (!body.ok) return NextResponse.json({ success: false }, { status: body.status });
  const auth = await authenticateDeviceRequest(request, body.text);
  if (!auth.ok) return NextResponse.json({ success: false }, { status: auth.status });
  const json = parseJsonText(body.text);
  const parsed = schema.safeParse(json.ok ? json.value : null);
  if (!parsed.success) return NextResponse.json({ success: false }, { status: 400 });
  if (!centralActivityBridgeEnabled(auth.device.id)) return NextResponse.json({ success: false }, { status: 409 });
  const after = parsed.data.after ? Prisma.sql`AND "id" > ${parsed.data.after}` : Prisma.empty;
  const records = await prisma.$queryRaw<Array<BridgeActivityRecord & { id: string; agentVersion: string | null }>>(Prisma.sql`
    SELECT "id","eventId","sourceType","applicationName","domain","startedAt","endedAt","durationSeconds","agentVersion"
    FROM "WorkstationActivitySegmentV2"
    WHERE "deviceId"=${auth.device.id} AND "endedAt" > CURRENT_TIMESTAMP - INTERVAL '7 days' ${after}
    ORDER BY "id" ASC LIMIT 250
  `);
  try {
    const result = await publishActivityToCentral({ device: auth.device, records, capturedAt: new Date().toISOString(), agentVersion: records[0]?.agentVersion || "1.0.0-alpha.1" });
    return NextResponse.json({ success: true, records: result.records, nextCursor: records.length === 250 ? records.at(-1)?.id : null });
  } catch {
    return NextResponse.json({ success: false, error: "Central activity delivery is temporarily unavailable." }, { status: 503 });
  }
}
