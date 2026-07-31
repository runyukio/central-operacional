import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import {
  exportPerformanceAgentsXlsxData,
  PerformanceError,
  type PerformanceAgentsQuery
} from "@/lib/performance-service";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query: PerformanceAgentsQuery = {
      view: readView(url.searchParams.get("view")),
      startDate: url.searchParams.get("startDate") ?? undefined,
      endDate: url.searchParams.get("endDate") ?? undefined,
      lob: url.searchParams.get("lob") ?? undefined,
      slaTargetMinutes: readPositiveNumber(url.searchParams.get("slaTargetMinutes")),
      supervisorId: url.searchParams.get("supervisorId") ?? undefined,
      shiftId: url.searchParams.get("shiftId") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      sortBy: readSortBy(url.searchParams.get("sortBy")),
      sortDirection: readSortDirection(url.searchParams.get("sortDirection"))
    };
    return buildXlsxResponse(await exportPerformanceAgentsXlsxData(await getApiActor(), query));
  } catch (error) {
    if (error instanceof PerformanceError) {
      return NextResponse.json({ success: false, error: error.message, message: error.message }, { status: error.status });
    }
    console.error("[performance/agents/export] erro inesperado", error);
    return NextResponse.json({
      success: false,
      error: "Não foi possível exportar os agentes de Performance.",
      message: "Não foi possível exportar os agentes de Performance."
    }, { status: 500 });
  }
}

function readView(value: string | null): PerformanceAgentsQuery["view"] {
  return value === "monthly" || value === "weekly" || value === "daily" ? value : undefined;
}

function readSortBy(value: string | null): PerformanceAgentsQuery["sortBy"] {
  return value === "employeeName"
    || value === "wbLogin"
    || value === "lob"
    || value === "supervisor"
    || value === "shift"
    || value === "outputTotal"
    || value === "submit"
    || value === "aht"
    || value === "quality"
    ? value
    : undefined;
}

function readSortDirection(value: string | null): PerformanceAgentsQuery["sortDirection"] {
  return value === "asc" || value === "desc" ? value : undefined;
}

function readPositiveNumber(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
