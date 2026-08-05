import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { buildAdsExecutiveHealthMapXlsx } from "@/lib/ads-executive-xlsx";
import { getAdsExecutiveReportSnapshot } from "@/lib/ads-executive-webhook-service";
import { canAccessExecutiveAdsReport } from "@/lib/permissions";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getApiActor();
  if (!canAccessExecutiveAdsReport({ ...actor, status: "ACTIVE" })) {
    return NextResponse.json({ error: "You do not have permission to export the ADS executive report." }, { status: 403 });
  }

  try {
    const cycleDownload = new URL(request.url).searchParams.get("cycleDownload")?.trim() || undefined;
    const report = await getAdsExecutiveReportSnapshot(actor, cycleDownload);
    return buildXlsxResponse(buildAdsExecutiveHealthMapXlsx(report));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not export the ADS hourly health map.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
