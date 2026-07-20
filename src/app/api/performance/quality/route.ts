import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import {
  getPerformanceAdsQualityDashboard,
  PerformanceError,
  type PerformanceQualityQuery
} from "@/lib/performance-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedView = url.searchParams.get("view");
    const requestedSortDirection = url.searchParams.get("sortDirection");
    const query: PerformanceQualityQuery = {
      startDate: url.searchParams.get("startDate") ?? undefined,
      endDate: url.searchParams.get("endDate") ?? undefined,
      view: requestedView === "monthly" || requestedView === "weekly" || requestedView === "daily"
        ? requestedView
        : undefined,
      sortDirection: requestedSortDirection === "asc" || requestedSortDirection === "desc"
        ? requestedSortDirection
        : undefined
    };
    return NextResponse.json(await getPerformanceAdsQualityDashboard(await getApiActor(), query));
  } catch (error) {
    if (error instanceof PerformanceError) {
      return NextResponse.json({ success: false, error: error.message, message: error.message }, { status: error.status });
    }
    console.error("[performance/quality] erro inesperado", error);
    return NextResponse.json({
      success: false,
      error: "Não foi possível carregar a qualidade de ADS.",
      message: "Não foi possível carregar a qualidade de ADS."
    }, { status: 500 });
  }
}
