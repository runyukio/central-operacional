import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { getPerformanceProductionDashboard, PerformanceError, type PerformanceQuery } from "@/lib/performance-service";

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
      skill: url.searchParams.get("skill") ?? undefined,
      employeeStatus: url.searchParams.get("employeeStatus") ?? undefined,
      wfhStatus: url.searchParams.get("wfhStatus") ?? undefined,
      wbLogins: url.searchParams.get("wbLogins") ?? undefined,
      sortBy: readSortBy(url.searchParams.get("sortBy")),
      sortDirection: readSortDirection(url.searchParams.get("sortDirection")),
      granularity: readGranularity(url.searchParams.get("granularity"))
    };
    return NextResponse.json(await getPerformanceProductionDashboard(actor, query));
  } catch (error) {
    return performanceErrorResponse(error);
  }
}

function readView(value: string | null): PerformanceQuery["view"] {
  return value === "wfh" || value === "mine" || value === "framework" ? value : undefined;
}

function readSortBy(value: string | null): PerformanceQuery["sortBy"] {
  return value === "quality" || value === "submit" || value === "aht" || value === "abs" ? value : undefined;
}

function readSortDirection(value: string | null): PerformanceQuery["sortDirection"] {
  return value === "asc" || value === "desc" ? value : undefined;
}

function readGranularity(value: string | null): PerformanceQuery["granularity"] {
  return value === "hourly" || value === "weekly" || value === "monthly" ? value : value === "daily" ? "daily" : undefined;
}

function performanceErrorResponse(error: unknown) {
  if (error instanceof PerformanceError) {
    return NextResponse.json({ success: false, error: error.message, message: error.message, fields: error.fields }, { status: error.status });
  }
  console.error("[performance] erro inesperado", error);
  return NextResponse.json({ success: false, error: "Não foi possível carregar Performance.", message: "Não foi possível carregar Performance." }, { status: 500 });
}
