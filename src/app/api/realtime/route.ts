import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { getRealtimeSnapshot } from "@/lib/realtime-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const result = await getRealtimeSnapshot(actor, {
    cycleDownload: url.searchParams.get("cycleDownload") ?? undefined
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  }
  return NextResponse.json(result);
}
