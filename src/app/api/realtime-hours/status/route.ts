import { NextResponse } from "next/server";

import { authorizeRealtimeHoursRead, getRealtimeHoursStatus } from "@/lib/realtime-hours-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await authorizeRealtimeHoursRead(request);
  if ("error" in access) {
    return NextResponse.json({ success: false, error: access.error, message: access.error }, { status: access.status });
  }

  const url = new URL(request.url);
  const result = await getRealtimeHoursStatus({
    limit: url.searchParams.get("limit")
  });
  return NextResponse.json(result);
}
