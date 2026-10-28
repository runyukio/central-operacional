import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import {
  getPerformanceSupervisorsDashboard,
  getPerformanceSupervisorAgentsDashboard,
  PerformanceError,
  type PerformanceSupervisorsQuery
} from "@/lib/performance-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query: PerformanceSupervisorsQuery = {
      view: readView(url.searchParams.get("view")),
      startDate: url.searchParams.get("startDate") ?? undefined,
      endDate: url.searchParams.get("endDate") ?? undefined
    };
    const actor = await getApiActor(), supervisorId = url.searchParams.get("supervisorId");
    const result = supervisorId ? await getPerformanceSupervisorAgentsDashboard(actor, supervisorId, query) : await getPerformanceSupervisorsDashboard(actor, query);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof PerformanceError) {
      return NextResponse.json({ success: false, error: error.message, message: error.message }, { status: error.status });
    }
    console.error("[performance/supervisors] erro inesperado", error);
    return NextResponse.json({
      success: false,
      error: "Não foi possível carregar os dados dos supervisores.",
      message: "Não foi possível carregar os dados dos supervisores."
    }, { status: 500 });
  }
}

function readView(value: string | null): PerformanceSupervisorsQuery["view"] {
  return value === "monthly" || value === "weekly" || value === "daily" ? value : undefined;
}
