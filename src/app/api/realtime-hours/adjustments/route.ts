import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { errorResponse, errorStatus } from "@/lib/api-errors";
import { listRealtimeHoursAdjustmentRequests, requestRealtimeHoursAdjustment, reviewRealtimeHoursAdjustment } from "@/lib/realtime-hours-adjustments-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const result = await listRealtimeHoursAdjustmentRequests(actor, {
    date: url.searchParams.get("date"),
    search: url.searchParams.get("search")
  });
  if ("error" in result) return NextResponse.json(result, { status: "type" in result ? errorStatus(result as any) : 400 });
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const actor = await getApiActor();
  const result = await requestRealtimeHoursAdjustment(actor, await request.json().catch(() => ({})));
  if ("error" in result) return "type" in result ? errorResponse(result as any) : NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}

export async function PATCH(request: Request) {
  const actor = await getApiActor();
  const result = await reviewRealtimeHoursAdjustment(actor, await request.json().catch(() => ({})));
  if ("error" in result) return "type" in result ? errorResponse(result as any) : NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
