import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { getRealtimeSnapshot } from "@/lib/realtime-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getApiActor();
  const result = await getRealtimeSnapshot(actor);
  if ("error" in result) {
    return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  }
  return NextResponse.json(result);
}
