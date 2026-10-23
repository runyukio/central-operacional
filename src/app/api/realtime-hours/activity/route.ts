import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { canAccessRealtimeHoursActivity } from "@/lib/realtime-hours-permissions";
import { getWorkstationActivity } from "@/lib/workstation-activity-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getApiActor();
  if (!canAccessRealtimeHoursActivity({ ...actor, status: "ACTIVE" })) {
    return NextResponse.json({
      success: false,
      error: "Você não tem permissão para acessar atividade de sites e aplicativos.",
      message: "Você não tem permissão para acessar atividade de sites e aplicativos."
    }, { status: 403 });
  }

  const url = new URL(request.url);
  const result = await getWorkstationActivity(actor, {
    date: url.searchParams.get("date"),
    search: url.searchParams.get("search"),
    sourceType: url.searchParams.get("sourceType"),
    domain: url.searchParams.get("domain"),
    employeeId: url.searchParams.get("employeeId"),
    limit: url.searchParams.get("limit")
  });

  return NextResponse.json(result, {
    status: "status" in result && typeof result.status === "number" ? result.status : 200
  });
}
