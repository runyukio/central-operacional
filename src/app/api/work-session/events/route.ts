import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { errorStatus } from "@/lib/api-errors";
import { getWorkSessionEvents, registerWorkSessionEvent } from "@/lib/work-session-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({}));
  const result = await registerWorkSessionEvent(payload);
  if ("error" in result) return NextResponse.json(result, { status: result.status ?? 400 });
  return NextResponse.json(result);
}

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const result = await getWorkSessionEvents(actor, {
    employeeId: url.searchParams.get("employeeId") ?? undefined,
    date: url.searchParams.get("date") ?? undefined
  });
  if ("error" in result) return NextResponse.json(result, { status: (result as { status?: number }).status ?? errorStatus(result as any) });
  return NextResponse.json(result);
}
