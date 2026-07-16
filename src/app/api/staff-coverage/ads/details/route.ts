import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { errorStatus } from "@/lib/api-errors";
import { getAdsHourlyCoverageDetails } from "@/lib/ads-hourly-coverage-service";

export async function GET(request: Request) {
  const actor = await getApiActor();
  const url = new URL(request.url);
  const result = await getAdsHourlyCoverageDetails(actor, {
    date: url.searchParams.get("date") ?? undefined,
    hour: url.searchParams.get("hour") ?? undefined
  });
  if ("error" in result) {
    const status = "type" in result ? errorStatus(result as any) : result.status ?? 400;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}
