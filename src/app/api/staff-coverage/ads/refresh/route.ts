import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { refreshAdsStaffCoverageFromForecast } from "@/lib/staff-coverage-service";

export async function POST(request: Request) {
  const actor = await getApiActor();
  const body = await request.json().catch(() => ({})) as { startDate?: unknown };
  const result = await refreshAdsStaffCoverageFromForecast(
    actor,
    typeof body.startDate === "string" ? body.startDate : undefined
  );
  if ("error" in result) return NextResponse.json(result, { status: result.status ?? 400 });
  return NextResponse.json(result);
}
