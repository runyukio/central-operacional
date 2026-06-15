import { NextResponse } from "next/server";

import { getApiActor } from "@/lib/api-actor";
import { getMuralPendingAcknowledgementCount, MuralError } from "@/lib/mural-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await getApiActor();
    return NextResponse.json(await getMuralPendingAcknowledgementCount(actor));
  } catch (error) {
    if (error instanceof MuralError) {
      return NextResponse.json({ success: false, error: error.message, message: error.message, count: 0, postIds: [] }, { status: error.status });
    }
    console.error("[mural/acknowledgement-pending] erro inesperado", error);
    return NextResponse.json({ success: false, error: "Não foi possível carregar pendências do Mural.", message: "Não foi possível carregar pendências do Mural.", count: 0, postIds: [] }, { status: 500 });
  }
}
