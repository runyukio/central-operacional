import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { buildXlsxResponse } from "@/lib/xlsx-export";
import { exportPerformanceXlsxData, PerformanceError, type PerformanceQuery } from "@/lib/performance-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await getApiActor();
    const url = new URL(request.url);
    const query: PerformanceQuery = {
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
      sortDirection: readSortDirection(url.searchParams.get("sortDirection"))
    };
    return buildXlsxResponse(await exportPerformanceXlsxData(actor, query));
  } catch (error) {
    if (error instanceof PerformanceError) {
      return NextResponse.json({ success: false, error: error.message, message: error.message }, { status: error.status });
    }
    console.error("[performance/export] erro inesperado", error);
    return NextResponse.json({ success: false, error: "Não foi possível exportar Performance.", message: "Não foi possível exportar Performance." }, { status: 500 });
  }
}

function readSortBy(value: string | null): PerformanceQuery["sortBy"] {
  return value === "quality" || value === "submit" || value === "aht" || value === "abs" ? value : undefined;
}

function readSortDirection(value: string | null): PerformanceQuery["sortDirection"] {
  return value === "asc" || value === "desc" ? value : undefined;
}
