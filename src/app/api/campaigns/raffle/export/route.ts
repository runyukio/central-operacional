import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { CampaignRaffleError, exportCampaignRaffleTickets } from "@/lib/campaign-raffle-service";
import { buildXlsxResponse } from "@/lib/xlsx-export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getApiActor();
  try {
    const campaignId = new URL(request.url).searchParams.get("campaignId");
    const response = buildXlsxResponse(await exportCampaignRaffleTickets(actor, campaignId));
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  } catch (error) {
    const knownError = error instanceof CampaignRaffleError;
    if (!knownError) console.error("[campaign-raffle-export]", error);
    const message = knownError ? error.message : "Não foi possível exportar os tickets. Tente novamente.";
    return NextResponse.json({ error: message, message }, {
      status: knownError ? error.status : 500,
      headers: { "Cache-Control": "private, no-store, max-age=0" }
    });
  }
}
