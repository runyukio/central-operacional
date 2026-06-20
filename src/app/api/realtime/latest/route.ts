import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { getRealtimeLatestStatus } from "@/lib/realtime-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const view = url.searchParams.get("view");
  const result = await getRealtimeLatestStatus(actor, {
    view: view === "agents" || view === "queues" || view === "both" ? view : undefined
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error, message: result.error }, { status: result.status ?? 400 });
  }
  return NextResponse.json(result);
}
