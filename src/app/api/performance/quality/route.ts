import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import {
  getPerformanceQualityDashboard,
  PerformanceError
} from "@/lib/performance-service";
import { readPerformanceQualityParams } from "@/lib/performance-quality";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = readPerformanceQualityParams(url.searchParams);
    return NextResponse.json(await getPerformanceQualityDashboard(await getApiActor(), query));
  } catch (error) {
    if (error instanceof PerformanceError) {
      return NextResponse.json({ success: false, error: error.message, message: error.message }, { status: error.status });
    }
    console.error("[performance/quality] erro inesperado", error);
    return NextResponse.json({
      success: false,
      error: "Não foi possível carregar os dados de qualidade.",
      message: "Não foi possível carregar os dados de qualidade."
    }, { status: 500 });
  }
}
