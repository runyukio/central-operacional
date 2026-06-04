import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { getPerformanceDashboard, PerformanceError, type PerformanceQuery } from "@/lib/performance-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await getApiActor();
    const url = new URL(request.url);
    const query: PerformanceQuery = {
      view: readView(url.searchParams.get("view")),
      startDate: url.searchParams.get("startDate") ?? undefined,
      endDate: url.searchParams.get("endDate") ?? undefined,
      month: url.searchParams.get("month") ?? undefined,
      employeeId: url.searchParams.get("employeeId") ?? undefined,
      lob: url.searchParams.get("lob") ?? undefined,
      supervisorId: url.searchParams.get("supervisorId") ?? undefined,
      role: url.searchParams.get("role") ?? undefined,
      skill: url.searchParams.get("skill") ?? undefined
    };
    return NextResponse.json(await getPerformanceDashboard(actor, query));
  } catch (error) {
    return performanceErrorResponse(error);
  }
}

function readView(value: string | null): PerformanceQuery["view"] {
  return value === "wfh" || value === "mine" ? value : undefined;
}

function performanceErrorResponse(error: unknown) {
  if (error instanceof PerformanceError) {
    return NextResponse.json({ success: false, error: error.message, message: error.message, fields: error.fields }, { status: error.status });
  }
  console.error("[performance] erro inesperado", error);
  return NextResponse.json({ success: false, error: "Não foi possível carregar Performance.", message: "Não foi possível carregar Performance." }, { status: 500 });
}
