import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { getPerformanceProductionDashboard, PerformanceError, type PerformanceQuery } from "@/lib/performance-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await getApiActor();
    const url = new URL(request.url);
    const query: PerformanceQuery = {
      startDate: url.searchParams.get("startDate") ?? undefined,
      endDate: url.searchParams.get("endDate") ?? undefined,
      lob: url.searchParams.get("lob") ?? undefined,
      granularity: readGranularity(url.searchParams.get("granularity")),
      slaTargetMinutes: readPositiveNumber(url.searchParams.get("slaTargetMinutes")),
      metadataOnly: url.searchParams.get("metadataOnly") === "true"
    };
    return NextResponse.json(await getPerformanceProductionDashboard(actor, query));
  } catch (error) {
    return performanceErrorResponse(error);
  }
}

function readGranularity(value: string | null): PerformanceQuery["granularity"] {
  return value === "hourly" || value === "weekly" || value === "monthly" ? value : value === "daily" ? "daily" : undefined;
}

function readPositiveNumber(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function performanceErrorResponse(error: unknown) {
  if (error instanceof PerformanceError) {
    return NextResponse.json({ success: false, error: error.message, message: error.message, fields: error.fields }, { status: error.status });
  }
  console.error("[performance] erro inesperado", error);
  return NextResponse.json({ success: false, error: "Não foi possível carregar Performance.", message: "Não foi possível carregar Performance." }, { status: 500 });
}
