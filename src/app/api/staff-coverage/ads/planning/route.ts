import { NextResponse } from "next/server";
import { getApiActor } from "@/lib/api-actor";
import { AdsCapacityError, capacitySummary, readAdsCapacityPlan } from "@/lib/ads-capacity-service";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const actor = await getApiActor();
  try {
    const query = new URL(request.url).searchParams;
    const snapshot = await readAdsCapacityPlan(actor, { startDate: query.get("startDate") ?? undefined, endDate: query.get("endDate") ?? undefined, shift: query.get("shift") ?? undefined });
    return NextResponse.json(capacitySummary(snapshot), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (!(error instanceof AdsCapacityError)) console.error("[ads-capacity] read failed", error);
    return NextResponse.json({ message: error instanceof AdsCapacityError ? error.message : "Não foi possível carregar o planejamento ADS." }, { status: error instanceof AdsCapacityError ? error.status : 500 });
  }
}
