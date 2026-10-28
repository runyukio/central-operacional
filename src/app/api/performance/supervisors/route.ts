import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import {
  getPerformanceSupervisorsDashboard,
  getPerformanceSupervisorsWorkMetrics,
  getPerformanceSupervisorAgentsDashboard,
  PerformanceError,
  type PerformanceSupervisorsQuery
} from "@/lib/performance-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = Date.now();
  try {
    const url = new URL(request.url);
    const phase = url.searchParams.get("phase") || "full";
    if (!["full", "base", "work"].includes(phase)) throw new PerformanceError("Consulta inválida.", 400);
    const query: PerformanceSupervisorsQuery = {
      includePunctuality: phase !== "base",
      view: readView(url.searchParams.get("view")),
      startDate: url.searchParams.get("startDate") ?? undefined,
      endDate: url.searchParams.get("endDate") ?? undefined
    };
    const actor = await getApiActor(), supervisorId = url.searchParams.get("supervisorId");
    const result = phase === "work" ? await getPerformanceSupervisorsWorkMetrics(actor, query, supervisorId || undefined) : supervisorId ? await getPerformanceSupervisorAgentsDashboard(actor, supervisorId, query) : await getPerformanceSupervisorsDashboard(actor, query);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store", "Server-Timing": `supervisors-${phase};dur=${Date.now() - startedAt}` } });
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
