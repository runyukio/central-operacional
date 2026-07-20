import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import {
  getPerformanceAgentsDashboard,
  PerformanceError,
  type PerformanceAgentsQuery
} from "@/lib/performance-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query: PerformanceAgentsQuery = {
      startDate: url.searchParams.get("startDate") ?? undefined,
      endDate: url.searchParams.get("endDate") ?? undefined,
      lob: url.searchParams.get("lob") ?? undefined,
      supervisorId: url.searchParams.get("supervisorId") ?? undefined,
      shiftId: url.searchParams.get("shiftId") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      sortBy: readSortBy(url.searchParams.get("sortBy")),
      sortDirection: readSortDirection(url.searchParams.get("sortDirection")),
      page: readPositiveInteger(url.searchParams.get("page")),
      pageSize: readPositiveInteger(url.searchParams.get("pageSize")),
      metadataOnly: url.searchParams.get("metadataOnly") === "true"
    };
    return NextResponse.json(await getPerformanceAgentsDashboard(await getApiActor(), query));
  } catch (error) {
    if (error instanceof PerformanceError) {
      return NextResponse.json({ success: false, error: error.message, message: error.message }, { status: error.status });
    }
    console.error("[performance/agents] erro inesperado", error);
    return NextResponse.json({
      success: false,
      error: "Não foi possível carregar os dados dos agentes.",
      message: "Não foi possível carregar os dados dos agentes."
    }, { status: 500 });
  }
}

function readSortBy(value: string | null): PerformanceAgentsQuery["sortBy"] {
  return value === "employeeName"
    || value === "wbLogin"
    || value === "lob"
    || value === "supervisor"
    || value === "shift"
    || value === "submit"
    || value === "aht"
    ? value
    : undefined;
}

function readSortDirection(value: string | null): PerformanceAgentsQuery["sortDirection"] {
  return value === "asc" || value === "desc" ? value : undefined;
}

function readPositiveInteger(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
