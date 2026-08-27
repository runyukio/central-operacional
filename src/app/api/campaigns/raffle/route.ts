import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiActor } from "@/lib/api-actor";
import {
  CampaignRaffleError,
  createRaffleCampaign,
  distributeRaffleTickets,
  getCampaignRaffleDashboard
} from "@/lib/campaign-raffle-service";

export const dynamic = "force-dynamic";

const createCampaignSchema = z.object({
  action: z.literal("CREATE_CAMPAIGN"),
  name: z.string().trim().min(3).max(100)
});

const distributeSchema = z.object({
  action: z.literal("DISTRIBUTE"),
  campaignId: z.string().trim().min(1),
  employeeIds: z.array(z.string().trim().min(1)).min(1).max(500),
  ticketsPerEmployee: z.number().int().min(1).max(10_000),
  confirmation: z.string().trim(),
  idempotencyKey: z.string().trim().min(16).max(100)
});

const mutationSchema = z.discriminatedUnion("action", [createCampaignSchema, distributeSchema]);

export async function GET(request: Request) {
  try {
    const actor = await getApiActor();
    const url = new URL(request.url);
    const view = url.searchParams.get("view") === "staff" ? "staff" : "agent";
    const data = await getCampaignRaffleDashboard(actor, view, url.searchParams.get("campaignId"));
    return NextResponse.json({ data }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return raffleErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getApiActor();
    const payload = mutationSchema.parse(await request.json());
    const data = payload.action === "CREATE_CAMPAIGN"
      ? await createRaffleCampaign(actor, { name: payload.name })
      : await distributeRaffleTickets(actor, payload);
    return NextResponse.json({ data }, { status: payload.action === "CREATE_CAMPAIGN" ? 201 : 200 });
  } catch (error) {
    return raffleErrorResponse(error);
  }
}

function raffleErrorResponse(error: unknown) {
  if (error instanceof CampaignRaffleError) {
    return NextResponse.json({ error: error.message, message: error.message }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    const message = error.issues[0]?.message || "Dados inválidos.";
    return NextResponse.json({ error: message, message }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "Não foi possível processar a campanha.";
  console.error("[campaign-raffle]", error);
  return NextResponse.json({ error: message, message }, { status: 500 });
}
