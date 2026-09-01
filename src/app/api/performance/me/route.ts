import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { getOwnPerformanceDashboard, PerformanceError } from "@/lib/performance-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return NextResponse.json(await getOwnPerformanceDashboard(await getApiActor(), {
      startDate: url.searchParams.get("startDate") ?? undefined,
      endDate: url.searchParams.get("endDate") ?? undefined
    }));
  } catch (error) {
    if (error instanceof PerformanceError) {
      return NextResponse.json(
        { success: false, error: error.message, message: error.message },
        { status: error.status }
      );
    }
    console.error("[performance/me] erro inesperado", error);
    return NextResponse.json({
      success: false,
      error: "Não foi possível carregar seus dados de Performance.",
      message: "Não foi possível carregar seus dados de Performance."
    }, { status: 500 });
  }
}
