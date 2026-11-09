import { NextResponse } from "next/server";

import { safeEqual } from "@/lib/realtime-hours-v2/auth";
import { cleanupRealtimeHoursV2Nonces, maintainRealtimeHoursV2, maintainRealtimeHoursV2History } from "@/lib/realtime-hours-v2/maintenance";

export const dynamic = "force-dynamic";
// Combined daily runs have separate bounded nonce/history transactions.
export const maxDuration = 120;

export async function GET(request: Request) {
  const configured = process.env.CRON_SECRET?.trim() ?? "";
  const provided = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (!configured || !provided || !safeEqual(provided, configured)) {
    return NextResponse.json({ success: false, error: "Rotina não autorizada." }, { status: 401 });
  }
  const task = new URL(request.url).searchParams.get("task") ?? "all";
  if (!["all", "nonces", "history"].includes(task)) {
    return NextResponse.json({ success: false, error: "Rotina inválida." }, { status: 400 });
  }
  try {
    const run = task === "nonces" ? cleanupRealtimeHoursV2Nonces : task === "history" ? maintainRealtimeHoursV2History : maintainRealtimeHoursV2;
    return NextResponse.json(await run());
  } catch (error) {
    console.error("[realtime-hours-v2-maintenance] failure", error);
    return NextResponse.json({ success: false, error: "Falha na manutenção do Realtime Hours V2." }, { status: 500 });
  }
}
