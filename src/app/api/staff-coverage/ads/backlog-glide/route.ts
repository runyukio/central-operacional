import { NextResponse } from "next/server";
import { getApiActor } from "@/lib/api-actor";
import { AdsCapacityError } from "@/lib/ads-capacity-service";
import { AdsBacklogGlideError, readAdsBacklogGlide } from "@/lib/ads-backlog-glide-service";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const result = await readAdsBacklogGlide(await getApiActor(), { horizonDays: params.get("horizonDays") ?? undefined });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const known = error instanceof AdsBacklogGlideError || error instanceof AdsCapacityError;
    if (!known) console.error("[ads-backlog-glide] read failed", error);
    return NextResponse.json({ message: known ? error.message : "Não foi possível carregar o glide path ADS." }, { status: known ? error.status : 500, headers: { "Cache-Control": "private, no-store" } });
  }
}
