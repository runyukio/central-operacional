import { NextResponse } from "next/server";

import { safeEqual } from "@/lib/realtime-hours-v2/auth";
import { maintainRealtimeHoursV2 } from "@/lib/realtime-hours-v2/maintenance";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const configured = process.env.CRON_SECRET?.trim() ?? "";
  const provided = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (!configured || !provided || !safeEqual(provided, configured)) {
    return NextResponse.json({ success: false, error: "Rotina não autorizada." }, { status: 401 });
  }
  try {
    return NextResponse.json(await maintainRealtimeHoursV2());
  } catch (error) {
    console.error("[realtime-hours-v2-maintenance] failure", error);
    return NextResponse.json({ success: false, error: "Falha na manutenção do Realtime Hours V2." }, { status: 500 });
  }
}
