import { NextResponse } from "next/server";

import {
  authorizeRealtimeHoursManage,
  authorizeRealtimeHoursRead,
  listRealtimeHoursIdentityMappings,
  upsertRealtimeHoursIdentityMapping
} from "@/lib/realtime-hours-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await authorizeRealtimeHoursRead(request);
  if ("error" in access) {
    return NextResponse.json({ success: false, error: access.error, message: access.error }, { status: access.status });
  }

  const result = await listRealtimeHoursIdentityMappings();
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const access = await authorizeRealtimeHoursManage();
  if ("error" in access) {
    return NextResponse.json({ success: false, error: access.error, message: access.error }, { status: access.status });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({
      success: false,
      error: "JSON inválido no corpo da requisição.",
      message: "JSON inválido no corpo da requisição."
    }, { status: 400 });
  }

  const result = await upsertRealtimeHoursIdentityMapping(body, access.actor.email);
  if ("error" in result) {
    const status = typeof result.status === "number" ? result.status : 400;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}
