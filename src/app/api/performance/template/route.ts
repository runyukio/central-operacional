import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { buildXlsxResponse } from "@/lib/xlsx-export";
import { performanceTemplate, PerformanceError } from "@/lib/performance-service";
import { canImportPerformance } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await getApiActor();
    if (!canImportPerformance({ role: actor.role, status: "ACTIVE" })) {
      return NextResponse.json({ success: false, error: "Apenas ADMIN ou WFM podem baixar templates de Performance.", message: "Apenas ADMIN ou WFM podem baixar templates de Performance." }, { status: 403 });
    }
    const url = new URL(request.url);
    const requestedType = url.searchParams.get("type");
    const type = requestedType === "production" ? "production" : requestedType === "tns-quality" ? "tns-quality" : "quality";
    return buildXlsxResponse(performanceTemplate(type));
  } catch (error) {
    if (error instanceof PerformanceError) {
      return NextResponse.json({ success: false, error: error.message, message: error.message }, { status: error.status });
    }
    console.error("[performance/template] erro inesperado", error);
    return NextResponse.json({ success: false, error: "Não foi possível baixar o template.", message: "Não foi possível baixar o template." }, { status: 500 });
  }
}
