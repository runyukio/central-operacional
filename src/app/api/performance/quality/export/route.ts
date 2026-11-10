import { NextResponse } from "next/server";
import { getApiActor } from "@/lib/api-actor";
import { exportPerformanceQualityXlsxData, PerformanceError } from "@/lib/performance-service";
import { readPerformanceQualityParams } from "@/lib/performance-quality";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = { ...readPerformanceQualityParams(searchParams), search: searchParams.get("search") ?? undefined };
    return buildXlsxResponse(await exportPerformanceQualityXlsxData(await getApiActor(), query));
  } catch (error) {
    if (error instanceof PerformanceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[performance/quality/export] erro inesperado", error);
    return NextResponse.json({ error: "Não foi possível exportar os dados de qualidade." }, { status: 500 });
  }
}
